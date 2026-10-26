# Driver itinerary — Phases 2–4 (mobile, act facts, order-assigned source)

**Status:** not started. Phases 0–1 (prod probe, itinerary API, Services board `include=local`)
shipped — the full record, decisions and the row contract are in
`plans/completed/19ad9517-driver-itinerary.md`. **Read its Phase 0 findings and Phase 1 decisions
before starting**; they are not repeated here.

**Branch:** a new workstream (`/workstream-start feat driver-itinerary-mobile <this file>`).
**Goal:** the mobile app opens on the driver's itinerary — longhaul activities and local job acts
together — and drivers can post ETA / done on local items too.

**API already live:** `GET /api/v1/onprem/longhaul/me/itinerary?from&to` (≤ 31 days, inclusive) →
`{ data: ItineraryItem[], meta: { count, from, to, failedSources } }`; 403 `DRIVER_NOT_MAPPED`
when the login has neither driver id. Type: `apps/api/src/lib/itinerary/types.ts`.

**Open decisions for Steve before Phase 2:**

- Does the itinerary sit beside Trips in the drawer, or replace it as home? (Default: beside.)
- Phase 3: may a local token's "done" ever write back to legacy? (`is_final` completes EVERY token
  on the job via `TriggerLocalDispatchUpdate`; see GOTCHAS.)

**Order of work:** the mobile EAS build only after the API it needs is deployed
(project memory, mobile driver app).

## Checklist

### Phase 2 — mobile itinerary

- [ ] `apps/mobile/src/services/itineraryService.ts` (+ test) — `GET /me/itinerary`.
- [ ] `apps/mobile/app/(drawer)/itinerary.tsx` — date-range list grouped by day, then derived stop
      (same day + same place); trip shown as a header/chip linking to the existing `trip/` screen;
      local-job items open `shipment/[orderNum]`.
- [ ] Drawer entry; decide with Steve whether it replaces `trips.tsx` as the default or sits beside
      it (default: beside, until NW drivers have used it).
- [ ] ETA editing stays activity-only in this phase (existing `PATCH /driver/activities/:id/eta`);
      local items are read-only until Phase 3.
- [ ] Tenant-web driver itinerary view (`features/driver-planning/containers/DriverItinerary/`) —
      **blocked on the identity question:** the dispatcher picker has no link between a longhaul
      driver and a crew. Ship with a picker that selects a `TenantUser` with either id mapped, and
      list unmapped drivers separately. Revisit once labor-crews' phone-keyed people can be used.

### Phase 3 — act facts for driver-posted ETA / arrival / completion

- [ ] Prisma model `ItineraryActFact` (tenant-scoped): `tenantId`, `orderNum`, `actCode`, `day`,
      `sourceKind`, `sourceRef`, `basis` (ESTIMATED | ACTUAL), `value`, arrival window,
      `assertedByUserId`, `capturedBy`, `assertedAt`, `supersedesId`. Keyed on
      (tenant, order, actCode, driver, day) — **not** on a legacy row id, so Phase 4 items can carry
      facts without a row. Append-only; current value = latest non-superseded.
- [ ] `PATCH /onprem/longhaul/me/itinerary/:key/eta` and `/complete` — write the fact, then write
      through to legacy: activity ⇒ existing columns; local job ⇒ `eta_win_*` only for ETA.
      **Completion of a local token does NOT set `is_final`** (the job is per day, the fact is per
      token, and `is_final` fires the `sales.*_actual` trigger for every token). Decide with Steve
      before any write-through of local completion.
- [ ] Itinerary read overlays facts on the legacy dates (fact wins when newer).
- [ ] Mobile: ETA + "done" on local items.

### Phase 4 — deferred: order-assigned source

- [ ] Data audit per tenant: does `sales.driver_id` match `v_longhaul_drivers` or `crews`; how often
      is it just a copy of a local job's `driver_id1`. Go/no-go recorded here before any code.

## Risks

- **Hot files:** `app.ts`, `router.tsx`, `AppShell.tsx`, `schema.prisma` — serialize with any other
  live stream touching them.
- **Id-space collision:** a single numeric driver id must never be matched against both spaces; the
  predicate always binds the two ids separately.
- **Local job addresses are free text;** the derived `place` may be null — the UI must render a
  place-less item.
- **Legacy triggers:** any write to `localdispatchjobs` can fire `TriggerLocalDispatchUpdate` and the
  `TriggerSalesUpdate` back-cascade, whose bodies are not in either repo — read them from the DB
  before Phase 3 writes anything.
- **Mobile release:** Phase 2 needs the API deployed before the EAS build.
