# Triage of the 9 `test.fixme`'d `@qa-mutating` longhaul specs

**Status (2026-05-13): executed.** All 9 specs have been triaged and the
corresponding coverage moved to the right layer. Specifics below.

**Status (2026-05-14, second pass): on-prem defect FIXED, all 5 specs un-fixme'd
locally.** Reproduced the trip-save 500 on the Dolios on-prem service
(`DOLAB-M70Q-1`), found two latent Knex+mssql bugs in the longhaul repos:

1. `saveTrip`, `insertActivity`, `saveSearchFilter`, `insertOrUpdateShipmentCoverage`:
   bare `.insert()` returns rowsAffected, not IDENTITY → `newId` was undefined
   → read-back `.where('id', undefined).first()` threw "Undefined binding(s)".
   Fix: pass the column list (`['id']`/`['filter_id']`) as the 2nd arg.
2. `LongDistanceDispatchActivity` has enabled triggers, so OUTPUT INSERTED.id
   alone fails. Fix: `{ includeTriggerModifications: true }` for that insert.

Verified locally end-to-end: POST /trips → 201, POST /activities (via trip-
create) succeeds, POST /trips/:id/cancel → 200. All 1041 api unit tests still
pass. Specs un-fixme'd: `longhaul-qa.spec.ts:199`, `:354`; `planning.spec.ts:177`.

**Status (2026-05-14, first pass): PARTIALLY verified.** After a reseed, run
`25839871338` exit-status'd green (41 pass / 6 skip / 0 fail), but 3 of
those skips were `test.fixme` on a real unresolved on-prem trip-save 500.

**Context:** the original QA E2E plan parked 9 browser specs as `test.fixme`
because they each need a QA-DB reseed to exercise the on-prem MSSQL write
path. After the 2026-05-13 staged pivot (handler tests, container tests,
reshape utils, fetchAndReshape wrapper), most of those flows are now covered
in faster, on-prem-independent layers. This doc records the verdicts and
where the coverage actually lives now.

**Important finding during execution:** my initial pass marked several specs
"DROP because qa-api covers it" — but the corresponding qa-api round-trip
specs (`longhaul-qa.spec.ts:178`, `:184`, `:188`) were _also_ `test.fixme`'d.
The revised plan ended up writing those qa-api specs from scratch + adding
a fourth (notes round-trip), so the bridge contract actually has coverage now
instead of pointing at empty stubs.

---

## Executed verdicts

| Spec                                                                                     | Verdict                            | Coverage moved to                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planning.spec.ts` "saves a trip and navigates to its itinerary"                         | **KEEP browser E2E** (implemented) | Un-fixme'd. Adds shipment → assigns driver via Downshift → clicks Save → asserts snackbar `/saved/i` → clicks View Itinerary → asserts `/trips/<id>` URL.                                                                                   |
| `planning.spec.ts` "re-opens a saved trip via `?tripId=`"                                | **REPLACED with container test**   | `routes/PlanningModule.test.tsx` — 2 cases: URL with no `?tripId` dispatches `initializeTripPage(undefined, planner)`; URL with `?tripId=42` dispatches `initializeTripPage('42', planner)`.                                                |
| `planning.spec.ts` "New Trip clears the current pending trip after confirmation"         | **REPLACED with container test**   | `containers/PendingTrips/index.test.tsx` "confirming 'Start new trip' resets the pending trip" — clicks the confirm button in the radix dialog and asserts the store state has a fresh trip (no id, empty shipments, dispatcher = planner). |
| `planning.spec.ts` "Cancel Trip marks the trip canceled and returns its shipments"       | **MOVED to qa-api**                | `longhaul-qa.spec.ts` "POST /trips → GET /trips/:id → POST /trips/:id/cancel". Implemented body: finds an unassigned shipment, posts a trip, fetches it, cancels it. Skips when the QA DB has no unassigned shipments.                      |
| `planning.spec.ts` "changing the dispatcher cascades to the shipments' shadow"           | **MOVED to qa-api**                | `longhaul-qa.spec.ts` "PATCH /shipments/:id/shadow round-trips". Implemented body: reads shadow, patches `lng_dis_comments` to a unique marker, re-reads via search, reverts.                                                               |
| `trip-detail.spec.ts` "trip notes: add + edit"                                           | **MOVED to qa-api** (new spec)     | `longhaul-qa.spec.ts` "POST /trips/:id/notes → PATCH /notes/:id round-trips the note body". Implemented body: finds a trip, posts a marker note, finds it in `GET /trips/:id`, patches with updated marker, re-reads.                       |
| `trip-detail.spec.ts` "editing an activity date persists"                                | **MOVED to qa-api**                | `longhaul-qa.spec.ts` "POST /activities then GET /activities reflects it". Implemented body: creates a trip with one shipment, verifies the auto-generated PACK/LOAD/RDEL activities surface, then cancels the trip for cleanup.            |
| `trip-detail.spec.ts` "changing trip status persists; an illegal transition is rejected" | **DROPPED**                        | Triple-covered: `apps/api/src/handlers/longhaul/trips.test.ts` (`PATCH /status` happy + 404), `longhaul-qa.spec.ts:143` (404 on non-existent trip), `Trip/index.test.tsx` (step-rail render).                                               |
| `shipments.spec.ts` "saving and re-applying a personal filter"                           | **REPLACED with container test**   | `containers/Shipments/components/FilterTabs/SaveFilterModal.test.tsx` — 4 cases: opens on link click, submits with right payload, closes on success, hides the link when no filters set.                                                    |

---

## Layer coverage after this triage

- **Handler tests** (`apps/api/src/handlers/longhaul/*.test.ts`): all 8 longhaul handlers, including the create/patch note + status PATCH + cancel paths exercised here.
- **Container/component tests**: Trip, Trips, PendingTrips, Shipments, ShipmentDetail, Notes (modal), ActivityGantt (popover), SaveFilterModal, PlanningModule (URL → dispatch), DriverPlanningLayout, AppGuard.
- **qa-api round-trips** (`apps/e2e/tests/api/longhaul-qa.spec.ts`): availability confirm, save/cancel trip, shadow patch, activities create, **notes create/patch** (new this triage).
- **Browser E2E**: read-only smoke + filter interactions + the one new save→itinerary mutating spec.

---

## Reseed reality check

Discovered while executing this triage: the `e2e-qa-longhaul.yml` workflow runs _all_ specs (no `--grep-invert @qa-mutating` filter), so the @qa-mutating specs _do_ get exercised in CI — but only the ones that don't need a reseed-compatible state. The 2 that previously passed without a reseed:

- `qa-api PATCH /driver-planning/:driverId` (upsert, idempotent enough)
- `availability cancel discards an in-progress edit` (no commit, self-rolls-back)

The new specs added here each:

1. Self-skip when their precondition isn't met (no unassigned shipment, no trips, etc.).
2. Clean up after themselves where possible (revert shadow, cancel the created trip).

So the workflow stays green without manual reseeds in nominal QA state. A reseed is still needed if the disposable QA DB drifts into a stuck state (e.g. all shipments assigned, no trips, etc.).

---

## Net counts

- Browser fixme'd specs deleted: 9 → 0 (1 un-fixme'd + implemented, 8 dropped/replaced/moved).
- Container tests added: 4 cases across 3 files.
- qa-api specs added: 1 new (notes round-trip).
- qa-api fixme'd specs un-fixme'd + implemented: 3 (POST/cancel, PATCH shadow, POST activities).
- Net new vitest cases in driver-planning: 600 → ~604 (4 from SaveFilterModal, 2 from PlanningModule, 1 from PendingTrips, -3 from one removed test stays in commit).

---

## 2026-05-14 verification pass — findings & open follow-ups

Three real bugs in the new qa-api specs surfaced on the first reseeded run; the
first two are fixed, the third is still open and is now the only thing blocking
the 3 fixme'd trip-write specs.

### Fixed during this pass (commit 8ca341e)

1. **`/shipments` filter must be NESTED, not flat.** The on-prem path silently
   ignores unknown top-level keys, so `{Is_Trip_Planning, load_date, assigned}`
   returned the whole DB → `RESULT_LIMIT_EXCEEDED` (>1000 rows). The UI sends
   `{filters:{...},sortBy:{}}` (see `redux/shipments/index.ts` →
   `utils/api/routes.ts`). Three specs were silently skipping for the wrong
   reason. `planningWindowQuery()` in `longhaul-qa.spec.ts` now wraps the
   correct shape.
2. **`PATCH /shipments/:id/shadow` requires `order_num` in the JSON body**, not
   just the URL `:id` (zod `ShadowBody` at `handlers/longhaul/shipments.ts:39`).
3. **The /shipments response carries flat `lng_dis_comments`**, NOT the nested
   `pegasus_shadow.lng_dis_comments` the original spec was reading. That
   nesting is a client-side reshape only (`reshape-shipment.ts`). The shadow
   round-trip read-back now checks the flat key.

### Resolved (2026-05-14) — the on-prem trip-save 500

Reproduced locally on Dolios (`DOLAB-M70Q-1`) by POSTing a trip body identical
to the qa-api spec's. The on-prem service err log (`logs/pegasusapi.err.log`)
showed the real Knex error:

```
Error: Undefined binding(s) detected when compiling FIRST.
Undefined column(s): [id]
query: select top (?) * from [TripMaster] where [id] = ?
```

— meaning the read-back after the trip INSERT was binding `undefined` for the
id. Root cause: bare `.insert(data)` on Knex+mssql returns rowsAffected, not
IDENTITY, so `result[0]` was 1 (the row count), then on subsequent inserts
became undefined under the transaction. Patched the 4 affected repository
inserts to pass `['id']` (or `['filter_id']`) as the 2nd arg.

After that fix, a second error appeared:

```
Error: insert into [LongDistanceDispatchActivity] ... output inserted.[id] ...
- The target table 'LongDistanceDispatchActivity' of the DML statement cannot
  have any enabled triggers if the statement contains an OUTPUT clause without
  INTO clause.
```

Patched `insertActivity` with `{ includeTriggerModifications: true }`, which
makes Knex rewrite the OUTPUT to use a table variable. After both fixes:

- POST /trips → 201 with auto-generated LOAD + RDEL activities.
- POST /trips/:id/cancel → 200, `internal_status = 'canceled'`, activities
  cleared.

Both diagnostic paths from the original "open defect" note are now unnecessary
(the server-side log path is what was used — the err log was actually local
to the on-prem Windows host all along).

3 specs un-fixme'd:

- `longhaul-qa.spec.ts:199` — POST /trips → GET → cancel
- `longhaul-qa.spec.ts:354` — POST /activities (via trip-create)
- `planning.spec.ts:177` — browser save→itinerary

## When to action follow-up

Push the repo fix + un-fixme'd specs, then trigger an `e2e-qa-longhaul.yml`
workflow_dispatch run to verify all 3 specs pass (not skip) on a freshly
reseeded QA. The cloud Lambda needs no behavioral change — onprem.ts is a
transparent proxy; the fix lives entirely in the on-prem Windows Service
(rebuilt + restarted in this session).
