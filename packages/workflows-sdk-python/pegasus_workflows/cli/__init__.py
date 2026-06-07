"""The ``pegasus-workflows`` command-line interface.

A Typer application wiring together the workflow developer flow:

* ``init`` — scaffold a new workflow project.
* ``package`` — zip each declared workflow into ``dist/``.
* ``push`` — package, then upload + finalize against the Pegasus API.
* ``run`` — trigger a server-side execution of a curated workflow.
* ``test`` — start local Temporal and run a workflow with stubbed inputs.
"""

from __future__ import annotations

import typer

from .init import init_command
from .package import package_command
from .push import push_command
from .run import run_command
from .test import test_command

app = typer.Typer(
    name="pegasus-workflows",
    help="Author, package, and publish Pegasus workflows.",
    no_args_is_help=True,
    add_completion=False,
)

app.command("init")(init_command)
app.command("package")(package_command)
app.command("push")(push_command)
app.command("run")(run_command)
app.command("test")(test_command)


def main() -> None:
    """Console-script entry point (see ``[project.scripts]``)."""
    app()


__all__ = ["app", "main"]
