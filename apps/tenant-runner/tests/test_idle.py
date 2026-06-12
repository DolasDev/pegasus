"""Idle-exit logic against a fake clock — no sleeping."""

from __future__ import annotations

import asyncio

from pegasus_tenant_runner.idle import IdleTracker, run_idle_watchdog


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_fresh_tracker_is_not_idle() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    assert tracker.should_exit() is False


def test_exits_after_idle_window_with_no_tasks() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    clock.advance(599)
    assert tracker.should_exit() is False
    clock.advance(2)
    assert tracker.should_exit() is True


def test_in_flight_task_blocks_exit_indefinitely() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    tracker.task_started()
    clock.advance(10_000)  # way past the idle window
    assert tracker.idle_seconds() == 0.0
    assert tracker.should_exit() is False


def test_task_finish_resets_the_idle_clock() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    tracker.task_started()
    clock.advance(5_000)
    tracker.task_finished()
    assert tracker.should_exit() is False
    clock.advance(599)
    assert tracker.should_exit() is False
    clock.advance(2)
    assert tracker.should_exit() is True


def test_overlapping_tasks_only_idle_when_all_finished() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    tracker.task_started()
    tracker.task_started()
    tracker.task_finished()
    clock.advance(10_000)
    assert tracker.should_exit() is False  # one still in flight
    tracker.task_finished()
    clock.advance(601)
    assert tracker.should_exit() is True


def test_double_finish_does_not_go_negative() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    tracker.task_finished()
    tracker.task_finished()
    tracker.task_started()
    clock.advance(10_000)
    assert tracker.should_exit() is False  # the started task still counts


async def test_watchdog_sets_shutdown_event_when_idle() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    clock.advance(601)
    event = asyncio.Event()
    await asyncio.wait_for(
        run_idle_watchdog(tracker, event, poll_seconds=0.01), timeout=5
    )
    assert event.is_set()


async def test_watchdog_returns_when_event_set_externally() -> None:
    clock = FakeClock()
    tracker = IdleTracker(600, clock=clock)
    tracker.task_started()  # never idle
    event = asyncio.Event()
    task = asyncio.create_task(run_idle_watchdog(tracker, event, poll_seconds=0.01))
    await asyncio.sleep(0.05)
    assert not task.done()
    event.set()  # external SIGTERM path
    await asyncio.wait_for(task, timeout=5)
