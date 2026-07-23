"""``pegasus-workflows feedback-form`` — author magic-link feedback surveys.

A tenant authors a versioned feedback form (a question list) and publishes it
through the real publish path, then a workflow mints a per-recipient capability
link with ``client.create_feedback_request(...)`` and sends it (e.g. via
``send_sms``). A submitted response emits the built-in ``feedback.submitted``
domain event a workflow EVENT trigger subscribes to.

A small Typer group over the feedback-forms endpoints
(``apps/api/src/handlers/feedback-forms.ts``):

* ``validate`` — dry-run the definition (no write); a pre-check.
* ``publish``  — publish a new form version.
* ``pull``     — fetch the active form and write the editable surface to disk.
* ``versions`` — list the version history.
* ``rollback`` — re-publish a prior version.

The editable surface lives as files in a working directory: ``form.json``
(``{title, definition: {questions: [...]}}``) and the optional ``message.txt``
(the SMS/email body rendered at mint time, with ``{{url}}`` / ``{{subjectId}}``
placeholders). ``pull`` writes them; ``validate`` / ``publish`` read them. That is
the round-trip: ``pull`` → edit → ``validate`` → ``publish``.

Auth mirrors ``integration-config``: a ``vnd_`` API key via ``--token`` /
``$PEGASUS_WORKFLOW_TOKEN`` holding ``ManageFeedbackForms`` (the
``workflow_developer`` / ``tenant_admin`` role).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["feedback_form_app"]

#: The editable surface, as conventional filenames in the working directory.
FORM_FILE = "form.json"
MESSAGE_FILE = "message.txt"

feedback_form_app = typer.Typer(
    name="feedback-form",
    help="Author feedback (magic-link survey) forms.",
    no_args_is_help=True,
    add_completion=False,
)


def _client(token: str | None, base_url: str | None, profile: str | None) -> PegasusClient:
    token, base_url = resolve_credentials(token, base_url, profile)
    return PegasusClient(base_url=base_url, token=token)


def _fail(exc: PegasusApiError) -> None:
    typer.secho(f"error: {exc.message or exc}", fg=typer.colors.RED, err=True)
    raise typer.Exit(code=1) from exc


def _load_form(directory: Path) -> tuple[str, Any, str | None]:
    """Read ``form.json`` (+ optional ``message.txt``) → (title, definition, message)."""
    form_path = directory / FORM_FILE
    if not form_path.is_file():
        typer.secho(f"error: {form_path} not found", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    doc = json.loads(form_path.read_text())
    title = doc.get("title")
    definition = doc.get("definition")
    if not isinstance(title, str) or definition is None:
        typer.secho(
            f"error: {form_path} must contain {{'title': str, 'definition': {{...}}}}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)
    message_path = directory / MESSAGE_FILE
    message = message_path.read_text() if message_path.is_file() else None
    return title, definition, message


def _dir_option() -> Path:
    return typer.Option(
        Path("."),
        "--dir",
        "-d",
        help="Working directory holding form.json (+ optional message.txt).",
    )


@feedback_form_app.command("validate")
def validate_command(
    form_key: str = typer.Argument(..., help="Form key/slug (e.g. post-move-csat)."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Dry-run the form definition (no write). Exits non-zero if invalid."""
    title, definition, _ = _load_form(directory)
    client = _client(token, base_url, profile)
    try:
        report = client.validate_feedback_form(form_key, title=title, definition=definition)
    except PegasusApiError as exc:
        _fail(exc)
    if report.get("valid"):
        typer.secho("valid", fg=typer.colors.GREEN)
        return
    typer.secho("invalid:", fg=typer.colors.RED, err=True)
    for err in report.get("errors", []):
        typer.secho(f"  - {err}", fg=typer.colors.RED, err=True)
    raise typer.Exit(code=1)


@feedback_form_app.command("publish")
def publish_command(
    form_key: str = typer.Argument(..., help="Form key/slug to publish."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Publish a new immutable form version."""
    title, definition, message = _load_form(directory)
    client = _client(token, base_url, profile)
    try:
        row = client.publish_feedback_form(
            form_key, title=title, definition=definition, message_template=message
        )
    except PegasusApiError as exc:
        _fail(exc)
    typer.secho(f"published {form_key} v{row.get('version')}", fg=typer.colors.GREEN)


@feedback_form_app.command("pull")
def pull_command(
    form_key: str = typer.Argument(..., help="Form key/slug to pull."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Fetch the active form and write form.json (+ message.txt) to the directory."""
    client = _client(token, base_url, profile)
    try:
        row = client.get_feedback_form(form_key)
    except PegasusApiError as exc:
        _fail(exc)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / FORM_FILE).write_text(
        json.dumps({"title": row.get("title"), "definition": row.get("definition")}, indent=2)
        + "\n"
    )
    message = row.get("messageTemplate")
    if message is not None:
        (directory / MESSAGE_FILE).write_text(message)
    typer.secho(
        f"pulled {form_key} v{row.get('version')} → {directory}/{FORM_FILE}",
        fg=typer.colors.GREEN,
    )


@feedback_form_app.command("versions")
def versions_command(
    form_key: str = typer.Argument(..., help="Form key/slug."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List the version history for a form key, newest first."""
    client = _client(token, base_url, profile)
    try:
        rows = client.list_feedback_form_versions(form_key)
    except PegasusApiError as exc:
        _fail(exc)
    if not rows:
        typer.echo("(no versions)")
        return
    for row in rows:
        typer.echo(f"v{row.get('version')}\t{row.get('status')}\t{row.get('createdAt')}")


@feedback_form_app.command("rollback")
def rollback_command(
    form_key: str = typer.Argument(..., help="Form key/slug."),
    version: int = typer.Argument(..., help="Prior version to re-publish."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Re-publish a prior form version as a new version."""
    client = _client(token, base_url, profile)
    try:
        row = client.rollback_feedback_form(form_key, version)
    except PegasusApiError as exc:
        _fail(exc)
    typer.secho(
        f"rolled back {form_key} to v{version} → new v{row.get('version')}",
        fg=typer.colors.GREEN,
    )
