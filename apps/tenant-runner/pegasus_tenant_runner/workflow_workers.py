"""Durable-Workflow worker subprocesses — one per served published row (Phase 3c).

An Automation runs as ONE short subprocess per execution, behind the proxy
activity (executor.py). A durable Workflow can't: it waits on timers and
conditions for days and Temporal replays it, so it needs a real Temporal
``Worker`` that stays up. :class:`WorkflowWorkerSupervisor` keeps one
long-lived worker subprocess (``workflow_worker_driver.py``, inside the
row's own venv, stripped env) per WORKFLOW-kind row the runner must serve:

* which rows — :func:`~pegasus_tenant_runner.artifacts.select_workflow_versions`:
  every row with open executions (each execution is pinned to the row it
  started on) plus the newest row of each name (where new starts go), capped
  at ``max_workers`` per runner;
* lifecycle — ``reconcile`` (called every discovery tick with a fresh broker
  listing) starts missing workers and drains surplus ones; a worker that
  exits on its own is restarted with exponential backoff;
* credentials — each worker gets the tenant's current Temporal key in its
  ``start`` line and every refreshed key afterwards
  (:meth:`push_credentials`, fanned out from the shim's 30-min refresh), over
  its stdin control channel;
* the row's ``vnd_`` runtime token comes from the broker's worker-grant
  route, once per worker (it doesn't expire).

The prepared artifact directory is pinned (``WorkflowPreparer.use``) for the
whole life of the worker, so cache eviction never deletes code a worker is
running out of.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import httpx

from .artifacts import (
    ArtifactInstallError,
    ArtifactIntegrityError,
    PreparedWorkflow,
    select_workflow_versions,
)
from .broker_client import (
    BrokerError,
    ExecutableWorkflow,
    TemporalCredentials,
    TenantBrokerClient,
    WorkerGrantUnavailable,
)
from .preparer import WorkflowNotAvailableError, WorkflowPreparer
from .sandbox_env import build_subprocess_env

log = logging.getLogger("pegasus_tenant_runner")

__all__ = [
    "WORKER_DRIVER_PATH",
    "WorkflowWorkerSupervisor",
    "workflow_task_queue",
]

#: Executed BY PATH inside the tenant's venv (never imported by the shim).
WORKER_DRIVER_PATH = Path(__file__).with_name("workflow_worker_driver.py")

#: A tenant log line longer than this is truncated before it reaches our logs.
_MAX_LOG_LINE_CHARS = 2000

#: Per worker stream: at most this many lines are logged per window; the rest
#: are counted and reported once. A long-lived worker runs tenant code that
#: may print in a loop — that must not become our CloudWatch bill.
_MAX_LOG_LINES_PER_WINDOW = 120
_LOG_WINDOW_SECONDS = 60.0


def workflow_task_queue(tenant_task_queue: str, workflow_name: str) -> str:
    """The task queue one durable Workflow's workers poll.

    Must match the API's ``workflowTaskQueue`` (lib/workflow-route.ts). One
    queue per workflow name, because a task queue belongs to one Worker
    Deployment, and the deployment is the workflow name.
    """
    return f"{tenant_task_queue}-wfl-{workflow_name}"


class _Child(Protocol):
    """The slice of ``asyncio.subprocess.Process`` the supervisor uses."""

    pid: int
    returncode: int | None
    stdin: Any
    stdout: Any
    stderr: Any

    async def wait(self) -> int: ...
    def terminate(self) -> None: ...
    def kill(self) -> None: ...


Spawner = Callable[[PreparedWorkflow], Awaitable[_Child]]


async def spawn_worker_process(prepared: PreparedWorkflow) -> _Child:
    """Start the worker driver in the row's venv with the stripped env."""
    return await asyncio.create_subprocess_exec(
        str(prepared.python_bin),
        "-P",
        str(WORKER_DRIVER_PATH),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=build_subprocess_env(prepared),
        cwd=str(prepared.scratch_dir),
    )


@dataclass
class _Slot:
    """One served row: its worker task and current child process."""

    wf: ExecutableWorkflow
    task: asyncio.Task[None] | None = None
    child: _Child | None = None
    stopping: bool = False
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    #: Consecutive failed runs (reset after a worker stays up a while).
    failures: int = 0
    #: Monotonic time before which a failed slot is not retried.
    not_before: float = 0.0


class WorkflowWorkerSupervisor:
    """Keeps one worker subprocess per served WORKFLOW-kind row. See the module docs."""

    def __init__(
        self,
        *,
        broker: TenantBrokerClient,
        preparer: WorkflowPreparer,
        credentials: Callable[[], TemporalCredentials],
        tenant_task_queue: str,
        api_base_url: str,
        max_workers: int = 8,
        spawn: Spawner = spawn_worker_process,
        backoff_base_seconds: float = 2.0,
        backoff_max_seconds: float = 300.0,
        stable_after_seconds: float = 300.0,
        # Per escalation step (shutdown line → SIGTERM → SIGKILL). The whole
        # runner drain must fit ECS's stopTimeout (Fargate default 30 s, not
        # overridden for the runner): proxy worker 5 s + 8 + 8 s here ≈ 21 s.
        # A drain cut short loses nothing (open Workflows replay on the next
        # runner), but a clean one lets in-flight activities finish.
        stop_grace_seconds: float = 8.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._broker = broker
        self._preparer = preparer
        self._credentials = credentials
        self._tenant_task_queue = tenant_task_queue
        self._api_base_url = api_base_url
        self._max_workers = max(1, max_workers)
        self._spawn = spawn
        self._backoff_base = backoff_base_seconds
        self._backoff_max = backoff_max_seconds
        self._stable_after = stable_after_seconds
        self._stop_grace = stop_grace_seconds
        self._clock = clock
        self._slots: dict[str, _Slot] = {}

    # -- introspection --------------------------------------------------------

    @property
    def served_ids(self) -> list[str]:
        """Rows with a live (or restarting) worker task."""
        return [wid for wid, s in self._slots.items() if s.task is not None and not s.task.done()]

    # -- reconcile ------------------------------------------------------------

    async def reconcile(self, listed: list[ExecutableWorkflow]) -> None:
        """Converge the running workers on what ``listed`` says to serve."""
        desired = select_workflow_versions(listed)
        if len(desired) > self._max_workers:
            log.warning(
                "runner.workflow_worker_cap_reached",
                extra={
                    "cap": self._max_workers,
                    "wanted": len(desired),
                    "unserved": [f"{wf.name}@{wf.version}" for wf in desired[self._max_workers :]],
                },
            )
            desired = desired[: self._max_workers]
        desired_ids = {wf.id for wf in desired}

        surplus = [wid for wid in self._slots if wid not in desired_ids]
        if surplus:
            await asyncio.gather(*(self._stop(wid) for wid in surplus))

        now = self._clock()
        for wf in desired:
            slot = self._slots.get(wf.id)
            if slot is not None:
                slot.wf = wf
                if slot.task is not None and not slot.task.done():
                    continue
                if now < slot.not_before:
                    continue
            else:
                slot = _Slot(wf=wf)
                self._slots[wf.id] = slot
            slot.task = asyncio.create_task(self._serve(slot), name=f"wfl-worker-{wf.id}")

    async def push_credentials(self, credentials: TemporalCredentials) -> None:
        """Hand a refreshed Temporal key to every live worker."""
        line = json.dumps({"type": "credentials", "apiKey": credentials.api_key})
        for slot in list(self._slots.values()):
            if slot.child is not None:
                await self._write_line(slot, line)

    async def drain_all(self) -> None:
        """Stop every worker (runner shutdown: idle-exit or SIGTERM)."""
        await asyncio.gather(*(self._stop(wid) for wid in list(self._slots)))

    # -- internals ------------------------------------------------------------

    def _log_context(self, wf: ExecutableWorkflow) -> dict[str, Any]:
        return {"workflow_id": wf.id, "workflow_name": wf.name, "version": wf.version}

    def _start_line(self, wf: ExecutableWorkflow, prepared: PreparedWorkflow, token: str) -> str:
        creds = self._credentials()
        return json.dumps(
            {
                "type": "start",
                "address": creds.address,
                "namespace": creds.namespace,
                "apiKey": creds.api_key,
                "runtimeToken": token,
                "apiBaseUrl": self._api_base_url,
                "entryPoint": prepared.entry_point,
                "taskQueue": workflow_task_queue(self._tenant_task_queue, wf.name),
                "deploymentName": wf.name,
                "buildId": wf.artifact_sha256,
            }
        )

    async def _write_line(self, slot: _Slot, line: str) -> bool:
        child = slot.child
        if child is None or child.stdin is None:
            return False
        try:
            child.stdin.write((line + "\n").encode("utf-8"))
            await child.stdin.drain()
            return True
        except (BrokenPipeError, ConnectionResetError):
            return False

    async def _pump(self, stream: Any, wf: ExecutableWorkflow, name: str) -> None:
        """Forward a worker's output to our logs, line by line, truncated.

        The worker's stdout/stderr belong to tenant code; they are logged as
        data (never parsed) and must be drained or the child blocks on a full
        pipe.
        """
        if stream is None:
            return
        window_start = self._clock()
        logged = suppressed = 0
        while True:
            raw = await stream.readline()
            if not raw:
                break
            now = self._clock()
            if now - window_start >= _LOG_WINDOW_SECONDS:
                if suppressed:
                    log.warning(
                        "runner.workflow_worker_output_suppressed",
                        extra={**self._log_context(wf), "stream": name, "lines": suppressed},
                    )
                window_start, logged, suppressed = now, 0, 0
            if logged >= _MAX_LOG_LINES_PER_WINDOW:
                suppressed += 1
                continue
            logged += 1
            log.info(
                "runner.workflow_worker_output",
                extra={
                    **self._log_context(wf),
                    "stream": name,
                    "line": raw.decode("utf-8", "replace").rstrip()[:_MAX_LOG_LINE_CHARS],
                },
            )
        if suppressed:
            log.warning(
                "runner.workflow_worker_output_suppressed",
                extra={**self._log_context(wf), "stream": name, "lines": suppressed},
            )

    def _backoff(self, slot: _Slot) -> float:
        return min(self._backoff_base * (2 ** max(0, slot.failures - 1)), self._backoff_max)

    async def _serve(self, slot: _Slot) -> None:
        """Run (and re-run) one row's worker until it is stopped."""
        wf = slot.wf
        ctx = self._log_context(wf)
        try:
            async with self._preparer.use(workflow_id=wf.id, workflow_name=wf.name) as (
                prepared,
                _resolved_by,
            ):
                if not prepared.is_workflow:
                    raise WorkflowNotAvailableError(
                        f"workflow row {wf.id} is not a durable Workflow"
                    )
                token = await asyncio.to_thread(self._broker.fetch_workflow_worker_grant, wf.id)
                while not slot.stopping:
                    await self._run_once(slot, prepared, token)
                    if slot.stopping:
                        return
                    delay = self._backoff(slot)
                    log.warning(
                        "runner.workflow_worker_restarting",
                        extra={**ctx, "failures": slot.failures, "restart_in_seconds": delay},
                    )
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(slot.wake.wait(), timeout=delay)
        except WorkerGrantUnavailable:
            # Retired, or no longer servable: the next listing will drop it.
            log.warning("runner.workflow_worker_grant_unavailable", extra=ctx)
            slot.failures += 1
            slot.not_before = self._clock() + self._backoff(slot)
        except ArtifactIntegrityError:
            log.exception("runner.artifact_sha_mismatch_SECURITY", extra=ctx)
            slot.failures += 1
            slot.not_before = self._clock() + self._backoff_max
        except (
            WorkflowNotAvailableError,
            ArtifactInstallError,
            BrokerError,
            httpx.HTTPError,
            OSError,
        ):
            log.exception("runner.workflow_worker_prepare_failed", extra=ctx)
            slot.failures += 1
            slot.not_before = self._clock() + self._backoff(slot)
        except Exception:  # noqa: BLE001 — never let one row's bug end supervision
            log.exception("runner.workflow_worker_supervision_failed", extra=ctx)
            slot.failures += 1
            slot.not_before = self._clock() + self._backoff(slot)

    async def _run_once(self, slot: _Slot, prepared: PreparedWorkflow, token: str) -> None:
        wf = slot.wf
        ctx = self._log_context(wf)
        child = await self._spawn(prepared)
        slot.child = child
        started = self._clock()
        if slot.stopping:
            # _stop ran while we were spawning (slot.child was still None, so
            # it had nothing to signal): stop this child ourselves.
            with contextlib.suppress(ProcessLookupError):
                child.kill()
        pumps = [
            asyncio.create_task(self._pump(child.stdout, wf, "stdout")),
            asyncio.create_task(self._pump(child.stderr, wf, "stderr")),
        ]
        try:
            if not await self._write_line(slot, self._start_line(wf, prepared, token)):
                log.error("runner.workflow_worker_start_line_failed", extra=ctx)
            log.info(
                "runner.workflow_worker_started",
                extra={**ctx, "pid": child.pid, "build_id": wf.artifact_sha256},
            )
            code = await child.wait()
        finally:
            slot.child = None
            # Cancelled mid-wait (a stop that timed out on us): never leave a
            # child holding the tenant key behind, and give the pumps their
            # EOF — they read until the child's pipes close.
            if child.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    child.kill()
            await asyncio.gather(*pumps, return_exceptions=True)

        ran_for = self._clock() - started
        if slot.stopping:
            log.info("runner.workflow_worker_stopped", extra={**ctx, "exit_code": code})
            return
        # A worker that stayed up a while and then died is a fresh failure, not
        # the next step of a crash loop.
        slot.failures = 1 if ran_for >= self._stable_after else slot.failures + 1
        log.error(
            "runner.workflow_worker_exited",
            extra={**ctx, "exit_code": code, "ran_for_seconds": round(ran_for, 1)},
        )

    async def _stop(self, workflow_id: str) -> None:
        """Drain one worker: shutdown line → SIGTERM → SIGKILL."""
        slot = self._slots.pop(workflow_id, None)
        if slot is None:
            return
        slot.stopping = True
        slot.wake.set()
        child = slot.child
        if child is not None:
            await self._write_line(slot, json.dumps({"type": "shutdown"}))
            for escalate in (child.terminate, child.kill):
                try:
                    await asyncio.wait_for(child.wait(), timeout=self._stop_grace)
                    break
                except TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        escalate()
            else:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(child.wait(), timeout=self._stop_grace)
        if slot.task is not None:
            with contextlib.suppress(asyncio.CancelledError, TimeoutError):
                await asyncio.wait_for(slot.task, timeout=self._stop_grace)
        log.info("runner.workflow_worker_retired", extra=self._log_context(slot.wf))
