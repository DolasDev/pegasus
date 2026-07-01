"""Tests for ``pegasus-workflows setup`` — the first-run bootstrap."""

from __future__ import annotations

import json
import re
import stat
from pathlib import Path

import pytest
from typer.testing import CliRunner

from pegasus_workflows import credentials as cr
from pegasus_workflows.cli import app
from pegasus_workflows.cli.setup import (
    MCP_SERVER_NAME,
    merge_mcp_config,
)

runner = CliRunner()


@pytest.fixture(autouse=True)
def _creds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    creds = tmp_path / "credentials"
    monkeypatch.setenv(cr.CREDENTIALS_FILE_ENV_VAR, str(creds))
    monkeypatch.delenv(cr.TOKEN_ENV_VAR, raising=False)
    monkeypatch.delenv(cr.BASE_URL_ENV_VAR, raising=False)
    return creds


# ── pure merge helper ─────────────────────────────────────────────────────────


def test_merge_creates_when_absent() -> None:
    doc, action = merge_mcp_config(None, force=False)
    assert action == "created"
    assert doc["mcpServers"][MCP_SERVER_NAME] == {
        "command": "pegasus-workflows",
        "args": ["mcp"],
    }


def test_merge_preserves_other_servers() -> None:
    existing = {"mcpServers": {"other": {"command": "x", "args": []}}, "keep": 1}
    doc, action = merge_mcp_config(existing, force=False)
    assert action == "created"
    assert "other" in doc["mcpServers"]
    assert doc["keep"] == 1


def test_merge_refuses_existing_without_force() -> None:
    existing = {"mcpServers": {MCP_SERVER_NAME: {"command": "old", "args": []}}}
    with pytest.raises(FileExistsError):
        merge_mcp_config(existing, force=False)


def test_merge_overwrites_with_force() -> None:
    existing = {"mcpServers": {MCP_SERVER_NAME: {"command": "old", "args": []}}}
    doc, action = merge_mcp_config(existing, force=True)
    assert action == "updated"
    assert doc["mcpServers"][MCP_SERVER_NAME]["command"] == "pegasus-workflows"


# ── --print-mcp-config ─────────────────────────────────────────────────────────


def test_print_mcp_config_emits_stanza_and_writes_nothing(
    tmp_path: Path, _creds: Path
) -> None:
    mcp = tmp_path / ".mcp.json"
    result = runner.invoke(app, ["setup", "--print-mcp-config", "--mcp-config", str(mcp)])
    assert result.exit_code == 0, result.output
    parsed = json.loads(result.output)
    assert parsed["mcpServers"][MCP_SERVER_NAME]["args"] == ["mcp"]
    # No files written — neither the MCP config nor the credentials file.
    assert not mcp.exists()
    assert not _creds.exists()


# ── full flag-driven run (scriptable, zero prompts) ────────────────────────────


def test_setup_all_flags_seeds_profile_and_writes_mcp(tmp_path: Path, _creds: Path) -> None:
    mcp = tmp_path / "proj" / ".mcp.json"
    result = runner.invoke(
        app,
        [
            "setup",
            "--profile",
            "qa",
            "--api-key",
            "vnd_secret",
            "--api-root",
            "https://qa.example",
            "--mcp-config",
            str(mcp),
        ],
    )
    assert result.exit_code == 0, result.output

    # Profile seeded at 0600 with the key.
    assert stat.S_IMODE(_creds.stat().st_mode) == 0o600
    assert cr.load_profiles()["qa"]["api_key"] == "vnd_secret"

    # MCP config written with the pegasus stanza.
    doc = json.loads(mcp.read_text())
    assert doc["mcpServers"][MCP_SERVER_NAME]["command"] == "pegasus-workflows"

    # The api_key must NEVER land in the MCP config.
    assert "vnd_secret" not in mcp.read_text()


def test_setup_is_idempotent_and_wont_clobber_without_force(
    tmp_path: Path, _creds: Path
) -> None:
    mcp = tmp_path / ".mcp.json"
    args = ["setup", "--profile", "qa", "--api-key", "vnd_a", "--mcp-config", str(mcp)]
    first = runner.invoke(app, args)
    assert first.exit_code == 0, first.output

    # Second run: pegasus entry already there → left unchanged, still exit 0.
    second = runner.invoke(app, args)
    assert second.exit_code == 0, second.output
    assert "already registered" in second.output or "unchanged" in second.output
    # Only one pegasus entry, still valid JSON.
    doc = json.loads(mcp.read_text())
    assert doc["mcpServers"][MCP_SERVER_NAME]["command"] == "pegasus-workflows"


def test_setup_force_overwrites_existing_entry(tmp_path: Path, _creds: Path) -> None:
    mcp = tmp_path / ".mcp.json"
    mcp.write_text(
        json.dumps({"mcpServers": {MCP_SERVER_NAME: {"command": "stale", "args": []}}})
    )
    result = runner.invoke(
        app,
        ["setup", "--api-key", "vnd_a", "--mcp-config", str(mcp), "--force"],
    )
    assert result.exit_code == 0, result.output
    doc = json.loads(mcp.read_text())
    assert doc["mcpServers"][MCP_SERVER_NAME]["command"] == "pegasus-workflows"


def test_setup_preserves_other_mcp_servers(tmp_path: Path, _creds: Path) -> None:
    mcp = tmp_path / ".mcp.json"
    mcp.write_text(json.dumps({"mcpServers": {"other": {"command": "y", "args": []}}}))
    result = runner.invoke(
        app, ["setup", "--api-key", "vnd_a", "--mcp-config", str(mcp)]
    )
    assert result.exit_code == 0, result.output
    doc = json.loads(mcp.read_text())
    assert "other" in doc["mcpServers"]
    assert MCP_SERVER_NAME in doc["mcpServers"]


def test_setup_skip_mcp_only_seeds_profile(tmp_path: Path, _creds: Path) -> None:
    mcp = tmp_path / ".mcp.json"
    result = runner.invoke(
        app,
        ["setup", "--api-key", "vnd_a", "--skip-mcp", "--mcp-config", str(mcp)],
    )
    assert result.exit_code == 0, result.output
    assert _creds.exists()
    assert not mcp.exists()


# ── non-interactive guards ─────────────────────────────────────────────────────


def test_setup_no_key_no_profile_noninteractive_fails(tmp_path: Path, _creds: Path) -> None:
    # CliRunner stdin is not a tty → non-interactive; no key + no profile is fatal.
    mcp = tmp_path / ".mcp.json"
    result = runner.invoke(app, ["setup", "--mcp-config", str(mcp)])
    assert result.exit_code == 1
    assert "api_key" in result.output


def test_setup_no_key_keeps_existing_profile(tmp_path: Path, _creds: Path) -> None:
    cr.write_profile("default", api_key="vnd_existing", api_root=None)
    mcp = tmp_path / ".mcp.json"
    result = runner.invoke(app, ["setup", "--mcp-config", str(mcp)])
    assert result.exit_code == 0, result.output
    # Existing profile untouched, MCP still registered.
    assert cr.load_profiles()["default"]["api_key"] == "vnd_existing"
    assert mcp.exists()


# ── discoverability aliases ────────────────────────────────────────────────────


@pytest.mark.parametrize("flag", ["--setup", "--configure"])
def test_top_level_alias_points_at_setup(flag: str) -> None:
    result = runner.invoke(app, [flag])
    assert result.exit_code == 0, result.output
    assert "pegasus-workflows setup" in result.output


def _plain(text: str) -> str:
    """Strip ANSI escapes and collapse whitespace — rich wraps/paints help output,
    so assert on normalized text rather than raw bytes (which vary by terminal width)."""
    no_ansi = re.sub(r"\x1b\[[0-9;]*m", "", text)
    return " ".join(no_ansi.split())


def test_help_mentions_setup_front_door() -> None:
    # Force a wide terminal so rich doesn't wrap/truncate the option tokens
    # (CI renders at a narrow width, which split "--setup,--configure" mid-token
    # in the raw output and made a naive substring check flaky).
    result = runner.invoke(app, ["--help"], env={"COLUMNS": "400"})
    assert result.exit_code == 0
    plain = _plain(result.output)
    assert "setup" in plain
    assert "--setup" in plain and "--configure" in plain
