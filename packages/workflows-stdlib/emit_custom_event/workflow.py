"""Emit a tenant-defined custom event — the workflow-to-workflow chaining demo.

When a built-in ``quote.accepted`` event fires this workflow, it emits a
tenant-defined custom event (``crm.quote_won`` by default) carrying the quote
and move ids. Any *other* workflow whose EVENT trigger subscribes to that custom
name then runs in turn — this is how a tenant chains workflows together: a
platform event fans out into tenant-specific events that drive tenant-specific
automation.

The emit itself is a side effect, so it lives in an ``@activity.defn`` that takes
an optional :class:`pegasus_workflows.PegasusClient`. Under
``pegasus-workflows test`` (and in unit tests) no client is supplied and the
activity just returns the event it *would* emit, keeping the curated lane
runnable without live credentials — the same convention as ``send_quote_followup``.

In a real deployment the runtime injects a client and the activity calls
``client.emit_event(name, payload)``. The workflow's manifest declares
``required_actions = ["EmitTenantEvent"]`` so the runtime token is authorized.

Args contract: the EVENT envelope the dispatcher passes — the quote id is at
``arg["payload"]["quoteId"]`` and the move id at ``arg["payload"]["moveId"]``.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from pegasus_workflows import PegasusClient, activity, pegasus_workflow, workflow

#: The tenant-defined custom event this workflow emits. A tenant registers this
#: name in the event-type registry and points another workflow's trigger at it.
CUSTOM_EVENT_NAME = "crm.quote_won"


def _resolve_ids(payload: dict[str, Any] | str) -> dict[str, str]:
    """Pull the quote/move ids out of the EVENT envelope (defensive)."""
    if isinstance(payload, dict):
        event_payload = payload.get("payload")
        if isinstance(event_payload, dict):
            return {
                "quoteId": str(event_payload.get("quoteId", "quote-unknown")),
                "moveId": str(event_payload.get("moveId", "move-unknown")),
            }
    return {"quoteId": "quote-unknown", "moveId": "move-unknown"}


@activity.defn
async def emit_quote_won(ids: dict[str, str], client: PegasusClient | None = None) -> dict[str, Any]:
    """Emit the custom ``crm.quote_won`` event for *ids*.

    When *client* is None (CLI test / unit test) this returns the event payload
    without performing any I/O. With a client it calls
    ``client.emit_event(CUSTOM_EVENT_NAME, ids)`` and returns the API response.
    """
    if client is None:
        return {"emitted": False, "eventType": CUSTOM_EVENT_NAME, "payload": ids}
    return client.emit_event(CUSTOM_EVENT_NAME, ids)


@pegasus_workflow(
    name="emit_custom_event",
    version="0.1.0",
    description="Emit a tenant-defined custom event when a quote is accepted.",
)
class EmitCustomEvent:
    """Translate a built-in ``quote.accepted`` event into a tenant custom event."""

    @workflow.run
    async def run(self, payload: dict[str, Any] | str = "") -> dict[str, Any]:
        """Resolve the entity ids and emit the custom event."""
        ids = _resolve_ids(payload)
        return await workflow.execute_activity(
            emit_quote_won,
            ids,
            start_to_close_timeout=timedelta(seconds=10),
        )
