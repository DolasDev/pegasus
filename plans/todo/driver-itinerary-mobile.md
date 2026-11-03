# Driver itinerary — remaining: dispatcher view, act facts, order-assigned source

**Status:** decisions made 2026-11-02 (below); being built as separate workstreams. Shipped so far:
Phases 0–1 (probe, `/me/itinerary` + `/drivers/itinerary` API, Services board `include=local`) —
`plans/completed/19ad9517-driver-itinerary.md`; Phase 2 mobile "My Itinerary" —
`plans/completed/64dc360b-itinerary-mobile.md`; local arrival window (#905) —
`plans/completed/baa570a6-local-job-window.md`; local driver scope (decisions 2 + 5) —
`plans/completed/2f8541ab-local-driver-scope.md`. Read them before starting.

**Goal:** dispatchers see a driver's itinerary in tenant-web, and drivers can post ETA / done on
local items too.

## Decisions (Steve, 2026-11-02)

1. **Local "done" (Phase 3): a Pegasus-only fact.** Record it as an `ItineraryActFact` and show it in
   the itinerary; **never** write `is_final` (it completes every act on the job). Dispatch still
   finalizes the job in legacy. Local **ETA** write-back to legacy was NOT asked — ask at Phase 3's
   start, after reading the `TriggerLocalDispatchUpdate` / `TriggerSalesUpdate` bodies.
2. **Widen the driver read scope — DONE** (local-driver-scope): order reads admit orders on the
   caller's local jobs; local items open the shipment screen.
3. **Dispatcher picker: pick a longhaul driver and a crew separately.** Longhaul drivers from the
   existing `/onprem/longhaul/drivers`; crews from a NEW Operations-gated sibling read (do not relax
   `/local-drivers`' `UpdateUser` gate), reusing `listLocalDrivers` from `chat-access.ts`.
4. **Phase 4: go, tenant-agnostic, with a name guard — DONE** (order-assigned-source): an order
   with no activity rows whose `sales.driver_id` is not a local-job copy and whose `driver_name`
   names that longhaul driver.
5. **Mobile edge — DONE** (local-driver-scope): a local crew id alone makes a login a driver.

## Checklist

### Tenant-web driver itinerary view

- [ ] `apps/tenant-web/src/features/driver-planning/containers/DriverItinerary/` on
      `GET /onprem/longhaul/drivers/itinerary` — picker per decision 3 (driver + crew, each
      optional, at least one). Revisit once labor-crews' phone-keyed people can link a driver to a crew.

### Phase 3 — act facts for driver-posted ETA / arrival / completion

- [ ] Prisma model `ItineraryActFact` (tenant-scoped): `tenantId`, `orderNum`, `actCode`, `day`,
      `sourceKind`, `sourceRef`, `basis` (ESTIMATED | ACTUAL), `value`, arrival window,
      `assertedByUserId`, `capturedBy`, `assertedAt`, `supersedesId`. Keyed on
      (tenant, order, actCode, driver, day) — **not** on a legacy row id, so Phase 4 items can carry
      facts without a row. Append-only; current value = latest non-superseded.
- [ ] `PATCH /onprem/longhaul/me/itinerary/:key/eta` and `/complete` — write the fact, then write
      through to legacy: activity ⇒ existing columns; local job ETA ⇒ `eta_minimum` /
      `eta_maximum` / `eta_win_minutes` ONLY if Steve agrees (decision 1 note); local completion
      ⇒ fact only, never `is_final` (decision 1).
- [ ] Itinerary read overlays facts on the legacy dates (fact wins when newer).
- [ ] Mobile: ETA + "done" on local items (the read-only `ItineraryItemDetail` sheet was removed
      when local items started opening the shipment screen — design the controls fresh).

### Phase 4 — order-assigned source — DONE

- [x] Audit + go (tenant-agnostic, with the name guard) and the source itself —
      `plans/completed/af79576b-order-assigned-source.md`.

## Risks

- **Hot files:** `app.ts`, `router.tsx`, `AppShell.tsx`, `schema.prisma` — serialize with any other
  live stream touching them (`feat/my-crew` has a pending `schema.prisma` migration).
- **Id-space collision:** a single numeric driver id must never be matched against both spaces.
- **Legacy triggers:** any write to `localdispatchjobs` can fire `TriggerLocalDispatchUpdate` and the
  `TriggerSalesUpdate` back-cascade, whose bodies are not in either repo — read them from the DB
  before Phase 3 writes anything.
- **Mobile release:** an EAS build only after the API it needs is deployed.
