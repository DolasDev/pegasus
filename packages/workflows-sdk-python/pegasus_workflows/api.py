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
