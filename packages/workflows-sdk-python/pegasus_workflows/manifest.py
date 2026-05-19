"""Parse and validate the ``pegasus-workflows.toml`` manifest.

The validation rules here mirror the server-side ``ManifestSchema`` in
``apps/api/src/handlers/workflows.ts`` *exactly* so the CLI fails fast,
locally, before ever hitting the API. If the server schema changes, change
:data:`NAME_REGEX`, :data:`VERSION_REGEX`, and the entry-point rules here to
match.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "NAME_REGEX",
    "VERSION_REGEX",
    "Manifest",
    "ManifestError",
    "load_manifest",
    "validate_manifest_fields",
]

#: Allowed workflow names. Mirrors the server's ``NAME_REGEX``.
NAME_REGEX = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

#: Allowed workflow versions (semver subset). Mirrors the server's
#: ``VERSION_REGEX``.
VERSION_REGEX = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$")

#: Canonical manifest file name.
MANIFEST_FILENAME = "pegasus-workflows.toml"


class ManifestError(ValueError):
    """Raised when a manifest is missing, malformed, or fails validation."""


@dataclass(frozen=True)
class Manifest:
    """A validated single workflow declaration from ``pegasus-workflows.toml``.

    Attributes:
        name: Workflow name (matches :data:`NAME_REGEX`).
        version: Semantic version (matches :data:`VERSION_REGEX`).
        entry_points: Non-empty list of dotted entry-point paths.
        source_dir: Directory (relative to the manifest) holding the
            workflow's Python source. Defaults to ``name``.
        description: Optional human-readable description.
        required_actions: Cedar action ids the workflow needs at runtime.
            Defaults to an empty list.
    """

    name: str
    version: str
    entry_points: list[str]
    source_dir: str
    description: str | None = None
    required_actions: list[str] = field(default_factory=list)

    def to_api_manifest(self) -> dict[str, object]:
        """Return the dict shape the finalize endpoint expects.

        The key names are camelCase to match the server's Zod
        ``ManifestSchema``.
        """
        manifest: dict[str, object] = {
            "name": self.name,
            "version": self.version,
            "entryPoints": list(self.entry_points),
            "requiredActions": list(self.required_actions),
        }
        if self.description is not None:
            manifest["description"] = self.description
        return manifest


def validate_manifest_fields(
    name: object,
    version: object,
    entry_points: object,
    description: object = None,
    required_actions: object = None,
) -> None:
    """Validate raw manifest field values, raising :class:`ManifestError`.

    Re-implements the server's ``ManifestSchema`` checks so authors get the
    same error before an upload is attempted.

    Args:
        name: Candidate workflow name.
        version: Candidate version string.
        entry_points: Candidate entry-point list.
        description: Optional description.
        required_actions: Optional list of Cedar action ids.

    Raises:
        ManifestError: If any field is missing or invalid.
    """
    if not isinstance(name, str) or not NAME_REGEX.match(name):
        raise ManifestError(
            f"name must be lowercase letters/digits/_/-, 1-64 chars (got {name!r})"
        )
    if not isinstance(version, str) or not VERSION_REGEX.match(version):
        raise ManifestError(
            f"version must be semver, e.g. 1.2.3 or 1.2.3-beta.1 (got {version!r})"
        )
    if not isinstance(entry_points, list) or len(entry_points) == 0:
        raise ManifestError("entryPoints must be a non-empty list of strings")
    for ep in entry_points:
        if not isinstance(ep, str) or ep == "":
            raise ManifestError(f"every entry point must be a non-empty string (got {ep!r})")
    if description is not None and not isinstance(description, str):
        raise ManifestError("description must be a string when present")
    if required_actions is not None:
        if not isinstance(required_actions, list):
            raise ManifestError("required_actions must be a list of strings when present")
        for action in required_actions:
            if not isinstance(action, str) or action == "":
                raise ManifestError(
                    f"every required action must be a non-empty string (got {action!r})"
                )


def load_manifest(path: str | Path) -> list[Manifest]:
    """Load and validate every workflow declared in a manifest file.

    The manifest file is TOML. Supported shapes::

        # multiple workflows
        [[workflow]]
        name = "send_quote_followup"
        version = "0.1.0"
        entry_points = ["send_quote_followup.workflow:SendQuoteFollowup"]
        source_dir = "send_quote_followup"   # optional, defaults to name
        description = "..."                   # optional
        required_actions = ["ReadQuote"]      # optional, defaults to []

    Args:
        path: Path to a ``pegasus-workflows.toml`` file *or* to a directory
            containing one.

    Returns:
        One validated :class:`Manifest` per ``[[workflow]]`` table.

    Raises:
        ManifestError: If the file is missing, not valid TOML, declares no
            workflows, or any workflow fails validation.
    """
    p = Path(path)
    if p.is_dir():
        p = p / MANIFEST_FILENAME
    if not p.is_file():
        raise ManifestError(f"manifest not found: {p}")

    try:
        raw = tomllib.loads(p.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ManifestError(f"{p} is not valid TOML: {exc}") from exc

    workflows = raw.get("workflow")
    if not isinstance(workflows, list) or len(workflows) == 0:
        raise ManifestError(f"{p} declares no [[workflow]] tables")

    parsed: list[Manifest] = []
    for entry in workflows:
        if not isinstance(entry, dict):
            raise ManifestError("each [[workflow]] table must be a table")
        name = entry.get("name")
        version = entry.get("version")
        entry_points = entry.get("entry_points")
        description = entry.get("description")
        required_actions = entry.get("required_actions")
        validate_manifest_fields(name, version, entry_points, description, required_actions)
        source_dir = entry.get("source_dir", name)
        if not isinstance(source_dir, str) or source_dir == "":
            raise ManifestError(f"source_dir must be a non-empty string (got {source_dir!r})")
        parsed.append(
            Manifest(
                name=name,  # type: ignore[arg-type]
                version=version,  # type: ignore[arg-type]
                entry_points=list(entry_points),  # type: ignore[arg-type]
                source_dir=source_dir,
                description=description,
                required_actions=list(required_actions) if required_actions else [],
            )
        )

    seen: set[tuple[str, str]] = set()
    for m in parsed:
        key = (m.name, m.version)
        if key in seen:
            raise ManifestError(f"duplicate workflow {m.name}@{m.version} in {p}")
        seen.add(key)

    return parsed
