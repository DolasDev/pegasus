# Retire the legacy tenant runner: every Automation runs in its tenant's own namespace

- **Status:** APPROVED 2026-11-03 (option A); IN PROGRESS. Two design amendments made during implementation are marked "amended" below (FAILED handling).
- **Branch:** `chore/retire-legacy-tenant-runner` (via `/workstream-start`); plan
  and code in **one PR**, as for 3b.2.
- **Goal:** no tenant runner holds the shared Temporal key. Every tenant-runner
  Automation runs in its tenant's own namespace. A tenant without one gets it
  automatically on first publish. This completes 3a's "no Admin key in runners"
  (`plans/in-progress/durable-workflow-worker.md`).
- **Builds on** 3b.2 (`plans/completed/00dc33f0-tenant-temporal-routing.md`).
  Read its "Design" first: state machine, runner families, per-row namespace.
- **Written:** 2026-11-03 against `main` @ `bfd4294b`.

## Resume here (2026-11-03)

- **Code: DONE and verified locally** (see the checklist's "Local" line). Branch
  `chore/retire-legacy-tenant-runner`, worktree
  `../pegasus-retire-legacy-tenant-runner`. PR: see the branch (opened
  2026-11-03; auto-merge deliberately NOT armed).
- **Pre-merge gate PASSED 2026-11-04** (re-run after the user provisioned NW
  Test at 18:28 and cut it over at 18:31 UTC; it is ACTIVE in
  `pg-prod-32dd89be72b3.chgel`): prod 0 blockers / 0 open shared rows / 0 READY
  (6 ACTIVE); staging 0 / 0 / 0 (no rows).
- **Then:** PR #919 queued with `gh pr merge 919 --auto`; watch Deploy.
- **Post-merge owed:** tag `sdk-python-v0.55.0` (only once the PR's
  `mergeCommit` is non-empty); add the `TenantNamespaceProvisioning` /
  `TenantNamespaceUnavailable` line to `~/repos/pegasus-workflows/CLAUDE.md`
  next to the `TenantMigrating` note; the staging acceptance below; archive this
  plan.

## Decisions (user, 2026-11-03)

1. **A:** an ACTIVE namespace is a prerequisite of running an Automation; the
   legacy family goes away.
2. **Onboarding is automatic.** Publishing (or forking) a tenant's first
   Automation starts provisioning. Once the namespace is READY the tenant
   advances to ACTIVE with no admin action.
3. **NW Test** (prod `32dd89be-…`, 2 Automations): provision + cut over
   (admin-web, by the user, **before this PR merges**).
4. **Staging leftovers retired** (done 2026-11-03): AVP Smoke `smoke_canary`
   0.1.0; E2E tenant `b40b082e` `smoke_canary` 0.1.0 and
   `send_order_saved_sms` 0.1.0 + 0.1.1. The staging blocker query now
   returns 0 rows.

**Consequence to confirm (not yet chosen by the user):** **Roll back goes
away.** With no shared runner there is nothing to roll back to, so the only
emergency stop for a tenant is the existing `workflowsDisabled` kill switch.
The `REVERTING` enum value stays (history rows reference the states; no enum
migration).

## Pre-merge gate (hard rule)

Removing the legacy task definition in the same deploy is safe only if no
shared-namespace tenant-runner work is open. Before merging, on **both** envs:

1. The blocker query returns **0 rows**:
   ```sql
   select t.name, count(distinct w.name) from workflows w join tenants t on t.id = w.tenant_id
   where w.executable and w.status = 'ACTIVE' and w.name <> 'send_quote_followup'
     and w.tenant_id not in (select tenant_id from tenant_temporal_namespaces where status = 'ACTIVE')
   group by 1;
   ```
   (`send_quote_followup` is curated/STDLIB: it always runs in the platform
   namespace. The exclusion is deliberate.) 2026-11-03: staging 0; prod 1 (NW Test).
2. **Zero open shared-namespace tenant-runner executions** (the same filter as
   `countOpenTenantRunnerExecutions(…, null)`):
   ```sql
   select count(*) from workflow_executions e join workflows w on w.id = e.workflow_id
   where e.temporal_namespace is null and w.executable and w.name <> 'send_quote_followup'
     and (e.status = 'RUNNING' or (e.status = 'QUEUED' and e.queued_at > now() - interval '30 minutes'));
   ```
3. **No READY rows** (they would auto-advance at deploy). 2026-11-03: none on
   either env (prod 5 ACTIVE, staging empty).

## Design

### The gate (start path, `lib/start-workflow-execution.ts`)

Applies only where provisioning is configured (`TEMPORAL_PROVISIONER_FUNCTION_NAME`
set: staging + prod). Where it isn't (local dev, tests), the shared namespace
stays, unchanged, so the runner's env mode and every existing test keep working.

For a TENANT_RUNNER start, read the namespace row (already done today):

| Row status              | Start                                                      | Side effect                |
| ----------------------- | ---------------------------------------------------------- | -------------------------- |
| ACTIVE                  | runs in the tenant namespace (unchanged)                   | —                          |
| DRAINING / REVERTING    | 409 `TENANT_MIGRATING` (unchanged)                         | —                          |
| none                    | **409 `TENANT_NAMESPACE_PROVISIONING`**, `Retry-After: 60` | `requestTenantNamespace()` |
| PROVISIONING / READY    | 409 `TENANT_NAMESPACE_PROVISIONING`, `Retry-After: 60`     | — (provisioner / phase 0)  |
| FAILED / DEPROVISIONING | **503 `TENANT_NAMESPACE_UNAVAILABLE`** (no Retry-After)    | — (phase 0 retries FAILED) |

Nothing is written and no runner is launched, like `TENANT_MIGRATING`. Dry runs
are gated too. STDLIB (curated) starts are never gated.

### `requestTenantNamespace(db, tenantId)` (new, `lib/tenant-namespace-request.ts`)

The same logic as the admin `POST …/temporal-namespace`, extracted so the
admin route, the start path, finalize and fork all share it: create the
PROVISIONING row (or FAILED → PROVISIONING, or re-invoke an expired-lease
PROVISIONING), then invoke the provisioner asynchronously.

- **Best-effort, never fails the caller.** An invoke error (including
  `AccessDenied`) is logged and metered, and the row is marked FAILED, as the
  admin route does. Finalize/fork still succeed, and a start still returns the 409.
- **Retries live in the dispatcher's phase 0, not in starts** (amended
  2026-11-03, during implementation): each tick re-invokes a PROVISIONING row
  whose lease expired (a killed run; otherwise nothing would ever resume it,
  because its events are held and no start reaches it), and retries a FAILED
  row whose `updatedAt` is over 15 minutes old. So a persistent failure (for
  example the 100-namespace cap) costs one provisioner call per 15 minutes,
  not one per start.
- Audit: the admin route keeps writing its audit row. Automatic requests log
  `temporal_namespace.auto_requested` with `audit: true` and the cause
  (`publish` / `fork` / `start`).
- **Grant:** `provisionerFunction.grantInvoke(dispatchTriggersFunction)` plus
  the env var on the dispatcher, so a trigger-fired start can request too.

### Publish and fork

`POST /workflows` (finalize) and `POST /:id/fork` call `requestTenantNamespace`
after the row is written, when the workflow routes to TENANT_RUNNER and the
tenant has no ACTIVE/DRAINING/READY/PROVISIONING row. The response gains
`data.namespace: { status, ready: boolean }`, additive, so the CLI `push` can
print "namespace provisioning started; the first run is available in a few
minutes". This is the normal path: by the time a tenant runs, the namespace
usually exists.

### Auto-advance (`lib/temporal-namespace-cutover.ts`, dispatcher phase 0)

`advanceNamespaceMigrations` also picks up **READY** rows (only where
provisioning is configured), all in one pass:
READY → DRAINING (CAS) → ACTIVE at zero open shared rows, then the same
tick's event phase dispatches the tenant's waiting events.

Preconditions the admin `/cutover` route checks, and why auto-advance drops
each one:

- _Scoped runner configured:_ after this PR the scoped family is the only
  family, and it's required config (`loadTenantRunnerConfig` is
  all-or-nothing).
- _Key authorized on the namespace:_ the provisioner waits for exactly this
  check before `markReady`, and a rotation only promotes a key that passes it.
  The gap (a READY row whose key stopped authorizing) is closed by **keeping
  the check** in auto-advance: it is one cheap call per READY row per tick,
  and READY rows exist for a tick or two.

The admin **Cut over** button stays as a manual nudge, with the same code path.
**Roll back** and **Cancel cutover** go: the routes are deleted and admin-web
removes the buttons.

### Dispatcher events

- Excluded at the query (as today for DRAINING/REVERTING): tenants whose row
  is **PROVISIONING / READY**. Bounded: the readiness wait is 10 min inside a
  15-min Lambda, plus a tick or two to advance. This holds the tenant's
  curated-trigger events too, as a drain does today (accepted in 3b.2: bounded).
- **FAILED is NOT excluded** (amended 2026-11-03, during implementation): it
  is unbounded, and holding it would hold the tenant's **curated** events too
  (for example quote follow-ups). Curated triggers fire normally. A tenant-runner
  trigger gets `TENANT_NAMESPACE_UNAVAILABLE` → skipped and logged as an error
  (the run is lost, as for `WORKFLOWS_DISABLED`), and the alarm below fires.
  The phase-0 retry moves the row to PROVISIONING, which then holds new events.
- A tenant with **no row** isn't excluded (most tenants have none and only
  curated triggers). A mid-tick `TENANT_NAMESPACE_PROVISIONING` leaves the
  event undispatched, exactly like the mid-tick `TENANT_MIGRATING` today. The
  next tick the row exists and the tenant is excluded until ACTIVE.

### Deprovision

The admin route currently allows READY/FAILED only. Since READY now advances
within a tick, it also allows **ACTIVE when the tenant has zero open
tenant-runner executions and zero non-retired executable Automations**.
Otherwise it returns 409 naming what blocks it. A tenant that publishes again
afterwards re-provisions automatically.

### Removing the legacy family

- `lib/tenant-runner.ts`: drop `TenantRunnerFamily` / `runnerFamilyForNamespace`
  / family-aware dedupe / `scopedTaskDefinition`. `ensureTenantRunner` has one
  task definition; the sweep is per tenant; the pool metric lists one family.
  A shared-namespace (`temporal_namespace IS NULL`) row in a deployed env no
  longer gets a runner: log `tenant_runner.shared_row_unservable` + metric, and
  the reconciler fails it as today. That can't happen after the pre-merge gate.
- Env contract: **repoint `TENANT_RUNNER_TASK_DEFINITION`** at
  `pegasus-tenant-runner-scoped-<env>` and delete
  `TENANT_RUNNER_SCOPED_TASK_DEFINITION`. The scoped family already exists in
  both envs, so deploy order (API stack before worker stack) is a non-issue.
- `temporal-worker-stack.ts`: delete `TenantRunnerTaskDef`
  (`pegasus-tenant-runner-<env>`), its `TEMPORAL_*` env and `secrets`, and the
  **runner exec role's read grant on `temporalCloudSecret`**. The stdlib
  worker keeps its own. Infra tests assert: no runner task def has a
  `TEMPORAL_*` env or secret, and the runner exec role can't read the
  Temporal secret.
- `api-stack.ts`: RunTask resources → the scoped family only.
- Runner Python: **env mode stays** for local dev. Delete only comments and
  docs that describe the deployed legacy task def.
- Admin-web: drop Roll back / Cancel cutover; describe READY as "advancing";
  show `TENANT_NAMESPACE_PROVISIONING` context.

### Alarm

New gauge `TenantTemporalNamespacesUnhealthy` (FAILED rows, plus READY or
PROVISIONING rows not updated for 20 minutes: a key that stopped authorizing,
or a provisioner that keeps dying), published
every dispatcher tick (0 included). Alarm when ≥ 1 for 3 consecutive periods,
wired in CDK with an infra test (memory: "a flag-gated feature isn't shipped
until it's wired into CDK"). Name mirrored in `packages/infra/lib/metrics.ts`.

### SDK boundary (CLAUDE.md, non-negotiable)

- `pegasus-workflows`: new `TenantNamespaceProvisioning(PegasusApiError)`, a
  **sibling** of `TenantMigrating` (not a subclass; the semantics differ) with
  the same `retry_after_seconds`. Raised by `run_workflow` / `retry_execution`.
  `push` prints the namespace status from the finalize response. Minor bump;
  README, CHANGELOG, MCP guide, CLI `--help`.
- OpenAPI: the 409 on run + retry; `data.namespace` on finalize + fork.
- tenant-web: the 409 message on Run/Retry.
- Authoring repo `~/repos/pegasus-workflows/CLAUDE.md`: one line next to the
  `TenantMigrating` note. Tag `sdk-python-vX.Y.Z` after merge.

## Checklist (one PR; groups are commit order)

### 1. Request + gate

- [x] `lib/tenant-namespace-request.ts` (extracted from the admin POST; best-effort) + tests; the admin POST uses it.
- [x] Start-path gate + `TENANT_NAMESPACE_PROVISIONING` outcome → 409 + `Retry-After`; dispatcher maps a mid-tick refusal to "leave undispatched". Tests per row status, both "configured" and "unconfigured".
- [x] Finalize + fork call it; `data.namespace` in the response; tests.
- [x] Dispatcher grant + env (infra + test).

### 2. Auto-advance + events + deprovision

- [x] `advanceNamespaceMigrations`: READY → DRAINING → ACTIVE in one pass, with the key check; tests (including a READY row whose key fails → stays READY, logged).
- [x] Phase 0: re-invoke expired-lease PROVISIONING; retry FAILED older than 15 min; tests.
- [x] Event-query exclusion widened to PROVISIONING / READY (not FAILED); a FAILED tenant's curated trigger still fires; tests: another tenant's events are not delayed.
- [x] Rollback + cancel routes deleted; deprovision-from-ACTIVE rule; admin-web.
- [x] `TenantTemporalNamespacesUnhealthy` gauge + alarm (infra + test).

### 3. Legacy removal

- [x] `tenant-runner.ts` single family; sweep; pool metric; tests.
- [x] Infra: delete the legacy task def + exec-role secret grant; repoint the env var; RunTask resources; infra tests + snapshots.
- [x] Runner docs/comments.

### 4. SDK + docs

- [x] SDK error + `push` message + README/CHANGELOG/MCP/`--help`; OpenAPI (run + retry; finalize and fork are not in the spec, so `data.namespace` is described on the run route); tenant-web message.
- [x] DECISIONS.md (A, auto-onboarding, no rollback), GOTCHAS.md; tick 3a's item in `durable-workflow-worker.md`.
- [x] Local: `npm run typecheck`, `npm run lint`, api (revert the coverage-floor autoUpdate), infra, tenant-web, admin-web, SDK pytest + ruff, tenant-runner pytest.
      Verified 2026-11-03: typecheck 15/15, lint 10/10; api 315 files / 4,781 tests (coverage on; floors reverted), infra 438 (incl. the bundle guard), tenant-web 1,710, admin-web 63; SDK pytest 539 + ruff; tenant-runner pytest 122 + ruff.

### Pre-merge (ops)

- [x] NW Test ACTIVE (user, admin-web, 2026-11-04 18:31 UTC).
- [x] Pre-merge gate queries 1-3 pass on both envs; paste the results into the PR (2026-11-04).

### Acceptance (staging, after deploy; burns 1 of the 100 namespaces)

- [ ] `pegasus-tenant-runner-staging` is gone and the runner image digest is this merge's.
- [ ] **AVP Smoke** (no namespace, no Automations; its `smoke_canary` fork was retired 2026-11-03, so there is nothing to fork): `push` a small canary Automation from the authoring repo with the `avp-smoke` profile → the push says provisioning started → a `run` gets 409 `TENANT_NAMESPACE_PROVISIONING` (SDK raises the typed error) → the row goes PROVISIONING → READY → ACTIVE on its own → the run completes in `pg-staging-4b2e0267c597.chgel` on a scoped runner.
- [ ] An EVENT trigger fired during PROVISIONING fires after ACTIVE.
- [ ] Prod: the next NW run still completes (scoped, unchanged).
- [ ] Post-merge: SDK tag; authoring-repo line.

### Carried from the 3b.2 prod rollout

- [ ] Dolios (prod, ACTIVE, 11 Automations, 9 triggers, none enabled, no runs
      since cutover on 2026-11-03): verify its first run lands scoped.
- [ ] Staging: revoke the `avp-smoke` CLI key once acceptance is done, if
      unwanted.

## Files

Modified: `apps/api/src/lib/{start-workflow-execution,tenant-runner,temporal-namespace-cutover}.ts`,
`apps/api/src/lambda-dispatch-workflow-triggers.ts`,
`apps/api/src/handlers/{workflows,admin/temporal-namespace}.ts`, OpenAPI registration,
`packages/infra/lib/stacks/{api-stack,temporal-worker-stack}.ts`, `packages/infra/lib/metrics.ts`,
admin-web `TenantTemporalNamespaceSection.tsx` + `temporal-namespace.ts`, tenant-web run/retry
errors, `packages/workflows-sdk-python`, `dolas/agents/project/{DECISIONS,GOTCHAS}.md`,
`plans/in-progress/durable-workflow-worker.md`.
Created: `apps/api/src/lib/tenant-namespace-request.ts` + tests.

## Risks

- **Strand at deploy:** an open shared row when the legacy task def is
  deleted. Mitigation: the pre-merge gate. Running ECS tasks survive a task-def
  deregistration anyway; only new launches fail.
- **The 100-namespace cap** (staging + prod together; 5 used). Auto-onboarding
  spends one per publishing tenant. A cap failure lands FAILED → alarm; events
  wait. Raising the cap is a Temporal support ticket (3a still owes one).
- **First-run latency** for a new tenant: a few minutes (create + key
  authorization, about 90 s up to the 10-min readiness timeout). Publish starts
  it early, so it is usually done before the first run.
- **No rollback:** the emergency stop is `workflowsDisabled`; recovery from a
  broken namespace is deprovision + re-publish.
- **The dispatcher gains `lambda:InvokeFunction` on the provisioner.** It can
  only trigger provision/rotate/deprovision events, which the provisioner
  validates; the same grant the API already has.
