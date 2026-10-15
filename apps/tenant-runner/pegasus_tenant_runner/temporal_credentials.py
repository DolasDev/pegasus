"""Broker-mode Temporal credentials (Phase 3b.2): fetch at start, refresh while running.

A runner launched from the SCOPED task definition carries no Temporal secret.
It polls its tenant's own namespace with a namespace-scoped key the broker
serves (``GET /internal/temporal-credentials``), and that key rotates under
it: the provisioner swaps in a new key and the old one keeps working for a
24 h grace, then is deleted.

So the runner re-fetches every ``temporal_credentials_refresh_seconds``
(30 min by default, far inside the grace) and, when the key changed, swaps it
into the live client with ``client.api_key = …`` — the worker's polls share
the client's connection, so no reconnect and no drain. A refresh that fails is
logged and retried next interval: the current key is still good for up to a
day. If the worker is ever refused anyway, ``worker.run()`` raises, the
process exits non-zero, and the dispatcher's sweep relaunches a runner that
fetches a fresh key — that is the floor, this loop is the normal path.

The key never reaches a log line, and never reaches tenant code: the
subprocess environment is built from an allowlist (sandbox_env.py) and the
key lives only in this process's memory.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol

from .broker_client import TemporalCredentials, TemporalCredentialsUnavailable

log = logging.getLogger("pegasus_tenant_runner")

__all__ = ["run_credentials_refresh"]


class _KeyedClient(Protocol):
    """The slice of ``temporalio.client.Client`` the refresh needs."""

    api_key: str | None


class _CredentialSource(Protocol):
    def fetch_temporal_credentials(self) -> TemporalCredentials: ...


async def run_credentials_refresh(
    *,
    broker: _CredentialSource,
    client: _KeyedClient,
    current: TemporalCredentials,
    interval_seconds: float,
    shutdown_requested: asyncio.Event,
    log_context: dict[str, Any],
) -> None:
    """Refresh the client's key every ``interval_seconds`` until shutdown.

    A changed NAMESPACE is never followed: a scoped runner is bound to the
    namespace its worker polls, so it requests shutdown and lets the sweep
    relaunch it (which can only happen through a deprovision + reprovision).
    """
    while not shutdown_requested.is_set():
        try:
            await asyncio.wait_for(shutdown_requested.wait(), timeout=interval_seconds)
            return  # shutdown requested while waiting
        except TimeoutError:
            pass

        try:
            fresh = await asyncio.to_thread(broker.fetch_temporal_credentials)
        except TemporalCredentialsUnavailable:
            # The tenant was rolled back past REVERTING. Its open runs are
            # gone or finishing; keep the current key for them and let the
            # idle watchdog end this runner.
            log.warning("runner.temporal_credentials_withdrawn", extra=log_context)
            continue
        except Exception as exc:  # noqa: BLE001 — keep running on the current key
            log.warning(
                "runner.temporal_credentials_refresh_failed",
                extra={**log_context, "error_type": type(exc).__name__},
            )
            continue

        if fresh.namespace != current.namespace:
            log.error(
                "runner.temporal_namespace_changed",
                extra={**log_context, "new_namespace": fresh.namespace},
            )
            shutdown_requested.set()
            return

        if fresh.api_key != current.api_key:
            client.api_key = fresh.api_key
            current = fresh
            log.info("runner.temporal_key_refreshed", extra=log_context)
