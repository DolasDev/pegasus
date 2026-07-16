"""``pegasus-workflows integration-config`` — author the DB-backed integration
validator config (mapping + rules) through the real publish path.

A small Typer group over the integration-config endpoints
(``apps/api/src/handlers/integration-validation/config.ts``):

* ``validate`` — dry-run the publish gate (no write); a pre-check.
* ``publish``  — gate then publish a new GLOBAL/TENANT config version.
* ``pull``     — fetch the active config and write the editable surface to disk.
* ``versions`` — list the version history.
* ``rollback`` — re-publish a prior version.

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
    (``{floor, displayName}``) and ``external-shape.json`` / ``external-mapping.json``
    are optional (sdk-feedback 0019 + 0020) — absent ⇒ the built-in floor / identity
    external, so a pre-0020 directory publishes byte-identically.
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
    )


def _print_report(report: dict[str, Any]) -> None:
    """Print a gate report and its problems/failures."""
    corpus = report.get("corpus", {})
    ok = report.get("ok")
    colour = typer.colors.GREEN if ok else typer.colors.RED
    typer.secho(
        f"gate ok={ok} corpus={corpus.get('passed')}/{corpus.get('total')}",
        fg=colour,
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

    # Floor/overlay round-trip (0019 + 0020): preserve floor + displayName and the
    # partner external shape/mapping so a subsequent publish does not strip them.
    floor = config.get("floor")
    display_name = config.get("displayName")
    if floor is not None or display_name is not None:
        (directory / META_FILE).write_text(
            json.dumps({"floor": floor, "displayName": display_name}, indent=2, sort_keys=True)
            + "\n"
        )
        written.append(META_FILE)
    for filename, key in (
        (EXTERNAL_SHAPE_FILE, "externalShape"),
        (EXTERNAL_MAPPING_FILE, "externalMapping"),
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
