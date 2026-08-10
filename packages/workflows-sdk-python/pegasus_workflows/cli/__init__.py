"""The ``pegasus-workflows`` command-line interface.

A Typer application wiring together the workflow developer flow:

* ``init`` — scaffold a new workflow project.
* ``diagram`` — emit a prompt for your own coding agent to draw the Mermaid
  workflow diagram (no LLM/API key needed — bring your own agent).
* ``package`` — zip each declared workflow into ``dist/``.
* ``push`` — package, then upload + finalize against the Pegasus API.
* ``run`` — trigger a server-side execution of a curated workflow.
* ``executions`` — inspect workflow executions (list / show) from the terminal.
* ``test`` — start local Temporal and run a workflow with stubbed inputs.
* ``integration-config`` — author the integration-validator config (mapping +
  rules) for an integration (publish / pull / versions / rollback).
* ``secrets`` / ``config`` — publish per-tenant workflow secrets & configuration
  (set / list / delete) that workflows read at runtime.
* ``requirements`` — show which declared secret/config keys are set and which are
  still missing, across workflows AND integrations.
* ``setup`` — one guided first-run bootstrap: seed a credential profile + wire
  the MCP server into your agent host (the ``--setup``/``--configure`` front door).
* ``configure`` / ``profile`` — store & list named credential profiles
  (``~/.pegasus/credentials``) so tokens never go on the command line.
* ``mcp`` — start a stdio MCP server for AI coding agents (bundled in the base install).
"""

from __future__ import annotations

import typer

from .diagram import diagram_command
from .executions import executions_app
from .feedback_form import feedback_form_app
from .ingress import ingress_app
from .init import init_command
from .integration_config import integration_config_app
from .mcp_server import mcp_command
from .package import package_command
from .profile_config import configure_command, profile_app
from .push import push_command
from .requirements import requirements_command
from .run import run_command
from .schedule import schedule_app
from .secrets_config import config_app, secrets_app
from .setup import setup_command
from .test import test_command

app = typer.Typer(
    name="pegasus-workflows",
    # First-timers guess `--setup` / `--configure`; name the real command in the
    # top-level help so those guesses land on `pegasus-workflows setup`.
    help=(
        "Author, package, and publish Pegasus workflows.\n\n"
        "First time here? Run `pegasus-workflows setup` — the one-shot bootstrap "
        "(this is the --setup / --configure you're looking for)."
    ),
    no_args_is_help=True,
    add_completion=False,
)


@app.callback(invoke_without_command=True)
def _main(
    setup: bool = typer.Option(
        False,
        "--setup",
        "--configure",
        help="Alias hint: run `pegasus-workflows setup` for first-run bootstrap.",
        is_eager=True,
    ),
) -> None:
    """Point the obvious `--setup` / `--configure` guesses at the real command."""
    if setup:
        typer.echo(
            "Run `pegasus-workflows setup` to seed credentials and register the MCP "
            "server. See `pegasus-workflows setup --help` for options."
        )
        raise typer.Exit(code=0)


app.command("setup")(setup_command)
app.command("init")(init_command)
app.command("diagram")(diagram_command)
app.command("package")(package_command)
app.command("push")(push_command)
app.command("run")(run_command)
app.command("test")(test_command)
app.command("configure")(configure_command)
app.command("mcp")(mcp_command)
app.command("requirements")(requirements_command)
app.add_typer(integration_config_app)
app.add_typer(executions_app)
app.add_typer(schedule_app)
app.add_typer(ingress_app)
app.add_typer(feedback_form_app)
app.add_typer(secrets_app)
app.add_typer(config_app)
app.add_typer(profile_app)


def main() -> None:
    """Console-script entry point (see ``[project.scripts]``)."""
    app()


__all__ = ["app", "main"]
