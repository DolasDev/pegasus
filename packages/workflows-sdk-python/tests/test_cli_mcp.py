"""Tests for ``pegasus-workflows mcp`` — the AI-authoring MCP server."""

from __future__ import annotations

import asyncio
import sys
import textwrap
from pathlib import Path

import pytest

from pegasus_workflows.cli.mcp_server import (
    resource_guide_authoring,
    resource_guide_secrets_config,
    resource_reference_api,
    resource_reference_manifest,
    tool_diagram_prompt,
    tool_package_project,
    tool_scaffold_workflow,
    tool_validate_manifest,
)
from pegasus_workflows.manifest import ManifestError, validate_manifest_fields

# ── Helper ────────────────────────────────────────────────────────────────────


def _make_toml(name: str = "demo", version: str = "0.1.0") -> str:
    return textwrap.dedent(f"""
        [[workflow]]
        name = "{name}"
        version = "{version}"
        entry_points = ["{name}.workflow:HelloWorkflow"]
        source_dir = "{name}"
    """).strip()


# ── test: missing mcp extra ───────────────────────────────────────────────────


def test_mcp_command_exits_when_extra_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Invoking ``mcp`` when the extra is uninstalled exits non-zero with a message
    that names the ``mcp`` extra and the install command."""
    # Poison the entry point so Python raises ImportError on every import attempt.
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", None)  # type: ignore[arg-type]

    from typer.testing import CliRunner

    from pegasus_workflows.cli import app

    runner = CliRunner()
    result = runner.invoke(app, ["mcp"])

    assert result.exit_code == 1
    # Message must mention 'mcp' (so the user knows what extra to install).
    combined = result.output + (result.stderr or "")
    assert "mcp" in combined.lower()
    assert "pip install" in combined


def test_missing_extra_message_content() -> None:
    """The hardcoded error message names the extra and the install command."""
    from pegasus_workflows.cli.mcp_server import _MISSING_EXTRA_MSG

    assert "mcp" in _MISSING_EXTRA_MSG
    assert "pip install" in _MISSING_EXTRA_MSG
    assert "pegasus-workflows-sdk[mcp]" in _MISSING_EXTRA_MSG


# ── test: validate_manifest tool ──────────────────────────────────────────────


def test_validate_manifest_rejects_bad_name() -> None:
    """``validate_manifest`` rejects a bad workflow name with the same error text as
    ``validate_manifest_fields``."""
    bad_name = "Bad Name"
    toml = _make_toml(name=bad_name)

    # Capture what validate_manifest_fields raises.
    try:
        validate_manifest_fields(bad_name, "0.1.0", ["demo.workflow:Demo"])
    except ManifestError as exc:
        expected_fragment = str(exc)
    else:
        pytest.fail("validate_manifest_fields should have raised ManifestError")

    result = tool_validate_manifest(toml)
    assert result["ok"] is False
    assert expected_fragment in result["error"]


def test_validate_manifest_accepts_scaffolded_project(tmp_path: Path) -> None:
    """``validate_manifest`` accepts a real scaffolded project's manifest file."""
    from pegasus_workflows.cli.init import render_project

    project_dir = render_project("my_wf", tmp_path)
    manifest_path = project_dir / "pegasus-workflows.toml"

    result = tool_validate_manifest(str(manifest_path))
    assert result["ok"] is True
    assert len(result["manifests"]) == 1
    assert result["manifests"][0]["name"] == "my_wf"


def test_validate_manifest_accepts_valid_toml_text() -> None:
    """``validate_manifest`` accepts valid TOML text (not a file path)."""
    toml = _make_toml()
    result = tool_validate_manifest(toml)
    assert result["ok"] is True
    assert result["manifests"][0]["name"] == "demo"


def test_validate_manifest_rejects_invalid_version_toml() -> None:
    """``validate_manifest`` returns ok=False for a bad version string."""
    toml = _make_toml(version="not-semver")
    result = tool_validate_manifest(toml)
    assert result["ok"] is False
    assert "version" in result["error"].lower()


# ── test: scaffold_workflow tool ─────────────────────────────────────────────


def test_scaffold_workflow_produces_same_tree_as_render_project(tmp_path: Path) -> None:
    """``scaffold_workflow`` produces the same file tree as ``render_project``."""
    from pegasus_workflows.cli.init import render_project

    tool_dest = tmp_path / "tool"
    tool_dest.mkdir()
    render_dest = tmp_path / "render"
    render_dest.mkdir()

    tool_result = tool_scaffold_workflow("alpha", str(tool_dest))
    render_dir = render_project("alpha", render_dest)

    assert tool_result["ok"] is True

    tool_files = set(tool_result["files"])
    render_files = {
        str(p.relative_to(render_dir))
        for p in render_dir.rglob("*")
        if p.is_file()
    }
    assert tool_files == render_files


def test_scaffold_workflow_rejects_bad_name(tmp_path: Path) -> None:
    """``scaffold_workflow`` returns ok=False for an invalid name."""
    result = tool_scaffold_workflow("Bad Name", str(tmp_path))
    assert result["ok"] is False
    assert "invalid project name" in result["error"].lower()


def test_scaffold_workflow_includes_manifest(tmp_path: Path) -> None:
    """The scaffolded project includes a valid ``pegasus-workflows.toml``."""
    result = tool_scaffold_workflow("myflow", str(tmp_path))
    assert result["ok"] is True
    project_dir = Path(result["project_dir"])
    assert (project_dir / "pegasus-workflows.toml").is_file()


# ── test: package_project tool ───────────────────────────────────────────────


def test_package_project_returns_zip_matching_cli(tmp_path: Path) -> None:
    """``package_project`` returns a zip that exists and matches CLI output."""
    from pegasus_workflows.cli.init import render_project
    from pegasus_workflows.cli.package import package_project as cli_package

    project_dir = render_project("pkgtest", tmp_path)

    result = tool_package_project(str(project_dir))
    assert result["ok"] is True
    assert len(result["artifacts"]) == 1

    artifact = result["artifacts"][0]
    assert artifact["name"] == "pkgtest"
    zip_path = Path(artifact["zip_path"])
    assert zip_path.is_file()
    assert artifact["size_bytes"] == zip_path.stat().st_size

    # Matches the zip the CLI would produce for the same project.
    cli_results = cli_package(project_dir)
    assert len(cli_results) == 1
    _cli_manifest, cli_zip = cli_results[0]
    assert zip_path.name == cli_zip.name


# ── test: diagram_prompt tool ────────────────────────────────────────────────


def test_diagram_prompt_returns_prompt_with_source_and_path(tmp_path: Path) -> None:
    """``diagram_prompt`` returns a BYO-agent prompt naming the output path + source."""
    from pegasus_workflows.cli.init import render_project

    project_dir = render_project("dgtest", tmp_path)

    result = tool_diagram_prompt(str(project_dir))
    assert result["ok"] is True
    assert len(result["prompts"]) == 1

    entry = result["prompts"][0]
    assert entry["workflow"] == "dgtest"
    assert entry["out_path"] == "dgtest/workflow.mmd"
    assert entry["exists"] is True  # init scaffolds a starter workflow.mmd
    assert "flowchart TD" in entry["prompt"]
    assert "dgtest/workflow.mmd" in entry["prompt"]
    # The workflow's own source is embedded in the prompt.
    assert "class" in entry["prompt"].lower() or "def" in entry["prompt"].lower()


def test_diagram_prompt_unknown_workflow_errors(tmp_path: Path) -> None:
    from pegasus_workflows.cli.init import render_project

    project_dir = render_project("dgtest", tmp_path)
    result = tool_diagram_prompt(str(project_dir), workflow="nope")
    assert result["ok"] is False
    assert "nope" in result["error"]


def test_authoring_guide_documents_byo_diagram() -> None:
    guide = resource_guide_authoring()
    assert "workflow.mmd" in guide
    assert "diagram_prompt" in guide
    # Make clear the agent draws it (no AI service does).
    assert "you" in guide.lower() and "draw" in guide.lower()


# ── test: reference/api resource ─────────────────────────────────────────────


def test_reference_api_contains_real_method_names() -> None:
    """``resource_reference_api`` lists real ``PegasusClient`` method names
    (proves introspection, not a hardcoded string)."""
    import inspect

    from pegasus_workflows.api import PegasusClient

    content = resource_reference_api()

    # Every public method must appear somewhere in the content.
    public_methods = [
        name
        for name, _ in inspect.getmembers(PegasusClient, predicate=inspect.isfunction)
        if not name.startswith("_")
    ]
    assert len(public_methods) > 0, "PegasusClient should have public methods"

    for method_name in public_methods:
        assert method_name in content, (
            f"resource_reference_api() is missing method '{method_name}'"
        )


def test_reference_api_reflects_docstring_change(monkeypatch: pytest.MonkeyPatch) -> None:
    """Changing a method docstring changes the resource content (no hardcoding)."""
    from pegasus_workflows import api

    original_doc = api.PegasusClient.list_workflows.__doc__
    try:
        api.PegasusClient.list_workflows.__doc__ = "UNIQUE_SENTINEL_DOC_XYZ"
        content = resource_reference_api()
        assert "UNIQUE_SENTINEL_DOC_XYZ" in content
    finally:
        api.PegasusClient.list_workflows.__doc__ = original_doc


def test_reference_manifest_reflects_constant(monkeypatch: pytest.MonkeyPatch) -> None:
    """Changing a manifest constant changes the resource content (no hardcoding)."""
    import pegasus_workflows.cli.mcp_server as mcp_mod
    import pegasus_workflows.manifest as mmod

    original = mmod.MANIFEST_TIMEOUT_MAX_SECONDS
    try:
        monkeypatch.setattr(mmod, "MANIFEST_TIMEOUT_MAX_SECONDS", 99999)
        monkeypatch.setattr(mcp_mod, "MANIFEST_TIMEOUT_MAX_SECONDS", 99999)
        content = resource_reference_manifest()
        assert "99999" in content
    finally:
        monkeypatch.setattr(mmod, "MANIFEST_TIMEOUT_MAX_SECONDS", original)
        monkeypatch.setattr(mcp_mod, "MANIFEST_TIMEOUT_MAX_SECONDS", original)


def test_secrets_config_guide_covers_publish_and_use() -> None:
    """The secrets/config guide documents both publishing and runtime use, and
    names the read actions a workflow must declare."""
    content = resource_guide_secrets_config()
    for token in (
        "ReadWorkflowSecret",
        "ReadWorkflowConfig",
        "required_actions",
        "get_secret",
        "get_config",
        "pegasus-workflows secrets set",
        "write-once",
    ):
        assert token in content, f"secrets-config guide is missing '{token}'"


def test_secrets_config_guide_registered_as_resource() -> None:
    """The guide must be wired onto the MCP server as a resource."""
    mcp = pytest.importorskip("mcp.server.fastmcp", reason="mcp extra not installed")
    FastMCP = mcp.FastMCP  # type: ignore[attr-defined]

    from pegasus_workflows.cli.mcp_server import _build_server

    server = _build_server(FastMCP)
    resources = asyncio.run(server.list_resources())
    uris = {str(r.uri) for r in resources}
    assert "pegasus://guide/secrets-config" in uris


# ── test: no mutating tools registered ───────────────────────────────────────


def test_no_mutating_tools_registered() -> None:
    """The MCP server must NOT expose any mutating/network-publishing tools.

    Specifically: ``push``, ``publish``, ``run``, ``send_sms`` must not appear
    as tool names.
    """
    mcp = pytest.importorskip("mcp.server.fastmcp", reason="mcp extra not installed")
    FastMCP = mcp.FastMCP  # type: ignore[attr-defined]

    from pegasus_workflows.cli.mcp_server import _build_server

    server = _build_server(FastMCP)
    tools = asyncio.run(server.list_tools())
    tool_names = {t.name for t in tools}

    forbidden_patterns = ("push", "publish", "run", "send_sms")
    for pattern in forbidden_patterns:
        matching = {n for n in tool_names if pattern in n.lower()}
        assert not matching, (
            f"Mutating tool(s) with '{pattern}' found in registered tools: {matching}"
        )


def test_registered_tools_are_only_safe_actions() -> None:
    """The registered tool names match exactly the expected safe set."""
    mcp = pytest.importorskip("mcp.server.fastmcp", reason="mcp extra not installed")
    FastMCP = mcp.FastMCP  # type: ignore[attr-defined]

    from pegasus_workflows.cli.mcp_server import _build_server

    server = _build_server(FastMCP)
    tools = asyncio.run(server.list_tools())
    tool_names = {t.name for t in tools}

    expected = {
        "scaffold_workflow",
        "validate_manifest",
        "diagram_prompt",
        "package_project",
        "validate_integration_config",
        "list_deployments",
        "list_profiles",
    }
    assert tool_names == expected
