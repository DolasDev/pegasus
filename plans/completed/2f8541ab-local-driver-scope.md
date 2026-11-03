# Itinerary: a local crew id is a driver identity — order read scope + mobile

**Status:** SHIPPED (this PR). **Branch:** `fix/local-driver-scope` (worktree `../pegasus-local-driver-scope`).
Part of `plans/todo/driver-itinerary-mobile.md` (decisions recorded there in this PR).

**Goal:** a driver whose work on an order is a LOCAL dispatch job can open that order's shipment
screen from My Itinerary, and a local-only driver is treated as a driver by the mobile app.

## Decisions (Steve, 2026-11-02)

- Widen the driver read scope so local items open the shipment screen like longhaul ones.
- Mobile edge: a login with only a local crew id is a driver (taken as the obvious fix).

## Design

- `resolveLonghaulReadScope` is **unchanged** — trips list/detail, planning, rejected trips and the
  activities list stay longhaul-only and fail closed. A local job has no trip, so a local-only caller
  keeps getting `none` there, exactly as today.
- New `resolveOrderReadScope` (same file): `all` | `driver { longhaulDriverId, localDriverEmployeeId }`
  (each `null` or a real id, at least one set) | `none`. Used ONLY by the order-scoped reads behind
  the shipment screen:
  - `shipments-list` — the EXISTS predicate admits an order the caller owns a longhaul activity on
    (as today) OR is `driver_id1/2` on an active `LocalDispatchJobs` row (`active <> 'N'`, the
    itinerary's rule). Each id binds its own parameter — never across numbering spaces.
  - labor `GET /orders/:orderNum/activities` — a local-only caller gets an empty list (they own no
    longhaul activity on the order), not 403.
- Documents are Cedar-gated per action (not per order); chat already admits local orders
  (`chat-access.ts`). Neither changes.
- `/me/driver` also returns `localDriverEmployeeId`. Mobile: `TripsContext` keeps `driverId`
  (longhaul — My Trips stays longhaul-only) and adds `localDriverId`; `laborAccess.isDriver` =
  `driver` role OR either id.
- Mobile itinerary: a local item opens `shipment/[orderNum]` like a longhaul one; the read-only
  `ItineraryItemDetail` sheet is removed (Phase 3 designs its own controls).

## Checklist

- [x] `lib/longhaul-read-scope.ts` `resolveOrderReadScope` + tests (all / longhaul-only / local-only /
      both / neither / 0 ids ⇒ none).
- [x] `shipments-list.ts` uses it; SQL-pinning tests for longhaul-only, local-only, both.
- [x] `labor.ts` order activities uses it; local-only ⇒ `[]`.
- [x] `me.ts` `/me/driver` + test.
- [x] Mobile: `DriverMapping` type, `TripService.getDriverMapping`, `TripsContext.localDriverId`,
      `laborAccessFor`, itinerary routing, remove `ItineraryItemDetail`; tests.
- [x] Live check (read-only, prod, 2026-11-03): every order on an active local job with a driver
      (−30..+30 days) is in `v_longhaul_shipments_v2` — NW 411/411 (312 local-only), QMM 242/242,
      RVS 135/135 (all local-only). The new predicate run verbatim on NW: crew 3097 sees 767 orders;
      crew **0 would see 38,501** — why `0 ⇒ none` is load-bearing (pinned by tests).
- [x] `/security-review` (row-scoping authz): no findings. Checked: unscoped query paths (none;
      both-null ⇒ `none` before MSSQL, empty predicate ⇒ `1 = 0`), injection (ids bound), id-space
      and tenant crossing (separate params; connection per tenant), self-assignment of the crew id
      (admin-only `UpdateUser`), the labor `null === null` trap (short-circuited), trip reads unchanged.
- [x] GOTCHAS / PATTERNS updated.
