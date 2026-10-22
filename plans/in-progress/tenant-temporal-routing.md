# 3b.2: route tenant Automations to their own Temporal namespace

- **Status:** MERGED #855 (`76a51b68`, deployed 2026-10-15). **Staging
  acceptance PASSED 2026-10-19/22** (results under "Acceptance"). NEXT: the
  prod rollout (runbook at the bottom), then archive.
- **Branch:** `feat/tenant-temporal-routing` (merged, torn down); one PR
  (Decision 1).
- **Goal:** TENANT_RUNNER executions for a cut-over tenant run in that tenant's
  own Temporal Cloud namespace, with that tenant's scoped key, on a runner that
  holds no shared Temporal secret.
- **Written:** seed 2026-10-15 (end of 3b.1); expanded into this plan
  2026-10-15 against `main` @ `8fd47f1f`.
- **Parent plans:** `plans/in-progress/durable-workflow-worker.md` (3a/3b/3c);
  `plans/in-progress/long-running-workflows-and-automations.md` (D1–D5);
  3b.1 (done) `plans/completed/f0d47ffb-tenant-temporal-namespaces.md`, its
  "Design decision: no platform service account" and "3b.2 sketch" sections.

## Why

D5 (verified live in Phase 2): a tenant's code is isolated only once it runs in
its **own** namespace with a namespace-scoped key. Today every Automation runs
in the shared `pegasus-<env>` namespace with the shared key. 3b.1 built the
namespaces; 3b.2 makes something use them.

## Where things stand (2026-10-15)

- Provisioner live in staging + prod (`temporal-provisioner` Lambda): creates
  `pg-<env>-<12 hex of tenantId>`, a namespace-scoped **Write** SA and a 1-year
  key, KMS-encrypted on `TenantTemporalNamespace`. Admin-web: Provision, Retry,
  Rotate key, Deprovision. Statuses: `PROVISIONING | READY | FAILED |
DEPROVISIONING`.
- Keys rotate themselves (#838): daily `daily-maintenance` rotates from 45 days
  out via a pending slot (served only after the readiness check); previous key
  retired 24 h after the swap; expiry alarm under 30 days.
- Staging acceptance of 3b.1 passed 2026-10-13. Staging test tenant
  `4b2e0267-c597-451e-a367-771dfac52fba` ("AVP Smoke 2026-05-08") was
  deprovisioned and can be provisioned again for 3b.2 acceptance.
- **Nothing routes to tenant namespaces yet.** Prod has no
  `TenantTemporalNamespace` rows.
- **Prod Automation traffic (read-only query, 2026-10-15; 19 live tenants):**

  | Tenant                              | Executable non-curated workflows | Runs, last 30 d                                          | Enabled triggers                                      | Last run   |
  | ----------------------------------- | -------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- | ---------- |
  | Dolios `a90b22bc-…`                 | 11                               | 1,459 (all FAILED: the SMS trigger, disabled 2026-10-05) | 0                                                     | 2026-10-05 |
  | Nelson Westerberg Test `32dd89be-…` | 2                                | 1                                                        | 0                                                     | 2026-09-25 |
  | Nelson Westerberg `9d869236-…`      | 5                                | 0                                                        | 1 (EVENT `feedback.submitted` → `demo-pack-call-ack`) | 2026-08-12 |

  So prod has **no live Automation traffic** today; the 100-namespace cap does
  not bind for prod's 3 candidates.

## Facts this plan relies on (verified)

- `tenant-temporal-namespace.repository` → `getDecryptedKey(tenantId)` returns
  `{namespace, grpcAddress, apiKeyId, apiKey}` for the **current** key only.
  Callers: `handlers/workflow-internal.ts` `GET /temporal-credentials` (Stage A,
  READY-only today) and the provisioner.
- The key works on the namespace endpoint (`grpcAddress`) and the regional
  endpoint; it is refused by `pegasus-<env>` on both.
- After a rotation the old key works for 24 h, then is deleted. A holder must
  re-fetch on PERMISSION_DENIED / UNAUTHENTICATED.
- New-key permissions land per API; `lib/temporal-namespace-readiness.ts`
  (`namespaceKeyAuthorized`) is the check.
- Cloud Ops (only if touched; 3b.2 doesn't plan to): ≤10 concurrent async ops
  per account; 100-namespace cap shared by staging+prod; provisioner can't list
  a tenant's keys (403); `async_operation_id` unique per operation. See GOTCHAS
  "Temporal Cloud Ops".
- **Temporal callers in the API today** (all via the single
  `lib/temporal-client.ts` → `getTemporalClient()`):
  - `lib/start-workflow-execution.ts` (start; used by the run handler, retry,
    and the trigger dispatcher);
  - `handlers/workflows.ts` history (`/:id/executions/:executionId/history`)
    and cancel;
  - `lambda-reconcile-workflow-executions.ts`.
  - `lambda-dispatch-workflow-triggers.ts` `fireTrigger`'s duplicate pre-check is
    **DB-only** (`workflowExecution.findFirst` on `temporalWorkflowId`), so it
    needs no change. It also guards cross-namespace duplicates: workflow-id
    uniqueness in Temporal is per namespace, so after a cutover the DB row is
    the only thing preventing a redelivered EVENT from starting a second run.
- SCHEDULE triggers are evaluated by the dispatcher's cron (`lib/cron.ts`), not
  Temporal Schedules; nothing lives in the shared namespace that must migrate.
- `ensureTenantRunner` dedupes with `ListTasks { startedBy: tenantId }`, which is
  **family-blind**; `startedBy` is the 36-char tenant id, so it can't carry the
  family.
- `loadTenantRunnerConfig` returns null unless **all** `TENANT_RUNNER_*` keys are
  present (a partial config = "no runner plane").
- The tenant runner pins `temporalio>=1.7`; the installed 1.30 exposes
  `ServiceClient.update_api_key` (hot key swap on a live connection).
- The reconcile Lambda (`ReconcileWorkflowExecutionsFunction`,
  `packages/infra/lib/stacks/api-stack.ts`) has **no**
  `workflowTokenKey.grantEncryptDecrypt` and no `WORKFLOW_TOKEN_KMS_KEY_ID`. The
  API Lambda and the dispatcher already have both.
- Rotation and the tenant expiry gauge filter on `status: 'READY'`
  (`findDueForRotation`, `earliestReadyKeyExpiry`). Deprovision is already
  refused unless READY or FAILED.

## Design (decided here; technical, not put to the user)

### State machine

`TenantTemporalNamespaceStatus` gains three additive values:

```
PROVISIONING → READY ──cutover──▶ DRAINING ──(zero open shared rows)──▶ ACTIVE
                 ▲                                                        │
                 └────────(zero open tenant-ns rows)──── REVERTING ◀──rollback
```

| Status                                            | TENANT_RUNNER starts go to         | Broker serves key | Runner family                  | Rotates |
| ------------------------------------------------- | ---------------------------------- | ----------------- | ------------------------------ | ------- |
| (no row) / PROVISIONING / FAILED / DEPROVISIONING | shared                             | no                | legacy                         | —       |
| READY                                             | shared                             | no                | legacy                         | yes     |
| DRAINING                                          | **refused 409 `TENANT_MIGRATING`** | no                | legacy (drains shared rows)    | yes     |
| ACTIVE                                            | tenant namespace                   | yes               | scoped                         | yes     |
| REVERTING                                         | **refused 409 `TENANT_MIGRATING`** | yes               | scoped (drains tenant-ns rows) | yes     |

- **ACTIVE sits beside READY** (Decision 4): READY = provisioned, not
  routed, which is a real state (the staging acceptance tenant lives there).
- **REVERTING is its own state** because during a rollback drain the open
  executions live in the tenant namespace and still need the scoped runner and
  the broker key, the opposite of DRAINING.
- STDLIB (curated) starts are **never** refused or rerouted by any status: they
  always go to the platform namespace.
- **Who advances DRAINING→ACTIVE and REVERTING→READY:** the trigger dispatcher
  tick (`lambda-dispatch-workflow-triggers.ts`, every minute, already
  cross-tenant). Each tick, for each DRAINING/REVERTING row: count the tenant's
  QUEUED/RUNNING rows in the namespace being drained; at zero, CAS via the
  existing `transition(tenantId, [DRAINING], 'ACTIVE')`. Log + metric per
  transition.
- **Flip race, defused by the row, not a lock:** a start that read READY just
  before the flip to DRAINING can still insert a shared-namespace row after the
  zero count. That row is not stranded, because (a) the row records its
  namespace at insert, and (b) the runner sweep launches runners per
  (tenant, family) from the open rows, not from tenant status (below). The
  stray row gets a legacy runner and finishes; nothing about ACTIVE stops a
  shared row from completing. Test this interleaving explicitly.
- Deprovision stays READY/FAILED-only; add tests that DRAINING/ACTIVE/REVERTING
  refuse. Deprovisioning after a revert loses Temporal history for executions
  that ran in that namespace; history returns "unavailable", not 500 (below).

### Execution rows carry their namespace

- `WorkflowExecution.temporalNamespace String? @map("temporal_namespace")`,
  additive, nullable. **Null = the shared namespace** (all legacy rows).
- Written on the **QUEUED insert**, not after the Temporal start: a row that
  exists already knows where it lives. STDLIB rows write null.
- Readers never re-derive the namespace from tenant status.

### Per-namespace Temporal client (`lib/temporal-client.ts`)

- Keep `getTemporalClient()` as the shared/platform client (env key, unchanged).
- Add `getTemporalClientForNamespace(db, { tenantId, namespace })`:
  - `namespace` null or equal to `TEMPORAL_NAMESPACE` → shared client.
  - Otherwise `getDecryptedKey(tenantId)` and **assert** `key.namespace ===
namespace` (never hand a tenant's key to another namespace; a mismatch is a
    bug, throw); connect to `key.grpcAddress` with TLS + the key.
  - Cache per namespace: `{ client, apiKeyId, expiresAt = now + 10 min }`. The
    short TTL bounds how long a stale entry survives in a warm container.
  - `withTenantTemporalClient(db, target, fn)` runs `fn(client)`; on
    PERMISSION_DENIED / UNAUTHENTICATED (gRPC 7 / 16) it evicts, re-fetches and
    retries **once**. A second auth failure propagates. Evicted connections are
    closed.
  - Test hook mirrors `_setTemporalClientForTesting`, keyed by namespace.
- Callers switched:
  - start path: chooses the namespace (ACTIVE → the tenant row's namespace,
    else null), writes it on insert, starts through the wrapper;
  - history + cancel: read `execution.temporalNamespace`; NotFound on a
    namespace whose row is gone → empty history with an `unavailable` flag
    (history) / 409 (cancel), not 500;
  - reconcile Lambda: groups orphans by namespace; a failure on one namespace
    (e.g. key fetch) skips that group and continues.
- **`FakeTemporal` for tests (3b.1 lesson, #844/#845):** holds a key→namespace
  map, **refuses** a scoped key on another namespace, returns PERMISSION_DENIED
  once a key is retired, and lets the code re-fetch and succeed. Every client
  test runs against it, not a permissive stub.

### Start path ordering (`lib/start-workflow-execution.ts`)

For TENANT_RUNNER:

1. dry-run / disabled / must-fork / cap / quota checks (unchanged);
2. **read the tenant's namespace row**: DRAINING or REVERTING → new outcome
   `TENANT_MIGRATING` (nothing written, **no runner launched**), so this comes
   **before** `ensureTenantRunner`;
3. `ensureTenantRunner(db, tenantId, { family })`, family from step 2's
   namespace;
4. insert QUEUED with `temporalNamespace`;
5. start through the per-namespace client.

Mapping: `TENANT_MIGRATING` → 409 `{ code: 'TENANT_MIGRATING' }` with a retry
hint. The dispatcher maps it to a skip reason (SCHEDULE: a skipped tick, per the
no-catch-up contract; EVENT rows never reach it, see below). The 409-during-drain
is kept from the seed: the drain is bounded (15-min Automation cap), so queuing
USER starts buys little.

### Dispatcher: EVENT outbox during a drain

- Exclude DRAINING and REVERTING tenants **at the query**:
  `where: { dispatchedAt: null, tenantId: { notIn: migrating } }`, `migrating`
  loaded once per tick. Never stamp them, never park them at the head of the
  oldest-first, 100-per-tick queue (GOTCHAS "A global oldest-first outbox drain
  - an infinite park = one tenant starves the rest").
- This also delays a migrating tenant's events whose triggers target curated
  workflows. Accepted: the drain is bounded.
- Tests: a draining tenant's events fire on the first tick after ACTIVE;
  another tenant's events are not delayed while it drains.

### Runner orchestration (`lib/tenant-runner.ts`)

- Config: add optional `TENANT_RUNNER_SCOPED_TASK_DEFINITION`, **outside** the
  all-or-nothing check (else an API deploy landing before the worker stack
  would turn every launch into SKIPPED_UNCONFIGURED). Asking for the scoped
  family while it's unset → `LAUNCH_FAILED('SCOPED_UNCONFIGURED')` (logged,
  metric), never a silent fallback to legacy. Cutover is refused while unset.
- **Family-aware dedupe:** after `ListTasks { startedBy }`, `DescribeTasks` the
  ARNs and count only tasks whose `taskDefinitionArn` family matches. A legacy
  runner idling out after the flip then no longer blocks the scoped launch; it
  is left to its 600 s idle exit (no StopTask).
- `sweepTenantRunners`: demand = distinct (tenantId, family) over open rows;
  family = scoped if `temporalNamespace` is non-null, else legacy.
- `publishTenantRunnerPoolMetrics`: list both families, sum into
  `TenantRunnersRunning`.
- RunTask overrides unchanged (TENANT_ID + WORKFLOW_BROKER_TOKEN). The Temporal
  key is **never** an override (readable via `ecs:DescribeTasks`).

### Broker (`handlers/workflow-internal.ts` `GET /temporal-credentials`)

- Serve for `ACTIVE | REVERTING` (was READY). Everything else unchanged
  (tenant `wbk_` only, confinement 404, no-store, key never logged).

### Runner (`apps/tenant-runner/pegasus_tenant_runner/`)

- `config.py`: `TEMPORAL_ADDRESS` / `TEMPORAL_NAMESPACE` /
  `TEMPORAL_CLOUD_API_KEY` become optional. **Broker mode when
  `TEMPORAL_ADDRESS` is absent**; env mode otherwise (the legacy task def and
  local dev keep working). `:latest` deploys independently of CDK, so the image
  must run under both task definitions.
- `broker_client.py`: `fetch_temporal_credentials()` → `{address, namespace,
api_key}`; 404 → `TemporalCredentialsUnavailable`.
- `runner.py`:
  - broker mode fetches before `build_temporal_client`; on 404 log
    `runner.temporal_credentials_unavailable` and exit 0 (the Needed-vs-Running
    starvation alarm surfaces a loop);
  - **proactive refresh** every 30 min: re-fetch and, if the key changed,
    `client.service_client.update_api_key(new)`. 30 min ≪ the 24 h grace, so a
    rotation normally never reaches a live runner as an auth failure;
  - **floor:** if the worker dies on an auth error, exit non-zero; the sweep
    relaunches with a fresh fetch. (Whether `Worker.run()` dies or retries on
    PERMISSION_DENIED polls is unverified; acceptance proves which we got.)
  - the key never appears in logs; `_base_log_context` uses the resolved
    namespace.
- The key lives only in the (non-dumpable) shim; assert in `sandbox_env.py`
  tests that the subprocess env never inherits it.
- pytest: env mode, broker mode, 404, refresh swaps the key, refresh failure
  keeps the old key and retries, key absent from subprocess env and logs.

### Infra (`packages/infra`)

- `temporal-worker-stack.ts`: second task def `pegasus-tenant-runner-scoped-<env>`,
  same image/roles/log group, env = `ENV_NAME` + `PEGASUS_API_BASE_URL` only,
  **no `secrets`**. Reuse the existing task + execution roles (no new PassRole).
  Output its family.
- `api-stack.ts`: `TENANT_RUNNER_SCOPED_TASK_DEFINITION` on the API Lambda and
  the dispatcher; `ecs:RunTask` covers the scoped family;
  `workflowTokenKey.grantEncryptDecrypt(reconcileFunction)` +
  `WORKFLOW_TOKEN_KMS_KEY_ID` on it.
- Infra tests: the scoped task def has no secrets and no `TEMPORAL_*` env;
  RunTask covers both families; the reconcile Lambda has the grant + env var.

### Rotation & gauge

- `findDueForRotation` and `earliestReadyKeyExpiry` → `status in [READY,
DRAINING, ACTIVE, REVERTING]` (keep the metric name; comment the method).
  Tests per status — otherwise rotation silently stops at cutover.

### Admin-web, tenant-web, SDK, docs

- Admin-web `temporal-namespace.ts` + `TenantTemporalNamespaceSection.tsx`: new
  statuses in the union and any switch; **Cut over** (READY → DRAINING) and
  **Roll back** (ACTIVE → REVERTING) actions with a confirm step; "draining: N
  open executions". Deprovision disabled outside READY/FAILED.
- Admin API (the existing temporal-namespace admin handler): cutover and
  rollback routes as CAS transitions; cutover refused unless the scoped family
  is configured and `namespaceKeyAuthorized` passes for the current key.
- tenant-web: show the 409 `TENANT_MIGRATING` message on Run/Retry.
- **SDK boundary (CLAUDE.md):** `pegasus-workflows` maps 409 `TENANT_MIGRATING`
  to a typed error with a retry hint; OpenAPI documents it on run/retry; SDK
  README + `~/repos/pegasus-workflows/CLAUDE.md` mention it; bump and tag
  `sdk-python-vX.Y.Z` after merge.
- `dolas/agents/project/DECISIONS.md` (namespace on the row, REVERTING,
  family-aware dedupe); `GOTCHAS.md` for whatever acceptance turns up.

## Checklist (ordered; ONE PR per Decision 1, the groups are commit order)

Everything below lands in one PR. Deploy ordering is still real: the runner
image (`tenant-runner.yml`, `:latest`) and CDK deploy independently after the
merge, so cutover stays refused until the scoped family is configured, and the
staging acceptance checks the running image digest before the first cutover.

### 1. Inert plumbing (no behavior change while no row is ACTIVE)

- [x] Prisma: enum `DRAINING | ACTIVE | REVERTING`; `WorkflowExecution.temporalNamespace`; migration `20261015120000_tenant_temporal_routing`; `db:generate`.
- [x] Repo: `KEY_HOLDING_STATUSES` / `MIGRATING_STATUSES` / `ROUTED_STATUSES`; rotation + gauge + retire + discard sweeps widened; `findMigrating`. The drain count lives in `lib/temporal-namespace-cutover.ts` (`countOpenTenantRunnerExecutions`).
- [x] `FakeTemporalCloud` with the refusal rules (`lib/__tests__/temporal-client-tenant-namespaces.test.ts`).
- [x] `temporal-client.ts`: `withTemporalClient`, per-namespace cache (10-min TTL), evict-and-retry-once, key/namespace mismatch guard.
- [x] Start path: namespace choice, write on insert, TENANT_MIGRATING before the runner launch.
- [x] History/cancel handlers + reconcile Lambda read the row's namespace.
- [x] Infra: reconcile Lambda `grantDecrypt` (not encrypt) + env; infra test.
- [x] Admin-web compiles against the new enum.

### 2. Runner + scoped task definition

- [x] Python: optional `TEMPORAL_*` (broker mode = no `TEMPORAL_ADDRESS`; a leftover shared setting is refused as cross-wired), `fetch_temporal_credentials`, 30-min refresh via `client.api_key = …` (`temporal_credentials.py`); a worker auth failure exits non-zero (the floor). pytest.
- [x] Infra: `pegasus-tenant-runner-scoped-<env>` (no secrets, no `TEMPORAL_*`, same roles); RunTask + env wiring; infra tests.
- [x] `tenant-runner.ts`: optional scoped family (`SCOPED_UNCONFIGURED`, never a silent fallback), family-aware dedupe, per-(tenant, family) sweep, both-family pool metric.
- [x] Broker serves ACTIVE | REVERTING.

### 3. Cutover

- [x] Admin `POST …/cutover` (READY → DRAINING; refuses unless the scoped family is configured and the key passes `keyAuthorizedOnNamespace`) and `POST …/rollback` (ACTIVE → REVERTING, DRAINING → READY); GET reports `openExecutions` + `scopedRunnerConfigured`; admin-web Cut over / Roll back / Cancel cutover with in-page confirms.
- [x] Dispatcher: phase 0 advances drains; migrating tenants excluded at the event query; a mid-tick `TENANT_MIGRATING` leaves the event undispatched.
- [x] 409 `TENANT_MIGRATING` + `Retry-After: 60`, OpenAPI (run route added; retry 409), tenant-web message.
- [x] SDK 0.50.0 `TenantMigrating` + README + CHANGELOG + MCP guide. **Owed after merge:** the authoring repo's `~/repos/pegasus-workflows/CLAUDE.md` line, and tag `sdk-python-v0.50.0`.
- [x] DECISIONS.md / GOTCHAS.md.

Verified locally 2026-10-15: `npm run typecheck` 15/15, `npm run lint` 10/10;
api 289 files / 4,269 tests (coverage on), tenant-web 1,568, admin-web 63,
infra 429 (incl. the API bundle guard); tenant-runner pytest 121 + ruff; SDK
pytest 469 + ruff.

### Acceptance (staging; a runbook, not a PR)

- [x] Deploy landed: the scoped task definition exists and the runner image
      digest running is this merge's (see Risks, "Stack order").
- [x] Provision `4b2e0267-…` again; Cut over; watch DRAINING → ACTIVE.
- [x] Run an Automation end to end + a dry run; the row has `temporal_namespace`; the run is visible in the tenant namespace and **absent** from `pegasus-staging`.
- [x] Isolation probes again (scoped key refused on `pegasus-staging`); the probe tells 403 from 404 and checks every call's status.
- [x] Create a domain event during DRAINING; it fires after ACTIVE.
- [x] Force a rotation **while a runner is live**: the runner's refresh swaps the key (log line) and the run continues; after the previous key retires, history through the API still works (cache evict path).
- [x] Roll back: ACTIVE → REVERTING → READY; the next run lands in shared.
- [ ] Archive this plan — after the prod rollout below.

**Results (staging, 2026-10-19, rollback 2026-10-22). PASSED, no defects.**

- **Setup.** AVP Smoke (`4b2e0267-…`) had no Automations, so `smoke_canary` was
  forked into it (`ad780834`) with a `workflow_developer` key (CLI profile
  `avp-smoke`), plus an EVENT trigger on `quote.accepted` filtered to
  `{acceptanceTest: "3b2"}`. The trigger was deleted afterwards. The key is
  the user's; revoke it if it isn't wanted.
- **Step 0.** `pegasus-tenant-runner-scoped-staging:1` was ACTIVE with no
  secrets and env `ENV_NAME` + `PEGASUS_API_BASE_URL` only. Runner `:latest` =
  `552c9a25`, which includes `76a51b68`. The API and dispatcher had
  `TENANT_RUNNER_SCOPED_TASK_DEFINITION`, and the reconciler had
  `WORKFLOW_TOKEN_KMS_KEY_ID`.
- **Baseline at READY:** the run (`0751887a`) completed in the shared namespace
  on a legacy runner (log stream `runner/`), and its row had
  `temporal_namespace = NULL`.
- **Drain held.** A synthetic QUEUED shared-namespace row
  (`3b200000-…0001`, staging only) held DRAINING open so the hold could be
  observed:
  - A live run and a dry run → 409 `TENANT_MIGRATING`, `Retry-After: 60`,
    raised as the SDK's `TenantMigrating`.
  - A `quote.accepted` event inserted at 20:07:19 stayed **undispatched**
    through dispatcher ticks at 20:08:03 and 20:09:08; both logged the tenant
    as DRAINING and waiting.
  - The synthetic row was marked FAILED. In the **same tick (20:10:06)** the
    tenant went ACTIVE, the held event was dispatched, and its run started with
    `temporal_namespace = pg-staging-4b2e0267c597.chgel`. It completed at
    20:10:33.
- **Scoped runner.** It launched at 20:10:24 **while the legacy runner from
  20:01 was still RUNNING**: the family-aware dedupe working in production. Its
  logs show `runner.starting` (empty namespace) →
  `runner.temporal_credentials_fetched` → `runner.connected` to the tenant
  namespace.
- **Runs.** A manual run and a dry run in the tenant namespace both completed;
  the dry run returned the trace envelope. History through the API worked
  (11 events each).
- **Isolation** (`probe_3b2.py`, every outcome classified; DENIED = gRPC 7,
  never confused with NOT_FOUND):
  - The tenant key reaches its own namespace (namespace and regional
    endpoints). It is DENIED on `pegasus-staging` (shared and regional
    endpoints).
  - The shared key reaches `pegasus-staging` (control), and is DENIED on the
    tenant namespace.
  - The baseline run exists only in `pegasus-staging`. The event, manual and
    dry runs exist only in the tenant namespace, matching their rows.
- **Rotation while live.**
  - The provisioner's `rotate` on the ACTIVE row returned done in 24 s. The
    status stayed ACTIVE, `vxxTFT…` became current, `zJhrnt…` became previous,
    and no pending key was left.
  - Runner `d6ff03…` logged **`runner.temporal_key_refreshed` at 20:40:30**,
    30 minutes after its start. Keep-warm runs every 4 minutes stayed green
    across it (12/12).
  - The previous key was then force-retired (its retire time set into the
    past, then `retire-previous-keys`; the sweep ran on an ACTIVE row). The
    **same runner `d6ff03…`** then completed another run: it was using only
    the swapped-in key. API history kept working.
  - The runner logs contain no key material.
- **Rollback (2026-10-22, the user pressed Roll back).** The dispatcher logged
  `REVERTING → READY` (20:40:03). The next run (`14ccc173`) completed in the
  **shared** namespace on a legacy runner. History of a tenant-namespace run
  still works after the rollback, because it is read from the row's namespace.
- **Left in place:** the namespace is READY with key `vxxTFT…`. Deprovision it
  from admin-web if it isn't wanted for anything else.
- **Tooling lesson:** a CloudWatch `filter-log-events` pattern with several
  quoted terms is an **AND**, not an OR. A watcher built that way never fires.
  Match one term per call, or filter client-side.

### Later, separate PR (after every tenant with Automations is ACTIVE)

- [ ] Remove the legacy runner task def and the shared key from runners (completes 3a's "no Admin key in runners").

## Files

Modified: `apps/api/prisma/schema.prisma` (+ migration),
`apps/api/src/repositories/tenant-temporal-namespace.repository.ts`,
the workflow-execution repository, `apps/api/src/lib/temporal-client.ts`,
`apps/api/src/lib/start-workflow-execution.ts`, `apps/api/src/lib/tenant-runner.ts`,
`apps/api/src/handlers/workflows.ts`, `apps/api/src/handlers/workflow-internal.ts`,
the admin temporal-namespace handler, `apps/api/src/lambda-reconcile-workflow-executions.ts`,
`apps/api/src/lambda-dispatch-workflow-triggers.ts`,
`apps/tenant-runner/pegasus_tenant_runner/{config,broker_client,runner,sandbox_env}.py`,
`packages/infra/lib/stacks/{api-stack,temporal-worker-stack}.ts`,
admin-web `temporal-namespace.ts` + `TenantTemporalNamespaceSection.tsx`,
tenant-web run/retry error display, `packages/workflows-sdk-python`, OpenAPI
registration, `dolas/agents/project/{DECISIONS,GOTCHAS}.md`.
Created: `FakeTemporal` and tests alongside each change.

## Risks

- **A runner image that predates this PR running under the scoped task def** would fail config
  (no `TEMPORAL_ADDRESS`). Mitigated: the Python ships in the same PR;
  cutover is refused unless the scoped family is configured; acceptance checks
  the running image digest.
- **Cache holding a retired key** in a warm Lambda: bounded by the 10-min TTL
  plus evict-and-retry-once.
- **Cutover before a fresh namespace's key is authorized:** the cutover route
  runs `namespaceKeyAuthorized` first.
- **Enum additions** break exhaustive switches; `tsc` catches TS; grep Python
  and SQL for status literals.
- **Stack order:** `TemporalWorkerStack` depends on `ApiStack`, so a deploy
  sets `TENANT_RUNNER_SCOPED_TASK_DEFINITION` on the API a few minutes before
  the scoped task definition exists. A cutover in that window would pass the
  "configured" check and its launches fail (logged, metric) until the worker
  stack lands. Acceptance step 0: confirm `aws ecs describe-task-definition
--task-definition pegasus-tenant-runner-scoped-staging` before cutting over.
- **Orphaned QUEUED rows** (a raced `REJECT_DUPLICATE` start) are ignored by
  the drain after 30 min but still feed the runner sweep's demand, as before
  this change.

## Decisions (user, 2026-10-15)

1. **One PR** (not the A → B → C split). Staging acceptance is a runbook after
   the merge, not a PR.
2. **Cutover trigger: an admin-web button** per tenant (Cut over, Roll back);
   the dispatcher tick finishes each drain. Provisioning never routes.
3. **Prod rollout: Dolios → NW Test → NW**, after staging acceptance; don't
   wait for the namespace-cap raise.
4. **ACTIVE sits beside READY.** Rollback returns to READY.

## Prod rollout runbook (after staging acceptance)

- [ ] Dolios `a90b22bc-4393-4e6e-8fe4-4ca01a13aba8`: Provision → Cut over →
      ACTIVE; run one of its Automations by hand + a dry run.
- [ ] NW Test `32dd89be-72b3-4038-a54e-9c520ca4547e`: same.
- [ ] NW `9d869236-518f-4fe4-90d3-274a1b957c38`: same; confirm the
      `feedback.submitted` trigger fires into the tenant namespace on its next
      event.
