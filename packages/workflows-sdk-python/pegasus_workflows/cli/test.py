"""``pegasus-workflows test`` — run a workflow against local Temporal.

Resolves the named workflow from the project manifest, ensures a local
Temporal server is running (starting ``docker-compose.temporal.yml`` if
needed), spins up an in-process worker, and executes the workflow once with
stub inputs. This is the Phase-1 local-dev loop — there is no server-side
execution yet.
"""

from __future__ import annotations

import asyncio
import importlib
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import typer

from ..manifest import Manifest, ManifestError, load_manifest

__all__ = ["test_command"]

#: Host/port the local Temporal server listens on (see docker-compose.temporal.yml).
TEMPORAL_HOST = "127.0.0.1"
TEMPORAL_PORT = 7233
#: Compose file name, looked up from the project dir upwards to the repo root.
COMPOSE_FILENAME = "docker-compose.temporal.yml"


def _temporal_reachable(timeout: float = 1.0) -> bool:
    """Return whether the local Temporal frontend port accepts connections."""
    try:
        with socket.create_connection((TEMPORAL_HOST, TEMPORAL_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def _find_compose_file(start: Path) -> Path | None:
    """Search *start* and its ancestors for ``docker-compose.temporal.yml``."""
    for directory in [start, *start.parents]:
        candidate = directory / COMPOSE_FILENAME
        if candidate.is_file():
            return candidate
    return None


def _ensure_temporal(project_dir: Path) -> None:
    """Ensure a local Temporal server is reachable, starting it if needed.

    Raises:
        typer.Exit: If Temporal is down and cannot be started.
    """
    if _temporal_reachable():
        typer.echo(f"-> Temporal already reachable at {TEMPORAL_HOST}:{TEMPORAL_PORT}")
        return

    compose_file = _find_compose_file(project_dir)
    if compose_file is None:
        typer.secho(
            f"Temporal is not running and no {COMPOSE_FILENAME} was found near "
            f"{project_dir}. Start Temporal manually or run from inside the repo.",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    if shutil.which("docker") is None:
        typer.secho("docker is not installed — cannot start Temporal.", fg=typer.colors.RED,
                     err=True)
        raise typer.Exit(code=1)

    typer.echo(f"-> starting Temporal via {compose_file}")
    subprocess.run(
        ["docker", "compose", "-f", str(compose_file), "up", "-d"],
        check=True,
    )

    deadline = time.time() + 90
    while time.time() < deadline:
        if _temporal_reachable():
            typer.secho("-> Temporal is up", fg=typer.colors.GREEN)
            return
        time.sleep(2)
    typer.secho("Temporal did not become reachable within 90s", fg=typer.colors.RED, err=True)
    raise typer.Exit(code=1)


def _resolve_workflow(project_dir: Path, name: str) -> tuple[Manifest, type, list]:
    """Import the workflow class and its activities for *name*.

    Returns:
        ``(manifest, workflow_class, activity_callables)``.
    """
    manifests = load_manifest(project_dir)
    manifest = next((m for m in manifests if m.name == name), None)
    if manifest is None:
        known = ", ".join(m.name for m in manifests) or "(none)"
        raise ManifestError(f"workflow '{name}' not in manifest. Declared: {known}")

    if str(project_dir) not in sys.path:
        sys.path.insert(0, str(project_dir))

    entry = manifest.entry_points[0]
    module_path, _, class_name = entry.partition(":")
    if not module_path or not class_name:
        raise ManifestError(
            f"entry point '{entry}' must be 'module.path:ClassName'"
        )
    module = importlib.import_module(module_path)
    workflow_cls = getattr(module, class_name)

    # Collect any temporalio activity callables defined in the same module.
    activities = [
        obj
        for obj in vars(module).values()
        if callable(obj) and hasattr(obj, "__temporal_activity_definition")
    ]
    return manifest, workflow_cls, activities


async def _run(workflow_cls: type, activities: list, stub_input: str) -> object:
    """Start a worker and execute the workflow once, returning its result."""
    from temporalio.client import Client
    from temporalio.worker import Worker

    client = await Client.connect(f"{TEMPORAL_HOST}:{TEMPORAL_PORT}")
    task_queue = f"pegasus-workflows-test-{uuid.uuid4().hex[:8]}"

    async with Worker(
        client,
        task_queue=task_queue,
        workflows=[workflow_cls],
        activities=activities,
    ):
        return await client.execute_workflow(
            workflow_cls.run,
            stub_input,
            id=f"test-{uuid.uuid4().hex}",
            task_queue=task_queue,
        )


def test_command(
    workflow_name: str = typer.Argument(..., help="Workflow name from the manifest."),
    project_dir: Path = typer.Option(
        Path("."),
        "--project-dir",
        "-C",
        help="Project directory containing pegasus-workflows.toml.",
        exists=True,
        file_okay=False,
        dir_okay=True,
    ),
    stub_input: str = typer.Option(
        "world",
        "--input",
        help="Stub input passed as the workflow's first argument.",
    ),
) -> None:
    """Run WORKFLOW_NAME locally against Dockerized Temporal."""
    project_dir = project_dir.resolve()
    try:
        manifest, workflow_cls, activities = _resolve_workflow(project_dir, workflow_name)
    except ManifestError as exc:
        typer.secho(f"manifest error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    except (ImportError, AttributeError) as exc:
        typer.secho(f"could not load workflow: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    _ensure_temporal(project_dir)

    typer.echo(f"-> running {manifest.name}@{manifest.version} with input {stub_input!r}")
    try:
        result = asyncio.run(_run(workflow_cls, activities, stub_input))
    except Exception as exc:  # noqa: BLE001 - surface any runtime failure to the user
        typer.secho(f"workflow run failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(f"result: {result!r}", fg=typer.colors.GREEN)
