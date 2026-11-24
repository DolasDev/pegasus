"""await_task() — a durable Workflow waits for a task to close (0.69.0).

Two layers:

- the register activity, through Temporal's ActivityEnvironment against a
  mocked platform API (httpx.MockTransport);
- the Workflow side, end to end on a local Temporal dev server with the
  testing harness's stand-ins (staged_task_await / close_staged_task), plus a
  replay of each history to prove the helper is deterministic. Skipped when no
  dev server can start, unless PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER=1.
"""

from __future__ import annotations

import asyncio
import dataclasses
import functools
import json
import os
import subprocess
import sys
import uuid
from typing import Any

import httpx
import pytest
from temporalio.testing import ActivityEnvironment, WorkflowEnvironment
from temporalio.worker import Replayer, Worker

import pegasus_workflows
from pegasus_workflows import tasks
from pegasus_workflows.api import PegasusApiError, PegasusClient
from pegasus_workflows.manifest import ManifestError, _validate_handler_names
from pegasus_workflows.testing import close_staged_task, staged_task_await

from ._await_workflows import AwaitMany, AwaitOne

RUN_ID = "wfl/t-1/order_lifecycle/o-1"


def _sync(fn):
    """Run an async test on a fresh event loop (no pytest async plugin here)."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))

    return wrapper


def _task(task_id: str = "4242", status: str = "open", **extra: Any) -> dict[str, Any]:
    return {"id": task_id, "status": status, "store": "legacy", "reason": None, **extra}


# ---------------------------------------------------------------------------
# The register activity
# ---------------------------------------------------------------------------


def _client_answering(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return response

    client = PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )
    monkeypatch.setattr(tasks, "_runtime_client", lambda: client)
    return seen


def _env() -> ActivityEnvironment:
    env = ActivityEnvironment()
    env.info = dataclasses.replace(env.info, workflow_id=RUN_ID, workflow_run_id="run-1")
    return env


@_sync
async def test_register_posts_the_run_and_returns_the_task(monkeypatch) -> None:
    seen = _client_answering(
        monkeypatch, httpx.Response(200, json={"data": {**_task(), "awaiting": True}})
    )

    result = await _env().run(tasks.await_task_register_activity, {"taskId": "4242"})

    assert result == {**_task(), "awaiting": True}
    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/api/v1/pegii/tasks/4242/await"
    assert json.loads(seen[0].content) == {"temporalWorkflowId": RUN_ID}


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (404, "TASK_NOT_FOUND"),
        (404, "EXECUTION_NOT_OPEN"),
        (403, "AWAIT_CALLER_NOT_WORKFLOW"),
        (400, "VALIDATION_ERROR"),
        # 503s that never clear mid-run are refusals, not retried forever.
        (503, "PEGII_API_NOT_CONFIGURED"),
        (503, "PEGII_CAPABILITY_MISSING"),
    ],
)
@_sync
async def test_a_refusal_is_final(monkeypatch, status: int, code: str) -> None:
    _client_answering(monkeypatch, httpx.Response(status, json={"error": "no", "code": code}))

    with pytest.raises(tasks.TaskAwaitRefused) as caught:
        await _env().run(tasks.await_task_register_activity, {"taskId": "4242"})

    err = caught.value
    assert (err.code, err.task_id, err.non_retryable) == (code, "4242", True)
    assert err.type == tasks.TASK_AWAIT_REFUSED_TYPE


@pytest.mark.parametrize("status", [429, 502, 503])
@_sync
async def test_a_transient_failure_is_retried_by_temporal(monkeypatch, status: int) -> None:
    _client_answering(
        monkeypatch,
        httpx.Response(status, json={"error": "down", "code": "PEGII_SOURCE_UNAVAILABLE"}),
    )
    with pytest.raises(PegasusApiError) as caught:
        await _env().run(tasks.await_task_register_activity, {"taskId": "4242"})
    assert not isinstance(caught.value, tasks.TaskAwaitRefused)


def test_refused_round_trips_through_its_failure_details() -> None:
    sent = tasks.TaskAwaitRefused("x", task_id="9", code="TASK_NOT_FOUND", error_message="gone")
    rebuilt = tasks.TaskAwaitRefused._from_failure(sent)
    assert (rebuilt.task_id, rebuilt.code, rebuilt.error_message) == ("9", "TASK_NOT_FOUND", "gone")


# ---------------------------------------------------------------------------
# Exports, built-ins, sandbox safety, reserved names
# ---------------------------------------------------------------------------


def test_exports_and_names() -> None:
    assert pegasus_workflows.await_task is tasks.await_task
    assert pegasus_workflows.TaskAwaitTimeout is tasks.TaskAwaitTimeout
    assert pegasus_workflows.TaskAwaitRefused is tasks.TaskAwaitRefused
    defn = tasks.await_task_register_activity.__temporal_activity_definition  # type: ignore[attr-defined]
    assert defn.name == tasks.AWAIT_TASK_REGISTER_ACTIVITY == "pegasus.await_task_register"
    assert tasks.TASK_CLOSED_SIGNAL == "pegasus.task_closed"


def test_importing_await_task_does_not_import_httpx() -> None:
    # The Workflow sandbox restricts httpx; a fresh interpreter proves the
    # workflow-side import path stays clean.
    code = (
        "import sys; from pegasus_workflows import await_task, TaskAwaitTimeout, TaskAwaitRefused; "
        "print('httpx' in sys.modules)"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False"


@pytest.mark.parametrize("name", ["pegasus.task_closed", "PEGASUS.anything", "pegasus."])
def test_a_manifest_may_not_declare_a_reserved_signal(name: str) -> None:
    with pytest.raises(ManifestError, match="reserved for the platform"):
        _validate_handler_names(["proceed", name], "signals", "signal")


def test_an_ordinary_signal_name_is_still_fine() -> None:
    _validate_handler_names(["proceed", "pegasus_like_but_fine"], "signals", "signal")


# ---------------------------------------------------------------------------
# The Workflow side, on a local Temporal dev server
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def dev_server() -> Any:
    loop = asyncio.new_event_loop()
    try:
        env = loop.run_until_complete(WorkflowEnvironment.start_local())
    except Exception as exc:  # pragma: no cover — environment-specific
        loop.close()
        if os.environ.get("PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER") == "1":
            pytest.fail(f"local Temporal dev server required but unavailable: {exc}")
        pytest.skip(f"local Temporal dev server unavailable: {exc}")
    yield loop, env
    loop.run_until_complete(env.shutdown())
    loop.close()


async def _run(
    env: WorkflowEnvironment,
    workflow_cls: Any,
    arg: Any,
    fake: Any,
    drive: Any = None,
) -> Any:
    """Run ``workflow_cls(arg)`` against ``fake`` (a staged_task_await activity).

    ``drive(handle)`` plays the platform while it runs. Replays the history
    afterwards to prove the helper is deterministic.
    """
    queue = f"await-{uuid.uuid4()}"
    async with Worker(
        env.client, task_queue=queue, workflows=[AwaitOne, AwaitMany], activities=[fake]
    ):
        handle = await env.client.start_workflow(
            workflow_cls.run, arg, id=f"wf-{uuid.uuid4()}", task_queue=queue
        )
        if drive is not None:
            await drive(handle)
        result = await asyncio.wait_for(handle.result(), timeout=60)
        history = await handle.fetch_history()
    await Replayer(workflows=[AwaitOne, AwaitMany]).replay_workflow(history)
    return result


async def _until_awaited(fake: Any, *task_ids: str) -> None:
    """Wait until the register activity has seen every id (the wait is registered)."""
    for _ in range(600):
        if all(t in fake.awaited for t in task_ids):
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"never awaited {task_ids}; saw {fake.awaited}")


def test_an_already_closed_task_returns_at_once(dev_server) -> None:
    loop, env = dev_server
    staged = {"4242": _task(status="closed", reason="done in MoveManager")}
    fake = staged_task_await(staged)

    result = loop.run_until_complete(_run(env, AwaitOne, {"taskId": "4242"}, fake))

    assert result["task"] == staged["4242"]  # no `awaiting` key leaks through
    assert result["same"] is True
    assert fake.awaited == ["4242"]  # the second await_task didn't call the platform


def test_an_open_task_returns_when_the_platform_signals_its_close(dev_server) -> None:
    loop, env = dev_server
    staged = {"4242": _task()}
    fake = staged_task_await(staged)

    async def drive(handle: Any) -> None:
        await _until_awaited(fake, "4242")
        await close_staged_task(handle, staged["4242"], reason="Customer confirmed")

    result = loop.run_until_complete(_run(env, AwaitOne, {"taskId": "4242"}, fake, drive))

    assert result["task"]["status"] == "closed"
    assert result["task"]["reason"] == "Customer confirmed"
    assert result["same"] is True


def test_a_close_signalled_before_the_wait_is_not_lost(dev_server) -> None:
    # The Workflow sleeps before awaiting; the close arrives during the sleep,
    # before any handler exists. Temporal buffers it until await_task installs one.
    loop, env = dev_server
    staged = {"4242": _task()}
    fake = staged_task_await(staged)

    async def drive(handle: Any) -> None:
        await close_staged_task(handle, staged["4242"], reason="early")

    result = loop.run_until_complete(
        _run(env, AwaitOne, {"taskId": "4242", "sleepFirstSeconds": 2}, fake, drive)
    )
    assert result["task"]["reason"] == "early"


def test_several_tasks_awaited_concurrently(dev_server) -> None:
    loop, env = dev_server
    staged = {"1": _task("1"), "2": _task("2"), "3": _task("3", status="closed", reason="r3")}
    fake = staged_task_await(staged)

    async def drive(handle: Any) -> None:
        await _until_awaited(fake, "1", "2")
        await close_staged_task(handle, staged["2"], reason="r2")  # out of order
        await close_staged_task(handle, staged["1"], reason="r1")

    result = loop.run_until_complete(_run(env, AwaitMany, ["1", "2", "3"], fake, drive))

    assert [t["reason"] for t in result] == ["r1", "r2", "r3"]


def test_a_timeout_raises_task_await_timeout(dev_server) -> None:
    loop, env = dev_server
    fake = staged_task_await({"4242": _task()})
    result = loop.run_until_complete(
        _run(env, AwaitOne, {"taskId": "4242", "timeoutSeconds": 2}, fake)
    )
    assert result == {"timedOut": "4242"}


def test_an_unknown_task_is_refused(dev_server) -> None:
    loop, env = dev_server
    result = loop.run_until_complete(
        _run(env, AwaitOne, {"taskId": "nope"}, staged_task_await({}))
    )
    assert result == {"refused": "TASK_NOT_FOUND", "taskId": "nope"}
