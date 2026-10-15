"""Config loader: required vars, credential cross-wiring guards, tunables."""

from __future__ import annotations

import pytest

from pegasus_tenant_runner.config import ConfigError, load_config

TENANT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222"
TOKEN = f"wbk_{TENANT_ID}_{'ab' * 24}"


def _full_env() -> dict[str, str]:
    return {
        "TENANT_ID": TENANT_ID,
        "ENV_NAME": "dev",
        "TEMPORAL_NAMESPACE": "default",
        "TEMPORAL_ADDRESS": "localhost:7233",
        "PEGASUS_API_BASE_URL": "http://localhost:3000",
        "WORKFLOW_BROKER_TOKEN": TOKEN,
    }


def test_load_config_with_all_required_vars() -> None:
    config = load_config(_full_env())
    assert config.tenant_id == TENANT_ID
    assert config.env_name == "dev"
    assert config.workflow_broker_token == TOKEN
    assert config.uses_temporal_cloud is False
    # Defaults for the tunables.
    assert config.idle_timeout_seconds == 600
    assert config.execution_timeout_seconds == 900
    assert config.max_unpacked_bytes == 100 * 1024 * 1024
    assert config.max_output_bytes == 256 * 1024
    assert config.max_result_bytes == 1024 * 1024
    assert config.work_dir == "/home/pegasus/work"


def test_task_queue_is_derived_per_tenant_per_env() -> None:
    config = load_config(_full_env())
    assert config.task_queue == f"pegasus-tenant-{TENANT_ID}-dev"


def test_recognises_temporal_cloud() -> None:
    config = load_config(_full_env() | {"TEMPORAL_CLOUD_API_KEY": "eyJ.fake.jwt"})
    assert config.uses_temporal_cloud is True


@pytest.mark.parametrize(
    "missing",
    [
        "TENANT_ID",
        "ENV_NAME",
        # Env mode (TEMPORAL_ADDRESS set) still requires the namespace.
        "TEMPORAL_NAMESPACE",
        "PEGASUS_API_BASE_URL",
        "WORKFLOW_BROKER_TOKEN",
    ],
)
def test_raises_on_missing_required_var(missing: str) -> None:
    env = _full_env()
    env.pop(missing)
    with pytest.raises(ConfigError, match=missing):
        load_config(env)


def test_rejects_non_uuid_tenant_id() -> None:
    with pytest.raises(ConfigError, match="lowercase UUID"):
        load_config(_full_env() | {"TENANT_ID": "not-a-uuid"})


def test_rejects_shared_secret_shaped_credential() -> None:
    """The sandbox keystone: anything that isn't a wbk_ token is refused —
    in particular the shared broker secret must never start a runner."""
    with pytest.raises(ConfigError, match="wbk_"):
        load_config(_full_env() | {"WORKFLOW_BROKER_TOKEN": "a" * 64})


def test_rejects_cross_wired_tenant_token() -> None:
    other_token = f"wbk_{OTHER_TENANT_ID}_{'cd' * 24}"
    with pytest.raises(ConfigError, match="different tenant"):
        load_config(_full_env() | {"WORKFLOW_BROKER_TOKEN": other_token})


def test_tunables_parse_and_validate() -> None:
    config = load_config(
        _full_env()
        | {
            "RUNNER_IDLE_TIMEOUT_SECONDS": "120",
            "RUNNER_EXECUTION_TIMEOUT_SECONDS": "60",
            "RUNNER_MAX_UNPACKED_BYTES": "1024",
        }
    )
    assert config.idle_timeout_seconds == 120
    assert config.execution_timeout_seconds == 60
    assert config.max_unpacked_bytes == 1024


@pytest.mark.parametrize("bad", ["0", "-5", "ten"])
def test_tunables_reject_non_positive_or_garbage(bad: str) -> None:
    with pytest.raises(ConfigError, match="RUNNER_IDLE_TIMEOUT_SECONDS"):
        load_config(_full_env() | {"RUNNER_IDLE_TIMEOUT_SECONDS": bad})


# ---------------------------------------------------------------------------
# Broker mode (Phase 3b.2): the scoped task definition carries no Temporal env
# ---------------------------------------------------------------------------


def _scoped_env() -> dict[str, str]:
    env = _full_env()
    for key in ("TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE"):
        env.pop(key)
    return env


def test_env_mode_when_the_address_is_set() -> None:
    config = load_config(_full_env())
    assert config.uses_broker_credentials is False


def test_broker_mode_when_no_temporal_env_at_all() -> None:
    config = load_config(_scoped_env())
    assert config.uses_broker_credentials is True
    assert config.temporal_address == ""
    assert config.temporal_namespace == ""
    assert config.temporal_cloud_api_key == ""
    # The queue name doesn't depend on the namespace: same queue, new namespace.
    assert config.task_queue == f"pegasus-tenant-{TENANT_ID}-dev"
    assert config.temporal_credentials_refresh_seconds == 1800


@pytest.mark.parametrize(
    "leftover",
    [{"TEMPORAL_CLOUD_API_KEY": "eyJ.shared.key"}, {"TEMPORAL_NAMESPACE": "pegasus-prod"}],
)
def test_broker_mode_refuses_a_shared_temporal_setting_left_in_the_env(
    leftover: dict[str, str],
) -> None:
    with pytest.raises(ConfigError, match="cross-wired"):
        load_config(_scoped_env() | leftover)


def test_refresh_interval_is_tunable() -> None:
    config = load_config(_scoped_env() | {"RUNNER_TEMPORAL_CREDENTIALS_REFRESH_SECONDS": "60"})
    assert config.temporal_credentials_refresh_seconds == 60
