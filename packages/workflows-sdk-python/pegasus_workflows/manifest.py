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
    "REQUIREMENT_KEY_REGEX",
    "REQUIREMENT_GROUP_REGEX",
    "MANIFEST_TIMEOUT_MAX_SECONDS",
    "DIAGRAM_FILENAME",
    "Manifest",
    "Requirement",
    "ManifestError",
    "load_manifest",
    "validate_manifest_fields",
]

#: Name of the Mermaid diagram file the SDK embeds in each workflow's
#: ``source_dir``. Author-written (hand-edited, scaffolded by ``init``, or drawn
#: by the developer's own coding agent — see ``pegasus-workflows diagram``),
#: required at publish time, and surfaced in the tenant UI so business users can
#: confirm a published workflow matches their business rules.
DIAGRAM_FILENAME = "workflow.mmd"

#: Maximum allowed value for ``timeout_seconds`` in the manifest. Mirrors the
#: server's ``ManifestSchema.timeoutSeconds.max(900)`` (Phase 3 Unit 10).
#: The manifest may LOWER the platform default (900 s), never raise it.
MANIFEST_TIMEOUT_MAX_SECONDS = 900

#: Allowed workflow names. Mirrors the server's ``NAME_REGEX``.
NAME_REGEX = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

#: Allowed workflow versions (semver subset). Mirrors the server's
#: ``VERSION_REGEX``.
VERSION_REGEX = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$")

#: Allowed secret/config requirement keys (env-var style). Mirrors the server's
#: ``REQUIREMENT_KEY_RE`` and the secrets/config store's ``KEY_RE``.
REQUIREMENT_KEY_REGEX = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,127}$")

#: Allowed requirement group names. Mirrors the server's ``REQUIREMENT_GROUP_RE``
#: and the store's ``GROUP_RE``.
REQUIREMENT_GROUP_REGEX = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

#: Default group when a requirement omits one — matches the store's default.
DEFAULT_REQUIREMENT_GROUP = "global"

#: Canonical manifest file name.
MANIFEST_FILENAME = "pegasus-workflows.toml"


class ManifestError(ValueError):
    """Raised when a manifest is missing, malformed, or fails validation."""


@dataclass(frozen=True)
class Requirement:
    """A secret or config key the workflow reads at runtime.

    Declared so the tenant can see up front which values the workflow needs and
    whether they are set. Purely informational — the runtime read still resolves
    lazily via ``PegasusClient.get_secret`` / ``get_config`` (404 if absent).

    Attributes:
        key: Lookup key, env-var style (:data:`REQUIREMENT_KEY_REGEX`).
        group: Logical group; defaults to ``"global"`` to match the store.
        description: Optional human note about what the value is for.
    """

    key: str
    group: str = DEFAULT_REQUIREMENT_GROUP
    description: str | None = None

    def to_api(self) -> dict[str, object]:
        """camelCase dict matching the server's ``RequirementSchema``."""
        out: dict[str, object] = {"key": self.key, "group": self.group}
        if self.description is not None:
            out["description"] = self.description
        return out


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
        required_secrets: Secret keys the workflow reads at runtime
            (:class:`Requirement`), so the tenant can see and provision them up
            front. Informational — the runtime read still resolves lazily.
            Defaults to an empty list.
        required_configs: Config keys the workflow reads at runtime, same shape
            and semantics as ``required_secrets``. Defaults to an empty list.
        timeout_seconds: Optional per-execution Temporal workflow timeout in
            seconds (Phase 3 Unit 10). When set, the platform uses this value
            instead of the default 900 s. Must be 1–900 (inclusive): the
            manifest may LOWER the platform default, never raise it. Absent
            from the TOML → use the platform default.
    """

    name: str
    version: str
    entry_points: list[str]
    source_dir: str
    description: str | None = None
    required_actions: list[str] = field(default_factory=list)
    required_secrets: list[Requirement] = field(default_factory=list)
    required_configs: list[Requirement] = field(default_factory=list)
    timeout_seconds: int | None = None

    def to_api_manifest(self, diagram: str | None = None) -> dict[str, object]:
        """Return the dict shape the finalize endpoint expects.

        The key names are camelCase to match the server's Zod
        ``ManifestSchema``.

        Args:
            diagram: The Mermaid diagram (contents of ``workflow.mmd``) to embed.
                The server requires it at publish time; the caller (``push``)
                reads the file and passes it here. When ``None`` it is omitted —
                used only by callers that don't publish (e.g. tests).
        """
        manifest: dict[str, object] = {
            "name": self.name,
            "version": self.version,
            "entryPoints": list(self.entry_points),
            "requiredActions": list(self.required_actions),
            "requiredSecrets": [r.to_api() for r in self.required_secrets],
            "requiredConfigs": [r.to_api() for r in self.required_configs],
        }
        if self.description is not None:
            manifest["description"] = self.description
        if self.timeout_seconds is not None:
            manifest["timeoutSeconds"] = self.timeout_seconds
        if diagram is not None:
            manifest["diagram"] = diagram
        return manifest


def _validate_requirements(value: object, field_name: str) -> None:
    """Validate a ``required_secrets`` / ``required_configs`` list.

    Each entry must be a table with a valid ``key`` (:data:`REQUIREMENT_KEY_REGEX`),
    an optional ``group`` (:data:`REQUIREMENT_GROUP_REGEX`), and an optional string
    ``description``. Mirrors the server's ``RequirementSchema``.
    """
    if value is None:
        return
    if not isinstance(value, list):
        raise ManifestError(f"{field_name} must be a list of tables when present")
    for entry in value:
        if not isinstance(entry, dict):
            raise ManifestError(f"every {field_name} entry must be a table (got {entry!r})")
        key = entry.get("key")
        if not isinstance(key, str) or not REQUIREMENT_KEY_REGEX.match(key):
            raise ManifestError(
                f"{field_name} key must start with a letter or _ and use only letters, "
                f"digits, and _ (max 128) (got {key!r})"
            )
        group = entry.get("group")
        if group is not None and (
            not isinstance(group, str) or not REQUIREMENT_GROUP_REGEX.match(group)
        ):
            raise ManifestError(
                f"{field_name} group must use only letters, digits, - and _ (max 64) "
                f"(got {group!r})"
            )
        description = entry.get("description")
        if description is not None and not isinstance(description, str):
            raise ManifestError(f"{field_name} description must be a string when present")


def _parse_requirements(value: object) -> list[Requirement]:
    """Build :class:`Requirement` objects from validated raw entries."""
    if not isinstance(value, list):
        return []
    out: list[Requirement] = []
    for entry in value:
        assert isinstance(entry, dict)  # guaranteed by _validate_requirements
        group = entry.get("group")
        description = entry.get("description")
        out.append(
            Requirement(
                key=entry["key"],
                group=group if isinstance(group, str) and group else DEFAULT_REQUIREMENT_GROUP,
                description=description if isinstance(description, str) else None,
            )
        )
    return out


def validate_manifest_fields(
    name: object,
    version: object,
    entry_points: object,
    description: object = None,
    required_actions: object = None,
    timeout_seconds: object = None,
    required_secrets: object = None,
    required_configs: object = None,
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
        timeout_seconds: Optional per-execution timeout (1–900 seconds).

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
    if timeout_seconds is not None:
        if not isinstance(timeout_seconds, int) or isinstance(timeout_seconds, bool):
            raise ManifestError(
                f"timeout_seconds must be an integer (got {timeout_seconds!r})"
            )
        if timeout_seconds < 1 or timeout_seconds > MANIFEST_TIMEOUT_MAX_SECONDS:
            raise ManifestError(
                f"timeout_seconds must be between 1 and {MANIFEST_TIMEOUT_MAX_SECONDS} "
                f"(got {timeout_seconds}) — the manifest may lower the platform default, "
                "not raise it"
            )
    _validate_requirements(required_secrets, "required_secrets")
    _validate_requirements(required_configs, "required_configs")


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
        required_actions = ["ReadQuote", "EmitTenantEvent"]  # optional, defaults to []
        # Secret/config keys the workflow reads at runtime (optional). Each is a
        # table with a required key, optional group (default "global"), and
        # optional description — shown to the tenant so they can provision them:
        required_secrets = [{ key = "STRIPE_API_KEY", group = "billing" }]
        required_configs = [{ key = "DEFAULT_REGION" }]

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
        timeout_seconds = entry.get("timeout_seconds")
        required_secrets = entry.get("required_secrets")
        required_configs = entry.get("required_configs")
        validate_manifest_fields(
            name,
            version,
            entry_points,
            description,
            required_actions,
            timeout_seconds,
            required_secrets,
            required_configs,
        )
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
                required_secrets=_parse_requirements(required_secrets),
                required_configs=_parse_requirements(required_configs),
                timeout_seconds=timeout_seconds,
            )
        )

    seen: set[tuple[str, str]] = set()
    for m in parsed:
        key = (m.name, m.version)
        if key in seen:
            raise ManifestError(f"duplicate workflow {m.name}@{m.version} in {p}")
        seen.add(key)

    return parsed
