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

### Phase 2 — type the detail pane (where the payoff lands) — DONE

- [x] `@pegasus/longhaul-contracts` added to `apps/tenant-web` deps
- [x] Redux slice: `selectedShipment: LonghaulShipmentRow | null`, and
      `fetchShipmentSuccess` takes `PayloadAction<LonghaulShipmentRow | null>`
- [x] All 25 ShipmentDetail accessors take `LonghaulShipmentRow`
- [x] The `happyShipment` test fixture is `satisfies LonghaulShipmentRow`, so a fixture cannot
      drift onto a non-column either

**`tsc` surfaced 4 errors. NONE was a drifted name** — #569/#570/#571 had already cleared the
pane, which is itself the useful result: the type confirms the detail pane is clean. All four
were plumbing:

1. `API.jumpToOrder({ order_num })` — the wrapper declared `order_num: number` while its own
   implementation (`jump-to-order.ts`) takes `unknown` and only interpolates it into a URI.
   Coercing at the call site (`Number(...)`) **changed behavior** — it broke a test that
   asserts the string `'12345'` is passed through — so the fix is to drop the wrapper's
   gratuitous narrowing to `unknown`, matching the impl. A typing phase must not change what
   we send.
2. - 3. `selectShipment(null)` ×2 — the blanket `(shipment: any)` → `(shipment:
LonghaulShipmentRow)` replace also caught the local deselect callback, which legitimately
        takes null. Typed `LonghaulShipmentRow | null`. Self-inflicted by the sweep, not a bug.
3. `ShipmentCard`'s `active={selectedShipment && …}` became `null | boolean` against a
   `boolean | undefined` prop once the slice was typed. Now `!!selectedShipment && …`, and its
   `(selectedShipment as any)` cast is gone. Strictly a Phase 3 file, but the slice typing
   forces it, so it lands here to keep the build green.

**Verified the protection is real, not decorative:** re-introducing `OpsLastName` and
`del_address2` in the pane makes `tsc` fail with _"Property 'OpsLastName' does not exist on
type 'LonghaulShipmentRow'. Did you mean 'last_name'?"_ — it even names the right column. Same
for the fixture (`OpsLastName` → _"Did you mean to write 'last_name'?"_).

**Known limitation, worth stating:** the type catches names that are not columns. It does NOT
catch a real column used for the wrong purpose — re-introducing `del_address1` as the
destination street (the #569 bug) still compiles, because `del_address1` IS a column (the
extra-delivery address). Only `del_address2` errored. Semantic misuse stays a review concern.

**Files:** `apps/tenant-web/package.json` (+dep), `redux/shipments/index.ts`,
`containers/ShipmentDetail/index.tsx` + test, `containers/Shipments/components/ShipmentCard/index.tsx`,
`utils/api/index.ts`, `package-lock.json`.

### Phase 3 — the remaining consumers — DONE

- [x] ShipmentCard (5 date helpers, props, 2 dispatch callbacks), Shipments, ShipmentsTable,
      Trip, PendingTrips, AddActivity
- [x] `utils/api/reshape-shipment.ts` returns `LonghaulShipmentRow`
- [x] `redux/shipments`'s `selectShipment` thunk + its exact-match find
- [x] `storage_driver_id` → `driver2_id` per Decision 2, with regression tests
- [x] Plan archived to `plans/completed/`

**What `tsc` surfaced (16 errors), and the call made on each:**

1. **`AddActivity`'s `PartialShipment`** declared `order_num`, `planned_start` and `planned_end`.
   The latter two are ACTIVITY fields, not columns — and none of the three was ever read; the
   component only touches `extraActivities`. Not a live bug (nothing read them), but a
   misleading prop type that blocked passing a real row. Deleted; the prop is now
   `LonghaulShipmentRow`.
2. **`packing_coverage.is_covered`** — Phase 1 typed `packing_coverage` as `unknown`. This is
   the documented "extend the type" outcome: modeled as
   `{ order_num?, activity_code?, is_covered? } | null`, matching what the API attaches from
   `longhaul_shipmentcoverage`.
3. **`stateIdx` possibly undefined** (4 sites in PendingTrips) — it is client-only and optional
   on the row, but the map that builds the list always injects it. Added a local
   `type IndexedShipment = LonghaulShipmentRow & { stateIdx: number }`.
4. **`shipment.activities` possibly undefined** — guarded with `?? []`.
5. **Index-type errors** (ShipmentCard ×2, Shipments ×1) — `haulModeMapping[shipment.shaul]`
   and friends, now that the key can be null. Coerced with `String(x ?? '')` /`?? ''`, which
   resolves to the same lookup miss the old code got.
6. **`ShipmentsTable`'s `tableConfig`** — annotating it `TableColumn<LonghaulShipmentRow>[]`
   (and exporting `TableColumn`) means every column's `property` is now checked against the
   view's columns. All six were already correct. `rowId` gained `?? undefined` because
   `order_num` is nullable on the row type.
7. **`isSuperVip`** could not take a typed row while still honoring the legacy `supervip`
   alias, since `supervip` is not a column. The #571 fallback was defensive and nothing
   produces such a payload, so it is gone and the parameter is typed. Its test now asserts the
   alias is NOT honored.

**The approved behavior change:** `getDeliveryDateStart` read `shipment.storage_driver_id`,
which is on no payload, so every SIT shipment took the orange "Not Scheduled" branch — in this
app and in the original system, which read the same non-existent key. It now reads `driver2_id`,
so the green "Scheduled" badge appears for the first time on SIT shipments with a storage driver.
Three tests pin it, and the Scheduled case was verified to fail against the old code.

**Files:** `containers/{Shipments,Shipments/components/ShipmentCard,ShipmentsTable,Trip,PendingTrips,PendingTrips/components/AddActivity}`,
`components/Table/index.tsx` (export `TableColumn`), `utils/super-vip.ts` + test,
`utils/api/reshape-shipment.ts`, `redux/shipments/index.ts`,
`packages/longhaul-contracts/src/shipment-view.ts` (packing_coverage), ShipmentCard tests.

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
