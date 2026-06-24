"""``pegasus-workflows run`` — trigger a server-side execution.

Looks up a workflow by ``name@version`` (or ``name`` if there is only one
version visible), POSTs ``/api/v1/workflows/{id}/run``, and prints the
returned execution row. Phase 2 scope-lock means only curated stdlib
workflows are accepted — the server returns 400 ``WORKFLOW_NOT_EXECUTABLE``
for anything else.

Examples::

    pegasus-workflows run send_quote_followup \\
        --input '{"quote_id":"q-123"}'

    pegasus-workflows run send_quote_followup@0.1.0 \\
        --base-url https://api.pegasus-qa.dolas.dev
"""

from __future__ import annotations

import json as json_mod
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient

__all__ = ["run_command"]

TOKEN_ENV_VAR = "PEGASUS_WORKFLOW_TOKEN"


def _parse_name_version(spec: str) -> tuple[str, str | None]:
    """Split a ``name`` or ``name@version`` argument."""
    if "@" in spec:
        name, version = spec.split("@", 1)
        return name, version
    return spec, None


def _find_workflow(
    client: PegasusClient,
    name: str,
    version: str | None,
) -> dict[str, Any]:
    """Find the workflow row matching ``name`` (and optional ``version``).

    Prefers the caller's tenant rows over GLOBAL when both exist with the
    same (name, version) — a fork is the more explicit choice.
    """
    rows = client.list_workflows()
    candidates = [r for r in rows if r.get("name") == name]
    if version is not None:
        candidates = [r for r in candidates if r.get("version") == version]
    if not candidates:
        raise typer.BadParameter(
            f"no visible workflow matches {name}"
            + (f"@{version}" if version else "")
        )
    # Prefer TENANT (more specific) over GLOBAL when multiple match.
    tenant_first = sorted(
        candidates,
        key=lambda r: (r.get("visibility") != "TENANT", r.get("createdAt", "")),
        reverse=False,
    )
    return tenant_first[0]


def run_command(
    workflow: str = typer.Argument(
        ...,
        help=(
            "Workflow name or name@version "
            "(e.g. send_quote_followup or send_quote_followup@0.1.0)."
        ),
    ),
    input_json: str = typer.Option(
        "{}",
        "--input",
        help="JSON-encoded input payload passed to the workflow.",
    ),
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
) -> None:
    """Run a curated workflow against the Pegasus runtime."""
    if not token:
        typer.secho(
            f"no token: pass --token or set ${TOKEN_ENV_VAR}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    try:
        parsed_input = json_mod.loads(input_json)
    except json_mod.JSONDecodeError as exc:
        typer.secho(
            f"--input is not valid JSON: {exc}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1) from exc
    if not isinstance(parsed_input, dict):
        typer.secho(
            "--input must decode to a JSON object",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    name, version = _parse_name_version(workflow)
    client = PegasusClient(base_url=base_url, token=token)
    workflow_row = _find_workflow(client, name, version)
    typer.echo(
        f"-> running {workflow_row['name']}@{workflow_row['version']} "
        f"({workflow_row['visibility']}, id={workflow_row['id']})"
    )
    try:
        execution = client.run_workflow(workflow_row["id"], parsed_input)
    except PegasusApiError as exc:
        typer.secho(f"run failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json_mod.dumps(execution, indent=2, sort_keys=True))
