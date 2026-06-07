"""Tests for the hand-rolled Pegasus REST client.

Uses ``httpx.MockTransport`` so the client exercises real request building
(headers, body, paths) without a live server.
"""

from __future__ import annotations

import httpx
import pytest

from pegasus_workflows.api import (
    ARTIFACT_MIME_TYPE,
    MAX_ARTIFACT_BYTES,
    PegasusApiError,
    PegasusClient,
)

_TOKEN = "vnd_" + "a" * 48


def _client_with(handler) -> PegasusClient:
    """Build a PegasusClient whose HTTP calls are served by *handler*."""
    return PegasusClient(
        base_url="http://api.test",
        token=_TOKEN,
        transport=httpx.MockTransport(handler),
    )


def test_request_upload_url_success() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["auth"] = request.headers.get("Authorization")
        captured["json"] = request.read()
        return httpx.Response(
            201,
            json={
                "data": {
                    "workflowId": "wf-1",
                    "uploadUrl": "http://s3.test/put",
                    "expiresInSeconds": 900,
                }
            },
        )

    client = _client_with(handler)
    data = client.request_upload_url("demo", "0.1.0", 1234)

    assert data["workflowId"] == "wf-1"
    assert captured["path"] == "/api/v1/workflows/upload-url"
    assert captured["auth"] == f"Bearer {_TOKEN}"
    assert b'"sizeBytes":1234' in captured["json"].replace(b" ", b"")


def test_request_upload_url_rejects_oversize() -> None:
    client = PegasusClient(base_url="http://api.test", token="vnd_x")
    with pytest.raises(ValueError, match="sizeBytes"):
        client.request_upload_url("demo", "0.1.0", MAX_ARTIFACT_BYTES + 1)


def test_request_upload_url_conflict_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": "already exists", "code": "CONFLICT"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.request_upload_url("demo", "0.1.0", 10)
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "CONFLICT"
    assert "CONFLICT" in str(exc_info.value)


def test_finalize_sends_workflow_id_and_manifest() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.read()
        return httpx.Response(201, json={"data": {"id": "wf-1", "visibility": "TENANT"}})

    client = _client_with(handler)
    row = client.finalize("wf-1", {"name": "demo", "version": "0.1.0", "entryPoints": ["a:B"]})

    assert row["id"] == "wf-1"
    assert captured["path"] == "/api/v1/workflows"
    assert b'"workflowId"' in captured["body"]
    assert b'"manifest"' in captured["body"]


def test_fork_workflow_posts_to_fork_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        return httpx.Response(
            201,
            json={
                "data": {
                    "id": "forked-wf-1",
                    "visibility": "TENANT",
                    "forkedFromWorkflowId": "global-wf-1",
                    "forkedFromVersion": "1.0.0",
                }
            },
        )

    client = _client_with(handler)
    row = client.fork_workflow("global-wf-1")

    assert row["id"] == "forked-wf-1"
    assert row["forkedFromWorkflowId"] == "global-wf-1"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/workflows/global-wf-1/fork"


def test_fork_workflow_conflict_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": "already exists", "code": "CONFLICT"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.fork_workflow("global-wf-1")
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "CONFLICT"


def test_fork_workflow_not_found_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Workflow not found", "code": "NOT_FOUND"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.fork_workflow("missing")
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "NOT_FOUND"


def test_upload_artifact_sets_signed_content_headers() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["content_type"] = request.headers.get("Content-Type")
        captured["content_length"] = request.headers.get("Content-Length")
        captured["body"] = request.read()
        captured["method"] = request.method
        return httpx.Response(200)

    client = _client_with(handler)
    payload = b"PK\x03\x04 zip bytes"
    client.upload_artifact("http://s3.test/put", payload)

    assert captured["method"] == "PUT"
    assert captured["content_type"] == ARTIFACT_MIME_TYPE
    assert captured["content_length"] == str(len(payload))
    assert captured["body"] == payload


def test_upload_artifact_failure_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="AccessDenied")

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.upload_artifact("http://s3.test/put", b"x")
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "S3_UPLOAD_FAILED"


def test_list_workflows_returns_data_array() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "wf-1"}], "meta": {"count": 1}})

    client = _client_with(handler)
    assert client.list_workflows() == [{"id": "wf-1"}]


def test_get_download_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/workflows/wf-1/download-url"
        return httpx.Response(
            200, json={"data": {"downloadUrl": "http://s3.test/get", "expiresInSeconds": 300}}
        )

    client = _client_with(handler)
    assert client.get_download_url("wf-1")["downloadUrl"] == "http://s3.test/get"


def test_error_carries_correlation_id() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500, json={"error": "boom", "code": "INTERNAL", "correlationId": "corr-9"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.list_workflows()
    assert exc_info.value.correlation_id == "corr-9"
    assert "corr-9" in str(exc_info.value)


def test_missing_token_rejected() -> None:
    with pytest.raises(ValueError, match="token"):
        PegasusClient(base_url="http://api.test", token="")


# ---------------------------------------------------------------------------
# Phase 2 Unit 6 — execution endpoints
# ---------------------------------------------------------------------------


def test_run_workflow_posts_to_run_path() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = request.read()
        return httpx.Response(
            201,
            json={
                "data": {
                    "id": "exec-1",
                    "workflowId": "wf-1",
                    "status": "QUEUED",
                    "input": {"quote_id": "q-1"},
                }
            },
        )

    client = _client_with(handler)
    row = client.run_workflow("wf-1", {"quote_id": "q-1"})

    assert row["id"] == "exec-1"
    assert captured["path"] == "/api/v1/workflows/wf-1/run"
    assert b'"input"' in captured["body"]
    assert b'"quote_id"' in captured["body"]


def test_run_workflow_default_empty_input() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(
            201,
            json={"data": {"id": "exec-1", "status": "QUEUED"}},
        )

    client = _client_with(handler)
    client.run_workflow("wf-1")
    assert b'"input":{}' in captured["body"].replace(b" ", b"")


def test_run_workflow_not_executable_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": "not curated",
                "code": "WORKFLOW_NOT_EXECUTABLE",
            },
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.run_workflow("wf-1", {})
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "WORKFLOW_NOT_EXECUTABLE"


def test_list_executions_passes_limit_and_before() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        return httpx.Response(
            200, json={"data": [{"id": "exec-1"}], "meta": {"count": 1}}
        )

    client = _client_with(handler)
    rows = client.list_executions("wf-1", limit=25, before="exec-prev")

    assert rows == [{"id": "exec-1"}]
    assert captured["path"] == "/api/v1/workflows/wf-1/executions"
    assert captured["query"]["limit"] == "25"
    assert captured["query"]["before"] == "exec-prev"


def test_list_executions_omits_before_when_unset() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["query"] = dict(request.url.params)
        return httpx.Response(200, json={"data": [], "meta": {"count": 0}})

    client = _client_with(handler)
    client.list_executions("wf-1")
    assert "before" not in captured["query"]


def test_get_execution_uses_nested_path() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(
            200,
            json={"data": {"id": "exec-1", "workflowId": "wf-1", "status": "COMPLETED"}},
        )

    client = _client_with(handler)
    row = client.get_execution("wf-1", "exec-1")

    assert row["id"] == "exec-1"
    assert captured["path"] == "/api/v1/workflows/wf-1/executions/exec-1"
