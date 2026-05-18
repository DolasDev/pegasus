"""Tests for the ``@pegasus_workflow`` decorator and re-exports.

Temporal's ``@workflow.run`` rejects classes defined inside functions, so the
sample workflows used here are declared at module scope.
"""

from __future__ import annotations

import pegasus_workflows
from pegasus_workflows import WORKFLOW_META_ATTR, pegasus_workflow, workflow


@pegasus_workflow(name="demo", version="1.2.3", description="d")
class DescribedWorkflow:
    """Module-level workflow with a description, for metadata assertions."""

    @workflow.run
    async def run(self) -> str:
        return "ok"


@pegasus_workflow(name="demo2", version="0.1.0")
class PlainWorkflow:
    """Module-level workflow without a description."""

    @workflow.run
    async def run(self) -> str:
        return "ok"


def test_reexports_temporal_primitives() -> None:
    from temporalio import activity as t_activity
    from temporalio import workflow as t_workflow

    assert pegasus_workflows.workflow is t_workflow
    assert pegasus_workflows.activity is t_activity


def test_decorator_stashes_metadata() -> None:
    meta = getattr(DescribedWorkflow, WORKFLOW_META_ATTR)
    assert meta == {"name": "demo", "version": "1.2.3", "description": "d"}


def test_decorator_defaults_description_to_none() -> None:
    meta = getattr(PlainWorkflow, WORKFLOW_META_ATTR)
    assert meta == {"name": "demo2", "version": "0.1.0", "description": None}


def test_decorator_registers_temporal_definition() -> None:
    # temporalio.workflow.defn attaches its definition marker.
    assert hasattr(PlainWorkflow, "__temporal_workflow_definition")
