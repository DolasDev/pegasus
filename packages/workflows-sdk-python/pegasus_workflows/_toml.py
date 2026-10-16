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

__all__ = ["clear_table_scalars", "dumps", "update_table"]

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


# ── Surgical, comment-preserving table edits ─────────────────────────────────
#
# `dumps` re-serializes a whole document, so it drops any comments and blank
# lines the caller hand-maintained. The deployments ledger (deployments.toml) is
# a human-facing audit trail whose COMMENTS are the record — the "Superseded"
# id history lives nowhere else (see sdk-feedback/0013). So its recorder edits a
# single table in place instead of rewriting the file. These helpers do that on
# raw text: they update (or append) only the target table's scalar keys, leaving
# every comment, blank line, key order and other table byte-stable. They assume
# the shapes `dumps` emits — quoted string values, one level of `[a.b]` nesting.

#: A `[table]` or `[a.b]` header line (with an optional trailing comment).
_HEADER_RE = re.compile(r"^\s*\[([^\]]+)\]\s*(?:#.*)?$")
#: A `key = ...` line — captures leading indent (1) and the bare/quoted key (2).
_KEY_LINE_RE = re.compile(r'^(\s*)("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=')
#: Splits a `key = "value"` line into everything up to the value (1) and the
#: trailing text after it (2) — so a value can be swapped without disturbing an
#: inline comment or the key's own formatting.
_ASSIGN_RE = re.compile(
    r'^(\s*(?:"(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*)"(?:[^"\\]|\\.)*"(.*)$'
)


def _unquote(segment: str) -> str:
    """Strip and unescape a TOML basic string; pass a bare key through as-is."""
    seg = segment.strip()
    if not (len(seg) >= 2 and seg[0] == '"' and seg[-1] == '"'):
        return seg
    escapes = {'"': '"', "\\": "\\", "n": "\n", "r": "\r", "t": "\t"}
    inner, out, i = seg[1:-1], [], 0
    while i < len(inner):
        c = inner[i]
        if c == "\\" and i + 1 < len(inner):
            out.append(escapes.get(inner[i + 1], inner[i + 1]))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _header_path(inside: str) -> list[str]:
    """Split a header's inner text (``prod.alpha``, ``"a.b".alpha``) into keys."""
    segs, cur, in_q, i = [], "", False, 0
    while i < len(inside):
        c = inside[i]
        if c == '"':
            in_q = not in_q
        elif c == "." and not in_q:
            segs.append(cur)
            cur = ""
            i += 1
            continue
        cur += c
        i += 1
    segs.append(cur)
    return [_unquote(s) for s in segs]


def _header(path: list[str]) -> str:
    return f"[{'.'.join(_key(p) for p in path)}]"


def _scalar_line(key: str, value: str) -> str:
    return f'{_key(key)} = "{_escape(str(value))}"'


def _line_key(line: str) -> str | None:
    """The key a scalar line assigns, or None for comments/blanks/headers."""
    m = _KEY_LINE_RE.match(line)
    return _unquote(m.group(2)) if m else None


def _split_lines(text: str) -> tuple[list[str], bool]:
    had_nl = text.endswith("\n")
    lines = (text[:-1] if had_nl else text).split("\n") if text else []
    return lines, had_nl


def _join_lines(lines: list[str], had_nl: bool) -> str:
    text = "\n".join(lines)
    return text + "\n" if (had_nl or lines) else text


def _headers(lines: list[str]) -> list[tuple[int, tuple[str, ...]]]:
    out = []
    for i, line in enumerate(lines):
        m = _HEADER_RE.match(line)
        if m:
            out.append((i, tuple(_header_path(m.group(1)))))
    return out


def _body_range(lines: list[str], start: int, headers: list[tuple[int, tuple[str, ...]]]) -> int:
    """Exclusive end index of the table body opened at line *start*."""
    later = [i for i, _ in headers if i > start]
    return later[0] if later else len(lines)


def update_table(text: str, path: list[str], scalars: dict[str, str]) -> str:
    """Return *text* with the ``[path]`` table's scalar keys set to *scalars*.

    Comments, blank lines, key order, other tables and unrelated keys are left
    byte-stable. An existing key's value is swapped in place (preserving any
    inline comment); a missing key is appended after the table's last key line.
    When the table is absent it is appended at the end of the document, together
    with an empty parent header if a nested table's parent has none yet — the
    same output `dumps` would produce for a brand-new env.
    """
    lines, had_nl = _split_lines(text)
    headers = _headers(lines)
    target = tuple(path)
    start = next((i for i, hp in headers if hp == target), None)

    if start is not None:
        _apply_scalars(lines, start, _body_range(lines, start, headers), scalars)
    else:
        present = {hp for _, hp in headers}
        if len(path) > 1 and tuple(path[:-1]) not in present:
            if lines:
                lines.append("")
            lines.append(_header(path[:-1]))
        if lines:
            lines.append("")
        lines.append(_header(path))
        lines.extend(_scalar_line(k, v) for k, v in scalars.items())

    return _join_lines(lines, had_nl)


def _apply_scalars(lines: list[str], start: int, end: int, scalars: dict[str, str]) -> None:
    remaining = dict(scalars)
    last_key_idx = start
    for i in range(start + 1, end):
        key = _line_key(lines[i])
        if key is None:
            continue
        last_key_idx = i
        if key in remaining:
            value = remaining.pop(key)
            m = _ASSIGN_RE.match(lines[i])
            if m:  # swap just the value, keep prefix + any trailing comment
                lines[i] = f'{m.group(1)}"{_escape(str(value))}"{m.group(2)}'
            else:
                indent = _KEY_LINE_RE.match(lines[i]).group(1)  # type: ignore[union-attr]
                lines[i] = f"{indent}{_scalar_line(key, value)}"
    if remaining:
        insert_at = last_key_idx + 1
        lines[insert_at:insert_at] = [_scalar_line(k, v) for k, v in remaining.items()]


def clear_table_scalars(text: str, path: list[str]) -> str:
    """Drop every scalar key line from the ``[path]`` table, keeping its header,
    comments and blank lines. Used when promoting a single-workflow env table to
    a nested one. A no-op when the table is absent.
    """
    lines, had_nl = _split_lines(text)
    headers = _headers(lines)
    start = next((i for i, hp in headers if hp == tuple(path)), None)
    if start is None:
        return _join_lines(lines, had_nl)
    end = _body_range(lines, start, headers)
    body = [ln for ln in lines[start + 1 : end] if _line_key(ln) is None]
    kept = lines[: start + 1] + body + lines[end:]
    return _join_lines(kept, had_nl)
