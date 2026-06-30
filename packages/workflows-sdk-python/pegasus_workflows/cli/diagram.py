"""``pegasus-workflows diagram`` — emit a prompt for your coding agent to draw the
Mermaid workflow diagram.

Business users visualize a published workflow (in the Pegasus tenant UI) to
confirm it matches their business rules. The source of that visualization is a
Mermaid flowchart embedded in the workflow bundle as ``<source_dir>/workflow.mmd``.

What's *required* to publish is only that the file exists — its contents can be
hand-written or produced by any tool. This command doesn't call any LLM itself:
it assembles a ready-to-use prompt (the workflow's Python source plus the exact
output path and formatting rules) and prints it, so you generate the diagram with
**whatever coding agent you already use** (Claude Code, Cursor, Copilot, …) on
your own subscription. Point your agent at the output, or pipe/paste it, and save
the result to ``<source_dir>/workflow.mmd``. The file is the source of truth —
edit it freely afterward. Because it lives under ``source_dir`` it is packaged
into the bundle and pinned (via ``artifactSha256``) to the exact published version.
"""

from __future__ import annotations

from pathlib import Path

import typer

from ..manifest import DIAGRAM_FILENAME, ManifestError, load_manifest

__all__ = ["diagram_command", "build_diagram_prompt", "gather_source"]

#: Files under ``source_dir`` whose contents go into the prompt.
_SOURCE_SUFFIX = ".py"

_INSTRUCTIONS = (
    "Convert this Pegasus workflow's Python source into a Mermaid flowchart that a "
    "non-technical business user can read to confirm the workflow matches their "
    "business rules. Represent the real control flow: each activity the workflow "
    "calls is a node; branches (if/else), loops, and waits are edges and decision "
    "diamonds. Do not invent steps that are not in the code. Keep node labels short "
    "and business-meaningful. Write ONLY the Mermaid `flowchart TD` (no prose, no "
    "Markdown code fences, no explanation)"
)


def gather_source(source_dir: Path) -> str:
    """Concatenate every ``.py`` file under *source_dir*, with path headers."""
    parts: list[str] = []
    for file in sorted(source_dir.rglob(f"*{_SOURCE_SUFFIX}")):
        if not file.is_file() or "__pycache__" in file.parts:
            continue
        rel = file.relative_to(source_dir)
        parts.append(f"# ===== {rel} =====\n{file.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)


def build_diagram_prompt(workflow_name: str, out_path: str, source_text: str) -> str:
    """Build the copy-pasteable / agent-actionable prompt for one workflow."""
    return (
        f"# Workflow: {workflow_name}\n"
        f"# Save the diagram to: {out_path}\n\n"
        f"{_INSTRUCTIONS}, then save it to `{out_path}`.\n\n"
        f"Workflow name: {workflow_name}\n\n"
        "Python source:\n\n"
        f"{source_text}\n"
    )


def diagram_command(
    project_dir: Path = typer.Option(
        Path("."),
        "--project-dir",
        "-C",
        help="Project directory containing pegasus-workflows.toml.",
        exists=True,
        file_okay=False,
        dir_okay=True,
    ),
    workflow: str = typer.Option(
        None,
        "--workflow",
        "-w",
        help="Only emit the prompt for this workflow name (default: all).",
    ),
    out: Path = typer.Option(
        None,
        "--out",
        "-o",
        help="Write the prompt(s) to this file instead of stdout.",
    ),
) -> None:
    """Print a prompt for your coding agent to write each ``workflow.mmd``.

    This command never calls an LLM — bring your own coding agent. Feed the output
    to whatever agent you use and save its Mermaid output to the path it names.
    """
    project_dir = project_dir.resolve()
    try:
        manifests = load_manifest(project_dir)
    except ManifestError as exc:
        typer.secho(f"manifest error: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    if workflow:
        manifests = [m for m in manifests if m.name == workflow]
        if not manifests:
            typer.secho(
                f"no workflow named {workflow!r} in this project",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1)

    prompts: list[str] = []
    failures = 0
    for manifest in manifests:
        source_dir = project_dir / manifest.source_dir
        if not source_dir.is_dir():
            typer.secho(
                f"failed {manifest.name}: source_dir '{manifest.source_dir}' not found",
                fg=typer.colors.RED,
                err=True,
            )
            failures += 1
            continue
        out_path = f"{manifest.source_dir}/{DIAGRAM_FILENAME}"
        if (source_dir / DIAGRAM_FILENAME).is_file():
            typer.secho(
                f"note {manifest.name}: {out_path} already exists — saving overwrites it",
                fg=typer.colors.YELLOW,
                err=True,
            )
        prompts.append(build_diagram_prompt(manifest.name, out_path, gather_source(source_dir)))

    if failures:
        raise typer.Exit(code=1)

    separator = "\n\n" + ("=" * 78) + "\n\n"
    rendered = separator.join(prompts)
    if out is not None:
        out.write_text(rendered + "\n", encoding="utf-8")
        typer.secho(
            f"wrote prompt for {len(prompts)} workflow(s) to {out} — feed it to your coding agent",
            fg=typer.colors.GREEN,
            err=True,
        )
    else:
        typer.echo(rendered)
