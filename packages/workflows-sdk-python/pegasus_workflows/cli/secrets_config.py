"""``pegasus-workflows secrets`` / ``config`` — publish per-tenant workflow
secrets and configuration through the real management API.

Two small Typer groups over the workflow-secrets-configs endpoints
(``apps/api/src/handlers/workflow-secrets-configs.ts``):

* ``secrets set|list|delete`` — write-once, encrypted-at-rest secret values.
* ``config  set|list|delete`` — plain, editable configuration values.

A workflow reads these at runtime via ``PegasusClient.get_secret`` /
``get_config`` inside an activity, having declared ``ReadWorkflowSecret`` /
``ReadWorkflowConfig`` in its manifest ``required_actions``.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN``. The key must carry ``ManageWorkflowSecrets`` /
``ManageWorkflowConfigs`` (the ``workflow_developer`` or ``tenant_admin`` role)
to mutate; ``list`` is at the same management level. Secret VALUES are never
returned by ``list`` — only the runtime read path ever exposes a secret value.
"""

from __future__ import annotations

from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["secrets_app", "config_app"]

secrets_app = typer.Typer(
    name="secrets",
    help="Publish per-tenant workflow secrets (write-once, encrypted at rest).",
    no_args_is_help=True,
    add_completion=False,
)

config_app = typer.Typer(
    name="config",
    help="Publish per-tenant workflow configuration (plain, editable).",
    no_args_is_help=True,
    add_completion=False,
)


# -- shared helpers ---------------------------------------------------------


def _desc_option() -> Any:
    return typer.Option(None, "--description", "-d", help="Optional human-readable note.")


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


# -- secrets ----------------------------------------------------------------


@secrets_app.command("set")
def secrets_set_command(
    key: str = typer.Argument(..., help="Secret key, e.g. STRIPE_API_KEY."),
    value: str = typer.Argument(..., help="Secret value (stored encrypted at rest)."),
    description: str = _desc_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Publish a secret. Secrets are write-once — delete then set again to rotate."""
    client = _client(token, base_url, profile)
    try:
        client.set_secret(key, value, description=description)
    except PegasusApiError as exc:
        if exc.status_code == 409:
            typer.secho(
                f"secret '{key}' already exists — delete it first to rotate",
                fg=typer.colors.RED,
                err=True,
            )
        else:
            typer.secho(f"set failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"set secret {key}", fg=typer.colors.GREEN)


@secrets_app.command("list")
def secrets_list_command(
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List secret keys and metadata. Values are never shown."""
    client = _client(token, base_url, profile)
    try:
        rows = client.list_secrets()
    except PegasusApiError as exc:
        typer.secho(f"list failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    if not rows:
        typer.echo("no secrets")
        return
    for row in rows:
        typer.echo(f"{row.get('key')}\t{row.get('description') or ''}")


@secrets_app.command("delete")
def secrets_delete_command(
    key: str = typer.Argument(..., help="Secret key to delete."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Delete a secret by key."""
    client = _client(token, base_url, profile)
    try:
        client.delete_secret(key)
    except PegasusApiError as exc:
        typer.secho(f"delete failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"deleted secret {key}", fg=typer.colors.GREEN)


# -- config -----------------------------------------------------------------


@config_app.command("set")
def config_set_command(
    key: str = typer.Argument(..., help="Config key, e.g. DEFAULT_REGION."),
    value: str = typer.Argument(..., help="Config value."),
    description: str = _desc_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Publish a config value (idempotent — re-running replaces the value)."""
    client = _client(token, base_url, profile)
    try:
        client.set_config(key, value, description=description)
    except PegasusApiError as exc:
        typer.secho(f"set failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"set config {key}", fg=typer.colors.GREEN)


@config_app.command("list")
def config_list_command(
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List config keys and their values."""
    client = _client(token, base_url, profile)
    try:
        rows = client.list_configs()
    except PegasusApiError as exc:
        typer.secho(f"list failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    if not rows:
        typer.echo("no config")
        return
    for row in rows:
        typer.echo(f"{row.get('key')}\t{row.get('value')}")


@config_app.command("delete")
def config_delete_command(
    key: str = typer.Argument(..., help="Config key to delete."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Delete a config entry by key."""
    client = _client(token, base_url, profile)
    try:
        client.delete_config(key)
    except PegasusApiError as exc:
        typer.secho(f"delete failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"deleted config {key}", fg=typer.colors.GREEN)
