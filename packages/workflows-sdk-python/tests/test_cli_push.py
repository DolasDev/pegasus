"""Tests for ``pegasus-workflows push`` — the deployment ledger write.

A fake PegasusClient stands in for the publish round-trip so the test exercises
packaging + the post-publish ``deployments.toml`` write without a live API.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from pegasus_workflows import credentials as cr
from pegasus_workflows import deployments as dp
from pegasus_workflows.cli import app
from pegasus_workflows.cli import push as push_mod

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    def __init__(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
        pass

    def request_upload_url(self, name, version, size_bytes):  # noqa: ANN001
        return {"workflowId": "wf-xyz", "uploadUrl": "https://s3.example/put"}

    def upload_artifact(self, upload_url, artifact):  # noqa: ANN001
        pass

    def finalize(self, workflow_id, manifest):  # noqa: ANN001
        return {"id": "wf-xyz", "visibility": "GLOBAL"}


@pytest.fixture(autouse=True)
def _patched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(push_mod, "PegasusClient", _FakeClient)
    # Hermetic credentials: explicit --token is supplied, but isolate ambient env.
    monkeypatch.setenv(cr.CREDENTIALS_FILE_ENV_VAR, str(tmp_path / "credentials"))
    monkeypatch.delenv(cr.TOKEN_ENV_VAR, raising=False)
    monkeypatch.delenv(cr.BASE_URL_ENV_VAR, raising=False)


def test_push_writes_ledger_with_explicit_env(workflow_project: Path) -> None:
    result = runner.invoke(
        app, ["push", "-C", str(workflow_project), "--token", _TOKEN, "--env", "qa"]
    )
    assert result.exit_code == 0, result.output
    assert "recorded deployment [qa]" in result.output
    data = dp.read_deployments(workflow_project)
    assert data["qa"]["workflow_id"] == "wf-xyz"
    assert data["qa"]["version"] == "0.1.0"
    assert data["qa"]["visibility"] == "GLOBAL"


def test_push_derives_env_from_base_url(workflow_project: Path) -> None:
    result = runner.invoke(
        app, ["push", "-C", str(workflow_project), "--token", _TOKEN]
    )
    assert result.exit_code == 0, result.output
    data = dp.read_deployments(workflow_project)
    # Default base URL is http://localhost:3000 → host "localhost".
    assert data["localhost"]["workflow_id"] == "wf-xyz"
