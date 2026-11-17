"""A cancelled Automation run stops its tenant code — against a REAL dev server.

The proxy workflow and its activity are the production ones; only the executor
is a stub, which takes a moment to clean up after it sees the cancel. Before
the fix, the activity never heartbeated, so the cancel never reached it, and
``TRY_CANCEL`` closed the workflow CANCELLED at once while tenant code ran on.
Now the workflow closes only after the executor has seen the cancel and
finished cleaning up.

Skips when the dev server can't start (offline), except in CI, which sets
``PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER=1``, where that fails.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import pytest
from temporalio.client import WorkflowFailureError
from temporalio.exceptions import CancelledError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from pegasus_tenant_runner import proxy as proxy_module
from pegasus_tenant_runner.idle import IdleTracker
from pegasus_tenant_runner.proxy import TenantProxyWorkflow, build_registrations


class _CancelAwareExecutor:
    """Runs "tenant code" that sleeps; on cancel, cleans up for 0.5 s."""

    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cleaned_up = False

    async def run_entry_point(self, workflow_name: str, payload: Any) -> Any:
        self.started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            await asyncio.sleep(0.5)
            self.cleaned_up = True
            raise
        return "finished"


@pytest.fixture
async def env() -> AsyncIterator[WorkflowEnvironment]:
    try:
        environment = await WorkflowEnvironment.start_local()
    except Exception as exc:  # pragma: no cover — environment-specific
        if os.environ.get("PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER") == "1":
            pytest.fail(f"local Temporal dev server required but unavailable: {exc}")
        pytest.skip(f"local Temporal dev server unavailable: {exc}")
    try:
        yield environment
    finally:
        await environment.shutdown()


async def test_cancelling_the_run_reaches_tenant_code_before_the_workflow_closes(
    env: WorkflowEnvironment, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Shorter than production (5 s / 20 s) so the cancel arrives in ~1 s.
    monkeypatch.setattr(proxy_module, "HEARTBEAT_INTERVAL_SECONDS", 0.2)
    monkeypatch.setattr(proxy_module, "ACTIVITY_HEARTBEAT_TIMEOUT", timedelta(seconds=1))
    executor = _CancelAwareExecutor()
    regs = build_registrations(
        executor=executor,  # type: ignore[arg-type]
        idle_tracker=IdleTracker(600),
        execution_timeout_seconds=900,
    )
    queue = f"proxy-cancel-{uuid.uuid4().hex[:8]}"
    async with Worker(
        env.client,
        task_queue=queue,
        workflows=regs.workflow_classes,
        activities=regs.activities,
    ):
        handle = await env.client.start_workflow(
            "some_tenant_automation",  # any name: the proxy is dynamic
            {"executionId": "e1", "input": {}, "dryRun": False},
            id=f"wf/t/some_tenant_automation/{uuid.uuid4()}",
            task_queue=queue,
        )
        await asyncio.wait_for(executor.started.wait(), timeout=30)
        await handle.cancel()
        with pytest.raises(WorkflowFailureError) as exc_info:
            await asyncio.wait_for(handle.result(), timeout=30)
        assert isinstance(exc_info.value.cause, CancelledError)
        # WAIT_CANCELLATION_COMPLETED: the workflow closed only after the
        # tenant side saw the cancel and finished stopping.
        assert executor.cleaned_up
    assert TenantProxyWorkflow  # the production proxy, not a test double
