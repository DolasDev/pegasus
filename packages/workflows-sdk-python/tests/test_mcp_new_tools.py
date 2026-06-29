"""Tests for the read-only MCP tools added in 0.6.0: list_deployments, list_profiles."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from pegasus_workflows import credentials as cr
from pegasus_workflows.cli import mcp_server as ms


def test_list_deployments_reads_ledger(tmp_path: Path) -> None:
    (tmp_path / "deployments.toml").write_text(
        '[prod]\nworkflow_id = "wf-1"\nversion = "0.1.0"\n', encoding="utf-8"
    )
    out = ms.tool_list_deployments(str(tmp_path))
    assert out["ok"] is True
    assert out["deployments"]["prod"]["workflow_id"] == "wf-1"


def test_list_deployments_missing_is_empty(tmp_path: Path) -> None:
    out = ms.tool_list_deployments(str(tmp_path))
    assert out == {"ok": True, "deployments": {}}


def test_list_profiles_never_returns_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    creds = tmp_path / "credentials"
    monkeypatch.setenv(cr.CREDENTIALS_FILE_ENV_VAR, str(creds))
    cr.write_profile("prod", api_key="vnd_TOPSECRET", api_root="https://prod")

    out = ms.tool_list_profiles()
    assert out["ok"] is True
    assert out["profiles"] == [{"name": "prod", "api_root": "https://prod"}]
    assert "vnd_TOPSECRET" not in repr(out)


def test_new_tools_registered_and_no_mutation_added() -> None:
    mcp = pytest.importorskip("mcp.server.fastmcp", reason="mcp extra not installed")
    server = ms._build_server(mcp.FastMCP)
    tool_names = {t.name for t in asyncio.run(server.list_tools())}
    assert {"list_deployments", "list_profiles"} <= tool_names
    # The read-only invariant still holds — nothing mutating/network-publishing.
    for pattern in ("push", "publish", "run", "send_sms"):
        assert not {n for n in tool_names if pattern in n.lower()}
