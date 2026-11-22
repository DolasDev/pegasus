"""``pegasus-workflows event-types`` — register and list tenant custom event types.

A custom event lets one Automation start or signal durable Workflows by key:

1. ``event-types create billing.delivery_due --schema schema.json`` (once, as an
   operator — needs ``ManageEventTypes``, held by ``workflow_developer``).
2. An Automation declares ``required_actions = ["EmitTenantEvent"]`` and calls
   ``client.emit_event("billing.delivery_due", {"orderNum": 1234})``.
3. A durable Workflow's EVENT trigger subscribes with ``mode="START"`` and
   ``correlation_path="payload.orderNum"`` → one instance per order.

The whole surface answers 404 "Custom events are not enabled" where the
platform's custom-events switch is off for the environment.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["event_types_app"]

event_types_app = typer.Typer(
    name="event-types",
    help="Register and list tenant custom event types (emit_event / EVENT triggers).",
    no_args_is_help=True,
    add_completion=False,
)


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


@event_types_app.command("create")
def event_types_create_command(
    name: str = typer.Argument(..., help="Dotted lowercase name, e.g. billing.delivery_due."),
    schema: Path | None = typer.Option(
        None, "--schema", help="JSON Schema file emit_event payloads are validated against."
    ),
    description: str | None = typer.Option(None, "--description", "-d", help="Human note."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Register a custom event type (needs ManageEventTypes)."""
    kwargs: dict[str, Any] = {}
    if schema is not None:
        try:
            kwargs["payload_schema"] = json.loads(schema.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            typer.secho(f"--schema: {exc}", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2) from exc
    if description is not None:
        kwargs["description"] = description
    client = _client(token, base_url, profile)
    try:
        row = client.create_event_type(name, **kwargs)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"registered {row.get('name', name)}", fg=typer.colors.GREEN)


@event_types_app.command("list")
def event_types_list_command(
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List the tenant's custom event types."""
    client = _client(token, base_url, profile)
    try:
        rows = client.list_event_types()
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    if not rows:
        typer.echo("no custom event types")
        return
    for row in rows:
        state = "enabled" if row.get("enabled", True) else "disabled"
        typer.echo(f"{row.get('name')}  ({state})  {row.get('description') or ''}".rstrip())
