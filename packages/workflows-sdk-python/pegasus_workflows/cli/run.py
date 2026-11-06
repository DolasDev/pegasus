"""``pegasus-workflows run`` — trigger a server-side execution.

Looks up an Automation by ``name@version`` (or ``name`` if there is only one
version visible — with several, a bare ``name`` is refused and the error lists
them, so a newer push never leaves you silently running an older one), POSTs
``/api/v1/workflows/{id}/run``, and prints the returned execution row. An
Automation that is not executable is refused by the server with 400
``WORKFLOW_NOT_EXECUTABLE``.

The resolved row is the one that RUNS: the runner installs that published
artifact specifically and fails rather than falling back to another version.
So ``@version`` means what it says even when a newer version exists, and a
version published seconds ago runs on the very next execution — no waiting for
a runner to cycle. The returned execution row echoes ``workflowName`` /
``workflowVersion`` so the executed build is visible without a second lookup.

Examples::

    pegasus-workflows run send_quote_followup \\
        --input '{"quote_id":"q-123"}'

    pegasus-workflows run send_quote_followup@0.1.0 \\
        --base-url https://api.pegasus-qa.dolas.dev
"""

from __future__ import annotations

import json as json_mod
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["run_command"]


def _parse_name_version(spec: str) -> tuple[str, str | None]:
    """Split a ``name`` or ``name@version`` argument."""
    if "@" in spec:
        name, version = spec.split("@", 1)
        return name, version
    return spec, None


def _version_key(version: str) -> tuple[tuple[int, ...], int, str]:
    """Order ``1.2.3`` / ``1.2.3-beta.1`` numerically, a release after its pre-releases."""
    core, _, pre = version.partition("-")
    nums = tuple(int(p) if p.isdigit() else 0 for p in core.split("."))
    return nums, 0 if pre else 1, pre


def _find_workflow(
    client: PegasusClient,
    name: str,
    version: str | None,
) -> dict[str, Any]:
    """Find the Automation row matching ``name`` (and optional ``version``).

    A bare ``name`` must resolve to exactly one version; with several visible it
    is refused (listing them) rather than guessing. Prefers the caller's tenant
    rows over GLOBAL when both exist with the same (name, version) — a fork is
    the more explicit choice.
    """
    rows = client.list_workflows()
    candidates = [r for r in rows if r.get("name") == name]
    if version is not None:
        candidates = [r for r in candidates if r.get("version") == version]
    if not candidates:
        raise typer.BadParameter(
            f"no visible Automation matches {name}"
            + (f"@{version}" if version else "")
        )
    versions = sorted({str(r.get("version")) for r in candidates}, key=_version_key)
    if len(versions) > 1:
        raise typer.BadParameter(
            f"{name} has {len(versions)} visible versions ({', '.join(versions)}); "
            f"pass name@version, e.g. {name}@{versions[-1]}"
        )
    # Prefer TENANT (more specific) over GLOBAL when multiple match.
    tenant_first = sorted(
        candidates,
        key=lambda r: (r.get("visibility") != "TENANT", r.get("createdAt", "")),
        reverse=False,
    )
    return tenant_first[0]


def run_command(
    workflow: str = typer.Argument(
        ...,
        help=(
            "Automation name@version, or a bare name when only one version is visible "
            "(e.g. send_quote_followup or send_quote_followup@0.1.0)."
        ),
    ),
    input_json: str = typer.Option(
        "{}",
        "--input",
        help="JSON-encoded input payload passed to the Automation.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help=(
            "Benign rehearsal: run the real Automation with reads live but "
            "mutations captured, never performed. Tenant-runner Automations only "
            "(not curated workflows, not durable Workflows)."
        ),
    ),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Run a curated Automation against the Pegasus runtime.

    Each tenant's Automations run in the tenant's own isolated runtime. Until it
    is ready (a few minutes after the tenant's first publish) a run is refused
    with TENANT_NAMESPACE_PROVISIONING (409: retry in a minute), or
    TENANT_NAMESPACE_UNAVAILABLE (503) if it failed to provision. While it moves,
    TENANT_MIGRATING (409: retry). Nothing is started in any of those cases.

    A durable Workflow (manifest kind = "workflow") starts pinned to that exact
    version and runs up to its max_lifetime_days. Right after it is published,
    WORKFLOW_VERSION_STARTING (409: retry in ~30 s) while its worker comes up;
    OPEN_WORKFLOW_LIMIT (429) at 500 open Workflows. Nothing is started then.
    """
    token, base_url = resolve_credentials(token, base_url, profile)

    try:
        parsed_input = json_mod.loads(input_json)
    except json_mod.JSONDecodeError as exc:
        typer.secho(
            f"--input is not valid JSON: {exc}",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1) from exc
    if not isinstance(parsed_input, dict):
        typer.secho(
            "--input must decode to a JSON object",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1)

    name, version = _parse_name_version(workflow)
    client = PegasusClient(base_url=base_url, token=token)
    workflow_row = _find_workflow(client, name, version)
    mode_label = " [dry-run]" if dry_run else ""
    typer.echo(
        f"-> running {workflow_row['name']}@{workflow_row['version']}{mode_label} "
        f"({workflow_row['visibility']}, id={workflow_row['id']})"
    )
    try:
        execution = client.run_workflow(workflow_row["id"], parsed_input, dry_run=dry_run)
    except PegasusApiError as exc:
        typer.secho(f"run failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json_mod.dumps(execution, indent=2, sort_keys=True))
