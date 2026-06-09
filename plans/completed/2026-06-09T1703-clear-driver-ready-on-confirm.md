# Clear driver "ready" availability when a trip is confirmed

> **Status: COMPLETED & SHIPPED — 2026-06-09.** PR [#225](https://github.com/DolasDev/pegasus/pull/225),
> squash-merged as `e178d56`. Branch CI, main CI, and Deploy all green (Deploy was a
> no-op for app components — backend/frontend code did deploy via the api + tenant-web filters).
> Tests: 4 new backend cases in `trips-write.test.ts` + `clearsDriverAvailability` truth-table in
> `trip-status.test.ts`. Implemented exactly as planned below.
> **Not exercised by automation:** the on-prem MSSQL end-to-end path (step 3 of Verification)
> needs a longhaul tenant over WireGuard — left for a manual QA spot-check.

## Context

In the longhaul driver-planning feature, planners manually record a driver's **ready availability** on the Operations → Availability screen: a _ready date_ and a _ready city/state_. These are planner overrides stored in the on-prem MSSQL table `DriverConfirmedAvailability` as `confirmed_date` (ready date) and `confirmed_location` (`"STATE, City"`).

Once a driver is **confirmed onto a trip**, those manually-entered ready values are stale — the driver is now committed, so their old "I'm free on date X in city Y" override is no longer valid. Today nothing clears them, so planners see misleading availability for drivers who are already booked.

**Goal:** When a trip moves from **Pending or Offered** into **Accepted or In-Progress** for an assigned driver, clear that driver's `confirmed_date` and `confirmed_location`. Surface a confirmation prompt on the Trips screen before the change so the planner knows the availability will be wiped.

**Decisions (confirmed with user):**

- **Trigger:** previous status ∈ {Pending(1), Offered(2)} **and** new status ∈ {Accepted(3), In-Progress(4)}, with a driver assigned. (Not triggered by Accepted→In-Progress, nor by a direct jump to Finalized.)
- **Cleared columns:** `confirmed_date` and `confirmed_location` only. **Keep** `notes` and all roster fields (`canada`, `california`, `rating`, `equipment`, `home_city`, `home_state`).
- **Guard:** confirmation dialog on the Trips screen for this transition.

---

## Backend — clear the ready values (authoritative)

**File:** `apps/api/src/handlers/longhaul-cloud/trips-write.ts` (`longhaulTripStatusHandler`, lines 76–156)

The handler already reads the trip header (`driver_id`, `TripStatus_id`) in `STATUS_READ_SQL` and writes the status change atomically in `STATUS_WRITE_SQL`. Extend that existing transaction — no new round trip.

1. **Compute the clear condition** in JS after the header read (after line 113), reusing the already-fetched `header`:

   ```ts
   const oldStatus = header.TripStatus_id ?? 0
   const clearReady =
     header.driver_id != null &&
     (oldStatus === 1 || oldStatus === 2) &&
     (statusId === 3 || statusId === 4)
   ```

2. **Add a guarded UPDATE inside `STATUS_WRITE_SQL`** (between the existing `LongDistanceDispatchActivity` update and `COMMIT TRAN`). Keep the SQL a static constant and drive behaviour via params — mirrors the existing parameterised style:

   ```sql
   IF @clearReady = 1 AND @driverId IS NOT NULL
      AND OBJECT_ID('DriverConfirmedAvailability','U') IS NOT NULL
     UPDATE DriverConfirmedAvailability
       SET confirmed_date = NULL, confirmed_location = NULL,
           updated_by = @code, updated_at = GETDATE()
       WHERE driver_id = @driverId;
   ```

   The `OBJECT_ID(...) IS NOT NULL` guard is required: `DriverConfirmedAvailability` is lazily created (see `driver-confirmed-availability-schema.ts`), and with `SET XACT_ABORT ON` a missing-table error would otherwise roll back the whole status change on tenants that have never written a confirmed-availability override.

3. **Pass the two new params** into the `STATUS_WRITE_SQL` `executeSql` call (line 140), alongside the existing `id`/`statusId`/`statusName`/`code`:
   ```ts
   { name: 'clearReady', value: clearReady ? 1 : 0 },
   { name: 'driverId', value: header.driver_id ?? null },
   ```

Atomicity is preserved: status change, activity sync, and the availability clear commit or roll back together. The existing guard at line 115 already 403s any advance past Pending without a driver, so `clearReady` only ever fires for trips that genuinely have a driver.

---

## Frontend — confirmation prompt on the Trips screen

There is already a confirm dialog for every status change (`usePromptForStatusUpdate` → "Promote trip status?"). We augment it to show a clear-warning variant for the qualifying transition. No new dialog component needed — reuse `useConfirm()` / `ConfirmDialog`.

**File:** `apps/tenant-web/src/features/driver-planning/common/trip-status.ts`

- Add a small predicate the prompt (and anyone else) can reuse:
  ```ts
  const PRE_CONFIRM = new Set([TripStatus.PENDING, TripStatus.OFFERED])
  const CONFIRMED = new Set([TripStatus.ACCEPTED, TripStatus.IN_PROGRESS])
  export function clearsDriverAvailability(from?: TripStatus, to?: TripStatus): boolean {
    return !!from && !!to && PRE_CONFIRM.has(from) && CONFIRMED.has(to)
  }
  ```

**File:** `apps/tenant-web/src/features/driver-planning/containers/Trip/utils/status-prompt.ts`

- Extend `usePromptForStatusUpdate` to take the **current** status so it can branch:
  `(target: TripStatus, current: TripStatus | undefined, cb: () => void)`.
- When `clearsDriverAvailability(current, target)` is true, show a warning variant:
  - title: `Confirm trip & clear driver availability?`
  - description: `Promoting to ${target} confirms the driver for this trip. Their recorded ready date and location will be cleared.`
  - `confirmLabel: 'Confirm'`, `destructive: true`
  - otherwise keep the existing "Promote trip status?" prompt.
- Update the internal caller `useStatusPredictionPrompt` (same file, line 68) to pass `trip?.status?.status` as `current`.

**File:** `apps/tenant-web/src/features/driver-planning/containers/Trip/index.tsx`

- Update `promptAndChangeStatus` (line 83) to thread the current status:
  ```ts
  const promptAndChangeStatus = (status: any, status_id: any) => {
    promptForStatusUpdate(status, trip.status?.status, () => changeStatus(status_id, status))
  }
  ```

The Trips screen does **not** load the driver's confirmed-availability values, so the prompt warns generically rather than echoing the specific date/location — acceptable and matches the requirement.

---

## Tests

**`apps/api/src/handlers/longhaul-cloud/trips-write.test.ts`** (mirror existing `readResult` + chained `mockResolvedValueOnce` pattern; mocks `executeSql` and `resolveLonghaulUser`, no DB). Assert on `executeSqlMock.mock.calls[1]` params:

- Offered(2)→Accepted(3), driver assigned → params include `{ name: 'clearReady', value: 1 }` and `{ name: 'driverId', value: <id> }`; write SQL contains `UPDATE DriverConfirmedAvailability`.
- Pending(1)→Accepted(3), driver assigned → `clearReady` = 1.
- Accepted(3)→In-Progress(4) → `clearReady` = 0 (already confirmed).
- Pending(1)→Offered(2) → `clearReady` = 0.
- Existing status-change tests still pass (extra params are additive).

**Frontend:** add/adjust a unit test for `clearsDriverAvailability` truth table if a test file exists for `trip-status.ts`; otherwise rely on typecheck. No existing test was found for `status-prompt.ts`.

---

## Verification

Use the Node 24 toolchain for installs/tests/build (default shell node is unsupported):
`PATH=/home/steve/.nvm/versions/node/v24.16.0/bin:$PATH`

1. **API unit tests:** from `apps/api`, run the vitest suite for `trips-write.test.ts` (mocked — no Docker/DB needed).
2. **Typecheck + build:** `npm run typecheck` (root) covers api + tenant-web; build tenant-web to confirm the prompt signature change compiles.
3. **End-to-end (QA, against a longhaul tenant with WireGuard + `mssqlConnectionString`):**
   - On Operations → Availability, set a driver's ready date + city/state (writes `confirmed_date`/`confirmed_location`).
   - Open a trip for that driver currently in Offered; on the Trips screen click Accepted.
   - Confirm the **"Confirm trip & clear driver availability?"** dialog appears (destructive styling); confirm it.
   - Return to the Availability screen and verify that driver's ready date/location are now blank, while notes/roster fields remain.
   - Sanity-check the non-clearing paths (Accepted→In-Progress, Pending→Offered) still use the plain "Promote trip status?" prompt and leave availability untouched.
