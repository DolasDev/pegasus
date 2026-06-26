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

from dataclasses import dataclass
from typing import Any

import httpx

__all__ = ["PegasusApiError", "PegasusClient", "MAX_ARTIFACT_BYTES", "ARTIFACT_MIME_TYPE"]

#: Maximum artifact size accepted by ``POST /upload-url`` (mirrors the server).
MAX_ARTIFACT_BYTES = 25 * 1024 * 1024

#: Content-Type the presigned PUT is signed for. Must match exactly.
ARTIFACT_MIME_TYPE = "application/zip"


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
            integration_id: The integration to gate against (e.g. ``"weichert"``).
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
