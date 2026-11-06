"""Durable Workflows end to end: the REAL worker driver + a REAL Temporal dev server.

The supervisor spawns ``workflow_worker_driver.py`` as a subprocess (the test's
own interpreter stands in for a tenant venv), exactly as the runner does, and
the dev server (``WorkflowEnvironment.start_local``) runs Worker Deployment
Versioning. Pins the properties Phase 3c rests on:

* a Workflow waits on a timer and a ``wait_condition`` + signal, and its
  activity sees the ``vnd_`` runtime token;
* killing the worker mid-wait loses nothing: the restarted worker replays;
* an execution pinned to v1 stays on v1 after v2 is published, while a new
  start pinned to v2 runs v2;
* a start pinned to a version that has NEVER polled is refused
  (``FailedPrecondition``), but **a version that polled once accepts pinned
  starts with zero pollers** — the plan's gate for design B (pin at start):
  a runner that idle-exits must not make the next start fail;
* a rotated key reaches a live worker over its control channel.

Skipped when the dev server can't be downloaded/started (offline) — except
with ``PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER=1`` (set in CI), where that fails.
"""

from __future__ import annotations

import asyncio
import os
import sys
import textwrap
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from temporalio.client import Client, WorkflowHandle
from temporalio.common import PinnedVersioningOverride, WorkerDeploymentVersion
from temporalio.service import RPCError
from temporalio.testing import WorkflowEnvironment

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.broker_client import ExecutableWorkflow, TemporalCredentials
from pegasus_tenant_runner.workflow_workers import WorkflowWorkerSupervisor, workflow_task_queue

TENANT_QUEUE = "pegasus-tenant-11111111-1111-4111-8111-111111111111-test"
NAME = "lifecycle"

#: Worker Deployment Versioning is off by default in the dev server.
WDV_DYNAMIC_CONFIG = [
    "--dynamic-config-value",
    "system.enableDeploymentVersions=true",
    "--dynamic-config-value",
    "frontend.workerVersioningWorkflowAPIs=true",
    "--dynamic-config-value",
    "frontend.workerVersioningDataAPIs=true",
]

WORKFLOW_SOURCE = textwrap.dedent(
    """
    import os
    from datetime import timedelta

    from temporalio import activity, workflow

    VERSION = "{version}"


    @activity.defn
    async def stamp(tag: str) -> str:
        token = "token" if os.environ.get("PEGASUS_RUNTIME_TOKEN") else "none"
        return f"{{tag}}:{{VERSION}}:{{token}}"


    @workflow.defn(name="{name}")
    class Lifecycle:
        def __init__(self) -> None:
            self.go = False

        @workflow.signal
        def proceed(self) -> None:
            self.go = True

        @workflow.run
        async def run(self, payload: dict) -> str:
            await workflow.sleep(timedelta(seconds=1))
            await workflow.wait_condition(lambda: self.go)
            return await workflow.execute_activity(
                stamp, "done", start_to_close_timeout=timedelta(seconds=10)
            )
    """
)


def _row(wid: str, sha: str, created_at: str, open_executions: int = 0) -> ExecutableWorkflow:
    return ExecutableWorkflow(
        id=wid,
        name=NAME,
        version="1.0.0",
        entry_points=(f"{NAME}.workflow:Lifecycle",),
        artifact_sha256=sha,
        artifact_size_bytes=None,
        download_url="https://s3.invalid/a.zip",
        created_at=created_at,
        kind="workflow",
        open_executions=open_executions,
    )


class LocalPreparer:
    """Installs each row as a source tree run by THIS interpreter."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def install(self, wid: str, version: str) -> None:
        src = self._root / wid / "src" / NAME
        src.mkdir(parents=True)
        (src / "__init__.py").write_text("")
        (src / "workflow.py").write_text(WORKFLOW_SOURCE.format(version=version, name=NAME))
        (self._root / wid / "scratch" / "tmp").mkdir(parents=True)

    @asynccontextmanager
    async def use(
        self, *, workflow_id: str | None, workflow_name: str
    ) -> AsyncIterator[tuple[PreparedWorkflow, str]]:
        assert workflow_id is not None
        base = self._root / workflow_id
        yield (
            PreparedWorkflow(
                workflow_id=workflow_id,
                name=workflow_name,
                version="1.0.0",
                entry_point=f"{NAME}.workflow:Lifecycle",
                src_dir=base / "src",
                python_bin=Path(sys.executable),
                scratch_dir=base / "scratch",
                kind="workflow",
            ),
            "id",
        )


class GrantBroker:
    def fetch_workflow_worker_grant(self, workflow_id: str) -> str:
        return f"vnd_{workflow_id}"


async def _eventually(check: Callable[[], Any], timeout: float = 60.0) -> Any:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        try:
            return await check()
        except Exception:
            if loop.time() > deadline:
                raise
            await asyncio.sleep(0.5)


async def _start_pinned(client: Client, build_id: str) -> WorkflowHandle[Any, Any]:
    return await client.start_workflow(
        NAME,
        {"executionId": "e"},
        id=f"wfl-{uuid.uuid4()}",
        task_queue=workflow_task_queue(TENANT_QUEUE, NAME),
        versioning_override=PinnedVersioningOverride(WorkerDeploymentVersion(NAME, build_id)),
        execution_timeout=timedelta(minutes=5),
    )


async def _finish(handle: WorkflowHandle[Any, Any]) -> str:
    await handle.signal("proceed")
    return await asyncio.wait_for(handle.result(), timeout=60)


@pytest.fixture
async def env() -> AsyncIterator[WorkflowEnvironment]:
    try:
        environment = await WorkflowEnvironment.start_local(
            dev_server_extra_args=WDV_DYNAMIC_CONFIG
        )
    except Exception as exc:  # pragma: no cover — environment-specific
        # This test is the gate for design B (pin at start). Skipping is right
        # offline, but in CI a skip would be a silent green: CI sets
        # PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER=1 and a failed start fails.
        if os.environ.get("PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER") == "1":
            pytest.fail(f"local Temporal dev server required but unavailable: {exc}")
        pytest.skip(f"local Temporal dev server unavailable: {exc}")
    try:
        yield environment
    finally:
        await environment.shutdown()


async def test_durable_workflow_lifecycle_against_a_real_server(
    env: WorkflowEnvironment, tmp_path: Path
) -> None:
    client = env.client
    preparer = LocalPreparer(tmp_path)
    preparer.install("w1", "v1")
    preparer.install("w2", "v2")
    v1_sha, v2_sha = "1" * 64, "2" * 64
    creds = TemporalCredentials(
        address=client.service_client.config.target_host, namespace=client.namespace, api_key=""
    )
    spawned: dict[str, list[Any]] = {}

    async def spawn(prepared: PreparedWorkflow) -> Any:
        from pegasus_tenant_runner.workflow_workers import spawn_worker_process

        child = await spawn_worker_process(prepared)
        spawned.setdefault(prepared.workflow_id, []).append(child)
        return child

    supervisor = WorkflowWorkerSupervisor(
        broker=GrantBroker(),  # type: ignore[arg-type]
        preparer=preparer,  # type: ignore[arg-type]
        credentials=lambda: creds,
        tenant_task_queue=TENANT_QUEUE,
        api_base_url="http://api.invalid",
        spawn=spawn,
        backoff_base_seconds=0.2,
        stop_grace_seconds=15,
    )
    try:
        # A version no worker has polled can't take a pinned start.
        with pytest.raises(RPCError, match="not present in task queue"):
            await _start_pinned(client, v1_sha)

        # v1 published: its worker comes up and registers the version.
        await supervisor.reconcile([_row("w1", v1_sha, "2026-06-01T00:00:00Z")])
        h1 = await _eventually(lambda: _start_pinned(client, v1_sha))

        # Kill v1's worker mid-wait: the restarted worker replays h1.
        await asyncio.sleep(2)
        spawned["w1"][0].kill()
        await _eventually(lambda: _assert(len(spawned["w1"]) == 2))

        # v2 published while h1 is open: both rows served; a new start pins v2.
        await supervisor.reconcile(
            [
                _row("w1", v1_sha, "2026-06-01T00:00:00Z", open_executions=1),
                _row("w2", v2_sha, "2026-06-02T00:00:00Z"),
            ]
        )
        h2 = await _eventually(lambda: _start_pinned(client, v2_sha))

        # A rotated key reaches the live workers without disturbing them.
        await supervisor.push_credentials(
            TemporalCredentials(
                address=creds.address, namespace=creds.namespace, api_key="rotated-key"
            )
        )

        assert await _finish(h1) == "done:v1:token"
        assert await _finish(h2) == "done:v2:token"

        # The gate: every worker gone (the runner idled out) — a pinned start
        # of a version that polled before is still ACCEPTED, and runs once a
        # worker for it polls again.
        await supervisor.drain_all()
        assert all(c.returncode is not None for cs in spawned.values() for c in cs)
        await asyncio.sleep(3)
        h3 = await _start_pinned(client, v1_sha)
        await supervisor.reconcile(
            [
                _row("w1", v1_sha, "2026-06-01T00:00:00Z", open_executions=1),
                _row("w2", v2_sha, "2026-06-02T00:00:00Z"),
            ]
        )
        assert await _finish(h3) == "done:v1:token"
        description = await h3.describe()
        info = description.raw_description.workflow_execution_info.versioning_info
        assert info.deployment_version.build_id == v1_sha
    finally:
        await supervisor.drain_all()


async def _assert(condition: bool) -> None:
    assert condition


async def test_drain_with_an_open_workflow_exits_cleanly(
    env: WorkflowEnvironment, tmp_path: Path
) -> None:
    """A runner stop (SIGTERM → drain_all) while a Workflow is open mid-wait.

    In the Phase 3c staging acceptance (Temporal Cloud) every such drain logged
    the worker subprocess exiting -11 (SIGSEGV) ~40 ms after the shutdown line,
    while drains after all Workflows had closed exited 0. It does NOT reproduce
    against the dev server (nor in python:3.12-slim, nor with pegasus_workflows
    in the sandbox), so this pins the contract — a drain with an open Workflow
    exits 0 and the Workflow finishes on the next worker — rather than the
    crash. The lifecycle test above only asserted ``returncode is not None``.
    """
    client = env.client
    preparer = LocalPreparer(tmp_path)
    preparer.install("w1", "v1")
    sha = "1" * 64
    creds = TemporalCredentials(
        address=client.service_client.config.target_host, namespace=client.namespace, api_key=""
    )
    spawned: list[Any] = []

    async def spawn(prepared: PreparedWorkflow) -> Any:
        from pegasus_tenant_runner.workflow_workers import spawn_worker_process

        child = await spawn_worker_process(prepared)
        spawned.append(child)
        return child

    supervisor = WorkflowWorkerSupervisor(
        broker=GrantBroker(),  # type: ignore[arg-type]
        preparer=preparer,  # type: ignore[arg-type]
        credentials=lambda: creds,
        tenant_task_queue=TENANT_QUEUE,
        api_base_url="http://api.invalid",
        spawn=spawn,
        backoff_base_seconds=0.2,
        stop_grace_seconds=15,
    )
    try:
        await supervisor.reconcile([_row("w1", sha, "2026-06-01T00:00:00Z")])
        handle = await _eventually(lambda: _start_pinned(client, sha))
        # Past the 1 s timer, parked in wait_condition: open and cached.
        await asyncio.sleep(3)
        await supervisor.drain_all()
        assert [c.returncode for c in spawned] == [0]
        # And it still finishes on the next worker.
        await supervisor.reconcile([_row("w1", sha, "2026-06-01T00:00:00Z", open_executions=1)])
        assert await _finish(handle) == "done:v1:token"
    finally:
        await supervisor.drain_all()
