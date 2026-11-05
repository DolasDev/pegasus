"""Durable-Workflow worker driver — runs INSIDE the tenant's venv (Phase 3c).

Invoked by the shim's :class:`~pegasus_tenant_runner.workflow_workers.WorkflowWorkerSupervisor`
as ``<venv python> -P <path to this file>`` with the stripped environment from
:mod:`pegasus_tenant_runner.sandbox_env`. Like ``subprocess_driver.py``, from
the moment this script imports the tenant's module EVERYTHING in the process
is tenant-controlled, so it must import only the stdlib and ``temporalio``
(it is executed by path; ``-P`` keeps its directory off ``sys.path``).

Unlike the one-shot driver, this process is LONG-LIVED: it is a real
Temporal ``Worker`` for ONE published WORKFLOW-kind row, polling that
workflow's own task queue in the tenant's own namespace, as the Worker
Deployment Version ``(workflow name, artifactSha256)`` with PINNED
behaviour. So timers, ``wait_condition``, signals and replay all work —
which is the whole point of a durable Workflow. It holds the tenant's
namespace-scoped Temporal key; D5 accepts that (the key reaches only the
tenant's own namespace).

stdin is a one-way JSON-lines control channel from the shim, kept open for
the life of the process (never argv/env, which ``/proc`` exposes):

* first line — ``{"type": "start", "address", "namespace", "apiKey",
  "runtimeToken", "apiBaseUrl", "entryPoint", "taskQueue",
  "deploymentName", "buildId"}``;
* ``{"type": "credentials", "apiKey": "..."}`` — the shim's 30-min key
  refresh fanned out; applied with ``client.api_key = ...`` exactly like the
  shim's own refresh (no reconnect, no drain);
* ``{"type": "shutdown"}`` — drain and exit 0. EOF means the shim is gone:
  same thing.

SIGTERM also drains. Exit codes: 0 clean, 3 worker failure, 4 bad request,
5 failed hardening.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import ctypes
import importlib
import json
import os
import signal
import sys
import threading
from datetime import timedelta
from typing import Any

#: ``<sys/prctl.h>`` — see the shim's hardening.py.
_PR_SET_DUMPABLE = 4
_PR_GET_DUMPABLE = 3

#: How long a draining worker lets in-flight activities finish. Must fit the
#: shim's per-step stop grace (workflow_workers.py, 8 s) so a normal drain
#: ends on the shutdown line, never on SIGTERM/SIGKILL.
_GRACEFUL_SHUTDOWN = timedelta(seconds=6)


def _set_non_dumpable() -> None:
    """Make THIS process non-dumpable before it reads any secret.

    The shim's own ``PR_SET_DUMPABLE = 0`` does not carry over: the kernel
    resets the flag to 1 on ``execve()`` (see hardening.py), and this process
    holds the tenant's Temporal key for hours. It stops other same-uid
    processes in the task (e.g. an Automation subprocess) from reading this
    one's memory via /proc. Linux only; elsewhere (local dev) it is a no-op.
    """
    if not sys.platform.startswith("linux"):
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE, 0) failed")
    if libc.prctl(_PR_GET_DUMPABLE, 0, 0, 0, 0) != 0:
        raise OSError("process is still dumpable after PR_SET_DUMPABLE")


def _import_entry_point(entry_point: str) -> tuple[Any, Any]:
    """Return ``(module, workflow class)`` for ``module.path:Attribute``."""
    module_path, sep, attr = entry_point.partition(":")
    if not module_path or not sep or not attr:
        raise RuntimeError(f"entry point {entry_point!r} must be 'module.path:Attribute'")
    module = importlib.import_module(module_path)
    try:
        target = getattr(module, attr)
    except AttributeError as exc:
        raise RuntimeError(f"module {module_path!r} has no attribute {attr!r}") from exc
    if getattr(target, "__temporal_workflow_definition", None) is None:
        raise RuntimeError(
            f"entry point {entry_point!r} is not a workflow class "
            "(decorate it with @pegasus_workflow / @workflow.defn)"
        )
    return module, target


def collect_activities(module: Any) -> list[Any]:
    """Every ``@activity.defn`` callable reachable from the entry module.

    Module globals include activities imported from sibling modules
    (``from .activities import send_sms``), which is how workflows reference
    them. De-duplicated by registered name: two references to one activity
    must register once.
    """
    by_name: dict[str, Any] = {}
    for value in vars(module).values():
        defn = getattr(value, "__temporal_activity_definition", None)
        if defn is not None and callable(value):
            by_name.setdefault(getattr(defn, "name", None) or value.__name__, value)
    return list(by_name.values())


def _read_start_request() -> dict[str, Any]:
    line = sys.stdin.readline()
    request = json.loads(line)
    if not isinstance(request, dict) or request.get("type") != "start":
        raise ValueError("first control line must be a 'start' request")
    for key in ("address", "namespace", "entryPoint", "taskQueue", "deploymentName", "buildId"):
        if not isinstance(request.get(key), str) or not request[key]:
            raise ValueError(f"start request missing {key!r}")
    return request


def _apply_control_line(client: Any, stop: asyncio.Event, line: str) -> None:
    """Apply one control line on the event loop. EOF ("") stops the worker."""
    if not line:
        stop.set()
        return
    try:
        message = json.loads(line)
    except ValueError:
        print("pegasus worker driver: ignoring malformed control line", file=sys.stderr)
        return
    kind = message.get("type") if isinstance(message, dict) else None
    if kind == "credentials" and isinstance(message.get("apiKey"), str):
        client.api_key = message["apiKey"]
    elif kind == "shutdown":
        stop.set()


def _start_control_reader(
    loop: asyncio.AbstractEventLoop, client: Any, stop: asyncio.Event
) -> None:
    """Read control lines on a DAEMON thread and hand each to the loop.

    Not ``asyncio.to_thread``: a default-executor thread blocked in
    ``readline`` would keep ``asyncio.run`` from returning after a SIGTERM
    (it joins that executor on the way out). A daemon thread dies with the
    process.
    """

    def _reader() -> None:
        while True:
            line = sys.stdin.readline()
            try:
                loop.call_soon_threadsafe(_apply_control_line, client, stop, line)
            except RuntimeError:  # loop already closed — we are exiting
                return
            if not line:
                return

    threading.Thread(target=_reader, name="control-reader", daemon=True).start()


async def _serve(request: dict[str, Any]) -> None:
    from temporalio.client import Client
    from temporalio.common import VersioningBehavior, WorkerDeploymentVersion
    from temporalio.worker import Worker, WorkerDeploymentConfig

    module, workflow_cls = _import_entry_point(request["entryPoint"])
    activities = collect_activities(module)

    client = await Client.connect(
        request["address"],
        namespace=request["namespace"],
        api_key=request.get("apiKey") or None,
        identity=f"pegasus-workflow-worker-{request['deploymentName']}-{request['buildId'][:12]}",
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - non-POSIX dev hosts
            pass

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as activity_executor:
        worker = Worker(
            client,
            task_queue=request["taskQueue"],
            workflows=[workflow_cls],
            activities=activities,
            # Sync (def) activities need an executor; async ones ignore it.
            activity_executor=activity_executor,
            graceful_shutdown_timeout=_GRACEFUL_SHUTDOWN,
            deployment_config=WorkerDeploymentConfig(
                version=WorkerDeploymentVersion(request["deploymentName"], request["buildId"]),
                use_worker_versioning=True,
                default_versioning_behavior=VersioningBehavior.PINNED,
            ),
        )
        _start_control_reader(loop, client, stop)
        async with worker:
            print(
                f"pegasus worker driver: polling {request['taskQueue']} as "
                f"{request['deploymentName']}:{request['buildId'][:12]}",
                file=sys.stderr,
            )
            await stop.wait()


def main() -> int:
    try:
        _set_non_dumpable()
    except Exception as exc:  # noqa: BLE001 — refuse to hold secrets dumpable
        print(f"pegasus worker driver: hardening failed: {exc!r}", file=sys.stderr)
        return 5
    try:
        request = _read_start_request()
    except (ValueError, KeyError) as exc:
        print(f"pegasus worker driver: invalid start request: {exc!r}", file=sys.stderr)
        return 4

    # The tenant's contract for calling the Pegasus API from activities, the
    # same as the one-shot driver: PegasusClient.from_runtime() reads these.
    # Set after exec, so they never appear in /proc/<pid>/environ.
    if request.get("apiBaseUrl"):
        os.environ["PEGASUS_API_BASE_URL"] = request["apiBaseUrl"]
    if request.get("runtimeToken"):
        os.environ["PEGASUS_RUNTIME_TOKEN"] = request["runtimeToken"]

    try:
        asyncio.run(_serve(request))
    except Exception as exc:  # noqa: BLE001 — the shim restarts us with backoff
        print(f"pegasus worker driver: worker failed: {exc!r}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
