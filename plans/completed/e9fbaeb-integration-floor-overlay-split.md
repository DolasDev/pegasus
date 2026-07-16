# feat: split integration floors into per-type fact abstractions + per-partner overlays (sdk-feedback 0019 + 0020)

Combines **0019** (human-facing `displayName` decoupled from `integrationId`) and
**0020** (floor = per-_type_ fact abstraction; the partner external shape moves
into the overlay), since 0019's `displayName` is one field of the overlay 0020
defines. User-approved scope: **full faithful split** (all 5 of 0020's ACs),
`demo_partner`/Weichert migrated with a byte-identical external body.

Specs: `~/repos/pegasus-workflows/sdk-feedback/0019-*.md`, `0020-*.md`.

## Current architecture (confirmed)

A "floor" is `IntegrationDefinition` (`integration-validation/types.ts`), a code
object keyed **1:1 by `integrationId`** in `registry.ts`'s `REGISTRY`. It fuses:
`structuralContract` (canonical Zod = _also_ the external shape), `mapping`/
`transform` (native→canonical), `inputFieldRoots`, `deriveFacts`, `factCatalog`,
`rules`, `displayName` (hardcoded), `defaultAction`, `projection`. The DB overlay
(`IntegrationConfig`) overrides only `mapping`+`rules`. Unknown id → 404 at
resolve- and publish-time. `map_to_external` returns `applyMapping(transform,data)`
— the canonical, which _is_ the external body. Facts derive from the canonical.
Publish gate (`gate-pipeline.ts`) static-checks mapping/rules against
`base.structuralContract` + `base.factCatalog` and replays the corpus.

The fusion to break: `structuralContract` does double duty as (a) the canonical
fact-bearing contract and (b) the external output shape.

## Target model

- **TypeFloor** (code, keyed by a _type_ id, e.g. `shipment_status_update`):
  `structuralContract` (neutral canonical), `inputFieldRoots`, `deriveFacts`,
  `factCatalog`, `defaultAction`, `projection`. Partner-neutral, reusable.
- **Overlay** (per `integrationId`; built-in in code OR a DB `IntegrationConfig`):
  `floor` (type id), `displayName`, `mapping` (native→canonical), `externalShape`
  (partner output Zod/JSON-schema), `externalMapping` (canonical→external
  `MappingTemplate`), `rules`, `corpus`.
- Resolved runtime `IntegrationDefinition` = TypeFloor ⊕ Overlay. New fields:
  `floor: string`, `externalContract: z.ZodType` (from overlay; defaults to
  `structuralContract`), `externalTransform: TransformSpec` (from overlay;
  defaults to identity). `displayName` becomes overlay-overridable.
- `map_to_external`: `canonical = applyMapping(transform, native)`; `external =
applyMapping(externalTransform, canonical)`; validate `canonical` vs
  `structuralContract` (facts path) and `external` vs `externalContract`; return
  `external`. **Identity** default ⇒ `demo_partner` external body unchanged.

## Work items

### A. Engine types + registry (apps/api/src/integration-validation)

1. `types.ts`: add `TypeFloor` interface (neutral parts) + `IntegrationOverlay`
   interface (partner parts). Extend `IntegrationDefinition` (the resolved shape)
   with `floor`, `externalContract`, `externalTransform`. Keep `structuralContract`
   name (canonical).
2. New `floors/shipment-status-update.floor.ts`: the TypeFloor built from
   `demo_partner`'s current canonical (`canonical-demo-partner.ts`), facts,
   catalog, inputFieldRoots, projection. (Rename/relocate `canonical-demo-partner`
   → a neutral `shipment-status-update.canonical.ts`; keep an export alias to avoid
   churn in tests that import `DemoPartnerOrderSchema`.)
3. New `overlays/demo-partner.overlay.ts`: the built-in Overlay — `floor:
'shipment_status_update'`, `displayName: 'Demo Partner'`, `mapping`
   (existing), `externalShape` = canonical (identity), `externalMapping` =
   identity `MappingTemplate`, `rules` (existing), corpus stays in `corpus/`.
4. `registry.ts`: split into `FLOORS: Record<string, TypeFloor>` +
   `BUILTIN_OVERLAYS: Record<string, IntegrationOverlay>`. `resolveDefinition`
   composes overlay⊕floor. A DB overlay row for an id with **no built-in overlay**
   resolves its `floor` field → FLOOR (this is the "new partner, config-only"
   path; AC1). `buildOverlay`/`resolveIntegrationDefinition`/`getBuiltInDefinition`
   updated to compose; `mergeDefinition` also applies `externalContract`/
   `externalTransform`/`displayName`/`floor` from the overlay. Keep fail-open.
5. Identity `externalMapping`: a `MappingTemplate` that copies the canonical
   through unchanged (or a compile shortcut `IDENTITY_TRANSFORM`).

### B. map/validate core (`integration-validation/validate.ts`)

- `mapToExternalWithDefinition`: two-stage projection (see model). Validate the
  external body against `def.externalContract`; keep the canonical/facts/rules
  verdict. Return `{ external, valid, issues, degraded }` (shape unchanged).
- `validateWithDefinition`/`transformToCanonical`: unchanged (canonical path).

### C. Publish gate (`gate-pipeline.ts`)

- `base` becomes floor-derived. Static-check `mapping` vs canonical schema +
  `inputFieldRoots` (unchanged); `rules` vs `factCatalog` (unchanged).
- **Add**: static-check `externalMapping` vs `externalShape` schema; corpus
  **external round-trip** (each corpus order → canonical → external parses
  `externalShape`). Enforce AC5: rules can't reference facts outside the floor
  catalog (already enforced) — keep.

### D. DB model + migration (apps/api/prisma)

- `IntegrationConfig`: add nullable `floor String?`, `displayName String?
@map("display_name")`, `externalShape Json? @map("external_shape")`,
  `externalMapping Json? @map("external_mapping")`. Nullable ⇒ existing rows fall
  back to the built-in overlay/identity (backward-compatible). New migration under
  `prisma/migrations/`.

### E. Config endpoints (`handlers/integration-validation/config.ts`)

- `ConfigBody`: accept optional `floor`, `displayName`, `externalShape`,
  `externalMapping`. For an id with **no built-in overlay**, `floor` is REQUIRED
  and must name a known FLOOR (else 400/404). Run the gate against the resolved
  floor.
- `toFull`/`toSummary`: return `floor`, `displayName`, `externalShape`
  (+ `externalMapping` in full). Persist the new columns on publish/fork/rollback.
- `handlers/integrations/list.ts`: prefer overlay `displayName` over the floor's.

### F. SDK/CLI (packages/workflows-sdk-python) — SDK FOLLOW-UP (next version bump)

Deferred to the SDK version bump, matching how prior specs landed (0009/0014
shipped the platform capability first, the SDK method separately). The platform
publish endpoint now ACCEPTS `floor`/`displayName`/`externalShape`/
`externalMapping` and `get_integration_config` returns them, so the capability is
live; the CLI round-trip is the ergonomic wrapper:

- `PegasusClient.publish_integration_config` / `get_integration_config`: carry the
  new overlay fields. CLI `integration-config` `pull`/`publish`: round-trip a
  `meta.json` (`floor`, `displayName`) + `external-shape.json` +
  `external-mapping.json` alongside `mapping.json`/`rules.json`/`corpus.json`
  (`_load_surface`/`pull_command`). `map_to_external` client method needs no
  change (server resolves id→floor). Filed as the SDK follow-up.

### G. Migrate demo_partner + a second partner for the ACs

- `publish-builtin-configs.ts`: publish `demo_partner` as `floor=
shipment_status_update` overlay (identity external) — GLOBAL, byte-identical
  body (AC4 via corpus round-trip).
- Add a **second** built-in/example overlay on the same floor with a _different_
  `externalShape`/`externalMapping` (e.g. `allied_status`) to prove AC2/AC3 —
  overlay-only, no new floor, `map_to_external('allied_status')` returns its
  (different) external body.

### H. Docs

- `CLAUDE.md` (repo + integration-validation header comments): document the
  floor(type)+overlay(partner) model, `displayName`, and "new partner = overlay
  only". Update the `map_to_external` "canonical IS external" note.

## Acceptance criteria (0020) → satisfied by

- AC1 new partner overlay-only, `map_to_external(newId)` ≠ 404 → §A4 + §E + §G.
- AC2 external shape in overlay, two overlays emit different shapes → §A + §B + §G.
- AC3 two partners share one floor → §G second overlay.
- AC4 demo_partner migrated, external body unchanged → §A3 identity + §G corpus round-trip.
- AC5 floor enforces fact catalog → §C (unchanged rule static-check) + overlay can't add facts.
- 0019 displayName decoupled from id, config-settable, returned by get_integration_config → §D/§E/§F.

## Testing

- Engine unit: floor⊕overlay compose; identity external = canonical; a second
  overlay with a different externalShape emits a different body; unknown id
  (no overlay, no floor) → undefined/404; DB overlay referencing a floor resolves.
- Gate unit: externalMapping/externalShape static-check + corpus external
  round-trip; rules referencing a non-floor fact rejected.
- Handler unit: publish with floor/displayName/externalShape/externalMapping;
  publish for a floorless-unknown id without `floor` → 400; get_integration_config
  returns displayName+floor+externalShape; integrations list prefers overlay name.
- Migration: `prisma migrate` applies; existing rows resolve (null → identity).
- Python: CLI pull/publish round-trip incl. meta/external files.
- Full `apps/api` suite green; typecheck; lint; coverage autoUpdate.

## Verify

- `demo_partner` corpus round-trips byte-identical (AC4).
- `map_to_external('demo_partner')` unchanged; `map_to_external('<second>')`
  returns a different external body from the same floor (AC2).
- New partner authored via CLI publish (overlay only) resolves + maps.

## Risk / rollout

- Live prod integration (`demo_partner`/Weichert). All new DB columns nullable;
  identity external default ⇒ no behavior change until an overlay opts in. Engine
  refactor kept behind the full corpus + expanded tests. No data backfill required
  (built-in overlay is the fallback).
