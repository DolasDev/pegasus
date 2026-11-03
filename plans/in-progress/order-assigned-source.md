# Itinerary Phase 4 — the order-assigned source (`sales.driver_id`)

**Status:** SHIPPED (this PR). **Branch:** `feat/order-assigned-source` (worktree `../pegasus-order-assigned-source`).
Part of `plans/todo/driver-itinerary-mobile.md` (Phase 4). Read
`plans/completed/19ad9517-driver-itinerary.md` (row contract) first.

## Audit (read-only, prod executor, 2026-11-03) — the go/no-go record

`sales.driver_id`, orders with `load_date` in −180..+60 days:

|                                             | NW    | QMM   | RVS |
| ------------------------------------------- | ----- | ----- | --- |
| Orders                                      | 4,420 | 1,906 | 743 |
| …with a `driver_id`                         | 3,471 | 1,505 | 1   |
| …id valid in BOTH spaces (longhaul + crew)  | 3,127 | 634   | 0   |
| …equals a local job's driver (trigger copy) | 1,149 | 276   | 0   |
| …equals the longhaul activity owner         | 1,893 | 0     | 0   |
| …covered by neither existing source         | 469   | 1,229 | 1   |
| Longhaul activities in the window           | 6,695 | 0     | 0   |

QMM and RVS do not use `LongDistanceDispatchActivity` at all — for QMM `sales.driver_id` is the
ONLY record of the longhaul driver.

Candidates (a `driver_id`, NO activity rows, not a local-job copy), and whether `sales.driver_name`
(`LAST, FIRST # phone`, cut at ` #`) equals that id's longhaul driver name
(`v_longhaul_drivers.DRIVER_NAME`, cut at ` (`), compared upper-case without spaces:

|                                                | NW  | QMM   | RVS |
| ---------------------------------------------- | --- | ----- | --- |
| Candidates                                     | 275 | 1,241 | 1   |
| name = that id's longhaul driver               | 236 | 1,206 | 0   |
| …also a crew with that id + name (same person) | 152 | 247   | 0   |
| name = crew only, not the longhaul driver      | 2   | 0     | 0   |
| name = neither                                 | 37  | 35    | 1   |

`sales.driver_name` is a copy of the longhaul driver's name, so it settles the id space.

## Decisions (Steve, 2026-11-03)

- "Can this be done regardless of tenant but only where the shipment does not already have the
  activity rows?" → yes, with the name guard ("Go, with the name guard").
- **Rule — an order is order-assigned to longhaul driver D when ALL hold:** (1) the order has NO
  `LongDistanceDispatchActivity` rows; (2) `sales.driver_id` is not a copy of a local job's driver on
  the order (`driver_id1/2` — the ONE deliberate cross-space comparison: it detects the trigger's
  copy); (3) `driver_name` matches D's `v_longhaul_drivers` name. Every tenant; no flag.
- Acts = the canonical required acts (`lib/longhaul-build-activities.ts`, what trip save creates):
  PACK (`pack_date2`/`plan_pack`, no rule19), LOAD (`load_date2`/`plan_load`) or R19O
  (`rule19_out_date`) when `rule19_id`, RDEL (`del_date2`/`plan_del`). Actuals `pack_actual`,
  `load_actual`, `del_actual` (the view has no `rule19_out_act` ⇒ R19O actual null).
  `day = actual ?? plannedStart`. Read-only (no row to post an ETA on until Phase 3's facts).

## Design

- ONE shared SQL fragment `orderAssignedTo(alias, param)` (new `lib/itinerary/order-assigned.ts`),
  used by BOTH the itinerary read (`fetch.ts`, third statement in the batch when the longhaul id is
  set) and the shipment order scope (`shipments-list.ts` — a third OR'd EXISTS on the longhaul id),
  so an order-assigned item opens its shipment screen. Pinned by SQL tests in both.
- Read from `v_longhaul_shipments_v2` (its row filter; carries every date + address column).
- Range filter per act day (`COALESCE(actual, planned2, plan)` BETWEEN for PACK / LOAD / RDEL).
- Source kind `{ kind: 'order-assigned'; orderNum; actCode }`, key
  `order-assigned:<orderNum>:<actCode>`; mapper `order-assigned-rows.ts` (+ test). Catalog
  statement joins the batch whenever an order-assigned statement runs (names / sides / sequences).
- `/drivers/itinerary` gets the source for free. The Services board does NOT (scoped out).
- Mobile: `types/itinerary.ts` gains the kind; an "Order" tag; opens the shipment screen.
- Chat (`chat-access.ts`) does NOT admit these orders — a known gap, not widened here.

Prototype timing (31-day window, prod): all drivers 1.1–1.8 s; one driver 250–430 ms. QMM's
busiest id 66666 is "Tor Crew, Local Toronto" — a crew-pool pseudo-driver; harmless (no login maps
to it).

## Checklist

- [x] `lib/itinerary/order-assigned.ts` — fragment `orderAssignedTo`, statement, and the mapper
      `orderAssignedItems` (reuses `buildShipmentActivities`) in one module + test (10).
- [x] `types.ts` source kind; `fetch.ts` third statement + `failedSources` `'order'`; tests.
- [x] `shipments-list.ts` order scope third condition + SQL tests.
- [x] Mobile type + tag + test.
- [x] Live checks (harness → this worktree's code, 31 days, prod read-only, 2026-11-03):
      QMM drivers 5497 / 5832 / 72511 — 22 / 20 / 8 items, all order-assigned (their only source),
      374–531 ms, PACK / LOAD / "Dock Load" (R19O) / RDEL with places + actuals. NW 14372 / 2714 /
      886 — 31 / 17 / 15 items, 236–295 ms. NW 134 (mixed) — 7 activity + 4 order-assigned, no
      duplicate (order, act); NW 17698 (mapped logins) unchanged at 18. No failed source, no cap.
      Also: the batch now always carries the catalog (order-assigned acts need names/sides), and
      the handler counts a longhaul id as TWO sources for its 503 rule.
- [x] `/security-review` (scope change); GOTCHAS / PATTERNS.
