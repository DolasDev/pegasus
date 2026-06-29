"""Tests for ``PegasusClient.from_runtime()`` (runtime env var contract)."""

from __future__ import annotations

import pytest

from pegasus_workflows.api import (
    RUNTIME_BASE_URL_ENV_VAR,
    RUNTIME_TOKEN_ENV_VAR,
    PegasusClient,
)


@pytest.fixture(autouse=True)
def _clear_runtime_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(RUNTIME_BASE_URL_ENV_VAR, raising=False)
    monkeypatch.delenv(RUNTIME_TOKEN_ENV_VAR, raising=False)


def test_from_runtime_builds_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_BASE_URL_ENV_VAR, "https://api.pegasus.dolas.dev")
    monkeypatch.setenv(RUNTIME_TOKEN_ENV_VAR, "vnd_runtime")
    client = PegasusClient.from_runtime()
    assert client._base_url == "https://api.pegasus.dolas.dev"
    assert client._token == "vnd_runtime"


def test_from_runtime_missing_both_names_them(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(RuntimeError) as exc:
        PegasusClient.from_runtime()
    msg = str(exc.value)
    assert RUNTIME_BASE_URL_ENV_VAR in msg
    assert RUNTIME_TOKEN_ENV_VAR in msg


def test_from_runtime_missing_token_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(RUNTIME_BASE_URL_ENV_VAR, "https://api.x")
    with pytest.raises(RuntimeError, match=RUNTIME_TOKEN_ENV_VAR):
        PegasusClient.from_runtime()
