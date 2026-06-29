"""Tests for ``configure`` / ``profile list`` and the shared --profile wiring."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest
from typer.testing import CliRunner

from pegasus_workflows import credentials as cr
from pegasus_workflows.cli import app

runner = CliRunner()


@pytest.fixture(autouse=True)
def _creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    creds = tmp_path / "credentials"
    monkeypatch.setenv(cr.CREDENTIALS_FILE_ENV_VAR, str(creds))
    monkeypatch.delenv(cr.TOKEN_ENV_VAR, raising=False)
    monkeypatch.delenv(cr.BASE_URL_ENV_VAR, raising=False)
    return creds


def test_configure_via_flags_writes_0600(_creds: Path) -> None:
    result = runner.invoke(
        app,
        ["configure", "--profile", "qa", "--api-key", "vnd_secret", "--api-root", "https://qa"],
    )
    assert result.exit_code == 0, result.output
    assert _creds.exists()
    assert stat.S_IMODE(_creds.stat().st_mode) == 0o600
    assert cr.load_profiles()["qa"]["api_key"] == "vnd_secret"


def test_configure_prompts_when_omitted(_creds: Path) -> None:
    # First prompt is the hidden api_key, second is api_root (has a default).
    result = runner.invoke(
        app, ["configure", "--profile", "p2"], input="vnd_prompted\nhttps://p2\n"
    )
    assert result.exit_code == 0, result.output
    profiles = cr.load_profiles()
    assert profiles["p2"]["api_key"] == "vnd_prompted"
    assert profiles["p2"]["api_root"] == "https://p2"


def test_profile_list_hides_key(_creds: Path) -> None:
    cr.write_profile("prod", api_key="vnd_TOPSECRET", api_root="https://prod")
    result = runner.invoke(app, ["profile", "list"])
    assert result.exit_code == 0, result.output
    assert "prod" in result.output
    assert "https://prod" in result.output
    assert "vnd_TOPSECRET" not in result.output


def test_profile_list_empty(_creds: Path) -> None:
    result = runner.invoke(app, ["profile", "list"])
    assert result.exit_code == 0, result.output
    assert "no profiles configured" in result.output


def test_command_without_any_credentials_errors(_creds: Path) -> None:
    result = runner.invoke(app, ["run", "demo"])
    assert result.exit_code == 1
    assert "no token" in result.output


def test_command_with_unknown_profile_errors(_creds: Path) -> None:
    result = runner.invoke(app, ["run", "demo", "--profile", "ghost"])
    assert result.exit_code == 1
    assert "no credential profile 'ghost'" in result.output
