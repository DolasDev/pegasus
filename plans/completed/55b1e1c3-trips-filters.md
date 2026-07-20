# Fix: trips-screen origin / destination / driver filters silently no-op

## Problem

On the Operations → Trips screen, the Origin St, Dest St, and Driver filters do
nothing — selecting a value returns the full (TOP 100) trip list unchanged. The
handler reads a key off each filter's `value` object that the dropdown never
sends, so the value resolves to `undefined`, gets stripped, and **no WHERE
predicate is emitted** (silent no-op, not an error).

Confirmed via the reported wire payload:
`origin:[{"value":{"id":55,"geo_code":"TX",...}}]` (no `state_id`), and
`driver_id:{}` (serialized `{value: undefined}`).

Zones, status, is-active, planner, dispatcher, trip id, weight and date ranges
are correct and out of scope.

**Not a migration regression** — the deleted on-prem `trips.repository.ts` read
the same `o.value?.state_id`, so these filters have likely never worked. Noted so
nobody bisects for it.

## Root cause

- `apps/api/src/handlers/longhaul-cloud/trips-list.ts`
  - `filters.origin.map((o) => o.value?.state_id)` — but `StateDropdown` sets
    `value: state` (raw `v_longhaul_states` row, PK = `id`, no `state_id`).
  - Destination identical (`d.value?.state_id`).
  - `filters.driver_id?.value` — but `TripsFilter` builds `{ value: val?.value.id }`
    from a `DriverTypeahead` whose rows have `driver_id`, not `id` (same class as
    trip-save driver bug #437).
- `apps/tenant-web/src/features/driver-planning/containers/Trips/components/TripsFilter.tsx`
  - driver `onChange` reads `val?.value.id`.

## Fix (tolerant of either key so nothing feeding these shapes breaks)

1. `trips-list.ts` — origin: `o.value?.state_id ?? o.value?.id`; destination
   symmetric. Update the `TripFilters` interface `origin`/`destination` value
   type to allow `{ state_id?: number; id?: number }`.
2. `trips-list.ts` — driver: accept `state_id`-style either-key not needed;
   driver already keys on `.value`. The real miss is upstream in `onChange`.
3. `TripsFilter.tsx` — driver `onChange`: `val?.value.driver_id ?? val?.value.id`.

## Tests

- `apps/api/src/handlers/longhaul-cloud/trips-list.test.ts` — add cases pinning
  the **real wire shape**:
  - origin `[{ value: { id: 55, geo_code: 'TX' } }]` → emits
    `TripMaster.origin_state_id IN (@p…)` with bound value `55`.
  - destination same on `destination_state_id`.
  - driver `{ value: 12 }` → emits `TripMaster.driver_id = @p…` bound `12`.
  - regression guard: legacy `state_id` key still works.
- `TripsFilter.test.tsx` — driver select maps a picked row (`driver_id`) to the
  filter `value`.

## Verify

- `npm run typecheck`, `npm test` (api + tenant-web), `npm run lint`.
- Optional: `apps/tenant-web:verify` skill — drive the SPA and confirm the
  request body carries a populated origin/driver predicate.

## Land

Commit plan + impl together; one PR via merge queue.
