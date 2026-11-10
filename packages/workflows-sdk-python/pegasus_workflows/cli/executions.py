"""``pegasus-workflows executions`` — inspect executions and signal durable Workflows.

A window onto the same tenant-scoped execution data the tenant web UI shows, for
developers who live in the terminal:

* ``executions list <workflow-id>`` — recent runs (status, trigger, timing).
* ``executions show <workflow-id> <execution-id>`` — one run's input / result /
  error plus its Temporal event-history timeline (signals show their name).
* ``executions signal <workflow-id> <execution-id> --name proceed [--payload JSON]``
  — deliver a declared signal to a running durable Workflow.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN``. ``list`` / ``show`` need ``ReadWorkflow``;
``signal`` needs ``SignalWorkflowExecution`` (both in the ``workflow_developer``
role). Cancel/retry stay UI-only (or ``PegasusClient.cancel_execution`` /
``retry_execution``).
"""

from __future__ import annotations

import json
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["executions_app"]

executions_app = typer.Typer(
    name="executions",
    help="Inspect executions; signal a running durable Workflow.",
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
    workflow_id: str = typer.Argument(..., help="The Automation whose executions to list."),
    limit: int = typer.Option(20, "--limit", "-n", help="Maximum rows to show (1..200)."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List recent executions of an Automation, newest first."""
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
    workflow_id: str = typer.Argument(..., help="The Automation the execution belongs to."),
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
        if event.get("signalName"):
            line += f"  signal: {event['signalName']}"
        if event.get("failure"):
            line += f"  failure: {event['failure']}"
        typer.echo(line)


@executions_app.command("signal")
def executions_signal_command(
    workflow_id: str = typer.Argument(..., help="The durable Workflow (version) id."),
    execution_id: str = typer.Argument(..., help="The QUEUED / RUNNING execution to signal."),
    name: str = typer.Option(
        ...,
        "--name",
        help="A signal the Workflow declares (manifest `signals`; the @workflow.signal "
        "method's name).",
    ),
    payload: str | None = typer.Option(
        None,
        "--payload",
        help="JSON passed as the signal's single argument (≤ 128 KiB). Omit to send none.",
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Deliver a signal to a running durable Workflow.

    Not blocked by the kill switch and not charged against any quota. Delivery is
    at-least-once — a re-run of this command delivers again, so make the handler
    idempotent.
    """
    parsed: Any = None
    if payload is not None:
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as exc:
            typer.secho(f"--payload is not valid JSON: {exc}", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2) from exc

    client = _client(token, base_url, profile)
    try:
        client.signal_execution(workflow_id, execution_id, name, parsed)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"signal {name} delivered to {execution_id}", fg=typer.colors.GREEN)
