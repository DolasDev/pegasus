"""Tests for ``pegasus-workflows integration-config`` CLI wiring.

The HTTP client is faked (the API client itself is covered by test_api.py); these
exercise arg parsing, the mapping/rules/corpus file IO round-trip, and exit codes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

import pegasus_workflows.cli.integration_config as ic
from pegasus_workflows.api import PegasusApiError

runner = CliRunner()
_TOKEN = "vnd_" + "a" * 48


class _FakeClient:
    """Records calls and returns canned data; swapped in for PegasusClient."""

    last: dict[str, Any] = {}

    def __init__(self, base_url: str, token: str, **_: Any) -> None:
        _FakeClient.last = {"base_url": base_url, "token": token}

    def validate_integration_config(self, integration_id, *, mapping, rules, corpus, **overlay):
        _FakeClient.last["validate"] = (integration_id, mapping, rules, corpus)
        _FakeClient.last["validate_overlay"] = overlay
        return {"ok": True, "problems": [], "corpus": {"total": 1, "passed": 1, "failures": []}}

    def publish_integration_config(self, integration_id, *, mapping, rules, corpus, **overlay):
        _FakeClient.last["publish"] = (integration_id, mapping, rules, corpus)
        _FakeClient.last["publish_overlay"] = overlay
        return {"version": 1, "visibility": "GLOBAL"}

    def get_integration_config(self, integration_id):
        _FakeClient.last["get"] = integration_id
        return {
            "version": 3,
            "visibility": "GLOBAL",
            "mapping": {"a": "x"},
            "rules": [{"id": "r"}],
            "corpus": [{"name": "c"}],
            "floor": "shipment_status_update",
            "displayName": "Weichert",
            "externalShape": {"type": "object", "properties": {"ref": {"type": "string"}}},
            "externalMapping": {"ref": "serviceOrderNumber"},
        }

    def list_integration_config_versions(self, integration_id):
        return [{"version": 2, "status": "PUBLISHED", "visibility": "GLOBAL", "createdAt": "t2"}]

    def rollback_integration_config(self, integration_id, version):
        _FakeClient.last["rollback"] = (integration_id, version)
        return {"version": version + 1, "visibility": "GLOBAL"}


@pytest.fixture(autouse=True)
def _patch_client(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(ic, "PegasusClient", _FakeClient)
    # Isolate credential resolution from any real ~/.pegasus/credentials.
    monkeypatch.setenv("PEGASUS_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.delenv("PEGASUS_WORKFLOW_TOKEN", raising=False)
    monkeypatch.delenv("PEGASUS_BASE_URL", raising=False)


def _write_surface(directory: Path) -> None:
    (directory / ic.MAPPING_FILE).write_text(json.dumps({"a": "x"}))
    (directory / ic.RULES_FILE).write_text(json.dumps([{"id": "r"}]))
    (directory / ic.CORPUS_FILE).write_text(json.dumps([{"name": "c"}]))


def test_validate_reads_surface_and_passes_it(tmp_path: Path) -> None:
    _write_surface(tmp_path)
    result = runner.invoke(
        ic.integration_config_app,
        ["validate", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    iid, mapping, rules, corpus = _FakeClient.last["validate"]
    assert iid == "demo_partner"
    assert mapping == {"a": "x"}
    assert rules == [{"id": "r"}]
    assert corpus == [{"name": "c"}]


def test_validate_exits_nonzero_when_gate_not_ok(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_surface(tmp_path)
    monkeypatch.setattr(
        _FakeClient,
        "validate_integration_config",
        lambda self, integration_id, *, mapping, rules, corpus, **_: {
            "ok": False,
            "problems": [{"stage": "rules", "where": "r1", "problem": "unknown fact"}],
            "corpus": {"total": 1, "passed": 0, "failures": []},
        },
    )
    result = runner.invoke(
        ic.integration_config_app,
        ["validate", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 1


def test_missing_token_exits_with_message(tmp_path: Path) -> None:
    _write_surface(tmp_path)
    result = runner.invoke(
        ic.integration_config_app,
        ["validate", "demo_partner", "--dir", str(tmp_path)],
        env={"PEGASUS_WORKFLOW_TOKEN": ""},
    )
    assert result.exit_code == 1
    assert "no token" in result.output


def test_validate_missing_file_exits(tmp_path: Path) -> None:
    # Only mapping present — corpus.json missing.
    (tmp_path / ic.MAPPING_FILE).write_text("{}")
    (tmp_path / ic.RULES_FILE).write_text("[]")
    result = runner.invoke(
        ic.integration_config_app,
        ["validate", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 1
    assert "missing corpus.json" in result.output


def test_pull_writes_surface_files(tmp_path: Path) -> None:
    result = runner.invoke(
        ic.integration_config_app,
        ["pull", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert json.loads((tmp_path / ic.MAPPING_FILE).read_text()) == {"a": "x"}
    assert json.loads((tmp_path / ic.RULES_FILE).read_text()) == [{"id": "r"}]
    assert json.loads((tmp_path / ic.CORPUS_FILE).read_text()) == [{"name": "c"}]


def test_pull_writes_floor_overlay_files(tmp_path: Path) -> None:
    result = runner.invoke(
        ic.integration_config_app,
        ["pull", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    # meta.json carries floor + displayName (0019 + 0020) …
    assert json.loads((tmp_path / ic.META_FILE).read_text()) == {
        "floor": "shipment_status_update",
        "displayName": "Weichert",
    }
    # … and the partner external shape + mapping are preserved.
    assert json.loads((tmp_path / ic.EXTERNAL_SHAPE_FILE).read_text()) == {
        "type": "object",
        "properties": {"ref": {"type": "string"}},
    }
    assert json.loads((tmp_path / ic.EXTERNAL_MAPPING_FILE).read_text()) == {
        "ref": "serviceOrderNumber"
    }


def test_pull_then_publish_round_trips_overlay_fields(tmp_path: Path) -> None:
    runner.invoke(
        ic.integration_config_app,
        ["pull", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    result = runner.invoke(
        ic.integration_config_app,
        ["publish", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    _iid, mapping, rules, corpus = _FakeClient.last["publish"]
    assert (mapping, rules, corpus) == ({"a": "x"}, [{"id": "r"}], [{"name": "c"}])
    # The floor/overlay fields survive pull -> publish (no silent strip).
    assert _FakeClient.last["publish_overlay"] == {
        "floor": "shipment_status_update",
        "display_name": "Weichert",
        "external_shape": {"type": "object", "properties": {"ref": {"type": "string"}}},
        "external_mapping": {"ref": "serviceOrderNumber"},
        "inbound": None,
    }


def test_publish_without_overlay_files_sends_none(tmp_path: Path) -> None:
    # A pre-0020 working directory (no meta/external files) publishes unchanged.
    _write_surface(tmp_path)
    result = runner.invoke(
        ic.integration_config_app,
        ["publish", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["publish_overlay"] == {
        "floor": None,
        "display_name": None,
        "external_shape": None,
        "external_mapping": None,
        "inbound": None,
    }


def test_publish_surfaces_gate_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_surface(tmp_path)

    def _raise(self, integration_id, *, mapping, rules, corpus, **_):
        raise PegasusApiError(status_code=422, code="GATE_FAILED", message="failed")

    monkeypatch.setattr(_FakeClient, "publish_integration_config", _raise)
    result = runner.invoke(
        ic.integration_config_app,
        ["publish", "demo_partner", "--dir", str(tmp_path), "--token", _TOKEN],
    )
    assert result.exit_code == 1
    assert "gate failed" in result.output


def test_rollback_passes_version(tmp_path: Path) -> None:
    result = runner.invoke(
        ic.integration_config_app,
        ["rollback", "demo_partner", "2", "--token", _TOKEN],
    )
    assert result.exit_code == 0, result.output
    assert _FakeClient.last["rollback"] == ("demo_partner", 2)
