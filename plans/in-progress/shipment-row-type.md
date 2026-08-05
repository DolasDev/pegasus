# Type the longhaul shipment row

**Branch:** `feat/shipment-row-type` (to be created by `scripts/new-worktree.sh feat shipment-row-type`)

**Goal:** make the longhaul shipment payload contract explicit and compile-checked, so an
accessor naming a field the view does not project fails `tsc` instead of silently rendering
blank.

## Why

Four separate production bugs in one week, all the same shape — a ported accessor naming
something that is not a column on `v_longhaul_shipments_v2`:

| Read                | Reality                                   | Status                         |
| ------------------- | ----------------------------------------- | ------------------------------ |
| `del_address1/2`    | destination street is `consignee_name1/2` | fixed #569                     |
| `OpsLastName`       | entity alias for `last_name`              | fixed #570                     |
| `supervip`          | entity alias for `idc_break`              | fixed #571                     |
| `storage_driver_id` | no such column; the view has `driver2_id` | **still live** — see Decisions |

Each was invisible because the row is `any` end-to-end: the API selects `s.*`, serializes it,
and the UI reads arbitrary keys off it. Nothing in between knows the column set.

**`SELECT *` is not the root cause and narrowing it is not the fix.** An explicit column list
would not have caught a single one of the four — they are all UI-side name errors. Narrowing
the projection first is actively dangerous: the ported components read 58 distinct keys
including obscure ones (`special4`, `stg_id`, `stgindicator`, `extrapu`), so guessing the
needed subset reproduces the very blank fields we just fixed. Type first; narrow later, if at all.

## Scope measured

- `v_longhaul_shipments_v2`: **91 columns** (45 nvarchar, 25 date, 15 int, 5 varchar, 1 decimal)
- driver-planning: **101 source files**, **17** touch a shipment row, **58** distinct
  `shipment.<key>` reads, ~**40** `(shipment: any)` accessor sites
  (ShipmentDetail 25, ShipmentCard 8, PendingTrips 4, Shipments/ShipmentsTable/Trip 1 each)

## Source of truth

The view lives in the tenant's MSSQL and is provisioned from the legacy repo's ViewEntity
(`longhaul/server/modules/shipments/model/migrate/shipment_v2.view.ts`) — a **different repo**,
and CI has no MSSQL. So the manifest is checked in, with an on-demand verifier that diffs it
against a live tenant view. #575 already checked the 91 names into
`apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts` as `VIEW_COLUMNS`; this work
promotes that to the single shared source and deletes the copy.

## Decisions — RESOLVED (developer, 2026-08-05)

1. **Where the shared type lives → new type-only package `packages/longhaul-contracts`.**
   Honest about being a legacy integration contract; keeps `@pegasus/domain` pure as documented.
   Costs package.json + tsconfig + turbo/lint wiring — the repo already has 3 shared packages
   (`domain`, `api-http`, `auth`, all imported by tenant-web), so the pattern is established.

2. **`storage_driver_id` → FIX it to `driver2_id`.** It reads a key on no payload, so the
   ShipmentCard SIT indicator has always taken the "no storage driver" branch. The legacy app
   read the _same_ non-existent key
   (`longhaul/src/containers/Shipments/components/ShipmentCard/index.js:149`), so this is a
   faithful port of a pre-existing bug and fixing it **changes behavior versus the original
   system** — approved deliberately. Land it in Phase 3 with a commit message that says so, so
   the behavior change is traceable if anyone asks why the indicator started appearing.

## Phases

Each phase is its own PR. The plan file stays in `plans/in-progress/` and is updated as phases
land; the final PR archives it to `plans/completed/`.

### Phase 1 — the contract (no consumer changes, zero runtime risk) — DONE

- [x] Scaffolded `packages/longhaul-contracts` (zero runtime deps). `main`/`types` both point at
      `src/index.ts` and there is **no build script** — matching `@pegasus/api-http` and
      `@pegasus/auth`, so no `dist`, no turbo build ordering, and consumers compile the source.
- [x] Exports:
  - [x] `LONGHAUL_SHIPMENT_VIEW_COLUMNS` — the 91 names as `const`, in ORDINAL_POSITION order
  - [x] `LonghaulShipmentViewColumn` — union of those names
  - [x] `LonghaulShipmentViewRow` — one **optional** property per column. Optional because an
        older tenant view omits keys and fixtures should not spell out 91; it costs nothing,
        since the protection is that an unknown name fails to type on both read and write.
  - [x] `LonghaulShipmentRow` — the view row plus API enrichment (`activities`,
        `extraActivities`, `extra_locations`, `packing_coverage`, `shadow_weight`,
        `shadow_comments`, `operations_name`) and client-side `pegasus_shadow` / `stateIdx`
  - [x] **No index signature** — the reason apps/api's existing `ShipmentRow`
        (`[key: string]: unknown`) never caught any of the four bugs.
- [x] `scripts/verify-longhaul-view-columns.ts` — diffs the manifest against a live tenant view
      via the in-VPC executor Lambda; `--types` dumps the per-column `DATA_TYPE` mapping. Exits
      non-zero on drift. On demand only (needs `aws sso login --sso-session dolas`); root
      `scripts/` is not covered by any tsconfig, same as `create-admin-user.ts`, so it is
      smoke-run rather than typechecked.
- [x] `shipments-list.test.ts` imports the shared manifest; the local copy #575 added is gone.

**DEVIATION from the plan — per-column scalar types are NOT modeled.** The plan said to type
each column from `INFORMATION_SCHEMA.DATA_TYPE`, but the SSO session expired mid-phase and the
only local source (the legacy entity's TS declarations) is demonstrably wrong: it declares 10
numeric columns where the live schema has 16, 23 dates where the live schema has 25, and
`driver2_id: Date` for what is plainly an id. Encoding that would bake in wrong types with a
confident face. Every column is `string | number | null` instead. This forfeits no protection
against the bug class — that is about unknown _keys_ — and `--types` on the verifier script
regenerates the real mapping whenever someone wants to refine it.

**Files:** `packages/longhaul-contracts/{package.json,tsconfig.json,src/index.ts,src/shipment-view.ts,src/__tests__/shipment-view.test.ts}`,
`scripts/verify-longhaul-view-columns.ts`, `apps/api/package.json` (+dep),
`apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts`, `package-lock.json` (new
workspace package — unavoidable).

**Verified:** the `@ts-expect-error` assertions are non-vacuous — flipping `OpsLastName` to
`last_name` makes `tsc` fail with "Unused '@ts-expect-error' directive", so the test genuinely
proves an unknown key is rejected.

### Phase 2 — type the detail pane (where the payoff lands)

- [ ] Type the redux slice: `shipments.selectedShipment: LonghaulShipmentRow | null`
- [ ] Replace `(shipment: any)` with `(shipment: LonghaulShipmentRow)` across ShipmentDetail's
      25 accessors
- [ ] Resolve every error `tsc` surfaces — each is either a drifted name (bug) or a genuinely
      missing enrichment key (extend the type). Record which in the plan as you go.

**Files:** `containers/ShipmentDetail/index.tsx`, `redux/shipments/index.ts`, their tests.
**Risk:** ShipmentDetail is a merge magnet — we touched it three times this week. Land fast, rebase.

### Phase 3 — the remaining consumers

- [ ] ShipmentCard (8), PendingTrips (4), Trip, Shipments, ShipmentsTable (1 each)
- [ ] `utils/api/reshape-shipment.ts` returns `LonghaulShipmentRow`
- [ ] Decide `storage_driver_id` per Decision 2

**Files:** the 17 files that touch a shipment row, plus their tests.

### Phase 4 — narrow the projection (optional, probably skip)

Only once Phases 2–3 have proven the actually-referenced key set. By then the win is bandwidth
(91 columns → ~45), not correctness. Do not start here.

## Verification

- `npm run typecheck` is the test — Phase 2/3 succeed exactly when it passes with no `any`
  left on the shipment path.
- Existing vitest suites must stay green (tenant-web 1225, api 2871).
- The `apps/tenant-web:verify` skill can re-render the pane against a real prod row
  (order 489808 is a good fixture — it exercises origin, destination, and Operations).

## Risks

- **Per-tenant view drift.** The manifest describes the current view definition; a tenant on an
  older one returns fewer columns (QMM once lacked the v2 view entirely). Mitigation: the
  verifier script, plus — critically — the type is a _compile-time_ aid only. It must never be
  used to filter or validate the payload at runtime.
- **Error volume.** Phases 2–3 may surface many unknown-key errors at once. Keep each phase to
  one PR; if Phase 3 gets noisy, split it per container.
- **Estimate:** P1 ≈ half a day, P2 ≈ half a day, P3 ≈ a day.
