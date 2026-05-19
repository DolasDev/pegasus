"""``pegasus-workflows package`` — zip each declared workflow into ``dist/``.

One zip per ``[[workflow]]`` table, named ``<name>-<version>.zip``. The zip
contains the workflow's ``source_dir`` tree plus the manifest, so the server
stores a self-describing artifact.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import typer

from ..manifest import MANIFEST_FILENAME, Manifest, ManifestError, load_manifest

__all__ = ["package_command", "package_workflow", "package_project"]

#: Files/directories never included in a workflow artifact.
_EXCLUDE_DIRS = {"__pycache__", ".git", "dist", ".venv", "venv", ".pytest_cache"}
_EXCLUDE_SUFFIXES = {".pyc", ".pyo"}


def _should_include(rel_path: Path) -> bool:
    """Return whether a file at *rel_path* (relative to the project) belongs
    in an artifact zip."""
    if any(part in _EXCLUDE_DIRS for part in rel_path.parts):
        return False
    return rel_path.suffix not in _EXCLUDE_SUFFIXES


def package_workflow(project_dir: Path, manifest: Manifest, dist_dir: Path) -> Path:
    """Zip a single workflow into ``dist/<name>-<version>.zip``.

    Args:
        project_dir: Project root (holds ``pegasus-workflows.toml``).
        manifest: The workflow to package.
        dist_dir: Output directory for the zip.

    Returns:
        Path to the written zip.

    Raises:
        ManifestError: If the workflow's ``source_dir`` does not exist.
    """
    source_dir = project_dir / manifest.source_dir
    if not source_dir.is_dir():
        raise ManifestError(
            f"workflow {manifest.name}: source_dir '{manifest.source_dir}' not found"
        )

    dist_dir.mkdir(parents=True, exist_ok=True)
    zip_path = dist_dir / f"{manifest.name}-{manifest.version}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(source_dir.rglob("*")):
            if not file.is_file():
                continue
            rel = file.relative_to(project_dir)
            if not _should_include(rel):
                continue
            archive.write(file, rel)
        # Include the manifest so the artifact is self-describing.
        manifest_file = project_dir / MANIFEST_FILENAME
        if manifest_file.is_file():
            archive.write(manifest_file, MANIFEST_FILENAME)

    return zip_path


def package_project(project_dir: Path) -> list[tuple[Manifest, Path]]:
    """Package every workflow declared in a project.

    Args:
        project_dir: Project root.

    Returns:
        ``(manifest, zip_path)`` pairs, one per declared workflow.
    """
    manifests = load_manifest(project_dir)
    dist_dir = project_dir / "dist"
    return [(m, package_workflow(project_dir, m, dist_dir)) for m in manifests]


def package_command(
    project_dir: Path = typer.Option(
        Path("."),
        "--project-dir",
        "-C",
        help="Project directory containing pegasus-workflows.toml.",
        exists=True,
        file_okay=False,
        dir_okay=True,
    ),
) -> None:
    """Zip every declared workflow into ``dist/``."""
    try:
        results = package_project(project_dir.resolve())
    except ManifestError as exc:
        typer.secho(f"manifest error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    for manifest, zip_path in results:
        size = zip_path.stat().st_size
        typer.secho(
            f"packaged {manifest.name}@{manifest.version} -> {zip_path} ({size} bytes)",
            fg=typer.colors.GREEN,
        )
