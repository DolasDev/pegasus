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
    ) -> None:
        if not token:
            raise ValueError("a Pegasus API token is required")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        # Optional transport override — used by tests to mock HTTP traffic.
        self._transport = transport

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
        # base_url and token are non-empty here (else they'd be in `missing`).
        return cls(base_url=base_url, token=token, timeout=timeout)  # type: ignore[arg-type]

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

        Returns:
            The freshly-created ``WorkflowExecutionResponse`` object in its
            initial state (``QUEUED`` or ``RUNNING`` depending on whether
            the Temporal start round-trip has completed).

        Raises:
            PegasusApiError: On 400 (not in allowlist), 404, 502 (Temporal
                start failed), or any other non-2xx.
        """
        payload = {"input": input or {}}
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

    def list_workflows(self) -> list[dict[str, Any]]:
        """List every workflow visible to the caller's tenant (∪ GLOBAL)."""
        return self._get_json("/api/v1/workflows")["data"]

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        """Fetch a single workflow by id."""
        return self._get_json(f"/api/v1/workflows/{workflow_id}")["data"]

    def get_download_url(self, workflow_id: str) -> dict[str, Any]:
        """Get a presigned GET URL for a workflow's source zip.

        Returns:
            ``{downloadUrl, expiresInSeconds}``.
        """
        return self._get_json(f"/api/v1/workflows/{workflow_id}/download-url")["data"]

    def download_artifact(self, workflow_id: str) -> bytes:
        """Download a workflow's source zip bytes."""
        download_url = self.get_download_url(workflow_id)["downloadUrl"]
        with self._bare_client() as client:
            response = client.get(download_url)
        _raise_for_status(response)
        return response.content

    # -- domain read helpers (for use inside activities) -------------------

    def list_customers(self, **params: Any) -> Any:
        """Read the customers list. For use inside workflow activities."""
        return self._get_json("/api/v1/customers", **params)

    def list_quotes(self, **params: Any) -> Any:
        """Read the quotes list. For use inside workflow activities."""
        return self._get_json("/api/v1/quotes", **params)

    def list_moves(self, **params: Any) -> Any:
        """Read the moves list. For use inside workflow activities."""
        return self._get_json("/api/v1/moves", **params)

    def list_inventory(self, **params: Any) -> Any:
        """Read inventory rooms/items. For use inside workflow activities."""
        return self._get_json("/api/v1/inventory", **params)

    def list_invoices(self, **params: Any) -> Any:
        """Read the invoices list. For use inside workflow activities."""
        return self._get_json("/api/v1/invoices", **params)

    def list_events(self, **params: Any) -> Any:
        """Read the events stream. For use inside workflow activities."""
        return self._get_json("/api/v1/events", **params)

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
        with self._client() as client:
            response = client.post("/api/v1/sms/send", json={"to": to, "body": body})
        _raise_for_status(response)
        return response.json()

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

    def get_order(self, order_id: str) -> dict[str, Any]:
        """Fetch a single pegII order by id. Requires ``ReadOrder``.

        For use inside workflow activities — the way to re-fetch authoritative
        order state from an ``order.*`` event envelope's pointer payload.

        Args:
            order_id: The order id.

        Returns:
            The order row.

        Raises:
            PegasusApiError: On 403 (manifest lacks ``ReadOrder``), 404 (no such
                order), or any other non-2xx.
        """
        return self._get_json(f"/api/v1/pegii/orders/{order_id}")["data"]

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
        with self._client() as client:
            response = client.post("/api/v1/pegii/tasks/close", json=payload)
        _raise_for_status(response)
        return response.json()["data"]

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

        Returns:
            The ``GateReport``: ``{ok, problems, corpus: {total, passed, failures}}``.

        Raises:
            PegasusApiError: On 404 (unknown integration) or any other non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/config/validate",
                json={"mapping": mapping, "rules": rules, "corpus": corpus},
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

        Returns:
            The created config row: ``{id, integrationId, version, visibility,
            status, mapping, rules, corpus, publishedBy, createdAt}``.

        Raises:
            PegasusApiError: On 403 (feature disabled), 404, 422 (gate failed —
                the ``report`` is in the error body), or any other non-2xx.
        """
        with self._client() as client:
            response = client.post(
                f"/api/v1/integrations/{integration_id}/config",
                json={"mapping": mapping, "rules": rules, "corpus": corpus},
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

    def get_secret(self, name: str) -> str:
        """Read a workflow secret value by name (runtime use).

        For use inside workflow activities only (never in workflow code — httpx
        is sandboxed there). Requires the workflow's manifest to declare
        ``required_actions = ["ReadWorkflowSecret"]``.

        Args:
            name: The secret key.

        Returns:
            The decrypted secret plaintext.

        Raises:
            PegasusApiError: On 403 (token/manifest lacks ``ReadWorkflowSecret``),
                404 (no such secret), or any other non-2xx.
        """
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/runtime/secrets/{name}")[
            "data"
        ]["value"]

    def get_config(self, name: str) -> str:
        """Read a workflow config value by name (runtime use).

        For use inside workflow activities only. Requires the workflow's manifest
        to declare ``required_actions = ["ReadWorkflowConfig"]``.

        Args:
            name: The config key.

        Returns:
            The config value as a string.

        Raises:
            PegasusApiError: On 403 (token/manifest lacks ``ReadWorkflowConfig``),
                404 (no such config entry), or any other non-2xx.
        """
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/runtime/configs/{name}")[
            "data"
        ]["value"]

    def list_secrets(self) -> list[dict[str, Any]]:
        """List secret metadata (never any value). Requires ``ManageWorkflowSecrets``.

        Returns:
            A list of ``{id, key, description, isSecret, createdByUserId,
            createdAt, updatedAt}`` — no secret values are ever returned.
        """
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/secrets")["data"]

    def set_secret(
        self, key: str, value: str, *, description: str | None = None
    ) -> dict[str, Any]:
        """Publish a secret (write-once). Requires ``ManageWorkflowSecrets``.

        Secrets are write-once: to rotate a value, :meth:`delete_secret` then
        ``set_secret`` again. The returned row carries metadata only — the value
        is never echoed back.

        Args:
            key: Env-var-style key (``[a-zA-Z_][a-zA-Z0-9_]{0,127}``).
            value: The secret plaintext (stored KMS-encrypted at rest).
            description: Optional human note.

        Returns:
            The created secret's metadata.

        Raises:
            PegasusApiError: On 400 (bad key), 403 (lacks ``ManageWorkflowSecrets``),
                409 (a secret with that key already exists), or any other non-2xx.
        """
        payload: dict[str, Any] = {"key": key, "value": value}
        if description is not None:
            payload["description"] = description
        with self._client() as client:
            response = client.post(f"{self._SECRETS_CONFIG_BASE}/secrets", json=payload)
        _raise_for_status(response)
        return response.json()["data"]

    def delete_secret(self, key: str) -> None:
        """Delete a secret by key. Requires ``ManageWorkflowSecrets``.

        Raises:
            PegasusApiError: On 403, 404 (no such secret), or any other non-2xx.
        """
        with self._client() as client:
            response = client.delete(f"{self._SECRETS_CONFIG_BASE}/secrets/{key}")
        _raise_for_status(response)

    def list_configs(self) -> list[dict[str, Any]]:
        """List config entries with their plain values. Requires ``ManageWorkflowConfigs``.

        Returns:
            A list of ``{id, key, value, description, isSecret, createdByUserId,
            createdAt, updatedAt}``.
        """
        return self._get_json(f"{self._SECRETS_CONFIG_BASE}/configs")["data"]

    def set_config(
        self, key: str, value: str, *, description: str | None = None
    ) -> dict[str, Any]:
        """Publish a config value (idempotent upsert). Requires ``ManageWorkflowConfigs``.

        Unlike secrets, config is freely editable — calling ``set_config`` again
        with the same key replaces the value.

        Args:
            key: Env-var-style key (``[a-zA-Z_][a-zA-Z0-9_]{0,127}``).
            value: The config value.
            description: Optional human note.

        Returns:
            The created/updated config entry (including its value).

        Raises:
            PegasusApiError: On 400 (bad key), 403 (lacks ``ManageWorkflowConfigs``),
                or any other non-2xx.
        """
        payload: dict[str, Any] = {"value": value}
        if description is not None:
            payload["description"] = description
        with self._client() as client:
            response = client.put(
                f"{self._SECRETS_CONFIG_BASE}/configs/{key}", json=payload
            )
        _raise_for_status(response)
        return response.json()["data"]

    def delete_config(self, key: str) -> None:
        """Delete a config entry by key. Requires ``ManageWorkflowConfigs``.

        Raises:
            PegasusApiError: On 403, 404 (no such entry), or any other non-2xx.
        """
        with self._client() as client:
            response = client.delete(f"{self._SECRETS_CONFIG_BASE}/configs/{key}")
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
        with self._client() as client:
            response = client.delete(
                f"{self._PROJECTIONS_BASE}/runtime/{integration}/{entity_type}/{key}"
            )
        _raise_for_status(response)
