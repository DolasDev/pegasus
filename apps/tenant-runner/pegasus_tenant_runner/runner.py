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
from .broker_client import (
    TemporalCredentials,
    TemporalCredentialsUnavailable,
    TenantBrokerClient,
)
from .config import RunnerConfig, load_config
from .executor import TenantCodeExecutor
from .hardening import set_non_dumpable
from .idle import IdleTracker, run_idle_watchdog
from .logging_setup import configure_logging
from .preparer import WorkflowPreparer
from .proxy import build_registrations
from .temporal_credentials import run_credentials_refresh

log = logging.getLogger("pegasus_tenant_runner")


def _base_log_context(config: RunnerConfig, namespace: str | None = None) -> dict[str, str]:
    return {
        "env": config.env_name,
        "tenant_id": config.tenant_id,
        "namespace": namespace or config.temporal_namespace,
        "task_queue": config.task_queue,
    }


async def build_temporal_client(
    config: RunnerConfig, credentials: TemporalCredentials | None = None
) -> Client:
    """Connect to Temporal.

    Broker mode (``credentials`` given, Phase 3b.2): the tenant's own namespace
    with its namespace-scoped key (API key ⇒ TLS). Env mode: Cloud (API key ⇒
    TLS) or local dev (no auth).
    """
    identity = f"pegasus-tenant-runner-{config.tenant_id}-{config.env_name}"
    if credentials is not None:
        return await Client.connect(
            credentials.address,
            namespace=credentials.namespace,
            api_key=credentials.api_key,
            identity=identity,
        )
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
) -> tuple[list[PreparedWorkflow], int]:
    """Warm up: prepare the latest version of each of this tenant's workflows.

    This is a LATENCY optimization, not the resolution path. Since
    sdk-feedback 0034 the executor resolves and installs the exact published
    row per execution, so anything missed here is prepared on demand — which is
    why a failure below is no longer terminal for that workflow, and why the
    caller decides "is there anything to run" from the LISTING rather than from
    what happened to prepare.

    Per-workflow failure isolation: a sha mismatch (possible TOCTOU
    overwrite — the loudest log line this app has) or any install failure
    skips THAT workflow only.

    Returns the prepared rows plus the number of executable workflows listed.
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
    return prepared, len(listed)


async def run_runner(config: RunnerConfig) -> None:
    base = _base_log_context(config)
    log.info(
        "runner.starting",
        extra={
            **base,
            "uses_temporal_cloud": config.uses_temporal_cloud,
            "uses_broker_credentials": config.uses_broker_credentials,
        },
    )

    broker = TenantBrokerClient(
        api_base_url=config.pegasus_api_base_url,
        broker_token=config.workflow_broker_token,
    )

    # Broker mode (Phase 3b.2): fetch the tenant's own namespace + key FIRST,
    # before any artifact work. A 404 means the tenant isn't routed to its own
    # namespace (a launch that raced a rollback): nothing to poll, exit 0 like
    # the no-workflows case. The Needed-vs-Running alarm surfaces a loop.
    credentials: TemporalCredentials | None = None
    if config.uses_broker_credentials:
        try:
            credentials = await asyncio.to_thread(broker.fetch_temporal_credentials)
        except TemporalCredentialsUnavailable:
            log.warning("runner.temporal_credentials_unavailable", extra=base)
            return
        base = _base_log_context(config, credentials.namespace)
        log.info("runner.temporal_credentials_fetched", extra=base)

    prepared, listed_count = await asyncio.to_thread(prepare_all, config, broker)
    if listed_count == 0:
        # Nothing runnable — exit 0 so ECS doesn't flap the task; the
        # dispatcher shouldn't have launched us, and the log says so. The
        # decision follows the LISTING, not the warm-up results: a workflow
        # whose eager prepare failed is still installable on demand, so
        # exiting on that would strand a tenant behind one bad artifact.
        log.warning("runner.no_executable_workflows", extra=base)
        return

    preparer = WorkflowPreparer(
        broker=broker,
        work_root=Path(config.work_dir),
        max_unpacked_bytes=config.max_unpacked_bytes,
    )
    preparer.seed(prepared)

    idle_tracker = IdleTracker(config.idle_timeout_seconds)
    executor = TenantCodeExecutor(
        broker=broker,
        preparer=preparer,
        api_base_url=config.pegasus_api_base_url,
        execution_timeout_seconds=config.execution_timeout_seconds,
        max_output_bytes=config.max_output_bytes,
        max_result_bytes=config.max_result_bytes,
    )
    # One dynamic proxy handles every workflow type on this tenant's queue,
    # including names published after this task started (sdk-feedback 0034).
    registrations = build_registrations(
        executor=executor,
        idle_tracker=idle_tracker,
        execution_timeout_seconds=config.execution_timeout_seconds,
    )

    client = await build_temporal_client(config, credentials)
    log.info(
        "runner.connected",
        extra={
            **base,
            "warmed": [f"{p.name}@{p.version}" for p in prepared],
            "executable_count": listed_count,
        },
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

    background = [drain_task, watchdog_task]
    if credentials is not None:
        background.append(
            asyncio.create_task(
                run_credentials_refresh(
                    broker=broker,
                    client=client,
                    current=credentials,
                    interval_seconds=config.temporal_credentials_refresh_seconds,
                    shutdown_requested=shutdown_requested,
                    log_context=base,
                )
            )
        )

    log.info("runner.polling", extra=base)
    try:
        await worker.run()
    finally:
        for task in background:
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
