"""Send a follow-up reminder for a quote that has not yet been accepted.

A trivial-but-real curated workflow. It demonstrates the canonical shape of
a Pegasus workflow:

* the workflow body stays deterministic and just orchestrates;
* an ``@activity.defn`` does the side-effecting work (here, composing the
  follow-up message — in a real deployment it would call the Pegasus API
  via :class:`pegasus_workflows.PegasusClient`).

Args contract (Phase 2 Unit 6, see plans/in-progress/workflows-phase2-…):

  The server-side ``POST /api/v1/workflows/:id/run`` endpoint starts the
  Temporal workflow with a single positional dict argument of the shape
  ``{"executionId": <uuid>, "input": <user-supplied dict>}``. The
  ``executionId`` is used by the worker's activity infrastructure (broker
  fetch + status PATCH); workflow business logic should read from
  ``input``.

  ``pegasus-workflows test send_quote_followup`` (Phase 1 local-dev flow)
  starts the workflow with a raw positional string for backwards compat —
  the ``run()`` signature accepts both shapes.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from pegasus_workflows import activity, pegasus_workflow, workflow


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

        Accepts either:

        * a server-side payload ``{"executionId": str, "input": {...}}`` from
          ``POST /api/v1/workflows/:id/run`` — reads ``input.quote_id``;
        * a raw ``quote_id`` string from ``pegasus-workflows test`` (local
          dev parity).

        Returns the composed follow-up message.
        """
        if isinstance(payload, dict):
            inner = payload.get("input") or {}
            quote_id = str(inner.get("quote_id", "quote-unknown"))
        else:
            quote_id = payload
        return await workflow.execute_activity(
            compose_followup,
            quote_id,
            start_to_close_timeout=timedelta(seconds=10),
        )
