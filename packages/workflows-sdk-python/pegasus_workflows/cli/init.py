"""``pegasus-workflows init`` — scaffold a new workflow project.

Copies the files under ``pegasus_workflows/templates/`` into a fresh project
directory, substituting the chosen project name. The scaffold is a working
project: ``package``, ``push``, and ``test`` all run against it immediately.
"""

from __future__ import annotations

import importlib.resources as resources
from pathlib import Path

import typer

from ..manifest import NAME_REGEX

__all__ = ["init_command", "render_project"]

#: Token replaced with the project name in every template file.
_NAME_TOKEN = "__WORKFLOW_NAME__"


def _template_files() -> dict[str, str]:
    """Return ``relative_path -> file contents`` for every template file."""
    root = resources.files("pegasus_workflows.templates")
    files: dict[str, str] = {}

    def _walk(node: resources.abc.Traversable, prefix: str) -> None:
        for child in node.iterdir():
            # Skip compiled-bytecode artifacts. An installed package can carry a
            # ``__pycache__`` dir (with non-UTF-8 ``.pyc`` files) inside the
            # templates tree; reading those as text raises UnicodeDecodeError.
            if child.name == "__pycache__":
                continue
            if child.name.endswith((".pyc", ".pyo")):
                continue
            rel = f"{prefix}{child.name}"
            if child.is_dir():
                _walk(child, f"{rel}/")
            else:
                files[rel] = child.read_text(encoding="utf-8")

    _walk(root, "")
    return files


def render_project(name: str, dest: Path) -> Path:
    """Materialise a workflow project named *name* into *dest*.

    Args:
        name: Project / workflow name. Must match the workflow name regex.
        dest: Parent directory; the project is created at ``dest/name``.

    Returns:
        Path to the created project directory.

    Raises:
        ValueError: If *name* is invalid.
        FileExistsError: If the target directory already exists.
    """
    if not NAME_REGEX.match(name):
        raise ValueError(
            f"invalid project name {name!r}: must be lowercase letters/digits/_/-, 1-64 chars"
        )
    project_dir = dest / name
    if project_dir.exists():
        raise FileExistsError(f"{project_dir} already exists")

    for rel, contents in _template_files().items():
        # Template paths use the name token in directory names too.
        target_rel = rel.replace(_NAME_TOKEN, name)
        target = project_dir / target_rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents.replace(_NAME_TOKEN, name), encoding="utf-8")

    return project_dir


def init_command(
    name: str = typer.Argument(..., help="Workflow project name (lowercase, e.g. 'demo')."),
    dest: Path = typer.Option(
        Path("."),
        "--dest",
        "-d",
        help="Parent directory to create the project under.",
    ),
) -> None:
    """Scaffold a new workflow project named NAME."""
    try:
        project_dir = render_project(name, dest.resolve())
    except (ValueError, FileExistsError) as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(f"created workflow project at {project_dir}", fg=typer.colors.GREEN)
    typer.echo("next steps:")
    typer.echo(f"  cd {project_dir}")
    typer.echo("  pegasus-workflows package")
    typer.echo("  pegasus-workflows push --token=<vnd_...> --base-url=http://localhost:3000")
    typer.echo(f"  pegasus-workflows test {name}")
