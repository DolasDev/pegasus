"""Runner entrypoint: discover → verify → prepare → poll → idle-exit.

Run as ``python -m pegasus_tenant_runner.runner`` (the Dockerfile
ENTRYPOINT). Mirrors the lifecycle of the stdlib worker's ``worker.py``
(SIGTERM-driven graceful drain, JSON logging) and adds the Unit 8 pieces:
broker-driven artifact discovery, per-workflow preparation with the sha256
TOCTOU gate, dynamic proxy registration, and the idle-exit watchdog.

Exit codes:
    0  clean shutdown (idle-exit or SIGTERM drain) — also the "nothing to
       run" case, which means the Unit 9 dispatcher launched a runner for a
       tenant with no executable workflows.
    1  fatal runtime error (including failed mandatory process hardening).
    2  configuration error.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
from pathlib import Path

from temporalio.client import Client
from temporalio.worker import Worker

from .artifacts import (
    ArtifactInstallError,
    ArtifactIntegrityError,
    PreparedWorkflow,
    prepare_workflow,
    select_latest,
)
from .broker_client import TenantBrokerClient
from .config import RunnerConfig, load_config
from .executor import TenantCodeExecutor
from .hardening import set_non_dumpable
from .idle import IdleTracker, run_idle_watchdog
from .logging_setup import configure_logging
from .proxy import build_registrations

log = logging.getLogger("pegasus_tenant_runner")


def _base_log_context(config: RunnerConfig) -> dict[str, str]:
    return {
        "env": config.env_name,
        "tenant_id": config.tenant_id,
        "namespace": config.temporal_namespace,
        "task_queue": config.task_queue,
    }


async def build_temporal_client(config: RunnerConfig) -> Client:
    """Connect to Temporal — Cloud (API key ⇒ TLS) or local dev (no auth)."""
    identity = f"pegasus-tenant-runner-{config.tenant_id}-{config.env_name}"
    if config.uses_temporal_cloud:
        return await Client.connect(
            config.temporal_address,
            namespace=config.temporal_namespace,
            api_key=config.temporal_cloud_api_key,
            identity=identity,
        )
    return await Client.connect(
        config.temporal_address,
        namespace=config.temporal_namespace,
        identity=identity,
    )


def prepare_all(
    config: RunnerConfig, broker: TenantBrokerClient
) -> list[PreparedWorkflow]:
    """Discover + prepare every executable workflow for this tenant.

    Per-workflow failure isolation: a sha mismatch (possible TOCTOU
    overwrite — the loudest log line this app has) or any install failure
    skips THAT workflow only.
    """
    base = {"tenant_id": config.tenant_id, "env": config.env_name}
    listed = broker.list_executable_workflows()
    log.info("runner.workflows_listed", extra={**base, "count": len(listed)})

    work_root = Path(config.work_dir)
    work_root.mkdir(parents=True, exist_ok=True)

    prepared: list[PreparedWorkflow] = []
    for wf in select_latest(listed):
        try:
            prepared.append(
                prepare_workflow(
                    work_root, wf, max_unpacked_bytes=config.max_unpacked_bytes
                )
            )
            log.info(
                "runner.workflow_prepared",
                extra={**base, "workflow_name": wf.name, "version": wf.version},
            )
        except ArtifactIntegrityError:
            # TOCTOU defense tripped: the S3 bytes do NOT match the digest
            # recorded when the artifact was validated. Treat as hostile.
            log.exception(
                "runner.artifact_sha_mismatch_SECURITY",
                extra={**base, "workflow_name": wf.name, "version": wf.version},
            )
        except (ArtifactInstallError, OSError):
            log.exception(
                "runner.artifact_prepare_failed",
                extra={**base, "workflow_name": wf.name, "version": wf.version},
            )
    return prepared


async def run_runner(config: RunnerConfig) -> None:
    base = _base_log_context(config)
    log.info(
        "runner.starting",
        extra={**base, "uses_temporal_cloud": config.uses_temporal_cloud},
    )

    broker = TenantBrokerClient(
        api_base_url=config.pegasus_api_base_url,
        broker_token=config.workflow_broker_token,
    )

    prepared = await asyncio.to_thread(prepare_all, config, broker)
    if not prepared:
        # Nothing runnable — exit 0 so ECS doesn't flap the task; the
        # dispatcher shouldn't have launched us, and the log says so.
        log.warning("runner.no_executable_workflows", extra=base)
        return

    idle_tracker = IdleTracker(config.idle_timeout_seconds)
    executor = TenantCodeExecutor(
        broker=broker,
        prepared={p.name: p for p in prepared},
        api_base_url=config.pegasus_api_base_url,
        execution_timeout_seconds=config.execution_timeout_seconds,
        max_output_bytes=config.max_output_bytes,
        max_result_bytes=config.max_result_bytes,
    )
    registrations = build_registrations(
        prepared,
        executor=executor,
        idle_tracker=idle_tracker,
        execution_timeout_seconds=config.execution_timeout_seconds,
    )

    client = await build_temporal_client(config)
    log.info(
        "runner.connected",
        extra={**base, "workflows": [p.name for p in prepared]},
    )

    worker = Worker(
        client,
        task_queue=config.task_queue,
        workflows=registrations.workflow_classes,
        activities=registrations.activities,
        graceful_shutdown_timeout=__import__("datetime").timedelta(seconds=5),
    )

    loop = asyncio.get_running_loop()
    shutdown_requested = asyncio.Event()

    def _request_shutdown(signame: str) -> None:
        log.info("runner.shutdown_signal", extra={**base, "signal": signame})
        shutdown_requested.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_shutdown, sig.name)
        except NotImplementedError:  # pragma: no cover - non-POSIX dev hosts
            pass

    watchdog_task = asyncio.create_task(
        run_idle_watchdog(idle_tracker, shutdown_requested)
    )

    async def _drain_on_shutdown() -> None:
        await shutdown_requested.wait()
        log.info("runner.draining", extra=base)
        await worker.shutdown()

    drain_task = asyncio.create_task(_drain_on_shutdown())

    log.info("runner.polling", extra=base)
    try:
        await worker.run()
    finally:
        for task in (drain_task, watchdog_task):
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        log.info("runner.stopped", extra=base)


def main() -> None:
    """Process entrypoint — called by the Dockerfile ENTRYPOINT.

    Hardening runs FIRST — before config parsing, long before any tenant
    subprocess — so the shim is never observable via same-uid /proc reads
    while it holds secrets (see hardening.py). A hardening failure on Linux
    is fatal by design: the runner refuses to start dumpable.
    """
    try:
        set_non_dumpable()
    except Exception:  # HardeningError, or e.g. OSError loading libc —
        # either way the shim must not start dumpable.
        configure_logging()
        log.exception("runner.hardening_failed")
        sys.exit(1)
    configure_logging()
    try:
        config = load_config()
    except Exception:
        log.exception("runner.config_error")
        sys.exit(2)
    try:
        asyncio.run(run_runner(config))
    except Exception:
        log.exception("runner.fatal")
        sys.exit(1)


if __name__ == "__main__":
    main()
