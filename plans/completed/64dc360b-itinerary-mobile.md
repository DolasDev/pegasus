# Driver itinerary — Phases 2–4 (mobile, act facts, order-assigned source)

**Status:** Phase 2 mobile SHIPPED (this PR, branch `feat/itinerary-mobile`; the slug was
shortened because `driver-itinerary-mobile` hashed to a live worktree's Postgres port). The
tenant-web view and Phases 3–4 were NOT started; they continue in
`plans/todo/driver-itinerary-mobile.md`, blocked on the open decisions below. Phases 0–1:
`plans/completed/19ad9517-driver-itinerary.md`.

**Branch:** `feat/itinerary-mobile`.
**Goal:** the mobile app opens on the driver's itinerary — longhaul activities and local job acts
together — and drivers can post ETA / done on local items too.

**API already live:** `GET /api/v1/onprem/longhaul/me/itinerary?from&to` (≤ 31 days, inclusive) →
`{ data: ItineraryItem[], meta: { count, from, to, failedSources } }`; 403 `DRIVER_NOT_MAPPED`
when the login has neither driver id. Type: `apps/api/src/lib/itinerary/types.ts`.

**Decided:** the itinerary sits **beside** My Trips in the drawer (the plan's default; not asked).

**Open decisions for Steve:**

- Phase 3: may a local token's "done" ever write back to legacy? (`is_final` completes EVERY token
  on the job via `TriggerLocalDispatchUpdate`; see GOTCHAS.)
- Local items → shipment detail: should `resolveLonghaulReadScope` (every `/onprem/longhaul/*`
  read) also admit orders on the caller's local jobs (`localDriverEmployeeId` vs
  `LocalDispatchJobs.driver_id1/2`)? Until then a local item opens an in-app read-only detail.
- Tenant-web dispatcher itinerary: the TenantUser picker needs a roster route Operations may call
  (only `tenant_admin` holds `ListUsers`) — a new `app.ts` route, or pick a longhaul driver and a
  crew separately (both ids are already accepted by `GET /drivers/itinerary`)?
- Phase 4: go-ahead for the read-only prod data audit of `sales.driver_id`.

**Order of work:** the mobile EAS build only after the API it needs is deployed
(project memory, mobile driver app).

## Checklist

### Phase 2 — mobile itinerary

- [x] `apps/mobile/src/services/itineraryService.ts` (+ test) — `GET /me/itinerary` via
      `fetchPaginated` (plain `fetch` drops `meta`, and `meta.failedSources` drives the
      partial-list banner). Row contract copied to `src/types/itinerary.ts`.
- [x] `apps/mobile/src/utils/itinerary.ts` (+ test) — 7-day inclusive window paged by week
      (calendar arithmetic, no device zone), day → stop grouping (same normalized address; a
      place-less item groups by `placeNote`, else "No address"), labels.
- [x] `apps/mobile/app/(drawer)/itinerary.tsx` (+ `__tests__/app/(drawer)/itinerary.test.tsx`) —
      SectionList by day; a stop card per derived stop; trip chip (with status badge, Offered
      highlighted) → `/trip/:id`. **Deviation:** a longhaul act opens `shipment/[orderNum]`, but a
      **local** act opens `src/components/ItineraryItemDetail.tsx` (read-only, from the row) —
      the shipment screen reads `/onprem/longhaul/shipments`, whose driver scope is longhaul
      activities only, so a local-only order would be refused (GOTCHAS). Onboarding state keys off
      the itinerary's own 403 `DRIVER_NOT_MAPPED`, **not** `useTrips().driverId` (`/me/driver`
      knows only the longhaul id, so a local-only driver would look unmapped).
- [x] Drawer entry "My Itinerary" beside My Trips; hidden for Operations-only users and added to
      the `_layout.tsx` Operations-only redirect. Known edge: `laborAccess.isDriver` = `driver`
      role OR a longhaul id, so a local-only driver who holds an Operations role but not `driver`
      is treated as Operations-only and doesn't see the itinerary.
- [x] ETA editing stays activity-only (on the trip screen); local items are read-only.
- [x] Loads are last-request-wins (a request id ref): paging weeks during a retry or a
      pull-to-refresh can't land the old week under the new range (pinned by a test).
- [x] `src/components/__tests__/ItineraryItemDetail.test.tsx`.
- [ ] Tenant-web driver itinerary view (`features/driver-planning/containers/DriverItinerary/`) —
      **blocked on the identity question:** the dispatcher picker has no link between a longhaul
      driver and a crew. Ship with a picker that selects a `TenantUser` with either id mapped, and
      list unmapped drivers separately. Revisit once labor-crews' phone-keyed people can be used.
      **Deferred out of this PR:** only `tenant_admin` holds `ListUsers`, so a dispatcher can't
      load the picker — see the open decision above.

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
