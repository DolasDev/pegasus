# Pegasus Workflows — Phase 3: Sandboxed Tenant Code + Triggers

**Status: SCOPED, not started** (scoped 2026-06-09, immediately after Phase 2
archived). This is a scoping plan — design decisions below are marked
**locked**, **proposed**, or **OPEN**. Resolve the OPEN questions (ideally with
Steve) before promoting any unit to execution.

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
- **Events**: the only event infrastructure is `PegasusEvent` — an *inbound*
  M2M integration queue (`apps/api/src/handlers/events.ts`, poll-based).
  **The API emits no domain events anywhere** (no outbox, no EventBridge, no
  emission on quote-accept / move-status-change / invoice-paid).

### The security pivot this phase forces

Phase 2's trust model is "all code in the worker image is ours." Phase 3
breaks that. Two consequences shape the whole design:

- **The shared broker secret cannot reach any process that imports tenant
  code.** Python import = arbitrary code execution in-process; tenant code
  could read `WORKFLOW_BROKER_SECRET` from env and use it to mint *any*
  tenant's runtime token (the endpoint only needs an executionId) or forge
  status PATCHes. The isolation boundary must be: **a runner container only
  ever holds credentials scoped to one tenant.**
- **Static `workflow_runtime` role is too broad for untrusted code.**
  Dynamic scoping from `requiredActions` graduates from nice-to-have to a
  security control.

---

## Scope decisions

### Locked (inherited from Phase 2 / platform constraints)

- Temporal Cloud remains the orchestrator; workers are self-hosted Fargate
  in the WireGuard VPC (`PRIVATE_WITH_EGRESS` subnets + existing NAT).
- Upload path is unchanged — same SDK, manifest, finalize flow. Phase 3
  changes what happens *after* upload, not authoring.
- Runtime tokens stay per-workflow `vnd_` service accounts, KMS-encrypted at
  rest, fetched live via broker, never in Temporal history.
- The curated stdlib keeps running exactly as today (shared
  `pegasus-stdlib-<env>` queue, trusted image). Phase 3 adds a *parallel*
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
  filter; SCHEDULE rows carry a cron expression realized as a **Temporal
  Schedule** (native, no new infra). Both fire through the *same* internal
  run path as `POST /:id/run`, with provenance recorded on the execution.
- **Domain events via transactional outbox.** New `DomainEvent` table +
  `emitDomainEvent()` helper written in the same Prisma transaction as the
  state change; a poller Lambda (mirror the reconcile-poller pattern,
  `apps/api/src/lambda-reconcile-workflow-executions.ts`) drains it and
  matches trigger subscriptions. No EventBridge/SNS until volume demands it
  — the outbox keeps emission atomic with the domain write, which a direct
  bus publish can't.
- **Sequencing: triggers land first.** Track B is independent of the
  sandbox, lower-risk, and immediately useful — triggers firing *curated*
  (incl. forked-curated) workflows is real tenant value on its own. Track A
  is the heavy lift. If this phase feels too big as one arc, split into
  **3A = triggers** and **3B = sandboxed tenant code** at promotion time.

### OPEN — resolve before execution

1. **Runner compute shape.** ECS `RunTask` per demand-window (proposed) vs a
   per-tenant ECS service with dispatcher-managed desiredCount vs
   Lambda-container per execution. Phase 2 noted Lambda is wrong for
   long-poll *workers*, but a "start runner, poll until idle, exit" model
   blurs that. Cost at 10–50 tenants matters: N idle Fargate tasks ≈ $9/mo
   each — scale-to-zero is likely mandatory, but cold-start (image pull +
   venv install, ~30–60 s) then bounds trigger latency. Decide the
   latency/cost tradeoff.
2. **Egress policy for tenant code.** Tenant code calling external APIs is a
   feature (that's the point of workflows) but also exfil/abuse surface.
   Options: open egress via existing NAT (simplest, proposed for v1, log
   flows) vs SG-restricted to Pegasus API + Temporal only (safe, crippling)
   vs egress proxy with allowlist (right long-term, real work).
3. **Resource/abuse limits.** Per-execution Temporal timeouts (must set —
   today curated workflows are trusted to finish), per-tenant concurrent
   execution cap, executions/day quota, artifact size cap, runner
   CPU/memory. Which are v1-blocking vs dashboards-later?
4. **Event taxonomy + emit points.** Which domain events exist at launch?
   Proposed starter set: `quote.accepted`, `move.status_changed`,
   `invoice.paid`, `customer.created`, plus `pegasus_event.received`
   (bridging the existing inbound M2M queue so legacy/desktop events can
   trigger workflows). Needs product sign-off — the taxonomy is a public
   contract.
5. **`requiredActions` cap.** Dynamic scoping needs an allowlist of actions
   a workflow may request at all (e.g. read-mostly + `CreateEvent`; never
   admin/tenant-management actions). Who defines the cap, and is exceeding
   it an upload-time rejection (proposed) or a grant-time silent trim?

---

## Units (proposed breakdown — Track B first)

### Track B — triggers (no sandbox dependency; fires curated/forked workflows)

**Unit 1 — Domain-event outbox.** `DomainEvent` model
(`id, tenantId, eventType, payload Json, occurredAt, dispatchedAt?`,
indexed on `[dispatchedAt, occurredAt]`) + `emitDomainEvent(tx, ...)` helper
+ first emit points inside the existing handler transactions for the starter
taxonomy (OPEN #4). Purely additive; nothing consumes it yet.

**Unit 2 — `WorkflowTrigger` schema + CRUD API.** Model
(`id, tenantId, workflowId FK, kind EVENT|SCHEDULE, eventType?, filter Json?,
cronExpression?, enabled, createdByUserId`) + tenant-scoped CRUD under
`/api/v1/workflows/:id/triggers`, gated by a new `ManageWorkflowTriggers`
Cedar action (remember the AVP bulk-sync throttle lesson —
`[[feedback_avp_bulk_sync_throttle_retry]]` — when the new action syncs).
Add trigger provenance to `WorkflowExecution`
(`triggeredByTriggerId?`; make `triggeredByUserId` nullable or introduce a
`triggerSource USER|EVENT|SCHEDULE` enum).

**Unit 3 — Trigger dispatcher.** Poller Lambda (clone the reconcile-poller
shape: EventBridge 1-min rate, root `db`, bounded batch) that drains
undispatched `DomainEvent` rows, matches enabled EVENT triggers on
`(tenantId, eventType)` + filter, and starts executions via a shared
internal run function extracted from the `POST /:id/run` handler. Idempotency
via the existing `REJECT_DUPLICATE` Temporal id scheme keyed on
`(triggerId, domainEventId)`.

**Unit 4 — Scheduled triggers.** SCHEDULE-kind triggers create/update/delete
a Temporal Schedule (`pegasus-trigger-<triggerId>`) targeting the same run
path. Reconcile drift (DB row ↔ Temporal Schedule) in the dispatcher or a
slow poller.

**Unit 5 — Trigger UI.** `settings.workflows.tsx` per-workflow "Triggers"
section: list/create/enable/disable (event-type dropdown from the taxonomy,
cron editor with next-fire preview), execution rows badge their trigger
source. Follows the Unit-7 (Phase 2) executions-list patterns.

### Track A — sandboxed tenant-code execution

**Unit 6 — Artifact integrity + eligibility.** sha256 recorded at finalize
(verify S3 object before first registration), zip-structure validation
(entry points resolvable, size cap, no deps per the v1 dependency
decision), `Workflow.executable` derived server-side. Schema +
finalize-handler change; nothing executes yet.

**Unit 7 — Per-tenant broker credentials.** New credential type scoped to
one tenantId; broker endpoints accept either (shared secret = legacy stdlib
worker, tenant token = runners) and enforce tenant match on the execution
row. This is the security keystone — land and review it before any runner
exists.

**Unit 8 — Tenant-runner image + harness.** New `apps/tenant-runner/` (or a
mode of the existing worker — decide at planning): trusted shim downloads
the tenant's executable artifacts from S3, installs each into an isolated
venv, registers manifest entry points dynamically, polls
`pegasus-tenant-<tenantId>-<env>`; tenant code runs in a stripped-env
subprocess. Local-dev story via `docker-compose.temporal.yml` (mirror the
Phase-2 `temporal-worker` service).

**Unit 9 — Runner orchestration (scale-to-zero).** Dispatcher (likely
folded into the Unit-3 poller or the run path) ensures a runner task is up
for a tenant with QUEUED work, per OPEN #1; idle-stop; CloudWatch metrics
for cold-start latency + running-runner count. New/extended CDK stack —
re-read `[[feedback_cdk_secret_complete_arn_for_ecs]]` and
`[[feedback_cdk_retain_orphans_on_rollback]]` before writing it.

**Unit 10 — Run-path routing + dynamic token scoping.** Lift the
curated-only gate: route `executable` tenant workflows to their tenant
queue, curated names to the stdlib queue. Mint runtime accounts with a
Cedar policy generated from `requiredActions` ∩ the cap allowlist (OPEN
#5) instead of the static `workflow_runtime` role. Per-execution Temporal
timeouts + per-tenant concurrency cap (OPEN #3).

**Unit 11 — UX + operational guardrails.** Tenant-web: surface
executability, requested permissions, and limit errors. Admin-web: per-tenant
kill switch (disable all triggers + runners), runner status, quota view.
Dashboards/alarms for runner crashes, trigger backlog, reconciled
executions.

---

## Operator prerequisites (before Track A Unit 8)

- Decide OPEN #1–#3 (compute shape, egress, limits) — they change the CDK
  surface.
- New ECR repo for the runner image (if separate from
  `pegasus-temporal-worker`) + the same out-of-band CI IAM inline-policy
  step Phase 2 Unit 5 needed.
- Temporal Cloud: confirm per-tenant task-queue count is uncapped on our
  plan (queues are lightweight, but verify) and whether Schedules are
  available on the current tier (Track B Unit 4).
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
