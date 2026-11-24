"""Wait, in a durable Workflow, for a task to close (0.69.0+).

.. code-block:: python

    from datetime import timedelta
    from pegasus_workflows import TaskAwaitTimeout, await_task, pegasus_workflow, workflow

    @pegasus_workflow(name="order_lifecycle", version="1.0.0")
    class OrderLifecycle:
        @workflow.run
        async def run(self, order: dict) -> dict:
            try:
                task = await await_task(order["confirmTaskId"], timeout=timedelta(days=3))
            except TaskAwaitTimeout:
                return {"escalated": True}
            return {"closedBecause": task["reason"]}

``await_task`` returns the task (the same dict as ``PegasusClient.get_task``)
once it is closed, in either store:

- **cloud** tasks wake the Workflow when they close;
- **legacy** (MoveManager) tasks are checked every few minutes, so expect up to
  ~20 minutes between the close and the wake-up.

A task that is already closed returns at once. Several ``await_task`` calls can
run concurrently in one Workflow (``asyncio.gather``, or one per branch), and
awaiting the same task twice returns the same result.

How it works: a built-in activity (``pegasus.await_task_register``) registers
the wait with the platform and returns the task's current state; the platform
then signals the Workflow ``pegasus.task_closed`` when the task closes.
``pegasus.``-prefixed signal names are reserved for the platform, so no tenant
caller can forge one; nothing in the manifest declares it.

This module is imported in the Workflow sandbox, so it imports nothing beyond
Temporal at module level; the activity imports the HTTP client when it runs.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError
from temporalio.exceptions import TimeoutError as TemporalTimeoutError

__all__ = [
    "AWAIT_TASK_REGISTER_ACTIVITY",
    "TASK_CLOSED_SIGNAL",
    "TaskAwaitRefused",
    "TaskAwaitTimeout",
    "await_task",
    "await_task_register_activity",
]

#: The registered name of the register activity. The tenant runner registers
#: it (via ``pegasus_workflows.steps.BUILTIN_ACTIVITIES``) on every durable
#: Workflow worker.
AWAIT_TASK_REGISTER_ACTIVITY = "pegasus.await_task_register"

#: The platform's signal, carrying the closed task. Reserved: the platform
#: refuses ``pegasus.``-prefixed names from every tenant path.
TASK_CLOSED_SIGNAL = "pegasus.task_closed"

#: The ``ApplicationError.type`` a refusal crosses the activity boundary as.
TASK_AWAIT_REFUSED_TYPE = "TaskAwaitRefused"
TASK_AWAIT_TIMEOUT_TYPE = "TaskAwaitTimeout"

_REGISTER_START_TO_CLOSE = timedelta(seconds=60)

#: 503s that won't clear while a Workflow waits (the tenant has no MoveManager
#: site, or its site has no task API): refused, not retried for the run's life.
_PERMANENT_UNAVAILABLE_CODES = frozenset({"PEGII_API_NOT_CONFIGURED", "PEGII_CAPABILITY_MISSING"})

#: The attribute holding one run's await state on its Workflow instance.
_STATE_ATTR = "__pegasus_task_awaits__"


class TaskAwaitRefused(ApplicationError):
    """The platform refused the wait for good. Not retried.

    Raised by :func:`await_task` inside the Workflow. ``code`` says why:

    - ``TASK_NOT_FOUND``: no task with that id (an id of neither store's shape
      is also not found).
    - ``EXECUTION_NOT_OPEN``: this run is not an open execution of the calling
      Workflow (it is closing, or this is not a platform-run Workflow).
    - ``AWAIT_CALLER_NOT_WORKFLOW``: only a durable Workflow can await a task;
      an Automation's runtime token is refused.
    - ``PEGII_API_NOT_CONFIGURED`` / ``PEGII_CAPABILITY_MISSING``: a legacy id,
      but the tenant has no MoveManager site, or its site has no task API.

    Attributes:
        task_id: The task id that was awaited.
        code: The platform's refusal code.
        error_message: The platform's message.
    """

    def __init__(
        self,
        message: str,
        *,
        task_id: str,
        code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        details = {"taskId": task_id, "code": code, "errorMessage": error_message}
        super().__init__(message, details, type=TASK_AWAIT_REFUSED_TYPE, non_retryable=True)
        self.task_id = task_id
        self.code = code
        self.error_message = error_message

    @classmethod
    def _from_failure(cls, cause: ApplicationError) -> TaskAwaitRefused:
        d = cause.details[0] if cause.details and isinstance(cause.details[0], dict) else {}
        return cls(
            cause.message,
            task_id=d.get("taskId") or "",
            code=d.get("code"),
            error_message=d.get("errorMessage"),
        )


class TaskAwaitTimeout(ApplicationError):
    """The task did not close within ``await_task``'s ``timeout``.

    The wait stays registered with the platform: awaiting the same task again
    picks it up (and returns at once if it closed in between). Uncaught, it
    fails the Workflow.

    Attributes:
        task_id: The task id that was awaited.
        timeout: The timeout that ran out.
    """

    def __init__(self, task_id: str, timeout: timedelta) -> None:
        super().__init__(
            f"task {task_id} did not close within {timeout}",
            {"taskId": task_id, "timeoutSeconds": timeout.total_seconds()},
            type=TASK_AWAIT_TIMEOUT_TYPE,
            non_retryable=True,
        )
        self.task_id = task_id
        self.timeout = timeout


class _AwaitState:
    """One Workflow run's await state: the closed tasks seen so far.

    Lives on the Workflow instance (``workflow.instance()``), so it is per run
    whether or not the module is re-imported per run by the sandbox.
    """

    def __init__(self) -> None:
        self.closed: dict[str, dict[str, Any]] = {}
        self.handler_installed = False

    def record(self, task: Any) -> None:
        if isinstance(task, dict) and task.get("id") is not None:
            # First delivery wins: the platform may signal a task twice.
            self.closed.setdefault(str(task["id"]), _task_only(task))


#: Fallback when ``workflow.instance()`` is unavailable (temporalio < 1.8):
#: keyed by run id.
_STATE_BY_RUN: dict[str, _AwaitState] = {}


def _state() -> _AwaitState:
    instance_fn = getattr(workflow, "instance", None)
    instance = instance_fn() if instance_fn is not None else None
    if instance is not None:
        state = getattr(instance, _STATE_ATTR, None)
        if state is None:
            state = _AwaitState()
            setattr(instance, _STATE_ATTR, state)
        return state
    return _STATE_BY_RUN.setdefault(workflow.info().run_id, _AwaitState())


def _task_only(response: dict[str, Any]) -> dict[str, Any]:
    """The task dict, without the register call's ``awaiting`` flag."""
    return {k: v for k, v in response.items() if k != "awaiting"}


def _install_handler(state: _AwaitState) -> None:
    if state.handler_installed:
        return
    # Installed BEFORE the register activity runs, so a close that lands while
    # the activity is in flight is not missed. (A signal that arrived earlier
    # still is not lost: Temporal buffers it until a handler exists.)
    workflow.set_signal_handler(TASK_CLOSED_SIGNAL, state.record)
    state.handler_installed = True


async def await_task(task_id: str | int, *, timeout: timedelta | None = None) -> dict[str, Any]:
    """Wait until the task *task_id* is closed, and return it.

    Call this from a durable Workflow (``kind = "workflow"``) only. At run time
    your code uses the platform runner's SDK, which registers the activity this
    needs; you need 0.69.0+ locally only to import this.

    Args:
        task_id: The task's id, in either store: digits (legacy/MoveManager) or
            a UUID (cloud), as returned by ``create_task`` / ``list_tasks``.
        timeout: The longest to wait. ``None`` (the default) waits for as long
            as the Workflow lives (its ``max_lifetime_days``).

    Returns:
        The closed task, the same shape as ``PegasusClient.get_task``:
        ``status == "closed"``, with ``reason``, ``closedAt`` / ``completedAt``
        and ``store``.

    Raises:
        TaskAwaitTimeout: ``timeout`` ran out before the task closed.
        TaskAwaitRefused: the platform refused the wait (``TASK_NOT_FOUND``,
            ``EXECUTION_NOT_OPEN``, ``AWAIT_CALLER_NOT_WORKFLOW``).
    """
    key = str(task_id)
    started = workflow.now()
    state = _state()
    if key in state.closed:
        return state.closed[key]
    _install_handler(state)

    try:
        response = await workflow.execute_activity(
            AWAIT_TASK_REGISTER_ACTIVITY,
            {"taskId": key},
            start_to_close_timeout=_REGISTER_START_TO_CLOSE,
            # Bounded by the caller's timeout; otherwise retried (a store that
            # is down — a MoveManager site offline — is waited out) for as long
            # as the Workflow lives.
            schedule_to_close_timeout=timeout,
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(minutes=5),
                non_retryable_error_types=[TASK_AWAIT_REFUSED_TYPE],
            ),
        )
    except ActivityError as err:
        cause = err.cause
        if isinstance(cause, ApplicationError) and cause.type == TASK_AWAIT_REFUSED_TYPE:
            raise TaskAwaitRefused._from_failure(cause) from err
        if isinstance(cause, TemporalTimeoutError) and timeout is not None:
            raise TaskAwaitTimeout(key, timeout) from err
        raise

    if not response.get("awaiting"):
        state.record(response)
        return state.closed.get(key, _task_only(response))

    # One deadline for the whole call: the register activity's time counts.
    remaining = None if timeout is None else timeout - (workflow.now() - started)
    if remaining is not None and remaining <= timedelta(0) and key not in state.closed:
        raise TaskAwaitTimeout(key, timeout)  # type: ignore[arg-type]
    try:
        await workflow.wait_condition(lambda: key in state.closed, timeout=remaining)
    except TimeoutError as err:
        raise TaskAwaitTimeout(key, timeout or timedelta(0)) from err
    return state.closed[key]


# ---------------------------------------------------------------------------
# The activity (runs on the Workflow worker, outside the sandbox)
# ---------------------------------------------------------------------------


def _runtime_client() -> Any:
    from .api import PegasusClient

    return PegasusClient.from_runtime()


@activity.defn(name=AWAIT_TASK_REGISTER_ACTIVITY)
async def await_task_register_activity(request: dict[str, Any]) -> dict[str, Any]:
    """Register this run's wait on a task; return the task's current state.

    Registered by the tenant runner on every durable Workflow worker; authors
    call :func:`await_task`, never this. Idempotent per (run, task), so a
    retried attempt re-arms the same wait.

    Returns:
        The task plus ``awaiting``: ``False`` when it is already closed.
    """
    from .api import PegasusApiError

    task_id = str(request["taskId"])
    client = _runtime_client()
    try:
        return await asyncio.to_thread(
            client.register_task_await,
            task_id,
            temporal_workflow_id=activity.info().workflow_id,
        )
    except PegasusApiError as err:
        permanent = err.code in _PERMANENT_UNAVAILABLE_CODES
        if (err.status_code >= 500 or err.status_code == 429) and not permanent:
            raise  # transient: Temporal retries the activity
        raise TaskAwaitRefused(
            f"await_task({task_id!r}) was refused: {err}",
            task_id=task_id,
            code=err.code,
            error_message=err.message,
        ) from err
