"""``pegasus-workflows integration-config`` — author the DB-backed integration
validator config (mapping + rules) through the real publish path.

A small Typer group over the integration-config endpoints
(``apps/api/src/handlers/integration-validation/config.ts``):

* ``validate`` — dry-run the publish gate (no write); a pre-check.
* ``publish``  — gate then publish a new GLOBAL/TENANT config version.
* ``pull``     — fetch the active config and write the editable surface to disk.
* ``versions`` — list the version history.
* ``rollback`` — re-publish a prior version.
* ``fork``     — copy the platform GLOBAL config into this tenant (``--force``
  refreshes an overlay this tenant already owns).
* ``delete``   — permanently remove the caller's config for an integration.

The editable surface lives as JSON files in a working directory: ``mapping.json``,
``rules.json``, ``corpus.json`` (required), plus — for the floor/overlay split
(sdk-feedback 0019 + 0020) — the optional ``meta.json`` (``{floor, displayName}``),
``external-shape.json`` and ``external-mapping.json``. ``pull`` writes them;
``validate`` / ``publish`` read them. That is the round-trip:
``pull`` → edit → ``validate`` → ``publish``. A NEW partner on an existing type is
authorable from a working directory alone: set ``floor`` in ``meta.json`` (and, for
a non-identity body, the external files) and ``publish`` a new integration id.

Auth mirrors ``push``: a ``vnd_`` API key via ``--token`` / ``$PEGASUS_WORKFLOW_TOKEN``.
To publish GLOBAL the key's tenant must be the platform tenant; the key must
carry the ``PublishIntegrationConfig`` action to mutate (validate is read-level).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import typer

from ..api import PegasusApiError, PegasusClient
from ._auth import base_url_option, profile_option, resolve_credentials, token_option

__all__ = ["integration_config_app"]

#: The editable surface, as conventional filenames in the working directory.
MAPPING_FILE = "mapping.json"
RULES_FILE = "rules.json"
CORPUS_FILE = "corpus.json"
#: Optional floor/overlay files (sdk-feedback 0019 + 0020). `meta.json` carries
#: `{floor, displayName}`; the external-* files carry the partner output shape +
#: canonical→external projection. Absent ⇒ inherit the built-in floor / identity
#: external, so a pre-0020 working directory publishes unchanged.
META_FILE = "meta.json"
EXTERNAL_SHAPE_FILE = "external-shape.json"
EXTERNAL_MAPPING_FILE = "external-mapping.json"
#: Optional inbound ingress block (sdk-feedback 0021): { eventType, dedupKeyPath,
#: validation, ackTemplate }. Present ⇒ the ingress renders the partner's ack
#: envelope (e.g. ADE Result{…}) + validates the body. See the JSON Schema at
#: GET /api/v1/integrations/inbound-schema. Absent ⇒ non-ingress integration.
INBOUND_FILE = "inbound.json"


@dataclass
class _Surface:
    """The full authoring surface loaded from a working directory."""

    mapping: Any
    rules: Any
    corpus: Any
    floor: str | None = None
    display_name: str | None = None
    external_shape: Any | None = None
    external_mapping: Any | None = None
    inbound: Any | None = None
    required_secrets: Any | None = None
    required_configs: Any | None = None

integration_config_app = typer.Typer(
    name="integration-config",
    help="Author the integration-validator config (mapping + rules) for an integration.",
    no_args_is_help=True,
    add_completion=False,
)


# -- shared helpers ---------------------------------------------------------


def _load_json(directory: Path, filename: str) -> Any:
    path = directory / filename
    if not path.is_file():
        typer.secho(f"missing {filename} in {directory}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        typer.secho(f"invalid JSON in {path}: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc


def _load_optional_json(directory: Path, filename: str) -> Any | None:
    """Read *filename* if it exists; return None when absent (errors on bad JSON)."""
    if not (directory / filename).is_file():
        return None
    return _load_json(directory, filename)


def _load_surface(directory: Path) -> _Surface:
    """Read the editable surface (required) + optional floor/overlay files.

    ``mapping.json`` / ``rules.json`` / ``corpus.json`` are required. ``meta.json``
    (``{floor, displayName, requiredSecrets?, requiredConfigs?}``) and
    ``external-shape.json`` / ``external-mapping.json`` are optional (sdk-feedback
    0019 + 0020) — absent ⇒ the built-in floor / identity external, so a pre-0020
    directory publishes byte-identically. ``requiredSecrets``/``requiredConfigs``
    (each a list of ``{key, group?, description?}``) declare the keys the
    integration reads at runtime, for the tenant's present/missing view.
    """
    meta = _load_optional_json(directory, META_FILE)
    meta_dict = meta if isinstance(meta, dict) else {}
    return _Surface(
        mapping=_load_json(directory, MAPPING_FILE),
        rules=_load_json(directory, RULES_FILE),
        corpus=_load_json(directory, CORPUS_FILE),
        floor=meta_dict.get("floor"),
        display_name=meta_dict.get("displayName"),
        external_shape=_load_optional_json(directory, EXTERNAL_SHAPE_FILE),
        external_mapping=_load_optional_json(directory, EXTERNAL_MAPPING_FILE),
        inbound=_load_optional_json(directory, INBOUND_FILE),
        required_secrets=meta_dict.get("requiredSecrets"),
        required_configs=meta_dict.get("requiredConfigs"),
    )


def _print_report(report: dict[str, Any]) -> None:
    """Print a gate report and its problems/failures."""
    corpus = report.get("corpus", {})
    ok = report.get("ok")
    color = typer.colors.GREEN if ok else typer.colors.RED
    typer.secho(
        f"gate ok={ok} corpus={corpus.get('passed')}/{corpus.get('total')}",
        fg=color,
    )
    for problem in report.get("problems", []):
        typer.secho(
            f"  [{problem.get('stage')}] {problem.get('where')}: {problem.get('problem')}",
            fg=typer.colors.YELLOW,
            err=True,
        )
    for failure in corpus.get("failures", []):
        typer.secho(
            f"  corpus '{failure.get('name')}' ({failure.get('reason')}): "
            f"{failure.get('detail')}",
            fg=typer.colors.YELLOW,
            err=True,
        )


# Reusable option declarations (Typer reads the default object per-parameter).
def _dir_option() -> Any:
    return typer.Option(
        Path("."),
        "--dir",
        "-C",
        help="Directory holding mapping.json / rules.json / corpus.json "
        "(+ optional meta.json / external-shape.json / external-mapping.json).",
        file_okay=False,
        dir_okay=True,
    )


# -- commands ---------------------------------------------------------------


@integration_config_app.command("validate")
def validate_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Dry-run the publish gate for the config in *dir*. Writes nothing."""
    token, base_url = resolve_credentials(token, base_url, profile)
    surface = _load_surface(directory.resolve())
    client = PegasusClient(base_url=base_url, token=token)
    try:
        report = client.validate_integration_config(
            integration_id,
            mapping=surface.mapping,
            rules=surface.rules,
            corpus=surface.corpus,
            floor=surface.floor,
            display_name=surface.display_name,
            external_shape=surface.external_shape,
            external_mapping=surface.external_mapping,
            inbound=surface.inbound,
            required_secrets=surface.required_secrets,
            required_configs=surface.required_configs,
        )
    except PegasusApiError as exc:
        typer.secho(f"validate failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    _print_report(report)
    if not report.get("ok"):
        raise typer.Exit(code=1)


@integration_config_app.command("publish")
def publish_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Gate then publish the config in *dir* as a new version."""
    token, base_url = resolve_credentials(token, base_url, profile)
    surface = _load_surface(directory.resolve())
    client = PegasusClient(base_url=base_url, token=token)
    try:
        row = client.publish_integration_config(
            integration_id,
            mapping=surface.mapping,
            rules=surface.rules,
            corpus=surface.corpus,
            floor=surface.floor,
            display_name=surface.display_name,
            external_shape=surface.external_shape,
            external_mapping=surface.external_mapping,
            inbound=surface.inbound,
            required_secrets=surface.required_secrets,
            required_configs=surface.required_configs,
        )
    except PegasusApiError as exc:
        # A gate failure (422) carries the report; surface it.
        if exc.status_code == 422:
            typer.secho(f"gate failed — not published: {exc}", fg=typer.colors.RED, err=True)
        else:
            typer.secho(f"publish failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(
        f"published {integration_id} v{row.get('version')} ({row.get('visibility')})",
        fg=typer.colors.GREEN,
    )


@integration_config_app.command("pull")
def pull_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    directory: Path = _dir_option(),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
    stdout: bool = typer.Option(
        False, "--stdout", help="Print the full config JSON instead of writing files."
    ),
) -> None:
    """Fetch the active config; write the editable surface to *dir* (or stdout)."""
    token, base_url = resolve_credentials(token, base_url, profile)
    client = PegasusClient(base_url=base_url, token=token)
    try:
        config = client.get_integration_config(integration_id)
    except PegasusApiError as exc:
        typer.secho(f"pull failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc

    if stdout:
        typer.echo(json.dumps(config, indent=2, sort_keys=True))
        return

    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for filename, key in (
        (MAPPING_FILE, "mapping"),
        (RULES_FILE, "rules"),
        (CORPUS_FILE, "corpus"),
    ):
        (directory / filename).write_text(
            json.dumps(config.get(key), indent=2, sort_keys=True) + "\n"
        )
        written.append(filename)

    # Floor/overlay round-trip (0019 + 0020): preserve floor + displayName, the
    # declared required secret/config keys, and the partner external shape/mapping
    # so a subsequent publish does not strip them.
    floor = config.get("floor")
    display_name = config.get("displayName")
    required_secrets = config.get("requiredSecrets")
    required_configs = config.get("requiredConfigs")
    meta = {"floor": floor, "displayName": display_name}
    if required_secrets is not None:
        meta["requiredSecrets"] = required_secrets
    if required_configs is not None:
        meta["requiredConfigs"] = required_configs
    if any(v is not None for v in meta.values()):
        (directory / META_FILE).write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
        written.append(META_FILE)
    for filename, key in (
        (EXTERNAL_SHAPE_FILE, "externalShape"),
        (EXTERNAL_MAPPING_FILE, "externalMapping"),
        (INBOUND_FILE, "inbound"),
    ):
        if config.get(key) is not None:
            (directory / filename).write_text(
                json.dumps(config.get(key), indent=2, sort_keys=True) + "\n"
            )
            written.append(filename)

    typer.secho(
        f"pulled {integration_id} v{config.get('version')} ({config.get('visibility')}) "
        f"-> {directory}/{{{','.join(written)}}}",
        fg=typer.colors.GREEN,
    )


@integration_config_app.command("versions")
def versions_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """List the config version history for the caller's scope, newest first."""
    token, base_url = resolve_credentials(token, base_url, profile)
    client = PegasusClient(base_url=base_url, token=token)
    try:
        rows = client.list_integration_config_versions(integration_id)
    except PegasusApiError as exc:
        typer.secho(f"versions failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    if not rows:
        typer.echo("no published versions")
        return
    for row in rows:
        typer.echo(
            f"v{row.get('version')}\t{row.get('status')}\t{row.get('visibility')}\t"
            f"{row.get('createdAt')}"
        )


@integration_config_app.command("rollback")
def rollback_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    version: int = typer.Argument(..., help="The existing version to re-publish."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
) -> None:
    """Re-publish a prior version as a new version (re-runs the gate)."""
    token, base_url = resolve_credentials(token, base_url, profile)
    client = PegasusClient(base_url=base_url, token=token)
    try:
        row = client.rollback_integration_config(integration_id, version)
    except PegasusApiError as exc:
        if exc.status_code == 422:
            typer.secho(
                f"rolled-back config no longer passes the gate: {exc}",
                fg=typer.colors.RED,
                err=True,
            )
        else:
            typer.secho(f"rollback failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(
        f"rolled back {integration_id} from v{version} -> v{row.get('version')}",
        fg=typer.colors.GREEN,
    )


@integration_config_app.command("fork")
def fork_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
    force: bool = typer.Option(
        False,
        "--force",
        help="Refresh an overlay this tenant already owns from the current GLOBAL "
        "config, instead of failing because one exists.",
    ),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip the --force confirmation prompt (for scripts/CI)."
    ),
) -> None:
    """Copy the platform GLOBAL config into this tenant as its own overlay.

    The starting point for customizing a platform default: the GLOBAL config is
    copied into a TENANT config you own, stamped with fork provenance, after
    re-running the publish gate against the current floor.

    ``--force`` also makes this the RE-SYNC path. Without it a fork is one-shot —
    a tenant already holding an overlay gets a conflict, so an overlay forked from
    an old GLOBAL can never pick up upstream fixes. With it the overlay is re-seeded
    from the current GLOBAL as a NEW version; prior versions stay in ``versions``
    and remain reachable via ``rollback``, so a bad refresh is reversible.

    Use ``delete`` instead if you want no overlay at all and to re-inherit GLOBAL
    live from then on.
    """
    token, base_url = resolve_credentials(token, base_url, profile)
    if force and not yes:
        typer.confirm(
            f"Refresh this tenant's '{integration_id}' overlay from the current "
            "GLOBAL config? Your current mapping/rules stop being the active "
            "version (they stay in `versions` and can be rolled back to).",
            abort=True,
        )
    client = PegasusClient(base_url=base_url, token=token)
    try:
        row = client.fork_integration_config(integration_id, force=force)
    except PegasusApiError as exc:
        if exc.status_code == 409:
            typer.secho(
                f"not forked — this tenant already has its own config for "
                f"'{integration_id}': {exc}\n"
                "Re-run with --force to refresh it from the current GLOBAL config.",
                fg=typer.colors.RED,
                err=True,
            )
        elif exc.status_code == 422:
            typer.secho(
                f"the GLOBAL config no longer passes the gate: {exc}",
                fg=typer.colors.RED,
                err=True,
            )
        else:
            typer.secho(f"fork failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    verb = "refreshed" if force else "forked"
    typer.secho(
        f"{verb} {integration_id} from GLOBAL v{row.get('forkedFromVersion')} "
        f"-> TENANT v{row.get('version')}",
        fg=typer.colors.GREEN,
    )


@integration_config_app.command("delete")
def delete_command(
    integration_id: str = typer.Argument(..., help="Integration id, e.g. demo_partner."),
    token: str = token_option(),
    base_url: str = base_url_option(),
    profile: str = profile_option(),
    force: bool = typer.Option(
        False,
        "--force",
        help="Delete a GLOBAL config even though other tenants still have their own "
        "overlay for the id (their overlays are left intact).",
    ),
    yes: bool = typer.Option(
        False, "--yes", "-y", help="Skip the confirmation prompt (for scripts/CI)."
    ),
) -> None:
    """Permanently delete the caller's config for an integration.

    Removes the WHOLE version lineage your tenant owns — the platform tenant's
    GLOBAL config (retiring a placeholder or renamed id), or any other tenant's
    own overlay (dropping it to re-inherit the platform GLOBAL). Irreversible:
    nothing survives in ``versions``, so ``rollback`` cannot undo it.
    """
    token, base_url = resolve_credentials(token, base_url, profile)
    if not yes:
        typer.confirm(
            f"Permanently delete every published version of '{integration_id}' "
            "owned by this tenant? This cannot be undone.",
            abort=True,
        )
    client = PegasusClient(base_url=base_url, token=token)
    try:
        result = client.delete_integration_config(integration_id, force=force)
    except PegasusApiError as exc:
        if exc.status_code == 409:
            typer.secho(
                f"not deleted — other tenants still have their own config for "
                f"'{integration_id}': {exc}\n"
                "Re-run with --force to delete the GLOBAL config anyway.",
                fg=typer.colors.RED,
                err=True,
            )
        else:
            typer.secho(f"delete failed: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from exc
    typer.secho(
        f"deleted {integration_id} ({result.get('visibility')}) — "
        f"{result.get('deleted')} version(s) removed",
        fg=typer.colors.GREEN,
    )
