# Benign workflow test mode — implementation workstream

**Spec:** `pegasus-workflows/sdk-feedback/0015-benign-workflow-test-mode.md` (filed 2026-07-14, SDK 0.10.0, status Proposed)
**Workstream owner branch(es):** one worktree per phase (see Phasing). Plan authored from primary checkout on `main`.
**One-line goal:** Give every workflow a benign way to rehearse end-to-end — a server-side `--dry-run` execution mode (real reads, captured mutations), a platform outbound-delivery primitive that closes the raw-`httpx` blind spot, a local offline fixture harness, and a web-UI trace an operator can read.

> This is a **multi-PR, multi-release workstream**, not a single branch. Each phase below is independently shippable and (for SDK phases) its own PyPI release. Phases C and B are standalone and can run in parallel; A is the core platform piece; D is UI on top of A. Spin a fresh worktree per phase with `scripts/new-worktree.sh <type> <slug>` off fresh `origin/main`.

---

## Grounding (verified 2026-07-14)

Authoritative SDK source: `packages/workflows-sdk-python` (v0.10.0). Consumer workflows + the spec live in the separate `pegasus-workflows` repo.

**Run dispatch (single choke point).** `POST /api/v1/workflows/:id/run` → `apps/api/src/handlers/workflows.ts:905` (`RunBody` Zod at `:167`, `{ input }` only, no mode) → shared `startWorkflowExecution(...)` in `apps/api/src/lib/start-workflow-execution.ts:383` (also used by retry + trigger-dispatcher Lambda). The only channel into the worker is the Temporal `args: [{ executionId, input }]` at `start-workflow-execution.ts:552`; the worker fetches its runtime `vnd_` token out-of-band from `POST /api/v1/internal/workflow-runtime-token` keyed by `executionId`.

**Runtime capability endpoints** (called by `PegasusClient`, mapping in `packages/workflows-sdk-python/pegasus_workflows/api.py`), reads vs mutations:
- Reads (safe to run live in a test): `get_order`/`list_orders` (`ReadOrder`), `list_tasks`/`get_task` (`ReadTask`), `get_projection`/`list_projections` (`ReadIntegrationProjection`), `get_config` (`ReadWorkflowConfig`), `get_secret` (`ReadWorkflowSecret`), `map_to_external` (**no** Cedar action — open `vnd_`-key), `validate_integration_config`, and the `list_customers/quotes/moves/inventory/invoices/events` reads.
- Mutations (must be captured, never performed in dry-run): `send_sms` (`SendSms`, `handlers/sms.ts:57`), `emit_event` (`EmitTenantEvent`, `handlers/event-types.ts:291`), `close_task` (`CloseTask`, `handlers/pegii-runtime.ts:147`), `put_projection`/`delete_projection` (`WriteIntegrationProjection`, `handlers/integration-projections.ts:109`), plus **any raw outbound network** (the blind spot).

**`map_to_external` is the symmetric template for `deliver_to_external`** — handler `apps/api/src/handlers/integration-validation/validate.ts:119`, but it is gated only by `apiClientAuthMiddleware` (any non-revoked `vnd_` key, no `requirePermission`, no Cedar action) because it is a pure read-only transform. `deliver_to_external` is a *mutation with an external side effect* → it must NOT reuse the open surface; it needs a real `requirePermission(Actions.DeliverToExternal)` gate.

**Cedar registration pattern** (4 steps, documented at `apps/api/src/authz/actions.ts:12`): add to `Actions` const (`actions.ts:57`) → add to `cedar.schema.json` `actions` map with `appliesTo` → reference in `apps/api/src/authz/policies/30-personas/workflow-runtime.cedar:22` → mount `requirePermission(...)` on the route. `VALID_ACTION_IDS` (`handlers/workflows.ts:82`) gates what a manifest's `required_actions` may declare — so the action must land before any workflow can declare it.

**Execution inspection (PR #376).** `GET /:id/executions`, `/:executionId`, `/:executionId/history` (Temporal-history flatten via `summarizeWorkflowHistory`), cancel/retry — all `apps/api/src/handlers/workflows.ts:952-1179`. `WorkflowExecution` row (`apps/api/src/repositories/workflow-execution.repository.ts`) holds `input`/`result` — the natural place to persist a `dryRun` marker + capture log.

**tenant-web inspection UI (PR #376).** Detail page `apps/tenant-web/src/routes/settings.workflows.$workflowId.tsx` (Overview + Executions tabs; `ExecutionDetail` renders the Temporal timeline). List page `settings.workflows.tsx` has the **Run** button → `RunWorkflowDialog` → `useRunWorkflow()` → `POST .../run`. API client `apps/tenant-web/src/api/workflows.ts`; query wrappers `apps/tenant-web/src/api/queries/workflows.ts`. Router: `apps/tenant-web/src/router.tsx`.

**Motivating workflows (in `pegasus-workflows` repo).**
- `platform/send_order_to_partner/.../workflow.py` — `fetch_order` → `map_order_to_external_body` → `send_to_partner`; the last does **raw `httpx.post(SEND_URL, ...)`** with `SEND_API_KEY`. All three carry `if client is None: return {"stub": True}`. Manifest `required_actions = ["ReadOrder","ReadWorkflowConfig","ReadWorkflowSecret"]`.
- `nw/order_lifecycle/.../workflow.py` — `close_date_confirmation_task` is a full stub (`⚠️ STUB … no task API`); note `close_task` now exists in SDK, so this stub is separately un-stubbable.
- `platform/send_order_saved_sms/.../workflow.py` — single `deliver_sms` activity, already unstubbed (`SendSms`).

**Confirmed absent / net-new:** no `pegasus_workflows.testing` module exists. **`IntegrationConfig` (prisma `:1419`) stores only `mapping`/`rules`/`corpus` — no outbound endpoint or credential anywhere.** The partner URL+key live today as per-workflow config/secret, not as platform-held integration config. → see Decision 2.

---

## Temporal-native strategy (researched 2026-07-14 — read before implementing)

We checked what Temporal offers natively vs. what we must build. Summary: **Temporal has excellent native *testing* primitives (use them in Phase C), but no native dry-run / side-effect suppression — and this repo's tenant-execution model bypasses the Temporal features that would otherwise help Part A/D.**

**What Temporal gives us for free (use it):**
- **`temporalio.testing.ActivityEnvironment().run(fn, *args)`** runs a single `@activity.defn` in a real activity context. This is the idiomatic backing for Phase C's `run_activity` — **do not hand-roll it.** `apps/temporal-worker/tests/test_worker_e2e.py` already uses the sibling `WorkflowEnvironment` (`start_local`), so this is an established repo pattern.
- **`WorkflowEnvironment.start_time_skipping()` + a `Worker` with same-name/signature mock activities** is the idiomatic whole-workflow offline test (no docker for the app server; downloads a test-server binary). Fidelity caveat below.

**What Temporal does NOT give us (must build in our layer):**
- **No native "dry-run" that suppresses side effects.** Temporal is agnostic to what an activity does — an `httpx.post` or a `client.send_sms()` inside an activity is invisible to it. So mutation interception is fundamentally ours (Decision 1).
- **`Replayer` is determinism validation, NOT re-execution.** The spec's "replay a past event" (Part D) is therefore **not** Temporal replay — it's just starting a fresh dry-run execution with the saved trigger payload as input. Do not conflate; do not reach for `Replayer`.

**The decisive architectural fact — how tenant code actually runs (`apps/tenant-runner`):**
Temporal only ever sees a **proxy workflow → one opaque activity** (`run_tenant_entry_point`, `proxy.py:118`). The real tenant workflow body runs in a **subprocess with no Temporal connection** (`subprocess_driver.py`), where `_install_direct_execution_patches()` (`subprocess_driver.py:63`) already monkey-patches `workflow.execute_activity`/`execute_local_activity`/`sleep`/`now`/`uuid4` into **direct in-process calls**. "The whole workflow runs as ONE unit of work" (v1 semantics; per-activity durability/replay/signals deferred). Consequences:
1. **Temporal event history is NOT a usable capture-log source for tenant workflows** — `summarizeWorkflowHistory` (`temporal-client.ts:118`) would show only the single proxy activity, and today it doesn't even surface activity `input`/`result` payloads (both present on the raw proto, neither read). So Part D's per-activity trace **cannot** come from Temporal history.
2. **The `_direct_execute_activity` monkey-patch seam is THE injection point** for dry-run — it already wraps every tenant activity call. Wrapping it to (a) record `{activity, args, result}` into a per-execution trace and (b) know the dry-run flag is a *small, localized* change, far cleaner than scattering `is_dry_run` across every `PegasusClient` method or building a Temporal interceptor (which sits at the proxy boundary and can't see inside anyway).
3. **Capture-log transport is nearly free:** the subprocess already returns its result up through the proxy activity into `WorkflowExecution.result`. Attach the trace + capture log there → the existing execution-detail endpoint surfaces it to Part D. No bespoke `/internal/.../capture` endpoint needed.

**Temporal tagging (idiomatic, currently greenfield — nothing in the repo uses Search Attributes / Memo / Interceptors / tags):**
- Add a **`Memo` `{ dryRun: true }`** to `client.workflow.start` (`start-workflow-execution.ts:552`) — trivial, makes dry-runs filterable in the Temporal Web UI. Recommended.
- A registered custom **Search Attribute** (`dryRun`) would allow `ListWorkflows` filtering but needs namespace registration in CDK (`packages/infra`) — heavier; optional/ops-nice-to-have. The app's own dashboards filter on the Postgres `WorkflowExecution.dryRun` column regardless.

**Related finding to flag (not in scope, but adjacent):** there's a **fidelity gap** — `pegasus-workflows test` (`cli/test.py`) runs the workflow as a *real* Temporal workflow (registers `workflow_cls` + real activities on a real dockerized Temporal), whereas production runs it via the proxy + subprocess direct-execution model. A dry-run that reuses the subprocess driver is *more* production-faithful than the current `test` command. Worth a note in the SDK docs; possibly a future convergence.

**Net effect on the plan:** Phase C leans on `ActivityEnvironment`; Phase A's interception + trace capture live at the `subprocess_driver` seam (not PegasusClient branches, not Temporal interceptors); the capture log rides the proxy result into `WorkflowExecution.result`; Temporal `Memo` tags the execution; Part D reads the result, not Temporal history.

---

## Decisions — LOCKED 2026-07-14

- **Decision 1 → 1a (driver-seam interception).** Dry-run enforcement is client/driver-side: the subprocess driver injects a dry-run `PegasusClient` + wraps `_direct_execute_activity` for trace capture; capture rides the proxy result into `WorkflowExecution.result`. 1b (server-side token scope) is a documented later-hardening follow-up, not v1.
- **Decision 2 → 2b (server-side call over existing workflow config/secret).** `deliver_to_external` executes the POST server-side using the workflow's own `SEND_URL`/`SEND_API_KEY` (moved out of the activity so it's interceptable), rather than net-new platform-held integration config. 2a (platform-held delivery binding on the integration) is a possible later evolution.
- **Decision 3 → sequence C ∥ B → A → D**, each its own PR/release.

## Decision detail (superseded by the LOCKED block above; kept for rationale)

**Decision 1 — Dry-run enforcement model (affects Phase A).** *(Refined by the Temporal-native research above — the injection point is now identified as the subprocess-driver seam, not scattered client branches.)*
- **(1a) Driver-seam interception [RECOMMENDED for v1].** The runner marks the execution dry-run; the **subprocess driver** (`subprocess_driver.py`) reads it, injects a dry-run `PegasusClient` (so mutating capability calls — `send_sms`, `emit_event`, `close_task`, `put_projection`, `deliver_to_external` — are suppressed + captured, reads pass through live), and wraps `_direct_execute_activity` to record the per-activity trace. `client.is_dry_run` + `record_side_effect` are still exposed to author code. Trace + capture log return up through the proxy activity into `WorkflowExecution.result`. Touches **no** mutating capability handler and needs **no** new capture endpoint. Weakness: trust-based — raw outbound network (raw `httpx`) still escapes the injected client, which is exactly what Phase B fixes for the one send that matters.
- **(1b) Server-side scope enforcement [hardening follow-up].** The runtime token minted for a dry-run execution carries a `dry-run` scope; every mutating handler checks it and captures instead of performing. Genuinely enforced regardless of client behavior, but touches every mutating handler + token minting; still can't stop raw `httpx` (only Phase B / an egress guard does).
- **Recommendation:** ship **1a**; note 1b as later hardening. Capture-log transport is settled by the architecture: **the subprocess already returns its result through the proxy → land the trace in `WorkflowExecution.result`; no new endpoint.**

**Decision 2 — Where `deliver_to_external`'s endpoint + credential live (affects Phase B size).**
- **(2a) Platform-held on the integration [spec's intent, larger].** Add an outbound-delivery binding (endpoint URL + credential reference) to the integration definition/config; platform holds the secret. Delivers the spec promise ("config/secret shrink to nothing for the send", symmetric with `map_to_external`) but is net-new config schema + a secret-storage decision + admin surface to set it.
- **(2b) Server-side call over existing workflow config/secret [lighter].** `deliver_to_external` still reads the workflow's own `SEND_URL`/`SEND_API_KEY`, but the POST executes **server-side** so dry-run can intercept it. Removes raw `httpx` from the workflow and makes the send interceptable (the core win) without new integration schema — but creds stay workflow-scoped, not "platform-held".
- **Recommendation:** decide with the user. 2b is a materially smaller first step that still unblocks Phase A's benign-ness on `send_order_to_partner`; 2a can follow. **This is the single biggest scoping unknown in the workstream.**

**Decision 3 — Scope for v1.** Full 4-part workstream vs. start with the cheap standalone wins (C + B) and gate A/D on their landing. Recommendation: sequence C+B → A → D; treat each as its own PR/release and re-plan A/D once C/B land.

---

## Phasing (dependency order: C ∥ B → A → D)

### Phase C — Local fixture harness (SDK only; offline; cheapest, safest) — **IN PROGRESS (SDK slice done)**
Goal: ship `pegasus_workflows.testing` so an activity's real body runs offline against canned reads and side effects are asserted from a capture log — replacing the `if client is None` stubs in shipped source.

- [x] `packages/workflows-sdk-python/pegasus_workflows/testing/__init__.py` — `fake_client(reads={...})` returns a `FakeClient` (duck-typed, `__getattr__`-dispatched): reads served from fixtures; every mutating method appends `{method, capability, args, kwargs, would_return}` to `client.captured` and returns a synthetic, realistically-shaped success. Exposes `is_dry_run=True` + `record_side_effect(label, payload)` matching the Phase A surface.
- [x] `run_activity(activity_fn, *args, client=...)` — backed by `temporalio.testing.ActivityEnvironment().run(...)`; injects the fake by patching `PegasusClient.from_runtime` for the call (handles sync + async activities via `inspect.isawaitable`). Async variant `arun_activity` for async tests.
- [x] Unit tests `tests/test_testing_harness.py` (23) — read pass-through (keyed + whole-value), capture on each mutation, empty-capture on a benign read, real-body-not-stub via `run_activity`, sync activity, patch restoration, missing-fixture errors, IGNORED-method guard, and an **anti-drift test** asserting every `PegasusClient` runtime method is classified. Full suite 260 pass; ruff clean.
- [x] SDK minor bump `0.10.0 → 0.11.0` + `CHANGELOG.md` entry + README "Testing activities offline" section.
- [ ] **Publish to PyPI** — deferred to explicit release go. NB: Phase B (below) also lands on this branch and bumps the SDK to `0.12.0`, so a combined release ships one tag `sdk-python-v0.12.0` (CHANGELOG carries both the 0.11.0 harness + 0.12.0 delivery entries). Watch checks with `--watch` per prior gotcha.
- [ ] **In `pegasus-workflows` repo** (separate PR, separate repo): rewrite `send_order_to_partner` + `order_lifecycle` tests onto the harness; delete the `if client is None` / `{"stub": True}` branches from shipped source. (Depends on 0.11.0 being on PyPI first.)
- [ ] (Optional, deferred) whole-workflow helper over `WorkflowEnvironment.start_time_skipping()` — not needed for the two motivating workflows; note the production fidelity gap when added.
- Anti-drift satisfied: `test_classification_covers_every_client_method` fails if the SDK adds an unclassified `PegasusClient` method.

### Phase B — Outbound delivery primitive `deliver_to_external` (API + Cedar + SDK) — **DONE (platform+SDK), consumer rewrite pending**
Goal: make partner delivery a platform capability so it is interceptable in dry-run and no longer raw `httpx`. Decision 2b: creds from the workflow's own config/secret, POST performed server-side.

- [x] Cedar: `DeliverToExternal` action added via the 4-step pattern — `actions.ts` (resourceType `IntegrationConfig`, permission `integration:deliver`), `cedar.schema.json`, `workflow-runtime.cedar` grant, route gate. `tenant_admin` blanket-covers it (authz invariants hold).
- [x] API endpoint `POST /api/v1/integrations/:integrationId/deliver-to-external` — new `handlers/integration-delivery.ts`, mounted on `m2mV1` under `dualAuthMiddleware` + `requirePermission(Actions.DeliverToExternal)`. Validates integration (404 unknown), reads `SEND_URL` config + `SEND_API_KEY` secret server-side (404 if unset), POSTs, returns `{delivered,status,response,dryRun:false}`. **SSRF guard** `assertDeliverableUrl` blocks non-http(s) + loopback/RFC1918/link-local (incl. 169.254.169.254). 22 handler tests (incl. real-Cedar 403 for tenant_user/viewer) + guard table; `me.test.ts`/`authz.test.ts` parity green; `tsc` clean.
- [x] Dry-run behavior lives **client-side** (Decision 1a): the endpoint runs only on real runs; the fake/dry-run client captures `deliver_to_external` and returns `{delivered:false,dryRun:true}` without calling the server. Fake classification + synthetic return added; harness anti-drift green.
- [x] SDK: `PegasusClient.deliver_to_external(integration_id, body, *, url_config, api_key_secret, headers_config, group)` in `api.py` (3 api tests). Bumped `0.11.0 → 0.12.0` + CHANGELOG + README "Delivering a body to a partner endpoint". MCP `pegasus://reference/api` picks it up via introspection.
- [ ] **PyPI publish** `sdk-python-v0.12.0` — deferred to explicit release go.
- [ ] **In `pegasus-workflows` repo** (separate PR/repo): rewrite `send_order_to_partner.send_to_partner` to call `deliver_to_external`; drop `httpx` import + `SEND_URL`/`SEND_API_KEY` reads; manifest `required_actions` += `DeliverToExternal`. (Depends on 0.12.0 on PyPI.)
- [ ] **SSRF hardening follow-up**: `assertDeliverableUrl` is a baseline guard (no DNS-rebinding protection / egress allowlist). Consider an allowlist or resolve-then-pin before GA on untrusted tenants.
- Note: diverged from the spec's "integration's *configured* endpoint" wording per Decision 2b — `integration_id` is validated + recorded but creds come from workflow config. Update spec 0015 acceptance/validation log accordingly.

### Phase A — Server-side dry-run execution — **FUNCTIONAL END-TO-END (A1a+A2+A3+A4 done); A1b column pending**

Status: a dry-run works end-to-end today — `run --dry-run` → API threads the flag → runner subprocess driver injects the dry-run client + captures the trace → result envelope `{dryRun, return, trace, captured}` lands in `WorkflowExecution.result` (+ Temporal `memo{dryRun}`). Done:
- [x] **A2 SDK dry-run client** — `from_runtime()` reads `PEGASUS_DRY_RUN`; 12 mutating methods capture-not-perform; process-global sink; `is_dry_run`/`record_side_effect`. (committed)
- [x] **A3 tenant-runner seam** — executor threads `dryRun`; `subprocess_driver` sets `PEGASUS_DRY_RUN`, wraps `_direct_execute_activity` for trace, returns `{dryRun,return,trace,captured}`; **fails closed** if the bundled SDK is too old. Verified in a real subprocess. (committed)
- [x] **A1a API** — `RunBody.mode`; thread `dryRun` into the Temporal args envelope + `memo{dryRun}`; **STDLIB guard** → `DRY_RUN_UNSUPPORTED` (422); 159 API tests pass; `tsc` clean.
- [x] **A4 CLI/SDK** — `run --dry-run`; `run_workflow(..., dry_run=True)` sends `mode=dry_run`; SDK 0.12.0 → 0.13.0 + CHANGELOG + README.
- [ ] **A1b — `WorkflowExecution.dryRun` column + migration + persistence + quota/dashboard exclusion.** BLOCKED in this worktree: adding a Prisma column needs `prisma generate`, which would clobber the shared symlinked client. Do with a real worktree `npm install` (or in a normal checkout). Until then, dry-runs are identified by Temporal `memo` + the `result.dryRun` envelope (Phase D can read either), and dry-runs DO currently count toward concurrency/quota (the column-based exclusion is the pending refinement). Steps: `dryRun Boolean @default(false) @map("dry_run")` on the model + migration; `execRepo.create({dryRun})`; add `dryRun: false` to `countTenantRunnerActive/DailyExecutions`; skip the cap/quota rejection when `opts.dryRun`.

### Phase A (original checklist) — Server-side dry-run execution (core platform piece) — after B
Goal: a first-class `dry_run` mode: real workflow, real worker, real reads, mutations captured not performed; tagged `dryRun:true` end-to-end; repeatable; fires no chained events; excluded from dashboards/quota.

- [ ] `RunBody` (`handlers/workflows.ts:167`) += `mode: 'dry_run' | 'live'` (default live); thread through `StartWorkflowExecutionOptions` (`start-workflow-execution.ts:158`). Add **Temporal `Memo` `{ dryRun: true }`** to the `client.workflow.start` options (`start-workflow-execution.ts:552`) for Temporal-UI filterability, and pass the flag into the args payload so the runner/subprocess sees it. Decide whether retry/dispatcher inherit or exclude the flag.
- [ ] `WorkflowExecution` prisma model += `dryRun Boolean @default(false)` (+ migration; pin `DATABASE_URL` to migrated local Docker to push, per prior gotcha). Persist on insert; exclude dry-runs from concurrency/quota counters + dashboards.
- [ ] **Runner/subprocess-driver (the injection point):** thread the dry-run flag from the proxy activity request into `subprocess_driver.py`. In `_install_direct_execution_patches()` (`subprocess_driver.py:63`), when dry-run: (a) inject a dry-run `PegasusClient` for tenant code, (b) wrap `_direct_execute_activity` to append `{activity, args, result}` to a per-execution **trace**, and return trace + capture log as part of the proxy activity result → `WorkflowExecution.result`.
- [ ] SDK: `PegasusClient.is_dry_run` + `record_side_effect`; in dry-run, mutating methods suppress the real call and append `{action, capability, args, wouldReturn}` to a capture log the driver collects. **Reuse the exact same dry-run client surface as Phase C's `fake_client`** so author code behaves identically offline and server-side.
- [ ] `emit_event` in dry-run must be captured and **must not** write the DomainEvent outbox (no chained EVENT-trigger workflow starts) — with driver-seam suppression this is automatic (the API call is never made), but add a test that no downstream EVENT-triggered workflow starts.
- [ ] CLI: `--dry-run` flag on `run` (`cli/run.py`) threading `mode="dry_run"` into the `run_workflow` payload; plus the `--remote` test path. SDK release + PyPI.
- Acceptance (spec Part A): real fetched order + real mapped body in the trace (reads ran live); no partner request; SMS dry-run records `to`/`body`, sends nothing; no chained event fires; `is_dry_run` True in dry-run / False in live.

### Phase D — Web-UI test trace (tenant-web) — after A
Goal: a trace view a non-technical operator can read, plus a "Run test" affordance.

- [ ] API: surface `dryRun` + the capture log/trace on the execution **detail** endpoint by reading `WorkflowExecution.result` (where the subprocess deposited it — **not** Temporal history, which only holds the opaque proxy activity for tenant code). Render resolved input → each activity's args/result (from the driver-built trace) → mapped external body **with** its `map_to_external` `valid|issues|degraded` verdict → capture log of would-be side effects.
- [ ] tenant-web: add a third tab (or a dry-run variant of `ExecutionDetail`) on `settings.workflows.$workflowId.tsx`, reusing the timeline rendering shape but sourced from the capture feed. New query wrapper in `api/queries/workflows.ts` + `api/workflows.ts`.
- [ ] "Run test" affordance: extend `RunWorkflowDialog` with a dry-run toggle (or a sibling dialog); support **replay a past event** as input. Gate on existing `workflow:run` perm.
- [ ] Router: no new route needed if it's a tab; else register per `router.tsx` pattern.
- Acceptance (spec Part D): trace shows input, per-activity args/result, mapped body + verdict, capture log; operator can start a dry run w/ custom input or replayed event, nothing performed.

### Docs (final, across phases)
- [ ] Update `pegasus-workflows/CLAUDE.md` + the MCP authoring guide (`pegasus://guide/*`) to document the read-vs-mutation classification, `--dry-run`, `deliver_to_external`, and the testing harness as the standard benign-test path.
- [ ] Fill the spec's `## Validation log` with the real commands/output/verdict per phase; set "SDK version that addresses it".

---

## Cross-cutting risks / notes
- **Two repos.** API/web changes land in `pegasus`; SDK method + version + PyPI in `pegasus`'s `packages/workflows-sdk-python`; consumer-workflow rewrites + the spec validation log land in the separate `pegasus-workflows` repo. Coordinate release ordering: SDK on PyPI *before* consumer rewrites depend on it.
- **Hot files** (`actions.ts`, `cedar.schema.json`, `*.cedar`, `router.tsx`) — serialize against other active streams per workflow.md.
- **PyPI publish gotchas** (from memory): `gh pr checks | grep pending` settles early on QUEUED — use `--watch`; re-tag recipe on failed publish; run SDK ruff/pytest before tagging.
- **DB push gotcha:** pin `DATABASE_URL` to the migrated local Docker Postgres before `db:migrate`.
- **Enforcement honesty:** Decision 1a is trust-based; "benign" holds only if authors route outbound through `deliver_to_external`. If stronger guarantees are needed, schedule the 1b server-side scope + a dry-run egress guard (spec's fallback) as a follow-up.
