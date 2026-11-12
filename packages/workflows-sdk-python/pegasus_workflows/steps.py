"""Run an Automation as a step of a durable Workflow (0.65.0+).

.. code-block:: python

    from pegasus_workflows import AutomationStepFailed, pegasus_workflow, run_automation, workflow

    @pegasus_workflow(name="order_lifecycle", version="1.0.0")
    class OrderLifecycle:
        @workflow.run
        async def run(self, order: dict) -> dict:
            quote = await run_automation("price_order", {"orderId": order["id"]})
            try:
                await run_automation("notify_crew", {"orderId": order["id"]}, version="0.3.0")
            except AutomationStepFailed as err:
                workflow.logger.warning("crew not notified: %s", err)
            return quote

A step is an ordinary Automation run with its own execution row (trigger
source ``WORKFLOW``, linked to this Workflow's execution), started through the
platform API on the Workflow's runtime token. It counts toward the
Automation concurrency cap and the daily quota, and the kill switch stops it
from starting. Those "not now" refusals are waited out here, not raised: the
step keeps retrying until it starts or ``timeout`` runs out.

The step is started once per call even if the activity is retried, because
the platform keys it on the calling activity. Calling ``run_automation`` twice
runs the Automation twice.

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
from temporalio.workflow import ActivityCancellationType

__all__ = [
    "RUN_AUTOMATION_ACTIVITY",
    "AutomationStepFailed",
    "run_automation",
    "run_automation_activity",
    "BUILTIN_ACTIVITIES",
]

#: The registered name of the step activity. The tenant runner registers
#: :data:`BUILTIN_ACTIVITIES` on every durable Workflow worker.
RUN_AUTOMATION_ACTIVITY = "pegasus.run_automation"

#: The ``ApplicationError.type`` a failed step crosses the activity boundary as.
STEP_FAILED_TYPE = "AutomationStepFailed"

#: How long one step may take, start to finish, waits included, by default.
DEFAULT_STEP_TIMEOUT = timedelta(hours=6)

_HEARTBEAT_TIMEOUT = timedelta(seconds=60)
#: Heartbeat at least this often while sleeping, well inside the timeout, so a
#: cancellation reaches the activity promptly.
_HEARTBEAT_EVERY_SECONDS = 10.0

_TERMINAL_FAILURES = frozenset({"FAILED", "TIMED_OUT", "CANCELLED"})

#: Refusals that mean "not now": wait and start again (decision 3 of the plan).
_NOT_NOW_CODES = frozenset(
    {
        "WORKFLOWS_DISABLED",
        "CONCURRENCY_LIMIT",
        "DAILY_QUOTA_EXCEEDED",
        "TENANT_MIGRATING",
        "TENANT_NAMESPACE_PROVISIONING",
    }
)


class AutomationStepFailed(ApplicationError):
    """A step's Automation did not complete, or the platform refused to run it.

    Raised by :func:`run_automation` inside the Workflow. Not retried: the
    Automation itself already ran (or can never run), so a Workflow that
    should try again catches this and calls :func:`run_automation` again.
    Uncaught, it fails the Workflow.

    Attributes:
        automation: The Automation's name.
        execution_id: The step's execution id, or ``None`` if it never started.
        status: ``FAILED`` / ``TIMED_OUT`` / ``CANCELLED``, or ``None`` when
            the start was refused.
        code: The refusal's API code (e.g. ``AUTOMATION_NOT_FOUND``,
            ``STEP_TARGET_NOT_AUTOMATION``), or ``None`` when it ran.
        error_message: The Automation's error message, or the refusal's.
    """

    def __init__(
        self,
        message: str,
        *,
        automation: str,
        execution_id: str | None = None,
        status: str | None = None,
        code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        details = {
            "automation": automation,
            "executionId": execution_id,
            "status": status,
            "code": code,
            "errorMessage": error_message,
        }
        super().__init__(message, details, type=STEP_FAILED_TYPE, non_retryable=True)
        self.automation = automation
        self.execution_id = execution_id
        self.status = status
        self.code = code
        self.error_message = error_message

    @classmethod
    def _from_failure(cls, cause: ApplicationError) -> AutomationStepFailed:
        d = cause.details[0] if cause.details and isinstance(cause.details[0], dict) else {}
        return cls(
            cause.message,
            automation=d.get("automation") or "",
            execution_id=d.get("executionId"),
            status=d.get("status"),
            code=d.get("code"),
            error_message=d.get("errorMessage"),
        )


async def run_automation(
    name: str,
    input: dict[str, Any] | None = None,
    *,
    version: str | None = None,
    timeout: timedelta = DEFAULT_STEP_TIMEOUT,
) -> Any:
    """Run the Automation *name* as a step and return its result.

    Call this from a durable Workflow (``kind = "workflow"``) only. It needs
    tenant runner support, which ships with SDK 0.65.0, so publish the
    Workflow with SDK 0.65.0 or newer.

    Args:
        name: The Automation's name. Your own versions win over a GLOBAL one
            of the same name.
        input: JSON-shaped input dict, passed to the Automation as a manual run
            would. Defaults to ``{}``.
        version: Run exactly this version. ``None`` (the default) runs the
            newest ACTIVE version at the moment of the call, so publishing a
            new Automation version changes what later steps run.
        timeout: The longest the whole step may take, including time spent
            waiting for the kill switch, the concurrency cap or the daily quota.
            Default 6 hours. On expiry the Workflow gets an ``ActivityError``
            (a timeout), not :class:`AutomationStepFailed`.

    Returns:
        The Automation's return value (its execution's ``result``).

    Raises:
        AutomationStepFailed: The Automation finished FAILED / TIMED_OUT /
            CANCELLED, or the platform refused it for good (no such Automation,
            the name is a durable Workflow, …).
    """
    try:
        return await workflow.execute_activity(
            RUN_AUTOMATION_ACTIVITY,
            {"automation": name, "version": version, "input": input or {}},
            schedule_to_close_timeout=timeout,
            heartbeat_timeout=_HEARTBEAT_TIMEOUT,
            retry_policy=RetryPolicy(
                initial_interval=timedelta(seconds=5),
                backoff_coefficient=2.0,
                maximum_interval=timedelta(minutes=1),
                non_retryable_error_types=[STEP_FAILED_TYPE],
            ),
            # Let the activity cancel the Automation before the Workflow moves on.
            cancellation_type=ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
        )
    except ActivityError as err:
        cause = err.cause
        if isinstance(cause, ApplicationError) and cause.type == STEP_FAILED_TYPE:
            raise AutomationStepFailed._from_failure(cause) from err
        raise


# ---------------------------------------------------------------------------
# The activity (runs on the Workflow worker, outside the sandbox)
# ---------------------------------------------------------------------------


def _runtime_client() -> Any:
    from .api import PegasusClient

    return PegasusClient.from_runtime()


async def _sleep_heartbeating(seconds: float, details: dict[str, Any]) -> None:
    remaining = seconds
    while remaining > 0:
        activity.heartbeat(details)
        chunk = min(remaining, _HEARTBEAT_EVERY_SECONDS)
        await asyncio.sleep(chunk)
        remaining -= chunk


async def _start(client: Any, request: dict[str, Any]) -> dict[str, Any]:
    """POST the step, waiting out "not now" refusals. Returns the execution."""
    from .api import PegasusApiError

    info = activity.info()
    name = request["automation"]
    delay = 5.0
    while True:
        try:
            _status, execution = await asyncio.to_thread(
                client.start_automation_step,
                name,
                request.get("input") or {},
                version=request.get("version"),
                parent_workflow_id=info.workflow_id,
                parent_run_id=info.workflow_run_id,
                activity_id=info.activity_id,
            )
            return execution
        except PegasusApiError as err:
            if err.code in _NOT_NOW_CODES:
                hinted = getattr(err, "retry_after_seconds", None)
                cap = 300.0 if err.code == "DAILY_QUOTA_EXCEEDED" else 60.0
                wait = float(hinted) if hinted else delay
                activity.logger.info(
                    "Step %s not started yet (%s); retrying in %ss", name, err.code, wait
                )
                await _sleep_heartbeating(wait, {"automation": name, "waiting": err.code})
                if not hinted:  # the server's Retry-After isn't our backoff
                    delay = min(delay * 2, cap)
                continue
            if err.status_code >= 500:
                raise  # transient: Temporal retries the activity
            raise AutomationStepFailed(
                f"Automation step {name!r} was refused: {err}",
                automation=name,
                code=err.code,
                error_message=err.message,
            ) from err


async def _await_terminal(client: Any, name: str, execution_id: str) -> Any:
    delay = 2.0
    while True:
        activity.heartbeat({"automation": name, "executionId": execution_id})
        step = await asyncio.to_thread(client.get_automation_step, execution_id)
        status = step.get("status")
        if status == "COMPLETED":
            return step.get("result")
        if status in _TERMINAL_FAILURES:
            message = step.get("errorMessage") or "no message"
            raise AutomationStepFailed(
                f"Automation step {name!r} ended {status}: {message}",
                automation=name,
                execution_id=execution_id,
                status=status,
                error_message=step.get("errorMessage"),
            )
        await _sleep_heartbeating(delay, {"automation": name, "executionId": execution_id})
        delay = min(delay * 1.5, 15.0)


@activity.defn(name=RUN_AUTOMATION_ACTIVITY)
async def run_automation_activity(request: dict[str, Any]) -> Any:
    """Start the step (idempotently), then poll it to a terminal status.

    Registered by the tenant runner on every durable Workflow worker; authors
    call :func:`run_automation`, never this.
    """
    client = _runtime_client()
    execution_id: str | None = None
    try:
        execution = await _start(client, request)
        execution_id = execution["id"]
        return await _await_terminal(client, request["automation"], execution_id)
    except asyncio.CancelledError:
        # The Workflow cancelled the step: stop the Automation too. Best effort
        # — a step that already finished or hasn't reached Temporal yet can't
        # be cancelled, and the cancellation must still propagate.
        if execution_id is not None:
            try:
                await asyncio.to_thread(client.cancel_automation_step, execution_id)
            except Exception as exc:  # noqa: BLE001
                activity.logger.warning("Could not cancel step %s: %r", execution_id, exc)
        raise


#: Activities every durable Workflow worker registers alongside the Workflow's own.
BUILTIN_ACTIVITIES = [run_automation_activity]
