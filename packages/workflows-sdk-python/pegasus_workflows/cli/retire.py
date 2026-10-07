"""``pegasus-workflows retire`` — retire a published Automation (sdk-feedback 0032).

The way to clean up after a rename or a bad publish. ``name`` retires every
version your tenant owns; ``name@version`` retires one. Retiring is soft: the rows
and their execution history stay, but a retired version is no longer listed,
fetched, run, forked or triggered.

Only the owning tenant can retire, so a platform (GLOBAL) Automation is retired
with a platform-tenant key. The server refuses, retiring nothing, while any
matching version still has an enabled trigger or a queued/running execution from
any tenant. This command prints those so you can disable them
(``pegasus-workflows schedule disable``) and retry.

Examples::

    pegasus-workflows retire send_order_to_partner
    pegasus-workflows retire weichert-milestone-update@0.6.3 --yes
"""

from __future__ import annotations

import typer

from ..api import PegasusApiError, PegasusClient, WorkflowInUse
from ._auth import base_url_option, profile_option, resolve_credentials, token_option
from .run import _parse_name_version

__all__ = ["retire_command"]


def retire_command(
    workflow: str = typer.Argument(
        ...,
        help="Automation name (every version) or name@version (one version).",
    ),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip the confirmation prompt (for scripts/CI)."
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Retire a published Automation: every version, or one with name@version.

    Soft and kept for audit. A retired version is no longer listed, fetched, run,
    forked or triggered, and re-pushing the same name@version still conflicts.
    Refused, with nothing retired, while an enabled trigger or a queued/running
    execution still uses it.
    """
    name, version = _parse_name_version(workflow)
    token, base_url = resolve_credentials(token, base_url, profile)
    if not yes:
        what = f"{name}@{version}" if version else f"EVERY version of {name}"
        typer.confirm(
            f"Retire {what}? It stops being runnable, forkable and triggerable.",
            abort=True,
        )
    client = PegasusClient(base_url=base_url, token=token)
    try:
        result = client.retire_workflow(name, version=version)
    except WorkflowInUse as exc:
        typer.secho(f"not retired — {exc.message}", fg=typer.colors.RED, err=True)
        for t in exc.enabled_triggers:
            typer.secho(
                f"  enabled trigger {t.get('id')} on {name}@{t.get('version')}",
                fg=typer.colors.RED,
                err=True,
            )
        for e in exc.open_executions:
            typer.secho(
                f"  open execution {e.get('id')} of {name}@{e.get('version')}",
                fg=typer.colors.RED,
                err=True,
            )
        raise typer.Exit(code=1) from exc
    except PegasusApiError as exc:
        typer.secho(f"retire failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    retired = [r.get("version") for r in result.get("retired", [])]
    already = [r.get("version") for r in result.get("alreadyRetired", [])]
    if retired:
        typer.secho(f"retired {name}: {', '.join(retired)}", fg=typer.colors.GREEN)
    if already:
        typer.echo(f"already retired: {', '.join(already)}")
    forks = result.get("forkCount", 0)
    if forks:
        typer.echo(f"{forks} tenant fork(s) are separate rows and keep running")
