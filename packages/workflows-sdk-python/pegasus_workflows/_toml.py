"""A minimal TOML *writer* — the stdlib only ships a reader (``tomllib``).

Deliberately tiny: it serializes a ``dict`` of tables whose values are strings
or one level of nested tables (``[table.subtable]``). That is all the SDK needs
to persist the credential profiles file and the per-project deployments ledger,
and keeping the surface small keeps it correct. Anything richer (arrays,
numbers, datetimes, deeper nesting) is intentionally unsupported — pass strings.

Round-trips with ``tomllib.load`` for the shapes it emits.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = ["dumps"]

#: A TOML *bare key* needs no quoting; anything else is emitted as a basic string.
_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def _escape(value: str) -> str:
    """Escape a string for a TOML basic (double-quoted) string.

    Backslash first, then quote and the control chars TOML requires as escapes —
    without these a value carrying a newline (e.g. a token pasted with a trailing
    ``\\n``) would emit an unterminated string and corrupt the whole file.
    """
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def _key(name: str) -> str:
    """Render *name* as a TOML key — bare when safe, quoted otherwise."""
    return name if _BARE_KEY.match(name) else f'"{_escape(name)}"'


def _emit_table(path: list[str], body: dict[str, Any], lines: list[str]) -> None:
    scalars = {k: v for k, v in body.items() if not isinstance(v, dict)}
    subtables = {k: v for k, v in body.items() if isinstance(v, dict)}

    if lines:
        lines.append("")
    lines.append(f"[{'.'.join(_key(p) for p in path)}]")
    for k, v in scalars.items():
        lines.append(f'{_key(k)} = "{_escape(str(v))}"')
    for k, v in subtables.items():
        _emit_table([*path, k], v, lines)


def dumps(data: dict[str, dict[str, Any]]) -> str:
    """Serialize *data* (a dict of tables) to TOML text.

    Each top-level key becomes a ``[table]``; string values become
    ``key = "value"``; a nested dict becomes a ``[table.subtable]``.
    """
    lines: list[str] = []
    for table, body in data.items():
        if not isinstance(body, dict):
            raise TypeError(f"top-level value for '{table}' must be a table (dict)")
        _emit_table([table], body, lines)
    return "\n".join(lines) + ("\n" if lines else "")
