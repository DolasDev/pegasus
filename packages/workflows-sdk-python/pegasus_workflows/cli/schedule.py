"""``pegasus-workflows schedule`` — attach cron schedules to an Automation.

A thin terminal wrapper over the workflow-trigger management API. A SCHEDULE
trigger fires its Automation on a 5-field UTC cron cadence, evaluated each minute
by the platform dispatcher — the on-platform replacement for an external cron
calling ``pegasus-workflows run`` (sdk-feedback/0023).

* ``schedule create <workflow> --cron "*/5 * * * *"`` — attach a schedule.
* ``schedule list   <workflow>`` — list the Automation's schedules.
* ``schedule delete <workflow> <trigger-id>`` — remove one.
* ``schedule disable|enable <workflow> <trigger-id>`` — pause / resume a trigger
  without deleting it (any kind, EVENT included).
* ``schedule dry-run <workflow> <trigger-id> [--off]`` — validate a trigger
  (any kind, EVENT included) without letting it act: it keeps firing, but each
  execution runs dry — mutations captured in the trace, never performed.
  ``schedule create --dry-run`` attaches a schedule that way from the start.

Each firing passes a ``{"scheduledAt": "<ISO8601>", "schedule": "<cron>",
"triggerId": "..."}`` envelope (at ``arg["input"]``) — a documented input shape
distinct from event-fired / manual / CLI-test runs, which the Automation's input
resolver keys on ``scheduledAt``.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN`` (the ``workflow_developer`` role's
``ManageWorkflowTriggers`` covers create/delete/enable/disable; ``ReadWorkflow``
covers list).
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
    help="Attach cron schedules to an Automation.",
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
        ..., help="Automation name or name@version to attach the schedule to."
    ),
    cron: str = typer.Option(
        ..., "--cron", "-c", help='5-field UTC cron, e.g. "*/5 * * * *" (every 5 min).'
    ),
    disabled: bool = typer.Option(
        False, "--disabled", help="Create the schedule disabled (attach now, enable later)."
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help=(
            "Every run the schedule fires is a dry run (mutations captured, never "
            "performed). Turn off with `schedule dry-run <workflow> <id> --off`."
        ),
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Attach a cron schedule to an Automation."""
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        trigger = client.create_trigger(
            row["id"],
            kind="SCHEDULE",
            cron_expression=cron,
            enabled=not disabled,
            dry_run=dry_run,
        )
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    state = "enabled" if trigger.get("enabled") else "disabled"
    if trigger.get("dryRun"):
        state += ", dry run"
    typer.secho(
        f"scheduled {row['name']}@{row['version']} on '{cron}' "
        f"({state}) — trigger {trigger['id']}",
        fg=typer.colors.GREEN,
    )


@schedule_app.command("list")
def schedule_list_command(
    workflow: str = typer.Argument(..., help="Automation name or name@version."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List an Automation's cron schedules."""
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
        mode = "dry-run" if t.get("dryRun") else "live"
        typer.echo(f"  {_fmt(t.get('cronExpression'))}  {state}  {mode}  {t['id']}")


@schedule_app.command("delete")
def schedule_delete_command(
    workflow: str = typer.Argument(..., help="Automation name or name@version."),
    trigger_id: str = typer.Argument(..., help="The schedule (trigger) id to delete."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Delete an Automation's cron schedule by trigger id."""
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


def _set_enabled(
    workflow: str,
    trigger_id: str,
    enabled: bool,
    token: str | None,
    base_url: str | None,
    profile: str | None,
) -> None:
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        client.update_trigger(row["id"], trigger_id, enabled=enabled)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    verb = "enabled" if enabled else "disabled"
    typer.secho(
        f"{verb} trigger {trigger_id} on {row['name']}@{row['version']}",
        fg=typer.colors.GREEN,
    )


@schedule_app.command("disable")
def schedule_disable_command(
    workflow: str = typer.Argument(..., help="Automation name or name@version."),
    trigger_id: str = typer.Argument(..., help="The trigger id to pause."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Pause a trigger without deleting it (it is kept but never fires).

    Works for any trigger id on the Automation, EVENT as well as SCHEDULE.
    """
    _set_enabled(workflow, trigger_id, False, token, base_url, profile)


@schedule_app.command("enable")
def schedule_enable_command(
    workflow: str = typer.Argument(..., help="Automation name or name@version."),
    trigger_id: str = typer.Argument(..., help="The trigger id to resume."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Resume a paused trigger. Works for EVENT as well as SCHEDULE triggers."""
    _set_enabled(workflow, trigger_id, True, token, base_url, profile)


@schedule_app.command("dry-run")
def schedule_dry_run_command(
    workflow: str = typer.Argument(..., help="Automation name or name@version."),
    trigger_id: str = typer.Argument(..., help="The trigger id (EVENT or SCHEDULE)."),
    off: bool = typer.Option(
        False, "--off", help="Turn dry-run OFF — the trigger's runs act for real again."
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Validate a trigger without letting it act (EVENT or SCHEDULE).

    The trigger keeps firing on every matching event / cron minute, but each run
    it starts is a dry run: reads go live, mutations (send_sms, send_email, ...)
    are captured in the run's trace and never performed. Read the traces with
    `pegasus-workflows executions list <workflow>`; once the wiring is right,
    `--off` lets the runs act for real. Tenant-runner Automations only — a
    curated workflow can't run dry (DRY_RUN_UNSUPPORTED).
    """
    client = _client(token, base_url, profile)
    try:
        row = _resolve_workflow(client, workflow)
        client.update_trigger(row["id"], trigger_id, dry_run=not off)
    except PegasusApiError as exc:
        typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    mode = "live (runs act for real)" if off else "dry-run (runs captured, nothing performed)"
    typer.secho(
        f"trigger {trigger_id} on {row['name']}@{row['version']} is now {mode}",
        fg=typer.colors.GREEN,
    )
