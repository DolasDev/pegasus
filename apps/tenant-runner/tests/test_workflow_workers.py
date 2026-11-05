"""WorkflowWorkerSupervisor against fake children — no Temporal, no subprocesses.

The real driver + a real Temporal dev server are exercised in
test_workflow_worker_e2e.py; this file pins the supervision contract: which
rows get a worker, what the start line carries, restart/backoff, key
fan-out and draining.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.broker_client import (
    ExecutableWorkflow,
    TemporalCredentials,
    WorkerGrantUnavailable,
)
from pegasus_tenant_runner.workflow_workers import WorkflowWorkerSupervisor, workflow_task_queue

TENANT_QUEUE = "pegasus-tenant-11111111-1111-4111-8111-111111111111-test"


def _row(
    wid: str,
    *,
    name: str = "lifecycle",
    created_at: str = "2026-06-01T00:00:00.000Z",
    open_executions: int = 0,
    kind: str = "workflow",
) -> ExecutableWorkflow:
    return ExecutableWorkflow(
        id=wid,
        name=name,
        version="1.0.0",
        entry_points=(f"{name}.workflow:Lifecycle",),
        artifact_sha256=wid[-1] * 64,
        artifact_size_bytes=None,
        download_url="https://s3.invalid/a.zip",
        created_at=created_at,
        kind=kind,
        open_executions=open_executions,
    )


class FakeStdin:
    def __init__(self, child: FakeChild) -> None:
        self._child = child
        self.lines: list[dict[str, Any]] = []

    def write(self, data: bytes) -> None:
        if self._child.returncode is not None:
            raise BrokenPipeError
        for line in data.decode().splitlines():
            message = json.loads(line)
            self.lines.append(message)
            if message.get("type") == "shutdown" and self._child.obeys_shutdown:
                self._child.exit(0)

    async def drain(self) -> None:
        return None


class FakeChild:
    _next_pid = 100

    def __init__(self, *, obeys_shutdown: bool = True) -> None:
        FakeChild._next_pid += 1
        self.pid = FakeChild._next_pid
        self.returncode: int | None = None
        self.obeys_shutdown = obeys_shutdown
        self.stdin = FakeStdin(self)
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self._exited = asyncio.Event()
        self.signals: list[str] = []

    def exit(self, code: int) -> None:
        if self.returncode is None:
            self.returncode = code
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self._exited.set()

    async def wait(self) -> int:
        await self._exited.wait()
        assert self.returncode is not None
        return self.returncode

    def terminate(self) -> None:
        self.signals.append("TERM")
        self.exit(-15)

    def kill(self) -> None:
        self.signals.append("KILL")
        self.exit(-9)


class FakePreparer:
    def __init__(self, tmp: Path, *, kind: str = "workflow") -> None:
        self._tmp = tmp
        self._kind = kind
        self.in_use: dict[str, int] = {}

    @asynccontextmanager
    async def use(
        self, *, workflow_id: str | None, workflow_name: str
    ) -> AsyncIterator[tuple[PreparedWorkflow, str]]:
        assert workflow_id is not None
        self.in_use[workflow_id] = self.in_use.get(workflow_id, 0) + 1
        try:
            yield (
                PreparedWorkflow(
                    workflow_id=workflow_id,
                    name=workflow_name,
                    version="1.0.0",
                    entry_point=f"{workflow_name}.workflow:Lifecycle",
                    src_dir=self._tmp / "src",
                    python_bin=self._tmp / "python",
                    scratch_dir=self._tmp / "scratch",
                    kind=self._kind,
                ),
                "id",
            )
        finally:
            self.in_use[workflow_id] -= 1


class FakeBroker:
    def __init__(self, unavailable: set[str] | None = None) -> None:
        self.unavailable = unavailable or set()
        self.grants: list[str] = []

    def fetch_workflow_worker_grant(self, workflow_id: str) -> str:
        self.grants.append(workflow_id)
        if workflow_id in self.unavailable:
            raise WorkerGrantUnavailable(workflow_id)
        return f"vnd_{workflow_id}"


class Harness:
    def __init__(self, tmp: Path, **kwargs: Any) -> None:
        self.children: list[FakeChild] = []
        self.by_row: dict[str, list[FakeChild]] = {}
        self.broker = kwargs.pop("broker", FakeBroker())
        self.preparer = kwargs.pop("preparer", FakePreparer(tmp))
        self.obeys_shutdown = kwargs.pop("obeys_shutdown", True)
        self.creds = TemporalCredentials(address="addr:7233", namespace="ns", api_key="key-1")
        self.supervisor = WorkflowWorkerSupervisor(
            broker=self.broker,  # type: ignore[arg-type]
            preparer=self.preparer,  # type: ignore[arg-type]
            credentials=lambda: self.creds,
            tenant_task_queue=TENANT_QUEUE,
            api_base_url="https://api.invalid",
            spawn=self._spawn,
            backoff_base_seconds=0.01,
            backoff_max_seconds=0.05,
            stop_grace_seconds=0.05,
            **kwargs,
        )

    async def _spawn(self, prepared: PreparedWorkflow) -> FakeChild:
        child = FakeChild(obeys_shutdown=self.obeys_shutdown)
        self.children.append(child)
        self.by_row.setdefault(prepared.workflow_id, []).append(child)
        return child

    async def settle(self, until: Any = None, timeout: float = 2.0) -> None:
        """Yield to the loop until ``until()`` holds (or a few ticks pass)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            await asyncio.sleep(0.005)
            if until is None or until() or loop.time() > deadline:
                return


async def test_starts_one_worker_per_served_row_with_a_full_start_line(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1"), _row("a1", kind="automation")])
    await h.settle(lambda: h.children and h.children[0].stdin.lines)

    assert list(h.by_row) == ["w1"]  # the Automation gets no worker
    start = h.children[0].stdin.lines[0]
    assert start == {
        "type": "start",
        "address": "addr:7233",
        "namespace": "ns",
        "apiKey": "key-1",
        "runtimeToken": "vnd_w1",
        "apiBaseUrl": "https://api.invalid",
        "entryPoint": "lifecycle.workflow:Lifecycle",
        "taskQueue": f"{TENANT_QUEUE}-wfl-lifecycle",
        "deploymentName": "lifecycle",
        "buildId": "1" * 64,
    }
    assert workflow_task_queue(TENANT_QUEUE, "lifecycle") == start["taskQueue"]
    assert h.supervisor.served_ids == ["w1"]
    # The artifact dir is pinned for the worker's whole life.
    assert h.preparer.in_use == {"w1": 1}
    await h.supervisor.drain_all()


async def test_reconcile_is_idempotent_for_a_live_worker(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.children)
    await h.supervisor.reconcile([_row("w1", open_executions=2)])
    await h.settle()
    assert len(h.children) == 1
    await h.supervisor.drain_all()


async def test_a_row_dropped_from_the_listing_is_drained(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    v1 = _row("w1", open_executions=1)
    v2 = _row("w2", created_at="2026-06-02T00:00:00.000Z")
    await h.supervisor.reconcile([v1, v2])
    await h.settle(lambda: len(h.children) == 2)

    # v1's last execution closed: only the newest row is still served.
    await h.supervisor.reconcile([dataclasses.replace(v1, open_executions=0), v2])
    v1_child = h.by_row["w1"][0]
    assert v1_child.stdin.lines[-1] == {"type": "shutdown"}
    assert v1_child.returncode == 0
    assert v1_child.signals == []
    assert h.supervisor.served_ids == ["w2"]
    assert h.preparer.in_use["w1"] == 0
    await h.supervisor.drain_all()


async def test_cap_serves_rows_with_open_executions_first(tmp_path: Path) -> None:
    h = Harness(tmp_path, max_workers=1)
    old_open = _row("w1", open_executions=1)
    newest = _row("w2", created_at="2026-06-02T00:00:00.000Z")
    await h.supervisor.reconcile([old_open, newest])
    await h.settle(lambda: h.children)
    assert list(h.by_row) == ["w1"]
    await h.supervisor.drain_all()


async def test_a_crashed_worker_is_restarted_with_its_grant_reused(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.children)
    h.children[0].exit(3)
    await h.settle(lambda: len(h.children) == 2)
    assert len(h.children) == 2
    assert h.children[1].stdin.lines[0]["type"] == "start"
    assert h.broker.grants == ["w1"]  # the vnd_ token doesn't expire
    await h.supervisor.drain_all()


async def test_rotated_key_is_pushed_to_every_live_worker(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1"), _row("w2", name="other")])
    await h.settle(lambda: len(h.children) == 2 and all(c.stdin.lines for c in h.children))
    fresh = TemporalCredentials(address="addr:7233", namespace="ns", api_key="key-2")
    h.creds = fresh
    await h.supervisor.push_credentials(fresh)
    for child in h.children:
        assert child.stdin.lines[-1] == {"type": "credentials", "apiKey": "key-2"}
    # A worker restarted after the rotation starts on the new key.
    h.by_row["w1"][0].exit(1)
    await h.settle(lambda: len(h.by_row["w1"]) == 2 and h.by_row["w1"][1].stdin.lines)
    assert h.by_row["w1"][1].stdin.lines[0]["apiKey"] == "key-2"
    await h.supervisor.drain_all()


async def test_unavailable_grant_backs_off_instead_of_spinning(tmp_path: Path) -> None:
    clock = [0.0]
    h = Harness(tmp_path, broker=FakeBroker(unavailable={"w1"}), clock=lambda: clock[0])
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.broker.grants)
    await h.settle()
    await h.supervisor.reconcile([_row("w1")])  # still inside the backoff
    await h.settle()
    assert h.broker.grants == ["w1"]
    assert h.children == []
    clock[0] += 1.0
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: len(h.broker.grants) == 2)
    assert h.broker.grants == ["w1", "w1"]


async def test_a_worker_ignoring_shutdown_is_terminated(tmp_path: Path) -> None:
    h = Harness(tmp_path, obeys_shutdown=False)
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.children and h.children[0].stdin.lines)
    await h.supervisor.drain_all()
    assert h.children[0].signals == ["TERM"]
    assert h.supervisor.served_ids == []


async def test_an_automation_row_is_never_served_as_a_workflow(tmp_path: Path) -> None:
    """The listing says workflow but the prepared row disagrees: refuse."""
    h = Harness(tmp_path, preparer=FakePreparer(tmp_path, kind="automation"))
    await h.supervisor.reconcile([_row("w1")])
    await h.settle()
    await h.settle()
    assert h.children == []
    assert h.broker.grants == []


@pytest.mark.parametrize("stream", ["stdout", "stderr"])
async def test_worker_output_is_logged_truncated(
    tmp_path: Path, stream: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="pegasus_tenant_runner")
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.children)
    getattr(h.children[0], stream).feed_data(b"x" * 5000 + b"\n")
    await h.settle(
        lambda: any(r.getMessage() == "runner.workflow_worker_output" for r in caplog.records)
    )
    record = next(r for r in caplog.records if r.getMessage() == "runner.workflow_worker_output")
    assert record.stream == stream  # type: ignore[attr-defined]
    assert len(record.line) == 2000  # type: ignore[attr-defined]
    await h.supervisor.drain_all()


async def test_worker_output_is_rate_limited(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="pegasus_tenant_runner")
    h = Harness(tmp_path)
    await h.supervisor.reconcile([_row("w1")])
    await h.settle(lambda: h.children)
    child = h.children[0]
    child.stdout.feed_data(b"spam\n" * 500)
    child.exit(0)
    await h.settle(
        lambda: any(
            r.getMessage() == "runner.workflow_worker_output_suppressed" for r in caplog.records
        )
    )
    logged = [r for r in caplog.records if r.getMessage() == "runner.workflow_worker_output"]
    suppressed = next(
        r for r in caplog.records if r.getMessage() == "runner.workflow_worker_output_suppressed"
    )
    assert len(logged) == 120
    assert suppressed.lines == 380  # type: ignore[attr-defined]
    await h.supervisor.drain_all()
