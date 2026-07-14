# Rate trip shipments — 400NG "Rate trip" button

Branch: `feat/rate-trip-shipments` (worktree at `../pegasus-rate-trip-shipments`, off fresh `origin/main`).
Status: implemented + unit/component tests green, typecheck/lint clean. Not yet PR'd.

Goal: add a "Rate trip" action to the driver-planning Planning screen (`PendingTrips`) and the
saved-trip gantt detail (`Trip`) that rates each shipment on the trip via `POST /api/v1/rating/rate`
(400NG) and shows a **per-shipment + trip-total** baseline rate, with clear handling for shipments
that can't be rated.

This is the "tenant-web UI for rating" deferred in `plans/todo/rating-engine-pr4-update-mechanism.md`.
No backend or authz changes: `POST /api/v1/rating/rate` already exists (#410) and `tariff:rate` is
already granted to the viewer baseline, so every standard operations user can call it.

## Context an agent needs to resume

- Rate endpoint: `apps/api/src/handlers/rating.ts` — `POST /api/v1/rating/rate`, one shipment per call.
  Body: `{ weightLbs>0, originZip /^\d{5}$/, destZip /^\d{5}$/, pickupDate ISO, options?{fullPack,fullUnpack}, linehaulDiscountPercent? }`.
  Returns `{ data: { lineItems[], total, currency, meta:{ billedWeightLbs, mileage, warnings } } }`.
  Throws `DomainError` `MILEAGE_OUT_OF_RANGE` when the zip3-centroid estimator can't place a pair.
- Shipment fields available client-side (already reshaped): `total_est_wt` (weight),
  `shipper_zip`/`consignee_zip`, `plan_load`/`plan_pack`/`load_date2`/`pack_date2` (dates),
  `order_num`, `shipper_city/state`, `consignee_city/state`, `line_haul` (legacy linehaul $, NOT 400NG).
  `PendingTrips` already sums `total_est_wt` (getTotalWeight) and `line_haul` (getTotalPrice).
- Frontend API idiom: `apiFetch<T>(path, init)` from `@/api/client` unwraps `{data}` + throws `ApiError`.
  React Query hooks live in `apps/tenant-web/src/api/queries/`. No `api/rating.ts` exists yet.
- Screens: Planning = `/driver-planning/planning` → `PlanningModule` → `containers/PendingTrips`.
  Trip detail (gantt) = `/driver-planning/trips/$tripId` → `containers/Trip`.
- Button pattern: existing buttons use the shared `../../components/Button` and a `data-target="..."`
  attribute for E2E hooks. `PendingTrips` has `.pending-trip-buttons-container` (New Trip / Save /
  MoreTripActions kebab); `Trip/index.tsx` has a `.buttonContainer` (All trips / Edit planning).

## Checklist

- [x] `apps/tenant-web/src/features/driver-planning/utils/rate-shipment.ts` (+ `.test.ts`) — PURE helpers:
  - `buildRatePayload(shipment)` → `{ ok:true, payload }` or `{ ok:false, reason }`.
    - zip normalize: `String(z ?? '').replace(/\D/g,'').slice(0,5)`; if length !== 5 → `reason:'bad-zip'`.
    - weight: `Number(shipment.total_est_wt)`; if not finite or <= 0 → `reason:'no-weight'`.
    - pickupDate: first present of `plan_load, plan_pack, load_date2, pack_date2` → ISO; else `reason:'no-date'`.
    - payload = `{ weightLbs, originZip, destZip, pickupDate }` (tariffCode defaults 400NG server-side).
  - `rateTripShipments(shipments, rateFn, {concurrency=4})` → `Promise<RateRow[]>` where
    `RateRow = { shipment, status:'rated'|'uncable'|'error', total?, warnings?, reason?, message? }`.
    Skips uncable (from buildRatePayload) without calling the API; rates the rest with a small
    concurrency limit (Lambda cap = 10 on this account); catches per-shipment errors (esp.
    `MILEAGE_OUT_OF_RANGE`) → `status:'error'` with the message, never fails the whole batch.
- [x] `apps/tenant-web/src/api/rating.ts` — `rateShipment(payload): Promise<RateResult>` via
      `apiFetch<RateResult>('/api/v1/rating/rate', { method:'POST', body: JSON.stringify(payload) })`
  - exported `RatePayload` / `RateResult` types mirroring the handler.
- [x] `apps/tenant-web/src/api/queries/rating.ts` — `useRateTrip()` = `useMutation` that takes a
      `shipments[]`, runs `rateTripShipments(shipments, rateShipment)`, returns `{ rows, tripTotal }`
      (tripTotal = sum of `rated` totals). No cache write needed (rates aren't persisted).
- [x] `apps/tenant-web/src/features/driver-planning/components/RateTripResult/` — presentation:
      a `PopoverShell`/dialog (reuse existing dialog pattern) rendering a table — one row per shipment
      (`order_num`, lane `city, ST → city, ST`, billed weight, **400NG total** or `—` + reason/message),
      a footer **trip total**, and a header note "400NG baseline (undiscounted) — differs from Linehaul".
      Loading + empty states. `data-target="rate-trip-result"`.
- [x] `apps/tenant-web/src/features/driver-planning/components/RateTripButton/` — the trigger button
      (`data-target="rate-trip"`), disabled when `shipments.length === 0`; opens `RateTripResult`, calls
      `useRateTrip`. Shared by both screens.
- [x] Wire into `containers/PendingTrips/index.tsx` — add `<RateTripButton shipments={currentTrip.shipments} />`
      in `.pending-trip-buttons-container` (rates the in-progress trip).
- [x] Wire into `containers/Trip/index.tsx` — add `<RateTripButton shipments={trip.shipments} />` in the
      `.buttonContainer` next to "Edit planning" (rates the saved trip). Hide/disable in `isRejected` read-only mode.
- [x] Component test for `RateTripButton`/`RateTripResult` with a mocked rate fn: mix of rated +
      `MILEAGE_OUT_OF_RANGE` error + bad-zip uncable → asserts per-row rendering + correct trip total.

## Files created / modified

Created: `utils/rate-shipment.ts` (+test), `api/rating.ts`, `api/queries/rating.ts`,
`components/RateTripButton/*`, `components/RateTripResult/*` (+ component test).
Modified: `containers/PendingTrips/index.tsx`, `containers/Trip/index.tsx`.

No new route, no `router.tsx`/`AppShell.tsx`/`schema.prisma`/cedar/`actions.ts` edits → avoids all the
known hot/merge-magnet files. Purely additive tenant-web frontend.

## Risks / edge cases

- Legacy zips are frequently ZIP+4, padded, null, or non-US → normalize + mark `uncable`, never crash.
- Missing/zero `total_est_wt` → uncable (`no-weight`). Uses ESTIMATED weight by design; actual
  (`total_actual_wt`) not used — could be a future toggle.
- 400NG min billing weight is 1,000 lb; the engine bumps light shipments (surfaced via `meta.billedWeightLbs`).
- Result is the **published baseline** (no TSP-negotiated discount — not in longhaul data). Label it so
  it isn't mistaken for the contracted price or the existing `line_haul` figure. (Optional future: a
  single `linehaulDiscountPercent` input.)
- N calls per trip (one per shipment) → concurrency-limited client-side. If trips routinely carry many
  shipments, consider a server-side batch endpoint later (out of scope here).
- 400NG-only (`tariffCode` literal). Informational for non-400NG traffic.

## Out of scope

Persisting rate results, wiring into the Quote flow, tariff-version selection UI, per-tenant discount
persistence, server-side batch rating, and any backend/Cedar/schema change.

## Verification

- Unit: `rate-shipment.test.ts` (zip normalize, weight/date selection, each uncable reason, concurrency
  - per-shipment error isolation).
- Component: `RateTripButton` test (mocked rate fn, mixed outcomes → rows + trip total).
- Manual/E2E: run tenant-web against QA, open a pending trip with real shipments, click Rate trip,
  confirm per-shipment + total render and uncable shipments degrade gracefully.
- `npm run typecheck` + `npm run lint` + `npm test` (tenant-web) green before PR.
