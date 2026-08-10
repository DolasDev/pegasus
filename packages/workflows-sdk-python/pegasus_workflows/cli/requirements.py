"""``pegasus-workflows requirements`` — which declared secret/config keys are set.

The read half of ``required_secrets`` / ``required_configs``. Declaring them (in
a workflow manifest, or on an integration config) records WHICH keys are read at
runtime; this command resolves those declarations against the tenant's store and
says which are still missing — the same view the tenant sees under
Settings → Developer → Configs, from the terminal.

Merges both planes in one call:

* workflows    — ``GET /api/v1/workflows/requirements-summary`` (``ReadWorkflow``)
* integrations — ``GET /api/v1/integrations/requirements-summary``
  (``ReadIntegrationConfig``)

Presence only: a value is never returned by either endpoint. Provision what is
missing with ``pegasus-workflows secrets set`` / ``config set``.

Unlike the tenant UI — which hides the annotations when a summary is unreadable
so the page still works — this command SAYS which plane it could not read. A CLI
that quietly prints half the picture is worse than one that reports a 403: the
operator would read "nothing missing" off an incomplete answer.
"""

from __future__ import annotations

import json as jsonlib
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["requirements_command"]


def _rows(client: PegasusClient) -> tuple[list[dict[str, Any]], list[str]]:
    """Collect (consumer, requirement) rows from both planes.

    Returns the flattened rows plus a list of human-readable notes for any plane
    that could not be read, so the caller can report a partial answer as partial.
    """
    rows: list[dict[str, Any]] = []
    unreadable: list[str] = []

    # NB: the requirement carries its own `kind` (SECRET/CONFIG), so the consumer
    # type goes under `consumerKind` — spreading them into one dict under the same
    # name would silently drop one of the two.
    try:
        summary = client.requirements_summary()
        for workflow in summary.get("workflows", []):
            for requirement in workflow.get("requirements", []):
                rows.append(
                    {
                        **requirement,
                        "consumer": workflow.get("name"),
                        "consumerKind": "workflow",
                    }
                )
    except PegasusApiError as exc:
        unreadable.append(f"workflows: {exc}")

    try:
        summary = client.integration_requirements_summary()
        for integration in summary.get("integrations", []):
            for requirement in integration.get("requirements", []):
                rows.append(
                    {
                        **requirement,
                        "consumer": integration.get("displayName"),
                        "consumerKind": "integration",
                    }
                )
    except PegasusApiError as exc:
        unreadable.append(f"integrations: {exc}")

    return rows, unreadable


def requirements_command(
    missing_only: bool = typer.Option(
        False,
        "--missing-only",
        help="Show only keys that are declared but NOT set — what is left to provision.",
    ),
    as_json: bool = typer.Option(False, "--json", help="Emit the merged rows as JSON."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Show which declared secret/config keys are set, and which are still missing."""
    token, base_url = resolve_credentials(token, base_url, profile)
    client = PegasusClient(base_url=base_url, token=token)

    rows, unreadable = _rows(client)

    # Both planes failed: there is no answer to print, so fail rather than
    # report an empty — and reassuring — result.
    if unreadable and not rows:
        for note in unreadable:
            typer.secho(f"could not read {note}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    if missing_only:
        rows = [row for row in rows if not row.get("present")]

    # A partial answer is still worth printing, but never silently: name the
    # plane that is missing BEFORE the rows, so it is not scrolled off.
    for note in unreadable:
        typer.secho(
            f"warning: could not read {note} — results below are incomplete",
            fg=typer.colors.YELLOW,
            err=True,
        )

    if as_json:
        typer.echo(jsonlib.dumps(rows, indent=2))
        return

    if not rows:
        typer.echo("nothing missing" if missing_only else "no declared requirements")
        return

    for row in sorted(rows, key=lambda r: (str(r.get("consumerKind")), str(r.get("consumer")))):
        state = "set" if row.get("present") else "MISSING"
        declared = "secret" if row.get("kind") == "SECRET" else "config"
        typer.echo(
            f"{state}\t{row.get('group')}\t{row.get('key')}\t"
            f"{declared}\t{row.get('consumerKind')}:{row.get('consumer')}\t"
            f"{row.get('description') or ''}"
        )

    missing = sum(1 for row in rows if not row.get("present"))
    if missing:
        typer.secho(
            f"\n{missing} key(s) declared but not set — "
            "provision with `pegasus-workflows secrets set` / `config set`",
            fg=typer.colors.YELLOW,
        )
