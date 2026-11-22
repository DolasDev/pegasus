"""Custom event types: register / list / get through the SDK and the CLI (0.67.1).

An Automation emits a registered custom event with ``emit_event``; an EVENT
trigger (``mode="START"`` + ``correlation_path``) can then start one durable
Workflow per business key. Registering the type is an operator step, so it is a
``workflow_developer`` (``ManageEventTypes``) call, never a runtime one.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from typer.testing import CliRunner

import pegasus_workflows.cli.event_types as et
from pegasus_workflows.api import PegasusClient

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


def _client_with(handler: Any) -> PegasusClient:
    return PegasusClient(
        base_url="http://api.test", token=_TOKEN, transport=httpx.MockTransport(handler)
    )


# -- SDK ---------------------------------------------------------------------


def test_create_event_type_posts_name_schema_and_description() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"name": "billing.delivery_due", "enabled": True}})

    schema = {"type": "object", "required": ["orderNum"]}
    row = _client_with(handler).create_event_type(
        "billing.delivery_due", payload_schema=schema, description="Delivery date reached"
    )
    assert seen == {
        "method": "POST",
        "path": "/api/v1/event-types",
        "body": {
            "name": "billing.delivery_due",
            "payloadSchema": schema,
            "description": "Delivery date reached",
        },
    }
    assert row["name"] == "billing.delivery_due"


def test_create_event_type_sends_only_the_name_by_default() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"name": "x.y"}})

    _client_with(handler).create_event_type("x.y")
    assert seen["body"] == {"name": "x.y"}


def test_list_and_get_event_types() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/event-types":
            return httpx.Response(200, json={"data": [{"name": "a.b"}, {"name": "c.d"}]})
        assert request.url.path == "/api/v1/event-types/a.b"
        return httpx.Response(200, json={"data": {"name": "a.b", "enabled": True}})

    client = _client_with(handler)
    assert [r["name"] for r in client.list_event_types()] == ["a.b", "c.d"]
    assert client.get_event_type("a.b")["enabled"] is True


def test_update_event_type_patches_only_given_fields() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"name": "a.b", "enabled": False}})

    _client_with(handler).update_event_type("a.b", enabled=False)
    assert seen == {
        "method": "PATCH",
        "path": "/api/v1/event-types/a.b",
        "body": {"enabled": False},
    }


def test_update_event_type_can_clear_the_schema() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"name": "a.b"}})

    _client_with(handler).update_event_type("a.b", payload_schema=None, clear_schema=True)
    assert seen["body"] == {"payloadSchema": None}


def test_delete_event_type() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        return httpx.Response(204)

    assert _client_with(handler).delete_event_type("a.b") is None
    assert seen == {"method": "DELETE", "path": "/api/v1/event-types/a.b"}


def test_event_types_disabled_platform_raises_a_clear_404() -> None:
    from pegasus_workflows.api import PegasusApiError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"error": "Custom events are not enabled", "code": "NOT_FOUND"}
        )

    with pytest.raises(PegasusApiError) as exc:
        _client_with(handler).list_event_types()
    assert exc.value.status_code == 404
    assert "not enabled" in str(exc.value)


# -- CLI ---------------------------------------------------------------------


class _FakeClient:
    last: dict[str, Any] = {}

    def __init__(self, base_url: str, token: str, **_: Any) -> None:
        _FakeClient.last = {}

    def create_event_type(self, name: str, **kwargs: Any) -> dict[str, Any]:
        _FakeClient.last["create"] = (name, kwargs)
        return {"name": name, "enabled": True}

    def list_event_types(self) -> list[dict[str, Any]]:
        return [{"name": "billing.delivery_due", "enabled": True, "description": "due"}]


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.last = {}
    monkeypatch.setattr(et, "PegasusClient", _FakeClient)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_cli_create_reads_the_schema_file(tmp_path) -> None:  # noqa: ANN001
    schema = tmp_path / "schema.json"
    schema.write_text(json.dumps({"type": "object"}), encoding="utf-8")
    result = runner.invoke(
        et.event_types_app,
        [
            "create",
            "billing.delivery_due",
            "--schema",
            str(schema),
            "--description",
            "due",
            "--token",
            _TOKEN,
        ],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["create"] == (
        "billing.delivery_due",
        {"payload_schema": {"type": "object"}, "description": "due"},
    )
    assert "billing.delivery_due" in result.output


def test_cli_create_rejects_a_schema_that_is_not_json(tmp_path) -> None:  # noqa: ANN001
    bad = tmp_path / "schema.json"
    bad.write_text("{not json", encoding="utf-8")
    result = runner.invoke(
        et.event_types_app, ["create", "x.y", "--schema", str(bad), "--token", _TOKEN]
    )
    assert result.exit_code == 2
    assert "create" not in _FakeClient.last


def test_cli_list_prints_names() -> None:
    result = runner.invoke(et.event_types_app, ["list", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert "billing.delivery_due" in result.output
