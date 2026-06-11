"""Idle-exit tracking (Resolved decision #1 — scale-to-zero).

A runner launches on the first QUEUED execution for its tenant (Unit 9) and
self-terminates after an idle window so per-tenant runners cost nothing at
rest. "Idle" means: no activity in flight AND no activity started/finished
within the window.

:class:`IdleTracker` is pure logic over an injectable monotonic clock so the
exit decision is unit-testable without sleeping; :func:`run_idle_watchdog`
is the thin asyncio loop that polls it and sets the shared shutdown event —
the same event SIGTERM sets, so both paths drain the Temporal worker
identically.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

log = logging.getLogger(__name__)

__all__ = ["IdleTracker", "run_idle_watchdog"]


class IdleTracker:
    """Tracks in-flight activity count + last-activity time.

    Thread-safety: all mutations happen on the worker's event loop (activity
    coroutines + the watchdog task), so no locking is needed.
    """

    def __init__(
        self,
        idle_timeout_seconds: float,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if idle_timeout_seconds <= 0:
            raise ValueError("idle_timeout_seconds must be > 0")
        self._idle_timeout = idle_timeout_seconds
        self._clock = clock
        self._in_flight = 0
        # Start the clock at construction: an empty queue must still time out.
        self._last_activity = clock()

    @property
    def in_flight(self) -> int:
        return self._in_flight

    def task_started(self) -> None:
        self._in_flight += 1
        self._last_activity = self._clock()

    def task_finished(self) -> None:
        # Defensive floor — a double-finish must never unlock idle-exit early.
        self._in_flight = max(0, self._in_flight - 1)
        self._last_activity = self._clock()

    def idle_seconds(self) -> float:
        """Seconds since the last start/finish event (0 while work runs)."""
        if self._in_flight > 0:
            return 0.0
        return self._clock() - self._last_activity

    def should_exit(self) -> bool:
        """True when nothing is in flight and the idle window has elapsed."""
        return self._in_flight == 0 and self.idle_seconds() >= self._idle_timeout


async def run_idle_watchdog(
    tracker: IdleTracker,
    shutdown_event: asyncio.Event,
    *,
    poll_seconds: float = 15.0,
) -> None:
    """Poll the tracker; set ``shutdown_event`` once the runner goes idle.

    Returns when either the tracker trips or someone else (SIGTERM) sets the
    event first.
    """
    while not shutdown_event.is_set():
        if tracker.should_exit():
            log.info(
                "runner.idle_exit",
                extra={"idle_seconds": round(tracker.idle_seconds(), 1)},
            )
            shutdown_event.set()
            return
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=poll_seconds)
        except TimeoutError:
            continue
