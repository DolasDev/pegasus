# Driver itinerary — remaining: dispatcher view, act facts, order-assigned source

**Status:** not started; **blocked on Steve's decisions below.** Shipped so far: Phases 0–1 (probe,
`/me/itinerary` + `/drivers/itinerary` API, Services board `include=local`) —
`plans/completed/19ad9517-driver-itinerary.md`; Phase 2 mobile "My Itinerary" —
`plans/completed/64dc360b-itinerary-mobile.md`. Read both before starting.

**Goal:** dispatchers see a driver's itinerary in tenant-web, and drivers can post ETA / done on
local items too.

## Open decisions for Steve

1. **Local completion write-back (Phase 3):** may a local token's "done" ever write back to legacy?
   `is_final` completes EVERY token on the job via `TriggerLocalDispatchUpdate` (GOTCHAS).
2. **Local items → shipment detail:** should `resolveLonghaulReadScope` (every `/onprem/longhaul/*`
   read) also admit orders on the caller's local jobs (`localDriverEmployeeId` vs
   `LocalDispatchJobs.driver_id1/2`)? Today a local item opens an in-app read-only detail
   (GOTCHAS "A local-job order is invisible to every other `/onprem/longhaul/*` read").
3. **Dispatcher picker:** only `tenant_admin` holds `ListUsers`, so a dispatcher can't load a
   TenantUser picker. Either a new Operations-gated roster route (hot `app.ts`), or pick a longhaul
   driver and a crew separately — `GET /drivers/itinerary` already takes both ids.
4. **Phase 4 audit:** go-ahead for the read-only prod data audit of `sales.driver_id`.
5. **Mobile edge:** `laborAccess.isDriver` = `driver` role OR a longhaul id, so a local-only driver
   with an Operations role but no `driver` role is treated as Operations-only (no itinerary).

## Checklist

### Tenant-web driver itinerary view

- [ ] `apps/tenant-web/src/features/driver-planning/containers/DriverItinerary/` on
      `GET /onprem/longhaul/drivers/itinerary` — picker per decision 3; list unmapped drivers
      separately. Revisit once labor-crews' phone-keyed people can link a driver to a crew.

### Phase 3 — act facts for driver-posted ETA / arrival / completion

- [ ] Prisma model `ItineraryActFact` (tenant-scoped): `tenantId`, `orderNum`, `actCode`, `day`,
      `sourceKind`, `sourceRef`, `basis` (ESTIMATED | ACTUAL), `value`, arrival window,
      `assertedByUserId`, `capturedBy`, `assertedAt`, `supersedesId`. Keyed on
      (tenant, order, actCode, driver, day) — **not** on a legacy row id, so Phase 4 items can carry
      facts without a row. Append-only; current value = latest non-superseded.
- [ ] `PATCH /onprem/longhaul/me/itinerary/:key/eta` and `/complete` — write the fact, then write
      through to legacy: activity ⇒ existing columns; local job ⇒ `eta_win_*` only for ETA.
      **Completion of a local token does NOT set `is_final`** — decision 1.
- [ ] Itinerary read overlays facts on the legacy dates (fact wins when newer).
- [ ] Mobile: ETA + "done" on local items (`ItineraryItemDetail` is where they go).

### Phase 4 — deferred: order-assigned source

- [ ] Data audit per tenant: does `sales.driver_id` match `v_longhaul_drivers` or `crews`; how often
      is it just a copy of a local job's `driver_id1`. Go/no-go recorded here before any code.

## Risks

- **Hot files:** `app.ts`, `router.tsx`, `AppShell.tsx`, `schema.prisma` — serialize with any other
  live stream touching them (`feat/my-crew` has a pending `schema.prisma` migration).
- **Id-space collision:** a single numeric driver id must never be matched against both spaces.
- **Legacy triggers:** any write to `localdispatchjobs` can fire `TriggerLocalDispatchUpdate` and the
  `TriggerSalesUpdate` back-cascade, whose bodies are not in either repo — read them from the DB
  before Phase 3 writes anything.
- **Mobile release:** an EAS build only after the API it needs is deployed.
