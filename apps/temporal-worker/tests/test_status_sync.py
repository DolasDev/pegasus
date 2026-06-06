"""Status PATCH — 200, 404 absorbed, 5xx retried, 401 raises immediately."""

from __future__ import annotations

import json

import httpx
import pytest

from pegasus_temporal_worker.status_sync import (
    ExecutionStatus,
    StatusSyncClient,
    StatusSyncError,
)


def _sleeps() -> tuple[list[float], callable]:
    calls: list[float] = []

    def sleep(delay: float) -> None:
        calls.append(delay)

    return calls, sleep


def test_patch_terminal_happy_path() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["secret"] = request.headers.get("X-Workflow-Broker-Secret")
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(200, json={"ok": True})

    sleeps, sleep = _sleeps()
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="shared",
        transport=httpx.MockTransport(handler),
        sleep=sleep,
    )

    client.patch_terminal(
        ExecutionStatus(
            execution_id="exec-1",
            status="COMPLETED",
            finished_at_iso="2026-06-06T12:00:00Z",
            result={"message": "Hi! ..."},
        )
    )

    assert captured["method"] == "PATCH"
    assert captured["url"].endswith("/api/v1/internal/workflow-executions/exec-1")
    assert captured["secret"] == "shared"
    assert captured["body"] == {
        "status": "COMPLETED",
        "finishedAt": "2026-06-06T12:00:00Z",
        "result": {"message": "Hi! ..."},
    }
    # Happy path doesn't sleep.
    assert sleeps == []


def test_patch_terminal_404_absorbed() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    sleeps, sleep = _sleeps()
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="shared",
        transport=httpx.MockTransport(handler),
        sleep=sleep,
    )

    # No raise; pre-Unit-6 expected state.
    client.patch_terminal(
        ExecutionStatus(
            execution_id="exec-2",
            status="FAILED",
            finished_at_iso="2026-06-06T12:00:00Z",
            error_message="boom",
        )
    )
    # No retries on 404 either.
    assert sleeps == []


def test_patch_terminal_401_raises_immediately() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    sleeps, sleep = _sleeps()
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="wrong",
        transport=httpx.MockTransport(handler),
        sleep=sleep,
    )
    with pytest.raises(StatusSyncError, match="auth rejected"):
        client.patch_terminal(
            ExecutionStatus(
                execution_id="exec-3",
                status="COMPLETED",
                finished_at_iso="2026-06-06T12:00:00Z",
            )
        )
    # Auth errors don't retry — that just delays the failure.
    assert sleeps == []


def test_patch_terminal_5xx_retries_then_raises() -> None:
    attempts = {"count": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        return httpx.Response(503)

    sleeps, sleep = _sleeps()
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="shared",
        max_attempts=3,
        backoff_base_seconds=0.5,
        transport=httpx.MockTransport(handler),
        sleep=sleep,
    )
    with pytest.raises(StatusSyncError, match="exhausted"):
        client.patch_terminal(
            ExecutionStatus(
                execution_id="exec-4",
                status="COMPLETED",
                finished_at_iso="2026-06-06T12:00:00Z",
            )
        )
    assert attempts["count"] == 3
    # Sleeps happen between attempts 1→2 and 2→3, NOT after attempt 3.
    assert sleeps == [0.5, 1.0]


def test_patch_terminal_recovers_after_transient_5xx() -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"ok": True})

    sleeps, sleep = _sleeps()
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="shared",
        max_attempts=3,
        backoff_base_seconds=0.1,
        transport=httpx.MockTransport(handler),
        sleep=sleep,
    )
    client.patch_terminal(
        ExecutionStatus(
            execution_id="exec-5",
            status="COMPLETED",
            finished_at_iso="2026-06-06T12:00:00Z",
        )
    )
    assert calls["n"] == 2
    assert sleeps == [0.1]


def test_patch_terminal_rejects_non_terminal_status() -> None:
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="shared",
    )
    with pytest.raises(ValueError, match="terminal status"):
        client.patch_terminal(
            ExecutionStatus(
                execution_id="exec-6",
                status="RUNNING",
                finished_at_iso="2026-06-06T12:00:00Z",
            )
        )


def test_patch_terminal_empty_broker_secret_fails_fast() -> None:
    client = StatusSyncClient(
        api_base_url="https://api.example.com",
        broker_secret="",
    )
    with pytest.raises(ValueError, match="WORKFLOW_BROKER_SECRET"):
        client.patch_terminal(
            ExecutionStatus(
                execution_id="exec-7",
                status="COMPLETED",
                finished_at_iso="2026-06-06T12:00:00Z",
            )
        )
