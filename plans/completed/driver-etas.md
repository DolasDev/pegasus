# Plan: Driver ETA submission + "Confirmed" commitment (mobile)

**Branch:** `feat/driver-etas` (worktree `../pegasus-driver-etas`). All changes stay on this branch.

## Goal

In the mobile driver app, a driver can submit an ETA on their **Delivery (`RDEL`)** and
**Delivery to Storage / SIT-IN (`SITIN`)** activities and mark it **Confirmed**. The UI makes it
explicit that Confirmed means **both the driver and the shipper have committed to that delivery
date**.

## Decisions (approved 2026-10-14)

| #   | Decision                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | "Confirmed" writes the existing `LongDistanceDispatchActivity.is_committed` bit ("Driver committed"). No new column, no trigger review. `is_confirmed` stays the dispatcher's flag and is never written by this path.                                                                      |
| D2  | ETA = `estimated_date` (calendar day) + arrival window (`arrival_window_start`/`_end` `HH:mm` + `arrival_window_tz`). For activity types where `Longhaul_ActivityType.isHasETA` is false, the driver edits **only the arrival window**, which anchors to `planned_start` as it does today. |
| D3  | A confirmed ETA stays editable. Changing the date or window of a confirmed activity shows a second warning: the shipper agreed to the old date, and saving keeps it Confirmed only if the driver re-confirms. Otherwise the save clears `is_committed`.                                    |
| D4  | Scope is activity codes `RDEL` and `SITIN`, filtered by `ActivityType_code`. The abbreviation can't be used because SIT-IN and SIT-OUT both abbreviate to `SIT`.                                                                                                                           |

## Design

### API: new driver-scoped endpoint (`apps/api`)

`PATCH /onprem/longhaul/driver/activities/:id/eta` →
`handlers/longhaul-cloud/driver-activity-eta.ts`

- The existing `POST /onprem/longhaul/activities/:id` can't be reused. `resolveLonghaulUser`
  needs a salesman mapping that drivers usually don't have (422 `LONGHAUL_USER_NOT_MAPPED`), and
  the endpoint accepts every column.
- Resolve the caller's `TenantUser.longhaulDriverId`. Return 403 if there isn't one.
- Load the activity with its type and trip. Return 404 if it's missing. Return 403 unless
  `a.assigned_driver_id` or the trip's `driver_id` equals the caller's driver id (server-side
  ownership check). Return 422 unless `ActivityType_code IN ('RDEL','SITIN')`.
- Narrow zod body: `estimated_date?`, `arrival_window_start?`, `arrival_window_end?`,
  `arrival_window_tz?`, `committed: boolean`. Return 422 if `estimated_date` is sent for a type
  with `isHasETA = false`.
- Reuse what's already there:
  - `normalizeDateOnlyColumns` and `findImplausibleDateColumn` for dates.
  - `validateArrivalWindow`, anchored to `estimated_date ?? planned_start`.
  - `ensureArrivalWindowColumns` for the lazy columns.
  - `recomputeTripSummaryCloud`, since `estimated_date` feeds the trip roll-up.
- `modified_by` gets NULL, like the M2M path. The write logs `driverId` and `activityId` for audit.
- Returns the updated activity projection.
- Extract the shared column write, validation and recompute steps from `activities-write.ts`
  into a helper only if that drops duplication without changing the dispatcher path's
  behavior. Otherwise copy the pieces.

### Mobile (`apps/mobile`)

- `src/types/longhaul.ts`: add `activities` to `LonghaulTripDetail` with the fields
  `GET /trips/:id` already returns. Those include id, type code and abbreviation,
  `isHasETA`, `estimated_date`, `planned_start`/`planned_end`, the arrival-window fields,
  `is_committed`, and the order number.
- `src/services/tripService.ts`: add `updateActivityEta(activityId, body)`.
- Trip detail (`app/trip/[id].tsx`) and/or shipment detail: list the shipment's RDEL/SITIN
  activities. Each row shows the type label ("Delivery" / "Delivery to Storage (SIT-IN)"), the
  current ETA and window, and a status badge: **"Confirmed with shipper"** (green) or
  **"Not confirmed"**. The wording deliberately avoids "Confirmed availability"
  (`DriverConfirmedAvailability`) and the dispatcher's `is_confirmed`.
- New `EtaEditorModal` following `AddDocumentModal`'s patterns:
  - A date picker that only appears when `isHasETA` is true.
  - Arrival-window start and end times, with the time zone taken from the activity.
  - A **"Mark as Confirmed"** switch. An always-visible explanation sits under it: _"Only mark
    Confirmed after you have spoken with the shipper and you both have committed to this
    delivery date and window."_
  - Turning Confirmed on (or saving while it's on) opens `Alert.alert` with the explicit
    statement: _"Confirming means both you and the shipper have committed to delivering on
    <date> between <window>. Dispatch will treat this date as committed."_ The choices are
    Confirm / Cancel.
  - Editing a confirmed ETA follows D3: the alert offers "Re-confirm with shipper" or
    "Save as not confirmed".
- `shipment/[orderNum].tsx`'s "view-only" header comment gets updated to note the one write
  surface.

### Dispatcher visibility

No tenant-web changes. `is_committed` already shows as "Driver committed" in the Trip Gantt and
on Availability. Optional follow-up, not in this PR: the Dispatch Activities card leaves the
flags out of its type.

## Files

- `apps/api/src/handlers/longhaul-cloud/driver-activity-eta.ts` (new) + `.test.ts`
- `apps/api/src/app.ts` (route registration)
- `apps/api/src/handlers/longhaul-cloud/activities-write.ts` / `apps/api/src/lib/*`, only if a
  shared helper is extracted (see above)
- `apps/mobile/src/types/longhaul.ts`, `src/services/tripService.ts` (+ test)
- `apps/mobile/src/components/EtaEditorModal.tsx` (new), `src/components/CommitmentBadge.tsx` (new)
- `apps/mobile/app/trip/[id].tsx` and/or `app/shipment/[orderNum].tsx`, plus screen/component tests
  under `apps/mobile/__tests__/`
- `apps/e2e/tests/api/`: an acceptance spec for the new endpoint (ownership 403, non-RDEL/SITIN 422)
  if the e2e fixtures can seed a legacy activity. Otherwise this is recorded as skipped and why.

## TDD order

1. API integration tests (failing first) for these cases:
   - Unmapped driver → 403.
   - Another driver's activity → 403.
   - SITOUT/other type → 422.
   - `estimated_date` on a non-ETA type → 422.
   - Bad window → 422.
   - Happy path writes only the allowed columns, sets or clears `is_committed`, and never
     touches `is_confirmed`.
   - Trip summary recompute is invoked.
2. Handler + route.
3. Mobile service test → service.
4. Modal/badge tests, including that the commitment explanation and confirm alert text render
   and that the re-confirm flow on edit works → components → screen wiring.
5. `npm run typecheck`, `npm test` (api + mobile, `npm run test:handles` in mobile).

## Out of scope

- OpenAPI/SDK exposure. This is a driver-app route, not an integrations or workflows capability.
- The Activities board card showing the flags.
- Any new DB column.
- The mobile release/build.

## Risks

- The arrival-window columns are added lazily on SQL Server. This reuses
  `ensureArrivalWindowColumns`, which is proven on the dispatcher path.
- Reads under `/onprem/longhaul/*` are still not driver-scoped. That predates this work and isn't
  fixed here; the new write path is ownership-checked.

## Implementation notes (as built)

- **API.** `PATCH /api/v1/onprem/longhaul/driver/activities/:id/eta`, in
  `handlers/longhaul-cloud/driver-activity-eta.ts`.
  - The body is `.strict()`, so `is_confirmed` or any other column is rejected with 400.
  - `committed` is required.
  - Error codes: `DRIVER_NOT_MAPPED` (403), `NOT_YOUR_ACTIVITY` (403),
    `ACTIVITY_TYPE_NOT_SUPPORTED` (422), `ETA_NOT_SUPPORTED` (422).
  - Ownership is checked against `a.assigned_driver_id`, falling back to `TripMaster.driver_id`.
  - The tenant and user lookups go through the request-scoped `c.get('db')`, because the
    db-access guard forbids the base client in handlers.
  - No helper was extracted from `activities-write.ts`; the shared lib functions are reused
    directly.
- **Mobile.**
  - The editor lives on the trip screen only: a "DELIVERY ETAS" section with
    `DeliveryEtaCard` and `EtaEditorModal`. Trip detail already carries `activities` with the type
    join, so the shipment screen is unchanged and stays view-only.
  - The date and window use large ± steppers (day; 30 min) instead of a native date picker. That
    adds no new native dependency. The app has no `expo-updates`, so the feature still reaches
    drivers only through a store build.
  - Time zone chips come from the activity's stored zone, falling back to the server's
    `arrival_window_tz_suggested`.
  - The confirmation alert fires on **Save**, not on flipping the switch. The switch carries the
    always-visible explanation.
  - Saving a confirmed ETA that hasn't changed doesn't ask again.
  - Pure logic and all the commitment wording are in `src/utils/driver-eta.ts`.
- **E2E acceptance — skipped.** The longhaul routes need a tenant MSSQL. There is no legacy-activity
  fixture in `apps/e2e`, and QA longhaul E2E is on-demand only. Coverage is the API handler unit
  tests plus the mobile component and screen tests.
- **Delivered activities are locked.** Once `actual_date` is set, the route
  returns 409 `ACTIVITY_COMPLETED` before any write, and the mobile card turns
  read-only ("Delivered <date> — ask dispatch if this ETA needs to change").
  Added after the self-review flagged it; dispatch can still edit from the Gantt.
