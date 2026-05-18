"""Scaffolded "hello" workflow.

A minimal but real Temporal workflow: it runs one activity and returns the
result. Replace the body with your automation; the activity is where you
call the Pegasus API (see :class:`pegasus_workflows.PegasusClient`).
"""

from __future__ import annotations

from datetime import timedelta

from pegasus_workflows import activity, pegasus_workflow, workflow


@activity.defn
async def greet(name: str) -> str:
    """Return a greeting for *name*.

    Activities are where side effects live — HTTP calls, DB reads, etc.
    Workflow code itself must stay deterministic.
    """
    return f"Hello, {name}, from your Pegasus workflow!"


@pegasus_workflow(name="__WORKFLOW_NAME__", version="0.1.0")
class HelloWorkflow:
    """Toy workflow that greets the supplied name."""

    @workflow.run
    async def run(self, name: str = "world") -> str:
        """Execute the workflow and return the greeting."""
        return await workflow.execute_activity(
            greet,
            name,
            start_to_close_timeout=timedelta(seconds=10),
        )
