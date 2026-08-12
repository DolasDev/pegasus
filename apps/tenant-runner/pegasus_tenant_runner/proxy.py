"""Dynamic Temporal registrations — one catch-all proxy workflow + one activity.

The shim must accept the tenant's workflow NAMES from Temporal without ever
importing tenant code (a Python import executes arbitrary module-level code in
the process that holds the ``wbk_`` token). It does that with a single
**dynamic** proxy workflow:

* ``@workflow.defn(dynamic=True)`` — Temporal routes EVERY workflow type that
  has no explicit registration to it, so the runner does not need to know the
  tenant's workflow names in advance,
* whose entire body is one ``execute_activity("run_tenant_entry_point")`` call
  with ``maximum_attempts=1`` (the executor PATCHes a terminal status after the
  first attempt; an automatic Temporal retry would collide with the row's state
  machine),
* unsandboxed (``sandboxed=False``): the proxy is trusted shim code with a
  deterministic one-call body.

**Why dynamic** (sdk-feedback 0034): this used to manufacture one proxy class
per workflow name, from the list prepared at task startup. Because the
dispatcher reuses one runner task per tenant, a workflow name published after
that task started had no registration at all — the Temporal task went
unanswered until the execution timed out, or (once the name reached the
executor) failed with "not prepared on this runner". With a dynamic proxy the
name reaches the executor, which installs the published artifact on demand.

The runner's queue is per-tenant, so accepting any workflow type does not widen
the trust boundary: the executor still resolves the name/id against the
tenant's own executable workflows via the broker and refuses anything else.

The single activity wraps the executor and feeds the idle tracker — every
start/finish bumps the tracker so the idle-exit watchdog only fires when the
runner is genuinely quiet.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.common import RawValue

from .executor import TenantCodeExecutor
from .idle import IdleTracker

__all__ = ["ACTIVITY_NAME", "Registrations", "TenantProxyWorkflow", "build_registrations"]

ACTIVITY_NAME = "run_tenant_entry_point"

#: Buffer added to the activity start_to_close timeout on top of the
#: subprocess wall-clock budget, so the in-shim kill always fires first and
#: the TIMED_OUT status PATCH happens before Temporal times the activity out.
_ACTIVITY_TIMEOUT_BUFFER_SECONDS = 30

#: Set by :func:`build_registrations`; read by the proxy body at run time.
#: Module-level (not closure) so the workflow class stays a plain definition.
#: Proxies run unsandboxed so the read is permitted; the value is constant for
#: the process lifetime (the runner is ephemeral), keeping replays deterministic
#: within a runner incarnation.
_activity_timeout: timedelta = timedelta(seconds=900 + _ACTIVITY_TIMEOUT_BUFFER_SECONDS)


def decode_dynamic_payload(args: Sequence[RawValue]) -> Any:
    """Decode the single envelope argument handed to a dynamic workflow.

    A dynamic workflow receives its arguments **undeserialized**, as
    ``RawValue``s — so the envelope the API starts the workflow with
    (``{executionId, input, dryRun}``) has to be converted explicitly. Returns
    ``None`` for a no-argument start rather than raising: the executor already
    treats a non-dict payload as "no execution id", which fails the run with a
    clear message instead of an IndexError inside workflow code.
    """
    if not args:
        return None
    return workflow.payload_converter().from_payload(args[0].payload)


@workflow.defn(dynamic=True, sandboxed=False)
class TenantProxyWorkflow:
    """Catch-all proxy: forwards any workflow type to the executor activity."""

    @workflow.run
    async def run(self, args: Sequence[RawValue]) -> Any:
        from temporalio.common import RetryPolicy

        return await workflow.execute_activity(
            ACTIVITY_NAME,
            {
                # The registered type IS the tenant workflow's name — the exact
                # string the API's run path starts.
                "workflow_name": workflow.info().workflow_type,
                "payload": decode_dynamic_payload(args),
            },
            start_to_close_timeout=_activity_timeout,
            retry_policy=RetryPolicy(maximum_attempts=1),
        )


@dataclass(frozen=True)
class Registrations:
    """Everything :class:`temporalio.worker.Worker` needs from us."""

    workflow_classes: list[type]
    activities: list[Callable[..., Coroutine[Any, Any, Any]]]


def build_registrations(
    *,
    executor: TenantCodeExecutor,
    idle_tracker: IdleTracker,
    execution_timeout_seconds: int,
) -> Registrations:
    """Build the dynamic proxy + the activity that runs tenant code."""
    global _activity_timeout
    _activity_timeout = timedelta(
        seconds=execution_timeout_seconds + _ACTIVITY_TIMEOUT_BUFFER_SECONDS
    )

    @activity.defn(name=ACTIVITY_NAME)
    async def run_tenant_entry_point(request: dict[str, Any]) -> Any:
        idle_tracker.task_started()
        try:
            return await executor.run_entry_point(
                str(request.get("workflow_name", "")), request.get("payload")
            )
        finally:
            idle_tracker.task_finished()

    return Registrations(
        workflow_classes=[TenantProxyWorkflow],
        activities=[run_tenant_entry_point],
    )
