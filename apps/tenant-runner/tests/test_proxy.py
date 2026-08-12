"""Dynamic proxy registration + activity wiring."""

from __future__ import annotations

from typing import Any

import pytest

from pegasus_tenant_runner.idle import IdleTracker
from pegasus_tenant_runner.proxy import (
    ACTIVITY_NAME,
    TenantProxyWorkflow,
    build_registrations,
    decode_dynamic_payload,
)


def test_proxy_is_registered_dynamic_and_unsandboxed() -> None:
    """One catch-all definition, so a workflow name published AFTER this task
    started still reaches the executor (sdk-feedback 0034) instead of going
    unanswered until the execution times out."""
    defn = TenantProxyWorkflow.__temporal_workflow_definition  # type: ignore[attr-defined]
    assert defn.name is None  # Temporal marks a dynamic definition with no name
    assert defn.sandboxed is False


class _StubRawValue:
    """Stands in for temporalio's RawValue — only `.payload` is read."""

    def __init__(self, payload: Any) -> None:
        self.payload = payload


class _StubConverter:
    def __init__(self) -> None:
        self.seen: list[Any] = []

    def from_payload(self, payload: Any) -> Any:
        self.seen.append(payload)
        return {"decoded": payload}


def test_decode_dynamic_payload_converts_the_first_arg(monkeypatch: Any) -> None:
    """A dynamic workflow receives RawValues, so the envelope must be converted
    explicitly — and it is the RawValue's `.payload` that gets converted."""
    converter = _StubConverter()
    monkeypatch.setattr(
        "pegasus_tenant_runner.proxy.workflow.payload_converter", lambda: converter
    )
    assert decode_dynamic_payload([_StubRawValue("raw-0"), _StubRawValue("raw-1")]) == {
        "decoded": "raw-0"
    }
    assert converter.seen == ["raw-0"]


def test_decode_dynamic_payload_tolerates_no_arguments(monkeypatch: Any) -> None:
    """A no-argument start must not raise inside workflow code — the executor
    reports the missing execution id with a real message instead."""
    monkeypatch.setattr(
        "pegasus_tenant_runner.proxy.workflow.payload_converter", lambda: _StubConverter()
    )
    assert decode_dynamic_payload([]) is None


class _StubExecutor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        self.calls.append((workflow_name, payload))
        return {"ran": workflow_name}


class _FailingExecutor:
    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        raise RuntimeError("boom")


def test_build_registrations_produces_the_dynamic_proxy_and_activity() -> None:
    regs = build_registrations(
        executor=_StubExecutor(),  # type: ignore[arg-type]
        idle_tracker=IdleTracker(600),
        execution_timeout_seconds=900,
    )
    assert regs.workflow_classes == [TenantProxyWorkflow]
    assert len(regs.activities) == 1
    defn = regs.activities[0].__temporal_activity_definition  # type: ignore[attr-defined]
    assert defn.name == ACTIVITY_NAME


async def test_activity_routes_to_executor_and_feeds_idle_tracker() -> None:
    executor = _StubExecutor()
    tracker = IdleTracker(600, clock=lambda: 0.0)
    regs = build_registrations(
        executor=executor,  # type: ignore[arg-type]
        idle_tracker=tracker,
        execution_timeout_seconds=900,
    )
    activity_fn = regs.activities[0]
    result = await activity_fn({"workflow_name": "alpha", "payload": {"executionId": "e1"}})
    assert result == {"ran": "alpha"}
    assert executor.calls == [("alpha", {"executionId": "e1"})]
    assert tracker.in_flight == 0  # started + finished


async def test_activity_decrements_in_flight_on_failure() -> None:
    tracker = IdleTracker(600, clock=lambda: 0.0)
    regs = build_registrations(
        executor=_FailingExecutor(),  # type: ignore[arg-type]
        idle_tracker=tracker,
        execution_timeout_seconds=900,
    )
    with pytest.raises(RuntimeError, match="boom"):
        await regs.activities[0]({"workflow_name": "alpha", "payload": None})
    assert tracker.in_flight == 0
