"""``pegasus-workflows executions`` — inspect executions; signal, query and stop durable Workflows.

A window onto the same tenant-scoped execution data the tenant web UI shows, for
developers who live in the terminal:

* ``executions list <workflow-id>`` — recent runs (status, trigger, timing).
* ``executions show <workflow-id> <execution-id>`` — one run's input / result /
  error plus its Temporal event-history timeline (signals show their name).
* ``executions signal <workflow-id> <execution-id> --name proceed [--payload JSON]``
  — deliver a declared signal to a running durable Workflow.
* ``executions open [--name N [--key K]]`` — the tenant's OPEN durable Workflows,
  every version, with each instance's correlation key (0.66.0+).
* ``executions query <execution-id> --name status [--args JSON-array]`` — run a
  declared ``@workflow.query``; waits out a cold runner (0.66.0+).
* ``executions cancel <execution-id>`` — cooperative cancel, by id alone.
* ``executions terminate <execution-id> --reason "..."`` — forcible end; also
  cancels the Workflow's open ``run_automation()`` steps.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN``. ``list`` / ``show`` / ``open`` need ``ReadWorkflow``;
``signal``, ``query``, ``cancel`` and ``terminate`` need the matching
``SignalWorkflowExecution`` / ``QueryWorkflowExecution`` /
``CancelWorkflowExecution`` / ``TerminateWorkflowExecution`` (all in the
``workflow_developer`` role). Retry stays UI-only (or
``PegasusClient.retry_execution``).
"""

from __future__ import annotations

import json
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient, WorkflowWorkerStarting
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["executions_app"]

executions_app = typer.Typer(
    name="executions",
    help="Inspect executions; list, signal, query, cancel or terminate durable Workflows.",
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


@executions_app.command("open")
def executions_open_command(
    name: str | None = typer.Option(None, "--name", help="Only this Workflow name."),
    key: str | None = typer.Option(
        None, "--key", help="With --name: the one instance of this correlation key."
    ),
    limit: int = typer.Option(20, "--limit", "-n", help="Maximum rows to show (1..200)."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List the tenant's OPEN durable Workflows (every version), newest first."""
    if key is not None and name is None:
        typer.secho("--key needs --name", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=2)
    client = _client(token, base_url, profile)
    try:
        rows = client.list_workflow_executions(
            kind="WORKFLOW", open=True, name=name, correlation_key=key, limit=limit
        )
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    if not rows:
        typer.echo("no open Workflows")
        return

    typer.echo(f"{'EXECUTION ID':<38}  {'WORKFLOW':<32}  {'STATUS':<8}  {'KEY':<24}  QUEUED AT")
    for row in rows:
        workflow = f"{_fmt(row.get('workflowName'))}@{_fmt(row.get('workflowVersion'))}"
        typer.echo(
            f"{_fmt(row.get('id')):<38}  "
            f"{workflow:<32}  "
            f"{_fmt(row.get('status')):<8}  "
            f"{_fmt(row.get('correlationKey')):<24}  "
            f"{_fmt(row.get('queuedAt'))}"
        )


@executions_app.command("query")
def executions_query_command(
    execution_id: str = typer.Argument(
        ..., help="The QUEUED / RUNNING durable Workflow execution."
    ),
    name: str = typer.Option(
        ...,
        "--name",
        help="A query the Workflow declares (manifest `queries`; the @workflow.query "
        "method's name).",
    ),
    args: str | None = typer.Option(
        None, "--args", help='JSON array of query arguments, e.g. \'["o-7"]\'. Omit for none.'
    ),
    wait: float = typer.Option(
        90.0,
        "--wait",
        help="Seconds to keep retrying while the tenant's worker starts (a cold start "
        "takes 30-60 s). 0 tries once.",
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Run a declared query on an open durable Workflow and print its result as JSON.

    Read-only and not blocked by the kill switch, but each query wakes the
    tenant's runner — don't run it in a tight loop.
    """
    parsed: list[Any] = []
    if args is not None:
        try:
            loaded = json.loads(args)
        except json.JSONDecodeError as exc:
            typer.secho(f"--args is not valid JSON: {exc}", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2) from exc
        if not isinstance(loaded, list):
            typer.secho("--args must be a JSON array", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=2)
        parsed = loaded

    client = _client(token, base_url, profile)
    try:
        result = client.query_execution(execution_id, name, *parsed, wait=wait)
    except WorkflowWorkerStarting as exc:
        typer.secho(
            f"the Workflow's worker is still starting — retry in "
            f"{exc.retry_after_seconds or 15} s (or pass a longer --wait)",
            fg=typer.colors.YELLOW,
            err=True,
        )
        raise typer.Exit(code=1) from exc
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json.dumps(result, indent=2, sort_keys=True))


@executions_app.command("cancel")
def executions_cancel_command(
    execution_id: str = typer.Argument(..., help="The QUEUED / RUNNING execution to cancel."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Request a cooperative cancel: the run's code sees it and decides what to do.

    The execution turns CANCELLED once Temporal reports it (usually within a
    few minutes). To end a run that won't stop, use ``terminate``.
    """
    client = _client(token, base_url, profile)
    try:
        client.cancel_execution_by_id(execution_id)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"cancellation requested for {execution_id}", fg=typer.colors.GREEN)


@executions_app.command("terminate")
def executions_terminate_command(
    execution_id: str = typer.Argument(..., help="The QUEUED / RUNNING execution to end."),
    reason: str = typer.Option(
        ..., "--reason", help="Why (1-500 chars); recorded as 'Terminated: <reason>'."
    ),
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't ask for confirmation."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Forcibly end an execution: none of its code runs again.

    The row closes at once as CANCELLED. A terminated Workflow's open
    run_automation() steps are cancelled too. Prefer ``cancel`` when the
    Workflow can clean up after itself.
    """
    if not yes and not typer.confirm(
        f"Terminate {execution_id}? Its code gets no chance to clean up."
    ):
        raise typer.Exit(code=1)
    client = _client(token, base_url, profile)
    try:
        client.terminate_execution(execution_id, reason)
    except PegasusApiError as exc:
        typer.secho(f"failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(f"{execution_id} terminated", fg=typer.colors.GREEN)
