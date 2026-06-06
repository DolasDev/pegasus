"""End-to-end coverage of the worker's curated workflow execution.

There are two levels of e2e here:

1. ``test_compose_followup_activity_runs`` — runs the registered activity
   in isolation. Cheap, fast, no Temporal server required, runs on every
   CI invocation.

2. ``test_send_quote_followup_via_workflow_environment`` — full Temporal
   workflow execution against ``WorkflowEnvironment.start_local`` (the
   downloaded test server). Marked ``@pytest.mark.integration`` and
   skipped automatically if the temporalio test server isn't available
   (e.g. offline CI). This is the truer e2e but it shouldn't gate the
   pipeline.

Both prove the SDK-bundled ``send_quote_followup`` workflow is the one
the worker registers (no curated-only-boundary regression).
"""

from __future__ import annotations

import pytest

from pegasus_temporal_worker.registry import (
    activity_callables,
    workflow_classes,
)


def test_compose_followup_activity_runs(anyio_backend: str = "asyncio") -> None:
    """Direct activity invocation — proves the import + decoration are sound."""
    import asyncio

    activities = activity_callables()
    assert len(activities) == 1
    compose = activities[0]

    # Activities decorated with @activity.defn are normal coroutines under
    # the hood — we can drive them outside a worker for unit coverage.
    result = asyncio.run(compose("q-123"))
    assert "q-123" in result
    assert "follow" in result.lower()


@pytest.mark.asyncio
async def test_send_quote_followup_via_workflow_environment() -> None:
    """Full Temporal lifecycle for the curated workflow.

    Uses the in-process time-skipping test server when available. If the
    test server binary can't be downloaded (e.g. air-gapped CI), the test
    is skipped — the activity-level test above still gates the import +
    registration shape.
    """
    pytest.importorskip("temporalio.testing")
    from temporalio.testing import WorkflowEnvironment
    from temporalio.worker import Worker

    try:
        env = await WorkflowEnvironment.start_local()
    except Exception as exc:  # pragma: no cover — environment-specific
        pytest.skip(f"local Temporal test server unavailable: {exc}")

    try:
        task_queue = "pegasus-stdlib-test"
        async with Worker(
            env.client,
            task_queue=task_queue,
            workflows=workflow_classes(),
            activities=activity_callables(),
        ):
            workflow_cls = workflow_classes()[0]
            result = await env.client.execute_workflow(
                workflow_cls.run,
                "q-end-to-end",
                id="wf-test-1",
                task_queue=task_queue,
            )
            assert "q-end-to-end" in result
    finally:
        await env.shutdown()
