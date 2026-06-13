# Pegasus Workflows — Phase 3: Sandboxed Tenant Code + Triggers

**Status: ALL 12 UNITS ✅ COMPLETE AND MERGED (Track B 1–5, Track A
6–11 incl. 8.1)** — PRs #230–#234, #239–#243, #248, #251; sandbox LIVE
as of #248, guardrails live with #251 (2026-06-12).

**STAGING SMOKE: engine portions ✅ PASSED 2026-06-13** (driven via a
temp Playwright spec on the qa e2e target + AWS verification):
- Tenant-code lane ✅: SDK push → `executable:true`+sha → run →
  runner RunTask (startedBy=tenantId) → **cold start 18 s** →
  sha-verified artifact prepare → subprocess exit 0 → COMPLETED with
  result round-trip → **idle-exit ~10 min** (two full scale-to-zero
  cycles observed). Runner logs show the whole designed lifecycle
  (wbk_-authed discovery, presigned S3, token mint, status PATCH).
- Track B ✅: EVENT (quote.accepted via real customer→move→quote→
  finalize→accept chain) + SCHEDULE (*/5) both fired curated
  executions; triggers disabled+deleted clean.
- **The smoke caught a REAL latent Phase-1 bug, fixed as #256
  (`56bf174`)**: `@pegasus_workflow` registered the Temporal type as
  the Python CLASS name, not the manifest name → the STDLIB lane had
  NEVER executed end-to-end (worker rejected every task; executions
  stuck RUNNING in task-retry). One-line fix (`workflow.defn(name=
  name)(cls)`) + regression test; rebuilt worker self-healed the stuck
  executions to COMPLETED (Temporal task retry). Tenant-runner lane was
  unaffected (Unit 8 proxies always used manifest names).
- Remaining: the Unit-11 admin-UI clicks (kill switch 423 round-trip,
  runner-status panel, dashboard render) — pending Steve. Then archive
  this plan to `plans/completed/`.
- Cosmetic follow-ups (non-blocking): stdlib followup message prints
  "quote quote-unknown" for trigger-fired runs (payload key casing);
  **product gap: a tenant directly running a non-curated GLOBAL row
  routes to its own runner, which can't fetch another tenant's
  artifact → execution would strand** (fork-then-run is the supported
  path; consider rejecting direct cross-tenant runs of non-curated
  GLOBAL rows in a follow-up).

Infra notes (2026-06-12): deploy-role publish policies are now
IaC-managed in dolas-infra (#7, `github-workflow-publish`; hand-applied
inline policies deleted). Temporal: no task-queue-count limit (Steve
confirmed); queues are implicit, nothing to provision. Temporal Cloud
IaC (terraform `temporalio/temporalcloud`) assessed + deferred.
Pipeline interlude: esbuild GHSA-gv7w-rqvm-qjhr (high, published
2026-06-12) broke audit-ci on all branches — fixed by #249 (override
>=0.28.1; note: overrides regenerate fine on node 24 now, old node-20
gotcha obsolete).

## Resume-session checklist

1. Read this file top-to-bottom + the `project_workflows_phase2_status`
   memory (carries the Phase 3 ledger + Track B lessons).
2. **Verify the last deploy finished green:**
   `gh run list --workflow deploy.yml --limit 3` —
   if a run failed or was cancelled, fix/redispatch FIRST
   (`[[feedback_rapid_main_pushes_cancel_deploy]]`).
3. **Run the staging smoke — full plane** (the one outstanding item,
   needs a staging login, ~25 min):
   - Track B (~10 min): `quote.accepted` trigger on a curated workflow
     via `/settings/workflows` → accept a quote → EVENT-badged
     execution; `*/5 * * * *` SCHEDULE trigger → SCHEDULE-badged
     execution ≤5 min; disable + delete; `domain_events` row exists.
   - Tenant-code lane (Units 6–10, ~15 min): `pegasus-workflows
     package` + upload a trivial non-curated workflow → row shows
     `executable: true` + sha (Unit 6); run it → runner cold-start
     ≤~60 s (watch `TenantRunnersRunning` + the ECS task with
     startedBy=tenantId) → execution COMPLETED; confirm runner
     idle-exits ~10 min later; spot-check `/pegasus/staging/
     tenant-runner` logs and the flow-log group.
   - Unit 11 (~5 min): admin kill switch blocks a new run (423) then
     re-enable; runner-status panel shows the task; `Pegasus-Workflows`
     dashboard renders data.
4. The session's execution pattern (worked 6-for-6): spawn ONE worker
   agent per unit in an isolated worktree (units share `schema.prisma` —
   never parallel), worker self-reviews via the code-review skill +
   runs the unit's verification recipe + opens a PR; coordinator
   re-reviews the diff (real bugs were found this way in Unit 1),
   gates on the 5 required CI checks, squash-merges, deletes branch +
   worktree, marks the unit done in this file, watches the deploy.
   Known frictions: `gh` GraphQL intermittently 401s — REST fallbacks
   work (`gh api -X PUT .../pulls/N/merge`); one Postgres
   service-container CI flake (rerun fixed it); permission strings must
   match `/^[a-z_]+:[a-z_]+$/` (underscores).

**Predecessors:**

- Phase 1 (author/upload/browse) — `plans/completed/pegasus-workflows.md`
- Phase 2 (execution runtime) — `plans/completed/workflows-phase2-execution-runtime.md`
  — read its "Resume notes" section before starting ANY unit here; the
  toolchain, stacked-PR, and CDK-secret gotchas all still apply.

---

## Context

Phase 2 shipped server-side execution for **curated stdlib workflows only**:
a Fargate Temporal worker with the stdlib baked into its image, a manual
`POST /workflows/:id/run` API, per-workflow runtime service accounts, and
execution tracking with a reconcile-poller backstop. It explicitly deferred
four things, all of which are Phase 3:

1. **Arbitrary tenant-uploaded code execution** (with sandboxing) — today the
   run handler hard-rejects anything not in `CURATED_WORKFLOW_NAMES`
   (`apps/api/src/lib/curated-workflows.ts`), and the worker registry
   double-gates it (`apps/temporal-worker/pegasus_temporal_worker/registry.py`).
2. **Event-driven triggers** — "to be designed as a first-class platform
   event bus, its own plan/phase. Not hacked in here."
3. **Scheduled triggers.**
4. **Per-manifest dynamic token scoping** — Phase 2 collects
   `requiredActions` in the manifest but every runtime account gets the
   static `workflow_runtime` Cedar role.

### What exists today (verified in-code 2026-06-09)

- **Worker**: `apps/temporal-worker/` (Python 3.12, Fargate, 0.5 vCPU/1 GiB,
  desiredCount 1 per env) polling `pegasus-stdlib-<env>` on Temporal Cloud
  namespace `pegasus-<env>`. Stdlib is baked into the image at build time;
  nothing is downloaded at execution time.
- **Broker**: internal endpoints on `m2mV1`
  (`apps/api/src/handlers/workflow-internal.ts`) gated by a **single shared
  secret** (`X-Workflow-Broker-Secret`): `POST /workflow-runtime-token`
  (KMS-decrypts and returns any execution's tenant-scoped `vnd_` token) and
  `PATCH /workflow-executions/:id` (status write-back).
- **Artifacts**: tenant uploads land in S3 at
  `workflows/<tenantId>/<workflowId>/<version>.zip`; manifest (name regex,
  semver, `entryPoints[]`, `requiredActions[]`) is zod-validated at finalize.
  The zip contents are **never** validated or executed.
- **Schema**: `Workflow` has no trigger/schedule/limit fields;
  `WorkflowExecution` has `triggeredByUserId` but no trigger provenance.
- **Events**: the only event infrastructure is `PegasusEvent` — an _inbound_
  M2M integration queue (`apps/api/src/handlers/events.ts`, poll-based).
  **The API emits no domain events anywhere** (no outbox, no EventBridge, no
  emission on quote-accept / move-status-change / invoice-paid).

### The security pivot this phase forces

Phase 2's trust model is "all code in the worker image is ours." Phase 3
breaks that. Two consequences shape the whole design:

- **The shared broker secret cannot reach any process that imports tenant
  code.** Python import = arbitrary code execution in-process; tenant code
  could read `WORKFLOW_BROKER_SECRET` from env and use it to mint _any_
  tenant's runtime token (the endpoint only needs an executionId) or forge
  status PATCHes. The isolation boundary must be: **a runner container only
  ever holds credentials scoped to one tenant.**
- **Runtime-token permissions for untrusted code.** Dynamic scoping from
  `requiredActions` was considered; **Steve decided (2026-06-09) to keep
  the static `workflow_runtime` role** (see Resolved #5). Defensible
  because the role is already narrow — read-only on
  Quote/Move/Invoice/Customer/Event plus `CreateEvent`, no writes to
  domain records, no admin actions. Revisit if the role ever needs to
  grow.

---

## Scope decisions

### Locked (inherited from Phase 2 / platform constraints)

- Temporal Cloud remains the orchestrator; workers are self-hosted Fargate
  in the WireGuard VPC (`PRIVATE_WITH_EGRESS` subnets + existing NAT).
- Upload path is unchanged — same SDK, manifest, finalize flow. Phase 3
  changes what happens _after_ upload, not authoring.
- Runtime tokens stay per-workflow `vnd_` service accounts, KMS-encrypted at
  rest, fetched live via broker, never in Temporal history.
- The curated stdlib keeps running exactly as today (shared
  `pegasus-stdlib-<env>` queue, trusted image). Phase 3 adds a _parallel_
  untrusted lane; it does not rebuild the trusted one.

### Proposed (default unless overridden during planning)

- **Isolation model: container-per-tenant.** Tenant code runs in a dedicated
  Fargate task per tenant, polling a per-tenant task queue
  `pegasus-tenant-<tenantId>-<env>`. Blast radius of a malicious/buggy
  artifact = that tenant's own runner + that tenant's own data (which they
  already own). No cross-tenant secrets in the container.
- **Per-tenant broker credentials.** Replace the runner's use of the global
  broker secret with a per-tenant broker token (KMS-wrapped, injected at
  task launch, only able to mint tokens / PATCH executions for its own
  tenantId). The stdlib worker can keep the shared secret short-term but
  should migrate for uniformity.
- **Runner harness = trusted shim, tenant code = subprocess.** The runner
  image is our code (artifact download from S3, venv install, Temporal
  registration); tenant entry points execute in a child process with a
  stripped env (no broker creds — the shim proxies token fetch and hands the
  tenant-scoped `vnd_` token in via stdin/arg, which is fine because that
  token is the tenant's own).
- **Dependencies: stdlib + SDK only at first.** Tenant artifacts may not
  declare arbitrary pip dependencies in v1 (manifest validation rejects
  them). Avoids supply-chain + build-time-network problems; revisit later.
- **Scale-to-zero.** Per-tenant runners launch on demand (first QUEUED
  execution for that tenant) and stop after an idle window. A small
  dispatcher owns this.
- **Trigger model: one `WorkflowTrigger` table for both kinds.**
  `kind: EVENT | SCHEDULE`; EVENT rows carry `eventType` + optional JSON
  filter; SCHEDULE rows carry a cron expression. ~~Realized as a Temporal
  Schedule~~ → **revised at Unit-3 review: the dispatcher Lambda evaluates
  due cron triggers each tick** (see Unit 4 for why Temporal Schedules
  don't fit the execution-row/broker contract). Both kinds fire through
  the _same_ internal run path as `POST /:id/run`, with provenance
  recorded on the execution.
- **Domain events via transactional outbox.** New `DomainEvent` table +
  `emitDomainEvent()` helper written in the same Prisma transaction as the
  state change; a poller Lambda (mirror the reconcile-poller pattern,
  `apps/api/src/lambda-reconcile-workflow-executions.ts`) drains it and
  matches trigger subscriptions. No EventBridge/SNS until volume demands it
  — the outbox keeps emission atomic with the domain write, which a direct
  bus publish can't.
- **Sequencing: triggers land first.** Track B is independent of the
  sandbox, lower-risk, and immediately useful — triggers firing _curated_
  (incl. forked-curated) workflows is real tenant value on its own. Track A
  is the heavy lift. If this phase feels too big as one arc, split into
  **3A = triggers** and **3B = sandboxed tenant code** at promotion time.

### Resolved decisions (Steve, 2026-06-09)

1. **Runner compute shape → ECS `RunTask` + idle-exit.** A tenant's runner
   launches on the first QUEUED execution for that tenant, polls its task
   queue, and exits after an idle window (~10 min, tunable). True
   scale-to-zero; the ~30–60 s cold start (image pull + venv install) on
   the first execution after idle is accepted — workflows are async and
   triggers aren't latency-sensitive. No always-on per-tenant services, no
   Lambda-container redesign.
2. **Egress policy → open egress via existing NAT + VPC flow logs.**
   Runners get unrestricted outbound (calling external APIs is the point);
   enable flow logs on the runner subnets for audit. Exfil risk is bounded
   by the credential model: a runner only ever holds its own tenant's
   credentials. Revisit with an egress proxy + allowlist only if abuse
   shows up in the flow logs.
3. **Resource/abuse limits → ALL FOUR are v1-blocking.** Track A does not
   ship without: (a) per-execution Temporal workflow+activity timeouts
   (15 min default; manifest may lower, not raise), (b) per-tenant
   concurrent-execution cap (start at 5, enforced at the run path before
   Temporal start), (c) per-tenant executions/day quota (counter + 429 +
   UI surfacing), (d) artifact size cap at finalize (10 MB zip) + venv
   install-size guard. Runner CPU/memory stays fixed by the task
   definition.
4. **Event taxonomy → the proposed five at launch:** `quote.accepted`,
   `move.status_changed`, `invoice.paid`, `customer.created`,
   `pegasus_event.received` (bridging the existing inbound M2M queue so
   legacy/desktop events can trigger workflows). Additions are easy;
   renames are breaking — treat these five names as a public contract.
5. **`requiredActions` cap → none; static role parity.** No dynamic token
   scoping in Phase 3. Every runtime token keeps the static
   `workflow_runtime` Cedar role (read-only Quote/Move/Invoice/Customer/
   Event + `CreateEvent`), which is already narrow. `requiredActions`
   remains display-only manifest metadata. **Consequence:** the dynamic-
   scoping work is dropped from Unit 10. **Guardrail:** any future
   broadening of `workflow_runtime` (e.g. adding write actions) must
   reopen this decision — at that point dynamic scoping becomes the
   prerequisite, not an option.

---

## Units (proposed breakdown — Track B first)

### Track B — triggers ✅ COMPLETE (Units 1–5 merged + deployed 2026-06-10)

> The full trigger engine is LIVE on staging + prod: domain events emit
> transactionally at five points → tenants attach EVENT/SCHEDULE triggers
> (API + UI) → the dispatcher Lambda fires matching workflows every minute
> through the same idempotent run path as manual runs, with provenance.
> **Outstanding follow-up (not blocking Track A): the staging UI smoke** —
> create a `quote.accepted` trigger on a curated workflow via
> `/settings/workflows`, accept a quote, watch an EVENT-badged execution;
> create a `*/5 * * * *` SCHEDULE trigger, watch a SCHEDULE-badged
> execution within 5 min; disable + delete. Also verify a `domain_events`
> row appeared for the accepted quote (Unit 1 smoke, same flow).

**Unit 1 — Domain-event outbox. ✅ DONE (#230 → `fb8ffc7`, deployed
2026-06-10).** `DomainEvent` model + `emitDomainEvent(tx, ...)` helper
(`apps/api/src/lib/domain-events.ts` is the canonical taxonomy) + emits
inside handler transactions for the five launch events. **Scope addition
during implementation:** nothing in the codebase ever wrote
`QuoteStatus.ACCEPTED`, so a minimal `POST /quotes/:id/accept`
(SENT → ACCEPTED via conditional-update CAS; 422 for the race loser) was
added to host `quote.accepted`. `invoice.paid` emits only when a payment
crosses the computed balance to <= 0, with the before-balance refetched
inside the tx to prevent concurrent double-emits. Post-merge follow-up
still open: staging smoke (accept a quote → `domain_events` row).

**Unit 2 — `WorkflowTrigger` schema + CRUD API. ✅ DONE (#231 →
`c28306b`, 2026-06-10).** `WorkflowTrigger` model (kind EVENT|SCHEDULE,
CASCADE on workflow delete, dispatcher match index
`(kind, enabled, eventType)`) + CRUD under
`/api/v1/workflows/:id/triggers` gated by new `ManageWorkflowTriggers`
Cedar action (permission string `workflow:manage_triggers` —
**underscore, not hyphen**: the `/me/permissions` e2e contract regex is
`/^[a-z_]+:[a-z_]+$/`; a hyphen broke E2E on the first CI run).
Provenance on `WorkflowExecution`: `triggerSource USER|EVENT|SCHEDULE`
(default USER), `triggeredByTriggerId?`, `triggeredByUserId` now
nullable. SCHEDULE rows stored but INERT until Unit 4; EVENT rows wait
for the Unit 3 dispatcher. Known v1 limitation: a set `filter` can't be
PATCH-cleared to null (delete + recreate).

**Unit 3 — Trigger dispatcher. ✅ DONE (#232 → `33afb07`, 2026-06-10).**
`lambda-dispatch-workflow-triggers.ts` (EventBridge 1-min rate, root `db`,
100-events/tick cap with backlog metric) + the shared run function
extracted to `apps/api/src/lib/start-workflow-execution.ts` (manual
endpoint wire-identical — handler tests unchanged). Idempotency layers:
deterministic Temporal id `wf/<tenantId>/<name>/trg/<triggerId>/<eventId>`
persisted on the row at create, row pre-check on redelivery,
`REJECT_DUPLICATE` as backstop, conditional `dispatchedAt` stamp last.
**v1 filter contract: shallow top-level strict equality, scalars only;
empty/null filter = match-all** (Unit 5's UI explains this). Per-trigger
failure isolation; `START_FAILED` stamps the event (the FAILED row is the
record — no auto-redelivery). Metrics: `DomainEventsDispatched`,
`WorkflowTriggerFired`, `WorkflowTriggerSkipped{Reason}`,
`DomainEventDispatchBacklog`. Post-merge follow-up: staging smoke
(trigger on `quote.accepted` → accept quote → EVENT execution).

**Unit 4 — Scheduled triggers. ✅ DONE (#233 → `ca2611b`, 2026-06-10).
⚠️ Design was revised at Unit-3 review (was: Temporal Schedules)** —
Schedule actions start workflows directly, bypassing the execution-row +
broker contract (runtime-token endpoint requires a QUEUED/RUNNING row).
Shipped instead: the dispatcher evaluates due SCHEDULE triggers each tick
via a dependency-free cron matcher (`apps/api/src/lib/cron.ts` — narrow
v1 dialect: `* , - */n a-b/n` only, UTC, Vixie dom/dow OR rule with the
documented deviation that `*/n` counts as restricted; everything else
parses to null). Fire-minute deterministic id
`wf/<tenantId>/<name>/trg/<triggerId>/<YYYYMMDDTHHMMZ>` rides Unit 3's
pre-check idempotency — no schema change, no new infra. **No catch-up**
(missed tick = skipped fire-minute, documented). Create/PATCH cron
validation now uses the real parser (`61 * * * *` → 400); pre-tightening
rows are skipped with `INVALID_CRON` metric. Temporal Schedules can be
revisited if Track A's runner redesign changes the broker contract.

**Unit 5 — Trigger UI. ✅ DONE (#234 → `eccdf11`, 2026-06-10).**
`settings.workflows.tsx` Triggers section (rendered for GLOBAL rows too):
create dialog (five-event dropdown synced by comment to
`apps/api/src/lib/domain-events.ts`; filter JSON editor rejecting
nested/non-scalar values per the dispatcher contract; cron input with
next-3-fires UTC preview from `src/lib/cron-preview.ts`, a documented
line-for-line port of the backend matcher), enable/disable + delete
gated on `workflow:manage_triggers`, Manual/Event/Schedule badges on
execution rows. v1 cut: no in-place filter/cron editing — PATCH is
`{enabled}` only; edit = delete + recreate.

### Track A — sandboxed tenant-code execution

**Unit 6 — Artifact integrity + eligibility. ✅ DONE (#239 → `1f42c8e`,
2026-06-11).** Schema fields (`artifactSha256`, `artifactSizeBytes`,
`executable @default(false)` — pre-existing rows stay valid, become
executable on re-upload), hand-written zip central-directory reader in
`apps/api/src/lib/workflow-artifact.ts` (EOCD backward-scan, names only,
rejects non-zip/zip64/>10k entries/`..`/absolute paths), finalize flow:
S3 HEAD 10 MB pre-check → 422 `ARTIFACT_TOO_LARGE`, GET + validate →
422 `ARTIFACT_INVALID` with `problems[]` and NO row created. Fork
propagates integrity fields (S3 copy is byte-identical). SDK parity
pinned two ways: the committed fixture was generated by executing the
real SDK `package_project()` against the stdlib, and a test pins the
stdlib toml's `entry_points`/`source_dir`. **Layout ground truth:**
entries are `<source_dir>/...` relative to project root +
`pegasus-workflows.toml` at zip root; `a.b.c:Attr` → `a/b/c.py` or
`a/b/c/__init__.py`. Deviations (all reviewed): upload-url cap
tightened 25→10 MB; manifest `dependencies` key now an explicit 400
(was silently stripped) + dependency files in the zip
(`requirements.txt`, `pyproject.toml`, etc.) → 422; finalize before the
zip lands in S3 → 422 (previously created a row pointing at nothing).
Run path unchanged — curated-names gate stays until Unit 10.

**Unit 7 — Per-tenant broker credentials. ✅ DONE (#240 → `42e4c72`,
2026-06-11).** The security keystone, landed + reviewed before any runner
exists. `TenantBrokerCredential` model (one row per tenant, RESTRICT FK)
with two at-rest forms: `tokenHash` (SHA-256, what the broker verifies —
plaintext never needed back) + `tokenCiphertext` (KMS-wrapped via the
Phase 2 runtime-token key, ONLY for the Unit 9 dispatcher to recover at
ECS task launch). Token format `wbk_<tenantId>_<48 hex>` — embedded id
makes verification a unique-index hit, grants nothing by itself (full-
token hash compare via `timingSafeEqual`). New header
`X-Workflow-Broker-Token` (separate from the secret header; a present-
but-invalid secret 401s and never falls through). Both broker endpoints
enforce `execution.tenantId === token.tenantId`; **cross-tenant = 404
byte-identical to missing, applied before state checks** (no probing).
Lib-only provisioning: `getOrCreateTenantBrokerCredential` (idempotent,
P2002 race-safe) + `rotateTenantBrokerCredential` (instant revoke). No
HTTP surface, no infra change. Legacy stdlib worker path wire-identical.
Adversarial pass in PR #240: a `wbk_` holder cannot mint other tenants'
tokens, PATCH other tenants' executions, or learn the shared secret.

**Unit 8 — Tenant-runner image + harness. ✅ DONE (#241 → `e0b8aa2`,
2026-06-11).** New `apps/tenant-runner/` (separate app, NOT a worker
mode — opposite trust models; ~80 lines deliberately re-implemented).
Runner holds **NO AWS credentials**: new broker endpoint
`GET /internal/tenant-workflows` (wbk_-confined like Unit 7's) lists
executable workflows + sha256 + short-lived presigned GET URLs. TOCTOU
defense shipped: every download re-hashed against `artifactSha256`
before extraction (`runner.artifact_sha_mismatch_SECURITY`); safe
extraction with entry-count + decompressed-total-size caps (the
install-size guard). Tenant code never imported by the shim —
dynamically manufactured PROXY workflow classes (one per tenant
workflow name, unsandboxed, single `run_tenant_entry_point` activity,
maximum_attempts=1) wrap a stripped-env subprocess: allowlist-built env
(9 keys, pinned by tests — no wbk_/TEMPORAL_*/AWS_*/metadata URIs);
the tenant's own `vnd_` token travels over stdin, never argv/env.
Direct-execution v1 semantics (driver patches execute_activity/sleep/
now/uuid4 — no durable replay/signals for tenant code yet). Idle-exit
watchdog (~10 min, RUNNER_* tunables). Compose service added; image
builds + smoke-tested (non-root uid 999, venv-sees-SDK offline).
**Unit 9 env contract (RunTask injection):** required `TENANT_ID`,
`ENV_NAME`, `TEMPORAL_NAMESPACE`, `TEMPORAL_ADDRESS`,
`PEGASUS_API_BASE_URL`, `WORKFLOW_BROKER_TOKEN` (KMS-recovered from
`TenantBrokerCredential.tokenCiphertext`); optional
`TEMPORAL_CLOUD_API_KEY`, `RUNNER_*`. Queue
`pegasus-tenant-<TENANT_ID>-<ENV_NAME>`. Residual v1 risk accepted:
same-container/same-uid kernel boundary (shim /proc readable by tenant
code) — bounded by container-per-tenant + one-tenant creds; gVisor/
separate-uid is a follow-up. No CI Python job yet (tests local-only) —
add one in Unit 9 alongside the image-push workflow.

**Unit 8.1 — Shim non-dumpable hardening. ✅ DONE (#242 → `a325c61`,
2026-06-12).** Closed the same-uid /proc residual before Unit 9 puts a
namespace-scoped Temporal credential in the shim env: `prctl(
PR_SET_DUMPABLE, 0)` first thing in the entrypoint (with PR_GET readback;
failure = refuse to start; non-Linux dev no-op). Real integration test
proves a same-uid child gets EACCES on `/proc/<shim>/environ` (control
read succeeds un-hardened; ptrace_scope=1). Children unaffected (flag
resets on execve). Ops note: shim can't be py-spy'd by same-uid ECS exec
and won't core-dump — intended. Remaining residual = shared kernel only.

**Unit 9 — Runner orchestration (scale-to-zero). ✅ DONE (#243 →
`f62667a`, deployed + infra-verified 2026-06-12).** Extended
TemporalWorkerStack (no new stack — orphan-trap avoidance): runner ECR
repo, RunTask-only task def (0.5 vCPU/1 GiB, empty task role — runner
holds no AWS creds; TEMPORAL_CLOUD_API_KEY via complete-ARN secret; NO
broker secret, CDK-test-asserted). Runner SG + subnet flow logs (ALL
traffic, 90-day, unnamed group) on WireGuardStack. Dispatcher lib
`apps/api/src/lib/tenant-runner.ts`: `startedBy = tenantId` (exactly 36
chars) dedupe via ListTasks; check-then-act race accepted (idle-exit
self-heals); wbk_ token KMS-recovered at launch, passed as RunTask
override (DescribeTasks-visible, IAM-gated, accepted v1); soft-fail
contract (failed launch → QUEUED + next-tick sweep retry). Call sites:
run path + per-minute dispatcher sweep (crash-recovery backstop) + pool
gauges (TenantRunnersRunning, ColdStartSeconds, Launched/LaunchFailed).
Cross-stack contract BY NAME (cluster/family/roles — cycle avoidance),
mirrored api-stack↔temporal-worker-stack. New tenant-runner.yml image
workflow (no service roll — `:latest` resolved per launch) + ci.yml
Python job. First image push raced repo creation exactly as predicted —
re-dispatch fixed; images live in both accounts.

**Unit 10 — Run-path routing + execution limits. ✅ DONE (#248 →
`271737d`, 2026-06-12). THE SANDBOX IS LIVE.**
`apps/api/src/lib/workflow-route.ts` = single routing source of truth:
curated name → STDLIB queue (incl. forked-curated shadowing — stdlib
baked code runs for curated names, documented); non-curated +
executable → TENANT_RUNNER (queue `pegasus-tenant-<tenantId>-<env>`,
suffix derived from the existing TEMPORAL_TASK_QUEUE var — a
coordinator-review catch: the worker invented a suffix env var nothing
injects, which would have stranded every tenant execution on `-dev`
queues); else NOT_EXECUTABLE. Limits (TENANT_RUNNER lane ONLY — curated
stdlib stays uncapped per locked scope): workflowExecutionTimeout 900 s
default, manifest `timeoutSeconds` 1–900 may lower (SDK field added,
bool-rejecting validation); concurrency cap 5 (in-tx count, overshoot-
by-1 race accepted); daily quota 200 (`TENANT_WORKFLOW_DAILY_QUOTA`,
UTC day, all statuses count, new `(tenantId, createdAt)` index —
CONCURRENTLY, empirically verified under `prisma migrate deploy`).
429 + `WorkflowExecutionRejected{Reason}` metrics; trigger fires
hitting limits stamp the event like START_FAILED (no retry). Worker
self-review caught a real bug: counts originally included curated
executions (executable=true too) — fixed with `notIn` curated names.
Interlude: esbuild advisory #249 (see status header).

**Unit 11 — UX + operational guardrails. ✅ DONE (#251 → `04626ec`,
2026-06-12).** Tenant-web: `ExecutabilityBadge` per row (curated /
ready / pending-reupload), Run disabled with tooltip for non-executable,
`requiredActions` + `timeoutSeconds` display, friendly 429/423 messages
(CONCURRENCY_LIMIT / DAILY_QUOTA_EXCEEDED / WORKFLOWS_DISABLED).
Admin: `Tenant.workflowsDisabled` kill switch (additive migration) —
enforced at run path (423, BOTH lanes, before any write/ECS/Temporal),
dispatcher (skip metric reason), and ensure/sweep (`SKIPPED_DISABLED`);
RUNNING executions finish (documented); idempotent audit-logged
enable/disable endpoints + tenant-page UI; `GET /api/admin/workflows/
runner-status` (ECS task list + per-tenant quota/concurrency rollup,
degrades gracefully when ECS unavailable) + 30 s auto-refresh panel.
Infra: 4 alarms on the existing ops SNS topic (launch-failed, dispatch
backlog, reconciled>5/hr, START_FAILED skips) + `Pegasus-Workflows`
dashboard. Review fix worth remembering: the reconcile emitter now
publishes a dimensionless roll-up alongside the `{Status}`-dimensioned
metric — CloudWatch alarms can't aggregate across dimensions, the alarm
would never have fired.

---

## Operator prerequisites (before Track A Unit 8)

- New ECR repo for the runner image (if separate from
  `pegasus-temporal-worker`) + the same out-of-band CI IAM inline-policy
  step Phase 2 Unit 5 needed.
- Temporal Cloud: confirm per-tenant task-queue count is uncapped on our
  plan (queues are lightweight, but verify). (Schedules-tier check dropped
  — Unit 4 no longer uses Temporal Schedules.)
- No new secrets expected — per-tenant broker creds are minted/KMS-wrapped
  by the API, not provisioned in Secrets Manager.

## Critical files (from Phase 2, all still load-bearing)

- `apps/api/src/handlers/workflows.ts` (run gate at the
  `WORKFLOW_NOT_EXECUTABLE` 400), `workflow-internal.ts` (broker),
  `apps/api/src/lib/curated-workflows.ts`
- `apps/api/src/lambda-reconcile-workflow-executions.ts` — the poller
  pattern Units 3/4/9 clone
- `apps/temporal-worker/pegasus_temporal_worker/{registry,runtime_client,status_sync}.py`
- `apps/api/prisma/schema.prisma` (`Workflow`, `WorkflowExecution`)
- `packages/infra/lib/stacks/{temporal-worker,api,wireguard}-stack.ts`,
  `packages/infra/bin/app.ts`
- `packages/workflows-sdk-python/pegasus_workflows/manifest.py`

## Out of scope for Phase 3 (explicit)

- In-app workflow authoring/editing; versioning UX (rollback/diff).
- Marketplace/sharing of tenant workflows beyond the existing GLOBAL
  library.
- Arbitrary pip dependencies in tenant artifacts (per the proposed v1
  decision; own follow-up if demanded).
- Billing/metering of executions (quotas yes, invoicing no).
- Replacing the outbox with EventBridge/SNS — revisit only if outbox volume
  hurts.
