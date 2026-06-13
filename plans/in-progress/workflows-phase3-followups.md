# Workflows Phase 3 — Follow-ups (cosmetic + product gap)

**Branch:** `plans/workflows-phase3-followups`
**Goal:** Close the two non-blocking issues surfaced by the Phase 3 staging
smoke (2026-06-13): (A) trigger-fired `send_quote_followup` prints
"quote quote-unknown"; (B) a non-platform tenant directly running a
non-curated GLOBAL workflow strands its execution.

Both are small, independent, and shippable separately. Predecessor (now
complete + archived): `plans/completed/workflows-phase3-sandboxed-tenant-code-and-triggers.md`.

---

## Unit A — stdlib `send_quote_followup` reads the EVENT envelope

**Severity:** cosmetic. The workflow runs and completes; the message body
just says `quote quote-unknown` whenever it was fired by a `quote.accepted`
trigger (the live smoke case). Manual runs that pass `{quote_id: ...}` are
unaffected.

### Root cause (verified in-code)

Two layers of the input contract don't line up for the EVENT path:

- **Dispatcher** (`apps/api/src/lambda-dispatch-workflow-triggers.ts:458`)
  starts a trigger-fired execution with `input` = the **event envelope**:
  ```
  { domainEventId, eventType, occurredAt, payload }
  ```
  and for `quote.accepted` the payload is `{ quoteId, moveId }`
  (`apps/api/src/handlers/quotes.ts:161` — **camelCase `quoteId`**).
- **Workflow** (`packages/workflows-stdlib/send_quote_followup/workflow.py`)
  reads `payload["input"].get("quote_id")` — **snake_case, and one level too
  shallow** (it looks at `input.quote_id`, not `input.payload.quoteId`). So
  the lookup always misses on EVENT runs and falls back to the
  `"quote-unknown"` default.

The workflow was written for the manual-run shape (`input.quote_id`, which a
caller could supply) and never updated when the Unit-3 dispatcher defined
the event-envelope shape.

### Fix

Make the stdlib workflow understand all three real input shapes it can
receive, preferring the event envelope:

1. EVENT envelope: `input.payload.quoteId` (the dispatcher's actual shape).
2. Manual run: `input.quote_id` (back-compat for a hand-supplied input).
3. `pegasus-workflows test`: raw positional string (already handled).

Resolve the id by checking, in order: `payload.payload.quoteId` →
`input.quote_id` → raw string → `"quote-unknown"`. Keep the existing
dict-vs-str branch; just deepen the dict lookup.

**Decision to make at implementation:** do we ALSO normalize on the
dispatcher side (e.g. flatten the payload into `input`)? **Recommendation:
no.** The envelope is the documented, intentional contract (comment at
`lambda-dispatch-workflow-triggers.ts:455` — "input is the event envelope;
payload is a pointer; workflows refetch authoritative state"). Every
event-triggered workflow must read `input.payload.*`. Fixing the one
stdlib workflow that got it wrong is correct; changing the envelope would
silently break the contract for future tenant workflows. Document the
envelope shape in the SDK README's authoring section as part of this unit
so the next author doesn't repeat the mistake.

### Files

- `packages/workflows-stdlib/send_quote_followup/workflow.py` — deepen the id
  lookup; update the `run()` docstring to describe the envelope.
- `packages/workflows-stdlib/tests/` (if present; else add) — unit test the
  three input shapes resolve the right id. Mirror SDK test conventions.
- `packages/workflows-sdk-python/README.md` — document the EVENT-fired
  `input` envelope (`{domainEventId, eventType, occurredAt, payload}`) in the
  authoring section.

### Verify

- stdlib + SDK pytest green.
- Optional staging re-confirm: with a `quote.accepted` trigger on
  `send_quote_followup`, accept a quote → the resulting execution's `result`
  contains the real quote id, not `quote-unknown`. (Needs the
  publish-stdlib path to redeploy the worker image, OR the QA push flow used
  in the Phase 3 smoke.)

### Risk

Trivial. Pure stdlib-workflow logic; no API/schema/infra change. The worker
image must rebuild for staging/prod to pick it up (`publish-stdlib.yml` on a
stdlib tag, or the temporal-worker image workflow on the SDK/stdlib path
filter) — same deploy path that shipped #256.

### Checklist

- [ ] Deepen `send_quote_followup` id resolution (envelope + manual + raw)
- [ ] Tests for all three input shapes
- [ ] Document the EVENT envelope in the SDK README
- [ ] stdlib/SDK pytest green; (optional) staging re-confirm

---

## Unit B — reject (don't strand) a direct cross-tenant run of a non-curated GLOBAL workflow

**Severity:** product gap / confusing UX. Not a data-loss or security issue,
but an execution that sits RUNNING and then FAILS at the 15-min
`workflowExecutionTimeout` with no useful error.

### Root cause (verified in-code)

- A tenant can resolve a GLOBAL workflow by id:
  `workflow.repository.ts findByIdForTenant` matches
  `{ id, OR: [{tenantId}, {visibility: 'GLOBAL'}] }`. So tenant B can pass a
  platform-owned GLOBAL workflow's id to `POST /:id/run`.
- Routing (`apps/api/src/lib/workflow-route.ts`): a non-curated, `executable`
  workflow → `TENANT_RUNNER`, started on queue `pegasus-tenant-<B>-<env>`
  with `ensureTenantRunner(B)`.
- The runner for B authenticates with B's `wbk_` token and discovers
  artifacts via `GET /internal/tenant-workflows`, whose query is
  `where: { tenantId: B, executable: true, artifactSha256 != null }`
  (`workflow-internal.ts:452`). A GLOBAL row owned by the **platform tenant**
  has `tenantId` = platform, **not B** → B's runner never sees it, never
  registers a proxy under that workflow name → the Temporal workflow started
  on B's queue has no registered type → workflow-task retry loop → stuck
  RUNNING until the timeout → FAILED. (Same failure shape as the #256 bug,
  but caused by ownership, not registration naming.)

**Why the smoke didn't catch it:** the QA tenant `b40b082e` IS the platform
tenant, so it owns its GLOBAL rows — its runner's discovery includes them.
The strand only manifests for a **non-platform** tenant.

**Supported path today:** fork the GLOBAL workflow first
(`POST /:id/fork` → a TENANT-owned row under `tenantId = B` with the artifact
copied to `workflows/B/...`), then run the fork. Fork-then-run routes and
discovers correctly.

### Fix (recommended: reject with an actionable error)

In `startWorkflowExecution` (`apps/api/src/lib/start-workflow-execution.ts`),
after routing resolves `TENANT_RUNNER`, add a guard: if the workflow row's
owning `tenantId !== ` the caller's `tenantId` (i.e. it's a GLOBAL row the
caller doesn't own), return a new outcome `MUST_FORK` instead of starting.
The manual handler maps it to a 4xx (suggest **409 Conflict** or **422**)
with code `WORKFLOW_MUST_FORK` and a message like *"Fork this workflow into
your tenant before running it."* The dispatcher treats `MUST_FORK` like the
other skip reasons (it should never occur for triggers — a tenant only
attaches triggers to its own/forked rows — but handle defensively with a
distinct `WorkflowTriggerSkipped{Reason}` metric).

- Curated GLOBAL workflows are unaffected: they route `STDLIB` and never
  reach this guard.
- The owning tenant (platform) running its own non-curated GLOBAL row is
  unaffected (tenantId matches) — preserves the Phase 3 smoke behavior.
- The check needs the row's owning `tenantId`; confirm `WorkflowRow` /
  `WORKFLOW_SELECT` exposes it (add to the select if not).

### Alternatives considered (document the choice in the PR)

- **Auto-fork on run:** transparently fork then run. Rejected for v1 — hides
  a row-creating side effect behind a "run" verb; surprising and harder to
  reason about quota/ownership. Revisit if product wants one-click "run a
  library workflow."
- **Let runners fetch GLOBAL artifacts:** widen the discovery endpoint to
  also return GLOBAL executable rows and presign their artifacts for any
  tenant's runner. Rejected for v1 — it crosses the per-tenant credential
  boundary (a runner would fetch another tenant's artifact bytes) and needs
  a deliberate security review; the fork model already gives tenants an
  owned copy cleanly.

### Files

- `apps/api/src/lib/start-workflow-execution.ts` — `MUST_FORK` outcome + guard.
- `apps/api/src/handlers/workflows.ts` — map `MUST_FORK` → 4xx
  `WORKFLOW_MUST_FORK` on `POST /:id/run`.
- `apps/api/src/lambda-dispatch-workflow-triggers.ts` — handle `MUST_FORK`
  defensively as a skip with its own metric reason.
- `apps/api/src/repositories/workflow.repository.ts` — ensure `WorkflowRow`
  exposes the owning `tenantId` (extend `WORKFLOW_SELECT` if needed).
- Tests: run-path matrix (own non-curated executable → STARTED; **GLOBAL
  non-curated executable run by a non-owning tenant → MUST_FORK, nothing
  written, no runner launched**; curated GLOBAL → STDLIB unaffected; forked
  copy → STARTED). Handler test for the 4xx mapping.
- Optional: tenant-web run dialog message for `WORKFLOW_MUST_FORK`
  ("Fork before running") — can fold into this unit or defer to a UX pass.

### Verify

- `npm test -w apps/api` (new matrix RUNs), root typecheck, lint.
- No schema/infra change expected. If `WORKFLOW_SELECT` already carries
  `tenantId`, this is API-logic-only.

### Risk

Low. Additive outcome + guard on a path that currently produces a worse
result (a 15-min strand). Main care: don't regress the legitimate cases
(owner running its own GLOBAL row; curated GLOBAL; forked rows) — the test
matrix pins all four.

### Checklist

- [ ] `MUST_FORK` outcome + owning-tenant guard in `startWorkflowExecution`
- [ ] 4xx `WORKFLOW_MUST_FORK` mapping in the run handler
- [ ] Dispatcher defensive skip + metric
- [ ] `WorkflowRow` exposes owning `tenantId` (if not already)
- [ ] Run-path test matrix (4 cases) + handler test
- [ ] (optional) tenant-web run-dialog message
- [ ] typecheck / lint / `npm test -w apps/api` green

---

## Sequencing / notes

- The two units are independent — ship in either order, separate PRs.
- Neither needs a CDK/infra change.
- Both were recorded as non-blocking follow-ups in the archived Phase 3 plan
  and the `project_workflows_phase2_status` memory.
