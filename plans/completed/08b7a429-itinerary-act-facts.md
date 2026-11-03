# Itinerary Phase 3 — driver-posted ETA and "done" as act facts

**Status:** SHIPPED (this PR). **Branch:** `feat/itinerary-act-facts` (worktree `../pegasus-itinerary-act-facts`).
Part of `plans/todo/driver-itinerary-mobile.md` (Phase 3) — the last item there.

**Goal:** a driver can post an ETA and mark an act done from My Itinerary, for every kind of item,
and the dispatcher sees it in Operations → Itinerary — without Pegasus writing legacy dates.

## Decisions (Steve)

- 2026-11-02 — local "done": a Pegasus fact; never `is_final` (it completes every token on the job).
- 2026-11-03 — local ETA: a Pegasus fact; legacy keeps the dispatcher's customer-facing ETA. (Read
  first: `TriggerLocalDispatchUpdate` acts only under `IF UPDATE(is_final)` / `IF UPDATE(is_confirmed)`
  on NW and QMM, so an ETA-only write WOULD be safe — the answer was product, not safety.)
- 2026-11-03 — longhaul activity "done": a Pegasus fact; never `actual_date` (settlement roll-up,
  finalize guard, Services board). Activity ETA keeps its EXISTING legacy editor
  (`PATCH /driver/activities/:id/eta`, trip screen) — no second ETA store for an activity.

## Design (deviations from the old plan text, with reasons)

- **Key = the item's `key`** (`longhaul-activity:<id>` / `local-job-token:<job>:<token>` /
  `order-assigned:<order>:<act>`), not (order, actCode, driver, day): a day can hold two local jobs
  for one order with the same token (why the item key carries the job id), and both drivers on a
  two-driver job see the same act. `orderNum`, `actCode`, `sourceKind` are stored denormalized.
- **Append-only, no `supersedesId`:** the latest `assertedAt` per (item, basis) wins; a null value
  clears.
- **Attach, don't overlay:** legacy `day` / `estimated` / `actual` stay legacy; items gain
  `assertion: { eta: {day, window} | null, done: day | null, assertedAt, byUserId } | null`.
  Overlaying `day` would make an ETA moved to another week vanish from BOTH weeks (the SQL filters on
  legacy dates). Known limit: an item is listed on its legacy day; the assertion shows the new one.
- **Writes re-derive ownership, fail closed:** the body carries the item's legacy `day`; the handler
  runs `fetchItinerary` for the caller's own ids over `[day, day]` and refuses unless the key is
  there (for order-assigned items this is the only ownership check that exists).

## Checklist

- [x] Prisma `ItineraryActFact` (tenant-scoped, in the scoped-model list) + migration
      `20261103213336_itinerary_act_facts` (additive: one table, one index, two FKs).
- [x] `lib/itinerary/act-facts.ts` — `assertionFrom` / `attachAssertions` / `recordFact` + test (5,
      3 against real Postgres via `createTenantDb`, incl. tenant isolation for the same key).
- [x] `PUT /onprem/longhaul/me/itinerary/acts/eta` and `/acts/done` + tests: 404 for a key not on the
      caller's own itinerary that day, 503 (nothing recorded) when a source can't be read, 409
      `USE_ACTIVITY_ETA`, 403 unmapped, 400 bad key/day/window; clear with null.
- [x] `/me/itinerary` and `/drivers/itinerary` attach `assertion` (a failed fact read degrades to
      none — it never costs the itinerary).
- [x] Mobile: types; `ItineraryService.setEta/setDone`; an actions line per act (Mark done / Undo
      done, ETA / Change ETA — a trip activity's ETA opens its trip; no buttons on a legacy-done
      act); `ItineraryEtaModal` (day stepper, optional 30-min window); an alert on a failed write.
- [x] tenant-web: types; `driverAssertionLabel` badge ("Driver: done …" / "Driver ETA …").
- [x] `/security-review` (writes + ownership): no HIGH/MEDIUM. Checked: ownership (ids only from the
      caller's TenantUser; exact key match in the caller-scoped fetch; a chosen `day` only picks which
      of the caller's own days to search; fail closed), tenant scoping (`middleware/tenant.ts` sets the
      scoped client; the model is in `TENANT_SCOPED_MODELS`; `tenantId` from auth), mass assignment
      (zod strips; `capturedBy` / `assertedById` server-set), injection (Prisma + the existing
      parameterised read). Noted, by design: co-drivers on one local job share a key, so either may
      overwrite the other's fact, and `byUserId` then shows the co-driver's opaque id.
- [x] GOTCHAS ("`TriggerLocalDispatchUpdate` fires on EVERY job update…"), PATTERNS ("A driver's word
      on legacy work is an attached fact…"); the todo plan is COMPLETE and archived with this PR.
