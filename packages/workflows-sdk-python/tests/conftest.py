"""Shared fixtures for the Pegasus Workflows SDK test suite."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest


@pytest.fixture
def workflow_project(tmp_path: Path) -> Path:
    """Materialise a minimal, valid workflow project in a temp directory.

    Returns the project root, which contains a ``pegasus-workflows.toml``
    declaring one workflow ``demo`` with a ``demo/workflow.py`` source file and
    the ``demo/workflow.mmd`` diagram the publish flow requires.
    """
    project = tmp_path / "demo"
    source = project / "demo"
    source.mkdir(parents=True)

    (project / "pegasus-workflows.toml").write_text(
        textwrap.dedent(
            """
            [[workflow]]
            name = "demo"
            version = "0.1.0"
            entry_points = ["demo.workflow:HelloWorkflow"]
            source_dir = "demo"
            description = "A demo workflow."
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    (source / "__init__.py").write_text("", encoding="utf-8")
    (source / "workflow.py").write_text(
        "class HelloWorkflow:\n    pass\n", encoding="utf-8"
    )
    (source / "workflow.mmd").write_text(
        "flowchart TD\n  A[Start] --> B[Done]\n", encoding="utf-8"
    )
    return project
