"""``pegasus-workflows ingress`` — provision the inbound webhook endpoint.

A third party (e.g. Sirva ADE) POSTs events to a platform-hosted ingress URL,
authenticating with a bearer the platform issues (sdk-feedback/0021). This
command mints, rotates, and inspects that credential:

* ``ingress create <integration>`` — prints the URL + a one-time token.
* ``ingress rotate <integration>`` — mints a new token (old stops working).
* ``ingress list   <integration>`` — the URL + token prefix + status.

The workflow that handles the events binds to the emitted domain event with an
ordinary EVENT trigger. Auth mirrors ``push``: a ``vnd_`` key holding
``ManageIngress`` (the ``workflow_developer`` / ``tenant_admin`` role).
"""

from __future__ import annotations

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["ingress_app"]

ingress_app = typer.Typer(
    name="ingress",
    help="Provision the inbound webhook ingress for an integration.",
    no_args_is_help=True,
    add_completion=False,
)


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


def _print_issued(data: dict) -> None:
    typer.secho(f"  URL:   {data.get('url')}", fg=typer.colors.GREEN)
    typer.secho(
        f"  Token: {data.get('token')}   (shown once — store it now)", fg=typer.colors.YELLOW
    )


@ingress_app.command("create")
def ingress_create_command(
    integration_id: str = typer.Argument(..., help="Integration id to provision ingress for."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Mint the ingress credential (prints URL + one-time token)."""
    client = _client(token, base_url, profile)
    try:
        data = client.create_ingress(integration_id)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"ingress created for {integration_id}:")
    _print_issued(data)


@ingress_app.command("rotate")
def ingress_rotate_command(
    integration_id: str = typer.Argument(..., help="Integration id to rotate the token for."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Rotate the ingress token (the old token stops working immediately)."""
    client = _client(token, base_url, profile)
    try:
        data = client.rotate_ingress(integration_id)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(f"ingress token rotated for {integration_id}:")
    _print_issued(data)


@ingress_app.command("list")
def ingress_list_command(
    integration_id: str = typer.Argument(..., help="Integration id to inspect."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Show the ingress URL, token prefix, and status (never the token)."""
    client = _client(token, base_url, profile)
    try:
        data = client.get_ingress(integration_id)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    state = "enabled" if data.get("enabled") else "disabled"
    typer.echo(f"ingress for {integration_id} ({state}):")
    typer.echo(f"  URL:    {data.get('url')}")
    typer.echo(f"  Prefix: {data.get('tokenPrefix')}…")
    typer.echo(f"  Since:  {data.get('createdAt')}  (rotated: {data.get('rotatedAt') or 'never'})")
