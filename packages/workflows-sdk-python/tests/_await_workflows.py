"""Durable Workflows exercising await_task, for tests/test_await_task.py.

Its own module (Temporal + pegasus_workflows only) so the Workflow sandbox can
import it: the test module itself imports httpx and pytest.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from pegasus_workflows import (
    TaskAwaitRefused,
    TaskAwaitTimeout,
    await_task,
    pegasus_workflow,
    workflow,
)


@pegasus_workflow(name="await_one", version="1.0.0")
class AwaitOne:
    """Awaits one task; reports a timeout or a refusal instead of failing."""

    @workflow.run
    async def run(self, args: dict[str, Any]) -> dict[str, Any]:
        timeout = args.get("timeoutSeconds")
        if args.get("sleepFirstSeconds"):
            await workflow.sleep(args["sleepFirstSeconds"])
        try:
            task = await await_task(
                args["taskId"],
                timeout=timedelta(seconds=timeout) if timeout is not None else None,
            )
        except TaskAwaitTimeout as err:
            return {"timedOut": err.task_id}
        except TaskAwaitRefused as err:
            return {"refused": err.code, "taskId": err.task_id}
        # Awaiting the same task again returns the same result, without waiting.
        again = await await_task(args["taskId"])
        return {"task": task, "same": again == task}


@pegasus_workflow(name="await_many", version="1.0.0")
class AwaitMany:
    """Awaits several tasks concurrently."""

    @workflow.run
    async def run(self, task_ids: list[str]) -> list[dict[str, Any]]:
        return list(await asyncio.gather(*(await_task(t) for t in task_ids)))
