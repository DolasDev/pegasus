# Driver itinerary — remaining: dispatcher view, act facts, order-assigned source

**Status:** COMPLETE — every phase and decision below shipped (2026-11-03). Shipped so far:
Phases 0–1 (probe, `/me/itinerary` + `/drivers/itinerary` API, Services board `include=local`) —
`plans/completed/19ad9517-driver-itinerary.md`; Phase 2 mobile "My Itinerary" —
`plans/completed/64dc360b-itinerary-mobile.md`; local arrival window (#905) —
`plans/completed/baa570a6-local-job-window.md`; local driver scope (decisions 2 + 5) —
`plans/completed/2f8541ab-local-driver-scope.md`. Read them before starting.

**Goal:** dispatchers see a driver's itinerary in tenant-web, and drivers can post ETA / done on
local items too.

## Decisions (Steve, 2026-11-02)

1. **Local "done" (Phase 3): a Pegasus-only fact — DONE.** Record it as an `ItineraryActFact` and show it in
   the itinerary; **never** write `is_final` (it completes every act on the job). Dispatch still
   finalizes the job in legacy. Local ETA (2026-11-03): also a fact only — after reading the
   trigger bodies (an ETA-only write would have been safe; the answer was product). Activity done
   (2026-11-03): a fact only; activity ETA keeps its existing legacy editor.
2. **Widen the driver read scope — DONE** (local-driver-scope): order reads admit orders on the
   caller's local jobs; local items open the shipment screen.
3. **Dispatcher picker: pick a longhaul driver and a crew separately — DONE** (dispatcher-itinerary). Longhaul drivers from the
   existing `/onprem/longhaul/drivers`; crews from a NEW Operations-gated sibling read (do not relax
   `/local-drivers`' `UpdateUser` gate), reusing `listLocalDrivers` from `chat-access.ts`.
4. **Phase 4: go, tenant-agnostic, with a name guard — DONE** (order-assigned-source): an order
   with no activity rows whose `sales.driver_id` is not a local-job copy and whose `driver_name`
   names that longhaul driver.
5. **Mobile edge — DONE** (local-driver-scope): a local crew id alone makes a login a driver.

## Checklist

### Tenant-web driver itinerary view — DONE

- [x] Operations → Itinerary (`features/driver-planning/routes/ItineraryModule.tsx`) on
      `GET /onprem/longhaul/drivers/itinerary`, a longhaul-driver picker and a separate crew picker
      (`GET /onprem/longhaul/local-drivers`, Operations-gated) — `plans/completed/52d2f914-dispatcher-itinerary.md`.

### Phase 3 — act facts for driver-posted ETA / done — DONE

- [x] `ItineraryActFact` + `PUT /onprem/longhaul/me/itinerary/acts/{eta,done}` (ownership re-derived
      per write), attached as `assertion` on both itinerary reads; mobile Done / ETA controls;
      the dispatcher view shows the driver's word — `plans/completed/*-itinerary-act-facts.md`.

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
