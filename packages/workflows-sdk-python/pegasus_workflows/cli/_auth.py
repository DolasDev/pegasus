"""Shared credential wiring for every API-calling CLI command.

Centralizes the ``--token`` / ``--base-url`` / ``--profile`` option declarations
and the flag → profile → env → ``[default]``-profile resolution, so each command
resolves credentials identically. Commands still construct ``PegasusClient`` from
their own module symbol (keeping them straightforward to monkeypatch in tests).
"""

from __future__ import annotations

from typing import Any

import typer

from ..credentials import (
    BASE_URL_ENV_VAR,
    TOKEN_ENV_VAR,
    ProfileError,
)
from ..credentials import (
    resolve as _resolve,
)

__all__ = [
    "token_option",
    "base_url_option",
    "profile_option",
    "resolve_credentials",
]


def token_option() -> Any:
    """The shared ``--token`` option (no ``envvar=`` — env is handled in resolve)."""
    return typer.Option(
        None,
        "--token",
        help=(
            f"Pegasus vnd_ API key. Falls back to --profile, "
            f"${TOKEN_ENV_VAR}, then the [default] profile."
        ),
    )


def base_url_option() -> Any:
    """The shared ``--base-url`` option."""
    return typer.Option(
        None,
        "--base-url",
        help=(
            f"Pegasus API base URL. Falls back to --profile, "
            f"${BASE_URL_ENV_VAR}, then the [default] profile."
        ),
    )


def profile_option() -> Any:
    """The shared ``--profile`` option (a named profile in ~/.pegasus/credentials)."""
    return typer.Option(
        None,
        "--profile",
        help="Named credential profile from ~/.pegasus/credentials.",
    )


def resolve_credentials(
    token: str | None,
    base_url: str | None,
    profile: str | None = None,
) -> tuple[str, str]:
    """Resolve to a concrete ``(token, base_url)`` or exit with a clear error.

    Exits non-zero when no token can be resolved, or when ``--profile`` names a
    profile that does not exist.
    """
    try:
        resolved_token, resolved_base_url = _resolve(
            token=token, base_url=base_url, profile=profile
        )
    except ProfileError as exc:
        typer.secho(str(exc), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    if not resolved_token:
        typer.secho(
            f"no token: pass --token, --profile NAME, or set ${TOKEN_ENV_VAR}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)
    return resolved_token, resolved_base_url
