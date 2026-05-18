"""Pegasus Workflows SDK.

Authoring surface for Pegasus workflows. Re-exports the Temporal authoring
primitives (``workflow`` and ``activity``) so workflow authors only ever
import from :mod:`pegasus_workflows`, and adds the :func:`pegasus_workflow`
decorator which stashes ``(name, version)`` metadata used by the CLI's
``package`` step and the ``pegasus-workflows.toml`` manifest.

Example
-------
.. code-block:: python

    from pegasus_workflows import pegasus_workflow, workflow

    @pegasus_workflow(name="send_quote_followup", version="0.1.0")
    class SendQuoteFollowup:
        @workflow.run
        async def run(self, quote_id: str) -> str:
            return f"followed up on {quote_id}"
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from temporalio import activity, workflow

from .api import PegasusApiError, PegasusClient
from .manifest import Manifest, ManifestError, load_manifest

__all__ = [
    "activity",
    "workflow",
    "pegasus_workflow",
    "PegasusClient",
    "PegasusApiError",
    "Manifest",
    "ManifestError",
    "load_manifest",
    "WORKFLOW_META_ATTR",
]

#: Attribute name under which :func:`pegasus_workflow` stores its metadata
#: dict on the decorated class.
WORKFLOW_META_ATTR = "__pegasus_workflow__"

_T = TypeVar("_T")


def pegasus_workflow(
    *, name: str, version: str, description: str | None = None
) -> Callable[[_T], _T]:
    """Mark a class as a Pegasus workflow.

    Wraps :func:`temporalio.workflow.defn` so the class is a valid Temporal
    workflow definition, and records ``(name, version, description)`` on the
    class under :data:`WORKFLOW_META_ATTR`. The CLI reads this metadata for
    introspection; the authoritative manifest still lives in
    ``pegasus-workflows.toml``.

    Args:
        name: Workflow name. Must match ``^[a-z0-9][a-z0-9_-]{0,63}$``.
        version: Semantic version, e.g. ``1.2.3`` or ``1.2.3-beta.1``.
        description: Optional human-readable description.

    Returns:
        A decorator that returns the (Temporal-registered) class unchanged.
    """

    def decorator(cls: _T) -> _T:
        defined: Any = workflow.defn(cls)  # type: ignore[arg-type]
        setattr(
            defined,
            WORKFLOW_META_ATTR,
            {"name": name, "version": version, "description": description},
        )
        return defined  # type: ignore[return-value]

    return decorator
