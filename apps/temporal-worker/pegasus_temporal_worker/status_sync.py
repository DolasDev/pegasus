"""Worker-authoritative execution-status write-back to the Pegasus API.

Per the Phase 2 plan's "Execution status sync" decision, the worker is the
sole writer for terminal ``WorkflowExecution`` status (``COMPLETED``,
``FAILED``, ``TIMED_OUT``, ``CANCELLED``). The reconcile poller (a separate
Phase-2 fast-follow) only fixes stale rows when the worker crashes mid-run.

Pre-Unit-6 the PATCH endpoint doesn't exist; the worker should NOT crash on
404 — log it at WARN once and move on. Other failure modes (5xx, network)
retry with exponential backoff.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger(__name__)

__all__ = [
    "ExecutionStatus",
    "StatusSyncClient",
    "TerminalStatus",
    "StatusSyncError",
]


# Mirrors the Prisma enum WorkflowExecutionStatus on the API side. The
# worker only ever writes these four — QUEUED and RUNNING are set by the
# API itself (Unit 6).
TerminalStatus = str  # 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'

VALID_TERMINAL_STATUSES = frozenset(
    {"COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"}
)


@dataclass(frozen=True)
class ExecutionStatus:
    """One terminal status payload."""

    execution_id: str
    status: TerminalStatus
    finished_at_iso: str
    result: Any | None = None
    error_message: str | None = None


class StatusSyncError(RuntimeError):
    """Raised after the retry budget is exhausted on a 5xx / network error."""


class StatusSyncClient:
    """PATCHes terminal execution status to the internal API endpoint.

    Retries 5xx and network errors with exponential backoff; 404 is logged
    once and absorbed (pre-Unit-6 expected state); 401/403 raise
    immediately (a wrong secret won't fix itself by retrying).
    """

    PATCH_PATH = "/api/v1/internal/workflow-executions/{execution_id}"

    def __init__(
        self,
        *,
        api_base_url: str,
        broker_secret: str,
        timeout: float = 10.0,
        max_attempts: int = 3,
        backoff_base_seconds: float = 0.5,
        transport: httpx.BaseTransport | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        if not api_base_url:
            raise ValueError("api_base_url is required")
        self._api_base_url = api_base_url.rstrip("/")
        self._broker_secret = broker_secret
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff_base_seconds = backoff_base_seconds
        self._transport = transport
        # Injected so tests don't actually sleep.
        self._sleep = sleep

    # -- internals ----------------------------------------------------------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._api_base_url,
            timeout=self._timeout,
            transport=self._transport,
        )

    def _payload(self, status: ExecutionStatus) -> Mapping[str, Any]:
        body: dict[str, Any] = {
            "status": status.status,
            "finishedAt": status.finished_at_iso,
        }
        if status.result is not None:
            body["result"] = status.result
        if status.error_message is not None:
            body["errorMessage"] = status.error_message
        return body

    # -- public ------------------------------------------------------------

    def patch_terminal(self, status: ExecutionStatus) -> None:
        """PATCH ``status`` to the internal endpoint.

        Returns silently on success or on a 404 absorb. Raises
        :class:`StatusSyncError` after exhausting the retry budget on 5xx /
        network failures, and bubbles a ``BrokerAuthError``-equivalent on
        401/403 (so a misconfigured secret is loud).
        """
        if status.status not in VALID_TERMINAL_STATUSES:
            raise ValueError(
                f"status {status.status!r} is not a terminal status — "
                f"expected one of {sorted(VALID_TERMINAL_STATUSES)}"
            )
        if not self._broker_secret:
            # Don't silently no-op — that would hide a misconfiguration.
            raise ValueError(
                "WORKFLOW_BROKER_SECRET is empty — cannot sync execution status"
            )

        path = self.PATCH_PATH.format(execution_id=status.execution_id)
        payload = self._payload(status)
        headers = {"X-Workflow-Broker-Secret": self._broker_secret}

        last_exc: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                with self._client() as client:
                    response = client.request(
                        "PATCH",
                        path,
                        headers=headers,
                        json=payload,
                    )
            except httpx.HTTPError as exc:
                last_exc = exc
                log.warning(
                    "status_sync.network_error",
                    extra={
                        "execution_id": status.execution_id,
                        "attempt": attempt,
                        "error": str(exc),
                    },
                )
                self._maybe_sleep(attempt)
                continue

            if response.status_code == 404:
                # Pre-Unit-6 expected state. The endpoint isn't mounted
                # yet. Logged at WARN once, NOT at ERROR.
                log.warning(
                    "status_sync.endpoint_missing",
                    extra={
                        "execution_id": status.execution_id,
                        "expected_pre_unit_6": True,
                    },
                )
                return
            if response.status_code in (401, 403):
                raise StatusSyncError(
                    f"status sync auth rejected (HTTP {response.status_code})"
                )
            if response.is_success:
                return
            # 5xx / other — retry.
            last_exc = StatusSyncError(
                f"status sync failed: HTTP {response.status_code}"
            )
            log.warning(
                "status_sync.retryable_http_error",
                extra={
                    "execution_id": status.execution_id,
                    "attempt": attempt,
                    "status_code": response.status_code,
                },
            )
            self._maybe_sleep(attempt)

        assert last_exc is not None
        raise StatusSyncError(
            f"status sync exhausted {self._max_attempts} attempts: {last_exc}"
        ) from last_exc

    def _maybe_sleep(self, attempt: int) -> None:
        """Sleep with exponential backoff between attempts.

        ``attempt`` is 1-indexed (1 = first try). No sleep after the final
        attempt; that's wasted time before the raise.
        """
        if attempt >= self._max_attempts:
            return
        # 0.5, 1.0, 2.0, 4.0 ... seconds (capped via the simple math).
        delay = self._backoff_base_seconds * (2 ** (attempt - 1))
        self._sleep(delay)
