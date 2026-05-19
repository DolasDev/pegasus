"""``pegasus-workflows push`` — package, upload, and finalize each workflow.

Drives the server's two-step publish flow per workflow:

1. ``POST /api/v1/workflows/upload-url`` → presigned S3 PUT.
2. Raw S3 ``PUT`` of the zip with the signed ``Content-Type``/``Content-Length``.
3. ``POST /api/v1/workflows`` (finalize) → the ``Workflow`` row.
"""

from __future__ import annotations

from pathlib import Path

import typer

from ..api import PegasusApiError, PegasusClient
from ..manifest import ManifestError
from .package import package_project

__all__ = ["push_command"]

#: Env var consulted when ``--token`` is omitted.
TOKEN_ENV_VAR = "PEGASUS_WORKFLOW_TOKEN"


def push_command(
    token: str = typer.Option(
        None,
        "--token",
        help=f"Pegasus vnd_ API key. Falls back to ${TOKEN_ENV_VAR}.",
        envvar=TOKEN_ENV_VAR,
    ),
    base_url: str = typer.Option(
        "http://localhost:3000",
        "--base-url",
        help="Pegasus API base URL.",
    ),
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
    """Package and publish every workflow in the project to Pegasus."""
    if not token:
        typer.secho(
            f"no token: pass --token or set ${TOKEN_ENV_VAR}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    project_dir = project_dir.resolve()
    try:
        packaged = package_project(project_dir)
    except ManifestError as exc:
        typer.secho(f"manifest error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    client = PegasusClient(base_url=base_url, token=token)
    failures = 0

    for manifest, zip_path in packaged:
        artifact = zip_path.read_bytes()
        size = len(artifact)
        label = f"{manifest.name}@{manifest.version}"
        try:
            typer.echo(f"-> requesting upload URL for {label} ({size} bytes)")
            upload = client.request_upload_url(manifest.name, manifest.version, size)

            typer.echo("-> uploading artifact to S3")
            client.upload_artifact(upload["uploadUrl"], artifact)

            typer.echo("-> finalizing")
            row = client.finalize(upload["workflowId"], manifest.to_api_manifest())

            typer.secho(
                f"published {label} (id={row['id']}, visibility={row['visibility']})",
                fg=typer.colors.GREEN,
            )
        except PegasusApiError as exc:
            failures += 1
            if exc.status_code == 409:
                typer.secho(
                    f"skipped {label}: already exists for this tenant",
                    fg=typer.colors.YELLOW,
                    err=True,
                )
            else:
                typer.secho(f"failed {label}: {exc}", fg=typer.colors.RED, err=True)

    if failures:
        raise typer.Exit(code=1)
