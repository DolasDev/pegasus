# Pluggable data sources — correlation, declarative fetch, and entity→source binding

> **Status: APPROVED 2026-08-21 — Phase 1 in flight.** Phases land as separate PRs
> and serialize (schema.prisma + Cedar are merge magnets). Phase 2's **pilot** is
> blocked on Atlas; the rest of Phase 2 is not.

> **Sequencing correction (2026-08-21).** An earlier note claimed Phases 1, 3 and 4
> were source-agnostic and only Phase 2 waited on Atlas. That does not compile:
> Phase 3's `max_age`/`refresh` live ON Phase 2's fetch surface, so 3 depends on 2
> existing. The real order is **1 → 2-minus-pilot → 3 → 4**. Only Phase 2's pilot
> checklist item (and Phase 4's stdlib settlements workflow, same cause) waits for
> Atlas or a substituted capability.

> ### ⚠️ 2026-08-20 — live Atlas measurement invalidates two assumptions
>
> A working Atlas QA subscription key arrived and the API was exercised for the first time
> (`docs/atlas-world-group-api/README.md`, sections marked VERIFIED). Two things this plan
> assumed are false:
>
> 1. **`On-Behalf-Of` cannot be sent.** Atlas rejects it with `400` _"User is not allowed to
>    make request on behalf of another user."_ The example `fetch` block below templated
>    `{{config:ATLAS_USER}}` into that header; that would fail every call. Corrected in place.
> 2. **The pilot capability `settlements` has no identified Atlas source.** "Settlement" appears
>    twice in Atlas's entire 24-spec catalog, both incidental. There is no settlements endpoint,
>    and the invoice-bearing APIs (`RatingSystem-v1`, `atlasorder-v1`, `authorizations-v1`) all
>    return 401 for our subscription. **This is a live risk to Phase 2's pilot** — see
>    "Risks" → _The pilot has no proven source_.
>
> The plan's **architecture** is unaffected: nothing here depends on OBO, and capability names
> were deliberately left unfrozen. What changes is which capability can be piloted first, and
> that is now blocked on an answer from Atlas rather than on engineering.

> **Decisions taken 2026-08-06** (see "Decisions" at the foot for the reasoning):
>
> 1. **On-demand fetch stays.** Short-TTL read-through cache, **no single-flight** in v1.
> 2. **Binding is a tenant-level document**, not a column on `IntegrationConfig`.
> 3. **Capability names are not frozen.** The floor declares its capability list; only
>    `settlements` is needed to ship the pilot.

**Goal:** let a tenant fetch the same _kind_ of information — settlements first — from
whichever external source it actually uses (Atlas, Allied, United, a billing bureau, a TMS),
on demand, **without a new workflow per source**.

---

## Why this isn't already possible

The floor/overlay split already gets most of the way there, and that part needs no change:

- **Floors are per data TYPE and partner-neutral.** `financial_settlement` already exists and
  says so in its own header: _"any settlement / agent-compensation feed builds on this floor.
  Exposes only GENERIC facts; partner value sets live in the overlay rules."_
- **Overlays are per PARTNER and publishable as config** — per-tenant or GLOBAL. Two overlays
  on one floor already works in code (`demo_partner` and `allied_status` both sit on
  `shipment_status_update`; Allied is a vanline).
- **Per-tenant endpoints/credentials already resolve per tenant** out of the
  WorkflowSecretConfig store by group (`BASE_URL`, `AUTH_MODE`, keys), and #563 added
  `apikey` mode plus `headers`/`secretHeaders` so a named-header partner is reachable.

**Do NOT model "vanline" as a floor.** A vanline is a partner category, not a data type. A
tenant may take settlements from a source that is not a vanline at all. Binding the canonical
shape to _who_ the partner is rather than _what the data means_ would exclude those tenants
and duplicate every floor per carrier. The abstraction is the information.

Three things are genuinely missing.

### Gap A — the projection cache is keyed by THEIR identifiers, not ours

`IntegrationProjection` is unique on `(tenantId, integrationId, entityType, entityKey)` and
holds _"Last-known external state, in the integration's NATIVE payload shape"_
(`apps/api/prisma/schema.prisma`, `model IntegrationProjection`). `entityKey` comes from the
floor's `projection.key(o)`, which derives it **from the partner payload** —
`financial_settlement` builds `` `${o.Id}:${o.Reference.PartyId}` ``.

So "look up the cached external state for shipment S" cannot be expressed: you need the
partner's key to read the cache, and today you only learn that key _by fetching_. Without a
correlation, cache-then-fetch degenerates to always-fetch and the cache is dead weight on the
read path.

### Gap B — there is no declarative "how to fetch"

`IntegrationConfig`'s columns are `mapping`, `rules`, `corpus`, `gateReport`, `floor`,
`displayName`, `externalShape`, `externalMapping`, **`inbound`**, `requiredSecrets`,
`requiredConfigs`.

`inbound` describes **push** (which event to emit, how to dedup, how to shape the ack).
**Nothing describes pull.** `call_external` takes `method` and `path` _from the caller_, so
partner-specific transport knowledge — which path, which params select a period, how to page,
where in the envelope the records live — lives in workflow Python. That means **a new source
needs a new workflow**, even though its mapping and rules are pure config, which silently
breaks the "new partner = config alone" property the floor/overlay split otherwise buys.
(Confirming evidence: no workflow in `packages/workflows-stdlib` calls `call_external` at all —
every use today is bespoke tenant code.)

### Gap C — nothing binds an entity to a source

There is no config that answers "for this shipment, which integration provides settlements?"

---

## Design

### C1. Correlation — our entity ↔ their key

Add an explicit correlation record written on first successful fetch/ingest:

```
model IntegrationCorrelation {
  tenantId, integrationId, entityType,
  localEntityType, localEntityId,   // e.g. "shipment", <pegasus id>
  entityKey,                        // the projection's external key
  @@unique([tenantId, integrationId, entityType, localEntityType, localEntityId])
  @@unique([tenantId, integrationId, entityType, entityKey])
}
```

Both directions are unique, so it is a true 1:1 within an integration.

> **AMENDED 2026-08-21 during Phase 1 — the original wording could not be built.**
>
> It read: _"The floor gains an optional `correlation` descriptor naming which canonical path
> carries the local id, so the correlation is written by the SAME code path that already
> computes `projection.key` — no new partner-specific logic."_ Two things were wrong.
>
> **No canonical path carries our id.** A partner payload carries the PARTNER's identifiers.
> `financial_settlement`'s canonical shape exposes `Id` and `Reference.PartyId` — both theirs —
> and nothing of ours; `AgreementReference` is declared but referenced nowhere in the codebase,
> so treating it as our id would be a guess. Deriving our id from their payload also assumes it
> is embeddable in their surrogate, which is the assumption this very section rejects for the
> external key.
>
> **It is not one code path.** `projection.key` is invoked in exactly one place —
> `handlers/integration-validation/validate.ts`, the READ path, to resolve `prior`. That
> function is deliberately side-effect-free and fails open ("a projection problem must never
> block a save"), so it is the wrong place to write anything. Projections are WRITTEN through
> `PUT /runtime/:integrationId/:entityType/:entityKey`, where the key arrives from the caller.
>
> **What shipped instead.** The floor declares only what it genuinely knows — WHICH KIND of
> Pegasus entity its records describe (`correlation: { localEntityType: 'shipment' }`) — and the
> id is supplied by the caller that already holds it, on the projection PUT. The declaration is
> still load-bearing: the write path validates the caller's `localEntityType` against it, so a
> workflow cannot bind a settlement to a "vehicle" by typo. Correlations reuse the projection's
> RBAC actions rather than minting new ones, which keeps `authz/actions.ts` and Cedar — both
> named merge magnets in Risks — out of this phase entirely.

**Alternative considered:** derive the external key from the Pegasus entity via a formula in
config. Rejected — it assumes our id is embeddable in their key, which is false for any
partner that mints its own surrogate (Atlas's settlement `Id` is exactly that).

### C2. `fetch` — the pull counterpart to `inbound`

A new nullable `fetch` Json column on `IntegrationConfig`, holding **named operations** whose
names come from the floor's declared capability list (so every settlement source answers to
`settlements`):

```json
"fetch": {
  "settlements": {
    "method": "GET",
    "path": "/finance/v1/settlements",
    "query": { "from": "{{since}}", "to": "{{until}}" },
    "recordsPath": "Settlements",
    "page": { "style": "none" }
  }
}
```

> **This example is illustrative only — it is not a working Atlas descriptor.**
> `/finance/v1/settlements` **does not exist**; `finance-v1` publishes exactly two operations
> (`/invoicedelivery/ReloDirectEntities`, `/invoicedelivery/MadEmails/{agentBranch}/{division}`)
> and returns 401 for our subscription regardless. The `On-Behalf-Of` header that previously
> appeared here has been removed: Atlas rejects it outright (see the banner). A real Atlas
> descriptor cannot be written until open question 1 in the Atlas README is answered.

**Bound the DSL hard.** The mapping format is deliberately not an expression language and a
fetch block is where that discipline usually dies. Permitted: `{{param}}` and `{{config:KEY}}`
substitution only (no arithmetic, no conditionals), a closed enum of `page.style`
(`none` | `pageNumber` | `cursor`), one `recordsPath`. Anything richer falls back to a bespoke
workflow — the same escape hatch the mapping DSL already documents.

Secrets are **never** inlined: header credentials go through `secretHeaders` (#563), which
resolves server-side. A `{{secret:…}}` substitution is deliberately NOT offered, so a
credential can never be templated into a URL or query string.

**Capability names are not frozen by this phase.** The **floor** declares its capability list
(`capabilities: ['settlements']` on `financial_settlement`); the `fetch` block and the binding
table both validate their operation/capability names against it at publish. So naming is a
floor change, not a schema migration, and adding or renaming later costs one code edit plus a
republish.

Only **`settlements`** is needed to ship the pilot. Deliberately do not invent
`documents`/`status`/`estimates` now: with one example there is nothing to check a naming
scheme against, and a name guessed now is a name we would be stuck matching later. Name the
second capability when a second domain is real — at that point there are two cases to
generalize over, which is the first moment the decision is actually informed.

### C3. Binding — (entityType, capability) → integration

Key on **(entity type, capability)**, not entity → integration: a tenant may take settlements
from source A and documents from source B for the same shipment.

**Decision: binding is its own TENANT-LEVEL document**, not a column on `IntegrationConfig`.
Three consequences that follow from that and shape the build:

- **One place answers "where does this tenant get X?"** Spread across per-integration configs,
  that question requires reading every config and mentally unioning them — and the failure mode
  we most need to prevent (two sources claiming the same capability) is invisible until you do.
  A single document makes overlap detection a property of one row set.
- **Lifecycles decouple.** Re-pointing settlements from Atlas to Allied is a routing change, not
  a mapping change; it should not bump an overlay version or re-run that overlay's corpus gate.
  Conversely a mapping fix should not touch routing.
- **Cost:** its own publish + validation path, its own RBAC action (`ManageIntegrationBinding`),
  and its own versioning/rollback. Do not reuse `IntegrationConfig`'s publish machinery
  wholesale — the shapes differ — but do reuse the _gate pattern_ (static checks + corpus).

Modeled as a decision table, matching the existing rules format:

```json
[
  {
    "id": "atlas-settlements",
    "capability": "settlements",
    "localEntityType": "shipment",
    "integrationId": "atlas_settlement",
    "priority": 100,
    "when": [{ "fact": "vanline", "op": "eq", "value": "ATLAS" }]
  }
]
```

- **Reuse the rules operator set** (`eq/ne/gt/gte/lt/lte/in/nin` over scalar facts) — one
  predicate vocabulary, statically checkable, corpus-testable.
- **But this is a different fact universe.** Rules today derive facts from a _native partner
  payload_; binding evaluates over _our own domain entity_. That means a new
  **entity fact source** (Pegasus entity → `Facts`) — real work, not free reuse. This is the
  largest single chunk in the plan and the most likely thing to scope down first.
- **Deterministic resolution.** Highest `priority` wins; ties are a **publish-time error**, not
  a runtime coin-flip — ambiguity about which carrier to call is a data-integrity bug. Reuse
  the existing gate (static checks + golden corpus) to reject overlaps.
- An explicit no-match outcome is required; no implicit default source.

### C4. Freshness + provenance (the contract that keeps this honest)

`IntegrationProjection` has a `version` counter but **no TTL and no `fetchedAt`** — `updatedAt`
means "when we last wrote a row", not "when this was true at the partner". A generic
`get_or_fetch` that silently returns it would answer a _different question_ than the caller
asked.

- Add `fetchedAt`, distinct from `updatedAt`.
- Freshness is **explicit at the call site**: `max_age` / `refresh=True`, over a short default
  TTL (start at 60s, per-capability overridable). The default must be _short enough that
  serving it is defensible_; anything longer belongs to an explicit `max_age`.
- The response **always** states provenance: `source: "cached" | "fetched"` and `as_of`. Same
  discipline as `attempts` on `call_external` — if the platform did something non-obvious on
  your behalf, the payload says so.

### C5. Rate budget = freshness policy

Agent-Limited's quota is still unpublished (only `starter`'s 5/min + 100/week is documented;
the enforced policies are 403 at developer role). On-demand fetch against an unknown budget is
how you discover the limit in production, and N users refreshing the same shipment is N partner
calls.

The outbound OAuth token cache is the near precedent: a per-container Map was **not** enough in
a horizontally-scaled Lambda (#521/#532/#535), which is why the shared L2 tier exists.

**Decision: short-TTL read-through, no single-flight in v1.** The OAuth case is _not_ the same
problem. There, a duplicate mint burned a rate-limited credential and the duplicate was
correctness-adjacent. Here the fetches are **idempotent GETs**, so a concurrent duplicate is
_wasteful, not wrong_. A short TTL bounds the exposure: the first request populates the cache
and everything inside the window hits it, so the worst case is a handful of redundant calls in
the miss window rather than one per user.

Building the coordination tier up front would be paying the expensive part of the design for a
problem we have no evidence we have. The provenance fields from C4 (`source`, `as_of`) plus the
existing `attempts` make the miss/duplicate rate **directly observable in production** — so the
decision to add single-flight can be taken on data instead of on speculation. Revisit if
observed duplicate-fetch rates matter against the (still unpublished) Agent-Limited quota.

**Design the freshness policy and the rate-limit policy as one thing**, not two — that part
stands; the TTL _is_ the rate control.

---

## Phases

Ordered by dependency, not visibility. Binding is the most visible piece and the least useful
first: without a fetch descriptor there is nothing generic to route _to_, and without a
correlation key the cache lookup cannot happen.

### Phase 1 — Correlation (Gap A) — API side `[x]`, SDK `[ ]`

- `[x]` `IntegrationCorrelation` model + migration + repository (+ 9 integration tests)
- `[x]` Optional `correlation` descriptor on `TypeFloor`; wired into the projection-write
  path (`PUT /runtime/...`), **not** the validate path — see the C1 amendment for why
- `[x]` `financial_settlement` declares its correlation (`localEntityType: 'shipment'`)
- `[x]` Read endpoint `GET /runtime/:integrationId/:entityType/by-local/:localEntityType/:localEntityId`,
  gated by the existing `ReadIntegrationProjection`, documented in OpenAPI
- `[ ]` SDK: `get_correlated_state(integration_id, local_entity_type, local_entity_id)` —
  **deliberately deferred to its own PR**, because an SDK change drags the full
  discoverability sweep (README, CHANGELOG, MCP resources, OpenAPI, the authoring repo's
  `CLAUDE.md`) plus a PyPI release. The API is the contract; the SDK follows it.

### Phase 2 — Declarative fetch (Gap B) `[ ]`

- `[ ]` `fetch` column on `IntegrationConfig` + migration
- `[ ]` Zod schema + `fetchBlockJsonSchema()`; served at
  `GET /api/v1/integrations/fetch-schema` (mirrors the existing `inbound-schema` endpoint)
- `[ ]` Publish-gate validation: op names ∈ floor's declared capabilities; reserved-header and
  no-`{{secret:}}` checks
- `[ ]` `POST /integrations/:id/fetch/:operation` — resolves the descriptor, substitutes params,
  calls through the existing call-external path (auth/headers/timeout/429-retry all reused),
  extracts `recordsPath`, pages per `page.style`
- `[ ]` SDK `fetch_external(integration_id, operation, **params)`; docs + MCP + OpenAPI
- `[ ]` **Pilot: BLOCKED as specified (2026-08-20).** "An Atlas settlements `fetch` block
  published as a GLOBAL config" cannot be written — Atlas publishes no settlements endpoint and
  the invoice-bearing APIs are 401 for us. Unblock by answering open question 1 in
  `docs/atlas-world-group-api/README.md`, **or** substitute a reachable capability
  (`documents` via `documents-v1`, `status` via `shipment-management-v1`). See Risks.

### Phase 3 — Freshness + provenance (C4) `[ ]`

- `[ ]` `fetchedAt` on `IntegrationProjection` + migration
- `[ ]` `max_age` / `refresh` on the fetch surface; `source` + `as_of` in every response
- `[ ]` Short default TTL (60s, per-capability overridable). **No single-flight** — decided in
  C5; the provenance fields make the duplicate rate observable so this can be revisited on data
- `[ ]` Emit a metric/log for cache hit vs miss vs duplicate-in-flight, so "do we need
  single-flight?" is answerable later without a code change

### Phase 4 — Entity fact source + binding (Gap C) `[ ]`

- `[ ]` Entity fact derivation (Pegasus entity → `Facts`) — **scope this down first**; start
  with the handful of shipment fields binding actually needs, not a general projection
- `[ ]` `IntegrationBinding` — **tenant-level model** + migration (not a column on
  `IntegrationConfig`), reusing `PredicateSchema` for `when`
- `[ ]` Its own publish/validate path, `ManageIntegrationBinding` Cedar action, and
  versioning/rollback — reuse the gate _pattern_, not `IntegrationConfig`'s machinery
- `[ ]` Deterministic resolver + publish-time rejection of two rules claiming one capability
- `[ ]` `resolve_source(capability, local_entity_type, local_entity_id)` in the SDK
- `[ ]` One generic settlements workflow in `workflows-stdlib` proving N sources, zero code

### Phase 5 — Ship sources as GLOBAL configs `[ ]`

- `[ ]` Publish per-carrier overlays as **GLOBAL configs**, not built-in code — they already
  appear to every tenant and are forkable, with `fork(force=True)` re-syncing. "Built in"
  should mean _published_, not _compiled_; every code overlay is a PR instead of a publish.

---

## Files

**New:** `apps/api/src/lib/integration-fetch.ts` (+test) · `apps/api/src/handlers/integration-fetch.ts`
(+test) · `apps/api/src/repositories/integration-correlation.repository.ts` (+test) ·
`apps/api/src/integration-validation/binding/{types,resolver}.ts` (+tests) ·
`apps/api/src/integration-validation/facts/entity-facts.ts` (+test)

**Modified:** `apps/api/prisma/schema.prisma` (3 migrations — hot file, serialize) ·
`integration-validation/types.ts` · `floors/financial-settlement.floor.ts` · `registry.ts` ·
`repositories/integration-config.repository.ts` · `handlers/integrations/*` ·
`lib/openapi-spec.ts` · `authz/actions.ts` + Cedar policies (hot files — serialize) ·
`packages/workflows-sdk-python/{pegasus_workflows/api.py,README.md,CHANGELOG.md,cli/mcp_server.py}`

## Risks

- **The pilot has no proven source (NEW, 2026-08-20 — the biggest risk on this list).**
  Phase 2 ships "an Atlas settlements `fetch` block published as a GLOBAL config", and Atlas
  publishes no settlements endpoint. Measured: `settlement` occurs twice in the whole 24-spec
  catalog, both incidental; `remittance` and `disbursement` zero times; and the invoice-heavy
  APIs (`RatingSystem-v1` 107 mentions, `atlasorder-v1` 55, `authorizations-v1` 33) all return
  **401** for our subscription. The only reachable candidate is
  `shipment-management-v1 GET /shipments/{orderNumber}` → `invoices`, which the spec declares as
  `{"nullable": true}` with **no schema at all**, and no reachable endpoint yields an order
  number to discover its shape with.
  **Consequence:** Phases 1, 3 and 4 are source-agnostic and unaffected, but **Phase 2's pilot
  cannot be written** until Atlas answers where settlement data lives and supplies a QA order
  number. Two mitigations, in preference order: (a) get the answer — it is open question 1 in
  `docs/atlas-world-group-api/README.md`; (b) if settlements prove unavailable, pilot a
  capability we can actually reach (`documents` via `documents-v1`, or `status` via
  `shipment-management-v1`) — the plan explicitly does not freeze capability names, so this is a
  substitution, not a redesign.
- **Identity scoping is unresolved (NEW, 2026-08-20).** Our Atlas key executes as a fixed
  Atlas-side identity and impersonation is refused, so a Pegasus tenant cannot currently present
  as its own Atlas agent. If Atlas's answer is "one subscription per agent", per-tenant
  credentials already handle it and nothing changes. If it is "use `On-Behalf-Of`, we'll grant
  it", the `fetch` block needs a per-principal substitution (`{{principal:…}}`) plus a
  Pegasus-user → Atlas-user mapping — a real addition to C2's deliberately-bounded DSL.
- **Hot-file contention.** `schema.prisma`, `authz/actions.ts` and the Cedar policies are
  merge magnets that collide _semantically_. Serialize across phases; rebase before continuing.
- **Scope creep in the fetch DSL** — see C2. If a `{{#if}}` shows up in review, the answer is a
  bespoke workflow.
- **Phase 4 is the big one.** The entity fact source is a general capability wearing a small
  hat. If the plan slips, ship Phases 1–3 (which already deliver "fetch settlements from a
  configured source on demand", just with the integration named explicitly) and defer binding.
- **SSRF posture unchanged** — resolved URLs still go through `assertDeliverableUrl`. The fetch
  block adds a path/query template, not a new egress.
- **Unknown rate budget** — see C5. Worth resolving with Atlas before Phase 3 lands, since it is
  the only input that would move the TTL default off judgement. **Partially measured 2026-08-20:**
  ~70 live calls at ~24/min drew no `429` and no rate-limit headers, so there is no aggressive
  per-minute throttle — but a _weekly_ quota (the `starter` product publishes 100/week) would not
  have surfaced, and Atlas exposes no quota headers to read it from. The 60s TTL default remains
  judgement, not measurement.
- **Deferring single-flight is a bet, and it is instrumented as one.** If duplicate fetches turn
  out to matter, the fix is additive (a shared lease tier, the L2 pattern from #521/#532/#535)
  and does not invalidate anything built in Phases 1–3. The failure mode to avoid is shipping it
  _without_ the hit/miss/duplicate metric — that is what would turn a reversible bet into a
  guess, so treat that checklist item in Phase 3 as non-optional.

## Decisions (2026-08-06)

**1. On-demand fetch stays; drop single-flight, not on-demand.**
The question was posed as "on-demand vs. scheduled sync + read from cache", but that is not
where the cost actually sits:

- The **fetch descriptor** is required either way — a scheduled sync still has to know which
  path to call.
- **Correlation** is required _more_ by the cache-first route, not less: reading the cache by
  our own entity id is exactly what needs it. Pure on-demand could have skipped Phase 1.
- So cache-first trades single-flight for a sync pipeline (scheduling, backfill, partial
  failure). Different shape, not less work.

The expensive, subtle part is **coordination**, and that is what we drop. Fetches are
idempotent GETs, so concurrent duplicates are wasteful rather than wrong, and a short TTL bounds
the miss window. Ship without a coordination tier; make the duplicate rate observable; add
single-flight only if the numbers justify it. This gives the preferred behavior (on-demand)
_and_ the simplification.

**2. Binding is a tenant-level document.** Confirmed — see C3 for the three consequences
(global answerability of "where does this tenant get X", decoupled lifecycles, and the cost of
its own publish path + RBAC action).

**3. Capability names deliberately deferred.** The floor declares its capability list and both
the `fetch` block and the binding table validate against it, so naming is a floor change rather
than a migration. Only `settlements` is needed for the pilot. Naming `documents`/`status`/
`estimates` now would be guessing with one example to generalize from; the second real domain
is the first informed moment to decide.

## Still open

- **Agent-Limited's rate budget** — unpublished; blocks choosing the TTL default on anything
  better than judgement. Outstanding with Atlas (see `docs/atlas-world-group-api/README.md`).
- **Phase 4 scope.** The entity fact source is the largest piece and the most likely to be cut
  down; it does not block Phases 1–3.

## Provenance

Derived from `docs/atlas-world-group-api/` (research, 2026-07-30) and the outbound work in
#563/#564. Atlas is the motivating source but is deliberately **not** the abstraction.
