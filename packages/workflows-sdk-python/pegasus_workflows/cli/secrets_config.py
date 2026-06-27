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

__all__ = ["secrets_app", "config_app"]

#: Env var consulted when ``--token`` is omitted (shared with ``push``).
TOKEN_ENV_VAR = "PEGASUS_WORKFLOW_TOKEN"

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


def _require_token(token: str | None) -> str:
    if not token:
        typer.secho(
            f"no token: pass --token or set ${TOKEN_ENV_VAR}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)
    return token


def _token_option() -> Any:
    return typer.Option(
        None,
        "--token",
        help=f"Pegasus vnd_ API key. Falls back to ${TOKEN_ENV_VAR}.",
        envvar=TOKEN_ENV_VAR,
    )


def _base_url_option() -> Any:
    return typer.Option("http://localhost:3000", "--base-url", help="Pegasus API base URL.")


def _desc_option() -> Any:
    return typer.Option(None, "--description", "-d", help="Optional human-readable note.")


def _client(base_url: str, token: str | None) -> PegasusClient:
    return PegasusClient(base_url=base_url, token=_require_token(token))


# -- secrets ----------------------------------------------------------------


@secrets_app.command("set")
def secrets_set_command(
    key: str = typer.Argument(..., help="Secret key, e.g. STRIPE_API_KEY."),
    value: str = typer.Argument(..., help="Secret value (stored encrypted at rest)."),
    description: str = _desc_option(),
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """Publish a secret. Secrets are write-once — delete then set again to rotate."""
    client = _client(base_url, token)
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
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """List secret keys and metadata. Values are never shown."""
    client = _client(base_url, token)
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
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """Delete a secret by key."""
    client = _client(base_url, token)
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
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """Publish a config value (idempotent — re-running replaces the value)."""
    client = _client(base_url, token)
    try:
        client.set_config(key, value, description=description)
    except PegasusApiError as exc:
        typer.secho(f"set failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"set config {key}", fg=typer.colors.GREEN)


@config_app.command("list")
def config_list_command(
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """List config keys and their values."""
    client = _client(base_url, token)
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
    token: str = _token_option(),
    base_url: str = _base_url_option(),
) -> None:
    """Delete a config entry by key."""
    client = _client(base_url, token)
    try:
        client.delete_config(key)
    except PegasusApiError as exc:
        typer.secho(f"delete failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"deleted config {key}", fg=typer.colors.GREEN)
