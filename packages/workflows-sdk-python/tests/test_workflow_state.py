"""Tests for the workflow-state methods on PegasusClient.

Uses ``httpx.MockTransport`` so the client exercises real request building and
response parsing, without a live API.
"""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_workflows.api import PegasusApiError, PegasusClient, WorkflowStateConflict

BASE = "/api/v1/workflow-state"


def _client_with(handler) -> PegasusClient:
    return PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        transport=httpx.MockTransport(handler),
    )


def _row(**overrides):
    return {
        "namespace": "nw_pulse",
        "key": "pulse:490317:pack",
        "state": {"status": "pending"},
        "version": 1,
        **overrides,
    }


def test_get_workflow_state_returns_row() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"{BASE}/nw_pulse/pulse:490317:pack"
        return httpx.Response(200, json={"data": _row()})

    assert _client_with(handler).get_workflow_state("nw_pulse", "pulse:490317:pack") == _row()


def test_get_workflow_state_miss_returns_none() -> None:
    client = _client_with(lambda r: httpx.Response(404, json={"code": "NOT_FOUND"}))
    assert client.get_workflow_state("nw_pulse", "absent") is None


def test_get_workflow_state_forbidden_raises() -> None:
    client = _client_with(lambda r: httpx.Response(403, json={"code": "FORBIDDEN"}))
    with pytest.raises(PegasusApiError) as err:
        client.get_workflow_state("nw_pulse", "k")
    assert err.value.status_code == 403


def test_list_workflow_state_follows_every_page() -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        seen.append(params)
        if "cursor" not in params:
            return httpx.Response(
                200, json={"data": [_row(key="pulse:1:pack")], "nextCursor": "pulse:1:pack"}
            )
        return httpx.Response(200, json={"data": [_row(key="pulse:2:pack")], "nextCursor": None})

    rows = _client_with(handler).list_workflow_state(
        "nw_pulse", prefix="pulse:", updated_since="2026-09-29T00:00:00Z", page_size=1
    )
    assert [r["key"] for r in rows] == ["pulse:1:pack", "pulse:2:pack"]
    assert seen[0] == {"limit": "1", "prefix": "pulse:", "updatedSince": "2026-09-29T00:00:00Z"}
    assert seen[1]["cursor"] == "pulse:1:pack"


def test_put_workflow_state_claim_sends_if_absent() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["json"] = json.loads(request.read())
        return httpx.Response(201, json={"data": _row(), "created": True})

    row = _client_with(handler).put_workflow_state(
        "nw_pulse", "pulse:490317:pack", {"status": "pending"}, if_absent=True
    )
    assert captured == {"method": "PUT", "json": {"state": {"status": "pending"}, "ifAbsent": True}}
    assert row["created"] is True
    assert row["version"] == 1


def test_put_workflow_state_compare_and_set_sends_expected_version() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        return httpx.Response(200, json={"data": _row(version=2), "created": False})

    row = _client_with(handler).put_workflow_state(
        "nw_pulse", "pulse:490317:pack", {"status": "sent"}, expected_version=1
    )
    assert captured["json"] == {"state": {"status": "sent"}, "expectedVersion": 1}
    assert row == {**_row(version=2), "created": False}


def test_put_workflow_state_lost_claim_raises_conflict_with_current() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={
                "error": "already exists",
                "code": "STATE_EXISTS",
                "data": {"current": _row(state={"status": "sent"})},
            },
        )

    with pytest.raises(WorkflowStateConflict) as err:
        _client_with(handler).put_workflow_state("nw_pulse", "k", {}, if_absent=True)
    assert err.value.code == "STATE_EXISTS"
    assert err.value.current == _row(state={"status": "sent"})
    # A conflict is still a PegasusApiError, so broad handlers keep working.
    assert isinstance(err.value, PegasusApiError)


def test_put_workflow_state_version_conflict_on_missing_key_has_no_current() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"code": "STATE_VERSION_CONFLICT", "data": {"current": None}}
        )

    with pytest.raises(WorkflowStateConflict) as err:
        _client_with(handler).put_workflow_state("nw_pulse", "k", {}, expected_version=4)
    assert err.value.code == "STATE_VERSION_CONFLICT"
    assert err.value.current is None


def test_put_workflow_state_rejects_both_conditions() -> None:
    client = _client_with(lambda r: pytest.fail("no request expected"))
    with pytest.raises(ValueError):
        client.put_workflow_state("nw_pulse", "k", {}, if_absent=True, expected_version=1)


def test_delete_workflow_state_passes_expected_version() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["params"] = dict(request.url.params)
        return httpx.Response(204)

    _client_with(handler).delete_workflow_state("nw_pulse", "k", expected_version=3)
    assert captured == {"method": "DELETE", "params": {"expectedVersion": "3"}}


def test_delete_workflow_state_conflict_raises() -> None:
    client = _client_with(
        lambda r: httpx.Response(
            409, json={"code": "STATE_VERSION_CONFLICT", "data": {"current": _row(version=5)}}
        )
    )
    with pytest.raises(WorkflowStateConflict) as err:
        client.delete_workflow_state("nw_pulse", "k", expected_version=1)
    assert err.value.current == _row(version=5)


def test_dry_run_claim_then_compare_and_set_runs_without_network() -> None:
    client = PegasusClient(
        base_url="https://api.test",
        token="vnd_test",
        dry_run=True,
        transport=httpx.MockTransport(lambda r: pytest.fail("dry-run must not call the API")),
    )
    claimed = client.put_workflow_state("nw_pulse", "k", {"status": "pending"}, if_absent=True)
    assert claimed["version"] == 1 and claimed["created"] is True
    updated = client.put_workflow_state(
        "nw_pulse", "k", {"status": "sent"}, expected_version=claimed["version"]
    )
    assert updated["version"] == 2 and updated["created"] is False
    assert [c["capability"] for c in client.captured] == ["WriteWorkflowState"] * 2
