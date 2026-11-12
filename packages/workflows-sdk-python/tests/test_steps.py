"""run_automation() — a durable Workflow running an Automation as a step (0.65.0).

The activity is driven through Temporal's ActivityEnvironment against a mocked
platform API (httpx.MockTransport), so heartbeats and cancellation are real.
"""

from __future__ import annotations

import asyncio
import dataclasses
import functools
import json
import subprocess
import sys
from typing import Any

import httpx
import pytest
from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment

import pegasus_workflows
from pegasus_workflows import steps
from pegasus_workflows.api import PegasusApiError, PegasusClient

PARENT = "wfl/t-1/order_lifecycle/o-1"


def _sync(fn):
    """Run an async test on a fresh event loop (no pytest async plugin here)."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))

    return wrapper


def _execution(status: str, **extra: Any) -> dict[str, Any]:
    return {"id": "exec-step-1", "status": status, "result": None, "errorMessage": None, **extra}


class FakeApi:
    """Scripted responses per route; records every request."""

    def __init__(self, starts: list[httpx.Response], polls: list[dict[str, Any]] | None = None):
        self.starts = list(starts)
        self.polls = list(polls or [])
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if request.method == "POST" and path == "/api/v1/automation-steps":
            return self.starts.pop(0)
        if request.method == "GET" and path.startswith("/api/v1/automation-steps/"):
            return httpx.Response(200, json={"data": self.polls.pop(0)})
        if request.method == "POST" and path.endswith("/cancel"):
            return httpx.Response(202, json={"data": _execution("RUNNING")})
        raise AssertionError(f"unexpected {request.method} {path}")

    def paths(self) -> list[str]:
        return [f"{r.method} {r.url.path}" for r in self.requests]


def _started(status: int = 201) -> httpx.Response:
    return httpx.Response(status, json={"data": _execution("RUNNING")})


def _refused(status: int, code: str, headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(status, json={"error": code.lower(), "code": code}, headers=headers or {})


@pytest.fixture
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Make the activity's waits instant, recording each one."""
    recorded: list[float] = []

    async def fake_sleep(seconds: float, details: dict[str, Any]) -> None:
        steps.activity.heartbeat(details)
        recorded.append(seconds)
        await asyncio.sleep(0)

    monkeypatch.setattr(steps, "_sleep_heartbeating", fake_sleep)
    return recorded


def _use_api(monkeypatch: pytest.MonkeyPatch, api: FakeApi) -> None:
    client = PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(api)
    )
    monkeypatch.setattr(steps, "_runtime_client", lambda: client)


def _env() -> ActivityEnvironment:
    env = ActivityEnvironment()
    env.info = dataclasses.replace(
        env.info, workflow_id=PARENT, workflow_run_id="run-1", activity_id="7"
    )
    return env


REQUEST = {"automation": "price_order", "version": None, "input": {"orderId": "o-1"}}


@_sync
async def test_starts_the_step_then_returns_its_result(monkeypatch, sleeps) -> None:
    api = FakeApi(
        [_started()],
        [
            _execution("QUEUED"),
            _execution("RUNNING"),
            _execution("COMPLETED", result={"total": 42}),
        ],
    )
    _use_api(monkeypatch, api)

    result = await _env().run(steps.run_automation_activity, REQUEST)

    assert result == {"total": 42}
    body = json.loads(api.requests[0].content)
    assert body == {
        "automation": "price_order",
        "input": {"orderId": "o-1"},
        "parentTemporalWorkflowId": PARENT,
        "parentTemporalRunId": "run-1",
        "activityId": "7",
    }
    assert api.paths().count("GET /api/v1/automation-steps/exec-step-1") == 3
    assert sleeps == [2.0, 3.0]  # poll backoff


@_sync
async def test_pins_a_version_when_given(monkeypatch, sleeps) -> None:
    api = FakeApi([_started()], [_execution("COMPLETED", result=1)])
    _use_api(monkeypatch, api)
    await _env().run(steps.run_automation_activity, {**REQUEST, "version": "0.3.0"})
    assert json.loads(api.requests[0].content)["version"] == "0.3.0"


@_sync
async def test_a_replayed_start_polls_the_existing_step(monkeypatch, sleeps) -> None:
    api = FakeApi([_started(200)], [_execution("COMPLETED", result="done")])
    _use_api(monkeypatch, api)
    assert await _env().run(steps.run_automation_activity, REQUEST) == "done"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (423, "WORKFLOWS_DISABLED"),
        (429, "CONCURRENCY_LIMIT"),
        (429, "DAILY_QUOTA_EXCEEDED"),
        (409, "TENANT_MIGRATING"),
        (409, "TENANT_NAMESPACE_PROVISIONING"),
    ],
)
@_sync
async def test_waits_out_not_now_refusals(monkeypatch, sleeps, status, code) -> None:
    api = FakeApi(
        [_refused(status, code), _refused(status, code), _started()],
        [_execution("COMPLETED", result="ok")],
    )
    _use_api(monkeypatch, api)
    heartbeats: list[Any] = []
    env = _env()
    env.on_heartbeat = lambda *d: heartbeats.append(d)

    assert await env.run(steps.run_automation_activity, REQUEST) == "ok"
    assert api.paths().count("POST /api/v1/automation-steps") == 3
    assert sleeps[:2] == [5.0, 10.0]
    assert ({"automation": "price_order", "waiting": code},) in heartbeats


@_sync
async def test_honours_retry_after(monkeypatch, sleeps) -> None:
    api = FakeApi(
        [_refused(409, "TENANT_MIGRATING", {"Retry-After": "60"}), _started()],
        [_execution("COMPLETED", result=None)],
    )
    _use_api(monkeypatch, api)
    await _env().run(steps.run_automation_activity, REQUEST)
    assert sleeps[0] == 60.0


@_sync
async def test_a_hinted_wait_does_not_grow_the_backoff(monkeypatch, sleeps) -> None:
    api = FakeApi(
        [
            _refused(409, "TENANT_MIGRATING", {"Retry-After": "60"}),
            _refused(423, "WORKFLOWS_DISABLED"),
            _started(),
        ],
        [_execution("COMPLETED", result=None)],
    )
    _use_api(monkeypatch, api)
    await _env().run(steps.run_automation_activity, REQUEST)
    assert sleeps[:2] == [60.0, 5.0]


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (404, "AUTOMATION_NOT_FOUND"),
        (404, "PARENT_NOT_OPEN"),
        (422, "STEP_TARGET_NOT_AUTOMATION"),
        (403, "STEP_CALLER_NOT_WORKFLOW"),
    ],
)
@_sync
async def test_permanent_refusals_fail_the_step_without_retry(
    monkeypatch, sleeps, status, code
) -> None:
    api = FakeApi([_refused(status, code)])
    _use_api(monkeypatch, api)
    with pytest.raises(steps.AutomationStepFailed) as err:
        await _env().run(steps.run_automation_activity, REQUEST)
    assert err.value.non_retryable
    assert (err.value.code, err.value.status, err.value.execution_id) == (code, None, None)


@_sync
async def test_a_server_error_is_left_to_temporal_to_retry(monkeypatch, sleeps) -> None:
    api = FakeApi([_refused(502, "TEMPORAL_START_FAILED")])
    _use_api(monkeypatch, api)
    with pytest.raises(PegasusApiError) as err:
        await _env().run(steps.run_automation_activity, REQUEST)
    assert not isinstance(err.value, ApplicationError)


@pytest.mark.parametrize("status", ["FAILED", "TIMED_OUT", "CANCELLED"])
@_sync
async def test_an_unsuccessful_automation_fails_the_step(monkeypatch, sleeps, status) -> None:
    api = FakeApi([_started()], [_execution(status, errorMessage="boom")])
    _use_api(monkeypatch, api)
    with pytest.raises(steps.AutomationStepFailed) as err:
        await _env().run(steps.run_automation_activity, REQUEST)
    assert (err.value.status, err.value.execution_id, err.value.error_message) == (
        status,
        "exec-step-1",
        "boom",
    )


@_sync
async def test_cancelling_the_activity_cancels_the_automation(monkeypatch) -> None:
    api = FakeApi([_started()], [_execution("RUNNING")] * 100)
    _use_api(monkeypatch, api)
    env = _env()
    polled = asyncio.Event()

    async def slow_sleep(seconds: float, details: dict[str, Any]) -> None:
        polled.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(steps, "_sleep_heartbeating", slow_sleep)
    task = asyncio.ensure_future(env.run(steps.run_automation_activity, REQUEST))
    await polled.wait()
    env.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert api.paths()[-1] == "POST /api/v1/automation-steps/exec-step-1/cancel"


@_sync
async def test_a_worker_shutdown_does_not_cancel_the_automation(monkeypatch) -> None:
    # A draining worker (runner stop) cancels in-flight activities. That is not
    # the Workflow cancelling the step: the Automation must be left alone, and
    # the retried activity resumes polling the same row. (Staging, 2026-11-12:
    # a runner stop cancelled a sleeping step's Automation.)
    api = FakeApi([_started()], [_execution("RUNNING")] * 100)
    _use_api(monkeypatch, api)
    env = _env()
    polled = asyncio.Event()

    async def slow_sleep(seconds: float, details: dict[str, Any]) -> None:
        polled.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(steps, "_sleep_heartbeating", slow_sleep)
    task = asyncio.ensure_future(env.run(steps.run_automation_activity, REQUEST))
    await polled.wait()
    env.worker_shutdown()
    env.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not any(path.endswith("/cancel") for path in api.paths())


def test_step_failed_round_trips_through_the_activity_boundary() -> None:
    original = steps.AutomationStepFailed(
        "ended FAILED",
        automation="price_order",
        execution_id="e-1",
        status="FAILED",
        error_message="boom",
    )
    # What the Workflow receives: a plain ApplicationError carrying type + details.
    received = ApplicationError(original.message, *original.details, type=original.type)
    rebuilt = steps.AutomationStepFailed._from_failure(received)
    assert (rebuilt.automation, rebuilt.execution_id, rebuilt.status, rebuilt.error_message) == (
        "price_order",
        "e-1",
        "FAILED",
        "boom",
    )


def test_exports_and_builtins() -> None:
    assert pegasus_workflows.run_automation is steps.run_automation
    assert pegasus_workflows.AutomationStepFailed is steps.AutomationStepFailed
    assert steps.BUILTIN_ACTIVITIES == [steps.run_automation_activity]
    defn = steps.run_automation_activity.__temporal_activity_definition  # type: ignore[attr-defined]
    assert defn.name == steps.RUN_AUTOMATION_ACTIVITY == "pegasus.run_automation"


def test_importing_the_helper_does_not_import_httpx() -> None:
    # The Workflow sandbox restricts httpx; a fresh interpreter proves the
    # workflow-side import path stays clean.
    code = (
        "import sys; from pegasus_workflows import run_automation, AutomationStepFailed; "
        "print('httpx' in sys.modules)"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False"
