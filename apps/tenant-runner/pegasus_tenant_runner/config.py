"""Env-var configuration for one tenant-runner process.

Each var corresponds 1:1 with what the Unit 9 dispatcher injects via ECS
``RunTask`` container overrides (the launch-time env contract). Renaming a
key on one side without the other is a deploy-breaks-silently scenario, so
the canonical list lives in both places by design — mirror of the pattern
established by ``apps/temporal-worker/pegasus_temporal_worker/config.py``.

Required:
    TENANT_ID                The tenant this runner serves (lowercase UUID).
    ENV_NAME                 staging / prod / dev — log tagging + queue name.
    TEMPORAL_NAMESPACE       Temporal Cloud namespace (``default`` locally).
    TEMPORAL_ADDRESS         Temporal gRPC host:port.
    PEGASUS_API_BASE_URL     Base URL for broker calls.
    WORKFLOW_BROKER_TOKEN    Per-tenant ``wbk_`` broker token (Unit 7). The
                             runner NEVER receives the shared broker secret.

Optional:
    TEMPORAL_CLOUD_API_KEY            Empty → local dev server (no TLS/auth).
    RUNNER_IDLE_TIMEOUT_SECONDS       Idle window before self-exit (600).
    RUNNER_EXECUTION_TIMEOUT_SECONDS  Subprocess wall-clock budget (900).
    RUNNER_MAX_UNPACKED_BYTES         Per-workflow install-size guard (100 MiB).
    RUNNER_MAX_OUTPUT_BYTES           stdout/stderr tail kept per run (256 KiB).
    RUNNER_MAX_RESULT_BYTES           Max result-file size accepted (1 MiB).
    RUNNER_WORK_DIR                   Scratch root (/home/pegasus/work).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

#: Per-tenant broker token shape (mirrors apps/api/src/lib/tenant-broker-credential.ts).
_BROKER_TOKEN_REGEX = re.compile(
    r"^wbk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[0-9a-f]{48}$"
)

_TENANT_ID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


class ConfigError(RuntimeError):
    """Raised at startup when required env vars are missing or invalid."""


@dataclass(frozen=True)
class RunnerConfig:
    """Resolved configuration for one tenant-runner process."""

    tenant_id: str
    env_name: str
    temporal_namespace: str
    temporal_address: str
    pegasus_api_base_url: str
    workflow_broker_token: str
    temporal_cloud_api_key: str
    idle_timeout_seconds: int
    execution_timeout_seconds: int
    max_unpacked_bytes: int
    max_output_bytes: int
    max_result_bytes: int
    work_dir: str

    @property
    def task_queue(self) -> str:
        """Per-tenant task queue this runner polls (Phase 3 contract)."""
        return f"pegasus-tenant-{self.tenant_id}-{self.env_name}"

    @property
    def uses_temporal_cloud(self) -> bool:
        """True when ``temporal_cloud_api_key`` is set (TLS + auth mode)."""
        return bool(self.temporal_cloud_api_key)


def _require(name: str, env: dict[str, str]) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ConfigError(
            f"required env var {name!r} is not set — see "
            "apps/tenant-runner/pegasus_tenant_runner/config.py for the full list"
        )
    return value


def _positive_int(name: str, env: dict[str, str], default: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"env var {name!r} must be an integer, got {raw!r}") from exc
    if value <= 0:
        raise ConfigError(f"env var {name!r} must be > 0, got {value}")
    return value


def load_config(env: dict[str, str] | None = None) -> RunnerConfig:
    """Load and validate config from ``env`` (defaults to ``os.environ``).

    Beyond presence checks, two cross-wiring guards run at startup (both are
    cheap and both have bitten similar systems before):

    * the broker token must be a well-formed ``wbk_`` token — this catches an
      operator/dispatcher accidentally injecting the SHARED broker secret
      into a runner, which is exactly the credential the sandbox design
      forbids here;
    * the tenant id embedded in the token must equal ``TENANT_ID`` — a
      mismatch means the dispatcher launched this task with another tenant's
      credential, and the only safe response is to refuse to start.
    """
    source = env if env is not None else dict(os.environ)

    tenant_id = _require("TENANT_ID", source)
    if not _TENANT_ID_REGEX.fullmatch(tenant_id):
        raise ConfigError("TENANT_ID must be a lowercase UUID")

    token = _require("WORKFLOW_BROKER_TOKEN", source)
    match = _BROKER_TOKEN_REGEX.fullmatch(token)
    if not match:
        raise ConfigError(
            "WORKFLOW_BROKER_TOKEN is not a valid wbk_ per-tenant broker token — "
            "the tenant runner refuses to start with any other credential "
            "(the shared broker secret must never reach a runner)"
        )
    if match.group(1) != tenant_id:
        raise ConfigError(
            "WORKFLOW_BROKER_TOKEN belongs to a different tenant than TENANT_ID — "
            "refusing to start with a cross-wired credential"
        )

    return RunnerConfig(
        tenant_id=tenant_id,
        env_name=_require("ENV_NAME", source),
        temporal_namespace=_require("TEMPORAL_NAMESPACE", source),
        temporal_address=_require("TEMPORAL_ADDRESS", source),
        pegasus_api_base_url=_require("PEGASUS_API_BASE_URL", source),
        workflow_broker_token=token,
        # Optional — empty for local dev (no TLS, no auth).
        temporal_cloud_api_key=source.get("TEMPORAL_CLOUD_API_KEY", "").strip(),
        idle_timeout_seconds=_positive_int("RUNNER_IDLE_TIMEOUT_SECONDS", source, 600),
        execution_timeout_seconds=_positive_int("RUNNER_EXECUTION_TIMEOUT_SECONDS", source, 900),
        max_unpacked_bytes=_positive_int("RUNNER_MAX_UNPACKED_BYTES", source, 100 * 1024 * 1024),
        max_output_bytes=_positive_int("RUNNER_MAX_OUTPUT_BYTES", source, 256 * 1024),
        max_result_bytes=_positive_int("RUNNER_MAX_RESULT_BYTES", source, 1024 * 1024),
        work_dir=source.get("RUNNER_WORK_DIR", "").strip() or "/home/pegasus/work",
    )
