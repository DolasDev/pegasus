"""Tests for ``pegasus-workflows diagram``.

The command never calls an LLM — it prints a bring-your-own-agent prompt — so the
tests need no ``anthropic`` extra and no API key.
"""

from __future__ import annotations

from pathlib import Path

import typer
from typer.testing import CliRunner

from pegasus_workflows.cli import diagram as diag

runner = CliRunner()

# Wrap the bare command function in a Typer app so CliRunner can invoke it.
_app = typer.Typer()
_app.command()(diag.diagram_command)


def test_build_diagram_prompt_names_output_path_and_includes_source() -> None:
    prompt = diag.build_diagram_prompt("demo", "demo/workflow.mmd", "class X: pass")
    assert "demo/workflow.mmd" in prompt
    assert "flowchart TD" in prompt
    assert "class X: pass" in prompt


def test_diagram_command_prints_prompt_without_writing_mmd(workflow_project: Path) -> None:
    # The fixture ships a workflow.mmd; the command must NOT overwrite it.
    mmd = workflow_project / "demo" / "workflow.mmd"
    mmd.write_text("ORIGINAL", encoding="utf-8")

    result = runner.invoke(_app, ["--project-dir", str(workflow_project)])
    assert result.exit_code == 0, result.output
    # Prompt is emitted to stdout, naming the output path...
    assert "demo/workflow.mmd" in result.stdout
    assert "flowchart TD" in result.stdout
    # ...and the existing diagram is left untouched.
    assert mmd.read_text(encoding="utf-8") == "ORIGINAL"


def test_diagram_command_writes_prompt_to_out_file(
    workflow_project: Path, tmp_path: Path
) -> None:
    out = tmp_path / "prompt.txt"
    result = runner.invoke(
        _app, ["--project-dir", str(workflow_project), "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    body = out.read_text(encoding="utf-8")
    assert "demo/workflow.mmd" in body
    assert "flowchart TD" in body
    # Nothing diagram-related goes to stdout when --out is used.
    assert "flowchart TD" not in result.stdout


def test_diagram_command_unknown_workflow_errors(workflow_project: Path) -> None:
    result = runner.invoke(
        _app, ["--project-dir", str(workflow_project), "--workflow", "nope"]
    )
    assert result.exit_code == 1
