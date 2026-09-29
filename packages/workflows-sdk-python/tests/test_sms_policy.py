"""Tests for the SMS read/opt-out/dedup surface of PegasusClient (0.40.0)."""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test", token="vnd_test", transport=httpx.MockTransport(handler)
    )


def test_send_sms_without_key_keeps_the_original_payload() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        data = {"id": 1, "status": "Queued", "alreadySent": False}
        return httpx.Response(202, json={"data": data})

    _client_with(handler).send_sms("+15551234567", "hi")
    assert captured["json"] == {"to": "+15551234567", "body": "hi"}


def test_send_sms_forwards_dedup_key_and_returns_replays() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        data = {"id": "987", "status": "Delivered", "alreadySent": True}
        return httpx.Response(200, json={"data": data})

    out = _client_with(handler).send_sms("+15551234567", "hi", dedup_key="pulse:1:pack:ack")
    assert captured["json"]["dedupKey"] == "pulse:1:pack:ack"
    assert out["data"]["alreadySent"] is True


def test_send_sms_opted_out_raises_with_code() -> None:
    client = _client_with(
        lambda r: httpx.Response(409, json={"error": "opted out", "code": "SMS_OPTED_OUT"})
    )
    with pytest.raises(PegasusApiError) as err:
        client.send_sms("+15551234567", "hi")
    assert (err.value.status_code, err.value.code) == (409, "SMS_OPTED_OUT")


def test_get_text_message_returns_data_and_none_on_miss() -> None:
    row = {"id": "m-1", "externalId": "4455", "body": "5", "bodyPurged": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/m-1"):
            return httpx.Response(200, json={"data": row})
        return httpx.Response(404, json={"code": "NOT_FOUND"})

    client = _client_with(handler)
    assert client.get_text_message("m-1") == row
    assert client.get_text_message("m-2") is None


def test_get_sms_opt_out_reads_state() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/sms/opt-outs/+15551234567"
        return httpx.Response(200, json={"data": {"phone": "+15551234567", "optedOut": True}})

    assert _client_with(handler).get_sms_opt_out("+15551234567")["optedOut"] is True


def test_record_sms_opt_out_posts_and_dry_run_captures() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        return httpx.Response(200, json={"data": {"phone": "+15551234567", "optedOut": False}})

    _client_with(handler).record_sms_opt_out("+15551234567", opted_out=False)
    assert captured["json"] == {"phone": "+15551234567", "optedOut": False, "source": "MANUAL"}

    dry = PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        dry_run=True,
        transport=httpx.MockTransport(lambda r: pytest.fail("dry-run must not call the API")),
    )
    dry.record_sms_opt_out("+15551234567")
    assert dry.captured[-1]["capability"] == "ManageSmsOptOut"
