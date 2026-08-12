"""Per-published-row artifact preparation, resolved at EXECUTION time.

This module exists because of sdk-feedback 0034. The runner used to call
``prepare_all`` once at task startup — ``select_latest`` per workflow *name* —
and memoize the result in a dict keyed by name. Nothing ever refreshed it, and
the dispatcher reuses one runner task per tenant (keyed on the tenant id and
nothing else), so a live task served whatever was latest at the instant it
started, for its whole life:

* a version published while a task was warm could not run on it at all;
* an explicit ``@version`` was silently ignored — the memo was keyed by name;
* a brand-new workflow name failed with "not prepared on this runner";
* and every execution renewed the idle lease, so checking whether a fix had
  landed was itself what kept the stale task alive.

The fix is to key preparation on the **published row id** and do it lazily, on
the execution path, where the id is finally known (the broker's runtime-token
response carries it). Three properties follow, and each is load-bearing:

1. **Exact bytes.** A prepared entry is the artifact of one ``workflow_id``.
2. **No substitution.** A row that cannot be prepared raises — the old
   behavior, serving whatever bytes happened to be around, is the defect.
3. **Coexistence.** Several versions of one name can be prepared at once, so
   preparing a new version never disturbs one that is mid-execution.

Preparation itself is unchanged: :func:`prepare_workflow` still downloads,
re-hashes against the finalize-recorded ``artifactSha256`` (the TOCTOU gate),
extracts with the hostile-archive defenses, and builds the pip-less venv. This
module only decides WHICH row to prepare, WHEN, and how many to keep.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from .artifacts import PreparedWorkflow, prepare_workflow, select_latest
from .broker_client import ExecutableWorkflow, TenantBrokerClient

log = logging.getLogger(__name__)

__all__ = ["WorkflowNotAvailableError", "WorkflowPreparer"]

#: Soft cap on simultaneously-prepared rows. Each costs an extracted tree plus
#: a venv, and a runner lives ~10 minutes with at most 5 concurrent executions,
#: so this is a backstop against a pathological publish loop rather than a
#: capacity knob. Entries in use are never evicted.
DEFAULT_MAX_PREPARED = 32


class WorkflowNotAvailableError(RuntimeError):
    """The requested published row is not executable for this tenant.

    Raised instead of falling back to another version — substituting bytes is
    precisely the defect this module exists to remove.
    """


class WorkflowPreparer:
    """Resolves + prepares published workflow rows, keyed by workflow id."""

    def __init__(
        self,
        *,
        broker: TenantBrokerClient,
        work_root: Path,
        max_unpacked_bytes: int,
        max_prepared: int = DEFAULT_MAX_PREPARED,
    ) -> None:
        self._broker = broker
        self._work_root = work_root
        self._max_unpacked_bytes = max_unpacked_bytes
        self._max_prepared = max(1, max_prepared)
        self._prepared: dict[str, PreparedWorkflow] = {}
        # Per-id single-flight, so two concurrent executions of one freshly
        # published row don't both extract into the same directory.
        self._locks: dict[str, asyncio.Lock] = {}
        # Refcount of in-flight executions per id — eviction never touches a
        # directory a subprocess is running out of.
        self._in_use: dict[str, int] = {}

    # -- seeding -------------------------------------------------------------

    def seed(self, prepared: list[PreparedWorkflow]) -> None:
        """Adopt eagerly-prepared rows (the startup warm-up) into the cache."""
        for p in prepared:
            self._prepared[p.workflow_id] = p

    @property
    def prepared_ids(self) -> list[str]:
        return list(self._prepared)

    # -- resolution ----------------------------------------------------------

    def _list(self) -> list[ExecutableWorkflow]:
        return self._broker.list_executable_workflows()

    def _find_by_id(
        self, listed: list[ExecutableWorkflow], workflow_id: str
    ) -> ExecutableWorkflow | None:
        return next((wf for wf in listed if wf.id == workflow_id), None)

    def _find_latest_by_name(
        self, listed: list[ExecutableWorkflow], name: str
    ) -> ExecutableWorkflow | None:
        return next((wf for wf in select_latest(listed) if wf.name == name), None)

    async def _prepare(self, wf: ExecutableWorkflow) -> PreparedWorkflow:
        prepared = await asyncio.to_thread(
            prepare_workflow,
            self._work_root,
            wf,
            max_unpacked_bytes=self._max_unpacked_bytes,
        )
        self._prepared[wf.id] = prepared
        log.info(
            "runner.workflow_prepared",
            extra={
                "workflow_id": wf.id,
                "workflow_name": wf.name,
                "version": wf.version,
                "lazy": True,
            },
        )
        # `protect` matters: the row we just installed is not pinned yet (the
        # caller pins it on the way out of `use`), and with every other entry
        # busy it would otherwise be the only eviction candidate — i.e. it
        # would delete its own directory and hand back a path that no longer
        # exists.
        self._evict_if_over_cap(protect=wf.id)
        return prepared

    async def _resolve(
        self, *, workflow_id: str | None, workflow_name: str
    ) -> tuple[PreparedWorkflow, str]:
        """Return the prepared row plus how it was resolved (``id``/``name``)."""
        if workflow_id and (hit := self._prepared.get(workflow_id)) is not None:
            return hit, "id"

        # The lock keyspace has to cover the name path too: without an id there
        # is nothing else to serialize on, and two concurrent first-runs of one
        # name would otherwise both list + prepare.
        key = workflow_id or f"name:{workflow_name}"
        # setdefault with no await in between — a lock created inside the
        # threaded section below would not serialize anything.
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if workflow_id and (hit := self._prepared.get(workflow_id)) is not None:
                return hit, "id"

            listed = await asyncio.to_thread(self._list)

            if workflow_id:
                wf = self._find_by_id(listed, workflow_id)
                if wf is None:
                    raise WorkflowNotAvailableError(
                        f"workflow row {workflow_id} ({workflow_name!r}) is not an "
                        "executable workflow for this tenant — it may have been "
                        "deleted, or its artifact never finalized"
                    )
                return await self._prepare(wf), "id"

            # Legacy fallback: the API did not tell us which row this is (an
            # API older than sdk-feedback 0034). Resolve the latest row for the
            # name FRESHLY — never from the startup memo, which is the staleness
            # this whole module removes. Logged as resolved_by=name because it
            # is the one path where the executed bytes may not be the ones the
            # execution row points at.
            wf = self._find_latest_by_name(listed, workflow_name)
            if wf is None:
                raise WorkflowNotAvailableError(
                    f"workflow {workflow_name!r} is not an executable workflow for "
                    "this tenant"
                )
            if (hit := self._prepared.get(wf.id)) is not None:
                return hit, "name"
            return await self._prepare(wf), "name"

    @asynccontextmanager
    async def use(
        self, *, workflow_id: str | None, workflow_name: str
    ) -> AsyncIterator[tuple[PreparedWorkflow, str]]:
        """Resolve + pin one prepared row for the duration of an execution.

        Pinning is what makes eviction safe: a directory is only removed while
        no subprocess is running out of it.
        """
        prepared, resolved_by = await self._resolve(
            workflow_id=workflow_id, workflow_name=workflow_name
        )
        key = prepared.workflow_id
        self._in_use[key] = self._in_use.get(key, 0) + 1
        try:
            yield prepared, resolved_by
        finally:
            remaining = self._in_use.get(key, 1) - 1
            if remaining > 0:
                self._in_use[key] = remaining
            else:
                self._in_use.pop(key, None)

    # -- eviction ------------------------------------------------------------

    def _evict_if_over_cap(self, *, protect: str | None = None) -> None:
        """Drop the oldest idle rows once the cache is over its soft cap.

        Insertion order (dicts preserve it) stands in for recency: the runner
        is short-lived and re-preparing is a download away, so an approximation
        is worth more than an LRU's bookkeeping. Rows with an in-flight
        execution — and the row named by ``protect`` — are skipped, never
        evicted, so the cache may legitimately sit above the cap while work is
        running.
        """
        while len(self._prepared) > self._max_prepared:
            victim = next(
                (
                    wid
                    for wid in self._prepared
                    if wid != protect and self._in_use.get(wid, 0) == 0
                ),
                None,
            )
            if victim is None:
                log.info(
                    "runner.prepared_cache_over_cap_all_in_use",
                    extra={"prepared": len(self._prepared), "cap": self._max_prepared},
                )
                return
            entry = self._prepared.pop(victim)
            self._locks.pop(victim, None)
            # src_dir is <work>/<name>/<id>/src — remove the whole row dir.
            shutil.rmtree(entry.src_dir.parent, ignore_errors=True)
            log.info(
                "runner.prepared_evicted",
                extra={
                    "workflow_id": victim,
                    "workflow_name": entry.name,
                    "version": entry.version,
                },
            )
