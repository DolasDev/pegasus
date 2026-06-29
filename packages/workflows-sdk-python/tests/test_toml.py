"""Tests for the minimal TOML writer (round-trips with tomllib)."""

from __future__ import annotations

import tomllib

from pegasus_workflows import _toml


def _roundtrip(data: dict) -> dict:
    return tomllib.loads(_toml.dumps(data))


def test_flat_tables() -> None:
    data = {"default": {"api_key": "vnd_1", "api_root": "https://x"}}
    assert _roundtrip(data) == data


def test_nested_tables() -> None:
    data = {"prod": {"alpha": {"id": "a"}, "beta": {"id": "b"}}}
    assert _roundtrip(data) == data


def test_escapes_quotes_and_backslashes() -> None:
    data = {"t": {"k": 'a"b\\c'}}
    assert _roundtrip(data) == data


def test_quotes_non_bare_table_names() -> None:
    data = {"api.pegasus.dolas.dev": {"k": "v"}}
    # The dotted host must be quoted so it is one table, not nested keys.
    assert _roundtrip(data) == data


def test_control_chars_roundtrip() -> None:
    data = {"t": {"k": "line1\nline2\ttab", "j": "trailing\n", "r": "cr\rhere"}}
    assert _roundtrip(data) == data


def test_empty() -> None:
    assert _toml.dumps({}) == ""
