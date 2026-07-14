"""Tenant-code subprocess driver — runs INSIDE the tenant's venv.

Invoked by the shim as ``<venv python> -P <path to this file>`` with the
stripped environment from :mod:`pegasus_tenant_runner.sandbox_env`. From the
moment this script imports the tenant's entry-point module, EVERYTHING in
this process is tenant-controlled — which is exactly why the process starts
with no secrets beyond the tenant's own ``vnd_`` runtime token (delivered
over stdin, never argv/env-at-exec, so it appears in neither ``/proc/*/
cmdline`` nor ``/proc/*/environ``).

Constraints:

* **stdlib + temporalio imports only.** The driver is executed by file path
  (``-P`` keeps its directory off ``sys.path``) so it must not import the
  rest of ``pegasus_tenant_runner`` — the shim's httpx clients have no
  business in the tenant process.
* stdin carries one JSON request::

      {"entryPoint": "a.b:Cls", "payload": {...}, "runtimeToken": "vnd_...",
       "apiBaseUrl": "https://...", "resultPath": "/...scratch/result.json"}

* The verdict is written to ``resultPath`` as
  ``{"ok": true, "result": ...}`` or ``{"ok": false, "error": "..."}``.
  A result file (not stdout) because tenant code owns stdout — print()
  noise must never corrupt the protocol.

Direct-execution mode
─────────────────────
Tenant workflows are authored as Temporal workflow classes (the SDK's
``@pegasus_workflow`` + ``@workflow.run``), but this process has NO Temporal
connection — connection details are deliberately absent. Instead the driver
patches the handful of ``temporalio.workflow`` orchestration primitives to
direct equivalents and runs the workflow body as plain asyncio:

* ``execute_activity`` / ``execute_local_activity`` → call the activity
  callable in-process (``@activity.defn`` returns the original callable).
* ``sleep`` → ``asyncio.sleep``; ``now`` → ``datetime.now(UTC)``;
  ``uuid4`` → ``uuid.uuid4``.

v1 semantics, documented for workflow authors: the whole workflow runs as
ONE unit of work inside the platform's per-execution timeout. Durable
Temporal replay, signals, queries, and per-activity retries are not
available to tenant code yet — the proxy activity wrapping this subprocess
is what Temporal sees.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import traceback
import uuid
from datetime import UTC, datetime
from typing import Any

#: Sentinel mirroring temporalio's unset-arg marker for execute_activity.
_UNSET = object()

#: Env var the SDK's PegasusClient.from_runtime() reads to enter dry-run mode.
_DRY_RUN_ENV_VAR = "PEGASUS_DRY_RUN"


def _json_safe(value: Any) -> Any:
    """Return ``value`` if JSON-serializable, else its ``repr`` — for the trace.

    Activity args/results are arbitrary tenant data; the trace must survive the
    JSON write even when a value isn't serializable.
    """
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        return repr(value)
    return value


def _install_direct_execution_patches(trace: list[dict[str, Any]] | None = None) -> None:
    """Replace Temporal orchestration primitives with direct equivalents.

    Module-attribute patching is process-global on purpose: workflow modules
    import ``workflow`` from ``pegasus_workflows`` (a re-export of
    ``temporalio.workflow``), so patching the module is what makes the
    tenant's orchestration calls work without a server.

    When ``trace`` is provided (dry-run), each activity call appends a
    ``{activity, args, result}`` record to it — the per-activity trace the
    web-UI dry-run view renders. This is the natural capture point: every
    tenant activity call already flows through this wrapper.
    """
    from temporalio import workflow

    async def _direct_execute_activity(
        activity: Any,
        arg: Any = _UNSET,
        *,
        args: Any = None,
        **_kwargs: Any,
    ) -> Any:
        if isinstance(activity, str):
            raise RuntimeError(
                "string-name activities are not supported in the Pegasus tenant "
                "runner — pass the activity callable itself"
            )
        call_args: list[Any] = []
        if args:
            call_args = list(args)
        elif arg is not _UNSET:
            call_args = [arg]
        result = activity(*call_args)
        if inspect.isawaitable(result):
            result = await result
        if trace is not None:
            trace.append(
                {
                    "activity": getattr(activity, "__name__", repr(activity)),
                    "args": _json_safe(call_args),
                    "result": _json_safe(result),
                }
            )
        return result

    workflow.execute_activity = _direct_execute_activity  # type: ignore[assignment]
    workflow.execute_local_activity = _direct_execute_activity  # type: ignore[assignment]
    workflow.sleep = asyncio.sleep  # type: ignore[assignment]
    workflow.now = lambda: datetime.now(UTC)  # type: ignore[assignment]
    workflow.uuid4 = uuid.uuid4  # type: ignore[assignment]


def _resolve_run_callable(target: Any) -> Any:
    """Return an awaitable-producing callable for the entry-point target.

    Workflow classes expose their ``@workflow.run`` method via the
    ``__temporal_workflow_definition`` the SDK's decorator applied; plain
    async callables are accepted as-is (forward-compat with non-class entry
    points).
    """
    defn = getattr(target, "__temporal_workflow_definition", None)
    if defn is not None and getattr(defn, "run_fn", None) is not None:
        instance = target()
        run_fn = defn.run_fn
        return lambda payload: run_fn(instance, payload)
    if inspect.isclass(target):
        run = getattr(target, "run", None)
        if run is None or not inspect.iscoroutinefunction(run):
            raise RuntimeError(
                f"entry point class {target.__name__} has no async run method"
            )
        instance = target()
        return instance.run
    if callable(target):
        return target
    raise RuntimeError(f"entry point target {target!r} is not callable")


def _import_entry_point(entry_point: str) -> Any:
    import importlib

    module_path, sep, attr = entry_point.partition(":")
    if not module_path or not sep or not attr:
        raise RuntimeError(f"entry point {entry_point!r} must be 'module.path:Attribute'")
    module = importlib.import_module(module_path)
    try:
        return getattr(module, attr)
    except AttributeError as exc:
        raise RuntimeError(
            f"module {module_path!r} has no attribute {attr!r}"
        ) from exc


def _write_result(result_path: str, verdict: dict[str, Any]) -> None:
    try:
        serialized = json.dumps(verdict)
    except (TypeError, ValueError):
        # Non-JSON-serializable workflow result: degrade to its repr rather
        # than losing the run.
        if verdict.get("ok"):
            serialized = json.dumps({"ok": True, "result": repr(verdict.get("result"))})
        else:  # pragma: no cover - error strings are always serializable
            serialized = json.dumps({"ok": False, "error": "unserializable error"})
    with open(result_path, "w", encoding="utf-8") as fh:
        fh.write(serialized)


def main() -> int:
    try:
        request = json.loads(sys.stdin.read())
        entry_point = request["entryPoint"]
        payload = request["payload"]
        result_path = request["resultPath"]
        runtime_token = request.get("runtimeToken", "")
        api_base_url = request.get("apiBaseUrl", "")
        dry_run = bool(request.get("dryRun"))
    except (ValueError, KeyError) as exc:
        print(f"pegasus driver: invalid request: {exc!r}", file=sys.stderr)
        return 4

    # The tenant's contract for calling the Pegasus API from workflow code:
    # PegasusClient(base_url=os.environ["PEGASUS_API_BASE_URL"],
    #               token=os.environ["PEGASUS_RUNTIME_TOKEN"]).
    # Set in-process AFTER exec, so the values never appear in the exec-time
    # environment (/proc/<pid>/environ snapshots exec-time env only).
    if api_base_url:
        os.environ["PEGASUS_API_BASE_URL"] = api_base_url
    if runtime_token:
        os.environ["PEGASUS_RUNTIME_TOKEN"] = runtime_token

    # Dry-run FAILS CLOSED: a dry run is only benign if the workflow's bundled
    # SDK actually suppresses mutations. If the SDK is too old to support
    # dry-run, refuse to run rather than perform real side effects under a
    # "dry-run" label. When supported, set PEGASUS_DRY_RUN so
    # from_runtime() returns a dry-run client, and reset the capture sink.
    trace: list[dict[str, Any]] | None = None
    if dry_run:
        try:
            from pegasus_workflows import api as _pw_api

            reset = _pw_api.reset_dry_run_captures
        except (ImportError, AttributeError):
            _write_result(
                result_path,
                {
                    "ok": False,
                    "error": (
                        "dry-run requires a newer pegasus-workflows-sdk: this "
                        "workflow's bundled SDK does not support dry-run capture. "
                        "Republish with an SDK that exposes PEGASUS_DRY_RUN."
                    ),
                },
            )
            return 3
        reset()
        os.environ[_DRY_RUN_ENV_VAR] = "1"
        trace = []

    try:
        _install_direct_execution_patches(trace)
        target = _import_entry_point(entry_point)
        run = _resolve_run_callable(target)
        result = asyncio.run(run(payload))
    except BaseException:
        _write_result(result_path, {"ok": False, "error": traceback.format_exc(limit=20)})
        return 3

    if dry_run:
        from pegasus_workflows import api as _pw_api

        result = {
            "dryRun": True,
            "return": _json_safe(result),
            "trace": trace or [],
            "captured": _pw_api.get_dry_run_captures(),
        }

    _write_result(result_path, {"ok": True, "result": result})
    return 0


if __name__ == "__main__":
    sys.exit(main())
