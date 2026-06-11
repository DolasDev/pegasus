"""Proxy manufacturing + registration wiring."""

from __future__ import annotations

from typing import Any

import pytest

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.idle import IdleTracker
from pegasus_tenant_runner.proxy import (
    ACTIVITY_NAME,
    build_registrations,
    make_proxy_workflow,
)


def _prepared(name: str, tmp_path: Any) -> PreparedWorkflow:
    return PreparedWorkflow(
        name=name,
        version="1.0.0",
        entry_point=f"{name}.workflow:Wf",
        src_dir=tmp_path / name / "src",
        python_bin=tmp_path / name / "venv" / "bin" / "python",
        scratch_dir=tmp_path / name / "scratch",
    )


def test_proxy_registers_under_the_tenant_workflow_name() -> None:
    """The registered Temporal name must equal the workflow row's name —
    that exact string is what the API's run path starts."""
    cls = make_proxy_workflow("my_workflow")
    defn = cls.__temporal_workflow_definition  # type: ignore[attr-defined]
    assert defn.name == "my_workflow"
    assert defn.sandboxed is False


def test_proxy_names_may_contain_hyphens() -> None:
    cls = make_proxy_workflow("my-workflow-2")
    defn = cls.__temporal_workflow_definition  # type: ignore[attr-defined]
    assert defn.name == "my-workflow-2"
    assert cls.__name__ == "TenantProxy_my_workflow_2"


def test_proxies_are_distinct_classes() -> None:
    a = make_proxy_workflow("alpha")
    b = make_proxy_workflow("beta")
    assert a is not b
    assert a.__temporal_workflow_definition.name == "alpha"  # type: ignore[attr-defined]
    assert b.__temporal_workflow_definition.name == "beta"  # type: ignore[attr-defined]


class _StubExecutor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        self.calls.append((workflow_name, payload))
        return {"ran": workflow_name}


class _FailingExecutor:
    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        raise RuntimeError("boom")


def test_build_registrations_produces_classes_and_activity(tmp_path: Any) -> None:
    prepared = [_prepared("alpha", tmp_path), _prepared("beta", tmp_path)]
    regs = build_registrations(
        prepared,
        executor=_StubExecutor(),  # type: ignore[arg-type]
        idle_tracker=IdleTracker(600),
        execution_timeout_seconds=900,
    )
    names = {
        c.__temporal_workflow_definition.name  # type: ignore[attr-defined]
        for c in regs.workflow_classes
    }
    assert names == {"alpha", "beta"}
    assert len(regs.activities) == 1
    defn = regs.activities[0].__temporal_activity_definition  # type: ignore[attr-defined]
    assert defn.name == ACTIVITY_NAME


async def test_activity_routes_to_executor_and_feeds_idle_tracker(tmp_path: Any) -> None:
    executor = _StubExecutor()
    tracker = IdleTracker(600, clock=lambda: 0.0)
    regs = build_registrations(
        [_prepared("alpha", tmp_path)],
        executor=executor,  # type: ignore[arg-type]
        idle_tracker=tracker,
        execution_timeout_seconds=900,
    )
    activity_fn = regs.activities[0]
    result = await activity_fn({"workflow_name": "alpha", "payload": {"executionId": "e1"}})
    assert result == {"ran": "alpha"}
    assert executor.calls == [("alpha", {"executionId": "e1"})]
    assert tracker.in_flight == 0  # started + finished


async def test_activity_decrements_in_flight_on_failure(tmp_path: Any) -> None:
    tracker = IdleTracker(600, clock=lambda: 0.0)
    regs = build_registrations(
        [_prepared("alpha", tmp_path)],
        executor=_FailingExecutor(),  # type: ignore[arg-type]
        idle_tracker=tracker,
        execution_timeout_seconds=900,
    )
    with pytest.raises(RuntimeError, match="boom"):
        await regs.activities[0]({"workflow_name": "alpha", "payload": None})
    assert tracker.in_flight == 0
