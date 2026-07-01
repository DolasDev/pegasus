"""``pegasus-workflows setup`` — one guided first-run bootstrap.

The single front door a newcomer (or their AI agent) reaches for. It folds the
three otherwise-scattered first-run steps into one command:

1. **Profile seeding** — reuses the ``configure`` flow to write a
   ``~/.pegasus/credentials`` profile (``0600``), so tokens never go on the
   command line.
2. **MCP registration** — writes (or prints) the ``pegasus`` MCP-server stanza
   into the agent host's config (Claude Code ``.mcp.json``), so any capable
   agent picks up the authoring context without a hand-written JSON edit.
3. **Next steps** — prints what to do next.

Design rules (mirror ``sdk-feedback/0010``):

- **No secrets to MCP.** The ``api_key`` is written only to the ``0600``
  credentials file — never into ``.mcp.json`` (the MCP server resolves creds
  itself). ``.mcp.json`` only ever names the command to run.
- **No network.** ``setup`` performs no publish/run and no live API call.
- **Idempotent & scriptable.** Re-running is safe; with all inputs passed as
  flags it runs with zero prompts. An existing ``pegasus`` MCP entry is never
  clobbered without ``--force``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import typer

from ..credentials import DEFAULT_API_ROOT, load_profiles, write_profile

__all__ = [
    "setup_command",
    "MCP_SERVER_NAME",
    "mcp_server_stanza",
    "mcp_config_document",
    "default_mcp_config_path",
    "merge_mcp_config",
]

#: The MCP server key written into the host config.
MCP_SERVER_NAME = "pegasus"

#: Default agent-host MCP config file (Claude Code project config in the cwd).
_DEFAULT_MCP_CONFIG = ".mcp.json"


def mcp_server_stanza() -> dict[str, Any]:
    """The ``pegasus`` server entry: run the bundled stdio MCP server."""
    return {"command": "pegasus-workflows", "args": ["mcp"]}


def mcp_config_document() -> dict[str, Any]:
    """The full ``{"mcpServers": {"pegasus": {...}}}`` document to paste/consume."""
    return {"mcpServers": {MCP_SERVER_NAME: mcp_server_stanza()}}


def default_mcp_config_path() -> Path:
    """Default MCP config path — ``./.mcp.json`` (Claude Code project scope)."""
    return Path(_DEFAULT_MCP_CONFIG)


def merge_mcp_config(existing: dict[str, Any] | None, *, force: bool) -> tuple[dict[str, Any], str]:
    """Merge the ``pegasus`` server into an existing MCP config document.

    Preserves any other configured servers and top-level keys. Returns the
    merged document plus an action string (``"created"`` / ``"updated"``).

    Raises:
        FileExistsError: If a ``pegasus`` entry already exists and *force* is
            False (never clobber without an explicit opt-in).
    """
    doc: dict[str, Any] = dict(existing) if existing else {}
    servers = dict(doc.get("mcpServers") or {})
    action = "created" if MCP_SERVER_NAME not in servers else "updated"
    if MCP_SERVER_NAME in servers and not force:
        raise FileExistsError(
            f"an MCP server named '{MCP_SERVER_NAME}' already exists — "
            f"re-run with --force to overwrite it"
        )
    servers[MCP_SERVER_NAME] = mcp_server_stanza()
    doc["mcpServers"] = servers
    return doc, action


def _seed_profile(
    profile: str,
    api_key: str | None,
    api_root: str | None,
    *,
    interactive: bool,
) -> None:
    """Seed/update a credential profile, reusing the ``configure`` semantics."""
    existing = load_profiles()
    if not api_key:
        if interactive:
            if profile in existing:
                replace = typer.confirm(
                    f"profile [{profile}] already exists — replace it?", default=False
                )
                if not replace:
                    typer.secho(f"keeping existing profile [{profile}]", fg=typer.colors.GREEN)
                    return
            api_key = typer.prompt("api_key (vnd_…)", hide_input=True)
            if api_root is None:
                api_root = typer.prompt("api_root", default=DEFAULT_API_ROOT)
        else:
            # Non-interactive with no key supplied: keep an existing profile,
            # else fail clearly rather than write a keyless profile.
            if profile in existing:
                typer.secho(
                    f"profile [{profile}] already configured — keeping (pass --api-key to replace)",
                    fg=typer.colors.GREEN,
                )
                return
            typer.secho(
                f"no api_key for profile [{profile}]: pass --api-key (and optionally "
                "--api-root), or run in an interactive terminal to be prompted",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1)

    path = write_profile(profile, api_key=api_key, api_root=api_root or None)
    typer.secho(f"wrote profile [{profile}] to {path}", fg=typer.colors.GREEN)


def _register_mcp(config_path: Path, *, force: bool) -> None:
    """Write the ``pegasus`` MCP stanza into *config_path*, merging if present."""
    existing: dict[str, Any] | None = None
    if config_path.is_file():
        try:
            existing = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            typer.secho(
                f"could not read existing MCP config {config_path}: {exc}",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1) from exc
        if not isinstance(existing, dict):
            typer.secho(
                f"existing MCP config {config_path} is not a JSON object",
                fg=typer.colors.RED,
                err=True,
            )
            raise typer.Exit(code=1)

    try:
        merged, action = merge_mcp_config(existing, force=force)
    except FileExistsError as exc:
        typer.secho(str(exc), fg=typer.colors.YELLOW, err=True)
        typer.echo("MCP server already registered — leaving it unchanged.")
        return

    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    typer.secho(
        f"{action} MCP server '{MCP_SERVER_NAME}' in {config_path}", fg=typer.colors.GREEN
    )


def setup_command(
    profile: str = typer.Option(
        "default", "--profile", help="Credential profile to seed or update."
    ),
    api_key: str = typer.Option(
        None, "--api-key", help="The vnd_ API key. Prompted for (hidden) when omitted."
    ),
    api_root: str = typer.Option(
        None,
        "--api-root",
        help=f"API base URL. Prompted for when omitted (default {DEFAULT_API_ROOT}).",
    ),
    mcp_config: Path = typer.Option(
        None,
        "--mcp-config",
        help="Agent-host MCP config file to write (default ./.mcp.json).",
    ),
    print_mcp_config: bool = typer.Option(
        False,
        "--print-mcp-config",
        help="Print the MCP stanza to stdout and exit — writes no files.",
    ),
    force: bool = typer.Option(
        False, "--force", help="Overwrite an existing 'pegasus' MCP server entry."
    ),
    skip_mcp: bool = typer.Option(
        False, "--skip-mcp", help="Only seed the credential profile; skip MCP registration."
    ),
) -> None:
    """First-run bootstrap: seed a credential profile + register the MCP server.

    Runs no network calls. Writes the api_key only to the 0600 credentials file,
    never into the MCP config. Safe to re-run.
    """
    # --print-mcp-config is a pure emit: no file writes, no profile changes.
    if print_mcp_config:
        typer.echo(json.dumps(mcp_config_document(), indent=2))
        return

    interactive = sys.stdin.isatty()

    # 1. Credential profile.
    _seed_profile(profile, api_key, api_root, interactive=interactive)

    # 2. MCP server registration.
    if skip_mcp:
        typer.echo("skipped MCP registration (--skip-mcp)")
    else:
        _register_mcp(mcp_config or default_mcp_config_path(), force=force)

    # 3. Next steps.
    typer.echo("")
    typer.secho("setup complete — next steps:", fg=typer.colors.GREEN)
    typer.echo("  pegasus-workflows init <name>      # scaffold a workflow")
    typer.echo("  # then author with your MCP-connected agent, and:")
    typer.echo("  pegasus-workflows push --profile " + profile)
