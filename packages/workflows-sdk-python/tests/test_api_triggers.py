"""Tests for the workflow-trigger client methods (sdk-feedback/0023).

Uses ``httpx.MockTransport`` so the client exercises real request building
(path, method, body) without a live server.
"""

from __future__ import annotations

import json

import httpx

from pegasus_workflows.api import PegasusClient

_TOKEN = "vnd_" + "a" * 48


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="http://api.test", token=_TOKEN, transport=httpx.MockTransport(handler)
    )


def test_create_trigger_schedule() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["json"] = json.loads(request.read())
        return httpx.Response(
            201,
            json={"data": {"id": "trg-1", "kind": "SCHEDULE", "cronExpression": "*/5 * * * *"}},
        )

    client = _client_with(handler)
    row = client.create_trigger("wf-1", kind="SCHEDULE", cron_expression="*/5 * * * *")

    assert row["id"] == "trg-1"
    assert captured["path"] == "/api/v1/workflows/wf-1/triggers"
    assert captured["method"] == "POST"
    assert captured["json"] == {
        "kind": "SCHEDULE",
        "enabled": True,
        "cronExpression": "*/5 * * * *",
    }


def test_create_trigger_disabled_omits_optional_fields() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        return httpx.Response(201, json={"data": {"id": "trg-2"}})

    client = _client_with(handler)
    client.create_trigger("wf-1", kind="SCHEDULE", cron_expression="0 0 * * *", enabled=False)

    assert captured["json"] == {"kind": "SCHEDULE", "enabled": False, "cronExpression": "0 0 * * *"}
    assert "eventType" not in captured["json"]
    assert "filter" not in captured["json"]


def test_list_triggers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/workflows/wf-1/triggers"
        assert request.method == "GET"
        return httpx.Response(200, json={"data": [{"id": "trg-1", "kind": "SCHEDULE"}]})

    client = _client_with(handler)
    rows = client.list_triggers("wf-1")
    assert rows == [{"id": "trg-1", "kind": "SCHEDULE"}]


def test_delete_trigger() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        return httpx.Response(204)

    client = _client_with(handler)
    client.delete_trigger("wf-1", "trg-1")
    assert captured["path"] == "/api/v1/workflows/wf-1/triggers/trg-1"
    assert captured["method"] == "DELETE"
