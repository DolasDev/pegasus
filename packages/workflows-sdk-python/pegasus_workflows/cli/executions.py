"""``pegasus-workflows executions`` — inspect workflow executions from the terminal.

A read-only window onto the same tenant-scoped execution data the tenant web UI
shows, for developers who live in the terminal:

* ``executions list <workflow-id>`` — recent runs (status, trigger, timing).
* ``executions show <workflow-id> <execution-id>`` — one run's input / result /
  error plus its Temporal event-history timeline.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN`` (the ``workflow_developer`` role's ``ReadWorkflow``
covers both). Cancel/retry are intentionally UI-only in v1.
"""

from __future__ import annotations

from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["executions_app"]

executions_app = typer.Typer(
    name="executions",
    help="Inspect workflow executions (read-only).",
    no_args_is_help=True,
    add_completion=False,
)


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


def _fmt(value: Any) -> str:
    return "-" if value is None else str(value)


@executions_app.command("list")
def executions_list_command(
    workflow_id: str = typer.Argument(..., help="The workflow whose executions to list."),
    limit: int = typer.Option(20, "--limit", "-n", help="Maximum rows to show (1..200)."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List recent executions of a workflow, newest first."""
    client = _client(token, base_url, profile)
    try:
        rows = client.list_executions(workflow_id, limit=limit)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    if not rows:
        typer.echo("no executions yet")
        return

    typer.echo(f"{'EXECUTION ID':<38}  {'STATUS':<10}  {'TRIGGER':<9}  QUEUED AT")
    for row in rows:
        typer.echo(
            f"{_fmt(row.get('id')):<38}  "
            f"{_fmt(row.get('status')):<10}  "
            f"{_fmt(row.get('triggerSource')):<9}  "
            f"{_fmt(row.get('queuedAt'))}"
        )


@executions_app.command("show")
def executions_show_command(
    workflow_id: str = typer.Argument(..., help="The workflow the execution belongs to."),
    execution_id: str = typer.Argument(..., help="The execution to inspect."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Show one execution's input/result/error and its event-history timeline."""
    client = _client(token, base_url, profile)
    try:
        execution = client.get_execution(workflow_id, execution_id)
        history = client.get_execution_history(workflow_id, execution_id)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(f"execution {execution.get('id')}", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"  status:   {_fmt(execution.get('status'))}")
    typer.echo(f"  trigger:  {_fmt(execution.get('triggerSource'))}")
    typer.echo(f"  queued:   {_fmt(execution.get('queuedAt'))}")
    typer.echo(f"  started:  {_fmt(execution.get('startedAt'))}")
    typer.echo(f"  finished: {_fmt(execution.get('finishedAt'))}")
    typer.echo(f"  input:    {_fmt(execution.get('input'))}")
    typer.echo(f"  result:   {_fmt(execution.get('result'))}")
    if execution.get("errorMessage"):
        typer.secho(f"  error:    {execution['errorMessage']}", fg=typer.colors.RED)

    typer.echo("")
    typer.secho("timeline:", bold=True)
    if not history:
        typer.echo("  (no Temporal history — the run never started on Temporal)")
        return
    for event in history:
        line = f"  {_fmt(event.get('timestamp')):<26}  {_fmt(event.get('type'))}"
        if event.get("activityType"):
            line += f"  [{event['activityType']}]"
        if event.get("failure"):
            line += f"  failure: {event['failure']}"
        typer.echo(line)
