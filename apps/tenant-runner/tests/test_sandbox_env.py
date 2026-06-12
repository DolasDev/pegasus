"""Subprocess environment: exact allowlist + real-child isolation proof."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from pegasus_tenant_runner.artifacts import PreparedWorkflow
from pegasus_tenant_runner.sandbox_env import ENV_ALLOWLIST_KEYS, build_subprocess_env


@pytest.fixture()
def prepared(tmp_path: Path) -> PreparedWorkflow:
    (tmp_path / "scratch" / "tmp").mkdir(parents=True)
    (tmp_path / "src").mkdir()
    (tmp_path / "venv" / "bin").mkdir(parents=True)
    return PreparedWorkflow(
        name="my_workflow",
        version="1.0.0",
        entry_point="my_workflow.workflow:MyWorkflow",
        src_dir=tmp_path / "src",
        python_bin=tmp_path / "venv" / "bin" / "python",
        scratch_dir=tmp_path / "scratch",
    )


def test_env_contains_exactly_the_allowlist(prepared: PreparedWorkflow) -> None:
    env = build_subprocess_env(prepared, execution_id="exec-1")
    assert set(env.keys()) == ENV_ALLOWLIST_KEYS


def test_env_values(prepared: PreparedWorkflow) -> None:
    env = build_subprocess_env(prepared, execution_id="exec-1")
    assert env["PYTHONPATH"] == str(prepared.src_dir)
    assert env["HOME"] == str(prepared.scratch_dir)
    assert env["TMPDIR"] == str(prepared.scratch_dir / "tmp")
    assert env["PEGASUS_EXECUTION_ID"] == "exec-1"
    assert env["PATH"].startswith(str(prepared.python_bin.parent))


def test_no_secret_shaped_keys_in_allowlist() -> None:
    """The allowlist itself must never grow a credential/connection key."""
    forbidden_prefixes = ("AWS_", "TEMPORAL_", "ECS_", "WORKFLOW_")
    for key in ENV_ALLOWLIST_KEYS:
        assert not key.startswith(forbidden_prefixes), key


def test_real_subprocess_cannot_see_shim_secrets(
    prepared: PreparedWorkflow, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Spawn a REAL child with the built env and have it dump its entire
    environment — the shim's credentials and connection details must be
    absent even though the parent process has them all set."""
    secrets = {
        "WORKFLOW_BROKER_TOKEN": "wbk_11111111-1111-4111-8111-111111111111_" + "ab" * 24,
        "WORKFLOW_BROKER_SECRET": "super-secret",
        "TEMPORAL_ADDRESS": "cloud.temporal.invalid:7233",
        "TEMPORAL_NAMESPACE": "pegasus-prod",
        "TEMPORAL_CLOUD_API_KEY": "eyJ.fake.jwt",
        "AWS_ACCESS_KEY_ID": "AKIAFAKE",
        "AWS_SECRET_ACCESS_KEY": "fake",
        "AWS_SESSION_TOKEN": "fake",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI": "/v2/credentials/uuid",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI": "http://169.254.170.2/creds",
        "ECS_CONTAINER_METADATA_URI_V4": "http://169.254.170.2/v4/uuid",
        "PEGASUS_API_BASE_URL": "https://api.pegasus.invalid",
    }
    for key, value in secrets.items():
        monkeypatch.setenv(key, value)

    env = build_subprocess_env(prepared, execution_id="exec-1")
    # Use the test interpreter (the fixture's venv python is a dummy file) —
    # what's under test is the ENV, not the binary.
    out = subprocess.run(
        [sys.executable, "-c", "import json, os; print(json.dumps(dict(os.environ)))"],
        env=env,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    child_env = json.loads(out.stdout)

    for key in secrets:
        assert key not in child_env, f"{key} leaked into the tenant subprocess"
    for value in secrets.values():
        assert value not in out.stdout, "a secret VALUE leaked under another key"
    # The allowlist arrived intact (modulo vars the interpreter may add).
    for key in ENV_ALLOWLIST_KEYS:
        assert key in child_env
