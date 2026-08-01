"""Unit tests for _resolve_quote_id in send_quote_followup.workflow.

These tests exercise the pure helper directly — no Temporal worker context,
no activity execution, no I/O. The helper is module-level (not a method) so
it can be imported and called in plain pytest without spinning up a worker.
"""

from __future__ import annotations

from send_quote_followup.workflow import _resolve_quote_id

# ---------------------------------------------------------------------------
# EVENT envelope (trigger-fired) — highest priority
# ---------------------------------------------------------------------------


def test_event_envelope_returns_quote_id() -> None:
    """A full quote.accepted event envelope resolves to its quoteId."""
    envelope = {
        "domainEventId": "e1",
        "eventType": "quote.accepted",
        "occurredAt": "2026-01-01T00:00:00Z",
        "payload": {"quoteId": "q-123", "moveId": "m-1"},
    }
    assert _resolve_quote_id(envelope) == "q-123"


def test_event_envelope_takes_precedence_over_manual_run() -> None:
    """When both payload.quoteId and input.quote_id are present, EVENT wins."""
    envelope = {
        "domainEventId": "e2",
        "eventType": "quote.accepted",
        "occurredAt": "2026-01-01T00:00:00Z",
        "payload": {"quoteId": "q-from-event", "moveId": "m-1"},
        # A contrived dict that also has a manual-run key — should be ignored.
        "input": {"quote_id": "q-from-manual"},
    }
    assert _resolve_quote_id(envelope) == "q-from-event"


# ---------------------------------------------------------------------------
# Manual run — POST /api/v1/workflows/:id/run
# ---------------------------------------------------------------------------


def test_manual_run_returns_quote_id() -> None:
    """A manual-run payload resolves to its input.quote_id."""
    manual = {"executionId": "x1", "input": {"quote_id": "q-9"}}
    assert _resolve_quote_id(manual) == "q-9"


# ---------------------------------------------------------------------------
# Raw string (CLI test mode)
# ---------------------------------------------------------------------------


def test_raw_string_passthrough() -> None:
    """A raw string is returned as-is."""
    assert _resolve_quote_id("q-7") == "q-7"


# ---------------------------------------------------------------------------
# Fallback — quote-unknown
# ---------------------------------------------------------------------------


def test_empty_dict_falls_back() -> None:
    assert _resolve_quote_id({}) == "quote-unknown"


def test_payload_key_present_but_empty_dict_falls_back() -> None:
    """payload.quoteId absent → should fall through to quote-unknown."""
    assert _resolve_quote_id({"payload": {}}) == "quote-unknown"


def test_event_envelope_missing_quote_id_falls_back() -> None:
    """payload present but quoteId missing → quote-unknown."""
    envelope = {
        "domainEventId": "e3",
        "eventType": "quote.accepted",
        "occurredAt": "2026-01-01T00:00:00Z",
        "payload": {"moveId": "m-1"},  # quoteId absent
    }
    assert _resolve_quote_id(envelope) == "quote-unknown"


def test_manual_run_missing_quote_id_falls_back() -> None:
    """input present but quote_id missing → quote-unknown."""
    assert _resolve_quote_id({"executionId": "x2", "input": {}}) == "quote-unknown"
