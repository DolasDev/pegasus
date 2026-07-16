"""Tests for ``pegasus-workflows ingress`` (create / rotate / list) and the
client methods behind them (sdk-feedback 0021). A fake client is swapped in."""

from __future__ import annotations

import httpx
import pytest
from typer.testing import CliRunner

from pegasus_workflows.api import PegasusClient
from pegasus_workflows.cli import ingress as ing

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    last: dict = {}

    def __init__(self, *_a, **_k) -> None:  # noqa: ANN002, ANN003
        pass

    def create_ingress(self, integration_id):  # noqa: ANN001
        _FakeClient.last["create"] = integration_id
        return {
            "integrationId": integration_id,
            "url": f"https://api.test/api/ingress/v1/integrations/{integration_id}/events",
            "token": "ing_one-time",
            "tokenPrefix": "ing_abc12345",  # gitleaks:allow — fake fixture, not a credential
            "enabled": True,
        }

    def rotate_ingress(self, integration_id):  # noqa: ANN001
        _FakeClient.last["rotate"] = integration_id
        return {"integrationId": integration_id, "url": "https://api.test/x", "token": "ing_new"}

    def get_ingress(self, integration_id):  # noqa: ANN001
        _FakeClient.last["list"] = integration_id
        return {
            "integrationId": integration_id,
            "url": "https://api.test/x",
            "tokenPrefix": "ing_abc12345",  # gitleaks:allow — fake fixture, not a credential
            "enabled": True,
            "createdAt": "2026-07-16T00:00:00Z",
            "rotatedAt": None,
        }


@pytest.fixture(autouse=True)
def _patch(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.last = {}
    monkeypatch.setattr(ing, "PegasusClient", _FakeClient)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_create_prints_url_and_one_time_token() -> None:
    result = runner.invoke(ing.ingress_app, ["create", "sirva_ade_shipment", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["create"] == "sirva_ade_shipment"
    assert "ing_one-time" in result.output
    assert "shown once" in result.output


def test_rotate_prints_new_token() -> None:
    result = runner.invoke(ing.ingress_app, ["rotate", "sirva_ade_shipment", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert "ing_new" in result.output


def test_list_shows_prefix_not_token() -> None:
    result = runner.invoke(ing.ingress_app, ["list", "sirva_ade_shipment", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert "ing_abc12345" in result.output


# --- client method wiring (MockTransport) --------------------------------------


def _client(handler) -> PegasusClient:  # noqa: ANN001
    return PegasusClient(
        base_url="http://api.test", token=_TOKEN, transport=httpx.MockTransport(handler)
    )


def test_create_ingress_posts_to_the_right_path() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        return httpx.Response(201, json={"data": {"integrationId": "i", "token": "ing_x"}})

    data = _client(handler).create_ingress("sirva_ade_shipment")
    assert seen["method"] == "POST"
    assert seen["path"] == "/api/v1/integrations/sirva_ade_shipment/ingress"
    assert data["token"] == "ing_x"


def test_rotate_ingress_path() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/integrations/i/ingress/rotate"
        return httpx.Response(200, json={"data": {"token": "ing_y"}})

    assert _client(handler).rotate_ingress("i")["token"] == "ing_y"
