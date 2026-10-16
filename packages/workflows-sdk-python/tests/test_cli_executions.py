"""Tests for ``pegasus-workflows executions`` (list / show).

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
        ]


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
    result = runner.invoke(
        ex.executions_app, ["show", "wf-1", "exec-1", "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["show"] == ("wf-1", "exec-1")
    assert _FakeClient.last["history"] == ("wf-1", "exec-1")
    assert "boom" in result.output  # errorMessage
    assert "WorkflowExecutionStarted" in result.output
    assert "compose_followup" in result.output  # correlated activity name


def test_list_requires_a_token() -> None:
    result = runner.invoke(ex.executions_app, ["list", "wf-1"])
    assert result.exit_code == 1
    assert "no token" in result.output
