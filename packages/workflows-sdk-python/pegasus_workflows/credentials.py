"""Named credential profiles (AWS-CLI-style) for the publishing CLI.

Stores ``vnd_`` API keys + API roots in a local, uncommitted TOML file —
``~/.pegasus/credentials`` — one table per profile, so tokens never have to be
pasted on the command line (where they leak into shell history, process
listings, and agent transcripts).

```toml
[default]
api_key = "vnd_…"
api_root = "https://api.pegasus.dolas.dev"   # optional

[qa]
api_key = "vnd_…"
api_root = "https://api.pegasus-qa.dolas.dev"
```

Resolution precedence, highest first (so explicit always wins):

1. explicit ``--token`` / ``--base-url``
2. ``--profile NAME``
3. ``PEGASUS_WORKFLOW_TOKEN`` / ``PEGASUS_BASE_URL`` env vars
4. the ``[default]`` profile

This module is pure (stdlib only — ``os`` / ``tomllib`` / ``pathlib``) so it is
unit-testable without Typer; the CLI wiring lives in ``cli/_auth.py``.
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path
from typing import Any

from ._toml import dumps as _toml_dumps

__all__ = [
    "TOKEN_ENV_VAR",
    "BASE_URL_ENV_VAR",
    "CREDENTIALS_FILE_ENV_VAR",
    "DEFAULT_API_ROOT",
    "LOCAL_API_ROOT",
    "ProfileError",
    "credentials_path",
    "load_profiles",
    "list_profile_summaries",
    "resolve",
    "write_profile",
]

#: Env var consulted for the API token (tier 3 of resolution).
TOKEN_ENV_VAR = "PEGASUS_WORKFLOW_TOKEN"
#: Env var consulted for the API base URL (tier 3 of resolution).
BASE_URL_ENV_VAR = "PEGASUS_BASE_URL"
#: Override the credentials file location (cf. ``AWS_SHARED_CREDENTIALS_FILE``).
CREDENTIALS_FILE_ENV_VAR = "PEGASUS_CREDENTIALS_FILE"

#: Default API root when a profile omits ``api_root``.
DEFAULT_API_ROOT = "https://api.pegasus.dolas.dev"
#: Ultimate fallback when nothing else supplies a base URL — local dev parity.
LOCAL_API_ROOT = "http://localhost:3000"


class ProfileError(Exception):
    """Raised when a named profile is requested but not found / malformed."""


def credentials_path(*, for_write: bool = False) -> Path:
    """Resolve the credentials file path.

    Reads honor, in order: the ``PEGASUS_CREDENTIALS_FILE`` override, a
    project-local ``./.pegasus/credentials`` (if it exists), then the home file
    ``~/.pegasus/credentials``. Writes target the override if set, else the home
    file (never the project-local one implicitly — keeping secrets out of repos).
    """
    override = os.environ.get(CREDENTIALS_FILE_ENV_VAR)
    if override:
        return Path(override).expanduser()
    home_file = Path.home() / ".pegasus" / "credentials"
    if for_write:
        return home_file
    project_local = Path(".pegasus") / "credentials"
    if project_local.is_file():
        return project_local
    return home_file


def _load_profiles_from(path: Path) -> dict[str, dict[str, Any]]:
    """Parse one credentials file into ``{profile_name: {...}}`` (empty if absent)."""
    if not path.is_file():
        return {}
    try:
        with path.open("rb") as fh:
            raw = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ProfileError(f"could not read credentials file {path}: {exc}") from exc
    return {name: body for name, body in raw.items() if isinstance(body, dict)}


def load_profiles() -> dict[str, dict[str, Any]]:
    """Parse the active credentials file into ``{profile_name: {api_key, api_root}}``.

    Returns an empty dict when no file exists. Raises :class:`ProfileError` on a
    malformed file.
    """
    return _load_profiles_from(credentials_path())


def _normalize(body: dict[str, Any]) -> dict[str, str | None]:
    """Apply the ``api_root`` default to a raw profile table."""
    api_key = body.get("api_key") or None
    api_root = body.get("api_root") or DEFAULT_API_ROOT
    return {"api_key": api_key, "api_root": api_root}


def list_profile_summaries() -> list[dict[str, str | None]]:
    """Profile names + ``api_root`` only — **never** ``api_key``.

    Safe to print or to return across the MCP boundary.
    """
    return [
        {"name": name, "api_root": _normalize(body)["api_root"]}
        for name, body in sorted(load_profiles().items())
    ]


def _env(name: str) -> str | None:
    return os.environ.get(name) or None


def resolve(
    *,
    token: str | None,
    base_url: str | None,
    profile: str | None,
) -> tuple[str | None, str]:
    """Resolve ``(token, base_url)`` from flags, a named profile, env, default.

    Implements the documented precedence. ``base_url`` always resolves to a
    concrete value (ultimate fallback :data:`LOCAL_API_ROOT`); ``token`` may be
    ``None`` if nothing supplied one — the caller decides whether that is fatal.

    Raises:
        ProfileError: If ``profile`` is given but not present in the file.
    """
    profiles = load_profiles()

    named: dict[str, str | None] | None = None
    if profile is not None:
        if profile not in profiles:
            known = ", ".join(sorted(profiles)) or "(none configured)"
            raise ProfileError(
                f"no credential profile '{profile}' in {credentials_path()} "
                f"— known profiles: {known}"
            )
        named = _normalize(profiles[profile])

    default: dict[str, str | None] | None = None
    if "default" in profiles:
        default = _normalize(profiles["default"])

    resolved_token = (
        token
        or (named["api_key"] if named else None)
        or _env(TOKEN_ENV_VAR)
        or (default["api_key"] if default else None)
    )
    resolved_base_url = (
        base_url
        or (named["api_root"] if named else None)
        or _env(BASE_URL_ENV_VAR)
        or (default["api_root"] if default else None)
        or LOCAL_API_ROOT
    )
    return resolved_token, resolved_base_url


def write_profile(name: str, *, api_key: str, api_root: str | None = None) -> Path:
    """Create/update a profile table, with ``0600`` perms on the file.

    The parent ``~/.pegasus`` directory is created ``0700``. An existing file is
    re-tightened to ``0600`` on every write (never widened). Returns the path
    written.
    """
    path = credentials_path(for_write=True)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    # Read the existing profiles from the WRITE target specifically — not via
    # load_profiles(), which honors the project-local read override and would
    # otherwise merge a different file's profiles into (and clobber) the home file.
    profiles = _load_profiles_from(path)
    table: dict[str, Any] = {"api_key": api_key}
    if api_root:
        table["api_root"] = api_root
    profiles[name] = table

    # Open 0600, then fchmod the (possibly pre-existing, looser-perm) fd to 0600
    # BEFORE writing, so the token is never world-readable even for a pre-existing
    # file. fchmod targets this exact fd, immune to a path swap.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        fh = os.fdopen(fd, "w", encoding="utf-8")
    except BaseException:
        os.close(fd)  # fdopen never took ownership of the fd
        raise
    with fh:
        os.fchmod(fd, 0o600)
        fh.write(_toml_dumps(profiles))
    return path
