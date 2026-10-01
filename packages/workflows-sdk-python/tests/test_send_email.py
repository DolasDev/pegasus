"""Tests for PegasusClient.send_email (0.42.0)."""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def test_send_email_posts_the_camelcase_body_and_returns_data() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(202, json={"data": {"id": "e-1", "alreadySent": False}})

    out = _client_with(handler).send_email(
        ["coord@nwmovers.test"], "Subject", "Body", cc=["lead@nwmovers.test"], dedup_key="k1"
    )
    assert captured["path"] == "/api/v1/email/send"
    assert captured["json"] == {
        "to": ["coord@nwmovers.test"],
        "subject": "Subject",
        "body": "Body",
        "bodyType": "text",
        "cc": ["lead@nwmovers.test"],
        "dedupKey": "k1",
    }
    assert out == {"id": "e-1", "alreadySent": False}


def test_send_email_refused_recipient_raises_with_code() -> None:
    client = _client_with(
        lambda r: httpx.Response(400, json={"error": "x", "code": "RECIPIENT_NOT_ALLOWED"})
    )
    with pytest.raises(PegasusApiError) as err:
        client.send_email("someone@gmail.test", "s", "b")
    assert (err.value.status_code, err.value.code) == (400, "RECIPIENT_NOT_ALLOWED")


def test_send_email_dry_run_captures_without_network() -> None:
    client = PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        dry_run=True,
        transport=httpx.MockTransport(lambda r: pytest.fail("dry-run must not call the API")),
    )
    assert client.send_email("a@nwmovers.test", "s", "b")["dryRun"] is True
    assert client.captured[-1]["capability"] == "SendEmail"
