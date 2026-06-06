"""Worker entrypoint: connects to Temporal, registers curated workflows.

Run as ``python -m pegasus_temporal_worker.worker``. SIGTERM (sent by ECS
on scale-in or rolling deploy) triggers a graceful shutdown via
:meth:`temporalio.worker.Worker.shutdown`, which waits for in-flight
activities up to ``graceful_shutdown_timeout``.

JSON-structured logging goes to stdout (the awslogs driver picks it up on
Fargate; CloudWatch Logs Insights queries it without any extra parsing
overhead).
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from typing import Any

from temporalio.client import Client
from temporalio.worker import Worker

from .config import WorkerConfig, load_config
from .registry import activity_callables, workflow_classes

log = logging.getLogger("pegasus_temporal_worker")


# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------


class _JsonFormatter(logging.Formatter):
    """JSON-line formatter for CloudWatch Logs Insights compatibility.

    Always includes ``timestamp``, ``level``, ``logger``, ``message``.
    Extra fields passed via ``logging.Logger.<level>(..., extra={...})``
    are merged in at the top level.
    """

    _STD_ATTRS = frozenset(
        {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
            "message",
            "taskName",
        }
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        # Merge any structured `extra=` payload.
        for key, value in record.__dict__.items():
            if key in self._STD_ATTRS or key.startswith("_"):
                continue
            try:
                json.dumps(value)
            except (TypeError, ValueError):
                value = repr(value)
            payload[key] = value
        return json.dumps(payload, separators=(",", ":"))


def configure_logging() -> None:
    """Install the JSON formatter on the root logger.

    Idempotent — calling twice doesn't double-attach handlers.
    """
    root = logging.getLogger()
    # Drop any preconfigured handlers (e.g. from a test harness) so we
    # never double-emit. Most test frameworks attach their own; we want
    # ours in production only.
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def _base_log_context(config: WorkerConfig) -> dict[str, str]:
    return {
        "env": config.env_name,
        "namespace": config.temporal_namespace,
        "task_queue": config.temporal_task_queue,
    }


# ---------------------------------------------------------------------------
# Client + worker construction
# ---------------------------------------------------------------------------


async def build_temporal_client(config: WorkerConfig) -> Client:
    """Connect to Temporal — Cloud (with API key) or local dev (no auth).

    The temporalio SDK convention: passing ``api_key=`` enables TLS by
    default; we leave ``tls=None`` so the SDK picks the right shape for
    each mode. Empty API key → local Temporal dev server (no TLS, no auth).
    """
    if config.uses_temporal_cloud:
        return await Client.connect(
            config.temporal_address,
            namespace=config.temporal_namespace,
            api_key=config.temporal_cloud_api_key,
            identity=f"pegasus-temporal-worker-{config.env_name}",
        )
    return await Client.connect(
        config.temporal_address,
        namespace=config.temporal_namespace,
        identity=f"pegasus-temporal-worker-{config.env_name}",
    )


def build_worker(client: Client, config: WorkerConfig) -> Worker:
    """Construct a :class:`Worker` bound to the curated registry.

    ``graceful_shutdown_timeout`` gives in-flight activities a window to
    finish on SIGTERM before Temporal cancels them. Five seconds is short
    enough to fit comfortably inside the default ECS stop timeout (30s)
    with margin.
    """
    return Worker(
        client,
        task_queue=config.temporal_task_queue,
        workflows=workflow_classes(),
        activities=activity_callables(),
        graceful_shutdown_timeout=__import__("datetime").timedelta(seconds=5),
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


async def run_worker(config: WorkerConfig) -> None:
    """Connect, build the worker, install SIGTERM handler, run until shutdown."""
    base = _base_log_context(config)
    log.info(
        "worker.starting",
        extra={**base, "uses_temporal_cloud": config.uses_temporal_cloud},
    )

    client = await build_temporal_client(config)
    log.info("worker.connected", extra=base)

    worker = build_worker(client, config)

    loop = asyncio.get_running_loop()
    shutdown_requested = asyncio.Event()

    def _request_shutdown(signame: str) -> None:
        log.info("worker.shutdown_signal", extra={**base, "signal": signame})
        shutdown_requested.set()

    # Fargate sends SIGTERM on scale-in / new deployment. SIGINT for local
    # dev (Ctrl-C). Both trigger the same graceful drain.
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_shutdown, sig.name)
        except NotImplementedError:
            # add_signal_handler is unavailable on Windows; ignore — the
            # worker is only run on Linux Fargate in production.
            pass

    async def _drain_on_signal() -> None:
        await shutdown_requested.wait()
        log.info("worker.draining", extra=base)
        await worker.shutdown()

    drain_task = asyncio.create_task(_drain_on_signal())

    log.info("worker.polling", extra=base)
    try:
        await worker.run()
    finally:
        # Worker.run() returns once shutdown completes; cancel the drain
        # waiter so the event loop can exit cleanly.
        if not drain_task.done():
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass
        log.info("worker.stopped", extra=base)


def main() -> None:
    """Process entrypoint — called by the Dockerfile ENTRYPOINT.

    Kept synchronous so `python -m pegasus_temporal_worker.worker` is the
    canonical invocation; asyncio.run owns the loop.
    """
    configure_logging()
    try:
        config = load_config()
    except Exception:
        # Logging is already configured; log + exit 2 (config error).
        log.exception("worker.config_error")
        sys.exit(2)
    try:
        asyncio.run(run_worker(config))
    except Exception:
        log.exception("worker.fatal")
        sys.exit(1)


if __name__ == "__main__":
    main()
