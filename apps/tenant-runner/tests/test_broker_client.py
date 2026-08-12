"""Broker client: token header, parsing strictness, retry/backoff posture."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from pegasus_tenant_runner.broker_client import (
    BrokerAuthError,
    BrokerError,
    TenantBrokerClient,
)

TOKEN = "wbk_11111111-1111-4111-8111-111111111111_" + "ab" * 24


def _client(handler: Any, **kwargs: Any) -> TenantBrokerClient:
    return TenantBrokerClient(
        api_base_url="http://api.invalid",
        broker_token=TOKEN,
        transport=httpx.MockTransport(handler),
        sleep=lambda _s: None,
        **kwargs,
    )


def _list_item(**overrides: Any) -> dict[str, Any]:
    item = {
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "my_workflow",
        "version": "1.0.0",
        "entryPoints": ["my_workflow.workflow:MyWorkflow"],
        "artifactSha256": "a" * 64,
        "artifactSizeBytes": 1234,
        "downloadUrl": "https://s3.invalid/presigned",
        "createdAt": "2026-06-11T00:00:00.000Z",
    }
    item.update(overrides)
    return item


# ---------------------------------------------------------------------------
# list_executable_workflows
# ---------------------------------------------------------------------------


def test_list_sends_token_header_and_parses() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": [_list_item()]})

    rows = _client(handler).list_executable_workflows()
    assert seen[0].headers["X-Workflow-Broker-Token"] == TOKEN
    assert seen[0].url.path == "/api/v1/internal/tenant-workflows"
    assert len(rows) == 1
    assert rows[0].name == "my_workflow"
    assert rows[0].entry_points == ("my_workflow.workflow:MyWorkflow",)
    assert rows[0].artifact_sha256 == "a" * 64
    assert rows[0].download_url == "https://s3.invalid/presigned"


def test_list_raises_auth_error_on_401() -> None:
    client = _client(lambda _r: httpx.Response(401, json={"error": "unauthorized"}))
    with pytest.raises(BrokerAuthError):
        client.list_executable_workflows()


@pytest.mark.parametrize(
    "broken",
    [
        {"artifactSha256": None},  # digest missing → TOCTOU check impossible
        {"entryPoints": []},
        {"downloadUrl": None},
    ],
)
def test_list_rejects_unusable_item_shapes(broken: dict[str, Any]) -> None:
    client = _client(
        lambda _r: httpx.Response(200, json={"data": [_list_item(**broken)]})
    )
    with pytest.raises(BrokerError, match="invalid shape"):
        client.list_executable_workflows()


# ---------------------------------------------------------------------------
# fetch_runtime_token
# ---------------------------------------------------------------------------


def test_fetch_runtime_token_posts_execution_id() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"token": "vnd_abc123"})

    grant = _client(handler).fetch_runtime_token("exec-1")
    assert grant.token == "vnd_abc123"
    assert json.loads(seen[0].content) == {"executionId": "exec-1"}
    assert seen[0].headers["X-Workflow-Broker-Token"] == TOKEN


def test_fetch_runtime_token_carries_the_workflow_identity() -> None:
    """The runner's ONLY source for which published row an execution is bound
    to — without it, it can do no better than latest-per-name (0034)."""
    client = _client(
        lambda _r: httpx.Response(
            200,
            json={
                "token": "vnd_abc123",
                "workflowId": "wf-1",
                "workflowName": "my-workflow",
                "workflowVersion": "0.6.2",
            },
        )
    )
    grant = client.fetch_runtime_token("exec-1")
    assert (grant.workflow_id, grant.workflow_name, grant.workflow_version) == (
        "wf-1",
        "my-workflow",
        "0.6.2",
    )


def test_fetch_runtime_token_tolerates_an_api_without_the_identity() -> None:
    """An API older than 0034 returns the token alone; the runner then falls
    back to a freshly-listed latest-by-name instead of failing the run."""
    client = _client(lambda _r: httpx.Response(200, json={"token": "vnd_abc123"}))
    grant = client.fetch_runtime_token("exec-1")
    assert grant.token == "vnd_abc123"
    assert grant.workflow_id is None


def test_runtime_grant_repr_never_leaks_the_token() -> None:
    """This object crosses log boundaries; the plaintext credential must not."""
    client = _client(
        lambda _r: httpx.Response(200, json={"token": "vnd_secret", "workflowId": "wf-1"})
    )
    grant = client.fetch_runtime_token("exec-1")
    assert "vnd_secret" not in repr(grant)
    assert "wf-1" in repr(grant)


def test_fetch_runtime_token_404_raises() -> None:
    """404 = missing row OR cross-tenant (deliberately indistinguishable)."""
    client = _client(lambda _r: httpx.Response(404, json={"code": "NOT_FOUND"}))
    with pytest.raises(BrokerError, match="404"):
        client.fetch_runtime_token("exec-1")


def test_fetch_runtime_token_requires_execution_id() -> None:
    client = _client(lambda _r: httpx.Response(200, json={"token": "x"}))
    with pytest.raises(ValueError):
        client.fetch_runtime_token("")


# ---------------------------------------------------------------------------
# patch_execution
# ---------------------------------------------------------------------------


def test_patch_retries_5xx_then_succeeds() -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={})

    _client(handler).patch_execution(
        "exec-1", "COMPLETED", finished_at_iso="2026-06-11T00:00:00.000Z", result={"x": 1}
    )
    assert len(calls) == 3


def test_patch_exhausts_retries_and_raises() -> None:
    client = _client(lambda _r: httpx.Response(503), max_attempts=2)
    with pytest.raises(BrokerError, match="exhausted 2 attempts"):
        client.patch_execution(
            "exec-1", "FAILED", finished_at_iso="2026-06-11T00:00:00.000Z"
        )


def test_patch_auth_error_raises_immediately() -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(401)

    with pytest.raises(BrokerAuthError):
        _client(handler).patch_execution(
            "exec-1", "FAILED", finished_at_iso="2026-06-11T00:00:00.000Z"
        )
    assert len(calls) == 1  # no retry on auth failures


def test_patch_4xx_raises_without_retry() -> None:
    calls: list[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(400, json={"code": "INVALID_TRANSITION"})

    with pytest.raises(BrokerError, match="400"):
        _client(handler).patch_execution(
            "exec-1", "COMPLETED", finished_at_iso="2026-06-11T00:00:00.000Z"
        )
    assert len(calls) == 1


def test_patch_rejects_non_terminal_status() -> None:
    client = _client(lambda _r: httpx.Response(200, json={}))
    with pytest.raises(ValueError, match="not terminal"):
        client.patch_execution(
            "exec-1", "RUNNING", finished_at_iso="2026-06-11T00:00:00.000Z"
        )


def test_patch_sends_expected_payload() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    _client(handler).patch_execution(
        "exec-1",
        "FAILED",
        finished_at_iso="2026-06-11T00:00:00.000Z",
        error_message="boom",
    )
    assert seen[0].method == "PATCH"
    assert seen[0].url.path == "/api/v1/internal/workflow-executions/exec-1"
    assert json.loads(seen[0].content) == {
        "status": "FAILED",
        "finishedAt": "2026-06-11T00:00:00.000Z",
        "errorMessage": "boom",
    }
