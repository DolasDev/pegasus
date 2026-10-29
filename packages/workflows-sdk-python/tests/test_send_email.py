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


def test_check_email_recipients_posts_to_and_cc_and_returns_the_verdict() -> None:
    captured: dict = {}
    verdict = {"ok": False, "reason": "RECIPIENT_NOT_ALLOWED", "disallowed": ["x@gmail.test"]}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(200, json={"data": verdict})

    out = _client_with(handler).check_email_recipients("x@gmail.test", cc=["a@nwmovers.test"])
    assert captured["path"] == "/api/v1/email/check-recipients"
    assert captured["json"] == {"to": "x@gmail.test", "cc": ["a@nwmovers.test"]}
    assert out == verdict


def test_check_email_recipients_runs_live_under_dry_run() -> None:
    # A check performs nothing, so a dry run still asks the server and captures nothing.
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"data": {"ok": True, "reason": None, "disallowed": []}})

    client = PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        dry_run=True,
        transport=httpx.MockTransport(handler),
    )
    assert client.check_email_recipients("a@nwmovers.test")["ok"] is True
    assert calls == ["/api/v1/email/check-recipients"]
    assert client.captured == []


def test_check_email_recipients_is_a_fake_client_read() -> None:
    from pegasus_workflows.testing import fake_client

    verdict = {"ok": True, "reason": None, "disallowed": []}
    fake = fake_client(reads={"check_email_recipients": verdict})
    assert fake.check_email_recipients("a@nwmovers.test") == verdict
    assert fake.captured == []
