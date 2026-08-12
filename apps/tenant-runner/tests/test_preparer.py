"""Per-execution row resolution — the sdk-feedback 0034 fix.

These are the properties the defect violated: the bytes served are the ones the
execution's own published row points at, a row published after the runner
started is installable, several versions coexist, and nothing is ever silently
substituted.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.broker_client import ExecutableWorkflow
from pegasus_tenant_runner.preparer import WorkflowNotAvailableError, WorkflowPreparer


def _row(
    wid: str, *, name: str = "wf", version: str = "1.0.0", created_at: str
) -> ExecutableWorkflow:
    return ExecutableWorkflow(
        id=wid,
        name=name,
        version=version,
        entry_points=(f"{name}.workflow:Wf",),
        artifact_sha256="a" * 64,
        artifact_size_bytes=None,
        download_url="https://s3.invalid/artifact.zip",
        created_at=created_at,
    )


class StubBroker:
    def __init__(self, rows: list[ExecutableWorkflow]) -> None:
        self.rows = rows
        self.list_calls = 0

    def list_executable_workflows(self) -> list[ExecutableWorkflow]:
        self.list_calls += 1
        return list(self.rows)


def _prepared(wf: ExecutableWorkflow, work_root: Path) -> PreparedWorkflow:
    row_dir = work_root / wf.name / wf.id
    (row_dir / "src").mkdir(parents=True, exist_ok=True)
    (row_dir / "scratch").mkdir(parents=True, exist_ok=True)
    return PreparedWorkflow(
        workflow_id=wf.id,
        name=wf.name,
        version=wf.version,
        entry_point=wf.entry_points[0],
        src_dir=row_dir / "src",
        python_bin=row_dir / "venv" / "bin" / "python",
        scratch_dir=row_dir / "scratch",
    )


def _preparer(
    broker: StubBroker,
    tmp_path: Path,
    monkeypatch: Any,
    *,
    max_prepared: int = 32,
    on_prepare: Any = None,
) -> tuple[WorkflowPreparer, list[str]]:
    """A preparer whose install step is stubbed — the real one is covered by
    test_artifacts; what matters here is WHICH row gets installed, and when."""
    installed: list[str] = []

    def fake_prepare(work_root: Path, wf: ExecutableWorkflow, **_kw: Any) -> PreparedWorkflow:
        installed.append(wf.id)
        if on_prepare is not None:
            on_prepare()
        return _prepared(wf, work_root)

    monkeypatch.setattr("pegasus_tenant_runner.preparer.prepare_workflow", fake_prepare)
    return (
        WorkflowPreparer(
            broker=broker,  # type: ignore[arg-type]
            work_root=tmp_path,
            max_unpacked_bytes=1024,
            max_prepared=max_prepared,
        ),
        installed,
    )


async def test_seeded_row_is_served_without_listing(tmp_path: Path, monkeypatch: Any) -> None:
    row = _row("id-1", created_at="2026-01-01T00:00:00Z")
    broker = StubBroker([row])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)
    preparer.seed([_prepared(row, tmp_path)])

    async with preparer.use(workflow_id="id-1", workflow_name="wf") as (prepared, how):
        assert prepared.workflow_id == "id-1"
        assert how == "id"
    assert broker.list_calls == 0
    assert installed == []


async def test_row_published_after_startup_is_installed_on_demand(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """THE defect: a version published while the task is warm used to be
    unreachable for the task's whole life."""
    old = _row("id-1", version="0.6.1", created_at="2026-01-01T00:00:00Z")
    new = _row("id-2", version="0.6.2", created_at="2026-01-02T00:00:00Z")
    broker = StubBroker([old, new])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)
    preparer.seed([_prepared(old, tmp_path)])  # what startup had warmed

    async with preparer.use(workflow_id="id-2", workflow_name="wf") as (prepared, how):
        assert (prepared.workflow_id, prepared.version, how) == ("id-2", "0.6.2", "id")
    assert installed == ["id-2"]
    # …and the older row is still installed, so an in-flight run of it is safe.
    assert set(preparer.prepared_ids) == {"id-1", "id-2"}


async def test_an_older_version_is_honored_over_the_latest(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """`run name@0.6.1` on a runner that knows 0.6.2 must execute 0.6.1 — the
    memo used to be populated from select_latest, so `@version` was a lie."""
    old = _row("id-1", version="0.6.1", created_at="2026-01-01T00:00:00Z")
    new = _row("id-2", version="0.6.2", created_at="2026-01-02T00:00:00Z")
    broker = StubBroker([old, new])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)
    preparer.seed([_prepared(new, tmp_path)])

    async with preparer.use(workflow_id="id-1", workflow_name="wf") as (prepared, _how):
        assert prepared.version == "0.6.1"
    assert installed == ["id-1"]


async def test_unknown_row_raises_instead_of_substituting(
    tmp_path: Path, monkeypatch: Any
) -> None:
    row = _row("id-1", created_at="2026-01-01T00:00:00Z")
    broker = StubBroker([row])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)
    preparer.seed([_prepared(row, tmp_path)])

    with pytest.raises(WorkflowNotAvailableError, match="id-missing"):
        async with preparer.use(workflow_id="id-missing", workflow_name="wf"):
            pass
    assert installed == []


async def test_legacy_fallback_resolves_the_latest_freshly(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """No workflow id (an API older than 0034): resolve latest-by-name from a
    FRESH listing — never from what startup happened to warm."""
    old = _row("id-1", version="0.6.1", created_at="2026-01-01T00:00:00Z")
    new = _row("id-2", version="0.6.2", created_at="2026-01-02T00:00:00Z")
    broker = StubBroker([old, new])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)
    preparer.seed([_prepared(old, tmp_path)])  # the stale warm-up

    async with preparer.use(workflow_id=None, workflow_name="wf") as (prepared, how):
        assert (prepared.version, how) == ("0.6.2", "name")
    assert broker.list_calls == 1
    assert installed == ["id-2"]


async def test_unknown_name_on_the_legacy_path_raises(
    tmp_path: Path, monkeypatch: Any
) -> None:
    broker = StubBroker([])
    preparer, _installed = _preparer(broker, tmp_path, monkeypatch)
    with pytest.raises(WorkflowNotAvailableError, match="ghost"):
        async with preparer.use(workflow_id=None, workflow_name="ghost"):
            pass


async def test_concurrent_misses_on_one_row_install_once(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """Single-flight: the tenant cap allows 5 concurrent executions, so two
    first-runs of a freshly published row race by default."""
    row = _row("id-1", created_at="2026-01-01T00:00:00Z")
    broker = StubBroker([row])
    preparer, installed = _preparer(broker, tmp_path, monkeypatch)

    async def run_one() -> str:
        async with preparer.use(workflow_id="id-1", workflow_name="wf") as (p, _how):
            await asyncio.sleep(0)
            return p.workflow_id

    results = await asyncio.gather(run_one(), run_one(), run_one())
    assert results == ["id-1", "id-1", "id-1"]
    assert installed == ["id-1"]  # exactly one install
    assert broker.list_calls == 1  # and exactly one listing


async def test_eviction_drops_idle_rows_over_the_cap(
    tmp_path: Path, monkeypatch: Any
) -> None:
    rows = [_row(f"id-{i}", created_at=f"2026-01-0{i}T00:00:00Z") for i in range(1, 4)]
    broker = StubBroker(rows)
    preparer, _installed = _preparer(broker, tmp_path, monkeypatch, max_prepared=2)

    for row in rows:
        async with preparer.use(workflow_id=row.id, workflow_name="wf"):
            pass

    assert len(preparer.prepared_ids) == 2
    assert "id-1" not in preparer.prepared_ids  # oldest idle row evicted
    # Its install directory went with it.
    assert not (tmp_path / "wf" / "id-1").exists()


async def test_eviction_never_touches_a_row_that_is_executing(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """A pinned row's directory must survive: a subprocess is running out of
    it, and rmtree'ing under a live execution is the failure mode the per-id
    layout exists to prevent."""
    rows = [_row(f"id-{i}", created_at=f"2026-01-0{i}T00:00:00Z") for i in range(1, 4)]
    broker = StubBroker(rows)
    preparer, _installed = _preparer(broker, tmp_path, monkeypatch, max_prepared=1)

    async with preparer.use(workflow_id="id-1", workflow_name="wf"):
        # id-1 is pinned while the other two are prepared over the cap.
        async with preparer.use(workflow_id="id-2", workflow_name="wf"):
            pass
        async with preparer.use(workflow_id="id-3", workflow_name="wf"):
            pass
        assert "id-1" in preparer.prepared_ids
        assert (tmp_path / "wf" / "id-1").exists()


async def test_a_row_never_evicts_itself_on_install(
    tmp_path: Path, monkeypatch: Any
) -> None:
    """With every other entry pinned, the row just installed is the only
    eviction candidate — and evicting it would hand back a directory that no
    longer exists."""
    rows = [_row(f"id-{i}", created_at=f"2026-01-0{i}T00:00:00Z") for i in range(1, 3)]
    broker = StubBroker(rows)
    preparer, _installed = _preparer(broker, tmp_path, monkeypatch, max_prepared=1)

    async with preparer.use(workflow_id="id-1", workflow_name="wf"):
        async with preparer.use(workflow_id="id-2", workflow_name="wf") as (p, _how):
            assert p.src_dir.exists()
            assert "id-2" in preparer.prepared_ids
