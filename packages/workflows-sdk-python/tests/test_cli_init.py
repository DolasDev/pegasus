"""Tests for ``pegasus-workflows init`` scaffolding."""

from __future__ import annotations

from pathlib import Path

import pytest

from pegasus_workflows.cli.init import render_project
from pegasus_workflows.manifest import load_manifest


def test_render_project_creates_valid_project(tmp_path: Path) -> None:
    project = render_project("demo", tmp_path)

    assert project == tmp_path / "demo"
    assert (project / "pegasus-workflows.toml").is_file()
    assert (project / "demo" / "workflow.py").is_file()
    assert (project / "pyproject.toml").is_file()

    # The scaffolded manifest must itself parse and validate.
    manifests = load_manifest(project)
    assert len(manifests) == 1
    assert manifests[0].name == "demo"
    assert manifests[0].version == "0.1.0"


def test_render_project_substitutes_name(tmp_path: Path) -> None:
    project = render_project("payroll_sync", tmp_path)
    toml_text = (project / "pegasus-workflows.toml").read_text()
    assert "payroll_sync" in toml_text
    assert "__WORKFLOW_NAME__" not in toml_text
    # The source directory is renamed too.
    assert (project / "payroll_sync" / "workflow.py").is_file()


def test_render_project_rejects_bad_name(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="invalid project name"):
        render_project("Bad Name", tmp_path)


def test_render_project_rejects_existing_dir(tmp_path: Path) -> None:
    (tmp_path / "demo").mkdir()
    with pytest.raises(FileExistsError):
        render_project("demo", tmp_path)
