"""``pegasus-workflows push`` — package, upload, and finalize each Automation.

Drives the server's two-step publish flow per Automation:

1. ``POST /api/v1/workflows/upload-url`` → presigned S3 PUT.
2. Raw S3 ``PUT`` of the zip with the signed ``Content-Type``/``Content-Length``.
3. ``POST /api/v1/workflows`` (finalize) → the ``Workflow`` row.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import typer

from ..api import PegasusApiError, PegasusClient
from ..deployments import derive_env, ledger_env_key, read_deployments, record_deployment
from ..manifest import DIAGRAM_FILENAME, ManifestError
from ._auth import base_url_option, profile_option, resolve_credentials, token_option
from .package import package_project

__all__ = ["push_command"]


def push_command(
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
    env: str = typer.Option(
        None,
        "--env",
        help=(
            "Environment key for the deployments.toml record (default: the --profile "
            "name, else the API host). Two tenants on one API root (QA + Prod) need "
            "distinct keys, or the second push overwrites the first's record."
        ),
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
    """Package and publish every Automation in the project to Pegasus."""
    token, base_url = resolve_credentials(token, base_url, profile)

    project_dir = project_dir.resolve()
    try:
        packaged = package_project(project_dir)
    except ManifestError as exc:
        typer.secho(f"manifest error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    client = PegasusClient(base_url=base_url, token=token)
    env_key = ledger_env_key(env, profile, base_url)
    _warn_on_host_keyed_record(project_dir, env_key, base_url)
    multi = len(packaged) > 1
    failures = 0

    for manifest, zip_path in packaged:
        artifact = zip_path.read_bytes()
        size = len(artifact)
        label = f"{manifest.name}@{manifest.version}"
        # package_project already verified the diagram exists; read its contents
        # to embed in the manifest. It is the same file packaged into the zip, so
        # it is covered by artifactSha256 and pinned to this exact version.
        diagram = (project_dir / manifest.source_dir / DIAGRAM_FILENAME).read_text(
            encoding="utf-8"
        )
        try:
            typer.echo(f"-> requesting upload URL for {label} ({size} bytes)")
            upload = client.request_upload_url(manifest.name, manifest.version, size)

            typer.echo("-> uploading artifact to S3")
            client.upload_artifact(upload["uploadUrl"], artifact)

            typer.echo("-> finalizing")
            row = client.finalize(
                upload["workflowId"], manifest.to_api_manifest(diagram=diagram)
            )

            typer.secho(
                f"published {label} (id={row['id']}, visibility={row['visibility']})",
                fg=typer.colors.GREEN,
            )

            # The artifact is already published; a ledger-write failure (disk
            # full, perms) must not abort the remaining Automations or surface as a
            # traceback — warn and carry on. The id is still recoverable via the
            # API, the ledger is a convenience cache.
            try:
                ledger = record_deployment(
                    project_dir,
                    env=env_key,
                    base_url=base_url,
                    workflow_name=manifest.name,
                    multi=multi,
                    workflow_id=row["id"],
                    version=manifest.version,
                    visibility=row["visibility"],
                    published_at=datetime.now(UTC)
                    .isoformat(timespec="seconds")
                    .replace("+00:00", "Z"),
                )
                typer.echo(f"-> recorded deployment [{env_key}] in {ledger}")
            except OSError as exc:
                typer.secho(
                    f"published {label}, but could not write deployments.toml: {exc}",
                    fg=typer.colors.YELLOW,
                    err=True,
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


def _warn_on_host_keyed_record(project_dir: Path, env_key: str, base_url: str) -> None:
    """Point out a pre-existing host-keyed record this push will not update.

    Ledgers written before profile keying hold ``[<api host>]`` tables. A push
    keyed by profile leaves that table as it is and writes a sibling — say so,
    once, so the stale table can be renamed or deleted by hand.
    """
    host_key = derive_env(base_url)
    if env_key == host_key:
        return
    try:
        existing = read_deployments(project_dir)
    except (OSError, ValueError):
        return
    if host_key in existing:
        typer.secho(
            f"note: deployments.toml also has a [{host_key!s}] record from an older, "
            f"host-keyed push; this push records under [{env_key}] and leaves it as is "
            "(rename or delete it by hand)",
            fg=typer.colors.YELLOW,
            err=True,
        )
