"""Tests for ``pegasus-workflows requirements``.

A fake PegasusClient is swapped in so the tests exercise the merge of the two
planes, the ``--missing-only`` filter, and — the point of the command — that a
plane it could not read is REPORTED rather than silently dropped.
"""

from __future__ import annotations

import json

import pytest
import typer
from typer.testing import CliRunner

from pegasus_workflows.api import PegasusApiError
from pegasus_workflows.cli import requirements as req

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


def _req(kind: str, key: str, *, present: bool, group: str = "global", description=None):  # noqa: ANN001, ANN201
    return {
        "kind": kind,
        "key": key,
        "group": group,
        "description": description,
        "present": present,
    }


class _FakeClient:
    """Both planes readable by default; set the class attrs to change that."""

    workflows_error: PegasusApiError | None = None
    integrations_error: PegasusApiError | None = None

    def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def requirements_summary(self):  # noqa: ANN201
        if _FakeClient.workflows_error:
            raise _FakeClient.workflows_error
        return {
            "workflows": [
                {
                    "workflowId": "wf1",
                    "name": "nightly-sync",
                    "version": "1.0.0",
                    "visibility": "TENANT",
                    "requirements": [
                        _req("SECRET", "STRIPE_API_KEY", present=True, group="billing"),
                        _req("CONFIG", "DEFAULT_REGION", present=False),
                    ],
                    "missingCount": 1,
                }
            ],
            "totalMissing": 1,
        }

    def integration_requirements_summary(self):  # noqa: ANN201
        if _FakeClient.integrations_error:
            raise _FakeClient.integrations_error
        return {
            "integrations": [
                {
                    "integrationId": "sirva_ade_shipment",
                    "displayName": "Sirva ADE",
                    "requirements": [_req("SECRET", "SEND_API_KEY", present=False)],
                    "missingCount": 1,
                }
            ],
            "totalMissing": 1,
        }


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    _FakeClient.workflows_error = None
    _FakeClient.integrations_error = None
    monkeypatch.setattr(req, "PegasusClient", _FakeClient)
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def _app() -> typer.Typer:
    # A Typer app holding ONE command collapses it into the app itself, so the
    # command name is not part of the argv here (it is under the real
    # `pegasus-workflows` app, which has many).
    app = typer.Typer()
    app.command("requirements")(req.requirements_command)
    return app


def _run(*args: str):  # noqa: ANN202
    return runner.invoke(_app(), ["--token", _TOKEN, *args])


def test_merges_both_planes() -> None:
    result = _run()
    assert result.exit_code == 0, result.output
    assert "STRIPE_API_KEY" in result.output
    assert "DEFAULT_REGION" in result.output
    assert "SEND_API_KEY" in result.output
    # The consumer is named alongside each key, and the two kinds stay distinct.
    assert "workflow:nightly-sync" in result.output
    assert "integration:Sirva ADE" in result.output


def test_marks_set_versus_missing() -> None:
    result = _run()
    lines = {line.split("\t")[1:3][1]: line for line in result.output.splitlines() if "\t" in line}
    assert lines["STRIPE_API_KEY"].startswith("set")
    assert lines["DEFAULT_REGION"].startswith("MISSING")


def test_missing_only_filters_to_unset_keys() -> None:
    result = _run("--missing-only")
    assert result.exit_code == 0, result.output
    assert "STRIPE_API_KEY" not in result.output
    assert "DEFAULT_REGION" in result.output
    assert "SEND_API_KEY" in result.output


def test_json_output_preserves_both_kinds() -> None:
    result = _run("--json")
    assert result.exit_code == 0, result.output
    rows = json.loads(result.output)
    # The requirement's own kind (SECRET/CONFIG) and the consumer kind
    # (workflow/integration) must both survive the merge.
    stripe = next(r for r in rows if r["key"] == "STRIPE_API_KEY")
    assert stripe["kind"] == "SECRET"
    assert stripe["consumerKind"] == "workflow"
    assert stripe["consumer"] == "nightly-sync"


def test_reports_an_unreadable_plane_instead_of_hiding_it() -> None:
    # A viewer-ish token that can read workflows but not integration configs must
    # NOT be told "nothing missing" off half the data.
    _FakeClient.integrations_error = PegasusApiError(403, "FORBIDDEN", "forbidden")
    result = _run()
    assert result.exit_code == 0, result.output
    assert "incomplete" in result.output
    assert "integrations" in result.output
    # The readable plane is still printed.
    assert "DEFAULT_REGION" in result.output


def test_exits_nonzero_when_neither_plane_is_readable() -> None:
    _FakeClient.workflows_error = PegasusApiError(403, "FORBIDDEN", "forbidden")
    _FakeClient.integrations_error = PegasusApiError(403, "FORBIDDEN", "forbidden")
    result = _run()
    assert result.exit_code == 1
    assert "could not read" in result.output
