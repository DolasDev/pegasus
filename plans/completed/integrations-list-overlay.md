# Integrations list shows only the built-ins — cold overlay + no tenant-scoped ids

**Type:** fix · **Slug:** `integrations-list-overlay`

## ✅ EXECUTED 2026-07-29 — all four phases

- **Phase 1** — `listActiveIntegrationIdsForTenant` on the IntegrationConfig repo
  (distinct `integrationId` over the tenant's PUBLISHED rows, ids only) + DB-backed
  repo test.
- **Phase 2** — `toDefinitionFromRow` exported; new async
  `listIntegrationIdsForScope(db, tenantId)` warms the overlay then unions
  built-ins ∪ GLOBAL ∪ the tenant's own ids, failing open to the sync set on a DB
  error. `listIntegrationIds`'s doc comment now states the cold-cache caveat that
  made this bug possible.
- **Phase 3** — new `integration-validation/summaries.ts` is the single read model
  (`listIntegrationSummaries`) behind all three endpoints; `handlers/integrations/
list.ts` and both m2m routes in `handlers/integration-validation/config.ts`
  delegate to it. Response shapes unchanged — same fields, more rows.
- **Phase 4** — DB-backed `summaries.test.ts` (6 tests) asserts the sync accessor
  does NOT know a freshly published new-partner id and that the endpoint lists it
  anyway; verified it fails 3/6 against the pre-fix enumeration and passes after.
  `list.test.ts` gains tenant-only-id and skip-unresolvable cases; `config.test.ts`
  rewired to the new seam.

Verified: apps/api 2779 tests green (212 files), eslint clean, monorepo typecheck
clean (12/12). Coverage floors ratcheted up (lines 91.66→91.67, functions
87.79→87.83, statements 90.25→90.26). GOTCHAS.md gains the lazily-warmed-cache
entry.

---

## Symptom (reported from the tenant UI)

Settings → Developer → Integrations (and `/integrations`) lists exactly
`demo_partner` + `allied_status` for **every** tenant, both badged "Built-in", and
each detail page reads _"This integration has no published mapping or rules yet."_
Expected: the tenant's real published integrations — **Weichert** and the **Sirva
ADE / Allied** set.

## Root cause

`GET /api/v1/integrations` (`apps/api/src/handlers/integrations/list.ts:43`)
enumerates `listIntegrationIds()` (`integration-validation/registry.ts:402`):

```ts
const ids = new Set<string>(Object.keys(REGISTRY)) // built-ins only
if (overlay) for (const id of overlay.keys()) ids.add(id) // DB ids — only if warm
```

Two independent defects:

1. **The overlay is never warmed on the session/UI path.** `overlay` is populated
   only by `refreshRegistryOverlay()` (the four publish/rollback handlers in
   `handlers/integration-validation/config.ts:270,454,586,683`) and by
   `loadRegistryOverlayIfStale()`, whose sole caller is
   `resolveIntegrationDefinition()` at `registry.ts:381` — and only in its
   `tenantId === null` (platform-scoped m2m key) branch. A container serving
   browser traffic therefore reads a permanently-null map, so DB-published
   new-partner ids (`weichert`, `sirva_ade_*`) can never be listed.
2. **TENANT-visibility ids are never enumerated at all.** The overlay is built
   from `listActiveGlobal()` only (`registry.ts:270`), and the repository has no
   distinct-id query. A tenant cannot see an integration it published itself
   unless that id also exists as a built-in or GLOBAL config.

The "No published config" badge is then correct-but-misleading: nothing is
published under the ids `demo_partner` / `allied_status`; the real rows live under
`weichert` / `sirva_ade_*` (see `pegasus-workflows` →
`platform/integrations/weichert/meta.json`,
`platform/allied-vanlines/integrations/*/meta.json`).

Display-only bug — runtime validation is unaffected, because `validate.ts` goes
through `resolveIntegrationDefinition()` → `findActiveForScope()`, which reads the
DB row directly and needs no overlay.

Same two defects hit the m2m siblings, which loop `listIntegrationIds()` cold too:

- `GET /integrations/configs` (`config.ts:310`) — the SDK's discovery endpoint, so
  `pegasus-workflows integration-config list` under-reports identically.
- `GET /integrations/requirements-summary` (`config.ts:343`).

Existing tests miss it: `handlers/integrations/list.test.ts` mocks the registry
module, so it structurally cannot observe a DB-published id.

## Plan

### Phase 1 — repository: enumerate tenant-owned ids

- Add `listActiveIntegrationIdsForTenant(tenantId): Promise<string[]>` to
  `repositories/integration-config.repository.ts` — distinct `integrationId` over
  the tenant's own `status: 'PUBLISHED'` rows. Manual tenant scoping, consistent
  with the rest of the file (IntegrationConfig is not in `TENANT_SCOPED_MODELS`).
- DB-backed repo test.

### Phase 2 — registry: expose a resolvable, scope-aware id set

- Export `toDefinitionFromRow` (currently module-private) so callers can resolve a
  tenant-only id's `displayName` from its row instead of falling through to a
  built-in that does not exist.
- Add a scope-aware helper (`listIntegrationIdsForScope(db, tenantId)`) that warms
  the overlay via `loadRegistryOverlayIfStale()` and returns
  built-ins ∪ GLOBAL-overlay ids ∪ the tenant's own ids. Fail-open: a DB error
  degrades to the current built-in ∪ overlay set rather than erroring the page.
- Unit tests over the union + the fail-open path.

### Phase 3 — the three read endpoints

Rewire all three to the scope-aware helper and to row-derived display metadata:

- `handlers/integrations/list.ts` (UI)
- `handlers/integration-validation/config.ts` — `/integrations/configs`
- `handlers/integration-validation/config.ts` — `/integrations/requirements-summary`

Each id resolves as: active row (`findActiveForScope`) → `toDefinitionFromRow` →
fall back to `getIntegrationDefinition(id)`. Skip ids that resolve to neither.
Keep the response shapes byte-identical — additive rows only, no field changes.

### Phase 4 — tests that would have caught this

- **DB-backed** (not registry-mocked) test in `list.test.ts`: publish a GLOBAL
  config under a new-partner id + a TENANT config under another, then assert both
  appear with the right `name` / `version` / `visibility`, on a registry whose
  overlay starts cold. This is the assertion the current mocked test cannot make.
- Equivalent coverage for `/integrations/configs`.
- Confirm coverage floors still pass (push with `DATABASE_URL` set so the
  pre-push coverage gate runs; floors only ever ratchet up).

## Out of scope

- Publishing / repairing any actual integration config (that is
  `pegasus-workflows`' job, never a platform session).
- Any change to runtime validation precedence — tenant-over-GLOBAL-over-built-in
  stays exactly as-is.
- SDK version bump: no new API surface is added, only existing endpoints returning
  the rows they always should have. Revisit only if the response shape changes.

## Verification

- `npm test` + `npm run typecheck` + `npm run lint` in `apps/api`.
- New DB-backed tests fail against `main`'s handler, pass after the fix.
- Manual: hit `GET /api/v1/integrations` on a cold process with a GLOBAL config
  published under a non-built-in id and confirm it is listed.
