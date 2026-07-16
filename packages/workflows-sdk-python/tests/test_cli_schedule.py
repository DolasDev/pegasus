"""Tests for ``pegasus-workflows schedule`` (create / list / delete).

A fake PegasusClient is swapped in so the tests exercise workflow-name
resolution, arg parsing, and output without a live API (sdk-feedback/0023).
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from pegasus_workflows.cli import schedule as sched

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    last: dict = {}

    def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def list_workflows(self):  # noqa: ANN201
        return [{"id": "wf-1", "name": "ade_lead_poll", "version": "0.0.1", "visibility": "TENANT"}]

    def create_trigger(self, workflow_id, *, kind, cron_expression=None, **_kw):  # noqa: ANN001
        _FakeClient.last["create"] = (workflow_id, kind, cron_expression, _kw.get("enabled"))
        return {
            "id": "trg-9",
            "kind": kind,
            "cronExpression": cron_expression,
            "enabled": _kw.get("enabled", True),
        }

    def list_triggers(self, workflow_id):  # noqa: ANN001
        _FakeClient.last["list"] = workflow_id
        return [
            {"id": "trg-9", "kind": "SCHEDULE", "cronExpression": "*/5 * * * *", "enabled": True},
            {"id": "trg-evt", "kind": "EVENT", "eventType": "quote.accepted"},
        ]

    def delete_trigger(self, workflow_id, trigger_id):  # noqa: ANN001
        _FakeClient.last["delete"] = (workflow_id, trigger_id)


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.last = {}
    monkeypatch.setattr(sched, "PegasusClient", _FakeClient)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_create_resolves_name_and_attaches_schedule() -> None:
    result = runner.invoke(
        sched.schedule_app, ["create", "ade_lead_poll", "--cron", "*/5 * * * *", "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["create"] == ("wf-1", "SCHEDULE", "*/5 * * * *", True)
    assert "trg-9" in result.output
    assert "*/5 * * * *" in result.output


def test_create_disabled_flag() -> None:
    result = runner.invoke(
        sched.schedule_app,
        ["create", "ade_lead_poll", "-c", "0 0 * * *", "--disabled", "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["create"][3] is False
    assert "disabled" in result.output


def test_list_shows_only_schedules() -> None:
    result = runner.invoke(sched.schedule_app, ["list", "ade_lead_poll", "--token", _TOKEN])
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["list"] == "wf-1"
    assert "trg-9" in result.output
    assert "*/5 * * * *" in result.output
    assert "trg-evt" not in result.output  # EVENT triggers are filtered out


def test_delete_removes_by_trigger_id() -> None:
    result = runner.invoke(
        sched.schedule_app, ["delete", "ade_lead_poll", "trg-9", "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["delete"] == ("wf-1", "trg-9")
    assert "deleted" in result.output


def test_unknown_workflow_is_an_error() -> None:
    result = runner.invoke(
        sched.schedule_app, ["create", "nope", "--cron", "* * * * *", "--token", _TOKEN]
    )
    assert result.exit_code != 0
