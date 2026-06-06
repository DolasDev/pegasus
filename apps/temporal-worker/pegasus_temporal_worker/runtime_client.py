"""Per-activity runtime-token broker client.

Why this exists (see the Phase 2 plan, "Runtime token delivery"):

* Each curated workflow has its own ``vnd_`` Pegasus API key, scoped to
  one tenant and the ``workflow_runtime`` Cedar role. The plaintext is
  KMS-encrypted at finalize and stored as ``Workflow.runtimeTokenCiphertext``;
  the plaintext itself never exists at rest.
* Putting the plaintext into Temporal workflow input would persist it in
  Temporal's history (which is durable and outlives the run) — a violation
  of "secrets never live longer than they have to".
* So instead, **at activity start** the worker hits a worker-only API
  endpoint that decrypts the ciphertext and returns the plaintext over
  TLS, scoped to one ``executionId``. The token lives in worker memory
  only, for the duration of that activity invocation.

This module is the thin client for that broker call. Unit 6 implements
the server endpoint; until then, the call 404s — see
:class:`BrokerEndpointMissing` and the "pre-Unit-6" handling.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    # PegasusClient is part of the SDK package. Imported lazily to avoid
    # eagerly pulling httpx into any module that just wants the
    # exception types from this file.
    from pegasus_workflows import PegasusClient


__all__ = [
    "BrokerEndpointMissing",
    "BrokerAuthError",
    "BrokerError",
    "RuntimeTokenClient",
]


class BrokerError(RuntimeError):
    """Base class for any broker call failure."""


class BrokerEndpointMissing(BrokerError):
    """Raised when the broker endpoint returns 404.

    Expected pre-Unit-6 (the endpoint doesn't exist yet). The worker
    surfaces this as an activity failure so Temporal's retry policy can
    decide whether to keep trying — usually we want a short retry loop
    rather than an immediate fail so the worker can pick up the endpoint
    as soon as Unit 6 deploys.
    """


class BrokerAuthError(BrokerError):
    """Raised on 401/403 from the broker — broker secret is wrong or missing."""


class RuntimeTokenClient:
    """Fetches per-execution runtime tokens from the internal broker.

    One instance per worker process. Construct with the worker's static
    config; call :meth:`build_pegasus_client` once per activity invocation
    (NOT once per worker startup — that would cache a token across
    activities, which is exactly what the design prohibits).

    The returned :class:`pegasus_workflows.PegasusClient` carries the
    plaintext in memory. The activity is expected to discard it as soon as
    its work is done; an idiomatic pattern is:

    .. code-block:: python

        client = token_client.build_pegasus_client(execution_id)
        try:
            ... # do work
        finally:
            del client
    """

    BROKER_PATH = "/api/v1/internal/workflow-runtime-token"

    def __init__(
        self,
        *,
        api_base_url: str,
        broker_secret: str,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_base_url:
            raise ValueError("api_base_url is required")
        # broker_secret may be empty in unit tests that exercise the
        # missing-secret branch — validated at call time, not here, so
        # the test suite can construct a client and assert the failure.
        self._api_base_url = api_base_url.rstrip("/")
        self._broker_secret = broker_secret
        self._timeout = timeout
        self._transport = transport

    # -- internals ----------------------------------------------------------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self._api_base_url,
            timeout=self._timeout,
            transport=self._transport,
        )

    # -- public ------------------------------------------------------------

    def fetch_token(self, execution_id: str) -> str:
        """Fetch the plaintext runtime token for ``execution_id``.

        Raises:
            ValueError: if the broker secret is empty (fail-fast: a worker
                with no broker secret cannot call the API at all).
            BrokerEndpointMissing: on 404 — expected pre-Unit-6.
            BrokerAuthError: on 401 / 403.
            BrokerError: on any other non-2xx, or non-string token in the
                response body.
        """
        if not self._broker_secret:
            raise ValueError(
                "WORKFLOW_BROKER_SECRET is empty — the worker cannot call "
                "the internal broker without it"
            )
        if not execution_id:
            raise ValueError("execution_id is required")

        with self._client() as client:
            response = client.post(
                self.BROKER_PATH,
                headers={"X-Workflow-Broker-Secret": self._broker_secret},
                json={"executionId": execution_id},
            )

        if response.status_code == 404:
            # Pre-Unit-6 expected state. The endpoint isn't mounted yet.
            raise BrokerEndpointMissing(
                f"broker endpoint {self.BROKER_PATH} returned 404 — "
                "expected pre-Unit-6"
            )
        if response.status_code in (401, 403):
            raise BrokerAuthError(
                f"broker auth rejected (HTTP {response.status_code})"
            )
        if not response.is_success:
            raise BrokerError(
                f"broker call failed: HTTP {response.status_code}"
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise BrokerError("broker response was not JSON") from exc

        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise BrokerError("broker response missing 'token' string field")
        return token

    def build_pegasus_client(self, execution_id: str) -> PegasusClient:
        """Fetch a token and wrap it in a :class:`PegasusClient`.

        Typically called once at the top of an activity that needs to make
        Pegasus API calls. The token is held in memory by the client; the
        caller should ensure the client (and therefore the token) goes out
        of scope before the activity returns.

        Lazy SDK import avoids pulling ``pegasus_workflows.api`` into the
        Temporal workflow sandbox graph (the SDK's lazy-export pattern is
        for exactly this reason).
        """
        from pegasus_workflows import PegasusClient  # noqa: WPS433 — see docstring

        token = self.fetch_token(execution_id)
        return PegasusClient(base_url=self._api_base_url, token=token)
