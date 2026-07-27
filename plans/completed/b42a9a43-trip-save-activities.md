# Trip save must not re-derive the trip's activities

## Problem

Saving an existing longhaul trip in the Planning screen 403s with

```
PUT /api/v1/onprem/longhaul/trips/15978 403
{ message: 'Cannot remove 2 activity(s) with actual dates from trip', code: 'VALIDATION_ERROR' }
```

Reported when adding a shipment that is already on another trip to a second
existing trip — but the added shipment is not the cause; the save-diff wants to
delete activities the trip already owns.

## Root cause

`apps/api/src/lib/longhaul-trip-save.ts:167` rebuilds the trip's final activity
set from scratch on every save:

```ts
for (const shipment of dtoShipments) dtoActivities.push(...buildShipmentActivities(shipment))
```

`buildShipmentActivities` (`apps/api/src/lib/longhaul-build-activities.ts:92`)
discards every activity that is already on a trip:

```ts
const existing = (shipment.activities ?? []).filter((a) => a['TripMaster_id'] == null)
```

Every activity the trip owns carries `TripMaster_id = <this trip>` — that is what
`GET /trips/:id` returns (`lib/longhaul-trip-fetch.ts:229` filters each shipment's
activities to this trip). So on save they are all dropped, and only the four
_required_ templates are re-derived (PACK, LOAD-or-R19O, RDEL), and only when the
shipment row still carries `pack_date2` / `load_date2` / `rule19_id`.

Anything the re-derive cannot reproduce is then absent from `dtoActivities`, so
`activitiesToRemoveRows` (`longhaul-trip-save.ts:176`) picks it up:

- extra types attached from the Add-Activity menu — R19I, SITIN, SITOUT, UNPK,
  XPU, XDEL, WHSE, CFA, CFD;
- a required type whose trigger field is now null on the shipment row.

If any such row has an `actual_date`, the guard at line 179 hard-fails the save
(403). Otherwise it is silently **deleted**.

This is a port divergence. The legacy on-prem `saveTripLogic` used the DTO's
activities verbatim (`longhaul/server/modules/trips/trip.service.ts:181-184`:
`activities.push(...shipment.activities)`) and never re-derived, so persisted
activities always matched and were updated rather than removed.

Confirmed by replaying `computeTripSavePlan` over a payload shaped like the real
one: a trip carrying R19O + SITIN + RDEL loses the SITIN and returns
`Cannot remove 1 activity(s) with actual dates from trip`.

### Secondary defects from the same line

- Deleting a PACK / LOAD / RDEL activity in Planning does not stick — the save
  re-generates it.
- Planner edits to `planned_start` / `planned_end` (PendingTrips date popover) are
  discarded, because the persisted row is replaced by a freshly generated template
  built from the shipment's date columns.
- `finalActivities` feeds `computeTripSummary`, and generated templates have no
  `actual_date` — so every save writes `actual_first_day` / `actual_last_day` back
  as null on `TripMaster`.

## Change

`apps/api/src/lib/longhaul-trip-save.ts` — use the DTO's activities as the legacy
service did, auto-filling only when a shipment arrives with none:

```ts
const acts = shipment['activities'] as Activity[] | undefined
dtoActivities.push(...(acts?.length ? acts : buildShipmentActivities(shipment)))
```

Safe because `GET /shipments` already runs `buildShipmentActivities` before the UI
ever sees a shipment (`handlers/longhaul-cloud/shipments-list.ts:525`), so a
shipment added from the search panel arrives with its required templates already
expanded. The save-side call is redundant for the UI flow and lossy for every
persisted activity. The fallback keeps auto-fill for API clients (and the existing
tests) that post bare shipments.

`TripMaster_id` is not in `ACTIVITY_COLUMNS`, so a DTO row's stale trip id can
never be written; adds still get `TripMaster_id = @tripId` from the SQL batch.

## Tests

`apps/api/src/lib/longhaul-trip-save.test.ts`:

- a persisted extra-type activity (e.g. SITIN with an `actual_date`) on a shipment
  that also has R19O + RDEL → plan is `kind: 'plan'`, `removeIds` empty, the SITIN
  is in `activitiesToUpdate`. This is the reported 403, and it fails before the fix.
- a persisted activity whose required trigger field is null (R19O with
  `rule19_id: null`) → not removed.
- an activity dropped from a shipment's `activities` by the planner → still
  removed (deletion keeps working, and is not resurrected by auto-fill).
- a shipment posted with no `activities` key → auto-fill still generates
  PACK/LOAD/RDEL (regression guard for the fallback).
- planner date edits on a persisted activity survive into `activitiesToUpdate`.

Existing handler tests (`handlers/longhaul-cloud/trip-save.test.ts`) post
shipments without an `activities` key and must stay green via the fallback.

## Verification

- `npm test` + `npm run typecheck` in `apps/api`.
- Re-run the payload replay harness against the reported trip's PUT body: expect
  `PLAN → ok` with 0 removes.

### Result

Done. `apps/api`: 211 files / 2768 tests green, coverage thresholds held,
typecheck + eslint + prettier clean.

The five behavioral tests were confirmed to fail against the pre-fix
`longhaul-trip-save.ts` (`git stash` → 5 failed / 13 passed) and pass after it —
they are real regression guards, not tautologies. The two auto-fill tests pass
either way by design (they pin the fallback).

Replaying a trip carrying R19O + SITIN(actual_date) + RDEL plus a newly added
shipment went from

```
PLAN → ERROR: Cannot remove 1 activity(s) with actual dates from trip
  id=901 order_num=111 code=SITIN actual_date=2026-07-03
```

to

```
PLAN → ok: 2 add, 3 update, 0 remove
```

Still to confirm against the reported trip 15978: the PUT payload, to rule out the
first "out of scope" case below (a trip shipment missing from `trip.shipments`),
which raises the same guard error and would need a separate fix.

## Out of scope

- A shipment that is on the trip in the DB but missing from the trip's `shipments`
  array (no row in `v_longhaul_shipments_v2`) produces the same guard error and is
  **not** addressed here — its activities are genuinely absent from the payload.
  Note it if the reported payload shows that shape.
- Adding a shipment that carries untripped activity rows with real ids inserts
  copies rather than re-parenting them, leaving the originals orphaned. Pre-existing,
  untouched by this change.
