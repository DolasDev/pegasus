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


# ── comment preservation (sdk-feedback/0013) ───────────────────────────────

# A hand-maintained ledger: header block + a Superseded audit trail + a [qa]
# table the current publish must not touch.
_LEDGER_WITH_COMMENTS = '''\
# deployments.toml — where each workflow landed and the id it got.
# Ids are environment-specific; this is the human-facing audit trail.

# Superseded — prior published ids (keep for the record):
#   prod 0.1.0 = f8077342-2e58-4dc1-a47a-797ca394ef72

[qa]
base_url = "https://api.pegasus-qa.dolas.dev"
workflow_id = "wf-qa-1"
version = "0.1.0"
visibility = "GLOBAL"
published_at = "2026-06-01T00:00:00Z"

[prod]
base_url = "https://api.pegasus.dolas.dev"
workflow_id = "wf-old"
version = "0.1.0"
visibility = "GLOBAL"
published_at = "2026-06-26T21:05:48Z"
'''


def test_republish_preserves_comments_and_only_changes_target_keys(tmp_path: Path) -> None:
    path = tmp_path / dp.DEPLOYMENTS_FILENAME
    path.write_text(_LEDGER_WITH_COMMENTS, encoding="utf-8")

    _record(
        tmp_path,
        env="prod",
        workflow_id="wf-new",
        version="0.2.0",
        published_at="2026-07-01T10:00:00Z",
    )

    before = _LEDGER_WITH_COMMENTS.splitlines()
    after = path.read_text(encoding="utf-8").splitlines()
    # Only the three prod value lines change; everything else is byte-identical.
    changed = [(b, a) for b, a in zip(before, after, strict=True) if b != a]
    assert changed == [
        ('workflow_id = "wf-old"', 'workflow_id = "wf-new"'),
        ('version = "0.1.0"', 'version = "0.2.0"'),
        (
            'published_at = "2026-06-26T21:05:48Z"',
            'published_at = "2026-07-01T10:00:00Z"',
        ),
    ]
    # The Superseded comment line and the untouched [qa] table both survive.
    text = path.read_text(encoding="utf-8")
    assert "#   prod 0.1.0 = f8077342-2e58-4dc1-a47a-797ca394ef72" in text
    assert dp.read_deployments(tmp_path)["qa"]["workflow_id"] == "wf-qa-1"


def test_new_env_appends_without_disturbing_comments(tmp_path: Path) -> None:
    path = tmp_path / dp.DEPLOYMENTS_FILENAME
    path.write_text(_LEDGER_WITH_COMMENTS, encoding="utf-8")

    _record(
        tmp_path,
        env="staging",
        base_url="https://api.pegasus-staging.dolas.dev",
        workflow_id="wf-staging",
    )

    text = path.read_text(encoding="utf-8")
    # Existing content is a byte-stable prefix; the new table is appended after.
    assert text.startswith(_LEDGER_WITH_COMMENTS)
    data = dp.read_deployments(tmp_path)
    assert set(data) == {"qa", "prod", "staging"}
    assert data["staging"]["workflow_id"] == "wf-staging"
    # And the whole file still parses (valid TOML).
    assert tomllib.loads(text)["staging"]["base_url"].endswith("staging.dolas.dev")


def test_missing_key_is_appended_to_existing_table(tmp_path: Path) -> None:
    # A table lacking a key the recorder writes gains it in place, comments kept.
    path = tmp_path / dp.DEPLOYMENTS_FILENAME
    path.write_text(
        '[prod]\n# note: seeded by hand\nworkflow_id = "wf-old"\n',
        encoding="utf-8",
    )
    _record(tmp_path, env="prod", workflow_id="wf-new", version="0.2.0")
    data = dp.read_deployments(tmp_path)
    assert data["prod"]["workflow_id"] == "wf-new"
    assert data["prod"]["version"] == "0.2.0"
    assert data["prod"]["visibility"] == "GLOBAL"
    assert "# note: seeded by hand" in path.read_text(encoding="utf-8")


def test_promote_single_to_multi_preserves_comments(tmp_path: Path) -> None:
    path = tmp_path / dp.DEPLOYMENTS_FILENAME
    path.write_text(_LEDGER_WITH_COMMENTS, encoding="utf-8")
    # prod was a single-workflow leaf; now publish it as a multi-workflow project.
    _record(tmp_path, env="prod", multi=True, workflow_name="alpha", workflow_id="wf-a")
    data = dp.read_deployments(tmp_path)
    assert data["prod"]["alpha"]["workflow_id"] == "wf-a"
    # The leaf's scalars are gone (promoted), but comments + [qa] remain.
    text = path.read_text(encoding="utf-8")
    assert "#   prod 0.1.0 = f8077342-2e58-4dc1-a47a-797ca394ef72" in text
    assert data["qa"]["workflow_id"] == "wf-qa-1"
