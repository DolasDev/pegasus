"""Tests for the hand-rolled Pegasus REST client.

Uses ``httpx.MockTransport`` so the client exercises real request building
(headers, body, paths) without a live server.
"""

from __future__ import annotations

import json

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


def test_get_execution_history_returns_events_array() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(
            200,
            json={
                "data": {
                    "events": [
                        {"id": "1", "type": "WorkflowExecutionStarted", "timestamp": None},
                        {"id": "2", "type": "ActivityTaskFailed", "failure": "boom"},
                    ]
                }
            },
        )

    client = _client_with(handler)
    events = client.get_execution_history("wf-1", "exec-1")

    assert captured["path"] == "/api/v1/workflows/wf-1/executions/exec-1/history"
    assert [e["type"] for e in events] == [
        "WorkflowExecutionStarted",
        "ActivityTaskFailed",
    ]


def test_emit_event_posts_payload_to_emit_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={
                "data": {
                    "emitted": True,
                    "eventType": "lead.qualified",
                    "occurredAt": "2026-06-21T00:00:00.000Z",
                }
            },
        )

    client = _client_with(handler)
    result = client.emit_event("lead.qualified", {"leadId": "lead-1"})

    assert result["emitted"] is True
    assert result["eventType"] == "lead.qualified"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/event-types/lead.qualified/emit"
    assert captured["body"] == {"payload": {"leadId": "lead-1"}}


def test_emit_event_defaults_payload_to_empty_object() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={"data": {"emitted": True, "eventType": "ping", "occurredAt": "x"}},
        )

    client = _client_with(handler)
    client.emit_event("ping")

    assert captured["body"] == {"payload": {}}


def test_emit_event_schema_mismatch_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error": "payload failed schema", "code": "VALIDATION_ERROR"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.emit_event("lead.qualified", {"wrong": 1})
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "VALIDATION_ERROR"


def test_emit_event_unknown_type_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "event type not found", "code": "NOT_FOUND"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.emit_event("nope")
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "NOT_FOUND"


# ---------------------------------------------------------------------------
# Integration-validator config (publish / pull / versions / rollback)
# ---------------------------------------------------------------------------


def test_validate_integration_config_posts_surface() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"data": {"ok": True, "problems": [], "corpus": {"total": 2, "passed": 2}}},
        )

    client = _client_with(handler)
    report = client.validate_integration_config(
        "demo_partner",
        mapping={"a": "x"},
        rules=[{"id": "r"}],
        corpus=[{"name": "c"}],
    )

    assert report["ok"] is True
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/demo_partner/config/validate"
    assert captured["body"] == {
        "mapping": {"a": "x"},
        "rules": [{"id": "r"}],
        "corpus": [{"name": "c"}],
    }


def test_publish_integration_config_returns_row() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(
            201,
            json={"data": {"id": "cfg-1", "version": 1, "visibility": "GLOBAL"}},
        )

    client = _client_with(handler)
    row = client.publish_integration_config(
        "demo_partner", mapping={}, rules=[], corpus=[]
    )

    assert row["version"] == 1
    assert row["visibility"] == "GLOBAL"
    assert captured["path"] == "/api/v1/integrations/demo_partner/config"


def test_publish_integration_config_gate_failure_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={"error": "Config failed the validation gate", "code": "GATE_FAILED"},
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.publish_integration_config("demo_partner", mapping={}, rules=[], corpus=[])
    assert exc_info.value.status_code == 422
    assert exc_info.value.code == "GATE_FAILED"


def test_get_integration_config_returns_full_projection() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/integrations/demo_partner/config"
        return httpx.Response(
            200,
            json={
                "data": {
                    "version": 3,
                    "visibility": "GLOBAL",
                    "mapping": {"a": "x"},
                    "rules": [],
                    "corpus": [],
                }
            },
        )

    client = _client_with(handler)
    config = client.get_integration_config("demo_partner")
    assert config["version"] == 3
    assert config["mapping"] == {"a": "x"}


def test_get_integration_config_not_found_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "No published config", "code": "NOT_FOUND"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_integration_config("demo_partner")
    assert exc_info.value.status_code == 404


def test_list_integration_config_versions_returns_data_array() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/integrations/demo_partner/config/versions"
        return httpx.Response(
            200,
            json={"data": [{"version": 2}, {"version": 1}], "meta": {"count": 2}},
        )

    client = _client_with(handler)
    assert client.list_integration_config_versions("demo_partner") == [
        {"version": 2},
        {"version": 1},
    ]


def test_rollback_integration_config_posts_to_version_path() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        return httpx.Response(201, json={"data": {"version": 4, "visibility": "GLOBAL"}})

    client = _client_with(handler)
    row = client.rollback_integration_config("demo_partner", 2)

    assert row["version"] == 4
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/demo_partner/config/rollback/2"


# ---------------------------------------------------------------------------
# SMS primitive
# ---------------------------------------------------------------------------


def test_send_sms_posts_to_and_body_to_sms_send_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            202,
            json={"data": {"id": "msg-1", "status": "Queued"}},
        )

    client = _client_with(handler)
    result = client.send_sms(to="+16308868537", body="hello")

    assert result == {"data": {"id": "msg-1", "status": "Queued"}}
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/sms/send"
    assert captured["body"] == {"to": "+16308868537", "body": "hello"}


def test_send_sms_non_2xx_raises_pegasus_api_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": "manifest lacks SendSms action", "code": "FORBIDDEN"},
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.send_sms(to="+16308868537", body="hello")
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "FORBIDDEN"


# -- workflow secrets & configuration ---------------------------------------


def test_get_secret_success() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"data": {"value": "s3cr3t"}})

    client = _client_with(handler)
    assert client.get_secret("STRIPE_API_KEY") == "s3cr3t"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/runtime/secrets/STRIPE_API_KEY"
    assert captured["auth"] == f"Bearer {_TOKEN}"


def test_get_secret_not_found_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Secret not found", "code": "NOT_FOUND"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_secret("NOPE")
    assert exc_info.value.status_code == 404


def test_get_config_success() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(200, json={"data": {"value": "us-east-1"}})

    client = _client_with(handler)
    assert client.get_config("DEFAULT_REGION") == "us-east-1"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/runtime/configs/DEFAULT_REGION"


def test_get_config_forbidden_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "denied", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_config("DEFAULT_REGION")
    assert exc_info.value.status_code == 403


def test_set_secret_posts_payload_and_returns_metadata() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(201, json={"data": {"key": "STRIPE_API_KEY", "isSecret": True}})

    client = _client_with(handler)
    row = client.set_secret("STRIPE_API_KEY", "sk_live_x", description="payments")
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/secrets"
    assert captured["json"] == {
        "key": "STRIPE_API_KEY",
        "value": "sk_live_x",
        "description": "payments",
    }
    assert row["isSecret"] is True


def test_set_secret_conflict_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": "already exists", "code": "CONFLICT"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.set_secret("STRIPE_API_KEY", "sk_live_x")
    assert exc_info.value.status_code == 409


def test_list_secrets_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/workflow-secrets-configs/secrets"
        return httpx.Response(200, json={"data": [{"key": "STRIPE_API_KEY"}]})

    client = _client_with(handler)
    assert client.list_secrets() == [{"key": "STRIPE_API_KEY"}]


def test_delete_secret_issues_delete() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(204)

    client = _client_with(handler)
    client.delete_secret("STRIPE_API_KEY")
    assert captured["method"] == "DELETE"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/secrets/STRIPE_API_KEY"


def test_set_config_puts_payload() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(200, json={"data": {"key": "DEFAULT_REGION", "value": "us-east-1"}})

    client = _client_with(handler)
    row = client.set_config("DEFAULT_REGION", "us-east-1")
    assert captured["method"] == "PUT"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/configs/DEFAULT_REGION"
    assert captured["json"] == {"value": "us-east-1"}
    assert row["value"] == "us-east-1"


def test_list_configs_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/workflow-secrets-configs/configs"
        return httpx.Response(200, json={"data": [{"key": "DEFAULT_REGION", "value": "us-east-1"}]})

    client = _client_with(handler)
    assert client.list_configs() == [{"key": "DEFAULT_REGION", "value": "us-east-1"}]


def test_delete_config_issues_delete() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(204)

    client = _client_with(handler)
    client.delete_config("DEFAULT_REGION")
    assert captured["method"] == "DELETE"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/configs/DEFAULT_REGION"


# -- integration projections --------------------------------------------------


def test_get_projection_success() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["auth"] = request.headers.get("Authorization")
        return httpx.Response(200, json={"data": {"entityKey": "SO-1", "state": {"x": 1}}})

    client = _client_with(handler)
    row = client.get_projection("demo_partner", "order", "SO-1")
    assert row == {"entityKey": "SO-1", "state": {"x": 1}}
    assert captured["method"] == "GET"
    assert captured["path"] == "/api/v1/integration-projections/runtime/demo_partner/order/SO-1"
    assert captured["auth"] == f"Bearer {_TOKEN}"


def test_get_projection_miss_returns_none() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Projection not found", "code": "NOT_FOUND"})

    client = _client_with(handler)
    assert client.get_projection("demo_partner", "order", "NOPE") is None


def test_get_projection_forbidden_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "denied", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_projection("demo_partner", "order", "SO-1")
    assert exc_info.value.status_code == 403


def test_list_projections_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/integration-projections/runtime/demo_partner/order"
        return httpx.Response(200, json={"data": [{"entityKey": "SO-1"}]})

    client = _client_with(handler)
    assert client.list_projections("demo_partner", "order") == [{"entityKey": "SO-1"}]


def test_put_projection_puts_state_payload() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["json"] = json.loads(request.read())
        return httpx.Response(201, json={"data": {"entityKey": "SO-1", "version": 1}})

    client = _client_with(handler)
    row = client.put_projection("demo_partner", "order", "SO-1", {"serviceOrderNumber": "SO-1"})
    assert captured["method"] == "PUT"
    assert captured["path"] == "/api/v1/integration-projections/runtime/demo_partner/order/SO-1"
    assert captured["json"] == {"state": {"serviceOrderNumber": "SO-1"}}
    assert row["version"] == 1


def test_put_projection_too_large_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            413, json={"error": "state exceeds 256 KB", "code": "VALIDATION_ERROR"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.put_projection("demo_partner", "order", "SO-1", {"big": "x"})
    assert exc_info.value.status_code == 413


def test_delete_projection_issues_delete() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(204)

    client = _client_with(handler)
    client.delete_projection("demo_partner", "order", "SO-1")
    assert captured["method"] == "DELETE"
    assert captured["path"] == "/api/v1/integration-projections/runtime/demo_partner/order/SO-1"


# -- pegII order reads -------------------------------------------------------


def test_list_orders_returns_data_array() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        return httpx.Response(200, json={"data": [{"id": "ord-1"}], "meta": {"count": 1}})

    client = _client_with(handler)
    orders = client.list_orders(status="booked")
    assert orders == [{"id": "ord-1"}]
    assert captured["path"] == "/api/v1/pegii/orders"
    assert captured["query"] == {"status": "booked"}


def test_get_order_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/pegii/orders/ord-9"
        return httpx.Response(200, json={"data": {"id": "ord-9", "status": "booked"}})

    client = _client_with(handler)
    assert client.get_order("ord-9") == {"id": "ord-9", "status": "booked"}


def test_get_order_forbidden_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "manifest lacks ReadOrder", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_order("ord-9")
    assert exc_info.value.status_code == 403


# -- pegII task lifecycle ----------------------------------------------------


def test_list_tasks_scopes_by_order_id() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        return httpx.Response(200, json={"data": [{"id": "task-1"}], "meta": {"count": 1}})

    client = _client_with(handler)
    tasks = client.list_tasks(order_id="ord-1", status="open")
    assert tasks == [{"id": "task-1"}]
    assert captured["path"] == "/api/v1/pegii/tasks"
    assert captured["query"] == {"orderId": "ord-1", "status": "open"}


def test_get_task_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/pegii/tasks/task-7"
        return httpx.Response(200, json={"data": {"id": "task-7", "status": "open"}})

    client = _client_with(handler)
    assert client.get_task("task-7") == {"id": "task-7", "status": "open"}


def test_close_task_posts_order_and_type() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "data": {
                    "orderId": "ord-1",
                    "taskType": "date_confirmation",
                    "status": "closed",
                }
            },
        )

    client = _client_with(handler)
    result = client.close_task(
        order_id="ord-1", task_type="date_confirmation", reason="packing date set"
    )
    assert result["status"] == "closed"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/pegii/tasks/close"
    assert captured["body"] == {
        "orderId": "ord-1",
        "taskType": "date_confirmation",
        "reason": "packing date set",
    }


def test_close_task_omits_reason_when_absent() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"status": "closed", "alreadyClosed": True}})

    client = _client_with(handler)
    result = client.close_task(order_id="ord-1", task_type="date_confirmation")
    assert result["alreadyClosed"] is True
    assert captured["body"] == {"orderId": "ord-1", "taskType": "date_confirmation"}


def test_close_task_forbidden_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "manifest lacks CloseTask", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.close_task(order_id="ord-1", task_type="date_confirmation")
    assert exc_info.value.status_code == 403
