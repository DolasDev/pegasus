"""Tests for ``pegasus-workflows feedback-form`` file IO.

Focused on the encoding contract. Every read/write of ``form.json`` and
``message.txt`` must pin UTF-8 explicitly: without it Python falls back to
``locale.getpreferredencoding()``, which is UTF-8 on Linux/macOS but the ANSI
codepage (typically cp1252) on Windows — so a non-ASCII form title or message
template either raises UnicodeDecodeError on read or is silently mangled on
write. These tests fail on Windows if an ``encoding=`` argument is ever dropped.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

import pegasus_workflows.cli.feedback_form as ff

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48

#: Deliberately spans characters cp1252 cannot represent (CJK, emoji, Cyrillic)
#: alongside ones it maps to different bytes than UTF-8 (accents, en dash).
_NON_ASCII_TITLE = "Umzugsbewertung — Kundenzufriedenheit 引越し 🚚"
_NON_ASCII_MESSAGE = "Здравствуйте! Wie zufrieden waren Sie mit dem Umzug? — Скажите нам 📦\n"


class _FakeClient:
    """Returns a canned form carrying non-ASCII text; swapped in for PegasusClient."""

    last: dict[str, Any] = {}

    def __init__(self, base_url: str, token: str, **_: Any) -> None:
        _FakeClient.last = {"base_url": base_url, "token": token}

    def get_feedback_form(self, form_key: str) -> dict[str, Any]:
        _FakeClient.last["get"] = form_key
        return {
            "version": 4,
            "title": _NON_ASCII_TITLE,
            "definition": {"questions": [{"id": "q1", "label": _NON_ASCII_TITLE}]},
            "messageTemplate": _NON_ASCII_MESSAGE,
        }


@pytest.fixture(autouse=True)
def _patch_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ff, "PegasusClient", _FakeClient)
    # Isolate credential resolution from any real ~/.pegasus/credentials.
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def test_pull_writes_non_ascii_as_utf8(tmp_path: Path) -> None:
    """``pull`` must write UTF-8 regardless of the platform's locale encoding."""
    result = runner.invoke(
        ff.feedback_form_app,
        ["pull", "move_csat", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output

    # Assert on the BYTES, not via read_text() — decoding with the same wrong
    # codec that wrote them would hide a mojibake round trip.
    form_bytes = (tmp_path / ff.FORM_FILE).read_bytes()
    assert json.loads(form_bytes.decode("utf-8"))["title"] == _NON_ASCII_TITLE

    message_bytes = (tmp_path / ff.MESSAGE_FILE).read_bytes()
    assert message_bytes.decode("utf-8") == _NON_ASCII_MESSAGE


def test_load_form_reads_non_ascii_utf8(tmp_path: Path) -> None:
    """``_load_form`` must decode UTF-8 even when the locale codepage is not."""
    (tmp_path / ff.FORM_FILE).write_bytes(
        json.dumps(
            {"title": _NON_ASCII_TITLE, "definition": {"questions": []}},
            ensure_ascii=False,
        ).encode("utf-8")
    )
    (tmp_path / ff.MESSAGE_FILE).write_bytes(_NON_ASCII_MESSAGE.encode("utf-8"))

    title, definition, message = ff._load_form(tmp_path)

    assert title == _NON_ASCII_TITLE
    assert definition == {"questions": []}
    assert message == _NON_ASCII_MESSAGE


def test_pull_then_load_round_trips(tmp_path: Path) -> None:
    """The write and read halves must agree — the end-to-end authoring loop."""
    result = runner.invoke(
        ff.feedback_form_app,
        ["pull", "move_csat", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output

    title, _definition, message = ff._load_form(tmp_path)
    assert title == _NON_ASCII_TITLE
    assert message == _NON_ASCII_MESSAGE
