"""Curated-only boundary: known workflows pass; unknown ones raise."""

from __future__ import annotations

import pytest

from pegasus_temporal_worker import registry


def test_send_quote_followup_is_registered() -> None:
    reg = registry.get_workflow("send_quote_followup")
    assert reg.name == "send_quote_followup"
    # Identity check is meaningful: registry returns the exact decorated
    # class (not a wrapper).
    from send_quote_followup.workflow import SendQuoteFollowup

    assert reg.workflow_cls is SendQuoteFollowup


def test_unknown_workflow_raises_unknown_workflow_error() -> None:
    with pytest.raises(registry.UnknownWorkflowError):
        registry.get_workflow("tenant_uploaded_malware")


def test_get_registrations_lists_only_curated() -> None:
    regs = registry.get_registrations()
    names = {r.name for r in regs}
    # Curated-only boundary: Phase 2 Unit 5 ships exactly one workflow.
    assert names == {"send_quote_followup"}


def test_workflow_classes_helper_returns_decorated_classes() -> None:
    classes = registry.workflow_classes()
    # The Temporal decorator stashes a `__temporal_workflow_definition`
    # attribute on the class — proves we have a properly-decorated class
    # and not a bare Python class.
    assert all(hasattr(c, "__temporal_workflow_definition") for c in classes)


def test_activity_callables_dedupes_by_identity() -> None:
    # Sanity: there's exactly one activity (compose_followup) right now;
    # the dedupe matters once a second workflow shares it.
    callables = registry.activity_callables()
    assert len(callables) == 1
    # Each entry must be a callable with the temporalio activity marker.
    assert all(hasattr(c, "__temporal_activity_definition") for c in callables)
