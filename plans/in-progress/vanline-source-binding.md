# Pluggable data sources — correlation, declarative fetch, and entity→source binding

> **Status: DESIGN — not approved for implementation.** Branch: `docs/vanline-source-binding`
> (plan-only PR; the implementing work will branch separately per phase).

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

Both directions are unique, so it is a true 1:1 within an integration. The floor gains an
optional `correlation` descriptor naming which canonical path carries the local id, so the
correlation is written by the SAME code path that already computes `projection.key` — no new
partner-specific logic.

**Alternative considered:** derive the external key from the Pegasus entity via a formula in
config. Rejected — it assumes our id is embeddable in their key, which is false for any
partner that mints its own surrogate (Atlas's settlement `Id` is exactly that).

### C2. `fetch` — the pull counterpart to `inbound`

A new nullable `fetch` Json column on `IntegrationConfig`, holding **named operations** whose
names are fixed by the floor (so every settlement source answers to `settlements`):

```json
"fetch": {
  "settlements": {
    "method": "GET",
    "path": "/finance/v1/settlements",
    "query": { "from": "{{since}}", "to": "{{until}}" },
    "headers": { "On-Behalf-Of": "{{config:ATLAS_USER}}" },
    "recordsPath": "Settlements",
    "page": { "style": "none" }
  }
}
```

**Bound the DSL hard.** The mapping format is deliberately not an expression language and a
fetch block is where that discipline usually dies. Permitted: `{{param}}` and `{{config:KEY}}`
substitution only (no arithmetic, no conditionals), a closed enum of `page.style`
(`none` | `pageNumber` | `cursor`), one `recordsPath`. Anything richer falls back to a bespoke
workflow — the same escape hatch the mapping DSL already documents.

Secrets are **never** inlined: header credentials go through `secretHeaders` (#563), which
resolves server-side. A `{{secret:…}}` substitution is deliberately NOT offered, so a
credential can never be templated into a URL or query string.

### C3. Binding — (entityType, capability) → integration

Key on **(entity type, capability)**, not entity → integration: a tenant may take settlements
from source A and documents from source B for the same shipment. Modeled as a decision table,
matching the existing rules format:

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
- Freshness is **explicit at the call site**: `max_age` / `refresh=True`. No implicit default
  that silently serves stale state.
- The response **always** states provenance: `source: "cached" | "fetched"` and `as_of`. Same
  discipline as `attempts` on `call_external` — if the platform did something non-obvious on
  your behalf, the payload says so.

### C5. Rate budget = freshness policy

Agent-Limited's quota is still unpublished (only `starter`'s 5/min + 100/week is documented;
the enforced policies are 403 at developer role). On-demand fetch against an unknown budget is
how you discover the limit in production, and N users refreshing the same shipment is N partner
calls.

The outbound OAuth token cache is the direct precedent: a per-container Map was **not** enough
in a horizontally-scaled Lambda (#521/#532/#535), which is why the shared L2 tier exists. Same
conclusion here — either single-flight through a shared tier, or make the cache authoritative
with a short TTL and treat force-refresh as the explicit, rate-limited path. **Design the
freshness policy and the rate-limit policy as one thing**, not two.

---

## Phases

Ordered by dependency, not visibility. Binding is the most visible piece and the least useful
first: without a fetch descriptor there is nothing generic to route _to_, and without a
correlation key the cache lookup cannot happen.

### Phase 1 — Correlation (Gap A) `[ ]`

- `[ ]` `IntegrationCorrelation` model + migration + repository
- `[ ]` Optional `correlation` descriptor on `TypeFloor`; wire into the existing
  projection-write path so it is written wherever `projection.key` is already computed
- `[ ]` `financial_settlement` declares its correlation
- `[ ]` Read endpoint: local id → external key (+ cached state), RBAC-gated
- `[ ]` SDK: `get_correlated_state(integration_id, local_entity_type, local_entity_id)`

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
- `[ ]` **Pilot:** an Atlas settlements `fetch` block published as a GLOBAL config

### Phase 3 — Freshness + provenance (C4) `[ ]`

- `[ ]` `fetchedAt` on `IntegrationProjection` + migration
- `[ ]` `max_age` / `refresh` on the fetch surface; `source` + `as_of` in every response
- `[ ]` Single-flight or TTL policy per C5, with the decision recorded in the plan

### Phase 4 — Entity fact source + binding (Gap C) `[ ]`

- `[ ]` Entity fact derivation (Pegasus entity → `Facts`) — **scope this down first**; start
  with the handful of shipment fields binding actually needs, not a general projection
- `[ ]` `IntegrationBinding` decision table (config-published), reusing `PredicateSchema`
- `[ ]` Deterministic resolver + publish-time overlap rejection via the existing gate
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

- **Hot-file contention.** `schema.prisma`, `authz/actions.ts` and the Cedar policies are
  merge magnets that collide _semantically_. Serialize across phases; rebase before continuing.
- **Scope creep in the fetch DSL** — see C2. If a `{{#if}}` shows up in review, the answer is a
  bespoke workflow.
- **Phase 4 is the big one.** The entity fact source is a general capability wearing a small
  hat. If the plan slips, ship Phases 1–3 (which already deliver "fetch settlements from a
  configured source on demand", just with the integration named explicitly) and defer binding.
- **SSRF posture unchanged** — resolved URLs still go through `assertDeliverableUrl`. The fetch
  block adds a path/query template, not a new egress.
- **Unknown rate budget** — see C5. Worth resolving with Atlas before Phase 3 lands.

## Open questions for review

1. Is on-demand fetch per user action the real requirement, or is a scheduled sync + read from
   cache sufficient? That answer changes C5 substantially and may remove single-flight entirely.
2. Should binding live on `IntegrationConfig` (per-integration, self-describing) or as its own
   tenant-level document (one table, easier to reason about globally)? Leaning the latter.
3. Which capability names are floor contract? `settlements` is obvious; `documents`, `status`
   and `estimates` need naming before Phase 2 fixes them.

## Provenance

Derived from `docs/atlas-world-group-api/` (research, 2026-07-30) and the outbound work in
#563/#564. Atlas is the motivating source but is deliberately **not** the abstraction.
