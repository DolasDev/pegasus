# Pegasus Workflows — Phase 3: Sandboxed Tenant Code + Triggers

**Status: IN PROGRESS — Track B (Units 1–5) ✅ + Unit 6 ✅ COMPLETE and
LIVE** (PRs #230–#234, #239). Scoped 2026-06-09; all 5 open questions
resolved with Steve — see "Resolved decisions". Units 7 (#240) + 8
(#241) ✅ DONE. **Next: Track A Unit 9 (runner orchestration /
scale-to-zero, CDK) — the "Operator prerequisites" section now bites:
ECR repo (stack-created is fine, see Phase 2 precedent) + the
out-of-band CI IAM inline-policy step + Temporal Cloud queue-count
check.**

## Resume-session checklist

1. Read this file top-to-bottom + the `project_workflows_phase2_status`
   memory (carries the Phase 3 ledger + Track B lessons).
2. **Verify the last deploy finished green:**
   `gh run list --workflow deploy.yml --limit 3` —
   if a run failed or was cancelled, fix/redispatch FIRST
   (`[[feedback_rapid_main_pushes_cancel_deploy]]`).
3. **Run the Track B staging smoke** (still outstanding as of
   2026-06-11 — see the Track B banner below). ~10 min, needs a staging
   login. Add to it now: re-publish the stdlib (or upload any artifact)
   and confirm the row gets `executable: true` + a sha (Unit 6 smoke).
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

**Unit 9 — Runner orchestration (scale-to-zero).** Dispatcher (likely
folded into the Unit-3 poller or the run path) launches a runner via ECS
`RunTask` for any tenant with QUEUED work and none running (Resolved #1);
the runner self-terminates after ~10 min idle; CloudWatch metrics for
cold-start latency + running-runner count. VPC flow logs on the runner
subnets (Resolved #2). New/extended CDK stack — re-read
`[[feedback_cdk_secret_complete_arn_for_ecs]]` and
`[[feedback_cdk_retain_orphans_on_rollback]]` before writing it.

**Unit 10 — Run-path routing + execution limits.** Lift the curated-only
gate: route `executable` tenant workflows to their tenant queue, curated
names to the stdlib queue. Runtime accounts keep the static
`workflow_runtime` role (Resolved #5 — no dynamic scoping;
`requiredActions` stays display-only). Enforce the v1-blocking limits
(Resolved #3): per-execution Temporal timeouts, per-tenant concurrency
cap, executions/day quota with 429 surfacing.

**Unit 11 — UX + operational guardrails.** Tenant-web: surface
executability, requested permissions, and limit errors. Admin-web: per-tenant
kill switch (disable all triggers + runners), runner status, quota view.
Dashboards/alarms for runner crashes, trigger backlog, reconciled
executions.

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
