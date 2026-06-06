"""Config loader: required-var enforcement + local-dev tolerance."""

from __future__ import annotations

import pytest

from pegasus_temporal_worker.config import ConfigError, load_config


def _full_env() -> dict[str, str]:
    return {
        "TEMPORAL_NAMESPACE": "default",
        "TEMPORAL_ADDRESS": "localhost:7233",
        "TEMPORAL_TASK_QUEUE": "pegasus-stdlib-dev",
        "PEGASUS_API_BASE_URL": "http://localhost:3000",
        "ENV_NAME": "dev",
    }


def test_load_config_with_all_required_vars() -> None:
    config = load_config(_full_env())
    assert config.temporal_namespace == "default"
    assert config.temporal_address == "localhost:7233"
    assert config.temporal_task_queue == "pegasus-stdlib-dev"
    assert config.pegasus_api_base_url == "http://localhost:3000"
    assert config.env_name == "dev"
    # Optional secrets default to empty.
    assert config.temporal_cloud_api_key == ""
    assert config.workflow_broker_secret == ""
    # Local-dev marker:
    assert config.uses_temporal_cloud is False


def test_load_config_recognises_temporal_cloud() -> None:
    env = _full_env() | {"TEMPORAL_CLOUD_API_KEY": "eyJ.fake.jwt"}
    config = load_config(env)
    assert config.uses_temporal_cloud is True
    assert config.temporal_cloud_api_key == "eyJ.fake.jwt"


@pytest.mark.parametrize(
    "missing",
    [
        "TEMPORAL_NAMESPACE",
        "TEMPORAL_ADDRESS",
        "TEMPORAL_TASK_QUEUE",
        "PEGASUS_API_BASE_URL",
        "ENV_NAME",
    ],
)
def test_load_config_raises_on_missing_required_var(missing: str) -> None:
    env = _full_env()
    env.pop(missing)
    with pytest.raises(ConfigError, match=missing):
        load_config(env)


def test_load_config_treats_blank_strings_as_missing() -> None:
    env = _full_env() | {"TEMPORAL_NAMESPACE": "   "}
    with pytest.raises(ConfigError, match="TEMPORAL_NAMESPACE"):
        load_config(env)
