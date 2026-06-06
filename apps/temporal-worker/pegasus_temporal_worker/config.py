"""Env-var configuration for the worker process.

Each var corresponds 1:1 with what :class:`TemporalWorkerStack` injects via
``ecs.ContainerDefinition.environment`` / ``ecs.Secret.fromSecretsManager``
(see ``packages/infra/lib/stacks/temporal-worker-stack.ts``). Renaming a key
on one side without the other is a deploy-breaks-silently scenario, so the
canonical list lives in two places by design — the test asserts the names
match.

Local dev (``docker-compose.temporal.yml``) provides empty values for the
two secrets — ``TEMPORAL_CLOUD_API_KEY`` is unset against the local
single-binary Temporal server (no auth), and ``WORKFLOW_BROKER_SECRET`` is
``local-dev-only`` until the API broker exists.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    """Raised at startup when required env vars are missing or invalid."""


@dataclass(frozen=True)
class WorkerConfig:
    """Resolved configuration for one worker process.

    Attributes:
        temporal_namespace: Temporal Cloud namespace, e.g. ``pegasus-staging``
            or ``default`` for local dev.
        temporal_address: Temporal gRPC ``host:port``.
        temporal_task_queue: Task queue the worker polls.
        pegasus_api_base_url: Base URL the worker calls for the broker token
            fetch and the execution status PATCH.
        env_name: ``staging`` / ``prod`` / ``dev`` — used for log tagging.
        temporal_cloud_api_key: JWT API key for Temporal Cloud authentication.
            Empty string means "no auth" (local-dev Temporal server only).
        workflow_broker_secret: Shared secret in the ``X-Workflow-Broker-Secret``
            header that gates the internal API endpoints.
    """

    temporal_namespace: str
    temporal_address: str
    temporal_task_queue: str
    pegasus_api_base_url: str
    env_name: str
    temporal_cloud_api_key: str
    workflow_broker_secret: str

    @property
    def uses_temporal_cloud(self) -> bool:
        """True when ``temporal_cloud_api_key`` is set.

        ``Client.connect`` defaults to TLS when an api_key is supplied (see
        the temporalio docs note "tls=None enables TLS if api_key is set").
        When the key is empty we're talking to the local Temporal dev
        server, which has no TLS and no auth.
        """
        return bool(self.temporal_cloud_api_key)


def _require(name: str, env: dict[str, str]) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigError(
            f"required env var {name!r} is not set — see "
            "apps/temporal-worker/pegasus_temporal_worker/config.py for the full list"
        )
    return value


def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    """Load and validate config from ``env`` (defaults to ``os.environ``).

    The two secret-shaped vars (``TEMPORAL_CLOUD_API_KEY``,
    ``WORKFLOW_BROKER_SECRET``) are optional at this layer: local-dev
    passes empty strings, and the worker tolerates that — connect-to-Cloud
    is gated by :attr:`WorkerConfig.uses_temporal_cloud`, and broker calls
    fail loudly at the call site if the secret is empty.
    """
    source = env if env is not None else dict(os.environ)
    return WorkerConfig(
        temporal_namespace=_require("TEMPORAL_NAMESPACE", source),
        temporal_address=_require("TEMPORAL_ADDRESS", source),
        temporal_task_queue=_require("TEMPORAL_TASK_QUEUE", source),
        pegasus_api_base_url=_require("PEGASUS_API_BASE_URL", source),
        env_name=_require("ENV_NAME", source),
        # Optional — empty for local dev.
        temporal_cloud_api_key=source.get("TEMPORAL_CLOUD_API_KEY", "").strip(),
        workflow_broker_secret=source.get("WORKFLOW_BROKER_SECRET", "").strip(),
    )
