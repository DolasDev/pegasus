"""Dynamic Temporal registrations — proxy workflows + the one activity.

The shim must register the tenant's workflow NAMES with Temporal without
ever importing tenant code (a Python import executes arbitrary module-level
code in the process that holds the ``wbk_`` token). So for each prepared
workflow it manufactures a tiny PROXY workflow class:

* registered under the tenant workflow's name — the exact string the API's
  run path starts (``client.workflow.start(workflow.name, ...)``),
* whose entire body is one ``execute_activity("run_tenant_entry_point")``
  call with ``maximum_attempts=1`` (the executor PATCHes a terminal status
  after the first attempt; an automatic Temporal retry would collide with
  the row's state machine),
* unsandboxed (``sandboxed=False``): the proxy is trusted shim code with a
  deterministic one-call body, and Temporal's import-reload sandbox can't
  re-import dynamically manufactured classes.

Class manufacturing detail: ``@workflow.run`` refuses local classes and
``workflow.defn`` requires the run method's ``__qualname__`` to live on the
class, so the factory copies a module-level template function per proxy and
rewrites its ``__qualname__`` before decorating. Pinned by tests.

The single activity wraps the executor and feeds the idle tracker — every
start/finish bumps the tracker so the idle-exit watchdog only fires when the
runner is genuinely quiet.
"""

from __future__ import annotations

import types
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow

from .artifacts import PreparedWorkflow
from .executor import TenantCodeExecutor
from .idle import IdleTracker

__all__ = ["ACTIVITY_NAME", "Registrations", "build_registrations", "make_proxy_workflow"]

ACTIVITY_NAME = "run_tenant_entry_point"

#: Buffer added to the activity start_to_close timeout on top of the
#: subprocess wall-clock budget, so the in-shim kill always fires first and
#: the TIMED_OUT status PATCH happens before Temporal times the activity out.
_ACTIVITY_TIMEOUT_BUFFER_SECONDS = 30

#: Set by :func:`build_registrations`; read by proxy bodies at run time.
#: Module-level (not closure) because the template function is copied per
#: proxy — globals survive the copy, closures complicate it. Proxies run
#: unsandboxed so the read is permitted; the value is constant for the
#: process lifetime (the runner is ephemeral), keeping replays deterministic
#: within a runner incarnation.
_activity_timeout: timedelta = timedelta(seconds=900 + _ACTIVITY_TIMEOUT_BUFFER_SECONDS)


async def _proxy_run_template(self: Any, payload: Any = None) -> Any:
    """Body shared by every proxy workflow (copied per class).

    ``workflow.info().workflow_type`` is the registered name == the tenant
    workflow's name, so one template serves all proxies without baking
    per-workflow state into the class.
    """
    from temporalio.common import RetryPolicy

    return await workflow.execute_activity(
        ACTIVITY_NAME,
        {"workflow_name": workflow.info().workflow_type, "payload": payload},
        start_to_close_timeout=_activity_timeout,
        retry_policy=RetryPolicy(maximum_attempts=1),
    )


def _safe_class_name(workflow_name: str) -> str:
    return "TenantProxy_" + "".join(ch if ch.isalnum() else "_" for ch in workflow_name)


def make_proxy_workflow(workflow_name: str) -> type:
    """Manufacture one proxy workflow class registered as ``workflow_name``."""
    class_name = _safe_class_name(workflow_name)
    run_copy = types.FunctionType(
        _proxy_run_template.__code__,
        _proxy_run_template.__globals__,
        name="run",
        argdefs=_proxy_run_template.__defaults__,
        closure=_proxy_run_template.__closure__,
    )
    run_copy.__qualname__ = f"{class_name}.run"
    decorated_run = workflow.run(run_copy)
    cls = type(class_name, (), {"run": decorated_run, "__module__": __name__})
    return workflow.defn(name=workflow_name, sandboxed=False)(cls)


@dataclass(frozen=True)
class Registrations:
    """Everything :class:`temporalio.worker.Worker` needs from us."""

    workflow_classes: list[type]
    activities: list[Callable[..., Coroutine[Any, Any, Any]]]


def build_registrations(
    prepared: list[PreparedWorkflow],
    *,
    executor: TenantCodeExecutor,
    idle_tracker: IdleTracker,
    execution_timeout_seconds: int,
) -> Registrations:
    """Build proxy classes + the activity for every prepared workflow."""
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

    workflow_classes = [make_proxy_workflow(p.name) for p in prepared]
    return Registrations(
        workflow_classes=workflow_classes,
        activities=[run_tenant_entry_point],
    )
