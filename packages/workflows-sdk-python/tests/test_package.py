"""Tests for the ``package`` step — manifest-driven artifact zipping."""

from __future__ import annotations

import zipfile
from pathlib import Path

from pegasus_workflows.cli.package import package_project


def test_package_produces_one_zip_per_workflow(workflow_project: Path) -> None:
    results = package_project(workflow_project)
    assert len(results) == 1
    manifest, zip_path = results[0]
    assert zip_path.name == "demo-0.1.0.zip"
    assert zip_path.is_file()
    assert manifest.name == "demo"


def test_artifact_contains_source_and_manifest(workflow_project: Path) -> None:
    _, zip_path = package_project(workflow_project)[0]
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
    assert "demo/workflow.py" in names
    assert "demo/__init__.py" in names
    assert "pegasus-workflows.toml" in names


def test_artifact_excludes_pycache(workflow_project: Path) -> None:
    pycache = workflow_project / "demo" / "__pycache__"
    pycache.mkdir()
    (pycache / "workflow.cpython-312.pyc").write_bytes(b"\x00")
    (workflow_project / "demo" / "stray.pyc").write_bytes(b"\x00")

    _, zip_path = package_project(workflow_project)[0]
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
    assert not any("__pycache__" in n for n in names)
    assert not any(n.endswith(".pyc") for n in names)


def test_package_writes_into_dist(workflow_project: Path) -> None:
    package_project(workflow_project)
    assert (workflow_project / "dist").is_dir()
