"""Tests for ``pegasus-workflows init`` scaffolding."""

from __future__ import annotations

from pathlib import Path

import pytest

import pegasus_workflows
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


def test_render_project_ignores_compiled_bytecode(tmp_path: Path) -> None:
    """An installed package can carry a ``__pycache__`` with non-UTF-8 ``.pyc``
    files inside the templates tree (the template source dir is package-shaped).
    The scaffolder must skip those, not choke decoding them as text.
    """
    pkg_root = Path(pegasus_workflows.__file__).parent
    pkg_dir = pkg_root / "templates" / "__WORKFLOW_NAME__"
    pycache = pkg_dir / "__pycache__"
    pycache.mkdir(exist_ok=True)
    junk = pycache / "workflow.cpython-312.pyc"
    # Bytes that are invalid UTF-8 — mimics a real compiled-bytecode header.
    junk.write_bytes(b"\xcb\x0d\x0d\x0a\x00\x00\x00\x00\xdb\xff\xfe")
    try:
        project = render_project("demo", tmp_path)
    finally:
        junk.unlink()
        pycache.rmdir()

    # Project scaffolded cleanly and no bytecode leaked into the output.
    assert (project / "demo" / "workflow.py").is_file()
    assert not list(project.rglob("*.pyc"))
    assert not list(project.rglob("__pycache__"))
