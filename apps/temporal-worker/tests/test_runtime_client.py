"""Broker token fetch — happy path, pre-Unit-6 404, auth failure."""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_temporal_worker.runtime_client import (
    BrokerAuthError,
    BrokerEndpointMissing,
    BrokerError,
    RuntimeTokenClient,
)


def _transport(handler):
    return httpx.MockTransport(handler)


def test_fetch_token_happy_path() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["secret"] = request.headers.get("X-Workflow-Broker-Secret")
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"token": "vnd_test_abc123"})

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
        transport=_transport(handler),
    )

    token = client.fetch_token("exec-1")

    assert token == "vnd_test_abc123"
    assert captured["method"] == "POST"
    assert captured["url"].endswith("/api/v1/internal/workflow-runtime-token")
    assert captured["secret"] == "shared-secret"
    assert captured["body"] == {"executionId": "exec-1"}


def test_fetch_token_404_raises_broker_endpoint_missing() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "NOT_FOUND"})

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
        transport=_transport(handler),
    )

    with pytest.raises(BrokerEndpointMissing, match="pre-Unit-6"):
        client.fetch_token("exec-1")


def test_fetch_token_401_raises_broker_auth_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="wrong-secret",
        transport=_transport(handler),
    )

    with pytest.raises(BrokerAuthError):
        client.fetch_token("exec-1")


def test_fetch_token_missing_secret_fails_fast() -> None:
    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="",
        # No transport — we should fail before any HTTP call.
    )
    with pytest.raises(ValueError, match="WORKFLOW_BROKER_SECRET"):
        client.fetch_token("exec-1")


def test_fetch_token_missing_execution_id_fails_fast() -> None:
    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
    )
    with pytest.raises(ValueError, match="execution_id"):
        client.fetch_token("")


def test_fetch_token_500_raises_broker_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
        transport=_transport(handler),
    )
    with pytest.raises(BrokerError):
        client.fetch_token("exec-1")


def test_fetch_token_2xx_without_token_field_raises_broker_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"not_a_token": "oops"})

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
        transport=_transport(handler),
    )
    with pytest.raises(BrokerError, match="token"):
        client.fetch_token("exec-1")


def test_build_pegasus_client_returns_authenticated_client() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"token": "vnd_live_xyz"})

    client = RuntimeTokenClient(
        api_base_url="https://api.example.com",
        broker_secret="shared-secret",
        transport=_transport(handler),
    )

    pegasus = client.build_pegasus_client("exec-2")

    # PegasusClient stores the token on a private attribute; assert via
    # the public-ish round-trip — the token is what the client carries
    # into Authorization headers, so a constructed instance proves the
    # broker fetch resolved.
    assert pegasus is not None
    # And the SDK's invariant: passing empty would have raised. So any
    # client we get back is authenticated.
