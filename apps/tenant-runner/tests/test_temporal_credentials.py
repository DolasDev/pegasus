"""Broker-mode key refresh (Phase 3b.2): swap a rotated key into the live client."""

from __future__ import annotations

import asyncio
import logging

import pytest

from pegasus_tenant_runner.broker_client import (
    BrokerError,
    TemporalCredentials,
    TemporalCredentialsUnavailable,
)
from pegasus_tenant_runner.temporal_credentials import run_credentials_refresh

NS = "pg-staging-111111111111.chgel"
ADDR = f"{NS}.tmprl.cloud:7233"


def creds(key: str, namespace: str = NS) -> TemporalCredentials:
    return TemporalCredentials(address=ADDR, namespace=namespace, api_key=key)


class FakeClient:
    """Records every key the refresh puts on the live client."""

    def __init__(self, key: str) -> None:
        self._key = key
        self.set_keys: list[str] = []

    @property
    def api_key(self) -> str:
        return self._key

    @api_key.setter
    def api_key(self, value: str) -> None:
        self._key = value
        self.set_keys.append(value)


class ScriptedBroker:
    """Returns (or raises) the next scripted answer per fetch; then requests
    shutdown so the loop under test ends deterministically."""

    def __init__(self, answers: list[object], shutdown: asyncio.Event) -> None:
        self._answers = list(answers)
        self._shutdown = shutdown
        self.calls = 0

    def fetch_temporal_credentials(self) -> TemporalCredentials:
        self.calls += 1
        answer = self._answers.pop(0)
        if not self._answers:
            self._shutdown.set()
        if isinstance(answer, Exception):
            raise answer
        assert isinstance(answer, TemporalCredentials)
        return answer


async def _run(answers: list[object], client: FakeClient, start_key: str = "key-1"):
    shutdown = asyncio.Event()
    broker = ScriptedBroker(answers, shutdown)
    await asyncio.wait_for(
        run_credentials_refresh(
            broker=broker,
            client=client,
            current=creds(start_key),
            interval_seconds=0.001,
            shutdown_requested=shutdown,
            log_context={"tenant_id": "t"},
        ),
        timeout=5,
    )
    return broker, shutdown


def test_a_rotated_key_is_swapped_into_the_live_client() -> None:
    client = FakeClient("key-1")
    asyncio.run(_run([creds("key-1"), creds("key-2"), creds("key-2")], client))
    # Unchanged key: no swap. Changed: exactly one swap. Same again: none.
    assert client.set_keys == ["key-2"]
    assert client.api_key == "key-2"


def test_a_failed_refresh_keeps_the_current_key_and_tries_again() -> None:
    client = FakeClient("key-1")
    broker, _ = asyncio.run(_run([BrokerError("HTTP 502"), creds("key-2")], client))
    assert broker.calls == 2
    assert client.set_keys == ["key-2"]


def test_withdrawn_credentials_keep_the_current_key() -> None:
    client = FakeClient("key-1")
    asyncio.run(_run([TemporalCredentialsUnavailable("404"), creds("key-1")], client))
    assert client.set_keys == []


def test_a_changed_namespace_is_never_followed_it_requests_shutdown() -> None:
    client = FakeClient("key-1")
    answers: list[object] = [creds("other-key", namespace="pg-staging-999999999999.chgel")]
    _, shutdown = asyncio.run(_run(answers + [creds("unused")], client))
    assert shutdown.is_set()
    assert client.set_keys == []


def test_stops_at_once_when_shutdown_is_requested() -> None:
    async def scenario() -> int:
        shutdown = asyncio.Event()
        shutdown.set()
        broker = ScriptedBroker([creds("key-2")], asyncio.Event())
        await asyncio.wait_for(
            run_credentials_refresh(
                broker=broker,
                client=FakeClient("key-1"),
                current=creds("key-1"),
                interval_seconds=3600,
                shutdown_requested=shutdown,
                log_context={},
            ),
            timeout=5,
        )
        return broker.calls

    assert asyncio.run(scenario()) == 0


def test_the_key_never_reaches_a_log_record(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client = FakeClient("SECRET-OLD")
    asyncio.run(
        _run(
            [BrokerError("boom"), creds("SECRET-NEW")],
            client,
            start_key="SECRET-OLD",
        )
    )
    text = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)
    assert "runner.temporal_key_refreshed" in text
    assert "SECRET" not in text
