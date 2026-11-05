# Phase 3c: durable Workflows (file-level plan)

- **Branch / worktree:** `feat/durable-workflows-3c`,
  `/home/steve/repos/pegasus-durable-workflows-3c`.
- **Parent plan:** `plans/in-progress/durable-workflow-worker.md` ("3c" and
  "3c: what 3b changed"). Master plan:
  `plans/in-progress/long-running-workflows-and-automations.md`.
- **Status:** APPROVED by the user 2026-11-05 (plan + the staging probe).
  See "Progress" at the end.
- **Goal:** a tenant can publish a manifest with `kind = "workflow"`; a start
  runs it as a real, durable Temporal workflow in the tenant's own namespace,
  served by a long-lived worker subprocess in the tenant runner, pinned to
  the artifact it started on, surviving runner restarts, with the row's
  terminal status written back.
- **Out of scope (Phase 4/5, unchanged):** tenant-web Workflows UI,
  signal/event delivery into running Workflows, `run_automation()`, the
  Workflows authoring guide, an offline `test` harness for Workflows, and
  making the reconciler stop rescanning long-lived rows altogether.

## Open questions from "3c: what 3b changed": answers

**Q3: Temporal Python SDK in the runner image is 1.35.0, unpinned.** The
Dockerfile `pip install`s `temporalio>=1.7,<2` (SDK `pyproject.toml`) with no
lock, so the image gets whatever is newest at build time: the current image
(`:latest` = `872d63bf`, pushed 2026-11-04) resolved 1.35.0 (released
2026-10-28). The SDK's `uv.lock` (local dev, CI) is 1.29.0. Both have the API
3c needs (checked in a scratch venv):

- `Worker(..., deployment_config=WorkerDeploymentConfig(version=WorkerDeploymentVersion(deployment_name, build_id), use_worker_versioning=True, default_versioning_behavior=VersioningBehavior.PINNED))`
  (also on 1.29.0);
- `Client.start_workflow(..., versioning_override=PinnedVersioningOverride(...))`;
  the TS client the API uses (`@temporalio/client` 1.24.0) has
  `versioningOverride` on `workflow.start` too;
- no high-level deployment methods on `Client`; `SetWorkerDeploymentCurrentVersion`
  is only reachable as a raw `workflow_service` RPC (it has `allow_no_pollers`).

→ 3c pins `temporalio>=1.29,<2` in the runner and SDK floors (the API it
builds on), and the runner image installs from a lock (see the runner section)
so a rebuild can't move it silently.

**Q1: does a namespace-scoped Write key allow `SetWorkerDeploymentCurrentVersion`?
Still unverified; the recommended design doesn't need it.** Two designs:

- **(B, recommended) Pin at start.** The API starts every Workflow with
  `versioningOverride: pinned(deploymentName, buildId = artifactSha256)` of the
  exact row it chose. Postgres stays the only source of "which version runs":
  a trigger pinned to an older version runs that version, and the row's
  artifact is always the code that runs. No server-side "current version"
  state, no extra RPC, and Q1 doesn't matter.
  - **Cost, verified in server source** (`temporalio/temporal`
    `common/worker_versioning/worker_versioning.go`, called from
    `service/history/api/startworkflow/api.go`): a pinned start is refused
    with `FailedPrecondition` unless that version is a **member of the task
    queue**, i.e. a worker of that build has polled it at least once.
    Membership comes from the task queue's persisted user data
    (`CheckTaskQueueVersionMembership`, with a `GetTaskQueueUserData`
    fallback), not from live pollers, so it **should survive the runner
    idle-exiting**. That's inferred from source, so it's an acceptance check
    below.
  - So there's a window between publish and the new version's first poll.
    Handled by: finalize of a WORKFLOW row calls `ensureTenantRunner` (the
    runner registers the version within about 1–2 min), and a start that hits
    the precondition returns a retryable `WORKFLOW_VERSION_STARTING` (see the
    start path).
- **(A, fallback) Server current version.** Finalize calls
  `SetWorkerDeploymentCurrentVersion(allow_no_pollers=true)`; starts carry no
  override and queue on the current version even with no poller (the same
  scale-to-zero shape as Automations). No publish→poll gap, but: it needs the
  Write key to be allowed that RPC (Q1); a trigger pinned to an older version
  would silently run the current code unless it also passes an override (so
  it's a hybrid anyway); and a failed set leaves Postgres and the server
  disagreeing.
- **Probe (step 0 of implementation; needs your go-ahead: it's a Cloud-side
  write, staging only, reversible):** with the staging tenant's Write key:
  `get_system_info` (server version), `set_worker_deployment_current_version(deployment_name="probe-3c", build_id="x", allow_no_pollers=True)`
  then clear it (`build_id=""`) and record the probe deployment for cleanup.
  Reading the result: Cloud authorizes each RPC at the frontend before the
  handler runs, so `PermissionDenied` = Q1 **no**, while success or `NotFound`
  (deployment doesn't exist) = Q1 **yes**. **What the go-ahead covers:** the
  probe decrypts the staging tenant's namespace Write key (KMS, from
  `TenantTemporalNamespace`) into this session's memory for a one-off script;
  it's never written to disk or logged.
- **Gate before PR 3c.2:** B's key assumption (membership survives zero
  pollers) is tested in PR 3c.1's local e2e (below) against the same server
  code. If it fails there, switch to A only if the probe said yes; otherwise
  stop and come back to you. Staging acceptance re-checks it on Cloud.

**Q2: rotated keys reach worker subprocesses over their stdin, kept open as a
one-way JSON-lines control channel.** The first line is the start request
(address, namespace, key, `vnd_`, entry point, task queue, deployment
version); later lines are `{"type":"credentials","apiKey":…}` (the child sets
`client.api_key`, exactly like the shim's own refresh) and
`{"type":"shutdown"}`. `temporal_credentials.run_credentials_refresh` fans a
changed key out to every live worker subprocess. No child→shim channel is
needed: the idle hold comes from the broker (Q4), and health is the child's
exit code.

**Q4: the sweep already keeps the runner up for open Workflows; three things
around it must change.**

- `sweepTenantRunners` launches for every tenant with a QUEUED/RUNNING row
  that has a namespace, so an open WORKFLOW row triggers `ensureTenantRunner`
  every minute. **But** its `findMany` assumes the cap of 5 keeps it small; with
  up to 500 open Workflows per tenant it switches to a distinct-tenant query.
- **Idle flap:** `IdleTracker` counts only proxy activities. A Workflow waiting
  on a timer has nothing in flight, so the runner would idle-exit at 600 s and
  be relaunched a minute later, forever, re-downloading artifacts each time.
  Fix: the idle tracker gets a **hold**: it never exits while the broker
  reports any open WORKFLOW execution for the tenant (refreshed each discovery
  tick).
- **Kill switch vs DECIDE-4:** `ensureTenantRunner` returns `SKIPPED_DISABLED`
  for a disabled tenant, so a runner that dies while the switch is on would
  never come back and open Workflows would stall, contradicting "running
  Workflows continue". Fix: it still launches when the tenant has open
  WORKFLOW rows.
- **Reconciler: this is a blocker, not a Phase 4 deferral.** It takes the
  **global** oldest-first 100 RUNNING rows each tick (`orderBy startedAt asc,
take 100`). Once 100 Workflow rows are open anywhere, those same rows fill
  every batch and **no tenant's Automations are reconciled again**. Worse,
  WORKFLOW rows have **no write-back at all**: the terminal PATCH comes from
  the proxy activity, which Workflows bypass, so the reconciler is the only
  thing that will ever close a WORKFLOW row. 3c therefore splits it into two
  lanes (see the reconciler section).
- The same `kind` blindness applies to `tenantRunnerActiveWhere` /
  `findTenantsAtRunnerConcurrencyCap`: open Workflows would eat the cap of 5
  and park the tenant's events in the dispatcher. They're excluded.

## Decisions for you (recommendation first)

1. **Versioning design → B (pin at start)**, with A as the fallback, gated by
   the staging probe. OK to run the probe?
2. **Daily quota → WORKFLOW starts count toward the 200/day quota** (it limits
   starts, which Workflows still are); they don't count toward the cap of 5,
   and a new cap allows 500 open Workflows per tenant.
3. **Dry run of a WORKFLOW → refused** (422 `DRY_RUN_UNSUPPORTED`) in 3c. The
   dry-run path is the one-shot driver, where `wait_condition` fails by
   design.
4. **Runner size → keep 0.5 vCPU / 1 GiB, cap workflow worker subprocesses at
   8 per runner** (about 80–120 MB each, to be measured in acceptance), and
   log/metric when the cap bites. Raising the size to 1 vCPU / 2 GiB would
   roughly double DECIDE-3's ~$18/month per tenant with open Workflows; only if
   measurement says so.
5. **PR split → two PRs**, runner first (see Delivery).

## Design summary

- **Naming:** in the tenant's namespace, a Workflow named `n` gets its own task
  queue `pegasus-tenant-<id>-<env>-wfl-<n>` and Worker Deployment `n`; build id
  = `artifactSha256`. One queue per deployment: the WDV protos treat a task
  queue as belonging to one deployment ("Task Queues … moved to another Worker
  Deployment"), so sharing one `-wfl` queue across workflow names is avoided.
  `NAME_REGEX` (`[a-z0-9][a-z0-9_-]{0,63}`) is safe for both.
- **Which versions get a worker:** for each WORKFLOW-kind row the broker lists,
  if it's the newest version of its name, or it has open executions. A version
  whose last open execution closes (as the reconciler records it) is drained
  and stopped at the next discovery tick.
- **Execution lifecycle:** start path inserts QUEUED → Temporal start with the
  pinned override → `markStarted` (RUNNING), unchanged. Terminal status comes
  from the reconciler's WORKFLOW lane. Cancel/describe/history already use the
  row's `temporalNamespace`.

## File-level changes

### PR 3c.1: runner (inert until 3c.2 publishes WORKFLOW rows)

`tenant-runner.yml` pushes `:latest` on merge, independently of the API
deploy, so the runner ships first and must tolerate list rows without `kind` /
`openExecutions` (treated as `automation` / 0).

- `apps/tenant-runner/pegasus_tenant_runner/broker_client.py`: parse optional
  `kind` and `openExecutions` on `/tenant-workflows` rows (defaults as above);
  add `fetch_workflow_worker_grant(workflow_id) -> str` (`vnd_`), with 404 →
  `WorkerGrantUnavailable`.
- `.../artifacts.py`: `select_latest` keeps returning automations only (the
  proxy warm-up); new `select_workflow_versions(rows)` returns the WORKFLOW
  rows that should have a worker (newest per name, or `openExecutions > 0`).
- **New** `.../workflow_worker_driver.py`: runs inside the tenant venv, stdlib +
  temporalio only, executed by path like `subprocess_driver.py`. Calls
  `prctl(PR_SET_DUMPABLE, 0)` itself **before** reading stdin (the flag resets
  to 1 on `execve`, per `hardening.py`, so the original "inherited from the
  shim" bullet was wrong). Reads the start line, imports the entry module,
  collects the `@workflow.defn` class named by the entry point plus every
  module-level `@activity.defn` callable, and runs `Worker(client,
task_queue, workflows=[cls], activities=[…], deployment_config=…PINNED)`
  under Temporal's default **sandboxed** workflow runner. A stdin reader task
  applies `credentials` / `shutdown` lines; SIGTERM also drains. Activities
  get the `vnd_` token the same way the one-shot driver gives it to
  `PegasusClient.from_runtime()`.
- **New** `.../workflow_workers.py`: `WorkflowWorkerSupervisor`.
  - `reconcile(desired)`: spawn missing versions (prepare via the existing
    `WorkflowPreparer`, which keeps the sha256 TOCTOU gate; fetch a grant;
    build the env with `sandbox_env`), stop surplus ones (a `shutdown` line,
    then SIGTERM, then SIGKILL after a grace period), and restart crashed
    ones with exponential backoff (logged and metered, capped).
  - `push_credentials(key)`, `drain_all()`, `holds_open() -> bool`.
  - Enforces the per-runner cap (decision 4).
- `.../idle.py`: `IdleTracker` takes an optional `hold: Callable[[], bool]`;
  `should_exit()` is false while it returns true. Existing tests are unchanged
  and new ones are added.
- `.../runner.py`: a discovery loop (every 60 s: re-list, `supervisor.reconcile`,
  update the hold from `openExecutions`). The "nothing to run" exit also
  considers WORKFLOW rows. Shutdown (idle or SIGTERM) drains the proxy
  `Worker` **and** `supervisor.drain_all()`.
- `.../temporal_credentials.py`: on a changed key, also call
  `supervisor.push_credentials`.
- `.../executor.py`: defense in depth: refuse a WORKFLOW-kind row reached
  through the proxy (it never should be: different queues).
- `apps/tenant-runner/pyproject.toml`: **DEVIATION (as built):**
  `temporalio==1.35.0`, an exact pin, instead of a hashed lock. A lock would
  have split what ships from what CI's `pip-audit` audits (CI resolves `-e .`
  freshly), and Dependabot doesn't watch this directory, so the lock would
  rot. The exact pin gives the image, CI's install and its audit the one
  tested temporalio. Other transitive deps float as before. No Dockerfile
  change.
- Tests (pytest): `test_workflow_workers.py` (reconcile/cap/backoff/rotation fan-out,
  with a fake spawner); `test_idle.py` (hold); `test_broker_client.py` (optional
  fields, grant); `test_workflow_worker_e2e.py` against
  `WorkflowEnvironment.start_local()` (the `apps/temporal-worker` pattern): a
  sample Workflow waits on a timer and a `wait_condition`, the worker
  subprocess is killed and restarted mid-wait (replay), a v2 worker comes up and
  the v1 execution stays on v1 while a new start pins to v2, and a rotated key
  line is accepted. **Gate test:** v1 polls, v1's worker stops, then a pinned
  start of v1 with zero pollers succeeds (not `FailedPrecondition`), and runs
  once v1 polls again. Worker Deployment Versioning is off by default in the
  dev server: the fixture passes `dev_server_extra_args=["--dynamic-config-value", …]`
  with the keys the bundled server version uses (e.g.
  `system.enableDeploymentVersions=true`; older builds name them
  `frontend.workerVersioningWorkflowAPIs` / `…DataAPIs`). Without them the
  worker's `deployment_config` is rejected at poll.

### PR 3c.2: API, data, manifest, SDK, docs (turns it on)

- **Prisma** (`apps/api/prisma/schema.prisma` + additive migration):
  `enum WorkflowKind { AUTOMATION WORKFLOW }`; `Workflow.kind WorkflowKind
@default(AUTOMATION)`; `WorkflowExecution.reconciledAt DateTime?`; index
  `(status, reconciledAt)`. Hot file: serialize with other streams.
- `apps/api/src/handlers/workflows.ts` `ManifestSchema`: `kind`
  (`automation|workflow`, default automation), `signals: string[]` (validated,
  stored, not enforced: Phase 4), `maxLifetimeDays` (int 1–365, default 90,
  WORKFLOW only). `timeoutSeconds` is refused on a WORKFLOW (it's the
  Automation ceiling). Finalize persists `kind` and, for WORKFLOW, calls
  `ensureTenantRunner` so the new version registers. The old "422 unless
  ACTIVE" bullet is dropped: finalize already requests the namespace, and
  starts are gated on ACTIVE.
- `apps/api/src/lib/workflow-route.ts`: `workflowTaskQueue(tenantId, name)`.
- `apps/api/src/lib/start-workflow-execution.ts`: for `kind=WORKFLOW`:
  - same ACTIVE-namespace gate;
  - dry run → `DRY_RUN_UNSUPPORTED`;
  - open-Workflow cap (500, `TENANT_OPEN_WORKFLOW_CAP` env) instead of the
    cap of 5 → new outcome `OPEN_WORKFLOW_LIMIT`;
  - daily quota counted (decision 2);
  - task queue = `workflowTaskQueue`;
  - `workflowExecutionTimeout = maxLifetimeDays`;
  - `versioningOverride: { pinnedTo: { deploymentName: name, buildId: artifactSha256 } }`
    (`@temporalio/client` 1.24.0 encodes this as the new
    `override.pinned{version, behavior: PINNED}` oneof plus the deprecated
    `behavior`/`pinnedVersion` fields; the server's
    `ValidateVersioningOverrideStructure` takes the oneof path and requires
    the behavior, which it sets, checked in `workflow-options.js`);
  - a `FailedPrecondition` "not in task queue" deletes the never-started
    QUEUED row and returns new outcome `WORKFLOW_VERSION_STARTING` (handler:
    409 + `Retry-After`). The runner launch already happened before the insert
    (the existing `ensureTenantRunner` step), so nothing extra is kicked.
    Dispatcher: an EVENT occurrence is deferred like
    `TENANT_NAMESPACE_PROVISIONING`; a SCHEDULE tick is skipped with no
    catch-up, the same as `TENANT_MIGRATING`, so a Workflow scheduled right
    after its own publish can miss one tick.

  `tenantRunnerActiveWhere` and the daily/cap helpers filter
  `kind: AUTOMATION` for the cap of 5.

- `apps/api/src/handlers/workflows.ts` run handler +
  `apps/api/src/lambda-dispatch-*` (wherever outcomes are mapped): the two new
  outcomes.
- `apps/api/src/lib/tenant-runner.ts`:
  - sweep: a distinct-tenant query;
  - `ensureTenantRunner`: when `workflowsDisabled`, still launch if the tenant
    has open WORKFLOW rows (DECIDE-4).
- `apps/api/src/lambda-reconcile-workflow-executions.ts`: two lanes per tick.
  - **AUTOMATION lane:** today's query plus `workflow.kind = AUTOMATION`
    (fixes the starvation).
  - **WORKFLOW lane:** 100 RUNNING WORKFLOW rows, ordered by Prisma
    `orderBy: { reconciledAt: { sort: 'asc', nulls: 'first' } }` (no raw
    SQL), stamping `reconciledAt` on every check. Round-robin gives a bounded
    close latency of ⌈open/100⌉ minutes. No grace window beyond the existing
    5 min. Metric per lane.
  - The "hit batch cap" backlog warning stays on the AUTOMATION lane only: the
    WORKFLOW lane sits at a full 100 by design whenever 100+ Workflows are
    open.
- `apps/api/src/handlers/workflow-internal.ts`:
  - `/tenant-workflows` adds `kind` and `openExecutions` (one `groupBy`);
  - **new** `POST /workflow-worker-grant {workflowId}` → `{token}`. Rules:
    per-tenant `wbk_` only, tenant-confined (cross-tenant = 404), and only for
    `kind=WORKFLOW`, `executable`, `ACTIVE`, sha set, and newest-of-name or
    has open executions. `Cache-Control: no-store`; never logged.
  - `retire` keeps refusing while executions are open (already does).
- `apps/api/src/lib/openapi-spec.ts`: manifest fields, the new outcomes and
  error codes, and the grant route (internal tag).
- **Admin kill-switch label** (`apps/admin-web`, tenant form): "Disable new
  automation and workflow runs".
- **SDK** (`packages/workflows-sdk-python`):
  - `manifest.py`: `kind`, `signals`, `max_lifetime_days`, the cross-field
    rules, and TOML `kind = "workflow"`;
  - `package`/`push` validation;
  - CLI `--help` text;
  - README;
  - MCP `resource_guide_authoring` plus the manifest reference: drop
    "Workflows are not available yet", and document `kind`/`signals`/
    `maxLifetimeDays` and that `wait_condition`/timers work in Workflows only;
  - `temporalio>=1.29,<2`; CHANGELOG + version bump; **publish after merge**
    (tag `sdk-python-vX.Y.Z`).
- **Authoring repo** `~/repos/pegasus-workflows/CLAUDE.md`: the same manifest
  fields (separate repo, separate commit; noted in the PR).
- **Docs:** DECISIONS.md ("Durable Workflows pin at start; Postgres chooses
  the version"; "the reconciler is the only terminal writer for Workflows"),
  GOTCHAS.md (pinned start needs a polled version; `execve` resets dumpable).
- Tests (vitest): manifest kind rules; finalize persists kind + kicks runner;
  start routing (queue, timeout, override, open cap, quota, dry-run refusal,
  `WORKFLOW_VERSION_STARTING` deletes the row); cap-of-5 helpers ignore
  Workflows; sweep distinct + kill-switch launch; reconciler lanes
  (an Automation still reconciles with 150 open Workflows; round-robin
  stamping); grant route (tenant confinement, every refusal); `tenant-workflows`
  new fields; OpenAPI coverage. pytest for the SDK manifest.

## Delivery

1. **Probe** (staging, with your go-ahead): Q1 + server version. Result goes
   into this file.
2. **PR 3c.1** (runner) → merge → `:latest` rolls out; nothing changes for
   Automations (verified: an NW Automation run after the deploy). Its local
   membership gate test must pass before 3c.2 starts.
3. **PR 3c.2** (API/SDK/docs) → merge → deploy → SDK publish.
4. **Acceptance (staging tenant):**
   - publish a Workflow that sleeps 15 min (longer than the 600 s idle window)
     then waits on a condition with a timeout; a start before the first poll
     gets `WORKFLOW_VERSION_STARTING`, and a retry starts it;
   - the runner stays up (hold), then we stop it by hand: the sweep relaunches
     within about a minute and the Workflow completes;
   - **after all Workflows close and the runner idle-exits, a pinned start of
     the same version succeeds** (membership survives: B's key assumption);
   - publish v2 mid-run: v1 finishes on v1 and new starts run v2;
   - the row goes COMPLETED via the WORKFLOW lane;
   - with the kill switch on, a start is refused and the open Workflow still
     completes;
   - an Automation for the same tenant is unaffected throughout.

## Risks

- **B's membership assumption** (from source, not observed). Gated by 3c.1's
  local e2e before 3c.2 is built, and re-checked on Cloud in acceptance;
  fallback A is gated by the probe.
- **Cloud server version vs the source read** (`main`). `get_system_info` in the
  probe pins it.
- **Memory** per worker subprocess (decision 4); measured in acceptance.
- **WORKFLOW close latency** = ⌈open/100⌉ min via the reconciler, until Phase 4
  gives Workflows a write-back.
- **Namespace cap request** (3a) is still owed to Temporal support.

## Progress

- **2026-11-05: approved; Q3 spike.** A local dev server (1.32.2) confirmed
  design B's premise before any code: a pinned start of a never-polled version
  is refused ("Pinned version 'wf:v1' is not present in task queue"); after
  one poll, a pinned start with zero pollers is ACCEPTED and runs when the
  version polls again, still pinned to v1.
- **2026-11-05: PR 3c.1 (runner) built.** `workflow_workers.py` (supervisor),
  `workflow_worker_driver.py` (driver; self-hardening, stdin control
  channel), idle hold, discovery loop, key fan-out, `kind`/`openExecutions`
  parsing with defaults, worker-grant client, executor refusal, exact
  temporalio pin. pytest 149 passed (was 122), ruff clean. The real-server
  e2e (`tests/test_workflow_worker_e2e.py`, 19 s) passes: timer +
  `wait_condition` + signal; the activity sees the `vnd_` token; worker
  killed mid-wait → restarted → replayed; v1 stays v1 after v2 publishes; a
  rotated key reaches live workers; **the gate: zero-poller pinned start
  accepted after all workers drained**. Image built locally: temporalio
  1.35.0, and the driver hardens and imports in a `--system-site-packages`
  venv inside the container (exit 4 on a bad request, not 5).
- **Probe (Q1): BLOCKED on AWS SSO** (staging token expired 2026-11-05; the
  user was asked to log in). Not on 3c.1's path; design B no longer depends
  on it.
- **2026-11-05: review fixes on 3c.1.** A stop that lands while a worker is
  spawning could hang the drain and orphan a key-holding child: fixed (kill
  on cancel, kill if stopped mid-spawn; 2 tests that fail without the fix).
  Drain budget sized to ECS's default 30 s `stopTimeout` (driver graceful 6 s,
  supervisor 8 s per step). CI sets `PEGASUS_REQUIRE_TEMPORAL_DEV_SERVER=1` so
  the design-B gate fails instead of skipping. **The one prod-visible change
  of 3c.1:** every live runner re-lists `/tenant-workflows` once a minute.
- **Resume path for 3c.2:** 3c.1's PR tears this worktree down after it
  merges. Start 3c.2 in a fresh worktree off `main`
  (`scripts/new-worktree.sh feat durable-workflows-3c2`) with this plan file;
  the PR 3c.2 section above is its checklist.
