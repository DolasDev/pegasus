# Declarative Integration Mapping & Validation — POC plan

> **Status:** ✅ **CORE SHIPPED & LIVE (2026-06-17).** The standalone validation
> endpoint is in prod — `POST /api/v1/integrations/:integrationId/validate`
> (PR #289, merge `b031014`). Phases 1, 2, and the in-repo half of Phase 4 are
> delivered. The WinForms phases (0, 3) remain **deferred/external** — the desktop
> app lives outside this repo. The in-process *second caller* in Phase 4 was
> intentionally **dropped** (user direction: keep the endpoint standalone; do not
> wire it into the longhaul save path). See **Delivered** below for the as-built
> map and deviations.
>
> Original decision (2026-06-16): the POC's synchronous validation surface ships
> **first as a standalone HTTP endpoint the legacy desktop calls at order-save**,
> not as an in-process hook on the cloud save path. Tradeoffs recorded under
> "Decision: WinForms-endpoint-first" below.

## Delivered (shipped 2026-06-17, PR #289 → `b031014`)

**Live endpoint:** `POST /api/v1/integrations/longhaul/validate` — stateless,
synchronous, M2M API-key auth (any valid `vnd_` key, any tenant; mounted
route-level on the pre-tenant m2m router so other `/integrations/*` paths fall
through). Returns `{ valid, issues[], degraded }`; fails open on any internal
error. Legacy-app handoff doc: `docs/integration-validation-endpoint.md`.

**Built (all self-contained under `apps/api/src/integration-validation/`):**

- `canonical-order.ts` — canonical model = structural contract (Zod; JSON-Schema
  exportable for the AI-loop ground truth).
- `transform/` — declarative per-field legacy→canonical transform + engine.
- `rules/` — decision-table engine (closed predicate set) + `longhaul.rules.ts`
  (the six guards lifted, each with a `sourceRef` to the imperative guard).
- `facts/longhaul-facts.ts` — neutral fact derivation.
- `validate.ts` — fail-open `validateOrder()` core; `registry.ts` — integration
  registry keyed by `integrationId` (the multi-integration seam).
- `static-check.ts` — rule static analyzer (AI-loop pre-gate).
- `__corpus__/longhaul/*.json` — 12-case golden corpus; `contract.test.ts` —
  drift-detection contract test.
- `handlers/integration-validation/validate.ts` — the HTTP endpoint.

**Deviations from this plan (all deliberate):**

- **Structural engine = Zod, not Ajv.** The repo already ships `@hono/zod-openapi`
  and Zod 4; using Zod-as-contract (with JSON-Schema export) avoids a new dep and
  matches the house idiom. Ajv dropped.
- **Rules engine = in-house decision table with a *closed operator set*, no CEL
  dependency.** The six real guards are simple predicates over scalar facts, so a
  tiny bounded evaluator covers them with zero new deps. **CEL stays the documented
  upgrade path**; OPA-WASM the fallback for non-tabular rules.
- **Phase 4 in-process second caller (tenant-web `trip-save.ts`) DROPPED.** Per
  user direction the endpoint stays standalone; the longhaul save path is
  untouched. Caller-agnosticism is instead proven by the real-app router smoke
  test in `app.test.ts`. The contract test + golden corpus (the other Phase 4
  deliverables) shipped.
- **Phases 0 & 3 (WinForms) not started** — external to this repo; the desktop
  team owns the call-site work, guided by the handoff doc.

## Goal

Replace the hardcoded, per-integration approach with a **declarative abstraction of a
customer's API contract plus its behavioral rules**, so an order change can be validated
against that customer's rules at save time, with issues mapped back to our order fields.

The POC proves the pattern end-to-end for **exactly one** real integration — **longhaul**
— supported system-wide (a single shared definition, not yet tenant-customizable, not yet
AI-maintained).

## Repo summary + seam analysis

Findings from exploring the repo. Where the repo **contradicts** the planning context, it
is flagged ⚠️.

### Runtime, persistence, multi-tenancy

- **API runtime:** TypeScript on Hono on AWS Lambda (`apps/api`). Zod 4 for validation,
  Prisma 7 + Postgres (Neon) for cloud data, `mssql` (pure-JS) for on-prem SQL Server.
  **This is a TypeScript/Node runtime — no JVM, no Go sidecar in the hot path.** The rules/
  transform engine recommendation below is grounded in that constraint.
- **Multi-tenancy:** `model Tenant` in `apps/api/prisma/schema.prisma`. Per-tenant
  integration config lives on two columns: `mssqlConnectionString` (on-prem DB) and
  `longhaulClient` (`'nwi' | 'qmm'`). `isPlatformTenant` marks the single platform tenant
  whose workflow uploads become `GLOBAL`.
- ⚠️ **There is no existing "global / system-wide shared integration" concept for
  longhaul.** Longhaul config is strictly per-tenant (the two columns), and the code
  deliberately throws rather than defaulting (`longhaul-client-config.ts:81-110`). The
  POC's "one integration, supported globally" therefore introduces a *new* notion: a
  single shared definition keyed by integration, independent of tenant. This is fine for a
  global POC but is a genuine addition, not a reuse — Phase 1 owns it.

### The integration: longhaul

- **What it is:** a customer's legacy on-prem SQL Server dispatch system (`TripMaster`,
  `LongDistanceDispatchActivity`, `v_longhaul_shipments_v2`). Two tenants run it today:
  `nwi`, `qmm`. Pegasus is a cloud façade over it.
- **Integration logic is fully hardcoded** in `apps/api/src/lib/longhaul-client-config.ts`
  as a literal `Record<'nwi' | 'qmm', LonghaulClientConfig>` (importExport codes, move-type
  SQL fragments, dispatcher query). Adding a third customer = editing that file. **This is
  exactly the hardcoding the POC replaces** — and it is the simplest representative case
  that *also* has real behavioral rules (below), so it is the right integration to model.
- **Plumbing:** cloud Lambda → `lib/mssql-executor-client.ts` (Lambda invoke) →
  `apps/mssql-executor` (VPC, WireGuard overlay) → tenant on-prem MSSQL.

### The order-save path (two distinct paths — they are not equivalent)

1. **WinForms desktop → on-prem MSSQL, directly via ADO.NET.** It does **not** call the
   cloud API at save today. There is **no synchronous validation hook**. The "switch
   WinForms to call the HTTP API" work is a *separate, not-yet-done* item
   (`plans/completed/b5c2665-pegii-legacy-api-bridge.md:208`). **This is the path the user
   chose to target.** Implication: validation here is **advisory** — it only enforces
   anything if the desktop honors the response and aborts its own write.
2. **tenant-web → cloud API → MSSQL.** Live, cloud-mediated save:
   `apps/api/src/handlers/longhaul-cloud/trip-save.ts` (`POST/PUT /onprem/longhaul/trips`).
   Already has Zod, a consistent error shape, and the behavioral guards listed next. Not
   the chosen first caller, but it is the natural **second** caller and a free regression
   harness.

### Behavioral rules that already exist (hardcoded — these become the declarative seed)

The guards already enforced in the cloud save handlers are precisely the state×field
behavioral rules to lift into the declarative layer. Verified locations:

- `trip-save.ts:72-75` — **trip must have ≥1 shipment** (403 `VALIDATION_ERROR`).
- `trip-save.ts:124` — **driver-change guard** inside `computeTripSavePlan` (403).
- `trips-write.ts:128-136` — **no advancing past pending without an assigned driver**.
- `trips-write.ts:138-146` — **no finalizing (statusId ≥ 5) until every activity has an
  actual date**.
- `trips-write.ts:15-18, 185+` — **no cancel once status_id ≥ 4** (in-progress).

Error shape is uniform across all handlers: `{ error, code, correlationId }`, codes
`VALIDATION_ERROR` (400 malformed / 403 business-rule), `NOT_FOUND`, `INTERNAL_ERROR`;
`DomainError` → 422 via the global `onError` in `app.ts:120-136`. **The declarative
validator must emit issues that map onto this shape** so both callers surface them
identically.

### Durable propagation (path (b) in the planning context) — ⚠️ important correction

The planning context assumes durable propagation "likely already exists via the workflow
SDK." **For longhaul it does not.** The workflow SDK (`packages/workflows-sdk-python`,
Temporal) is a **tenant-authored automation platform** (Zapier-for-moves), not an
order-state propagation pipe. For longhaul, **propagation of order state to the customer
system IS the synchronous `trip-save.ts` write to MSSQL** via `mssql-executor` — there is
no separate durable queue to integrate with.

Consequence for the POC: "integrate with, don't rebuild, durable propagation" reduces, for
longhaul, to **"sit the validator in front of the existing write and don't duplicate the
write."** For the WinForms caller specifically, the write is WinForms' own ADO.NET call, so
the validator is a pre-write gate the client invokes. There is no Temporal step to wire
into. This is the single biggest divergence from the planning context and it *simplifies*
the POC — see Phase 4.

## Decision: WinForms-endpoint-first (recorded tradeoffs)

**Chosen.** The synchronous validator ships first as a standalone HTTP endpoint the
WinForms desktop calls at save.

- **Upsides:** forces a clean, out-of-process, standalone contract from day one; exercises
  the inbound **legacy-order → canonical-model** translation hard (the ACL's whole point);
  WinForms is a real caller, and the future AI **dry-run** endpoint reuses the same
  surface; aligns with the north star.
- **Accepted downsides (must be designed for, not ignored):**
  - **Advisory enforcement.** WinForms writes to MSSQL directly; the endpoint enforces
    nothing unless the desktop blocks its own save on a hard-fail. → Phase 3 is a
    first-class WinForms client change, not a footnote.
  - **The caller doesn't exist yet.** WinForms has no save-time HTTP call today. → Phase 0
    spikes that this is feasible before committing.
  - **Network dependency on the save path.** → explicit tight timeout + **fail-open**
    fallback (a validator outage must not freeze every legacy save), Phase 1 DoD.

## Full arc (keep near-term choices compatible with the end state)

Each stage is short by design — just enough to avoid designing ourselves into a corner.

1. **POC (this plan):** one integration (longhaul), one shared global definition, validator
   as a WinForms-called endpoint + canonical model + inbound transform + declarative rules
   lifted from today's hardcoded guards. Golden corpus + one contract test seeded.
2. **Multi-integration:** the validator becomes integration-agnostic — definitions keyed by
   integration id, loaded from a registry instead of one hardcoded file. The canonical
   model stays; each integration ships its own contract + transform + rules. *Compatibility
   hook now:* in the POC, key everything by an explicit `integrationId` even though there's
   only one, and keep the engine generic over (contract, transform, rules) — never inline
   "longhaul" into the evaluator.
3. **Tenant-authored:** definitions move from a shipped file to tenant-editable storage with
   validation-on-author and a visibility model (mirror the existing workflow GLOBAL/TENANT
   two-tier). *Compatibility hook now:* treat the definition as **data with a schema**, not
   code — so it can later be stored, diffed, and authored without a deploy.
4. **AI-maintained:** the AI emits **deltas constrained by the rule format's schema**, gated
   through format-valid → static analysis → golden-corpus → shadow dry-run before
   human-approved merge; contract-test failures trigger drift detection. *Compatibility
   hooks now:* (a) the declarative formats must have a machine-checkable schema; (b) seed a
   golden corpus and one contract test in the POC; (c) expose the validator as a callable
   dry-run surface (the WinForms endpoint already is one).

## POC phases (sequenced; each lands something demonstrable)

### Phase 0 — Feasibility spike (throwaway allowed) — ⏸ DEFERRED (external; WinForms not in this repo)

- **Objective:** de-risk the two unknowns the WinForms-endpoint choice introduces, before
  any real build.
- **Scope (in):** confirm the WinForms desktop can (a) make an HTTP call at the order-save
  moment and (b) honor a blocking/non-blocking response (abort vs proceed). Capture the
  **exact legacy order payload shape** it would send. **(out):** any production code; any
  rules; any canonical-model design.
- **Deliverables:** a one-page findings note (feasible? what payload? what's the
  block/proceed UI hook?) + a clearly-labeled throwaway spike if needed to prove the call.
- **Resolves:** the single biggest risk — "the chosen caller can't actually cooperate."
- **Dependencies:** none. Needs access to (or an owner of) the WinForms save code.
- **DoD:** written confirmation that WinForms can call an endpoint at save and block on a
  hard-fail, plus a captured sample legacy payload. If infeasible → escalate to the user;
  fall back to tenant-web-first (the validator core is unchanged either way).
- **When launched, its detailed plan should cover:** the precise WinForms save-button code
  path, the HTTP client available in the VB.NET app, error/timeout handling on the client,
  and the captured payload schema.

### Phase 1 — Canonical model + structural contract + inbound transform + endpoint — ✅ DONE (Zod instead of Ajv)

- **Objective:** stand up the validator as a standalone endpoint that accepts a legacy
  order payload, maps it to a canonical order model, validates the **structural** contract,
  and returns field-mapped issues. Behavioral rules stubbed.
- **Scope (in):** canonical order model (a typed subset sufficient for longhaul trips);
  declarative **structural contract** (JSON Schema derived from the longhaul order/trip
  shape); declarative **inbound transform** (legacy → canonical, per-field, diffable); the
  HTTP endpoint; the issue→field mapping back into the `{ error, code, correlationId }`
  family; tight timeout + **fail-open** fallback wiring; everything keyed by an explicit
  `integrationId`. **(out):** behavioral rules (Phase 2); WinForms client change (Phase 3);
  durable propagation (Phase 4); any second integration.
- **Deliverables:** `integrationId`-keyed definition loader (single global longhaul entry);
  canonical model types; structural-contract file + Ajv validation; transform spec +
  evaluator; new route (mounted on the cloud Lambda, callable out-of-process); golden-corpus
  scaffolding seeded with structural cases.
- **Resolves:** the canonical-model shape; the transform format (diffable vs opaque); the
  structural-contract engine choice; the issue-mapping contract; the fail-open policy.
- **Dependencies:** Phase 0 payload shape.
- **DoD:** endpoint live; a malformed/structurally-invalid legacy payload returns
  field-mapped issues; a valid one returns clean; validator-internal error → fail-open with
  a logged warning; structural golden cases pass in CI.
- **When launched, its detailed plan should cover:** exact canonical fields, the
  JSON-Schema source of truth, the transform spec format and its schema, route placement/
  auth, and the timeout/fallback values.

### Phase 2 — Behavioral rules layer (lift the hardcoded guards) — ✅ DONE (in-house table, no CEL dep; all 6 guards + static check)

- **Objective:** express longhaul's behavioral rules declaratively and evaluate them in the
  endpoint, at **parity** with today's hardcoded guards.
- **Scope (in):** a declarative **decision table** (state×field) plus a bounded
  expression language for cell predicates (engine choice below); port the five verified
  guards (≥1 shipment, driver-change, no-advance-without-driver, no-finalize-without-
  actual-dates, no-cancel-after-in-progress); evaluator wired into the endpoint; the rule
  format gets a **machine-checkable schema** (for the future AI loop). **(out):** any rule
  not already enforced today (no scope creep); WinForms change; multi-integration.
- **Deliverables:** rules file + schema; in-process evaluator; golden-corpus cases proving
  guard-for-guard parity; a static gap/conflict check over the table (cheap, seeds the AI
  loop's static-analysis gate).
- **Resolves:** the rules-engine choice under a TS/Node runtime; whether the guards fit a
  table or need the fallback expression language; the static-analysis story.
- **Dependencies:** Phase 1 canonical model + endpoint.
- **DoD:** every ported guard reproduces the exact pass/fail of the current handler on the
  golden corpus; the static check reports zero gaps/conflicts on the seed table; rule file
  validates against its schema in CI.
- **When launched, its detailed plan should cover:** the table columns (states × fields ×
  add/update/remove), the chosen expression language's cell syntax, the parity test matrix
  against `trip-save.ts`/`trips-write.ts`, and the gap/conflict algorithm.

### Phase 3 — WinForms call-site integration (the enforcement contract) — ⏸ DEFERRED (external; desktop team owns it, see handoff doc)

- **Objective:** make the legacy save actually call the validator and honor it — turning
  advisory validation into a real save gate.
- **Scope (in):** WinForms change at the save button: build the legacy payload → call the
  endpoint with a tight timeout → on hard-fail, block the save and surface field-mapped
  issues; on validator outage/timeout, **fail open** (proceed + log); on pass, proceed with
  the existing ADO.NET write. **(out):** rewriting the ADO.NET write itself; moving the
  write to the cloud; multi-integration.
- **Deliverables:** WinForms client integration; user-visible issue display mapped to order
  fields; client-side timeout/fallback matching the server policy.
- **Resolves:** the advisory-enforcement gap — proves the chosen architecture end-to-end.
- **Dependencies:** Phases 1–2; Phase 0 feasibility confirmation.
- **DoD:** a real bad save in WinForms (e.g. finalize with a missing actual date) is
  **blocked** with a field-mapped message; a good save proceeds; killing the validator
  endpoint lets saves through (fail-open) with a logged warning. Demoable end-to-end.
- **When launched, its detailed plan should cover:** the VB.NET HTTP call, payload assembly
  from the WinForms order object, the block/proceed UX, and client timeout values.

### Phase 4 — Propagation alignment + contract test + corpus hardening — ◑ PARTIAL (contract test + corpus DONE; in-process 2nd caller DROPPED)

- **Objective:** ensure the validator sits cleanly in front of the existing write (no
  duplication, no rebuild) and seed the AI loop's ground-truth scaffolding.
- **Scope (in):** confirm and document that, for longhaul, propagation = the existing
  synchronous MSSQL write (no Temporal pipe to add); add the validator as a pre-write gate
  on the **second** caller too (tenant-web `trip-save.ts`, in-process) so both paths share
  one definition; one **contract test** against a recorded longhaul/MSSQL contract; expand
  the golden corpus. **(out):** building any new durable-propagation infra (it isn't
  needed); AI tooling.
- **Deliverables:** in-process integration of the same validator into `trip-save.ts`;
  contract test wired in CI; hardened golden corpus; a short note correcting the
  "durable propagation already exists" assumption for future readers.
- **Resolves:** the propagation-integration question (answer: nothing to rebuild); proves
  the definition is caller-agnostic (HTTP + in-process share it); drift detection seed.
- **Dependencies:** Phases 1–3.
- **DoD:** both callers validate against the same single global definition; the contract
  test fails if the recorded customer contract drifts from the structural contract; corpus
  covers all five guards plus structural cases.
- **When launched, its detailed plan should cover:** the in-process call site in
  `trip-save.ts`, the recorded-contract fixture source, and the corpus layout the AI loop
  will later extend.

## Engine / tooling recommendation (grounded in the TS/Node runtime)

The hot path is a Lambda (and a WinForms HTTP call); the synchronous-at-save requirement
plus "in-process or fast call with a tight timeout" rules out anything needing a JVM or a
network sidecar in the critical path.

- **Structural contract → JSON Schema validated with Ajv.** In-process, mature, JS-native,
  aligns with the repo's existing Zod 4 / JSON-Schema fluency. OpenAPI is the authoring
  format; compile its schemas to Ajv validators. *Tradeoff:* none material for the POC.
- **Mapping transform → a per-field declarative spec (data), not one opaque expression.**
  A list of `{ target, source, transform? }` entries evaluated by a small in-house
  evaluator, with named transform functions referenced by key. The planning context
  explicitly prefers "local, diffable over one large opaque expression" — a per-field table
  is diffable and AI-delta-friendly; a single JSONata blob is not. *Tradeoff:* a giant
  JSONata/CEL expression is faster to write initially but fails the diffability and
  AI-delta goals — rejected for that reason.
- **Behavioral rules → a declarative decision table (data) + a bounded expression language
  for cell predicates.** Recommend the table structure in JSON/YAML (DMN-shaped: states ×
  fields × add/update/remove) evaluated by a small in-house evaluator, with **CEL
  (`cel-js`)** for cell-level predicates where a flat value is insufficient. Rationale:
  - **DMN proper** is Java-centric; JS DMN engines (`dmn-eval-js`) are thin and drag in
    partial FEEL — and a JVM in Lambda is a non-starter. We take DMN's *tabular shape*
    (best for state×field rules and static gap/conflict checking, which the AI loop wants)
    without its engine.
  - **OPA/Rego** is powerful but is authz-shaped, a learning curve, and natively a Go
    binary; in-process is only possible via `@open-policy-agent/opa-wasm` (Rego→WASM).
    **Keep it as the documented fallback** for rules that don't fit a table (the planning
    context's stated fallback), since WASM keeps it in-process if ever needed.
  - **CEL** is non-Turing-complete, lightweight, embeddable in Node, and ideal for the
    boolean guard predicates the POC actually has. It provides the bounded expression
    layer; the table provides structure.
  - *Tradeoff:* a small in-house table evaluator is code we own (vs an off-the-shelf
    engine), but it is tiny, keeps us JVM/sidecar-free, and gives us the machine-checkable
    schema and static analysis the AI loop needs — which off-the-shelf engines wouldn't
    hand us for free.

**Net (as planned):** Ajv (structural) + per-field transform spec + JSON/YAML decision table
with CEL cell predicates, all in-process; OPA-WASM/Rego held as the fallback for non-tabular
rules.

> **As built (2026-06-17):** the recommendation was simplified once the repo was in hand.
> **Structural = Zod** (already present via `@hono/zod-openapi`; JSON-Schema exportable) —
> Ajv was an unnecessary new dep. **Rules = an in-house decision table over a *closed
> operator set* (`eq/ne/gt/gte/lt/lte/in`) on scalar facts** — the six real guards don't
> need an expression language, so **no CEL dependency** was added. The per-field transform
> spec landed as planned. **CEL remains the documented upgrade path** for cell predicates
> that outgrow the operator set; **OPA-WASM/Rego** the fallback for non-tabular rules. Net
> result: zero new runtime dependencies, all in-process, still JVM/sidecar-free.

## Open questions / assumptions — RESOLVED

1. **WinForms HTTP-at-save feasibility (Phase 0 gating).** ⏸ **Still open — deferred.** The
   desktop app is not in this repo; its save-time HTTP capability is the desktop team's to
   confirm. The cloud endpoint is live and documented (`docs/integration-validation-endpoint.md`)
   so that work is unblocked whenever it's picked up.
2. **"Globally" interpretation.** ✅ **Resolved:** one shared global definition keyed by
   `integrationId`, independent of `longhaulClient`. Built that way (`registry.ts`).
3. **Durable propagation correction.** ✅ **Resolved/confirmed:** the workflow SDK is not an
   order-state pipe; no new propagation infra built. The validator is a standalone pre-write
   gate.
4. **Canonical model scope.** ✅ **Resolved:** modelled only the trip subset the six guards +
   structural contract need (`canonical-order.ts`), not the full longhaul schema.
5. **Fail-open vs fail-closed.** ✅ **Resolved: fail-open.** `validateOrder()` returns
   `{ valid: true, degraded: true }` on any internal error; the handoff doc instructs the
   caller to proceed on timeout/`degraded` and block only on a clean `valid: false`.

## Risks → how each phase de-risks them

| Risk | De-risked by |
| --- | --- |
| Chosen caller (WinForms) can't call/honor an endpoint at save | **Phase 0** spike before any build; fallback to tenant-web-first leaves the validator core unchanged |
| Advisory-only enforcement gives false confidence | **Phase 3** makes the WinForms block/proceed contract a first-class deliverable with an explicit DoD |
| Network dependency freezes legacy saves | **Phase 1** tight timeout + fail-open, asserted in DoD; **Phase 3** mirrors it client-side |
| Rules engine wrong for a TS/Node runtime | Recommendation above is JVM/sidecar-free and in-process; **Phase 2** proves it on real guards before committing |
| Transform becomes an opaque blob (blocks tenant-authoring + AI deltas) | Per-field diffable spec mandated in **Phase 1**; schema-checked in **Phase 2** |
| Designing into a corner re: multi-integration / tenant-authoring / AI | Arc compatibility hooks: `integrationId` keying, definition-as-data-with-schema, golden corpus + contract test seeded in **Phases 1–4** |
| Misreading propagation as needing new infra | **Seam analysis + Phase 4** correct the assumption explicitly and document it |
| Parity drift from the hardcoded guards | **Phase 2** golden-corpus parity matrix against the exact handler behavior; **Phase 4** in-process second caller shares one definition |

## Constraints honored

Every recommendation is grounded in verified repo locations; assumptions are flagged above
(and now resolved). Smallest design that proves the pattern, with zero new runtime
dependencies; deferrals (multi-integration, tenant authoring, AI maintenance) are explicit.
The shipped code is self-contained under `apps/api/src/integration-validation/` and modifies
no existing production path (longhaul `trip-save.ts` untouched).

## Follow-ups (not in this POC)

- **WinForms call-site (Phases 0 + 3)** — desktop team; guided by
  `docs/integration-validation-endpoint.md`. Gating unknown: save-time HTTP feasibility.
- **Production auth hardening** — the endpoint currently accepts any valid `vnd_` key with no
  scope check (fine for a stateless validator). Add a dedicated scope if/when desired.
- **North-star stages** — multi-integration (registry already keyed by id), tenant-authored
  definitions, AI-maintained rules (golden corpus + static-check + contract test are seeded).
