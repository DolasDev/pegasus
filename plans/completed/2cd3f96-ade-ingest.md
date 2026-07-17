# feat: generic inbound-ingest floors + map_from_external (0024) + ADE Result ack & body validation (0021)

Closes the platform half of the Sirva ADE **inbound ingest** path. Two coupled
specs, one PR (pegasus repo: API + Python SDK). The partner config authoring +
sdk-feedback validation logs land separately in the `pegasus-workflows` repo.

- **0024** — runtime inbound mapping `map_from_external` + **generic, reusable**
  type floors (not partner-specific). Net-new.
- **0021** — the remaining ingress gaps: the ADE `Result{…}` Success/Failed ack
  envelope + declarative body validation on the shipped ingress (PR #450).

## Design decisions (user-approved)

1. **One combined PR** covering both specs.
2. **Full closure of 0021** (build the validation + ack-array gaps, not docs-only).
3. **Config-only overlays**: the floors are code (the platform requires it — a
   config is an overlay on a code-defined floor; fact derivation can't live in the
   bounded config DSL), but the mapping + rules live in **published configuration**,
   not built-in code. No `sirva_ade_*` built-in overlays.
4. **Generic floors, not partner-specific**: the four ADE entity types are modeled
   as partner-neutral domain floors reusable by any partner of that type. Partner
   value sets (AVL/NVL, ADE statuses, FILETYPES) live entirely in the published
   config rules via a new **`nin`** operator — zero partner values in floor code.

## What shipped (this PR — pegasus repo)

### A. Generic type floors (`apps/api/src/integration-validation/floors/`)

Four partner-neutral floors, each = neutral canonical Zod contract + generic facts
(presence booleans + raw field values) + projection binding. **No `inputFieldRoots`**
(a neutral floor can't know a partner's native field names) and **all canonical
sections optional** (a partner maps only the fields it needs).

- `shipment_lifecycle_event` — facts `idPresent, brand, brandPresent, status, statusPresent, deliveryDatePresent`.
- `sales_lead` — `idPresent, status, statusPresent, primaryPhoneType, primaryPhoneTypePresent`.
- `financial_settlement` — `idPresent, partyIdPresent, brand, brandPresent`.
- `document_record` — `idPresent, format, formatPresent, brand, brandPresent`.
  Registered in `registry.ts` `FLOORS` (not `BUILTIN_OVERLAYS`).

### B. `nin` (not-in) rule operator (`rules/types.ts`, `rules/engine.ts`)

Symmetric complement of `in`; fires when the fact value is OUTSIDE the set. Lets a
config express "must be one of an allowed set" (`{brandPresent eq true} AND {brand nin [AVL,NVL]}`)
without baking the set into floor code. Static-checker treats it like `in`.

### C. Runtime `map_from_external` (`integration-validation/validate.ts` + handler)

`mapFromExternalWithDefinition(def, data)` → `{canonical, valid, issues, degraded}`
(reuses `transformOrderToCanonical` + `validateWithDefinition`). Route
`POST /api/v1/integrations/:id/map-from-external`, **404 fail-closed** on unknown
id / no floor. Open API-key surface, same as `map-to-external`.

### D. SDK `map_from_external` (`packages/workflows-sdk-python`)

`PegasusClient.map_from_external(integration_id, payload)` mirroring
`map_to_external`. Classified as a read in the testing harness; auto-surfaces in
`pegasus://reference/api`. Version 0.20.0 + CHANGELOG + README.

### E. 0021 — ADE Result envelope + body validation (`lib/ingress.ts`, `handlers/ingress.ts`)

- `inbound.validation` block (`{requiredPaths, nonEmptyArrayPaths}`) → structured
  issues; a rejected body returns the partner's **failure** ack at 200.
- `renderAck` gains a **`$map`** array directive so the failure template can shape
  `ResultsMessage: [{ResultsMessageCode, ResultsMessageDescription}]` from the
  issues. `failureAck` now takes structured `{code,message}` issues (passes both
  `messages` strings + `issues` objects to the template). Generic-ack fallback
  and the success envelope (already expressible) unchanged.

### F. Docs

Module header comments; SDK README (inbound `map_from_external` section + the
ingress `validation`/`$map`/Result-envelope example) + CHANGELOG.

## Follow-up (separate — `pegasus-workflows` repo)

- Rewrite the authored `sirva_ade_*` configs to the neutral canonical + `nin`
  rules, each referencing its generic floor + carrying the `inbound` block.
- Un-stub the ingest workflows' `normalize_*` activity (`map_from_external`).
- Update `pegasus-workflows/CLAUDE.md`; mark sdk-feedback 0021 + 0024 Validated;
  refresh the sdk-feedback README index.
- Publish SDK 0.20.0 to PyPI (tag).

## Tests (all green)

- `rules/engine.test.ts` — `nin` fires outside the set, not inside, no-array → no fire.
- `integration-validation/floors/generic-inbound-floors.test.ts` — all four floors
  honored by a representative published config (gate ok + every corpus case's verdict);
  `map_from_external` returns canonical + verdict (valid + invalid-brand fail-closed).
- `lib/ingress.test.ts` — `validateInboundBody`; `$map` builds ADE `ResultsMessage[]`
  objects; success/failure envelopes; generic fallback.
- SDK `test_api.py` — `map_from_external` posts payload / fails closed on 404.
- Full `apps/api` suite (2420) + SDK suite (315) green; typecheck + eslint + ruff clean.

## Acceptance criteria → satisfied by

0024: floors honored (not ignored) → §A + generic-inbound-floors gate test;
`map_from_external` exists/documented/in MCP → §C/§D; returns `canonical` (not
verdict-only) → §C + test; fails closed 404 → §C + SDK test. **Floors are generic**
(reusable) — exceeds the spec's `sirva_ade_*`-specific ask.
0021: 200 + ADE `Result` Success synchronously → existing auth + success template;
malformed/rejected → ADE `Result{Results:"Failed", ResultsMessage:[{Code,Description}]}`
→ §E; dedup / rotation / ingestion-derived ack → unchanged (already shipped).

## Risk / rollout

Purely additive: new floors (unknown-id → known), a new open map-from route, an
additive `nin` operator, additive `inbound.validation` + `$map` (absent ⇒ unchanged
behavior). No DB migration (uses the existing `IntegrationConfig.inbound` JSON +
registry code). Existing generic-ack + demo_partner paths untouched (asserted by
tests). Live prod ingress unaffected until a tenant publishes an ADE `inbound` block.
