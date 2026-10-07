"""Tests for ``pegasus-workflows retire`` (sdk-feedback 0032).

A fake PegasusClient is swapped in so the tests exercise name@version parsing,
the confirmation prompt, and how a refusal is reported, without a live API.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from pegasus_workflows.api import PegasusApiError, WorkflowInUse
from pegasus_workflows.cli import app
from pegasus_workflows.cli import retire as retire_mod

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    calls: list = []
    raise_with: Exception | None = None

    def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def retire_workflow(self, name, version=None):  # noqa: ANN001, ANN201
        _FakeClient.calls.append((name, version))
        if _FakeClient.raise_with is not None:
            raise _FakeClient.raise_with
        return {
            "retired": [{"id": "wf-2", "name": name, "version": version or "0.2.0"}],
            "alreadyRetired": [{"id": "wf-1", "name": name, "version": "0.1.0"}],
            "forkCount": 3,
        }


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.calls = []
    _FakeClient.raise_with = None
    monkeypatch.setattr(retire_mod, "PegasusClient", _FakeClient)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_retires_every_version_by_name_and_reports_forks() -> None:
    result = runner.invoke(app, ["retire", "send_order_to_partner", "--yes", "--token", _TOKEN])

    assert result.exit_code == 0, result.output
    assert _FakeClient.calls == [("send_order_to_partner", None)]
    assert "retired send_order_to_partner: 0.2.0" in result.output
    assert "already retired: 0.1.0" in result.output
    assert "3 tenant fork(s)" in result.output


def test_name_at_version_retires_one_version() -> None:
    result = runner.invoke(app, ["retire", "wmu@0.6.3", "--yes", "--token", _TOKEN])

    assert result.exit_code == 0, result.output
    assert _FakeClient.calls == [("wmu", "0.6.3")]


def test_asks_first_and_does_nothing_when_declined() -> None:
    result = runner.invoke(app, ["retire", "wmu", "--token", _TOKEN], input="n\n")

    assert result.exit_code != 0
    assert "EVERY version of wmu" in result.output
    assert _FakeClient.calls == []


def test_in_use_lists_the_blockers_and_exits_nonzero() -> None:
    _FakeClient.raise_with = WorkflowInUse(
        status_code=409,
        code="WORKFLOW_IN_USE",
        message="wmu is still in use (1 enabled trigger(s))",
        enabled_triggers=[{"id": "trig-1", "workflowId": "wf-2", "version": "0.2.0"}],
        open_executions=[{"id": "ex-9", "workflowId": "wf-2", "version": "0.2.0"}],
    )

    result = runner.invoke(app, ["retire", "wmu", "--yes", "--token", _TOKEN])

    assert result.exit_code == 1
    assert "not retired" in result.output
    assert "enabled trigger trig-1 on wmu@0.2.0" in result.output
    assert "open execution ex-9 of wmu@0.2.0" in result.output


def test_other_api_errors_exit_nonzero() -> None:
    _FakeClient.raise_with = PegasusApiError(status_code=403, code="FORBIDDEN", message="nope")

    result = runner.invoke(app, ["retire", "wmu", "--yes", "--token", _TOKEN])

    assert result.exit_code == 1
    assert "retire failed" in result.output
