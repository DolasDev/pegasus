"""Tests for ``pegasus-workflows executions`` (list / show / signal).

A fake PegasusClient is swapped in so the tests exercise arg parsing and output
without a live API.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from pegasus_workflows.cli import executions as ex

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    last: dict = {}

    def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def list_executions(self, workflow_id, *, limit=50, before=None):  # noqa: ANN001
        _FakeClient.last["list"] = (workflow_id, limit)
        return [
            {
                "id": "exec-1",
                "status": "FAILED",
                "triggerSource": "USER",
                "queuedAt": "2026-06-27T00:00:00Z",
            }
        ]

    def get_execution(self, workflow_id, execution_id):  # noqa: ANN001
        _FakeClient.last["show"] = (workflow_id, execution_id)
        return {
            "id": execution_id,
            "status": "FAILED",
            "triggerSource": "USER",
            "queuedAt": "t0",
            "startedAt": "t1",
            "finishedAt": "t2",
            "input": {"quoteId": "q-9"},
            "result": None,
            "errorMessage": "boom",
        }

    def get_execution_history(self, workflow_id, execution_id):  # noqa: ANN001
        _FakeClient.last["history"] = (workflow_id, execution_id)
        return [
            {"id": "1", "type": "WorkflowExecutionStarted", "timestamp": "t1"},
            {
                "id": "2",
                "type": "ActivityTaskFailed",
                "timestamp": "t2",
                "activityType": "compose_followup",
                "failure": "boom 401",
            },
            {
                "id": "3",
                "type": "WorkflowExecutionSignaled",
                "timestamp": "t3",
                "signalName": "proceed",
            },
        ]

    def signal_execution(self, workflow_id, execution_id, name, payload=None):  # noqa: ANN001
        _FakeClient.last["signal"] = (workflow_id, execution_id, name, payload)
        if name == "nope":
            raise ex.PegasusApiError(
                status_code=400, code="SIGNAL_NOT_DECLARED", message="not declared"
            )
        return {"id": execution_id, "status": "RUNNING"}


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.last = {}
    monkeypatch.setattr(ex, "PegasusClient", _FakeClient)
    # Isolate credential resolution from any real ~/.pegasus/credentials.
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_list_calls_api_and_prints_rows() -> None:
    result = runner.invoke(ex.executions_app, ["list", "wf-1", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["list"] == ("wf-1", 20)
    assert "exec-1" in result.output
    assert "FAILED" in result.output


def test_show_prints_execution_and_timeline() -> None:
    result = runner.invoke(ex.executions_app, ["show", "wf-1", "exec-1", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["show"] == ("wf-1", "exec-1")
    assert _FakeClient.last["history"] == ("wf-1", "exec-1")
    assert "boom" in result.output  # errorMessage
    assert "WorkflowExecutionStarted" in result.output
    assert "compose_followup" in result.output  # correlated activity name
    assert "signal: proceed" in result.output


def test_list_requires_a_token() -> None:
    result = runner.invoke(ex.executions_app, ["list", "wf-1"])
    assert result.exit_code == 1
    assert "no token" in result.output


def test_signal_sends_name_and_parsed_payload() -> None:
    result = runner.invoke(
        ex.executions_app,
        [
            "signal",
            "wf-1",
            "exec-1",
            "--name",
            "note",
            "--payload",
            '{"text":"hi"}',
            "--token",
            _TOKEN,
        ],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["signal"] == ("wf-1", "exec-1", "note", {"text": "hi"})
    assert "delivered" in result.output


def test_signal_without_payload_sends_none() -> None:
    result = runner.invoke(
        ex.executions_app, ["signal", "wf-1", "exec-1", "--name", "proceed", "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["signal"] == ("wf-1", "exec-1", "proceed", None)


def test_signal_rejects_invalid_json_payload() -> None:
    result = runner.invoke(
        ex.executions_app,
        ["signal", "wf-1", "exec-1", "--name", "note", "--payload", "{nope", "--token", _TOKEN],
    )
    assert result.exit_code == 2
    assert "not valid JSON" in result.output
    assert "signal" not in _FakeClient.last


def test_signal_reports_api_error() -> None:
    result = runner.invoke(
        ex.executions_app, ["signal", "wf-1", "exec-1", "--name", "nope", "--token", _TOKEN]
    )
    assert result.exit_code == 1
    assert "SIGNAL_NOT_DECLARED" in result.output or "not declared" in result.output
