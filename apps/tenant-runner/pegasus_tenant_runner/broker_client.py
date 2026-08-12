"""Per-tenant broker client (``X-Workflow-Broker-Token`` auth).

The runner's ONLY credential is the tenant-scoped ``wbk_`` token (Phase 3
Unit 7) — it can list/download its own tenant's artifacts, mint runtime
tokens for its own tenant's executions, and PATCH its own tenant's execution
rows. The broker answers anything cross-tenant with 404 exactly like a
missing row, so this client treats 404 as a hard error (it should never
happen for ids the runner received from Temporal).

Three calls, mirroring the stdlib worker's ``runtime_client.py`` +
``status_sync.py`` split but collapsed into one class because all three share
the token header and retry posture:

* :meth:`list_executable_workflows` — GET ``/internal/tenant-workflows``
  (the Unit 8 broker endpoint): the tenant's ``executable: true`` workflows
  with entry points, the finalize-recorded ``artifactSha256`` and a
  short-lived presigned GET URL per artifact.
* :meth:`fetch_runtime_token` — POST ``/internal/workflow-runtime-token``:
  the per-workflow ``vnd_`` runtime token for one QUEUED/RUNNING execution,
  plus the identity of the published row that execution is bound to (the
  runner's only source for it — see :class:`RuntimeGrant`).
* :meth:`patch_execution` — PATCH ``/internal/workflow-executions/:id``:
  terminal status write-back, with the same retry/backoff semantics as
  ``status_sync.py`` (5xx/network retry with exponential backoff, 401/403
  raise immediately — a wrong token won't fix itself by retrying).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger(__name__)

__all__ = [
    "BrokerAuthError",
    "BrokerError",
    "ExecutableWorkflow",
    "RuntimeGrant",
    "TenantBrokerClient",
]

BROKER_TOKEN_HEADER = "X-Workflow-Broker-Token"

LIST_PATH = "/api/v1/internal/tenant-workflows"
TOKEN_PATH = "/api/v1/internal/workflow-runtime-token"
PATCH_PATH = "/api/v1/internal/workflow-executions/{execution_id}"

VALID_TERMINAL_STATUSES = frozenset({"COMPLETED", "FAILED", "TIMED_OUT", "CANCELLED"})


class BrokerError(RuntimeError):
    """Base class for any broker call failure."""


class BrokerAuthError(BrokerError):
    """401/403 from the broker — the wbk_ token is wrong, rotated, or revoked."""


@dataclass(frozen=True)
class RuntimeGrant:
    """What the broker hands back for one execution: the token + WHICH row it is.

    ``token`` is deliberately excluded from ``repr`` — this object crosses log
    boundaries and the plaintext credential must never ride along.

    The three identity fields are None when the API predates sdk-feedback 0034
    and doesn't return them; the runner then falls back to resolving the latest
    row for the workflow name, freshly listed. Everything else about that path
    is identical.
    """

    token: str = field(repr=False)
    workflow_id: str | None = None
    workflow_name: str | None = None
    workflow_version: str | None = None


@dataclass(frozen=True)
class ExecutableWorkflow:
    """One executable workflow row as returned by the broker list endpoint."""

    id: str
    name: str
    version: str
    entry_points: tuple[str, ...]
    artifact_sha256: str
    artifact_size_bytes: int | None
    download_url: str
    created_at: str


def _parse_workflow(item: dict[str, Any]) -> ExecutableWorkflow:
    """Parse one list item, raising :class:`BrokerError` on a bad shape.

    Strict on the fields the runner's security model depends on
    (``artifactSha256`` especially — a missing digest means the TOCTOU check
    cannot run, so the row is unusable).
    """
    def _string(key: str) -> str:
        value = item.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"{key} must be a non-empty string")
        return value

    try:
        raw_entry_points = item.get("entryPoints")
        if not isinstance(raw_entry_points, list) or not raw_entry_points:
            raise ValueError("entryPoints must be a non-empty array")
        entry_points = tuple(str(e) for e in raw_entry_points)
        sha = _string("artifactSha256")
        if len(sha) != 64:
            raise ValueError("artifactSha256 must be a 64-char hex digest")
        size = item.get("artifactSizeBytes")
        return ExecutableWorkflow(
            id=_string("id"),
            name=_string("name"),
            version=_string("version"),
            entry_points=entry_points,
            artifact_sha256=sha,
            artifact_size_bytes=int(size) if size is not None else None,
            download_url=_string("downloadUrl"),
            created_at=_string("createdAt"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise BrokerError(f"broker list item has an invalid shape: {exc!r}") from exc


class TenantBrokerClient:
    """HTTP client for the three per-tenant broker endpoints."""

    def __init__(
        self,
        *,
        api_base_url: str,
        broker_token: str,
        timeout: float = 10.0,
        max_attempts: int = 3,
        backoff_base_seconds: float = 0.5,
        transport: httpx.BaseTransport | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        if not api_base_url:
            raise ValueError("api_base_url is required")
        if not broker_token:
            raise ValueError("broker_token is required")
        self._api_base_url = api_base_url.rstrip("/")
        self._broker_token = broker_token
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
            headers={BROKER_TOKEN_HEADER: self._broker_token},
        )

    @staticmethod
    def _check_auth(response: httpx.Response) -> None:
        if response.status_code in (401, 403):
            raise BrokerAuthError(f"broker auth rejected (HTTP {response.status_code})")

    # -- public -------------------------------------------------------------

    def list_executable_workflows(self) -> list[ExecutableWorkflow]:
        """Fetch the tenant's executable workflows (with presigned URLs)."""
        with self._client() as client:
            response = client.get(LIST_PATH)
        self._check_auth(response)
        if not response.is_success:
            raise BrokerError(f"workflow list failed: HTTP {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise BrokerError("workflow list response was not JSON") from exc
        items = body.get("data") if isinstance(body, dict) else None
        if not isinstance(items, list):
            raise BrokerError("workflow list response missing 'data' array")
        return [_parse_workflow(item) for item in items]

    def fetch_runtime_token(self, execution_id: str) -> RuntimeGrant:
        """Fetch the runtime token AND the workflow identity for ``execution_id``.

        The token is the TENANT'S OWN credential (scoped to the static
        ``workflow_runtime`` role) — handing it to the tenant subprocess is
        by design. It must still never be logged or written to disk by the
        shim (hence ``repr=False`` on the field).

        The identity fields say WHICH published row this execution is bound to.
        They are the runner's only way to know that — the Temporal envelope
        carries just ``executionId``/``input`` — so without them the runner can
        do no better than "latest for this name", which is how a warm task came
        to serve stale bytes (sdk-feedback 0034). They are optional on the wire
        so a runner deployed ahead of the API still works, degraded: see
        :attr:`RuntimeGrant.workflow_id` being None.
        """
        if not execution_id:
            raise ValueError("execution_id is required")
        with self._client() as client:
            response = client.post(TOKEN_PATH, json={"executionId": execution_id})
        self._check_auth(response)
        if not response.is_success:
            raise BrokerError(f"runtime token fetch failed: HTTP {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise BrokerError("runtime token response was not JSON") from exc
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise BrokerError("runtime token response missing 'token' string field")

        def _optional_str(key: str) -> str | None:
            value = body.get(key)
            return value if isinstance(value, str) and value else None

        return RuntimeGrant(
            token=token,
            workflow_id=_optional_str("workflowId"),
            workflow_name=_optional_str("workflowName"),
            workflow_version=_optional_str("workflowVersion"),
        )

    def patch_execution(
        self,
        execution_id: str,
        status: str,
        *,
        finished_at_iso: str,
        result: Any | None = None,
        error_message: str | None = None,
    ) -> None:
        """PATCH a terminal status onto the execution row.

        Mirrors ``status_sync.py``: retries 5xx/network with exponential
        backoff, raises immediately on 401/403, and raises
        :class:`BrokerError` once the retry budget is exhausted. Unlike the
        Phase-2 client there is no 404-absorb — the endpoint exists, so a
        404 here means the row vanished or the token lost its tenant, both
        of which deserve a loud failure.
        """
        if status not in VALID_TERMINAL_STATUSES:
            raise ValueError(
                f"status {status!r} is not terminal — expected one of "
                f"{sorted(VALID_TERMINAL_STATUSES)}"
            )
        payload: dict[str, Any] = {"status": status, "finishedAt": finished_at_iso}
        if result is not None:
            payload["result"] = result
        if error_message is not None:
            payload["errorMessage"] = error_message

        path = PATCH_PATH.format(execution_id=execution_id)
        last_exc: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            try:
                with self._client() as client:
                    response = client.request("PATCH", path, json=payload)
            except httpx.HTTPError as exc:
                last_exc = exc
                log.warning(
                    "broker.patch_network_error",
                    extra={
                        "execution_id": execution_id,
                        "attempt": attempt,
                        "error": str(exc),
                    },
                )
                self._maybe_sleep(attempt)
                continue

            self._check_auth(response)
            if response.is_success:
                return
            if response.status_code < 500:
                # 4xx other than auth (404 vanished row, 400 invalid
                # transition) won't improve with retries.
                raise BrokerError(
                    f"execution status PATCH rejected: HTTP {response.status_code}"
                )
            last_exc = BrokerError(f"status PATCH failed: HTTP {response.status_code}")
            log.warning(
                "broker.patch_retryable_http_error",
                extra={
                    "execution_id": execution_id,
                    "attempt": attempt,
                    "status_code": response.status_code,
                },
            )
            self._maybe_sleep(attempt)

        assert last_exc is not None
        raise BrokerError(
            f"status PATCH exhausted {self._max_attempts} attempts: {last_exc}"
        ) from last_exc

    def _maybe_sleep(self, attempt: int) -> None:
        """Exponential backoff between attempts; none after the final one."""
        if attempt >= self._max_attempts:
            return
        self._sleep(self._backoff_base_seconds * (2 ** (attempt - 1)))
