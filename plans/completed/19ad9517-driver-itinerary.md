# Driver itinerary — one stopAction-shaped view across trips and local jobs

**Status:** Phases 0–1 SHIPPED (this PR). Phases 2–4 continue in
`plans/todo/driver-itinerary-mobile.md`.

**Branch:** `feat/driver-itinerary` (worktree `../pegasus-driver-itinerary`)
**Goal:** any shipment work assigned to a driver — on a longhaul trip or on a local dispatch job —
loads as one dated itinerary in the tenant-web operations screens and the mobile app, with the trip
reduced to a grouping of that work rather than the entry point to it.

## Context (enough to resume without re-reading the codebase)

Decided in conversation 2026-10-20 → 2026-10-23, against `docs/domain-reference/`:

- **Two sources today, one third deferred.**
  1. `LongDistanceDispatchActivity` (typed by `Longhaul_ActivityType`). One row = one act for one
     order, optionally on `TripMaster`. Driver = `assigned_driver_id` OR `TripMaster.driver_id`
     (`v_longhaul_drivers.driver_id` space). In the cloud path activities are only ever INSERTed by
     trip save (`apps/api/src/handlers/longhaul-cloud/trip-save.ts`), so in practice they are always
     on a trip. Dates: `planned_start`/`planned_end`, `estimated_date`, `actual_date`, arrival window
     (`arrival_window_start/_end/_tz`), flags `is_committed`/`is_confirmed`. Address copied onto the
     row. Board date rule = `COALESCE(estimated_date, planned_start)` (#868).
  2. `LocalDispatchJobs` (movemanager's current `LocalDispatchJobOld` shape). One row per order per
     service day per branch. Driver = `driver_id1`/`driver_id2` (`crews.employee_id` space).
     `service_date`, `start_time`/`end_time`, `eta_win_*`, `is_final`, `is_confirmed`,
     `active`/`why_not_active`. The acts are a token string in `services` (PACK, LOAD, RDEL, R19I,
     R19O, SITIN, SITOUT, UNPK, CTN, LOPU, XPU, XDEL …; `services_calc`/`services_more` variants).
     Locations are free text `OriginLocation1/2`, `DestinationLocation1/2` + `service_at_orig/dest`.
     **No actual date on the job** — `is_final='Y'` fires `TriggerLocalDispatchUpdate`, which
     substring-matches `services` and stamps `sales.*_actual`.
  3. **Deferred (Phase 4):** order-level driver on `sales` (`driver_id`/`driver_name`/`haul_id`,
     `load_driver`, `driver2_id`). Muddy because `TriggerLocalDispatchUpdate` copies a local job's
     `driver_id1` (crew space) into those columns on confirm — so reading them double-counts source 2
     and the id space is ambiguous — and the items would be in-memory templates with no row to
     write an ETA against. Pegasus reads none of these columns today.
- **Driver identity.** `TenantUser.longhaulDriverId` + `TenantUser.localDriverEmployeeId`
  (`apps/api/prisma/schema.prisma`, admin-set, `apps/api/src/handlers/users.ts`). The id spaces
  collide on different people at some tenants (GOTCHAS, "Crew number ≠ driver number is
  tenant-specific"); id 0 = unassigned. `apps/api/src/lib/chat-access.ts` already unions both
  sources with this pair and fails closed — **reuse its predicate shape, do not re-derive it.**
- **DR shape.** A `stopAction` is the join (one act × one shipment × one stop) and carries no dates;
  dates are act assertions at a basis (PLANNED / COMMITTED / ESTIMATED / ACTUAL) with the stop and
  trip in `context[]`. A stop is _a visit to one place at one position in one trip_ — for the
  itinerary it is **derived** (group by day + place), never stored. SIT is a `stay`, not a
  stopAction (A5 §3.3): SITIN/SITOUT/WHSE rows are shown, flagged `kind: 'storage'`.
- **What the trip keeps:** grouping, driver assignment, settlement roll-up
  (`lib/longhaul-cloud-trip-summary.ts`), the finalize guard. Nothing in the itinerary requires it.

## The row (Phase 1 contract)

```ts
type ItinerarySource =
  | { kind: 'longhaul-activity'; activityId: number }
  | { kind: 'local-job-token'; jobId: number; token: string }
// Phase 4 adds { kind: 'order-assigned'; orderNum: number; actCode: string }

interface ItineraryItem {
  key: string // stable: `${source.kind}:${id}[:${token}]`
  source: ItinerarySource
  orderNum: number
  shipperName: string | null
  actCode: string // normalized shared code (PACK, LOAD, RDEL, …)
  actName: string
  kind: 'act' | 'storage' // SITIN / SITOUT / WHSE → 'storage'
  side: 'origin' | 'destination' | 'neither'
  place: { street; unit; city; state; zip } | null
  day: string // YYYY-MM-DD — the itinerary date rule below
  planned: { start: string | null; end: string | null }
  estimated: string | null
  actual: string | null
  arrivalWindow: { start; end; tz } | null
  committed: boolean
  confirmed: boolean
  tripId: number | null // null for local jobs
  driverRef: { longhaulDriverId: number | null; localDriverEmployeeId: number | null }
}
```

**Date rule (one, stated):** `day = actual ?? estimated ?? planned_start` for activities;
`day = service_date` for local-job tokens. Range filter is inclusive whole days on `day`, never an
overlap test (`planned_end < planned_start` is legitimate, #619/#622).

## Checklist

### Phase 0 — confirm before coding

- [ ] `git fetch && git pull` in the worktree; record branch at top of this file (done above).
- [ ] Read `LocalDispatchJobs` columns on the dev/QA tenant DB (`INFORMATION_SCHEMA.COLUMNS`) and
      confirm: `services` token separator, `service_date` type, `eta_win_*` shape, address columns,
      `active`/`why_not_active` values. Record findings here. **Stop and ask if the shape differs
      from the Context section.**
- [~] **Source finding (movemanager `Sale.vb` `LocalDispatchJobServicesFor{RVS,RMS,NW,QMM}`):** the
  generated `services` string is **space-separated** tokens (`Tmp & " " & Item`, trimmed); QMM
  joins its own + sister-agency strings with one more space. Generated vocabulary (20): PACK, WP,
  LOAD, ALD, LOPU, R19I, XPU, OVPU, CTN, RDEL, ADEL, UNPK, XDEL, DBR, R19O, OVDEL, SITIN, SITOUT,
  PIER, RTG. Longhaul activity codes shared with it: PACK, LOAD, XPU, R19I, R19O, SITIN, SITOUT,
  RDEL, UNPK, XDEL. Local-only: WP, ALD, LOPU, OVPU, CTN, ADEL, DBR, OVDEL, PIER, RTG. Users can
  edit the string (`services_more`), so the prod sample must check for non-space separators and
  unknown tokens.
- [x] **Prod check — done 2026-10-25** (read-only, `scripts/probe-local-dispatch-jobs.ts`, Steve's
      go-ahead; NW, QMM, RVS all reached). Last 90 days by `service_date`:

      | | NW | QMM | RVS |
      |---|---|---|---|
      | jobs | 2,213 | 2,154 | 764 |
      | with a driver | 2,015 | 1,437 | 698 |
      | inactive (`active='N'`) | 130 | 213 | 64 |
      | `is_final='Y'` | 1,925 | 1,437 | 230 |
      | empty `services` | 25 | 106 | 35 |
      | `OriginLocation1` filled | 160 | 0 | 0 |
      | `service_at_orig='Y'` / `_dest='Y'` | 1,048 / 1,034 | 708 / 734 | 475 / 312 |

      **Decisions this forces (recorded so Phase 1 doesn't re-derive them):**
      - **Split in JS, not SQL.** `STRING_SPLIT` is unavailable on all three (compat level < 130).
        Separator is always whitespace; no other characters seen. RVS has trailing-space padding.
      - **Dedupe tokens per job.** Repeats are common and mirrored (`PACK R19I R19I PACK`,
        `RDEL SITOUT RDEL`, `PACK WP LOAD SITIN WP LOAD PACK`) — the string is a concatenation, not a
        count. One item per *distinct* token per job.
      - **Hand-entered tokens exist** outside the generator's 20: `WHSE` (QMM 283 jobs alone — maps to
        the `WHSE` activity type), `MILE`, `MEET`. Unknown tokens become items with
        `actCode = token`, `actName = token`, `known: false` — shown, never dropped.
      - **Empty `services` (25/106/35) still means a driver has work that day** → emit one item with
        `actCode = null`, labelled "Local job".
      - **Place comes from the order, not the job.** The job's location text is ~never filled
        (NW 7 %, QMM/RVS 0 %). Place = order origin for origin-side tokens, order destination for
        destination-side tokens, `null` for warehouse/storage/unknown (WHSE, SITIN, SITOUT, MILE,
        DBR). When `OriginLocation1`/`DestinationLocation1` IS filled (NW only) it is a free-text
        line shown as `placeNote`, not parsed.
      - **Side** = the tenant's `Longhaul_ActivityType.isPerformedAtOrigin/Destination` for shared
        codes; a static map for local-only codes (WP, ALD, LOPU, OVPU, CTN → origin; ADEL, OVDEL →
        destination; DBR, MILE, MEET, PIER, RTG → neither).
      - **A local job DOES have an actual**: `is_final='Y'` is what fires
        `TriggerLocalDispatchUpdate` to stamp `sales.*_actual = service_date`, so the itinerary reads
        `actual = service_date` when `is_final='Y'` (NW 87 % of jobs).
      - **Activity types are per tenant and differ**: QMM has 16 (adds SOIN, SOOUT, DEPARTURE, ARRIVAL,
        CLEARANCE) and `isHasETA` differs (QMM PACK/LOAD have ETA, NW's don't). Read
        `Longhaul_ActivityType` per request (it's tiny); never hard-code names or flags.
      - **Up to 2 jobs per order per day** (two branches / crews) — the item key includes the job id.

- [x] Confirm token → activity-type code mapping per tenant — see above.

### Phase 1 — itinerary read model + API + Services board local rows

- [x] `apps/api/src/lib/itinerary/types.ts` — `ItineraryItem`, `ItinerarySource`. Deviation from
      the sketch above: `driverRef` became `drivers: { longhaul: number[]; local: number[] }` (a job
      has two slots), and items carry `known`, `placeNote` and `sequence`.
- [x] `apps/api/src/lib/itinerary/values.ts` — shared normalizers (`day`, `text`, `flag`, `realId`,
      `wallClock`) + `STORAGE_CODES` / `UNKNOWN_SEQUENCE`.
- [x] `apps/api/src/lib/itinerary/local-job-tokens.ts` + test (16) — every Phase 0 decision above is
      a test. Local-only code names/sides/sequences live in `LOCAL_ONLY_CODES`; the tenant catalog
      wins over it. ETA window = `eta_minimum`/`eta_maximum` wall clock, `tz: null`.
- [x] `apps/api/src/lib/itinerary/longhaul-activity-rows.ts` + test (8).
- [x] `apps/api/src/lib/itinerary/fetch.ts` + test (10) — **one executor call**, a multi-statement
      batch read through `recordsets` (the account Lambda concurrency cap is 10, and every executor
      invoke holds a slot). On batch failure it re-runs statement by statement so one bad source is
      isolated (`failed` in the result); a failed catalog only costs names/sequences. Activities are
      read with `a.*` (the arrival-window columns exist only on some tenants) with `it_`-prefixed
      extras (#575). `sales` via `OUTER APPLY (SELECT TOP 1 …)`; destination street =
      `consignee_name1/2` (#569).
- [x] ~~Driver predicate: extract from `chat-access.ts`~~ — **dropped, deliberately.** The rules
      differ: chat lets a driver read an order when ANY activity on it is theirs by assignment OR
      trip (`a.assigned_driver_id = @lh OR t.driver_id = @lh`); the itinerary lists only acts the
      driver OWNS — the ETA editor's rule (`lib/longhaul-driver-activity.ts`: assigned driver, else
      the trip driver when unassigned). Sharing one predicate would change one of them. chat-access
      is untouched; the itinerary reuses `legacyConnectionString` from it (the handler may not import
      the base Prisma client — db-access-guard).
- [x] `apps/api/src/handlers/longhaul-cloud/itinerary.ts` + test (17): - `GET /onprem/longhaul/me/itinerary?from&to` — the caller's TenantUser id pair; neither ⇒
      **403 `DRIVER_NOT_MAPPED`** (the ETA editor's code; there is no `not_linked` code in mobile). - `GET /onprem/longhaul/drivers/itinerary?from&to&longhaulDriverId&localDriverEmployeeId` —
      Operations roles only (403 otherwise), at least one id. - Range ≤ 31 days, inclusive, calendar-day round-trip validation (Feb 30 rejected). - 422 `MSSQL_NOT_CONFIGURED`; 503 `LEGACY_UNAVAILABLE` when every source asked for failed; 200
      with `meta.failedSources` when one did; 400 `RESULT_LIMIT_EXCEEDED` over the cap.
- [x] Routes registered in `apps/api/src/app.ts` beside `/onprem/longhaul/activities`.
- [x] ~~Handler integration tests against Postgres~~ — not needed: nothing here touches Postgres
      beyond the TenantUser read, which is mocked at the `c.get('db')` seam as activities-list's
      tests do.
- [x] Services board — `GET /onprem/longhaul/activities?include=local`: - API: `lib/itinerary/services-board-local.ts` + test (11) builds the local-jobs statement and
      maps each token to the board's `ActivityRow` keys (+ `row_key`, `source`). It goes in the SAME
      batch as the activities query and the catalog (one executor call), then the merged list is
      re-sorted in JS on the same keys (`BOARD_SORT_FIELDS`, pinned to `ACTIVITY_SORT_KEYS` by a
      test; NULL-first ascending like SQL Server). The 1000 cap counts the merged total. - Honoured **only for Operations callers** (`scope.kind === 'all'`): a driver-scoped caller is
      scoped by their longhaul id there, and their local work is on `/me/itinerary`. - **Flag off ⇒ the handler is byte-identical to before** (its existing SQL-pinning tests did
      not move); 4 new handler tests. - Filters: date on `service_date`; short haul / dispatcher through the same
      `v_longhaul_shipments_v2` join (a local-only order drops out when either is set — it has no
      dispatcher or haul mode to match); activity type by ABBREVIATION, applied in JS after the
      split. Driver name = `crews` first + last for both slots (`A / B`). Status = `Final` /
      `Confirmed` / none. - tenant-web: `include=local` is a top-level param (`routes.ts` `args[1]`), NOT a filter, so a
      saved Services filter (strict v1 schema) never carries it; `includeLocal` lives beside
      `query` in the activities slice (default **off**), toggled by a "Local jobs" checkbox that
      Clear doesn't count. The card keys by `row_key ?? id` and shows a **Local** badge where a
      longhaul row has its trip link.
- [x] **Trip status** (advisor catch): activities on a **Pending** trip or a **cancelled** one
      (`internal_status = 'canceled'`) are left out of the itinerary — the driver app's own rule
      (`mobile tripService.isVisibleTrip`). **Offered** trips stay in; items carry `tripStatus` so
      the client can mark them. A trip-less activity is unaffected.
- [x] **Same-day order** (advisor catch): `compareItems` = day → act sequence → order; trip is not a
      sort key, so a local 8 am PACK doesn't sink under a longhaul RDEL. Pinned by a test.
- [x] ~~OpenAPI entries~~ — **not added, on precedent:** no `/onprem/longhaul/*` route is in the
      spec (it documents the SDK-facing m2m surface; these are Cognito-only `v1` routes, which the
      coverage test does not scan). Revisit if itinerary becomes an SDK surface.

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

### Close-out

- [x] `PATTERNS.md` "A driver's work across longhaul and local — the itinerary, not the trip";
      `GOTCHAS.md` "A local dispatch job's `services` is a concatenation…".
- [x] Archived to `plans/completed/` in the Phase 1 PR; Phases 2–4 split to `plans/todo/`.

## Files

**Created (Phase 0–1):** `scripts/probe-local-dispatch-jobs.ts`;
`apps/api/src/lib/itinerary/{types,values,local-job-tokens,longhaul-activity-rows,fetch,services-board-local}.ts`
(+ tests for all but `types`/`values`); `apps/api/src/handlers/longhaul-cloud/itinerary.ts` (+ test).

**Modified (Phase 1):** `apps/api/src/app.ts` (two routes);
`apps/api/src/handlers/longhaul-cloud/activities-list.ts` (+ test) (`include=local`);
tenant-web `features/driver-planning/`: `utils/api/{index,routes}.ts` (+ routes test),
`redux/activities/index.ts` (+ test), `containers/Activities/index.tsx`,
`containers/Activities/components/ActivityCard/{index.tsx,ActivityCard.module.css}` (+ test),
`containers/Activities/components/ActivityFilters/index.tsx` (+ test). **Not touched:**
`lib/chat-access.ts` (only imported).

**Do NOT commit:** `apps/e2e/.env.test` — the worktree script rewrote it for this worktree's
isolated Postgres; it shows as modified but is not part of this change.

**Still to create (Phase 2+):** `apps/mobile/src/services/itineraryService.ts` (+ test),
`apps/mobile/app/(drawer)/itinerary.tsx`, the drawer entry in `apps/mobile/app/(drawer)/_layout.tsx`;
`apps/tenant-web/src/features/driver-planning/containers/DriverItinerary/` (blocked, see Phase 2);
Prisma model + migration (Phase 3).

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
