"""Unit tests for the emit_custom_event curated workflow.

Exercises the pure helper ``_resolve_ids`` and the ``emit_quote_won`` activity
in its no-client (test) mode — no Temporal worker, no live API. The activity's
client-backed path is covered by the SDK's own ``emit_event`` tests.
"""

from __future__ import annotations

import asyncio

from emit_custom_event.workflow import (
    CUSTOM_EVENT_NAME,
    _resolve_ids,
    emit_quote_won,
)


def test_resolve_ids_from_event_envelope() -> None:
    envelope = {
        "domainEventId": "e1",
        "eventType": "quote.accepted",
        "occurredAt": "2026-01-01T00:00:00Z",
        "payload": {"quoteId": "q-123", "moveId": "m-9"},
    }
    assert _resolve_ids(envelope) == {"quoteId": "q-123", "moveId": "m-9"}


def test_resolve_ids_missing_payload_falls_back() -> None:
    assert _resolve_ids({}) == {"quoteId": "quote-unknown", "moveId": "move-unknown"}
    assert _resolve_ids("raw") == {"quoteId": "quote-unknown", "moveId": "move-unknown"}


def test_emit_activity_without_client_returns_payload() -> None:
    """No client (CLI/unit test) → no I/O, returns the would-be event."""
    ids = {"quoteId": "q-1", "moveId": "m-1"}
    result = asyncio.run(emit_quote_won(ids))
    assert result == {"emitted": False, "eventType": CUSTOM_EVENT_NAME, "payload": ids}
