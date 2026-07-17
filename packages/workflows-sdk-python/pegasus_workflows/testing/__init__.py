"""Offline test harness for Pegasus workflow activities.

The problem this solves (``sdk-feedback/0015`` Part C): a workflow's whole job is
to perform side effects, and the only ways to exercise one were (a) ``pegasus-
workflows test`` — which injects **no** runtime client, so every activity falls
back to a hand-written ``if client is None: return {"stub": True}`` branch and
runs *control flow only* — or (b) a real run, which actually sends the SMS /
closes the task / POSTs to the partner. Neither runs an activity's real body
benignly.

This module lets an activity's **real** body run offline (no Docker, no network),
against canned reads, with every side effect captured for assertion instead of
performed:

.. code-block:: python

    from pegasus_workflows.testing import fake_client, run_activity
    from my_workflow.workflow import map_order_to_external_body, close_task_activity

    client = fake_client(reads={"get_order": {"S-123": {"orderNumber": "S-123"}}})

    body = run_activity(map_order_to_external_body, "S-123", client=client)
    assert client.captured == []               # map is a benign read — nothing sent

    run_activity(close_task_activity, "S-123", client=client)
    assert client.captured[0]["capability"] == "CloseTask"   # captured, not performed
    assert client.captured[0]["args"]["order_id"] == "S-123"  # same shape as a dry-run

``run_activity`` runs the activity inside Temporal's own
:class:`temporalio.testing.ActivityEnvironment`, so ``activity.info()``,
``activity.heartbeat()`` etc. behave as in a real worker — it is not a bespoke
invoker. The fake client mirrors :class:`~pegasus_workflows.api.PegasusClient`'s
runtime surface; ``fake_client`` is injected by patching
``PegasusClient.from_runtime`` for the duration of the call, so activity code that
does ``PegasusClient.from_runtime()`` (directly or via a ``_runtime_client()``
helper) transparently gets the fake and its real body runs — retiring the
``if client is None`` stub pattern from shipped source.

The classification of each method as a benign **read** or a captured **mutation**
mirrors the platform's Cedar ``required_actions`` gating (a read is idempotent and
safe to run live; a mutation must never be performed in a test). It is the same
surface the Phase A server-side ``--dry-run`` mode exposes via
``client.is_dry_run`` / ``client.record_side_effect``, so author code behaves
identically offline here and server-side there.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

__all__ = ["fake_client", "run_activity", "FakeClient", "CaptureError"]


class CaptureError(RuntimeError):
    """Raised when the fake is asked for a read with no fixture supplied."""


# --- method classification (mirrors PegasusClient's runtime capability surface) -
#
# READS are idempotent and safe to serve from canned fixtures. MUTATIONS are
# side-effecting — the fake never performs them; it records a capture entry and
# returns a synthetic success. IGNORED are publish/CLI/inspection calls that are
# not part of the in-activity runtime surface; calling one against the fake is
# almost certainly a mistake, so it raises. The union of the three sets is
# asserted against PegasusClient's real public methods by
# ``tests/test_testing_harness.py`` so a newly-added SDK method can't silently
# slip through unclassified (the drift the MCP api-reference introspection also
# guards against).

#: read method -> callable extracting its fixture key from (args, kwargs), or
#: ``None`` for reads whose fixture is a single canned value returned as-is.
_READS: dict[str, Callable[[tuple, dict], Any] | None] = {
    # keyed single-record reads: fixture is {key: value}
    "get_order": lambda a, k: _first(a, k, "order_id"),
    "get_task": lambda a, k: _first(a, k, "task_id"),
    "get_config": lambda a, k: _first(a, k, "name"),
    "get_secret": lambda a, k: _first(a, k, "name"),
    "map_to_external": lambda a, k: _first(a, k, "integration_id"),
    "map_from_external": lambda a, k: _first(a, k, "integration_id"),
    "get_projection": lambda a, k: a[2] if len(a) > 2 else k.get("key"),
    "get_blob": lambda a, k: _first(a, k, "blob_id"),
    "get_blob_url": lambda a, k: _first(a, k, "blob_id"),
    # list / whole-value reads: fixture is the value returned as-is
    "list_customers": None,
    "list_quotes": None,
    "list_moves": None,
    "list_inventory": None,
    "list_invoices": None,
    "list_events": None,
    "list_orders": None,
    "list_tasks": None,
    "list_projections": None,
    "list_secrets": None,
    "list_configs": None,
    "validate_integration_config": None,
    "get_integration_config": None,
    "list_integration_config_versions": None,
    "list_floors": None,
    "get_floor": None,
}

#: mutation method -> the Cedar action (``capability``) it is gated by.
_MUTATIONS: dict[str, str] = {
    "emit_event": "EmitTenantEvent",
    "send_sms": "SendSms",
    "close_task": "CloseTask",
    "put_projection": "WriteIntegrationProjection",
    "delete_projection": "WriteIntegrationProjection",
    "publish_integration_config": "PublishIntegrationConfig",
    "rollback_integration_config": "PublishIntegrationConfig",
    "set_secret": "ManageWorkflowSecrets",
    "delete_secret": "ManageWorkflowSecrets",
    "set_config": "ManageWorkflowConfigs",
    "delete_config": "ManageWorkflowConfigs",
    "deliver_to_external": "DeliverToExternal",
    "put_blob": "WriteBlob",
}

#: hybrid method(s) — read *or* mutation depending on the call's arguments, so
#: they can't live in a single table. ``call_external`` is a read for GET/HEAD/
#: OPTIONS (or ``mutating=False``) — served live under the real dry-run, from a
#: path-keyed fixture offline — and a mutation otherwise (captured). Dispatched by
#: :meth:`FakeClient._call_external`; still counted by the anti-drift union.
_HYBRID: frozenset[str] = frozenset({"call_external"})

#: publish / CLI / execution-inspection methods — not the in-activity surface.
_IGNORED: frozenset[str] = frozenset(
    {
        "request_upload_url",
        "upload_artifact",
        "finalize",
        "run_workflow",
        "list_executions",
        "get_execution",
        "get_execution_history",
        "fork_workflow",
        "list_workflows",
        "get_workflow",
        "get_download_url",
        "download_artifact",
        "create_trigger",
        "list_triggers",
        "delete_trigger",
        "create_ingress",
        "rotate_ingress",
        "get_ingress",
    }
)


def _first(args: tuple, kwargs: dict, name: str) -> Any:
    """The first positional arg, else the ``name`` keyword — a fixture key."""
    if args:
        return args[0]
    return kwargs.get(name)


class FakeClient:
    """A :class:`~pegasus_workflows.api.PegasusClient`-shaped test double.

    Reads are served from ``reads`` fixtures; mutations are captured to
    :attr:`captured` and never performed. Exposes :attr:`is_dry_run` (always
    ``True``) and :meth:`record_side_effect` so activity code that branches on
    the dry-run surface behaves the same here as under the server-side
    ``--dry-run`` mode.
    """

    #: Always ``True`` — a fake client is, by definition, a benign rehearsal.
    is_dry_run: bool = True

    def __init__(self, reads: Mapping[str, Any] | None = None) -> None:
        self._reads: dict[str, Any] = dict(reads or {})
        #: Ordered list of captured side effects. Each entry has the SAME shape as
        #: the server-side dry-run capture record — ``{method, capability, args, wouldReturn}``
        #: (``args`` is a named dict, not a positional tuple) — so an offline
        #: assertion describes the real web-UI dry-run trace (sdk-feedback/0016).
        self.captured: list[dict[str, Any]] = []
        #: Lazily-built real ``PegasusClient`` in dry-run mode. Mutations delegate
        #: to it so the capture record is produced by the same code the runner uses
        #: (identical shape by construction, no parallel curation table to drift).
        self._dry: Any = None

    # -- author-facing dry-run surface (mirrors PegasusClient in dry-run) -----

    def record_side_effect(self, label: str, payload: Any = None) -> None:
        """Record an effect the harness can't infer (e.g. a raw outbound call).

        Uses the same record shape as ``PegasusClient.record_side_effect`` in
        dry-run: ``{method, capability, label, payload}``.
        """
        self.captured.append(
            {
                "method": "record_side_effect",
                "capability": "custom",
                "label": label,
                "payload": payload,
            }
        )

    # -- dispatch ------------------------------------------------------------

    def __getattr__(self, name: str) -> Callable[..., Any]:
        # __getattr__ only fires for names not found normally, so real
        # attributes (captured, is_dry_run, _reads) are unaffected.
        if name in _HYBRID:  # call_external — read or mutation by args
            return lambda *a, **k: self._call_external(a, k)
        if name in _READS:
            return lambda *a, **k: self._read(name, a, k)
        if name in _MUTATIONS:
            return lambda *a, **k: self._mutation(name, a, k)
        if name in _IGNORED:
            raise AttributeError(
                f"fake_client does not support {name!r}: it is a publish/CLI/"
                "inspection call, not part of the in-activity runtime surface."
            )
        raise AttributeError(
            f"{type(self).__name__!r} has no attribute {name!r} "
            "(not a known PegasusClient runtime method)."
        )

    def _read(self, name: str, args: tuple, kwargs: dict) -> Any:
        key_fn = _READS[name]
        if name not in self._reads:
            # get_projection legitimately returns None for an un-cached record;
            # every other read needs an explicit fixture to be meaningful.
            if name == "get_projection":
                return None
            raise CaptureError(
                f"no fixture for read {name!r}. Pass "
                f"fake_client(reads={{{name!r}: ...}}) to serve it."
            )
        fixture = self._reads[name]
        if key_fn is None:
            return fixture
        key = key_fn(args, kwargs)
        if isinstance(fixture, Mapping):
            if key in fixture:
                return fixture[key]
            if name == "get_projection":
                return None
            raise CaptureError(
                f"no fixture for {name}({key!r}); "
                f"reads[{name!r}] has keys {sorted(fixture)}."
            )
        # A non-mapping fixture for a keyed read is returned as-is.
        return fixture

    def _call_external(self, args: tuple, kwargs: dict) -> Any:
        """Route ``call_external`` to read-serving or mutation-capture by its args.

        A ``GET``/``HEAD``/``OPTIONS`` (or ``mutating=False``) is a read: under the
        real ``--dry-run`` it runs live, but the offline harness has no partner to
        reach, so it is served from a ``reads={"call_external": {path: value}}``
        fixture (path-keyed, like the other keyed reads). Anything else is a
        mutation, captured via the shared :meth:`_mutation` path (byte-identical
        record shape to the server-side dry run).
        """
        method = str(kwargs.get("method", "GET")).upper()
        mutating = kwargs.get("mutating")
        is_mutation = mutating if mutating is not None else method not in ("GET", "HEAD", "OPTIONS")
        if is_mutation:
            return self._mutation("call_external", args, kwargs)
        if "call_external" not in self._reads:
            raise CaptureError(
                "no fixture for read call_external (a GET runs live under the real "
                "dry-run, but the offline harness has no partner to reach). Pass "
                "fake_client(reads={'call_external': {path: value}}) — a mapping "
                "keyed by request path, or a single value returned as-is."
            )
        fixture = self._reads["call_external"]
        path = kwargs.get("path")
        if isinstance(fixture, Mapping):
            if path in fixture:
                return fixture[path]
            raise CaptureError(
                f"no fixture for call_external(path={path!r}); "
                f"reads['call_external'] has keys {sorted(fixture)}."
            )
        return fixture

    def _mutation(self, name: str, args: tuple, kwargs: dict) -> Any:
        """Capture a mutation by delegating to a real dry-run ``PegasusClient``.

        The real client's mutating methods short-circuit before any network in
        dry-run — each calls ``_capture_mutation`` first, appending the canonical
        ``{method, capability, args (named dict), wouldReturn}`` record and
        returning the synthetic result without an HTTP call. Reusing that path
        means the offline record is byte-for-byte the shape the runner surfaces,
        with no second curation table to keep in sync (sdk-feedback/0016).
        """
        # Lazy import: api pulls in httpx, kept out of the sandboxed workflow
        # module graph until a test actually exercises a mutation.
        from ..api import PegasusClient

        if self._dry is None:
            self._dry = PegasusClient(
                base_url="http://dry-run.invalid", token="dry-run", dry_run=True
            )
        before = len(self._dry.captured)
        result = getattr(self._dry, name)(*args, **kwargs)
        # The real method appended exactly one canonical record; mirror it.
        self.captured.extend(self._dry.captured[before:])
        return result


def fake_client(reads: Mapping[str, Any] | None = None) -> FakeClient:
    """Build a :class:`FakeClient` seeded with canned ``reads``.

    Args:
        reads: Fixture map ``{method_name: fixture}``. For keyed single-record
            reads (``get_order``, ``get_task``, ``get_config``, ``get_secret``,
            ``map_to_external``, ``get_projection``) the fixture is a mapping
            ``{key: value}`` (e.g. ``{"get_order": {"S-123": {...}}}``). For
            list/whole-value reads (``list_orders``, ``validate_integration_config``,
            …) the fixture is the value returned as-is.

    Returns:
        A fake client whose reads come from ``reads`` and whose mutations are
        captured to ``.captured`` instead of performed.
    """
    return FakeClient(reads)


@contextlib.contextmanager
def _inject(client: FakeClient) -> Iterator[None]:
    """Patch ``PegasusClient.from_runtime`` to return ``client`` for the block.

    Covers every import style — ``from pegasus_workflows import PegasusClient``
    and ``from pegasus_workflows.api import PegasusClient`` both resolve to the
    same class object, so patching it there patches all callers.
    """
    # Imported lazily: api pulls in httpx, a test-only dependency that must never
    # land in a workflow's sandboxed module graph merely by importing this module.
    from .. import api as _api

    original = _api.PegasusClient.__dict__.get("from_runtime")

    def _fake_from_runtime(cls: Any, *, timeout: float = 30.0) -> FakeClient:
        return client

    _api.PegasusClient.from_runtime = classmethod(_fake_from_runtime)  # type: ignore[assignment]
    try:
        yield
    finally:
        if original is not None:
            _api.PegasusClient.from_runtime = original  # type: ignore[assignment]


def run_activity(activity_fn: Callable[..., Any], *args: Any, client: FakeClient) -> Any:
    """Run one activity's real body offline with ``client`` injected.

    The activity is executed inside :class:`temporalio.testing.ActivityEnvironment`
    (a real activity context), and ``PegasusClient.from_runtime`` is patched to
    return ``client`` for the duration — so an activity that builds its client via
    ``PegasusClient.from_runtime()`` runs its real body against the fake, and the
    ``if client is None`` stub branch is never taken.

    Works for both ``async def`` and plain ``def`` activities. Must be called
    outside a running event loop (the common synchronous-test case); inside an
    ``async`` test, ``await`` :func:`arun_activity` instead.

    Args:
        activity_fn: The ``@activity.defn``-decorated activity callable.
        *args: Positional arguments passed to the activity.
        client: The :class:`FakeClient` to inject.

    Returns:
        Whatever the activity returns.
    """
    from temporalio.testing import ActivityEnvironment

    with _inject(client):
        result = ActivityEnvironment().run(activity_fn, *args)
        # ActivityEnvironment.run returns the callable's result directly: a
        # coroutine for an async activity, a plain value for a sync one.
        if inspect.isawaitable(result):
            return asyncio.run(result)
        return result


async def arun_activity(
    activity_fn: Callable[..., Any], *args: Any, client: FakeClient
) -> Any:
    """Async variant of :func:`run_activity`, for use inside an ``async`` test."""
    from temporalio.testing import ActivityEnvironment

    with _inject(client):
        result = ActivityEnvironment().run(activity_fn, *args)
        if inspect.isawaitable(result):
            return await result
        return result
