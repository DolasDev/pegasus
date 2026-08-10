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


def test_publish_integration_config_sends_floor_overlay_fields() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"version": 1, "visibility": "GLOBAL"}})

    client = _client_with(handler)
    client.publish_integration_config(
        "weichert",
        mapping={"a": "x"},
        rules=[],
        corpus=[],
        floor="shipment_status_update",
        display_name="Weichert",
        external_shape={"type": "object"},
        external_mapping={"ref": "serviceOrderNumber"},
    )

    # camelCase on the wire; omitted keys stay omitted for a plain publish.
    assert captured["body"] == {
        "mapping": {"a": "x"},
        "rules": [],
        "corpus": [],
        "floor": "shipment_status_update",
        "displayName": "Weichert",
        "externalShape": {"type": "object"},
        "externalMapping": {"ref": "serviceOrderNumber"},
    }


def test_publish_integration_config_sends_required_secrets_and_configs() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"version": 1}})

    client = _client_with(handler)
    client.publish_integration_config(
        "sirva_ade",
        mapping={"a": "x"},
        rules=[],
        corpus=[],
        floor="shipment_status_update",
        required_secrets=[{"key": "SEND_API_KEY", "group": "sirva"}],
        required_configs=[{"key": "SEND_URL"}],
    )
    assert captured["body"]["requiredSecrets"] == [{"key": "SEND_API_KEY", "group": "sirva"}]
    assert captured["body"]["requiredConfigs"] == [{"key": "SEND_URL"}]


def test_integration_config_omits_required_keys_when_absent() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"version": 1}})

    client = _client_with(handler)
    client.publish_integration_config("weichert", mapping={"a": "x"}, rules=[], corpus=[])
    assert "requiredSecrets" not in captured["body"]
    assert "requiredConfigs" not in captured["body"]


def test_publish_integration_config_sends_inbound_block() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"version": 1}})

    inbound = {
        "eventType": "sirva_ade.shipment.event",
        "dedupKeyPath": "Events.0.Id",
        "validation": {"requiredPaths": ["SvcProvDataRecipient"], "nonEmptyArrayPaths": ["Events"]},
        "ackTemplate": {"success": {"Result": {"Results": "Success"}}},
    }
    client = _client_with(handler)
    client.publish_integration_config(
        "sirva_ade_shipment",
        mapping={"a": "x"},
        rules=[],
        corpus=[],
        floor="shipment_lifecycle_event",
        inbound=inbound,
    )
    assert captured["body"]["inbound"] == inbound
    assert captured["body"]["floor"] == "shipment_lifecycle_event"


def test_list_and_get_floor_hit_public_endpoints() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        if request.url.path.endswith("/floors"):
            return httpx.Response(200, json={"data": [{"floor": "shipment_lifecycle_event"}]})
        return httpx.Response(
            200,
            json={
                "data": {
                    "floor": "shipment_lifecycle_event",
                    "canonicalFields": ["Id", "Reference.Brand"],
                    "factCatalog": {"brand": "string", "brandPresent": "boolean"},
                    "factDocs": {
                        "brand": "The reference brand code, UPPER-CASED.",
                        "brandPresent": "True when a reference brand code is present.",
                    },
                    "inputFieldRoots": ["Survey", "UnusedFields.survey_received"],
                    "defaultAction": "save",
                }
            },
        )

    client = _client_with(handler)
    floors = client.list_floors()
    assert floors[0]["floor"] == "shipment_lifecycle_event"
    assert seen["path"] == "/api/v1/integrations/floors"

    floor = client.get_floor("shipment_lifecycle_event")
    assert seen["path"] == "/api/v1/integrations/floors/shipment_lifecycle_event"
    assert "brand" in floor["factCatalog"]
    assert "Reference.Brand" in floor["canonicalFields"]
    # The legal mapping SOURCE roots — incl. curated sub-paths — flow through so an
    # author can discover which native fields are readable (sdk-feedback 0028).
    assert "UnusedFields.survey_received" in floor["inputFieldRoots"]
    # What each fact MEANS rides along too, so an author can tell near-identically
    # named facts apart without platform source (sdk-feedback 0035).
    assert floor["factDocs"]["brand"].startswith("The reference brand code")


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


# -- map to external --------------------------------------------------------


def test_map_to_external_posts_data_and_returns_envelope() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "external": {"serviceOrderNumber": "O-1", "shipments": [{"id": "S1"}]},
                "valid": True,
                "issues": [],
                "degraded": False,
            },
        )

    client = _client_with(handler)
    result = client.map_to_external("demo_partner", {"Id": "S1"}, action="save")

    assert result["external"]["serviceOrderNumber"] == "O-1"
    assert result["valid"] is True
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/demo_partner/map-to-external"
    assert captured["body"] == {"data": {"Id": "S1"}, "action": "save"}


def test_map_to_external_omits_action_when_not_given() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200, json={"external": {}, "valid": True, "issues": [], "degraded": False}
        )

    client = _client_with(handler)
    client.map_to_external("demo_partner", {"Id": "S1"})

    assert captured["body"] == {"data": {"Id": "S1"}}
    assert "action" not in captured["body"]


def test_map_to_external_non_2xx_raises_pegasus_api_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"error": 'Unknown integration "ghost"', "code": "NOT_FOUND"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.map_to_external("ghost", {})
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "NOT_FOUND"


def test_map_from_external_posts_payload_and_returns_canonical() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "canonical": {"Id": "111422", "Reference": {"Brand": "AVL"}},
                "valid": True,
                "issues": [],
                "degraded": False,
            },
        )

    client = _client_with(handler)
    result = client.map_from_external("sirva_ade_shipment", {"Brand": "AVL", "RegNumber": "111422"})

    assert result["canonical"]["Reference"]["Brand"] == "AVL"
    assert result["valid"] is True
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/sirva_ade_shipment/map-from-external"
    assert captured["body"] == {"data": {"Brand": "AVL", "RegNumber": "111422"}}


def test_map_from_external_fails_closed_on_unknown_integration() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"error": 'Unknown integration "ghost"', "code": "NOT_FOUND"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.map_from_external("ghost", {})
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "NOT_FOUND"


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
        "group": "global",
        "description": "payments",
    }
    assert row["isSecret"] is True


def test_set_secret_sends_named_group() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.read())
        return httpx.Response(201, json={"data": {"key": "STRIPE_API_KEY", "group": "billing"}})

    client = _client_with(handler)
    client.set_secret("STRIPE_API_KEY", "sk_live_x", group="billing")
    assert captured["json"] == {"key": "STRIPE_API_KEY", "value": "sk_live_x", "group": "billing"}


def test_get_secret_sends_group_query() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["group"] = request.url.params.get("group")
        return httpx.Response(200, json={"data": {"value": "s3cr3t"}})

    client = _client_with(handler)
    client.get_secret("STRIPE_API_KEY", group="billing")
    assert captured["group"] == "billing"


def test_delete_secret_sends_group_query() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["group"] = request.url.params.get("group")
        return httpx.Response(204)

    client = _client_with(handler)
    client.delete_secret("STRIPE_API_KEY", group="billing")
    assert captured["group"] == "billing"


def test_list_secrets_filters_by_group() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["group"] = request.url.params.get("group")
        return httpx.Response(200, json={"data": []})

    client = _client_with(handler)
    client.list_secrets(group="billing")
    assert captured["group"] == "billing"
    # No group → no query param (list every group).
    captured.clear()
    client.list_secrets()
    assert captured["group"] is None


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
    row = client.set_config("DEFAULT_REGION", "us-east-1", group="billing")
    assert captured["method"] == "PUT"
    assert captured["path"] == "/api/v1/workflow-secrets-configs/configs/DEFAULT_REGION"
    assert captured["json"] == {"value": "us-east-1", "group": "billing"}
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


def test_list_salesmen_returns_data_array() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        return httpx.Response(200, json={"data": [{"id": "213056"}], "meta": {"count": 1}})

    client = _client_with(handler)
    salesmen = client.list_salesmen(active="true")
    assert salesmen == [{"id": "213056"}]
    assert captured["path"] == "/api/v1/pegii/salesmen"
    assert captured["query"] == {"active": "true"}


def test_get_salesman_returns_data() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/pegii/salesmen/213056"
        return httpx.Response(200, json={"data": {"id": "213056", "name": "STEVE GAVIN"}})

    client = _client_with(handler)
    assert client.get_salesman("213056") == {"id": "213056", "name": "STEVE GAVIN"}


def test_get_salesman_forbidden_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403, json={"error": "manifest lacks ReadSalesman", "code": "FORBIDDEN"}
        )

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.get_salesman("213056")
    assert exc_info.value.status_code == 403


def test_get_order_native_shape_passes_query_and_returns_raw() -> None:
    captured: dict = {}
    native = {"Id": "490574", "Survey": {"SerivceStatus": "Accepted"}, "WarehouseSummary": {}}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["shape"] = request.url.params.get("shape")
        return httpx.Response(200, json={"data": native})

    client = _client_with(handler)
    result = client.get_order("490574", shape="native")

    assert result == native
    assert captured["path"] == "/api/v1/pegii/orders/490574"
    assert captured["shape"] == "native"


def test_dry_run_integration_fetches_native_then_maps() -> None:
    calls: list[tuple[str, str | None]] = []
    native = {"Id": "490574", "Survey": {"SerivceStatus": "Accepted"}}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.url.path, request.url.params.get("shape")))
        if request.url.path == "/api/v1/pegii/orders/490574":
            return httpx.Response(200, json={"data": native})
        if request.url.path == "/api/v1/integrations/demo_partner/map-from-external":
            assert json.loads(request.content) == {"data": native}
            return httpx.Response(
                200,
                json={"canonical": {"serviceStatus": "Accepted"}, "valid": True,
                      "issues": [], "degraded": False},
            )
        raise AssertionError(f"unexpected path {request.url.path}")

    client = _client_with(handler)
    result = client.dry_run_integration("demo_partner", "490574")

    assert result["valid"] is True
    assert result["canonical"]["serviceStatus"] == "Accepted"
    # native fetch (shape=native) runs first, then the map POST.
    assert calls[0] == ("/api/v1/pegii/orders/490574", "native")
    assert calls[1][0] == "/api/v1/integrations/demo_partner/map-from-external"


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


def test_deliver_to_external_posts_body_and_returns_data() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "data": {
                    "delivered": True,
                    "status": 200,
                    "response": {"accepted": True},
                    "dryRun": False,
                }
            },
        )

    client = _client_with(handler)
    result = client.deliver_to_external("demo_partner", {"serviceOrderNumber": "O-1"})

    assert result == {
        "delivered": True,
        "status": 200,
        "response": {"accepted": True},
        "dryRun": False,
    }
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/demo_partner/deliver-to-external"
    assert captured["body"] == {
        "external": {"serviceOrderNumber": "O-1"},
        "urlConfig": "SEND_URL",
        "apiKeySecret": "SEND_API_KEY",
        "timeoutConfig": "REQUEST_TIMEOUT_MS",
        "group": "global",
    }


def test_deliver_to_external_threads_overrides() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"delivered": True}})

    client = _client_with(handler)
    client.deliver_to_external(
        "demo_partner",
        {"x": 1},
        url_config="ORDER_URL",
        api_key_secret="ORDER_KEY",
        headers_config="ORDER_HEADERS",
        group="billing",
    )

    assert captured["body"] == {
        "external": {"x": 1},
        "urlConfig": "ORDER_URL",
        "apiKeySecret": "ORDER_KEY",
        "timeoutConfig": "REQUEST_TIMEOUT_MS",
        "group": "billing",
        "headersConfig": "ORDER_HEADERS",
    }


def test_deliver_to_external_non_2xx_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.deliver_to_external("demo_partner", {})
    assert exc_info.value.status_code == 403


# --- dry-run mode -------------------------------------------------------------

from pegasus_workflows.api import (  # noqa: E402
    DRY_RUN_ENV_VAR,
    get_dry_run_captures,
    reset_dry_run_captures,
)


def _dry_client(handler) -> PegasusClient:
    return PegasusClient(
        base_url="http://api.test",
        token=_TOKEN,
        transport=httpx.MockTransport(handler),
        dry_run=True,
    )


def _raising_handler(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"unexpected HTTP call in dry-run: {request.method} {request.url.path}")


def test_from_runtime_reads_dry_run_env(monkeypatch) -> None:
    monkeypatch.setenv("PEGASUS_API_BASE_URL", "http://api.test")
    monkeypatch.setenv("PEGASUS_RUNTIME_TOKEN", _TOKEN)
    monkeypatch.delenv(DRY_RUN_ENV_VAR, raising=False)
    assert PegasusClient.from_runtime().is_dry_run is False
    monkeypatch.setenv(DRY_RUN_ENV_VAR, "1")
    assert PegasusClient.from_runtime().is_dry_run is True


def test_dry_run_mutation_is_captured_not_sent() -> None:
    reset_dry_run_captures()
    client = _dry_client(_raising_handler)
    result = client.send_sms(to="+15551234567", body="hi")   # must NOT raise
    assert result == {"data": {"id": "dry-run", "status": "captured", "dryRun": True}}
    assert client.captured[0]["capability"] == "SendSms"
    assert client.captured[0]["args"] == {"to": "+15551234567", "body": "hi"}
    # Also recorded in the process-global sink the runner reads.
    assert get_dry_run_captures()[-1]["capability"] == "SendSms"


def test_dry_run_reads_still_hit_the_api() -> None:
    reset_dry_run_captures()
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        return httpx.Response(200, json={"data": {"id": "S-1", "orderNumber": "S-1"}})

    client = _dry_client(handler)
    order = client.get_order("S-1")
    assert order["orderNumber"] == "S-1"
    assert seen["path"] == "/api/v1/pegii/orders/S-1"   # the read ran live
    assert client.captured == []                         # a read captures nothing


def test_dry_run_deliver_to_external_captured() -> None:
    reset_dry_run_captures()
    client = _dry_client(_raising_handler)
    result = client.deliver_to_external("demo_partner", {"x": 1})
    assert result == {"delivered": False, "status": None, "response": None, "dryRun": True}
    assert client.captured[0]["capability"] == "DeliverToExternal"


def test_dry_run_delete_projection_returns_none_and_captures() -> None:
    reset_dry_run_captures()
    client = _dry_client(_raising_handler)
    assert client.delete_projection("i", "order", "S-1") is None
    assert client.captured[0]["method"] == "delete_projection"


def test_dry_run_delete_integration_config_captured_not_sent() -> None:
    reset_dry_run_captures()
    client = _dry_client(_raising_handler)
    result = client.delete_integration_config("demo_partner", force=True)
    assert result == {"integrationId": "demo_partner", "deleted": 0, "dryRun": True}
    assert client.captured[0]["capability"] == "PublishIntegrationConfig"
    assert client.captured[0]["args"] == {"integration_id": "demo_partner", "force": True}


def test_record_side_effect_only_in_dry_run() -> None:
    reset_dry_run_captures()
    live = PegasusClient(base_url="http://api.test", token=_TOKEN)
    live.record_side_effect("raw_post", {"url": "x"})
    assert live.captured == []                            # no-op outside dry-run
    dry = _dry_client(_raising_handler)
    dry.record_side_effect("raw_post", {"url": "x"})
    assert dry.captured[0]["label"] == "raw_post"


def test_non_dry_run_client_sends_normally() -> None:
    calls: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["path"] = request.url.path
        return httpx.Response(200, json={"data": {"id": 1, "status": "Sent"}})

    client = _client_with(handler)   # dry_run defaults False
    client.send_sms(to="+15551234567", body="hi")
    assert calls["path"] == "/api/v1/sms/send"   # real POST happened
    assert client.captured == []


def test_run_workflow_dry_run_sets_mode() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"id": "exec-1", "status": "QUEUED"}})

    client = _client_with(handler)
    client.run_workflow("wf-1", {"n": 1}, dry_run=True)
    assert captured["body"] == {"input": {"n": 1}, "mode": "dry_run"}


def test_run_workflow_live_omits_mode() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"data": {"id": "exec-1", "status": "QUEUED"}})

    client = _client_with(handler)
    client.run_workflow("wf-1", {"n": 1})
    assert captured["body"] == {"input": {"n": 1}}   # back-compat: no mode key


# --- P2 accessors (SDK completeness) ----------------------------------------


def test_cancel_execution_posts_to_cancel_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        return httpx.Response(202, json={"data": {"id": "exec-1", "status": "CANCELLED"}})

    data = _client_with(handler).cancel_execution("wf-1", "exec-1")
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/workflows/wf-1/executions/exec-1/cancel"
    assert data["status"] == "CANCELLED"


def test_retry_execution_posts_to_retry_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        return httpx.Response(201, json={"data": {"id": "exec-2", "status": "QUEUED"}})

    data = _client_with(handler).retry_execution("wf-1", "exec-1")
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/workflows/wf-1/executions/exec-1/retry"
    assert data["id"] == "exec-2"


def test_fork_integration_config_posts_to_fork_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["query"] = dict(request.url.params)
        return httpx.Response(201, json={"data": {"id": "cfg-1", "visibility": "TENANT"}})

    data = _client_with(handler).fork_integration_config("demo_partner")
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/integrations/demo_partner/config/fork"
    # No refresh opt-in unless asked — the server-side 409 guard stays armed.
    assert captured["query"] == {}
    assert data["visibility"] == "TENANT"


def test_fork_integration_config_force_sends_query_flag() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["query"] = dict(request.url.params)
        return httpx.Response(201, json={"data": {"id": "cfg-2", "version": 4}})

    data = _client_with(handler).fork_integration_config("demo_partner", force=True)
    assert captured["query"] == {"force": "true"}
    # A refresh is a NEW version, not an in-place replacement (sdk-feedback 0030B).
    assert data["version"] == 4


def test_fork_integration_config_existing_overlay_conflict_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"error": "already has its own config… force=true", "code": "CONFLICT"}
        )

    with pytest.raises(PegasusApiError) as exc:
        _client_with(handler).fork_integration_config("demo_partner")
    assert exc.value.status_code == 409


def test_delete_integration_config_deletes_config_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["method"] = request.method
        captured["query"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={"data": {"integrationId": "demo_partner", "visibility": "GLOBAL", "deleted": 4}},
        )

    data = _client_with(handler).delete_integration_config("demo_partner")
    assert captured["method"] == "DELETE"
    assert captured["path"] == "/api/v1/integrations/demo_partner/config"
    # No dependents opt-in unless asked — the server-side guard stays armed.
    assert captured["query"] == {}
    assert data["deleted"] == 4


def test_delete_integration_config_force_sends_query_flag() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["query"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={"data": {"integrationId": "demo_partner", "visibility": "GLOBAL", "deleted": 1}},
        )

    _client_with(handler).delete_integration_config("demo_partner", force=True)
    assert captured["query"] == {"force": "true"}


def test_delete_integration_config_dependents_conflict_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"error": "2 tenant(s) still have…", "code": "DEPENDENTS_EXIST"}
        )

    with pytest.raises(PegasusApiError) as exc:
        _client_with(handler).delete_integration_config("demo_partner")
    assert exc.value.status_code == 409


def test_list_integrations_reads_configs_endpoint() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        return httpx.Response(
            200, json={"data": [{"id": "demo_partner", "published": True}], "meta": {"count": 1}}
        )

    data = _client_with(handler).list_integrations()
    assert captured["path"] == "/api/v1/integrations/configs"
    assert data == [{"id": "demo_partner", "published": True}]


def test_schema_getters_read_public_endpoints() -> None:
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json={"type": "object"})

    client = _client_with(handler)
    assert client.get_mapping_schema() == {"type": "object"}
    assert client.get_inbound_schema() == {"type": "object"}
    assert seen == [
        "/api/v1/integrations/mapping-schema",
        "/api/v1/integrations/inbound-schema",
    ]


# --- api_get read passthrough (0.25.0) --------------------------------------


def test_api_get_returns_full_body_with_params() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["query"] = dict(request.url.params)
        # A {data, nextCursor} envelope — api_get must NOT unwrap to ["data"].
        return httpx.Response(200, json={"data": [{"entityKey": "SO-1"}], "nextCursor": "SO-1"})

    body = _client_with(handler).api_get(
        "/api/v1/integrations/sirva_ade_shipment/projections/shipment",
        status="REGISTERED",
        limit=50,
    )
    assert captured["path"] == "/api/v1/integrations/sirva_ade_shipment/projections/shipment"
    assert captured["query"] == {"status": "REGISTERED", "limit": "50"}
    # Full body preserved (meta/nextCursor visible), not unwrapped.
    assert body == {"data": [{"entityKey": "SO-1"}], "nextCursor": "SO-1"}


def test_api_get_rejects_absolute_url() -> None:
    client = PegasusClient(base_url="http://api.test", token="vnd_x")
    with pytest.raises(ValueError, match="root-relative"):
        client.api_get("https://evil.example.com/api/v1/secrets")


def test_api_get_rejects_non_rooted_path() -> None:
    client = PegasusClient(base_url="http://api.test", token="vnd_x")
    with pytest.raises(ValueError, match="root-relative"):
        client.api_get("api/v1/integrations/configs")  # missing leading slash


def test_api_get_raises_on_non_2xx() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden", "code": "FORBIDDEN"})

    with pytest.raises(PegasusApiError):
        _client_with(handler).api_get("/api/v1/integrations/configs")


# ---------------------------------------------------------------------------
# Azure API Management partners (docs/atlas-world-group-api).
#
# An APIM gateway authenticates with a named header, not a bearer, and Atlas
# declares `On-Behalf-Of` on 142 of its 255 operations. The two header maps are
# split by trust level: `headers` carries literal non-secret values from
# workflow code, `secret_headers` names secrets the platform resolves.
# ---------------------------------------------------------------------------


def _capture_call_external(**kwargs: object) -> dict:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.read())
        return httpx.Response(
            200,
            json={
                "data": {
                    "status": 200,
                    "ok": True,
                    "response": {},
                    "headers": {"content-type": "application/json"},
                    "attempts": 1,
                    "dryRun": False,
                }
            },
        )

    _client_with(handler).call_external("atlas_estimating", **kwargs)  # type: ignore[arg-type]
    return seen["body"]


def test_call_external_sends_literal_headers() -> None:
    body = _capture_call_external(
        method="GET", path="/Estimating/1", headers={"On-Behalf-Of": "jdoe"}
    )
    assert body["headers"] == {"On-Behalf-Of": "jdoe"}


def test_call_external_sends_secret_headers_by_key_name() -> None:
    # The VALUE here is a secret KEY NAME, never the credential itself — that
    # indirection is the point.
    body = _capture_call_external(
        method="GET",
        path="/Estimating/1",
        secret_headers={"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"},
    )
    assert body["secretHeaders"] == {"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"}


def test_call_external_omits_empty_header_maps() -> None:
    body = _capture_call_external(method="GET", path="/x")
    assert "headers" not in body
    assert "secretHeaders" not in body


def test_call_external_threads_timeout_and_retry_config_keys() -> None:
    body = _capture_call_external(
        method="GET", path="/x", timeout_config="ATLAS_TIMEOUT", max_retries_config="ATLAS_RETRIES"
    )
    assert body["timeoutConfig"] == "ATLAS_TIMEOUT"
    assert body["maxRetriesConfig"] == "ATLAS_RETRIES"


def test_call_external_returns_attempts_and_full_headers() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": {
                    "status": 200,
                    "ok": True,
                    "response": {},
                    "headers": {"retry-after": "1", "x-ms-request-id": "req-7"},
                    "attempts": 2,
                    "dryRun": False,
                }
            },
        )

    res = _client_with(handler).call_external("atlas_estimating", method="GET", path="/x")
    assert res["attempts"] == 2
    assert res["headers"]["x-ms-request-id"] == "req-7"


def test_deliver_to_external_sends_both_header_maps() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": {"delivered": True}})

    _client_with(handler).deliver_to_external(
        "demo_partner",
        {"x": 1},
        headers={"On-Behalf-Of": "jdoe"},
        secret_headers={"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"},
    )
    assert captured["body"]["headers"] == {"On-Behalf-Of": "jdoe"}
    assert captured["body"]["secretHeaders"] == {"Ocp-Apim-Subscription-Key": "ATLAS_SUB_KEY"}


# -- declared requirements: present/missing --------------------------------


def test_requirements_summary_reads_the_workflow_plane() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/workflows/requirements-summary"
        return httpx.Response(
            200,
            json={
                "data": {
                    "workflows": [
                        {
                            "workflowId": "wf1",
                            "name": "nightly-sync",
                            "version": "1.0.0",
                            "visibility": "TENANT",
                            "requirements": [
                                {
                                    "kind": "SECRET",
                                    "key": "STRIPE_API_KEY",
                                    "group": "billing",
                                    "description": None,
                                    "present": False,
                                }
                            ],
                            "missingCount": 1,
                        }
                    ],
                    "totalMissing": 1,
                }
            },
        )

    client = _client_with(handler)
    summary = client.requirements_summary()
    # Unwrapped from the {data} envelope.
    assert summary["totalMissing"] == 1
    assert summary["workflows"][0]["requirements"][0]["present"] is False


def test_integration_requirements_summary_reads_the_integration_plane() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/integrations/requirements-summary"
        return httpx.Response(200, json={"data": {"integrations": [], "totalMissing": 0}})

    client = _client_with(handler)
    assert client.integration_requirements_summary() == {
        "integrations": [],
        "totalMissing": 0,
    }


def test_requirements_summary_raises_on_403() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden", "code": "FORBIDDEN"})

    client = _client_with(handler)
    with pytest.raises(PegasusApiError) as exc_info:
        client.requirements_summary()
    assert exc_info.value.status_code == 403
