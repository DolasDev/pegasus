# Tenant runner serves stale bytes — prepare per published row, not once per name (sdk-feedback 0034)

- **Branch:** `fix/runner-per-version-prepare`
- **Goal:** make publish→run **deterministic** instead of time-dependent. A warm
  runner task must execute the artifact belonging to the workflow row the
  execution points at — every time, immediately, with no waiting and no operator
  action.

## Context (so any agent can resume without re-reading the codebase)

`sdk-feedback/0034` is the longest-running defect in the SDK feedback set: filed
2026-07-23, re-diagnosed three times, and **only the last diagnosis is correct**.
The earlier ones (a `sys.modules` cache keyed by package path; then "a warm task
that self-clears if you wait") are recorded in the item purely to show what the
symptoms looked like from outside. Do not act on them.

### The actual mechanism, confirmed in this repo's source

1. `apps/api/src/lib/tenant-runner.ts` — the dispatcher keys runner reuse on the
   **tenant id and nothing else** (`ListTasks { cluster, startedBy: tenantId }`).
   One task per tenant serves every workflow and every version it is handed.
2. `apps/tenant-runner/pegasus_tenant_runner/runner.py:127` — `prepare_all` runs
   **once, at task startup**, over `select_latest(listed)` (latest version per
   workflow _name_, as of that instant), and hands the executor
   `{p.name: p for p in prepared}`.
3. `executor.py:122` — every execution is served from that memo by **name**:
   `self._prepared.get(workflow_name)`, else
   `"workflow {name!r} is not prepared on this runner"`.

**There is no refresh.** The bytes a task serves are frozen at "latest per name,
at the instant the task started", for the task's whole life. Consequences, all
observed in the field:

- A version published _after_ the task started can never execute on it.
- An explicit `@version` at run time is **not honored** — the memo is keyed by
  name and populated from `select_latest`, so the dispatch line printing `@0.6.1`
  is describing the row, not the bytes.
- A brand-new workflow _name_ is worse than stale: it isn't in the memo at all,
  so it fails with `not prepared on this runner`. (`proxy.py` also manufactures
  one Temporal proxy class per prepared name at startup, so the Worker isn't even
  registered for a name published later.)
- Renaming the Python package changes nothing — the memo key is the workflow
  name, not the module path.
- Every execution **resets the idle timer**, so polling to check whether a fix
  landed is precisely what keeps the stale task alive.

**Idle-exit itself is healthy** — the item's corrected timing evidence
(2026-08-12) shows a 12.6-minute quiet gap DID clear the condition; an earlier
revision's "waiting is falsified" claim was a measurement error (under
`--dry-run` the workflow's return value is nested at `result["return"]`, so
reading `result["workflowVersion"]` yields `None` for every run regardless of
which build executed). `idle.py` reads correctly on inspection and needs no
change. So the defect is precisely and only "a live task is frozen at
latest-per-name from its startup instant" — the remedy today is to end the task's
life, which is either an operator action or a wait during which every check you
make renews the lease.

### Why the fix must reach the API too

The Temporal start args are `[{ executionId, input, dryRun }]`
(`start-workflow-execution.ts`) — **no workflow id, no version**. The runner
literally cannot know which published row it is being asked to run. Something has
to carry that.

## Design decisions

1. **Carry the identity on the broker's runtime-token response, NOT the Temporal
   envelope.** The envelope is handed to tenant `run()` as its input argument, so
   adding a key there changes the documented author-facing input contract (and
   the SDK docs that describe it). The executor already calls
   `POST /internal/workflow-runtime-token` once per execution, and that handler
   already loads `execution.workflowId` and the workflow row — so returning
   `{workflowId, workflowName, workflowVersion}` alongside the token is internal,
   additive, and free.
2. **Deploy-order safe in both directions.** New runner + old API (response lacks
   the fields) → falls back to a **freshly listed** latest-by-name, which still
   fixes staleness. Old runner + new API → today's behavior until the task cycles.
   Neither direction requires a coordinated release.
3. **Cache keyed by `workflow_id`, prepared lazily on demand.** `workflow_id` is
   already unique per published row, so it subsumes `(name, version)`. On a miss
   the executor lists, finds that id, and prepares it — the download/extract/venv
   path already exists.
4. **On-disk directory per id** (`<work>/<name>/<id>`, keeping the name for
   traceback readability). Today `prepare_workflow` `rmtree`s `<work>/<name>`,
   which would delete the directory of a _different version of the same name_
   while a subprocess is executing out of it.
5. **Single-flight per id.** Two concurrent executions of the same freshly
   published id must not both extract into one directory (the cap is 5 concurrent
   per tenant, so this is reachable, not theoretical).
6. **One dynamic Temporal proxy instead of one class per name.**
   `@workflow.defn(dynamic=True)` (temporalio 1.27.2 in the image; supported well
   before that) catches any workflow type, so a name published after task start
   routes to the executor and gets prepared on demand instead of failing with
   `not prepared on this runner` — or, worse, hanging until the 900 s timeout
   because the Worker never registered it. This is what makes acceptance criterion
   3 (a different-named workflow) reachable at all on a warm task.
7. **Fail loudly, never silently substitute.** If the requested id cannot be
   prepared, the execution FAILS with a message naming the id and version. The old
   behavior — serve whatever bytes are around — is exactly the defect.
8. **Keep the eager `prepare_all` at startup** (warms latest-per-name into the
   id-keyed cache, preserving first-run latency), but make the "nothing runnable →
   exit 0" decision follow the **listing**, not the prepare results: with lazy
   preparation, an eager failure is no longer terminal for that workflow.
9. **Log how the row was resolved.** Every run logs `resolved_by=id` or
   `resolved_by=name`. The name path is the old-API fallback, and it is the ONE
   case where the bytes may not be `execution.workflowId`'s row — i.e. where the
   join-derived `workflowVersion` could lie. It exists only during a
   new-runner/old-API deploy window, and it must be loud rather than silent, so
   the transitional state is a known one instead of an unannounced hole in the
   guarantee below.
10. **No `idle.py` change.** "Executions must not renew a stale lease" is satisfied
    by per-execution resolution — renewing the lease is harmless once the task
    always serves current bytes.

### Deliberately NOT adding a DB column

The item asks twice for the executed build to be surfaced. The obvious shape —
`executedWorkflowVersion` on `WorkflowExecution` — needs a migration in
`apps/api/prisma/schema.prisma`, which is on the repo's **merge-magnet** list, and
the in-flight `reporting-dashboards-phase2` worktree already has a migration
(`20260812173801_add_dashboard_definitions_and_user_prefs`) touching it. Two
streams on one hot file must serialize, and this fix should not wait behind an
unrelated one.

Migration-free equivalent, taken instead:

- After this change the runner runs the artifact of `execution.workflowId`
  **or fails** — so that already-persisted column _is_ the executed build, by
  construction rather than by assertion.
- The execution read surface gains `workflowName` + `workflowVersion`, derived
  through the existing `workflow` relation in `EXECUTION_SELECT` (a join, not a
  new column), so an author reads the executed version straight off the execution
  instead of making a second `get_workflow` call.

If a genuinely independent record of the executed bytes is wanted later, it should
be its own additive column once the schema file is quiet.

## Out of scope for this session

The decisive acceptance criterion — publish a new version and run it
**immediately**, while a warm task from the previous version is still inside its
idle window — is a live-infra check and belongs to a post-deploy session against a
real tenant runner. CI can prove the resolution logic and the failure modes; it cannot
prove ECS task reuse. The item's Validation Log stays empty here.

Two things that session must control for, both of which have already produced
false readings in this item's history:

- **A warm task keeps its old image until it cycles**
  (`temporal-worker-stack.ts:423`). A task that predates the deploy is still
  running the OLD shim, so the fix is unobservable on it — confirm task recency,
  or stop the tenant's runner task, before concluding anything.
- **Read the dry-run result at the right depth.** This one cost the original
  investigation an entire wrong conclusion: under `--dry-run` the workflow's
  return value is nested at `result["return"]`, next to `dryRun` / `captured` /
  `trace`. Reading `result["workflowVersion"]` returns `None` for every run no
  matter which build executed — which reads exactly like permanent staleness.
- **Re-fork before probing.** The field reports ran GLOBAL workflows through an
  `nw` fork; a fork not re-taken after the GLOBAL publish leaves the tenant's
  latest row at the old version, reproducing "old version ran" for reasons that
  have nothing to do with this defect.

## Checklist

### API (broker + read surface)

- [x] `handlers/workflow-internal.ts` — `POST /internal/workflow-runtime-token`
      also returns `workflowId`, `workflowName`, `workflowVersion` (the handler
      already has the execution row and fetches the workflow row for the
      ciphertext — extend the `select`). Additive; the shared-secret stdlib worker
      ignores them. Keep `Cache-Control: no-store`.
- [x] `repositories/workflow-execution.repository.ts` — include the workflow
      relation's `name`/`version` in `EXECUTION_SELECT` and on
      `WorkflowExecutionRow`.
- [x] `handlers/workflows.ts` — `toExecutionResponse` exposes `workflowName` +
      `workflowVersion`. Check `lib/openapi-spec.ts` for whether the executions
      GETs pin a response schema that needs the fields too.
- [x] Tests: the token endpoint returns the identity fields and still 404s
      cross-tenant / on a terminal execution; the execution response carries the
      version.

### Tenant runner

- [x] `artifacts.py` — `prepare_workflow` writes to `<work>/<name>/<id>` and
      `rmtree`s only that leaf. `PreparedWorkflow` carries the workflow `id`.
- [x] New preparer (in `artifacts.py` or its own module) — id-keyed cache, lazy
      `prepare_by_id`, per-id single-flight lock, soft count cap with
      refcount-guarded eviction (never evict something executing). Create the
      per-id `asyncio.Lock` with a plain `setdefault` on the event loop and no
      `await` between check and insert; the prepare itself runs in `to_thread`
      while the lock is held. A lock created inside the threaded section would
      reintroduce the very race it guards.
- [x] `broker_client.py` — parse the new runtime-token response fields; tolerate
      their absence (old API ⇒ fall back).
- [x] `executor.py` — resolve the prepared workflow from the token response's
      `workflowId` (fresh list + prepare on miss); fall back to a **freshly
      listed** latest-by-name only when the API didn't supply an id; fail loudly
      with the id/version in the message when preparation fails. Log the version
      actually executed on every run.
- [x] `proxy.py` — one `@workflow.defn(dynamic=True, sandboxed=False)` proxy.
      Dynamic run receives `Sequence[RawValue]`; decode
      `workflow.payload_converter().from_payload(args[0].payload)` — note it is
      the RawValue's `.payload`, not the RawValue — and write the empty-args /
      non-dict guard test BEFORE the happy path.
      `workflow.info().workflow_type` still yields the name.
- [x] `runner.py` — keep eager `prepare_all` (feeding the id-keyed cache), decide
      exit-0 on the empty **listing**, build the dynamic registration.
- [x] Tests: cache hit; miss → prepares the requested id; requested id unknown →
      loud failure (not a substitution); no-id legacy fallback; single-flight
      (two concurrent misses ⇒ one prepare); two versions of one name coexisting
      on disk; dynamic-proxy payload decode + empty-args guard.

### Land

- [x] `npm run typecheck`, full `apps/api` vitest, `ruff check` + `pytest` for
      `apps/tenant-runner`. Worktree needs `npm run db:generate` first.
- [x] **`/security-review` is mandatory** — the diff touches
      `apps/tenant-runner/**` and an internal broker endpoint. The TOCTOU sha
      gate, tenant confinement on the token endpoint, and the extractor's
      hostile-archive defenses must all still hold; the new lazy path must run the
      same `sha256` verification as the eager one (it reuses `prepare_workflow`,
      so this is a "prove it in a test" item, not a "hope" item).
- [x] SDK discovery: `run --help` / `run.py` docstring and the README state that
      a run executes exactly the resolved row's bytes (`@version` is honored) and
      that the execution row reports `workflowName`/`workflowVersion`. The
      docstring's "Phase 2 scope-lock … only curated stdlib workflows" claim is
      stale and gets corrected while there. SDK touched ⇒ 0.36.3 + CHANGELOG, tag
      after deploy.
- [x] Archive the plan into `plans/completed/` in the implementation commit; one
      PR through the merge queue.

## Found during the security review (fixed here)

The resolve step makes NETWORK calls inside the execution for the first time — a
broker listing, plus the artifact download on a cache miss — but the handler's
`except` tuple only covered the artifact errors. A `BrokerError` or
`httpx.HTTPError` escaped uncaught, failing the Temporal activity **without**
PATCHing the execution row, leaving it `RUNNING` until the reconcile poller. Both
are now caught and patched `FAILED`, with a test each.

Also fixed while writing the eviction test: a just-installed row could evict
_itself_ when every other entry was pinned, handing back a directory that had been
`rmtree`d. Eviction now protects the row it just prepared.

## Files touched

| File                                                         | Change                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `apps/api/src/handlers/workflow-internal.ts`                 | runtime-token response carries the workflow identity   |
| `apps/api/src/repositories/workflow-execution.repository.ts` | join workflow name/version into the row                |
| `apps/api/src/handlers/workflows.ts`                         | expose them on the execution response                  |
| `apps/tenant-runner/pegasus_tenant_runner/artifacts.py`      | per-id directories + id on `PreparedWorkflow`          |
| `apps/tenant-runner/pegasus_tenant_runner/executor.py`       | per-execution resolution, lazy prepare, loud failure   |
| `apps/tenant-runner/pegasus_tenant_runner/broker_client.py`  | parse the new response fields                          |
| `apps/tenant-runner/pegasus_tenant_runner/proxy.py`          | one dynamic proxy                                      |
| `apps/tenant-runner/pegasus_tenant_runner/runner.py`         | eager warm-up feeds the cache; exit-0 on empty listing |
| `apps/tenant-runner/tests/*`                                 | executor/proxy/artifacts coverage above                |

## Risks / side effects

- **Disk growth.** Each prepared version costs an extracted tree + a venv. Bounded
  by a soft count cap; the runner's ~10-minute life and 5-concurrent cap keep the
  real number small. Eviction must never remove a directory an executing
  subprocess is running out of — refcount, not a bare LRU.
- **First run of a new version pays the prepare cost** (download + extract + venv,
  seconds) inside the activity's wall-clock budget rather than at task startup.
  The eager warm-up keeps the common case unchanged; the budget is 900 s.
- **Dynamic registration widens what the queue accepts.** Any workflow type
  submitted to the tenant's own queue now reaches the executor instead of being
  refused by Temporal. The queue is per-tenant and the executor still refuses
  anything not listed as executable for that tenant, so the trust boundary is
  unchanged — but this belongs in the security review, not a comment.
- **`test_proxy.py` pins the class-manufacturing detail** (`__qualname__` rewrite
  for `@workflow.run`). The dynamic proxy retires that machinery, so those tests
  are rewritten, not patched.
- **Not a hot-file collision** by design — see "Deliberately NOT adding a DB
  column". Nothing here touches `schema.prisma`, `cedar.schema.json`,
  `actions.ts`, `router.tsx`, or `AppShell.tsx`.
