"""Tests for ``pegasus-workflows diagram``.

The Anthropic call is never made — a fake client stands in for the SDK, so the
tests need neither the ``anthropic`` extra nor an API key.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import typer
from typer.testing import CliRunner

from pegasus_workflows.cli import diagram as diag

runner = CliRunner()

# Wrap the bare command function in a Typer app so CliRunner can invoke it.
_app = typer.Typer()
_app.command()(diag.diagram_command)


class _FakeBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _FakeMessage:
    def __init__(self, text: str) -> None:
        self.content = [_FakeBlock(text)]


class _FakeMessages:
    def __init__(self, text: str) -> None:
        self._text = text

    def create(self, **_kwargs):  # noqa: ANN003 - mirrors anthropic SDK shape
        return _FakeMessage(self._text)


class _FakeClient:
    def __init__(self, text: str = "flowchart TD\n  A[Start] --> B[greet]") -> None:
        self.messages = _FakeMessages(text)


def test_extract_mermaid_strips_fences_and_prose() -> None:
    raw = "Here is the diagram:\n```mermaid\nflowchart TD\n  A --> B\n```\nDone."
    assert diag.extract_mermaid(raw) == "flowchart TD\n  A --> B"


def test_extract_mermaid_handles_bare_directive() -> None:
    assert diag.extract_mermaid("flowchart TD\n  A --> B") == "flowchart TD\n  A --> B"


def test_generate_mermaid_returns_diagram_from_client() -> None:
    from pegasus_workflows.manifest import Manifest

    m = Manifest(name="demo", version="0.1.0", entry_points=["demo.workflow:X"], source_dir="demo")
    out = diag.generate_mermaid(_FakeClient(), "claude-opus-4-8", m, "class X: pass")
    assert out.startswith("flowchart TD")


def test_diagram_command_writes_mmd(
    workflow_project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Start clean so the command actually generates (it skips when the file exists).
    (workflow_project / "demo" / "workflow.mmd").unlink()
    monkeypatch.setattr(diag, "_load_anthropic_client", lambda: _FakeClient())

    result = runner.invoke(_app, ["--project-dir", str(workflow_project)])
    assert result.exit_code == 0, result.output
    written = (workflow_project / "demo" / "workflow.mmd").read_text(encoding="utf-8")
    assert "flowchart TD" in written


def test_diagram_command_skips_existing_without_force(
    workflow_project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fixture already ships a workflow.mmd; without --force it is left alone.
    (workflow_project / "demo" / "workflow.mmd").write_text("ORIGINAL", encoding="utf-8")
    monkeypatch.setattr(diag, "_load_anthropic_client", lambda: _FakeClient())

    result = runner.invoke(_app, ["--project-dir", str(workflow_project)])
    assert result.exit_code == 0, result.output
    assert (workflow_project / "demo" / "workflow.mmd").read_text(encoding="utf-8") == "ORIGINAL"
