"""Send a follow-up reminder for a quote that has not yet been accepted.

A trivial-but-real curated workflow. It demonstrates the canonical shape of
a Pegasus workflow:

* the workflow body stays deterministic and just orchestrates;
* an ``@activity.defn`` does the side-effecting work (here, composing the
  follow-up message — in a real deployment it would call the Pegasus API
  via :class:`pegasus_workflows.PegasusClient`).

Args contract (three supported shapes):

1. **EVENT envelope** — when fired by a domain-event trigger (e.g.
   ``quote.accepted``), the dispatcher starts the execution with the workflow's
   ``run()`` argument set to the full event envelope::

       {
           "domainEventId": "<uuid>",
           "eventType": "quote.accepted",
           "occurredAt": "<ISO-8601>",
           "payload": {"quoteId": "<id>", "moveId": "<id>"}
       }

   The quote id is at ``arg["payload"]["quoteId"]`` (camelCase). Workflows
   receiving an event envelope should read ``arg["payload"]`` for entity ids
   and re-fetch authoritative state via the API rather than trusting the
   snapshot.

2. **Manual run** — ``POST /api/v1/workflows/:id/run`` starts the execution
   with ``{"executionId": "<uuid>", "input": {"quote_id": "<id>"}}``. The
   quote id is at ``arg["input"]["quote_id"]`` (snake_case).

3. **CLI test** — ``pegasus-workflows test send_quote_followup`` passes a raw
   positional string as the argument for local-dev parity.

Resolution order: EVENT envelope → manual run → raw string → ``"quote-unknown"``.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from pegasus_workflows import activity, pegasus_workflow, workflow


def _resolve_quote_id(payload: dict[str, Any] | str) -> str:
    """Resolve the quote id from any of the real input shapes.

    Resolution order (first match wins):

    1. EVENT envelope: ``payload["payload"]["quoteId"]``
    2. Manual run: ``payload["input"]["quote_id"]``
    3. Raw string passthrough (CLI test mode).
    4. Fallback: ``"quote-unknown"``.
    """
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        # EVENT envelope: {domainEventId, eventType, occurredAt, payload: {quoteId, moveId}}
        event_payload = payload.get("payload")
        if isinstance(event_payload, dict) and event_payload.get("quoteId"):
            return str(event_payload["quoteId"])
        # Manual run: {executionId, input: {quote_id}}
        inner = payload.get("input")
        if isinstance(inner, dict) and inner.get("quote_id"):
            return str(inner["quote_id"])
    return "quote-unknown"


@activity.defn
async def compose_followup(quote_id: str) -> str:
    """Compose a follow-up message for *quote_id*.

    In a production workflow this activity would read the quote and customer
    from the Pegasus API and dispatch an email. Kept side-effect-free here so
    the workflow runs against a stub during ``pegasus-workflows test``.
    """
    return (
        f"Hi! Just following up on quote {quote_id} — "
        "let us know if you have any questions about your move."
    )


@pegasus_workflow(
    name="send_quote_followup",
    version="0.1.0",
    description="Follow up on a quote that has not been accepted.",
)
class SendQuoteFollowup:
    """Compose and (eventually) send a quote follow-up."""

    @workflow.run
    async def run(self, payload: dict[str, Any] | str = "quote-unknown") -> str:
        """Run the follow-up workflow.

        Accepts any of the three input shapes described in the module docstring
        (EVENT envelope, manual run, raw string). Resolution is delegated to
        :func:`_resolve_quote_id` which can be unit-tested without a Temporal
        worker context.

        Returns the composed follow-up message.
        """
        quote_id = _resolve_quote_id(payload)
        return await workflow.execute_activity(
            compose_followup,
            quote_id,
            start_to_close_timeout=timedelta(seconds=10),
        )
