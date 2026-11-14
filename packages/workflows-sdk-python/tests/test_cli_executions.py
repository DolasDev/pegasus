"""Tests for ``pegasus-workflows executions`` (list / show / signal / open / query /
cancel / terminate).

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

    def list_workflow_executions(self, **kwargs):  # noqa: ANN003
        _FakeClient.last["open"] = kwargs
        return [
            {
                "id": "exec-7",
                "workflowName": "order_lifecycle",
                "workflowVersion": "1.1.0",
                "status": "RUNNING",
                "correlationKey": "o-7",
                "queuedAt": "t0",
            }
        ]

    def query_execution(self, execution_id, name, *args, wait=90.0):  # noqa: ANN001, ANN002
        _FakeClient.last["query"] = (execution_id, name, args, wait)
        if name == "nope":
            raise ex.PegasusApiError(
                status_code=422, code="QUERY_NOT_DECLARED", message="declared: status"
            )
        if name == "slow":
            raise ex.WorkflowWorkerStarting(
                status_code=503, code="WORKFLOW_WORKER_STARTING", message="starting",
                retry_after_seconds=15,
            )
        return {"stage": "packing"}

    def cancel_execution_by_id(self, execution_id):  # noqa: ANN001
        _FakeClient.last["cancel"] = execution_id
        return {"id": execution_id, "status": "RUNNING"}

    def terminate_execution(self, execution_id, reason):  # noqa: ANN001
        _FakeClient.last["terminate"] = (execution_id, reason)
        return {"id": execution_id, "status": "CANCELLED", "errorMessage": f"Terminated: {reason}"}


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


def test_open_lists_open_workflows_with_their_key() -> None:
    result = runner.invoke(
        ex.executions_app, ["open", "--name", "order_lifecycle", "--key", "o-7", "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["open"] == {
        "kind": "WORKFLOW",
        "open": True,
        "name": "order_lifecycle",
        "correlation_key": "o-7",
        "limit": 20,
    }
    assert "exec-7" in result.output
    assert "order_lifecycle@1.1.0" in result.output
    assert "o-7" in result.output


def test_open_refuses_key_without_name() -> None:
    result = runner.invoke(ex.executions_app, ["open", "--key", "o-7", "--token", _TOKEN])
    assert result.exit_code == 2
    assert "open" not in _FakeClient.last


def test_query_prints_the_result_as_json() -> None:
    result = runner.invoke(
        ex.executions_app,
        ["query", "exec-7", "--name", "status", "--args", "[1, \"x\"]", "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["query"] == ("exec-7", "status", (1, "x"), 90.0)
    assert '"stage": "packing"' in result.output


def test_query_rejects_args_that_are_not_a_json_array() -> None:
    result = runner.invoke(
        ex.executions_app,
        ["query", "exec-7", "--name", "status", "--args", "{}", "--token", _TOKEN],
    )
    assert result.exit_code == 2
    assert "query" not in _FakeClient.last


def test_query_reports_undeclared_and_still_starting() -> None:
    bad = runner.invoke(ex.executions_app, ["query", "e", "--name", "nope", "--token", _TOKEN])
    assert bad.exit_code == 1
    assert "QUERY_NOT_DECLARED" in bad.output
    slow = runner.invoke(
        ex.executions_app, ["query", "e", "--name", "slow", "--wait", "5", "--token", _TOKEN]
    )
    assert slow.exit_code == 1
    assert "still starting" in slow.output
    assert _FakeClient.last["query"][3] == 5.0


def test_cancel_by_id() -> None:
    result = runner.invoke(ex.executions_app, ["cancel", "exec-7", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["cancel"] == "exec-7"
    assert "cancellation requested" in result.output


def test_terminate_with_yes_skips_the_prompt() -> None:
    result = runner.invoke(
        ex.executions_app,
        ["terminate", "exec-7", "--reason", "order voided", "--yes", "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["terminate"] == ("exec-7", "order voided")
    assert "terminated" in result.output


def test_terminate_asks_and_aborts_on_no() -> None:
    result = runner.invoke(
        ex.executions_app,
        ["terminate", "exec-7", "--reason", "x", "--token", _TOKEN],
        input="n\n",
    )
    assert result.exit_code == 1
    assert "terminate" not in _FakeClient.last
