"""Send a follow-up reminder for a quote that has not yet been accepted.

A trivial-but-real curated workflow. It demonstrates the canonical shape of
a Pegasus workflow:

* the workflow body stays deterministic and just orchestrates;
* an ``@activity.defn`` does the side-effecting work (here, composing the
  follow-up message — in a real deployment it would call the Pegasus API
  via :class:`pegasus_workflows.PegasusClient`).

Phase 1 has no server-side execution, so this runs only via
``pegasus-workflows test send_quote_followup``. It exists to exercise the
upload path end-to-end and to give tenants a worked example.
"""

from __future__ import annotations

from datetime import timedelta

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
    async def run(self, quote_id: str = "quote-unknown") -> str:
        """Run the follow-up workflow for *quote_id*.

        Returns the composed follow-up message.
        """
        return await workflow.execute_activity(
            compose_followup,
            quote_id,
            start_to_close_timeout=timedelta(seconds=10),
        )
