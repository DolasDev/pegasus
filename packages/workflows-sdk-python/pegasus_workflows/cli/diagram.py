"""``pegasus-workflows diagram`` — generate a Mermaid diagram from workflow code.

Business users visualize a published workflow (in the Pegasus tenant UI) to
confirm it matches their business rules. The source of that visualization is a
Mermaid flowchart embedded in the workflow bundle as ``<source_dir>/workflow.mmd``.

This command produces that file by sending the workflow's Python source to the
Anthropic API and asking for a faithful ``flowchart TD``. The author can then
hand-edit ``workflow.mmd`` — the file is the source of truth; generation is a
convenience. Because the file lives under ``source_dir`` it is packaged into the
bundle and pinned (via ``artifactSha256``) to the exact published version.

Requires the optional ``[diagram]`` extra (the ``anthropic`` SDK) and an
``ANTHROPIC_API_KEY`` in the environment.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import typer

from ..manifest import DIAGRAM_FILENAME, Manifest, ManifestError, load_manifest

__all__ = ["diagram_command", "build_diagram_prompt", "extract_mermaid"]

#: Default Claude model. Override with ``--model`` or ``$PEGASUS_DIAGRAM_MODEL``.
DEFAULT_MODEL = "claude-opus-4-8"

#: Env var consulted when ``--model`` is omitted.
MODEL_ENV_VAR = "PEGASUS_DIAGRAM_MODEL"

#: Files under ``source_dir`` whose contents are sent to the model.
_SOURCE_SUFFIX = ".py"

_SYSTEM_PROMPT = (
    "You convert a Pegasus workflow's Python source into a Mermaid flowchart that "
    "a non-technical business user can read to confirm the workflow matches their "
    "business rules. Output ONLY a Mermaid `flowchart TD` — no prose, no Markdown "
    "code fences, no explanation. Represent the real control flow: each activity "
    "the workflow calls is a node; branches (if/else), loops, and waits are edges "
    "and decision diamonds. Do not invent steps that are not in the code. Keep node "
    "labels short and business-meaningful."
)


def _gather_source(source_dir: Path) -> str:
    """Concatenate every ``.py`` file under *source_dir*, with path headers."""
    parts: list[str] = []
    for file in sorted(source_dir.rglob(f"*{_SOURCE_SUFFIX}")):
        if not file.is_file() or "__pycache__" in file.parts:
            continue
        rel = file.relative_to(source_dir)
        parts.append(f"# ===== {rel} =====\n{file.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)


def build_diagram_prompt(workflow_name: str, source_text: str) -> str:
    """Build the user prompt sent to the model for *workflow_name*."""
    return (
        f"Workflow name: {workflow_name}\n\n"
        "Here is the workflow's Python source:\n\n"
        f"{source_text}\n\n"
        "Produce the Mermaid `flowchart TD` for this workflow."
    )


def extract_mermaid(text: str) -> str:
    """Extract the Mermaid diagram from a model response.

    Tolerates a ```mermaid fenced block (or a bare ``` fence) and strips any
    stray prose before the first ``flowchart``/``graph`` directive.
    """
    fenced = re.search(r"```(?:mermaid)?\s*\n(.*?)```", text, re.DOTALL)
    body = fenced.group(1) if fenced else text
    body = body.strip()
    # Drop any leading prose before the diagram directive.
    match = re.search(r"^(flowchart|graph)\b", body, re.MULTILINE)
    if match:
        body = body[match.start() :]
    return body.strip()


def _load_anthropic_client() -> Any:
    """Construct an Anthropic client, with friendly errors for the common gaps."""
    try:
        import anthropic
    except ModuleNotFoundError as exc:  # pragma: no cover - import guard
        raise typer.Exit(code=1) from exc
    if not os.environ.get("ANTHROPIC_API_KEY"):
        typer.secho(
            "ANTHROPIC_API_KEY is not set — export your Anthropic API key first",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)
    return anthropic.Anthropic()


def generate_mermaid(client: Any, model: str, manifest: Manifest, source_text: str) -> str:
    """Call the model and return the extracted Mermaid diagram string."""
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_diagram_prompt(manifest.name, source_text)}],
    )
    text = "".join(
        block.text for block in response.content if getattr(block, "type", None) == "text"
    )
    diagram = extract_mermaid(text)
    if not diagram:
        raise RuntimeError(f"model returned no usable Mermaid diagram for {manifest.name}")
    return diagram


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
        help="Only generate the diagram for this workflow name (default: all).",
    ),
    model: str = typer.Option(
        None,
        "--model",
        help=f"Claude model id. Falls back to ${MODEL_ENV_VAR}, then {DEFAULT_MODEL}.",
        envvar=MODEL_ENV_VAR,
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Overwrite an existing workflow.mmd instead of skipping it.",
    ),
) -> None:
    """Generate ``workflow.mmd`` for each workflow from its Python source."""
    project_dir = project_dir.resolve()
    chosen_model = model or DEFAULT_MODEL
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

    client = _load_anthropic_client()
    failures = 0

    for manifest in manifests:
        source_dir = project_dir / manifest.source_dir
        out_path = source_dir / DIAGRAM_FILENAME
        if out_path.is_file() and not force:
            typer.secho(
                f"skipped {manifest.name}: {out_path.name} exists (use --force to regenerate)",
                fg=typer.colors.YELLOW,
            )
            continue
        if not source_dir.is_dir():
            typer.secho(
                f"failed {manifest.name}: source_dir '{manifest.source_dir}' not found",
                fg=typer.colors.RED,
                err=True,
            )
            failures += 1
            continue

        source_text = _gather_source(source_dir)
        try:
            typer.echo(f"-> generating diagram for {manifest.name} ({chosen_model})")
            diagram = generate_mermaid(client, chosen_model, manifest, source_text)
        except Exception as exc:  # noqa: BLE001 - report and continue to next workflow
            typer.secho(f"failed {manifest.name}: {exc}", fg=typer.colors.RED, err=True)
            failures += 1
            continue

        out_path.write_text(diagram + "\n", encoding="utf-8")
        typer.secho(f"wrote {out_path}", fg=typer.colors.GREEN)

    if failures:
        raise typer.Exit(code=1)
