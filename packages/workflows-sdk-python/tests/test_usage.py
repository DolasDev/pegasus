"""Tests for PegasusClient.get_usage_summary.

Uses ``httpx.MockTransport`` so the client exercises real request building and
response parsing, without a live API.
"""

from __future__ import annotations

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient
from pegasus_workflows.testing import fake_client

PATH = "/api/v1/usage/summary"

SUMMARY = {
    "plan": {"planCode": "SCALE", "name": "Scale", "annualPoolActions": 50000},
    "termStart": "2026-10-01",
    "termEnd": "2027-10-01",
    "pool": 50000,
    "usedTermToDate": 412,
    "remaining": 49588,
    "overageActions": 0,
    "projectedAtTermEnd": 5013,
    "asOf": "2026-11-15",
    "byMonth": [{"month": "2026-10", "actions": 412}],
    "byAction": [{"action": "SendSms", "actions": 412}],
    "byWorkflow": [{"workflowId": "wf-1", "workflowName": "nw_pulse", "actions": 412}],
}


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        transport=httpx.MockTransport(handler),
    )


def test_get_usage_summary_defaults_to_the_current_term() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == PATH
        assert "year" not in request.url.params
        return httpx.Response(200, json={"data": SUMMARY})

    assert _client_with(handler).get_usage_summary() == SUMMARY


def test_get_usage_summary_passes_year() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["year"] == "2026"
        return httpx.Response(200, json={"data": SUMMARY})

    assert _client_with(handler).get_usage_summary(year=2026) == SUMMARY


def test_get_usage_summary_forbidden_raises() -> None:
    client = _client_with(lambda r: httpx.Response(403, json={"code": "FORBIDDEN"}))
    with pytest.raises(PegasusApiError) as err:
        client.get_usage_summary()
    assert err.value.status_code == 403


def test_harness_serves_usage_summary_from_a_fixture_and_captures_nothing() -> None:
    client = fake_client(reads={"get_usage_summary": SUMMARY})
    assert client.get_usage_summary() == SUMMARY
    assert client.captured == []
