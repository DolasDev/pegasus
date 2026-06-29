"""Tests for the post-publish deployment ledger (deployments.toml)."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pegasus_workflows import deployments as dp


def _record(project: Path, **overrides) -> Path:  # noqa: ANN003
    kwargs = dict(
        env="prod",
        base_url="https://api.pegasus.dolas.dev",
        workflow_name="send_order_saved_sms",
        multi=False,
        workflow_id="wf-1",
        version="0.1.0",
        visibility="GLOBAL",
        published_at="2026-06-29T00:00:00Z",
    )
    kwargs.update(overrides)
    return dp.record_deployment(project, **kwargs)


def test_derive_env_from_url() -> None:
    assert dp.derive_env("https://api.pegasus-qa.dolas.dev") == "api.pegasus-qa.dolas.dev"
    assert dp.derive_env("not a url") == "default"


def test_read_missing_is_empty(tmp_path: Path) -> None:
    assert dp.read_deployments(tmp_path) == {}


def test_record_single_workflow(tmp_path: Path) -> None:
    path = _record(tmp_path)
    assert path == tmp_path / dp.DEPLOYMENTS_FILENAME
    data = dp.read_deployments(tmp_path)
    assert data["prod"]["workflow_id"] == "wf-1"
    assert data["prod"]["visibility"] == "GLOBAL"
    assert data["prod"]["published_at"] == "2026-06-29T00:00:00Z"
    # Round-trips through the stdlib reader.
    with path.open("rb") as fh:
        assert tomllib.load(fh) == data


def test_record_is_idempotent_in_place(tmp_path: Path) -> None:
    _record(tmp_path, workflow_id="wf-old", version="0.1.0")
    _record(tmp_path, workflow_id="wf-new", version="0.2.0")
    data = dp.read_deployments(tmp_path)
    assert list(data) == ["prod"]  # no duplicate table
    assert data["prod"]["workflow_id"] == "wf-new"
    assert data["prod"]["version"] == "0.2.0"


def test_record_second_env_coexists(tmp_path: Path) -> None:
    _record(tmp_path, env="prod", base_url="https://api.pegasus.dolas.dev")
    _record(tmp_path, env="qa", base_url="https://api.pegasus-qa.dolas.dev", workflow_id="wf-qa")
    data = dp.read_deployments(tmp_path)
    assert set(data) == {"prod", "qa"}
    assert data["qa"]["workflow_id"] == "wf-qa"
    assert data["qa"]["base_url"] == "https://api.pegasus-qa.dolas.dev"


def test_record_multi_workflow_namespaced_by_name(tmp_path: Path) -> None:
    _record(tmp_path, multi=True, workflow_name="alpha", workflow_id="wf-a")
    _record(tmp_path, multi=True, workflow_name="beta", workflow_id="wf-b")
    data = dp.read_deployments(tmp_path)
    assert data["prod"]["alpha"]["workflow_id"] == "wf-a"
    assert data["prod"]["beta"]["workflow_id"] == "wf-b"


def test_multi_workflow_named_workflow_id_does_not_wipe_siblings(tmp_path: Path) -> None:
    # A workflow literally named "workflow_id" must not trip the leaf-detection.
    _record(tmp_path, multi=True, workflow_name="workflow_id", workflow_id="wf-a")
    _record(tmp_path, multi=True, workflow_name="other", workflow_id="wf-b")
    data = dp.read_deployments(tmp_path)
    assert data["prod"]["workflow_id"]["workflow_id"] == "wf-a"
    assert data["prod"]["other"]["workflow_id"] == "wf-b"
