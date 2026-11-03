# Itinerary — tenant-web dispatcher view (Operations → Itinerary)

**Status:** SHIPPED (this PR). **Branch:** `feat/dispatcher-itinerary` (worktree `../pegasus-dispatcher-itinerary`).
Part of `plans/todo/driver-itinerary-mobile.md` (decision 3).

**Goal:** a dispatcher sees any driver's itinerary — trip activities, order-assigned acts and local
job acts — in tenant-web, the same list the driver sees in the app.

## Decision (Steve, 2026-11-02)

Pick a longhaul driver and a crew **separately** (each optional, at least one). Longhaul drivers come
from the existing `/onprem/longhaul/drivers`; crews from a NEW Operations-gated read — the admin-only
`/local-drivers` (`UpdateUser`) is NOT relaxed.

## Design

- API: `GET /onprem/longhaul/local-drivers` — Operations roles only (403 otherwise, like
  `/drivers/itinerary`), `listLocalDrivers` from `chat-access.ts`; 422 `MSSQL_NOT_CONFIGURED`.
- tenant-web:
  - `api/queries/driver-itinerary.ts` — `ItineraryItem` type (copied contract), the itinerary query
    (`/onprem/longhaul/drivers/itinerary?from&to&longhaulDriverId&localDriverEmployeeId`, keeps
    `meta.failedSources`) and the Operations crew list query.
  - `features/driver-planning/routes/ItineraryModule.tsx` — two pickers, a week range (‹ › Today),
    the list day → stop → act, each act linking to its shipment (`/driver-planning/shipments` with
    the order) and its trip; partial-list banner.
  - Router `/driver-planning/itinerary` (Operations gate like its siblings) + nav entry.
- The two ids are never paired automatically — the dispatcher picks each (id spaces differ).

## Checklist

- [x] API `handlers/longhaul-cloud/local-drivers.ts` + test (7): Operations roles only (403
      without a legacy read), 422 `MSSQL_NOT_CONFIGURED`, 503 `LEGACY_UNAVAILABLE`. Mounted beside
      `/drivers/itinerary` (the `/onprem` wildcard proxy is gone, so order doesn't matter).
- [x] `api/queries/driver-itinerary.ts` + test (4): the copied row contract (incl. `order-assigned`),
      the itinerary query (keeps `meta.failedSources`; disabled until something is picked), the
      Operations crew list.
- [x] `features/driver-planning/itinerary/itinerary-view.ts` + test (5): week range, day → stop
      grouping (same rule as mobile), labels.
- [x] `routes/ItineraryModule.tsx` + test (5): two native `<select>` pickers (the Users-page
      pattern; driver 0 is never offered), week paging + Today, the grouped list with a source
      badge (Trip N / Order / Local job), trip status, storage, confirmed; an act selects its order
      into the shared ShipmentDetail drawer (as Services does) and leaving clears it; partial-list
      warning. `styles.css`: the container joins the Services layout + drawer rules.
- [x] Router `/driver-planning/itinerary` (`requireRole(...OPERATIONS_ROLES)`) + nav "Itinerary".
- [x] api 314 files / 4,746 tests; tenant-web 162 / 1,710; tsc + eslint clean.
