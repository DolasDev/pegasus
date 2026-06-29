"""``pegasus-workflows configure`` / ``profile list`` — manage credential profiles.

A safe place to store a named ``vnd_`` token + API root, so it never has to be
pasted on the command line. ``configure`` writes ``~/.pegasus/credentials``
(``0600``); ``profile list`` shows names + ``api_root`` only — never a key.
"""

from __future__ import annotations

import typer

from ..credentials import (
    DEFAULT_API_ROOT,
    ProfileError,
    list_profile_summaries,
    write_profile,
)

__all__ = ["configure_command", "profile_app"]

profile_app = typer.Typer(
    name="profile",
    help="Inspect stored credential profiles (~/.pegasus/credentials).",
    no_args_is_help=True,
    add_completion=False,
)


def configure_command(
    profile: str = typer.Option(
        "default", "--profile", help="Profile name to create or update."
    ),
    api_key: str = typer.Option(
        None,
        "--api-key",
        help="The vnd_ API key. Prompted for (hidden) when omitted.",
    ),
    api_root: str = typer.Option(
        None,
        "--api-root",
        help=f"API base URL. Prompted for when omitted (default {DEFAULT_API_ROOT}).",
    ),
) -> None:
    """Store a named credential profile in ~/.pegasus/credentials (0600)."""
    if not api_key:
        api_key = typer.prompt("api_key (vnd_…)", hide_input=True)
    if not api_key:
        typer.secho("api_key is required", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    if api_root is None:
        api_root = typer.prompt("api_root", default=DEFAULT_API_ROOT)

    path = write_profile(profile, api_key=api_key, api_root=api_root or None)
    typer.secho(f"wrote profile [{profile}] to {path}", fg=typer.colors.GREEN)


@profile_app.command("list")
def profile_list_command() -> None:
    """List stored profile names and their api_root. Never prints a key."""
    try:
        summaries = list_profile_summaries()
    except ProfileError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    if not summaries:
        typer.echo("no profiles configured")
        return
    for row in summaries:
        typer.echo(f"{row['name']}\t{row['api_root']}")
