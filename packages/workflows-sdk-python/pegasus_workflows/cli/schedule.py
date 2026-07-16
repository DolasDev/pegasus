"""``pegasus-workflows schedule`` — attach cron schedules to a workflow.

A thin terminal wrapper over the workflow-trigger management API. A SCHEDULE
trigger fires its workflow on a 5-field UTC cron cadence, evaluated each minute
by the platform dispatcher — the on-platform replacement for an external cron
calling ``pegasus-workflows run`` (sdk-feedback/0023).

* ``schedule create <workflow> --cron "*/5 * * * *"`` — attach a schedule.
* ``schedule list   <workflow>`` — list the workflow's schedules.
* ``schedule delete <workflow> <trigger-id>`` — remove one.

Each firing passes a ``{"scheduledAt": "<ISO8601>", "schedule": "<cron>",
"triggerId": "..."}`` envelope (at ``arg["input"]``) — a documented input shape
distinct from event-fired / manual / CLI-test runs, which the workflow's input
resolver keys on ``scheduledAt``.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN`` (the ``workflow_developer`` role's
``ManageWorkflowTriggers`` covers create/delete; ``ReadWorkflow`` covers list).
"""

from __future__ import annotations

from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option
from .run import _find_workflow, _parse_name_version

__all__ = ["schedule_app"]

schedule_app = typer.Typer(
    name="schedule",
    help="Attach cron schedules to a workflow.",
    no_args_is_help=True,
    add_completion=False,
)


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


def _resolve_workflow(client: PegasusClient, workflow: str) -> dict[str, Any]:
    name, version = _parse_name_version(workflow)
    return _find_workflow(client, name, version)


def _fmt(value: Any) -> str:
    return "-" if value is None else str(value)


@schedule_app.command("create")
def schedule_create_command(
    workflow: str = typer.Argument(
        ..., help="Workflow name or name@version to attach the schedule to."
    ),
    cron: str = typer.Option(
        ..., "--cron", "-c", help='5-field UTC cron, e.g. "*/5 * * * *" (every 5 min).'
    ),
    disabled: bool = typer.Option(
        False, "--disabled", help="Create the schedule disabled (attach now, enable later)."
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Attach a cron schedule to a workflow."""
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        trigger = client.create_trigger(
            row["id"], kind="SCHEDULE", cron_expression=cron, enabled=not disabled
        )
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    state = "enabled" if trigger.get("enabled") else "disabled"
    typer.secho(
        f"scheduled {row['name']}@{row['version']} on '{cron}' "
        f"({state}) — trigger {trigger['id']}",
        fg=typer.colors.GREEN,
    )


@schedule_app.command("list")
def schedule_list_command(
    workflow: str = typer.Argument(..., help="Workflow name or name@version."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List a workflow's cron schedules."""
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        triggers = client.list_triggers(row["id"])
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    schedules = [t for t in triggers if t.get("kind") == "SCHEDULE"]
    if not schedules:
        typer.echo(f"no schedules on {row['name']}@{row['version']}")
        return
    typer.echo(f"schedules on {row['name']}@{row['version']}:")
    for t in schedules:
        state = "enabled" if t.get("enabled") else "disabled"
        typer.echo(f"  {_fmt(t.get('cronExpression'))}  {state}  {t['id']}")


@schedule_app.command("delete")
def schedule_delete_command(
    workflow: str = typer.Argument(..., help="Workflow name or name@version."),
    trigger_id: str = typer.Argument(..., help="The schedule (trigger) id to delete."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Delete a workflow's cron schedule by trigger id."""
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        client.delete_trigger(row["id"], trigger_id)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    typer.secho(
        f"deleted schedule {trigger_id} from {row['name']}@{row['version']}",
        fg=typer.colors.GREEN,
    )
