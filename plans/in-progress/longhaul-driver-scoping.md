# Longhaul reads — server-side driver scoping (fix/longhaul-driver-scoping)

## Goal

Close the gap where any signed-in tenant user (e.g. a driver on the mobile app) can read **any** driver's trips,
shipments, activities, rejected trips and availability through `/api/v1/onprem/longhaul/*`. Today those reads have
no gate, and `GET /trips` trusts a client-supplied `driver_id`.

## Decisions (Steve, 2026-10-15)

- **Who is restricted:** anyone **without an Operations role**. Full access stays with
  `tenant_admin`, `operations_admin`, `long_distance_dispatch`, `central_planning_dispatch` — the list tenant-web's
  route guard (`apps/tenant-web/src/auth/role-guard.ts` `OPERATIONS_ROLES`) already uses, now enforced server-side.
  Everyone else is scoped to their own `TenantUser.longhaulDriverId`; no mapping (null or 0) → fail closed.
- **Scope:** `GET /trips`, `GET /trips/:id`, `GET /shipments`, `GET /activities`, `GET|POST /rejected-trips[/:id]`,
  `GET /driver-planning`. Reference lists (states, zones, drivers, planners, …) stay open.
- **Not Cedar.** No Action covers longhaul reads and the dispatcher personas are deliberate placeholders
  (memory: "Operations is gated by ROLE NAME, not Cedar") — gating with `requirePermission` would lock dispatchers
  out. This follows the existing handler-level pattern (`moves.ts` crew scoping, `driver-activity-eta.ts` ownership,
  `PATTERNS.md` "A driver-scoped write on the legacy longhaul tables").

## Approach

1. **`lib/longhaul-read-scope.ts`** (new, pure + one DB read): `resolveLonghaulReadScope(c)` →
   `{ kind: 'all' }` for an Operations role, else `{ kind: 'driver', driverId }` from `c.get('db')`'s
   `TenantUser.longhaulDriverId` (0/null → `{ kind: 'none' }`). `OPERATIONS_ROLES` lives here (server copy; the
   tenant-web constant gets a comment pointing at it). Principal without `userId` (no TenantUser) → `none`.
2. **Per route, restricted callers:**
   - `GET /trips`: server sets `driver_id = @me`, overriding/ignoring the client's filter; `none` → empty list.
   - `GET /trips/:id`: 404 unless `TripMaster.driver_id = @me` (404, not 403 — don't confirm existence).
   - `GET /shipments`: `EXISTS (LongDistanceDispatchActivity a LEFT JOIN TripMaster t ON a.TripMaster_id = t.id
WHERE a.order_num = v.order_num AND (a.assigned_driver_id = @me OR t.driver_id = @me))` — activity-based, so a
     multi-leg/SIT shipment on the driver's trip stays visible (the mobile shipment screen re-fetches by order number).
     `none` → empty.
   - `GET /activities`: `(assigned_driver_id = @me OR TripMaster.driver_id = @me)`; `none` → empty.
   - `GET /rejected-trips[/:id]`: list forced to `driverId = @me`; detail 404 unless the rejection names `@me`;
     `POST` (a dispatcher tool; mobile never calls it) → 403 for restricted callers.
   - `GET /driver-planning`: only the caller's own driver row; `none` → empty.
     All driver ids are bound parameters.
3. **Tests first** (Vitest, handler level): for each route — Operations role unchanged (client filter honoured);
   driver sees only own rows even when sending another `driver_id`; unmapped non-ops user gets empty/404; SQL receives
   `@me` as a parameter. Unit tests for the scope resolver (each ops role, multi-role driver+ops = all, 0 = none).
4. **Docs:** update `PATTERNS.md` (the "/onprem/longhaul/* reads are **not** driver-scoped" note becomes the rule),
   `GOTCHAS.md` if anything surprising turns up.

## Risks

- A real dispatcher whose `roleNames` lacks every Operations role would lose data — but tenant-web's route guard
  already blocks such a user from these screens, so no working flow changes.
- `e2e-qa-longhaul.yml` (on-demand only, not a merge gate) runs as `QA_USER_USERNAME`; that user needs an Operations
  role in the QA tenant before the next run.
- Mobile is unaffected: it only ever asks for its own driver, and trip-detail shipments are covered by the
  activity-based EXISTS.
- Out of scope: documents (`ReadDocument` is granted to every principal), the ungated legacy writes (they already
  require a `v_longhaul_salesman` mapping).

## Acceptance

- A driver-role user cannot read another driver's trips/trip/shipments/activities/rejected trips/availability, by any
  query parameter. Operations users see exactly what they did before.
- `apps/api` tests + typecheck + coverage floor green; mobile untouched.
