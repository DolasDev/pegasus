"""Hand-rolled REST client for the Pegasus public API.

The OpenAPI document at ``/openapi.json`` does not yet cover the workflows
surface, so this client is written by hand against the contract in
``apps/api/src/handlers/workflows.ts``.

Two responsibilities:

1. The workflow publish flow — ``request_upload_url`` → ``upload_artifact``
   (raw S3 PUT) → ``finalize`` — plus ``list_workflows``, ``get_workflow``,
   and ``get_download_url``.
2. Thin read helpers (``list_customers`` etc.) for use *inside* workflow
   activities, where a workflow needs to read Pegasus domain data.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx

__all__ = [
    "PegasusApiError",
    "PegasusClient",
    "MAX_ARTIFACT_BYTES",
    "ARTIFACT_MIME_TYPE",
    "RUNTIME_BASE_URL_ENV_VAR",
    "RUNTIME_TOKEN_ENV_VAR",
    "DRY_RUN_ENV_VAR",
    "get_dry_run_captures",
    "reset_dry_run_captures",
]

#: Maximum artifact size accepted by ``POST /upload-url`` (mirrors the server).
MAX_ARTIFACT_BYTES = 25 * 1024 * 1024

#: Content-Type the presigned PUT is signed for. Must match exactly.
ARTIFACT_MIME_TYPE = "application/zip"

#: Env vars the tenant runner injects so workflow activities can reach the API.
#: These are the RUNTIME contract — distinct from the publish-time CLI token
#: (``PEGASUS_WORKFLOW_TOKEN``). See ``PegasusClient.from_runtime``.
RUNTIME_BASE_URL_ENV_VAR = "PEGASUS_API_BASE_URL"
RUNTIME_TOKEN_ENV_VAR = "PEGASUS_RUNTIME_TOKEN"

#: Env var the tenant runner sets for a dry-run execution. When truthy,
#: ``PegasusClient.from_runtime()`` returns a client in dry-run mode: reads hit
#: the live API as normal, but mutating calls perform NO external effect — they
#: append a record to the capture log and return a synthetic success. This is the
#: server-side half of the benign test capability (sdk-feedback/0015 Part A); the
#: read-vs-mutation split matches ``pegasus_workflows.testing.fake_client``.
DRY_RUN_ENV_VAR = "PEGASUS_DRY_RUN"
_DRY_RUN_TRUTHY = frozenset({"1", "true", "True", "yes", "on"})

#: Process-global dry-run capture sink. Each dry-run execution runs in its own
#: subprocess (the tenant runner's driver), so a module-level list is effectively
#: execution-scoped — the driver resets it before the run and reads it after, to
#: attach the capture log to the execution result the web-UI trace renders.
_dry_run_captures: list[dict[str, Any]] = []


def reset_dry_run_captures() -> None:
    """Clear the process-global dry-run capture sink (driver calls this pre-run)."""
    _dry_run_captures.clear()


def get_dry_run_captures() -> list[dict[str, Any]]:
    """Return a copy of the captured side effects recorded this process."""
    return list(_dry_run_captures)


#: Returned by the mutation-capture helper when NOT in dry-run, signaling the
#: caller to proceed with the real HTTP call. Distinct from any real return.
_NOT_CAPTURED: Any = object()


@dataclass
class PegasusApiError(Exception):
    """Raised when the Pegasus API returns a non-2xx response.

    Attributes:
        status_code: HTTP status code.
        code: Machine-readable ``code`` from the error body, if present.
        message: Human-readable ``error`` from the error body, if present.
        correlation_id: ``correlationId`` from the body (5xx responses only).
    """

    status_code: int
    code: str | None
    message: str | None
    correlation_id: str | None = None

    def __str__(self) -> str:  # noqa: D105 - dataclass repr is enough context
        parts = [f"HTTP {self.status_code}"]
        if self.code:
            parts.append(self.code)
        if self.message:
            parts.append(self.message)
        if self.correlation_id:
            parts.append(f"correlationId={self.correlation_id}")
        return " — ".join(parts)


def _raise_for_status(response: httpx.Response) -> None:
    """Raise :class:`PegasusApiError` if *response* is not 2xx."""
    if response.is_success:
        return
    code: str | None = None
    message: str | None = None
    correlation_id: str | None = None
    try:
        body = response.json()
        if isinstance(body, dict):
            code = body.get("code")
            message = body.get("error")
            correlation_id = body.get("correlationId")
    except ValueError:
        message = response.text or None
    raise PegasusApiError(
        status_code=response.status_code,
        code=code,
        message=message,
        correlation_id=correlation_id,
    )


def _integration_config_body(
    mapping: Any,
    rules: Any,
    corpus: Any,
    floor: str | None,
    display_name: str | None,
    external_shape: Any | None,
    external_mapping: Any | None,
    inbound: Any | None = None,
) -> dict[str, Any]:
    """Assemble the integration-config request body, omitting unset overlay fields.

    ``mapping``/``rules``/``corpus`` are the editable surface; the rest are the
    floor/overlay fields (sdk-feedback 0019 + 0020) and the ``inbound`` ingress
    block (0021), sent only when provided, so an older-style publish is byte-identical.
    """
    body: dict[str, Any] = {"mapping": mapping, "rules": rules, "corpus": corpus}
    if floor is not None:
        body["floor"] = floor
    if display_name is not None:
        body["displayName"] = display_name
    if external_shape is not None:
        body["externalShape"] = external_shape
    if external_mapping is not None:
        body["externalMapping"] = external_mapping
    if inbound is not None:
        body["inbound"] = inbound
    return body


class PegasusClient:
    """Authenticated client for the Pegasus public API.

    Args:
        base_url: API origin, e.g. ``http://localhost:3000``.
        token: A ``vnd_`` API key whose service account holds the
            ``workflow_developer`` role.
        timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        dry_run: bool = False,
    ) -> None:
        if not token:
            raise ValueError("a Pegasus API token is required")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        # Optional transport override — used by tests to mock HTTP traffic.
        self._transport = transport
        #: When True, mutating methods perform no external effect — they append
        #: to the capture log and return a synthetic success. Reads run live.
        self.is_dry_run = dry_run
        #: Side effects captured on THIS client (mirrors the process-global sink).
        self.captured: list[dict[str, Any]] = []

    @classmethod
    def from_runtime(cls, *, timeout: float = 30.0) -> PegasusClient:
        """Build a client from the env vars the tenant runner injects.

        Inside a workflow activity, prefer this over hardcoding
        ``os.environ[...]`` — it reads the runner's contract
        (:data:`RUNTIME_BASE_URL_ENV_VAR` / :data:`RUNTIME_TOKEN_ENV_VAR`) so a
        future rename of those vars is a one-line SDK fix, not a per-workflow
        break. Raises a clear, named error when run outside the runner (so the
        failure is obvious locally instead of a bare ``KeyError`` in prod).

        Raises:
            RuntimeError: If either runtime env var is missing or empty.
        """
        base_url = os.environ.get(RUNTIME_BASE_URL_ENV_VAR)
        token = os.environ.get(RUNTIME_TOKEN_ENV_VAR)
        missing = [
            name
            for name, value in (
                (RUNTIME_BASE_URL_ENV_VAR, base_url),
                (RUNTIME_TOKEN_ENV_VAR, token),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                "PegasusClient.from_runtime() requires the tenant-runner-injected "
                f"env var(s) {', '.join(missing)}; they are unset. (Note: "
                "PEGASUS_WORKFLOW_TOKEN is the publish-time CLI token, not a "
                "runtime var.)"
            )
        dry_run = os.environ.get(DRY_RUN_ENV_VAR, "") in _DRY_RUN_TRUTHY
        # base_url and token are non-empty here (else they'd be in `missing`).
        return cls(  # type: ignore[arg-type]
            base_url=base_url, token=token, timeout=timeout, dry_run=dry_run
        )

    # -- dry-run capture ----------------------------------------------------

    def _capture_mutation(
        self,
        capability: str,
        method: str,
        args: dict[str, Any],
        would_return: Any,
    ) -> Any:
        """In dry-run, record a mutation and return its synthetic result.

        Returns :data:`_NOT_CAPTURED` when NOT in dry-run, signaling the caller
        to proceed with the real HTTP call. The record is appended both to this
        client's :attr:`captured` and the process-global sink the runner reads.
        """
        if not self.is_dry_run:
            return _NOT_CAPTURED
        record = {
            "method": method,
            "capability": capability,
            "args": args,
            "wouldReturn": would_return,
        }
        self.captured.append(record)
        _dry_run_captures.append(record)
        return would_return

    def record_side_effect(self, label: str, payload: Any = None) -> None:
        """Record an effect the platform can't infer (e.g. a raw outbound call).

        A no-op outside dry-run. Use this when an activity performs a side effect
        the SDK doesn't mediate, so the dry-run trace still shows it would happen.
        """
        if not self.is_dry_run:
            return
        record = {
            "method": "record_side_effect",
            "capability": "custom",
            "label": label,
            "payload": payload,
        }
        self.captured.append(record)
        _dry_run_captures.append(record)

    # -- internals ----------------------------------------------------------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._token}"},
            timeout=self._timeout,
            transport=self._transport,
        )

    def _bare_client(self) -> httpx.Client:
        """An httpx client with no base URL — for absolute S3 URLs."""
        return httpx.Client(timeout=self._timeout, transport=self._transport)

    def _get_json(self, path: str, **params: Any) -> Any:
        with self._client() as client:
            response = client.get(path, params=params or None)
        _raise_for_status(response)
        return response.json()

    # -- workflow publish flow ---------------------------------------------

    def request_upload_url(self, name: str, version: str, size_bytes: int) -> dict[str, Any]:
        """Request a presigned S3 PUT URL for a workflow artifact.

        Args:
            name: Workflow name.
            version: Workflow version.
            size_bytes: Exact byte size of the zip about to be uploaded.

        Returns:
            The ``data`` object: ``{workflowId, uploadUrl, expiresInSeconds}``.

        Raises:
            PegasusApiError: On 409 (duplicate) or any other non-2xx.
            ValueError: If *size_bytes* exceeds :data:`MAX_ARTIFACT_BYTES`.
        """
        if size_bytes <= 0 or size_bytes > MAX_ARTIFACT_BYTES:
            raise ValueError(
                f"sizeBytes must be 1..{MAX_ARTIFACT_BYTES} (got {size_bytes})"
            )
        with self._client() as client:
            response = client.post(
                "/api/v1/workflows/upload-url",
                json={"name": name, "version": version, "sizeBytes": size_bytes},
            )
        _raise_for_status(response)
        return response.json()["data"]

    def upload_artifact(self, upload_url: str, artifact: bytes) -> None:
        """PUT a workflow artifact to its presigned S3 URL.

        The ``Content-Type`` and ``Content-Length`` are signed into the URL
        by the server, so they must be sent verbatim or S3 rejects the PUT.

        Args:
            upload_url: The presigned URL from :meth:`request_upload_url`.
            artifact: The raw zip bytes.

        Raises:
            PegasusApiError: If S3 rejects the upload.
        """
        with self._bare_client() as client:
            response = client.put(
                upload_url,
                content=artifact,
                headers={
                    "Content-Type": ARTIFACT_MIME_TYPE,
                    "Content-Length": str(len(artifact)),
                },
            )
        if not response.is_success:
            raise PegasusApiError(
                status_code=response.status_code,
                code="S3_UPLOAD_FAILED",
                message=response.text or "S3 rejected the artifact upload",
            )

    def finalize(self, workflow_id: str, manifest: dict[str, Any]) -> dict[str, Any]:
        """Finalize an upload, creating the ``Workflow`` row.

        Args:
            workflow_id: The id returned by :meth:`request_upload_url`.
            manifest: The manifest dict (camelCase, see
                :meth:`Manifest.to_api_manifest`).

        Returns:
            The created ``WorkflowResponse`` object.

        Raises:
            PegasusApiError: On 409 (duplicate) or any other non-2xx.
        """
        with self._client() as client:
            response = client.post(
                "/api/v1/workflows",
                json={"workflowId": workflow_id, "manifest": manifest},
            )
        _raise_for_status(response)
        return response.json()["data"]

    def run_workflow(
        self,
        workflow_id: str,
        input: dict[str, Any] | None = None,
        *,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Start a server-side execution of *workflow_id*.

        Triggers ``POST /api/v1/workflows/{id}/run``. The workflow must be
        in the curated executable allowlist (Phase 2: only stdlib workflows
        run server-side) — non-curated names raise with code
        ``WORKFLOW_NOT_EXECUTABLE``.

        Args:
            workflow_id: The workflow to run (GLOBAL or a TENANT fork of one).
            input: JSON-shaped input dict the worker passes to the workflow.
                Defaults to an empty dict.
            dry_run: When True, request ``mode=dry_run`` — a benign rehearsal
                that runs the real workflow with reads live but mutations
                captured (never performed). Only tenant-runner workflows support
                it; a curated workflow returns 422 ``DRY_RUN_UNSUPPORTED``.

        Returns:
            The freshly-created ``WorkflowExecutionResponse`` object in its
            initial state (``QUEUED`` or ``RUNNING`` depending on whether
            the Temporal start round-trip has completed).

        Raises:
            PegasusApiError: On 400 (not in allowlist), 404, 422
                (``DRY_RUN_UNSUPPORTED``), 502 (Temporal start failed), or any
                other non-2xx.
        """
        payload: dict[str, Any] = {"input": input or {}}
        if dry_run:
            payload["mode"] = "dry_run"
        with self._client() as client:
            response = client.post(
                f"/api/v1/workflows/{workflow_id}/run",
                json=payload,
            )
        _raise_for_status(response)
        return response.json()["data"]

    def list_executions(
        self,
        workflow_id: str,
        *,
        limit: int = 50,
        before: str | None = None,
    ) -> list[dict[str, Any]]:
        """List recent executions of *workflow_id*, newest first.

        Args:
            workflow_id: The workflow whose executions to list.
            limit: Page size (1..200; default 50).
            before: Optional ``execution_id`` of the last row on the
                previous page — keyset pagination, robust to inserts.

        Returns:
            A list of ``WorkflowExecutionResponse`` objects.

        Raises:
            PegasusApiError: On 404 (workflow not visible) or any other
                non-2xx.
        """
        params: dict[str, Any] = {"limit": limit}
        if before:
            params["before"] = before
        return self._get_json(
            f"/api/v1/workflows/{workflow_id}/executions", **params
        )["data"]

    def get_execution(
        self,
        workflow_id: str,
        execution_id: str,
    ) -> dict[str, Any]:
        """Fetch one execution.

        Raises:
            PegasusApiError: On 404 (workflow not visible or execution not
                part of this workflow).
        """
        return self._get_json(
            f"/api/v1/workflows/{workflow_id}/executions/{execution_id}",
        )["data"]

    def get_execution_history(
        self,
        workflow_id: str,
        execution_id: str,
    ) -> list[dict[str, Any]]:
        """Fetch the Temporal event-history timeline for one execution.

        Returns the flattened timeline the server derives from the run's
        Temporal history — ``WorkflowExecutionStarted``, per-activity
        scheduled/started/completed/failed, and the terminal workflow event.

        Args:
            workflow_id: The workflow the execution belongs to.
            execution_id: The execution to inspect.

        Returns:
            A list of ``{id, type, timestamp, activityType?, attempt?, failure?}``
            events. Empty when the run never started on Temporal.

        Raises:
            PegasusApiError: On 404 (not visible, or history no longer available)
                or 502 (Temporal unavailable).
        """
        return self._get_json(
            f"/api/v1/workflows/{workflow_id}/executions/{execution_id}/history",
        )["data"]["events"]

    def fork_workflow(self, workflow_id: str) -> dict[str, Any]:
        """Fork a GLOBAL platform-library workflow into the caller's tenant.

        Copies the source workflow's artifact and manifest into a new
        TENANT-visibility row owned by the caller — the one-click replacement
        for the download-and-reupload workaround.

        Args:
            workflow_id: The GLOBAL source workflow's id.

        Returns:
            The created ``WorkflowResponse`` object.

        Raises:
            PegasusApiError: On 404 (source not found or not GLOBAL),
                409 (a workflow with the same name@version already exists),
                or any other non-2xx.
        """
        with self._client() as client:
            response = client.post(f"/api/v1/workflows/{workflow_id}/fork")
        _raise_for_status(response)
        return response.json()["data"]

    def cancel_execution(self, workflow_id: str, execution_id: str) -> dict[str, Any]:
        """Request cancellation of a running (non-terminal) execution.

        Cancellation is cooperative: the call signals Temporal and returns once the
        request is accepted; the execution transitions to CANCELLED when the run
        observes the signal. Requires ``CancelWorkflowExecution`` (the
        ``workflow_developer`` role).

        Args:
            workflow_id: The workflow the execution belongs to.
            execution_id: The execution to cancel.

        Returns:
            The updated ``ExecutionResponse``.

        Raises:
            PegasusApiError: 404 (unknown execution), 409 (already terminal),
                502 (Temporal signal failed), or any non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/workflows/{workflow_id}/executions/{execution_id}/cancel"
            )
        _raise_for_status(response)
        return response.json()["data"]

    def retry_execution(self, workflow_id: str, execution_id: str) -> dict[str, Any]:
        """Retry a terminal-failed execution as a brand-new run with the same input.

        Starts a fresh execution through the same path as ``run_workflow`` (identical
        limit/quota/Temporal handling); the original row is left untouched. Only a
        FAILED / TIMED_OUT / CANCELLED execution can be retried. Requires
        ``RetryWorkflowExecution`` (the ``workflow_developer`` role).

        Args:
            workflow_id: The workflow the execution belongs to.
            execution_id: The terminal execution to re-run.

        Returns:
            The new ``ExecutionResponse``.

        Raises:
            PegasusApiError: 404 (unknown execution), 409 (execution not in a
                retryable terminal state), or any non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/workflows/{workflow_id}/executions/{execution_id}/retry"
            )
        _raise_for_status(response)
        return response.json()["data"]

    def list_workflows(self) -> list[dict[str, Any]]:
        """List every workflow visible to the caller's tenant (its own ∪ GLOBAL).

        Returns:
            A list of ``WorkflowResponse`` objects (id, name, version, visibility,
            createdAt, …). Requires ``ReadWorkflow``.
        """
        return self._get_json("/api/v1/workflows")["data"]

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        """Fetch a single workflow's metadata by id.

        Args:
            workflow_id: The workflow id.

        Returns:
            The ``WorkflowResponse`` (id, name, version, visibility, …).

        Raises:
            PegasusApiError: 404 if no such workflow is visible to the caller.
        """
        return self._get_json(f"/api/v1/workflows/{workflow_id}")["data"]

    # -- workflow triggers (schedule / event bindings; CLI management) ------
    #
    # Management surface (needs ``ManageWorkflowTriggers``, held by the
    # workflow_developer / tenant_admin roles — NOT a workflow_runtime key).
    # The dispatcher Lambda fires stored triggers: SCHEDULE rows are cron-
    # evaluated each minute, EVENT rows match the domain-event outbox.

    def create_trigger(
        self,
        workflow_id: str,
        *,
        kind: str,
        cron_expression: str | None = None,
        event_type: str | None = None,
        filter: dict[str, Any] | None = None,
        enabled: bool = True,
    ) -> dict[str, Any]:
        """Attach a trigger to a workflow. Requires ``ManageWorkflowTriggers``.

        Args:
            workflow_id: The workflow row id to bind the trigger to.
            kind: ``"SCHEDULE"`` (cron) or ``"EVENT"`` (domain-event subscription).
            cron_expression: 5-field UTC cron (SCHEDULE only), e.g. ``"*/5 * * * *"``.
            event_type: Domain/custom event name (EVENT only).
            filter: Optional payload-match object (EVENT only).
            enabled: Whether the trigger fires (default ``True``).

        Returns:
            The created trigger row ``{id, workflowId, kind, cronExpression,
            eventType, filter, enabled, ...}``.

        Raises:
            PegasusApiError: On 400 (invalid cron / shape), 403 (missing action),
                404 (unknown workflow).
        """
        body: dict[str, Any] = {"kind": kind, "enabled": enabled}
        if cron_expression is not None:
            body["cronExpression"] = cron_expression
        if event_type is not None:
            body["eventType"] = event_type
        if filter is not None:
            body["filter"] = filter
        with self._client() as client:
            response = client.post(f"/api/v1/workflows/{workflow_id}/triggers", json=body)
        _raise_for_status(response)
        return response.json()["data"]

    def list_triggers(self, workflow_id: str) -> list[dict[str, Any]]:
        """List a workflow's triggers (SCHEDULE + EVENT), the caller-tenant's rows.

        Args:
            workflow_id: The workflow whose triggers to list.

        Returns:
            A list of trigger objects (id, kind, eventType/schedule, filter,
            enabled, …). Requires ``ReadWorkflow``.
        """
        return self._get_json(f"/api/v1/workflows/{workflow_id}/triggers")["data"]

    def delete_trigger(self, workflow_id: str, trigger_id: str) -> None:
        """Delete one of a workflow's triggers.

        Args:
            workflow_id: The workflow the trigger belongs to.
            trigger_id: The trigger to delete.

        Raises:
            PegasusApiError: 404 if the trigger does not exist for this tenant, or
                any non-2xx. Requires ``ManageWorkflowTriggers``.
        """
        with self._client() as client:
            response = client.delete(f"/api/v1/workflows/{workflow_id}/triggers/{trigger_id}")
        _raise_for_status(response)

    # -- inbound ingress credentials (CLI management) -----------------------
    #
    # The bearer a third party POSTs to the platform ingress endpoint. Managed
    # (create/rotate/inspect) with a vnd_ key holding ``ManageIngress``
    # (workflow_developer / tenant_admin). The plaintext token is returned ONCE
    # by create/rotate — store it immediately (register it Sirva-side).

    def create_ingress(self, integration_id: str) -> dict[str, Any]:
        """Mint the ingress credential for an integration. Requires ``ManageIngress``.

        Returns ``{integrationId, url, token, tokenPrefix, enabled}`` — ``token``
        is shown only here. Raises ``PegasusApiError`` (409) if one already exists
        (rotate instead).
        """
        with self._client() as client:
            response = client.post(f"/api/v1/integrations/{integration_id}/ingress")
        _raise_for_status(response)
        return response.json()["data"]

    def rotate_ingress(self, integration_id: str) -> dict[str, Any]:
        """Rotate an integration's ingress token (old token stops working).

        Requires ``ManageIngress``. Returns ``{integrationId, url, token, ...}``
        with the NEW token (shown once). Raises ``PegasusApiError`` (404) if none.
        """
        with self._client() as client:
            response = client.post(f"/api/v1/integrations/{integration_id}/ingress/rotate")
        _raise_for_status(response)
        return response.json()["data"]

    def get_ingress(self, integration_id: str) -> dict[str, Any]:
        """Fetch an integration's ingress metadata (never the token). ``ManageIngress``.

        Returns ``{integrationId, url, tokenPrefix, enabled, createdAt, rotatedAt}``.
        """
        return self._get_json(f"/api/v1/integrations/{integration_id}/ingress")["data"]

    def get_download_url(self, workflow_id: str) -> dict[str, Any]:
        """Get a presigned GET URL for a workflow's source zip.

        Returns:
            ``{downloadUrl, expiresInSeconds}``.
        """
        return self._get_json(f"/api/v1/workflows/{workflow_id}/download-url")["data"]

    def download_artifact(self, workflow_id: str) -> bytes:
        """Download a workflow's published source zip as raw bytes.

        Resolves a short-lived presigned URL (:meth:`get_download_url`) and streams
        the object directly from storage. The counterpart to publishing — e.g. to
        inspect or re-fork a GLOBAL workflow's source.

        Args:
            workflow_id: The workflow whose artifact to fetch.

        Returns:
            The zip archive bytes. Requires ``ReadWorkflow``.
        """
        download_url = self.get_download_url(workflow_id)["downloadUrl"]
        with self._bare_client() as client:
            response = client.get(download_url)
        _raise_for_status(response)
        return response.content

    # -- domain read helpers (for use inside activities) -------------------
    # These read core operational entities from inside a running workflow, on the
    # ``workflow_runtime`` service-account key (``from_runtime``), which is granted
    # ReadCustomer/ReadQuote/ListMoves/ReadInvoice/ReadEvent. They hit the m2m
    # ``/api/v1/runtime/*`` surface (0.23.0+) — the browser ``/api/v1/*`` CRUD
    # routes are Cognito-only and reject a ``vnd_`` key. Each accepts ``limit`` /
    # ``offset`` query params and returns ``{data, meta:{total,count,limit,offset}}``.

    def list_customers(self, **params: Any) -> Any:
        """Read the customers list (requires ``ReadCustomer``)."""
        return self._get_json("/api/v1/runtime/customers", **params)

    def list_quotes(self, **params: Any) -> Any:
        """Read the quotes list (requires ``ReadQuote``)."""
        return self._get_json("/api/v1/runtime/quotes", **params)

    def list_moves(self, **params: Any) -> Any:
        """Read the moves list (requires ``ListMoves``)."""
        return self._get_json("/api/v1/runtime/moves", **params)

    def list_invoices(self, **params: Any) -> Any:
        """Read the invoices list (requires ``ReadInvoice``)."""
        return self._get_json("/api/v1/runtime/invoices", **params)

    def list_events(self, event_type: str, **params: Any) -> Any:
        """Poll the pending inbound events of ``event_type`` (requires ``ReadEvent``).

        The inbound platform-event queue is keyed by type, so an event type is
        required. Returns the events awaiting processing for the caller's tenant.
        """
        return self._get_json(f"/api/v1/events/{event_type}", **params)

    # -- generic read passthrough ------------------------------------------

    def api_get(self, path: str, **params: Any) -> Any:
        """GET any Pegasus API path with the caller's key; return the full JSON body.

        A read-only escape hatch for endpoints that have no dedicated helper — e.g.
        the paginated, filtered projection read-model
        ``/api/v1/integrations/{id}/projections/{entityType}`` (``status`` /
        ``updatedSince`` / keyset ``nextCursor``). The catalog of reachable paths
        is the OpenAPI spec (``GET /openapi.json`` / ``pegasus://reference/openapi``).

        Args:
            path: An API path beginning with ``/`` (e.g.
                ``/api/v1/integrations/x/projections/shipment``). Query params are
                passed as keyword args. An absolute URL is rejected — this only
                calls the caller's Pegasus API, never an arbitrary host (that is
                :meth:`call_external`'s job).

        Returns:
            The decoded response body verbatim (NOT unwrapped to ``["data"]``), so
            ``meta`` / ``nextCursor`` / bare-schema envelopes are preserved.

        Raises:
            ValueError: If ``path`` is not a root-relative path (no scheme/host).
            PegasusApiError: On any non-2xx response.

        Note:
            **Read-only by design.** For writes use the typed methods, which route
            through the dry-run capture path; a generic write would bypass it and
            silently break offline rehearsal. Not stubbed by the offline test
            harness (:class:`~pegasus_workflows.testing.FakeClient`) — use a typed
            read helper there, or a real client.
        """
        if not path.startswith("/") or "://" in path:
            raise ValueError(
                f"api_get expects a root-relative API path starting with '/', got {path!r}. "
                "Use call_external to reach a partner host."
            )
        return self._get_json(path, **params)

    def emit_event(
        self,
        name: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Emit an instance of a tenant-defined custom event by name.

        Fires a custom event into the tenant's workflow engine — the same
        DomainEvent outbox the dispatcher drains — so any workflow whose EVENT
        trigger subscribes to ``name`` will run. This is the workflow-to-workflow
        chaining primitive: one workflow emits ``name`` and another, triggered on
        it, picks up the work.

        The event type must already be registered in the tenant's event-type
        registry. If that type declares a payload JSON Schema, ``payload`` is
        validated against it server-side and a mismatch raises ``PegasusApiError``
        (400).

        Requires the workflow's manifest to declare
        ``required_actions = ["EmitTenantEvent"]``.

        Args:
            name: The registered ``TenantEventType`` name (e.g. ``"lead.qualified"``).
            payload: Arbitrary JSON payload. Defaults to ``{}``.

        Returns:
            ``{emitted: True, eventType: name, occurredAt: <ISO-8601>}``.

        Raises:
            PegasusApiError: On 400 (payload fails the type's schema),
                404 (event type not found or disabled), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "EmitTenantEvent",
            "emit_event",
            {"name": name, "payload": payload or {}},
            {
                "emitted": True,
                "eventType": name,
                "occurredAt": "1970-01-01T00:00:00.000Z",
                "dryRun": True,
            },
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(
                f"/api/v1/event-types/{name}/emit",
                json={"payload": payload or {}},
            )
        _raise_for_status(response)
        return response.json()["data"]

    def send_sms(self, to: str, body: str) -> dict[str, Any]:
        """Send an outbound SMS via the tenant's configured provider.

        For use inside workflow activities only (never in workflow code —
        httpx is sandboxed there). Requires the workflow's manifest to declare
        ``required_actions = ["SendSms"]``.

        Args:
            to: Destination phone number in E.164 form (e.g. ``"+16308868537"``).
            body: Message text.

        Returns:
            The API's parsed JSON, e.g. ``{"data": {"id": ..., "status": ...}}``.

        Raises:
            PegasusApiError: On 404 (no provider connected for the tenant),
                403 (manifest lacks ``SendSms``), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "SendSms",
            "send_sms",
            {"to": to, "body": body},
            {"data": {"id": "dry-run", "status": "captured", "dryRun": True}},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post("/api/v1/sms/send", json={"to": to, "body": body})
        _raise_for_status(response)
        return response.json()

    def map_to_external(
        self, integration_id: str, data: Any, *, action: str | None = None
    ) -> dict[str, Any]:
        """Map entity data into a published integration's external JSON shape.

        A published integration's mapping projects Pegasus/entity data into the
        partner's payload shape (its "canonical" structural contract IS that
        external shape). This runs that mapping and returns the result, so an
        activity can build the body for the partner API. The same validation
        verdict the integration's ``/validate`` gate produces is returned too, so
        the caller can decide whether the payload is safe to send.

        For use inside workflow activities. No manifest action required (same open
        API-key surface as ``/validate``).

        To reconcile against an external system's last-known state, compose this
        with the projection cache in your own code: ``get_projection`` (the cached
        external state) → ``map_to_external`` (the new payload) → merge in Python →
        ``put_projection`` (write it back). No merge happens server-side.

        Args:
            integration_id: Integration slug, e.g. ``"demo_partner"``.
            data: The entity data to map (any JSON-serializable object; the
                mapping's source paths resolve against it).
            action: Optional action driving action-scoped rules
                (``"save"`` | ``"cancel"`` | ``"status-change"``); defaults to the
                integration's default action.

        Returns:
            ``{external, valid, issues, degraded}``. ``external`` is the mapped
            partner payload — always present unless the mapping itself errored
            (then ``null``). ``valid``/``issues`` report whether ``external``
            passed the integration's structural contract + rules; ``degraded`` is
            true when the gate failed open internally.

        Raises:
            PegasusApiError: On 404 (unknown integration) or any other non-2xx.
        """
        body: dict[str, Any] = {"data": data}
        if action is not None:
            body["action"] = action
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/map-to-external", json=body
            )
        _raise_for_status(response)
        return response.json()

    def map_from_external(self, integration_id: str, payload: Any) -> dict[str, Any]:
        """Normalize a partner's NATIVE payload into the canonical entity (inbound).

        The inbound mirror of :meth:`map_to_external`. A published integration's
        mapping runs *native → canonical*; this returns that normalized CANONICAL
        entity (the system-of-record shape), plus the same gate verdict. An ingest
        workflow — the consumer of an inbound webhook event — uses ``canonical`` as
        the entity to persist (e.g. to a projection) and ``valid`` to fail closed
        on a bad payload.

        Unlike ``map_to_external`` (which returns the partner-external body), this
        returns the CANONICAL entity — the value the outbound direction computes
        internally and discards.

        For use inside workflow activities. No manifest action required (same open
        API-key surface as ``/validate`` and ``map_to_external``).

        Args:
            integration_id: Integration slug, e.g. ``"sirva_ade_shipment"``.
            payload: The partner's native payload (any JSON-serializable object;
                the mapping's source paths resolve against it).

        Returns:
            ``{canonical, valid, issues, degraded}``. ``canonical`` is the mapped
            entity — ``null`` only when the payload can't be mapped/parsed at all,
            so an ingest can fail closed rather than persist an empty entity.
            ``valid``/``issues`` report whether it passed the integration's
            structural contract + rules; ``degraded`` is true when the gate failed
            open internally.

        Raises:
            PegasusApiError: On 404 (unknown integration / no floor — fails closed
                so an ingest never proceeds on a silently-empty entity) or any
                other non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/map-from-external",
                json={"data": payload},
            )
        _raise_for_status(response)
        return response.json()

    def deliver_to_external(
        self,
        integration_id: str,
        body: Any,
        *,
        url_config: str = "SEND_URL",
        api_key_secret: str = "SEND_API_KEY",
        headers_config: str | None = None,
        group: str = "global",
    ) -> dict[str, Any]:
        """POST a mapped external body to a partner endpoint, server-side.

        The mutating counterpart to :meth:`map_to_external`: build the partner
        body with ``map_to_external``, then deliver it here. The platform performs
        the outbound POST using the workflow's own delivery URL (config
        ``url_config``) and API key (secret ``api_key_secret``), so the send flows
        through the platform — captured, not performed, under a dry run — instead
        of a raw ``httpx.post`` the runtime can neither see nor stop. Prefer this
        over calling the partner directly from an activity.

        Requires the workflow's manifest to declare
        ``required_actions = ["DeliverToExternal"]``.

        Args:
            integration_id: Integration slug the delivery is for, e.g.
                ``"demo_partner"``. Validated against the registry (404 if
                unknown) and recorded; the endpoint/credentials come from config.
            body: The mapped external payload to POST (typically a
                ``map_to_external`` result's ``external``).
            url_config: Config key holding the delivery URL (default ``SEND_URL``).
            api_key_secret: Secret key holding the bearer API key (default
                ``SEND_API_KEY``).
            headers_config: Optional config key holding extra headers as a JSON
                object string (e.g. ``SEND_HEADERS``).
            group: The config/secret group the entries live in (default
                ``"global"``).

        Returns:
            ``{delivered, status, response, dryRun}``. On a real run ``delivered``
            reflects the partner's 2xx-ness and ``status``/``response`` carry the
            partner reply. On a dry run: ``{delivered: False, dryRun: True}`` and
            nothing is sent.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``DeliverToExternal``), 404
                (unknown integration, or the URL config / API-key secret is not
                set), 400 (disallowed delivery URL), 502 (delivery failed), or any
                other non-2xx.
        """
        payload: dict[str, Any] = {
            "external": body,
            "urlConfig": url_config,
            "apiKeySecret": api_key_secret,
            "group": group,
        }
        if headers_config is not None:
            payload["headersConfig"] = headers_config
        captured = self._capture_mutation(
            "DeliverToExternal",
            "deliver_to_external",
            {"integration_id": integration_id, "external": body},
            {"delivered": False, "status": None, "response": None, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/deliver-to-external", json=payload
            )
        _raise_for_status(response)
        return response.json()["data"]

    def call_external(
        self,
        integration_id: str,
        *,
        method: str,
        path: str,
        query: dict[str, Any] | None = None,
        body: Any = None,
        mutating: bool | None = None,
        response_to_blob: bool = False,
        group: str = "global",
    ) -> dict[str, Any]:
        """Call a partner API server-side with the integration's configured auth.

        The read/arbitrary-method counterpart to :meth:`deliver_to_external`
        (which is one fixed JSON ``POST``). You name a ``method`` + ``path`` (+
        ``query``/``body``) and the platform performs the call against the
        integration's ``BASE_URL``, authenticating per its ``AUTH_MODE`` — for
        ``oauth2_client_credentials`` it mints, caches, and re-mints (on a partner
        ``401``) an OAuth2 token server-side, so ``client_id``/``client_secret``
        never appear in workflow code. Config + credentials live in the tenant's
        workflow config/secret store (``BASE_URL``/``AUTH_MODE``/``TOKEN_URL``
        configs, ``CLIENT_ID``/``CLIENT_SECRET`` or ``API_KEY`` secrets), read by
        name + ``group``.

        Requires the workflow's manifest to declare
        ``required_actions = ["CallExternal"]``.

        **Dry-run split (sdk-feedback/0015):** a ``GET`` (or any method with
        ``mutating=False``) is a *read* — it runs **live** under
        ``run --dry-run`` and returns real data. A ``POST``/``PUT``/… (or
        ``mutating=True``) is a *mutation* — it is **captured, not performed**
        under a dry run. Pass ``mutating`` to override the method-based default
        when a partner overloads a verb (e.g. a ``POST`` that only reads).

        Args:
            integration_id: Integration slug the call is for (e.g.
                ``"sirva_ade_shipment"``). Validated against the registry (404 if
                unknown); the endpoint/credentials come from config.
            method: HTTP method — ``GET``/``POST``/``PUT``/``PATCH``/``DELETE``.
            path: Path appended to ``BASE_URL`` (e.g. ``/OM/m1/GetShipmentDetail``).
            query: Optional query params (values are stringified).
            body: Optional JSON request body (mutations).
            mutating: Force read (``False``) / mutation (``True``) classification.
            response_to_blob: Land the partner response body into a **blob** and
                return ``{blobId, ...}`` instead of the body inline — for binary
                payloads (e.g. an ADE ``GetImage``) that shouldn't sit in workflow
                memory. Small-file cut (bytes still round-trip the API Lambda);
                pairs with ``FileData: {"$blob": blob_id}`` in a request ``body``,
                which the platform resolves to the blob's bytes server-side.
            group: Config/secret group the entries live in (default ``"global"``).

        Returns:
            ``{status, ok, response, headers, dryRun}`` — or, with
            ``response_to_blob=True``, ``{status, ok, blobId, size, headers,
            dryRun}``. ``response`` is the parsed JSON body, or the raw text for a
            non-JSON (e.g. XML) partner reply. On a captured mutation under
            dry-run: ``{status: None, response: None, ok: False, dryRun: True}``.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``CallExternal``), 404 (unknown
                integration or an unset ``BASE_URL``/``TOKEN_URL``/credential),
                400 (disallowed resolved URL or unsupported ``AUTH_MODE``), 502
                (token mint or outbound call failed), or any other non-2xx.
        """
        method_upper = method.upper()
        is_mutation = (
            mutating if mutating is not None else method_upper not in ("GET", "HEAD", "OPTIONS")
        )
        payload: dict[str, Any] = {"method": method_upper, "path": path, "group": group}
        if query is not None:
            payload["query"] = query
        if body is not None:
            payload["body"] = body
        if mutating is not None:
            payload["mutating"] = mutating
        if response_to_blob:
            payload["responseToBlob"] = True

        if is_mutation:
            captured = self._capture_mutation(
                "CallExternal",
                "call_external",
                {"integration_id": integration_id, "method": method_upper, "path": path},
                {"status": None, "response": None, "ok": False, "dryRun": True},
            )
            if captured is not _NOT_CAPTURED:
                return captured

        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/call-external", json=payload
            )
        _raise_for_status(response)
        return response.json()["data"]

    # -- blobs (opaque byte storage for document transfer) ------------------
    #
    # A workflow stages a file to upload or lands a file it fetched, without
    # holding the bytes in workflow memory — put/get stream runner<->S3 directly
    # via presigned URLs, so they are NOT bounded by the API Lambda's payload
    # limit. Requires ``required_actions = ["WriteBlob"]`` (put) / ``["ReadBlob"]``
    # (get). ``put_blob`` is a mutation (captured under dry-run); ``get_blob`` /
    # ``get_blob_url`` are reads (live).

    def put_blob(
        self, content_bytes: bytes, content_type: str = "application/octet-stream"
    ) -> dict[str, Any]:
        """Store bytes as a tenant-scoped blob; returns ``{blobId, size}``.

        Mints a blob id + presigned S3 PUT server-side, then uploads the bytes
        directly to S3 (never through the API), so files far larger than a JSON
        body are fine (up to the platform blob cap; over-cap raises 413). Use the
        returned ``blobId`` in a later ``call_external`` upload
        (``FileData: {"$blob": blobId}``). A **mutation** — captured, not
        performed, under ``run --dry-run``.
        """
        captured = self._capture_mutation(
            "WriteBlob",
            "put_blob",
            {"size": len(content_bytes), "content_type": content_type},
            {"blobId": None, "size": len(content_bytes), "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(
                "/api/v1/blobs/upload-url",
                json={"contentType": content_type, "sizeBytes": len(content_bytes)},
            )
        _raise_for_status(response)
        issued = response.json()["data"]
        with self._bare_client() as client:
            put = client.put(
                issued["uploadUrl"],
                content=content_bytes,
                headers={
                    "Content-Type": content_type,
                    "Content-Length": str(len(content_bytes)),
                },
            )
        if not put.is_success:
            raise PegasusApiError(
                status_code=put.status_code,
                code="S3_UPLOAD_FAILED",
                message=put.text or "S3 rejected the blob upload",
            )
        return {"blobId": issued["blobId"], "size": len(content_bytes)}

    def get_blob(self, blob_id: str) -> bytes:
        """Fetch a blob's bytes. Requires ``ReadBlob``. A read (runs live).

        Resolves a short-lived presigned GET server-side, then downloads the
        bytes directly from S3. Raises ``PegasusApiError`` (404) if the blob is
        unknown or its TTL has expired.
        """
        url = self.get_blob_url(blob_id)["downloadUrl"]
        with self._bare_client() as client:
            response = client.get(url)
        if not response.is_success:
            raise PegasusApiError(
                status_code=response.status_code,
                code="S3_DOWNLOAD_FAILED",
                message=response.text or "S3 rejected the blob download",
            )
        return response.content

    def get_blob_url(self, blob_id: str) -> dict[str, Any]:
        """Return a short-lived presigned GET URL for a blob (``{downloadUrl,
        expiresInSeconds, size}``). Requires ``ReadBlob``. A read (runs live)."""
        return self._get_json(f"/api/v1/blobs/{blob_id}/download-url")["data"]

    # -- pegII order + task reads (for use inside activities) ---------------
    #
    # Orders and their operational tasks live in the legacy pegII (MoveManager)
    # system, exposed to running workflows under ``/api/v1/pegii`` — a namespaced
    # legacy-bridge surface like the retired ``/onprem/longhaul`` cloud handlers.
    # (This is distinct from the M2M ``/api/v1/orders`` reporting view of cloud
    # moves.) A workflow started from an ``order.*`` domain event gets only a
    # pointer in the envelope payload — re-fetch authoritative state here.

    def list_orders(self, **params: Any) -> list[dict[str, Any]]:
        """List pegII orders visible to the caller. Requires ``ReadOrder``.

        For use inside workflow activities. Pass through query params such as
        ``status`` as keyword arguments.

        Returns:
            A list of order rows (``{id, orderNumber, status, customerName,
            scheduledDate, packingActualDate, createdAt, updatedAt}``).

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadOrder``) or any other
                non-2xx.
        """
        return self._get_json("/api/v1/pegii/orders", **params)["data"]

    def get_order(self, order_id: str, *, shape: str | None = None) -> Any:
        """Fetch a single pegII order by id. Requires ``ReadOrder``.

        For use inside workflow activities — the way to re-fetch authoritative
        order state from an ``order.*`` event envelope's pointer payload.

        Args:
            order_id: The order id.
            shape: Pass ``"native"`` to get the RAW serialized pegII payload
                (``{Id, Survey, InvolvedParties, KeyMoveDates, …}``) — the shape a
                partner posts to the ingress — instead of the projected order row.
                Feed it to :meth:`map_from_external` to dry-run a published
                integration's mapping against a real order id, or use
                :meth:`dry_run_integration` to do both in one call. Omit (the
                default) for the projected row ``{id, orderNumber, status,
                customerName, scheduledDate, packingActualDate, createdAt,
                updatedAt}``.

        Returns:
            The projected order row (default), or the native payload object when
            ``shape="native"``.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadOrder``), 404 (no such
                order), or any other non-2xx.
        """
        params = {"shape": shape} if shape is not None else {}
        return self._get_json(f"/api/v1/pegii/orders/{order_id}", **params)["data"]

    def dry_run_integration(
        self, integration_id: str, order_id: str
    ) -> dict[str, Any]:
        """Dry-run a published integration against a REAL pegII order id.

        Fetches the order's native pegII payload (``get_order(order_id,
        shape="native")``) and normalizes it through the published integration's
        inbound mapping (:meth:`map_from_external`) — no hand-pasting the raw
        payload. This is the "does this real order pass the integration?" check.

        Requires ``ReadOrder`` (for the native fetch); the map step needs no
        manifest action (same open surface as ``/validate``).

        Args:
            integration_id: Integration slug, e.g. ``"demo_partner"``.
            order_id: The pegII order id to fetch and map.

        Returns:
            ``{canonical, valid, issues, degraded}`` — the same result
            :meth:`map_from_external` returns for the hand-pasted payload.
            ``canonical`` is the mapped entity (``null`` only when unmappable);
            ``valid``/``issues`` report the integration's structural + rule gate.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadOrder``), 404 (no such
                order, or unknown integration / no floor), or any other non-2xx.
        """
        native = self.get_order(order_id, shape="native")
        return self.map_from_external(integration_id, native)

    # Tasks are the unit of human work in the moving-ops flow (date
    # confirmation, survey scheduling, paperwork, QA sign-off). A workflow whose
    # job is to advance or close out operational tasks in response to events
    # uses these. Reads are gated by ``ReadTask``; ``close_task`` by
    # ``CloseTask`` — declared in the workflow manifest ``required_actions``.

    def list_tasks(
        self, order_id: str | None = None, **params: Any
    ) -> list[dict[str, Any]]:
        """List pegII tasks, optionally scoped to one order. Requires ``ReadTask``.

        Args:
            order_id: If given, only tasks belonging to this order are returned
                (sent as the ``orderId`` query param).
            **params: Additional query params (e.g. ``status``).

        Returns:
            A list of task rows (``{id, orderId, taskType, status, reason,
            createdAt, updatedAt, closedAt}``).

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadTask``) or any other
                non-2xx.
        """
        if order_id is not None:
            params["orderId"] = order_id
        return self._get_json("/api/v1/pegii/tasks", **params)["data"]

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Fetch a single pegII task by id. Requires ``ReadTask``.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadTask``), 404 (no such
                task), or any other non-2xx.
        """
        return self._get_json(f"/api/v1/pegii/tasks/{task_id}")["data"]

    def close_task(
        self,
        *,
        order_id: str,
        task_type: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Close an order's task by ``(order_id, task_type)``. Requires ``CloseTask``.

        Identifying a task by ``(order_id, task_type)`` avoids having to first
        list tasks to find an id — the common "close the date-confirmation task
        for this order" shape. **Idempotent**: closing an already-closed task is
        a no-op success (not an error), so a long-running workflow can safely
        retry the activity.

        Args:
            order_id: The order the task belongs to.
            task_type: The task's type, e.g. ``"date_confirmation"``.
            reason: Optional human-readable note recorded on the close.

        Returns:
            The closed task row (``status == "closed"``). The response also
            carries ``alreadyClosed: True`` when the task was already closed.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``CloseTask``), 404 (no such
                order/task), or any other non-2xx.
        """
        payload: dict[str, Any] = {"orderId": order_id, "taskType": task_type}
        if reason is not None:
            payload["reason"] = reason
        captured = self._capture_mutation(
            "CloseTask",
            "close_task",
            {"order_id": order_id, "task_type": task_type, "reason": reason},
            {
                "orderId": order_id,
                "taskType": task_type,
                "status": "closed",
                "alreadyClosed": False,
                "dryRun": True,
            },
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post("/api/v1/pegii/tasks/close", json=payload)
        _raise_for_status(response)
        return response.json()["data"]

    # Salesmen are the sales users / employees pegII hangs off an order (the
    # booking agent, the account owner). A workflow that needs authoritative
    # salesman detail — name, branch, contact, active state — re-fetches it here
    # by the code carried on the order. Reads are gated by ``ReadSalesman``,
    # declared in the workflow manifest ``required_actions``.

    def list_salesmen(self, **params: Any) -> list[dict[str, Any]]:
        """List pegII salesmen visible to the caller. Requires ``ReadSalesman``.

        For use inside workflow activities. Pass through query params such as
        ``active`` (``"true"``/``"false"``) as keyword arguments.

        Returns:
            A list of salesman rows (``{id, avlCode, firstName, lastName, name,
            title, email, extension, branch, agencyCode, roles, employeeType,
            active, startDate, dateTerminated}``).

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadSalesman``) or any
                other non-2xx.
        """
        return self._get_json("/api/v1/pegii/salesmen", **params)["data"]

    def get_salesman(self, salesman_id: str) -> dict[str, Any]:
        """Fetch a single pegII salesman by code. Requires ``ReadSalesman``.

        For use inside workflow activities — the way to re-fetch authoritative
        salesman detail from the salesman code carried on an order.

        Args:
            salesman_id: The salesman code (e.g. ``"213056"``).

        Returns:
            The salesman row.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadSalesman``), 404 (no
                such salesman), or any other non-2xx.
        """
        return self._get_json(f"/api/v1/pegii/salesmen/{salesman_id}")["data"]

    # -- integration-validator config (publish / pull / versions / rollback) --
    #
    # The DB-backed authoring surface for an integration's declarative mapping +
    # rules (apps/api/src/handlers/integration-validation/config.ts). A candidate
    # supplies only the editable surface — ``mapping`` + ``rules`` — plus a golden
    # ``corpus`` the server gates it against. Visibility is derived server-side
    # from the caller's tenant (GLOBAL for the platform tenant, TENANT otherwise);
    # the token must carry the ``PublishIntegrationConfig`` action to mutate.

    def validate_integration_config(
        self,
        integration_id: str,
        *,
        mapping: Any,
        rules: Any,
        corpus: Any,
        floor: str | None = None,
        display_name: str | None = None,
        external_shape: Any | None = None,
        external_mapping: Any | None = None,
        inbound: Any | None = None,
    ) -> dict[str, Any]:
        """Dry-run the publish gate for a candidate config. No write.

        Runs the deterministic gate (mapping/rule static checks + golden-corpus
        round-trip) server-side and returns the full report. Not flag-gated — a
        usable pre-check anywhere. Inspect ``report["ok"]``.

        Args:
            integration_id: The integration to gate against (e.g. ``"demo_partner"``).
            mapping: The mapping document (editable surface).
            rules: The rule set (editable surface).
            corpus: The golden corpus — a list of ``GateCorpusCase`` objects.
            floor: The type floor this overlay targets (sdk-feedback 0020).
                Required for a NEW partner id with no built-in; omit to inherit a
                built-in id's floor.
            display_name: Human-facing label decoupled from the id (0019).
            external_shape: The partner external output shape, a JSON Schema (0020).
                Omit for an identity external body (external == canonical).
            external_mapping: The canonical → external projection (0020). Omit for
                identity.
            inbound: The ingress ack/validation block (0021) — see the
                ``/api/v1/integrations/inbound-schema`` JSON Schema. Omit for a
                non-ingress integration.

        Returns:
            The ``GateReport``: ``{ok, problems, corpus: {total, passed, failures}}``.

        Raises:
            PegasusApiError: On 404 (unknown integration/floor) or any other non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/config/validate",
                json=_integration_config_body(
                    mapping,
                    rules,
                    corpus,
                    floor,
                    display_name,
                    external_shape,
                    external_mapping,
                    inbound,
                ),
            )
        _raise_for_status(response)
        return response.json()["data"]

    def publish_integration_config(
        self,
        integration_id: str,
        *,
        mapping: Any,
        rules: Any,
        corpus: Any,
        floor: str | None = None,
        display_name: str | None = None,
        external_shape: Any | None = None,
        external_mapping: Any | None = None,
        inbound: Any | None = None,
    ) -> dict[str, Any]:
        """Gate then publish a config, creating a new version.

        The server re-runs the gate and writes nothing if it fails (returns 422
        ``GATE_FAILED`` with the report). On success the live registry overlay is
        refreshed so the new config serves immediately. Flag-gated behind the
        server's ``INTEGRATION_CONFIG_PUBLISH_ENABLED`` switch.

        Args:
            integration_id: The integration to publish.
            mapping: The mapping document.
            rules: The rule set.
            corpus: The golden corpus the gate runs against.
            floor: The type floor this overlay targets (sdk-feedback 0020).
                Required for a NEW partner id with no built-in; omit to inherit a
                built-in id's floor.
            display_name: Human-facing label decoupled from the id (0019).
            external_shape: The partner external output shape, a JSON Schema (0020).
                Omit for an identity external body (external == canonical).
            external_mapping: The canonical → external projection (0020). Omit for
                identity.
            inbound: The ingress ack/validation block (0021) — { eventType,
                dedupKeyPath (str or list of paths, first present wins),
                validation (requiredPaths, nonEmptyArrayPaths, and oneOf variants
                for a multi-shape partner — 0.22.0+), ackTemplate }; see
                ``/api/v1/integrations/inbound-schema``. This is what makes an
                ingress return the partner's ack envelope (e.g. ADE ``Result{…}``)
                instead of the generic ``{"status":"accepted"}``. Omit for a
                non-ingress integration.

        Returns:
            The created config row: ``{id, integrationId, version, visibility,
            status, mapping, rules, corpus, floor, displayName, externalShape,
            externalMapping, inbound, publishedBy, createdAt}``.

        Raises:
            PegasusApiError: On 403 (feature disabled), 404, 422 (gate failed —
                the ``report`` is in the error body), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "PublishIntegrationConfig",
            "publish_integration_config",
            {"integration_id": integration_id},
            {"integrationId": integration_id, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/config",
                json=_integration_config_body(
                    mapping,
                    rules,
                    corpus,
                    floor,
                    display_name,
                    external_shape,
                    external_mapping,
                    inbound,
                ),
            )
        _raise_for_status(response)
        return response.json()["data"]

    def get_integration_config(self, integration_id: str) -> dict[str, Any]:
        """Fetch the active config for the caller's scope (TENANT ∪ GLOBAL).

        The full projection — including the editable surface (mapping/rules/corpus)
        — so a pulled config can be edited and republished (round-trip).

        Raises:
            PegasusApiError: On 404 (no published config for this scope).
        """
        return self._get_json(f"/api/v1/integrations/{integration_id}/config")["data"]

    def list_integrations(self) -> list[dict[str, Any]]:
        """List the integration ids configured for the caller's tenant.

        Each entry is ``{id, name, description, published, version, visibility}`` —
        so an integration author can discover which ids exist (and whether each has
        a published config) without already knowing them. Requires
        ``ReadIntegrationConfig`` (the ``integration_publisher`` role).
        """
        return self._get_json("/api/v1/integrations/configs")["data"]

    def fork_integration_config(self, integration_id: str) -> dict[str, Any]:
        """Fork the platform GLOBAL config for ``integration_id`` into the caller's scope.

        Copies the active GLOBAL config into a new TENANT-scoped, unpublished config
        the caller owns (with fork provenance) — the integration-config analog of
        :meth:`fork_workflow`, so a tenant can customize a platform default. Requires
        ``PublishIntegrationConfig`` (the ``integration_publisher`` role).

        Returns:
            The created TENANT config (full projection).

        Raises:
            PegasusApiError: 404 (no GLOBAL config to fork), 409/422 (the caller is
                the platform tenant that already owns the GLOBAL config), or non-2xx.
        """
        captured = self._capture_mutation(
            "PublishIntegrationConfig",
            "fork_integration_config",
            {"integration_id": integration_id},
            {"integrationId": integration_id, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(f"/api/v1/integrations/{integration_id}/config/fork")
        _raise_for_status(response)
        return response.json()["data"]

    def get_mapping_schema(self) -> dict[str, Any]:
        """The JSON Schema for the ``mapping.json`` DSL (public, live introspection).

        Fetch it to validate a mapping's shape before publishing, rather than
        relying on static docs. Backed by ``GET /api/v1/integrations/mapping-schema``.
        """
        return self._get_json("/api/v1/integrations/mapping-schema")

    def get_inbound_schema(self) -> dict[str, Any]:
        """The JSON Schema for the ingress ``inbound`` block (public, live introspection).

        Covers ``{eventType, dedupKeyPath, validation (requiredPaths,
        nonEmptyArrayPaths, oneOf), ackTemplate}`` — fetch it to validate an
        ``inbound.json`` before publishing. Backed by
        ``GET /api/v1/integrations/inbound-schema``.
        """
        return self._get_json("/api/v1/integrations/inbound-schema")

    def list_floors(self) -> list[dict[str, Any]]:
        """List the built-in integration floors — the per-type contracts a config builds on.

        A floor is partner-neutral and reused across partners of its type. Each entry
        is the same detail :meth:`get_floor` returns. Use this to discover which floor
        fits your data before authoring a config. Public read.
        """
        return self._get_json("/api/v1/integrations/floors")["data"]

    def get_floor(self, floor_id: str) -> dict[str, Any]:
        """A floor's machine-readable authoring contract (sdk-feedback 0024).

        Returns ``{floor, canonicalFields, factCatalog, inputFieldRoots?,
        defaultAction, projection?}``:

        - ``canonicalFields`` — the ONLY legal mapping *targets* (a ``mapping.json``
          may only write these paths; array-element paths are marked ``[]``).
        - ``factCatalog`` — the ONLY legal rule *facts* (name → type). A rule's
          ``fact`` must be one of these; its ``field`` one of ``canonicalFields``.
        - ``inputFieldRoots`` — the legal mapping *source* roots a ``$from`` may
          READ (present only when the floor declares them). A bare entry
          (``"Survey"``) opens a whole native root; a dotted entry
          (``"UnusedFields.survey_received"``) opens ONLY that curated sub-path,
          so a ``$from`` reading an un-listed sibling under an otherwise-closed
          root is rejected by the gate. Read these to know which native fields you
          may map from without hitting the gate blind (sdk-feedback 0028).

        Author ``mapping.json`` / ``rules.json`` against these so the publish gate
        accepts them — this is how an agent writes a valid config without platform
        source. Raises ``PegasusApiError`` (404) on an unknown floor.
        """
        return self._get_json(f"/api/v1/integrations/floors/{floor_id}")["data"]

    def list_integration_config_versions(self, integration_id: str) -> list[dict[str, Any]]:
        """List the config version history for the caller's scope, newest first.

        Returns:
            A list of compact summaries (no mapping/rules/corpus blobs):
            ``{id, integrationId, version, visibility, status, publishedBy, createdAt}``.
        """
        return self._get_json(
            f"/api/v1/integrations/{integration_id}/config/versions"
        )["data"]

    def rollback_integration_config(
        self,
        integration_id: str,
        version: int,
    ) -> dict[str, Any]:
        """Re-publish a prior version as a new version.

        The server re-runs the gate against the rolled-back config: one that
        passed when first published may no longer pass if the canonical contract
        has since changed in code, in which case it returns 422. Flag-gated.

        Args:
            integration_id: The integration to roll back.
            version: The existing version number to re-publish.

        Returns:
            The newly-created config row (a fresh version number).

        Raises:
            PegasusApiError: On 403 (feature disabled), 404 (version not found),
                422 (gate failed), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "PublishIntegrationConfig",
            "rollback_integration_config",
            {"integration_id": integration_id, "version": version},
            {"integrationId": integration_id, "version": version, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/config/rollback/{version}",
            )
        _raise_for_status(response)
        return response.json()["data"]

    # -- workflow secrets & configuration -----------------------------------
    #
    # Per-tenant key/value store (apps/api/src/handlers/workflow-secrets-configs.ts).
    # Two namespaces:
    #   - SECRETS: write-once, KMS-encrypted at rest, the plaintext is only ever
    #     returned to the workflow runtime. Manage with a token holding
    #     ``ManageWorkflowSecrets`` (workflow_developer / tenant_admin); read at
    #     runtime with ``ReadWorkflowSecret``.
    #   - CONFIG: plain, editable key/value. Manage with ``ManageWorkflowConfigs``;
    #     read at runtime with ``ReadWorkflowConfig``.
    #
    # A workflow declares the read actions it needs in its manifest
    # ``required_actions`` (e.g. ``["ReadWorkflowSecret", "ReadWorkflowConfig"]``)
    # and reads values inside an activity via :meth:`get_secret` / :meth:`get_config`.

    _SECRETS_CONFIG_BASE = "/api/v1/workflow-secrets-configs"

    def get_secret(self, name: str, *, group: str = "global") -> str:
        """Read a workflow secret value by name (runtime use).

        For use inside workflow activities only (never in workflow code — httpx
        is sandboxed there). Requires the workflow's manifest to declare
        ``required_actions = ["ReadWorkflowSecret"]``.

        Args:
            name: The secret key.
            group: The logical group the secret lives in (default ``"global"``).

        Returns:
            The decrypted secret plaintext.

        Raises:
            PegasusApiError: On 403 (token/manifest lacks ``ReadWorkflowSecret``),
                404 (no such secret in that group), or any other non-2xx.
        """
        return self._get_json(
            f"{self._SECRETS_CONFIG_BASE}/runtime/secrets/{name}", group=group
        )["data"]["value"]

    def get_config(self, name: str, *, group: str = "global") -> str:
        """Read a workflow config value by name (runtime use).

        For use inside workflow activities only. Requires the workflow's manifest
        to declare ``required_actions = ["ReadWorkflowConfig"]``.

        Args:
            name: The config key.
            group: The logical group the config lives in (default ``"global"``).

        Returns:
            The config value as a string.

        Raises:
            PegasusApiError: On 403 (token/manifest lacks ``ReadWorkflowConfig``),
                404 (no such config entry in that group), or any other non-2xx.
        """
        return self._get_json(
            f"{self._SECRETS_CONFIG_BASE}/runtime/configs/{name}", group=group
        )["data"]["value"]

    def list_secrets(self, *, group: str | None = None) -> list[dict[str, Any]]:
        """List secret metadata (never any value). Requires ``ManageWorkflowSecrets``.

        Args:
            group: List only this group; omit to list every group.

        Returns:
            A list of ``{id, group, key, description, isSecret, createdByUserId,
            createdAt, updatedAt}`` — no secret values are ever returned.
        """
        params = {} if group is None else {"group": group}
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/secrets", **params)["data"]

    def set_secret(
        self, key: str, value: str, *, group: str = "global", description: str | None = None
    ) -> dict[str, Any]:
        """Publish a secret (write-once). Requires ``ManageWorkflowSecrets``.

        Secrets are write-once: to rotate a value, :meth:`delete_secret` then
        ``set_secret`` again. The returned row carries metadata only — the value
        is never echoed back.

        Prefer organizing related entries under a ``group`` (e.g. ``"billing"``,
        ``"notifications"``) rather than dumping everything in ``"global"`` — the
        same key may exist in different groups.

        Args:
            key: Env-var-style key (``[a-zA-Z_][a-zA-Z0-9_]{0,127}``).
            value: The secret plaintext (stored KMS-encrypted at rest).
            group: Logical group to place the secret in (default ``"global"``).
            description: Optional human note.

        Returns:
            The created secret's metadata.

        Raises:
            PegasusApiError: On 400 (bad key/group), 403 (lacks
                ``ManageWorkflowSecrets``), 409 (a secret with that key already
                exists in the group), or any other non-2xx.
        """
        payload: dict[str, Any] = {"key": key, "value": value, "group": group}
        if description is not None:
            payload["description"] = description
        captured = self._capture_mutation(
            "ManageWorkflowSecrets",
            "set_secret",
            {"key": key, "group": group},
            {"key": key, "group": group, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.post(f"{self._SECRETS_CONFIG_BASE}/secrets", json=payload)
        _raise_for_status(response)
        return response.json()["data"]

    def delete_secret(self, key: str, *, group: str = "global") -> None:
        """Delete a secret by key. Requires ``ManageWorkflowSecrets``.

        Args:
            key: The secret key.
            group: The group the secret lives in (default ``"global"``).

        Raises:
            PegasusApiError: On 403, 404 (no such secret in that group), or any
                other non-2xx.
        """
        if self._capture_mutation(
            "ManageWorkflowSecrets", "delete_secret", {"key": key, "group": group}, None
        ) is not _NOT_CAPTURED:
            return
        with self._client() as client:
            response = client.delete(
                f"{self._SECRETS_CONFIG_BASE}/secrets/{key}", params={"group": group}
            )
        _raise_for_status(response)

    def list_configs(self, *, group: str | None = None) -> list[dict[str, Any]]:
        """List config entries with their plain values. Requires ``ManageWorkflowConfigs``.

        Args:
            group: List only this group; omit to list every group.

        Returns:
            A list of ``{id, group, key, value, description, isSecret,
            createdByUserId, createdAt, updatedAt}``.
        """
        params = {} if group is None else {"group": group}
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/configs", **params)["data"]

    def set_config(
        self, key: str, value: str, *, group: str = "global", description: str | None = None
    ) -> dict[str, Any]:
        """Publish a config value (idempotent upsert). Requires ``ManageWorkflowConfigs``.

        Unlike secrets, config is freely editable — calling ``set_config`` again
        with the same key (and group) replaces the value.

        Prefer organizing related entries under a ``group`` (e.g. ``"billing"``,
        ``"notifications"``) rather than dumping everything in ``"global"`` — the
        same key may exist in different groups.

        Args:
            key: Env-var-style key (``[a-zA-Z_][a-zA-Z0-9_]{0,127}``).
            value: The config value.
            group: Logical group to place the config in (default ``"global"``).
            description: Optional human note.

        Returns:
            The created/updated config entry (including its value).

        Raises:
            PegasusApiError: On 400 (bad key/group), 403 (lacks
                ``ManageWorkflowConfigs``), or any other non-2xx.
        """
        payload: dict[str, Any] = {"value": value, "group": group}
        if description is not None:
            payload["description"] = description
        captured = self._capture_mutation(
            "ManageWorkflowConfigs",
            "set_config",
            {"key": key, "value": value, "group": group},
            {"key": key, "value": value, "group": group, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.put(
                f"{self._SECRETS_CONFIG_BASE}/configs/{key}", json=payload
            )
        _raise_for_status(response)
        return response.json()["data"]

    def delete_config(self, key: str, *, group: str = "global") -> None:
        """Delete a config entry by key. Requires ``ManageWorkflowConfigs``.

        Args:
            key: The config key.
            group: The group the config lives in (default ``"global"``).

        Raises:
            PegasusApiError: On 403, 404 (no such entry in that group), or any
                other non-2xx.
        """
        if self._capture_mutation(
            "ManageWorkflowConfigs", "delete_config", {"key": key, "group": group}, None
        ) is not _NOT_CAPTURED:
            return
        with self._client() as client:
            response = client.delete(
                f"{self._SECRETS_CONFIG_BASE}/configs/{key}", params={"group": group}
            )
        _raise_for_status(response)

    # -- integration projections (runtime use) -----------------------------
    #
    # A per-record cache of an external system's last-known state, keyed by
    # (integration, entity_type, key) within the tenant. A workflow mirrors the
    # external system into this cache; the Pegasus integration validator reads
    # the matching ``state`` back as the ``prior`` input when pre-validating an
    # update. For use inside workflow activities only (httpx is sandboxed in
    # workflow code). Requires the workflow manifest to declare
    # ``required_actions = ["ReadIntegrationProjection", "WriteIntegrationProjection"]``.

    _PROJECTIONS_BASE = "/api/v1/integration-projections"

    def get_projection(
        self, integration: str, entity_type: str, key: str
    ) -> dict[str, Any] | None:
        """Read one cached projection record. Requires ``ReadIntegrationProjection``.

        Args:
            integration: Integration slug, e.g. ``"demo_partner"``.
            entity_type: Logical record type, e.g. ``"order"``.
            key: External record key, e.g. the service order number.

        Returns:
            The projection row ``{integrationId, entityType, entityKey, state,
            version, updatedByUserId, createdAt, updatedAt}``, or ``None`` if no
            record is cached for that key.

        Raises:
            PegasusApiError: On 403 (token/manifest lacks the action) or any
                other non-2xx besides 404.
        """
        with self._client() as client:
            response = client.get(
                f"{self._PROJECTIONS_BASE}/runtime/{integration}/{entity_type}/{key}"
            )
        if response.status_code == 404:
            return None
        _raise_for_status(response)
        return response.json()["data"]

    def list_projections(
        self, integration: str, entity_type: str
    ) -> list[dict[str, Any]]:
        """List all cached projection records for one entity type.

        Requires ``ReadIntegrationProjection``.

        Args:
            integration: Integration slug, e.g. ``"demo_partner"``.
            entity_type: Logical record type, e.g. ``"order"``.

        Returns:
            A list of projection rows (possibly empty).
        """
        return self._get_json(
            f"{self._PROJECTIONS_BASE}/runtime/{integration}/{entity_type}"
        )["data"]

    def put_projection(
        self, integration: str, entity_type: str, key: str, state: Any
    ) -> dict[str, Any]:
        """Upsert the cached state for one record. Requires ``WriteIntegrationProjection``.

        Idempotent: calling again with the same key replaces the cached state and
        bumps the row's ``version``.

        Args:
            integration: Integration slug, e.g. ``"demo_partner"``.
            entity_type: Logical record type, e.g. ``"order"``.
            key: External record key, e.g. the service order number.
            state: The record's last-known state, in the integration's NATIVE
                payload shape (the same shape the validator accepts as ``order``/
                ``prior``). Must be JSON-serializable and ≤ 256 KB serialized.

        Returns:
            The created/updated projection row (including its ``state`` and
            ``version``).

        Raises:
            PegasusApiError: On 400 (bad key/state), 403 (lacks the action),
                413 (state too large), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "WriteIntegrationProjection",
            "put_projection",
            {"integration": integration, "entity_type": entity_type, "key": key, "state": state},
            {"state": state, "version": 1, "dryRun": True},
        )
        if captured is not _NOT_CAPTURED:
            return captured
        with self._client() as client:
            response = client.put(
                f"{self._PROJECTIONS_BASE}/runtime/{integration}/{entity_type}/{key}",
                json={"state": state},
            )
        _raise_for_status(response)
        return response.json()["data"]

    def delete_projection(self, integration: str, entity_type: str, key: str) -> None:
        """Delete one cached projection record. Requires ``WriteIntegrationProjection``.

        Raises:
            PegasusApiError: On 403, 404 (no such record), or any other non-2xx.
        """
        captured = self._capture_mutation(
            "WriteIntegrationProjection",
            "delete_projection",
            {"integration": integration, "entity_type": entity_type, "key": key},
            None,
        )
        if captured is not _NOT_CAPTURED:
            return
        with self._client() as client:
            response = client.delete(
                f"{self._PROJECTIONS_BASE}/runtime/{integration}/{entity_type}/{key}"
            )
        _raise_for_status(response)
