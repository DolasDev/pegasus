"""Tests for PegasusClient.notify (0.67.0)."""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def test_notify_posts_the_camelcase_body_and_returns_data() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(200, json={"data": {"recipients": 3, "notified": 3, "pushed": 1}})

    out = _client_with(handler).notify(
        "Weights are in",
        "Order 4242 has its weight ticket.",
        to_emails="coord@nwmovers.test",
        to_roles=["long_distance_dispatch"],
        order_num=4242,
        dedup_key="wt-4242",
    )
    assert captured["path"] == "/api/v1/notifications/notify"
    assert captured["json"] == {
        "title": "Weights are in",
        "body": "Order 4242 has its weight ticket.",
        "toEmails": ["coord@nwmovers.test"],
        "toRoles": ["long_distance_dispatch"],
        "orderNum": "4242",
        "dedupKey": "wt-4242",
    }
    assert out == {"recipients": 3, "notified": 3, "pushed": 1}


def test_notify_unknown_recipient_raises_with_code() -> None:
    client = _client_with(
        lambda r: httpx.Response(400, json={"error": "x", "code": "UNKNOWN_RECIPIENT"})
    )
    with pytest.raises(PegasusApiError) as err:
        client.notify("t", "b", to_emails="nobody@nwmovers.test")
    assert (err.value.status_code, err.value.code) == (400, "UNKNOWN_RECIPIENT")


def test_notify_dry_run_captures_without_network() -> None:
    client = PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        dry_run=True,
        transport=httpx.MockTransport(lambda r: pytest.fail("dry-run must not call the API")),
    )
    assert client.notify("t", "b", to_roles="driver")["dryRun"] is True
    assert client.captured[-1]["capability"] == "NotifyUsers"
