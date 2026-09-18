---
source: src:pegii-longhaul
analyzed: 2026-09-17
evidence_grade: A
material: |
  Read in full (legacy Electron + NestJS planner, ~/repos/longhaul):
    server/modules/trips/model/{trip.abstract,trip.entity,trip-status.abstract,trip-status.entity,notes.abstract,notes.entity}.ts
    server/modules/activities/model/{activity.abstract,activity.entity,extraLocation.pegasusShadow.entity}.ts
    server/modules/activityTypes/model/{activityType.abstract,activityType.entity}.ts
    server/modules/shipments/model/{shipment.abstract,shipment.entity,shipment.interface,weight.abstract,weight.entity,coverage.abstract,coverage.entity,shipment.pegasusShadow.entity}.ts
    server/modules/shipments/model/migrate/shipment_v2.view.ts
    server/modules/{drivers,zones,states,move-type,filters,user}/model/*.ts
    server/modules/trips/trip.service.ts (484 lines), server/modules/activities/activity.service.ts (689 lines)
    server/migrations/{CreateTripMaster,CreateShipmentActivity,Longhaul_ActivityType,TripMasterStatuses,MasterZones}.sql
    src/common/trip-status.ts, src/utils/{tripstatus-list,haulmode-list,movetype-list,shaul-list,haul-mode-mapping}.js
    config/clients/nwi.js
  Read in full (cloud port, ~/repos/pegasus-domain-reference):
    packages/longhaul-contracts/src/{shipment-view,arrival-window}.ts
    apps/api/src/lib/{longhaul-trip-save,longhaul-build-activities}.ts; heads of
      {longhaul-date-only,longhaul-cloud-trip-summary,longhaul-trip-fetch,longhaul-client-config}.ts;
      longhaul-shipment-enrich.ts lines 1-340
    apps/api/src/handlers/longhaul-cloud/{trips-write,trip-statuses,driver-filter}.ts, plus the
      headers/filter blocks of {trips-list,shipments-list,activities-write,activities-list,
      reference-data,driver-planning,rejected-trips}.ts
    plans/completed/{longhaul-strangler-fig-cloud-migration,5948dc44-activity-arrival-window,
      ec8b8958-daily-dispatch,b42a9a43-trip-save-activities,sit-filter}.md
    apps/tenant-web/.../Trip/components/ActivityGantt/ActivityGantt.tsx (popover + bar regions),
      .../Trip/utils/status-prompt.ts, apps/mobile/src/services/tripService.ts (tail)
  NOT read: the MSSQL databases themselves (PegNW / PegQMM - no live connection from here); the
    upstream pegII `sales` table DDL (the planner only sees it through v_longhaul_shipments_v2);
    the three enabled MSSQL AFTER triggers on LongDistanceDispatchActivity (their bodies were read
    against prod by a human and reported in plan 5948dc44 - I did not read them);
    plans/completed/fe2a6a84-shipment-row-type.md (its conclusions are restated verbatim in the
    header of packages/longhaul-contracts/src/shipment-view.ts, which I did read).
---

# PegII Long Haul (legacy trip planner) and its Cloud port - analysis

## What it is

Our own long-haul trip-planning system, in two layers over one database. The
**legacy** layer (`~/repos/longhaul`) is an Electron desktop client over a
NestJS/TypeORM server writing directly into the tenant's pegII MSSQL (`PegNW`,
`PegQMM` - `config/clients/nwi.js:1`). The **cloud** layer
(`apps/api/src/handlers/longhaul-cloud/`, `packages/longhaul-contracts/`) is a
strangler-fig re-implementation of the same endpoints against the *same* MSSQL
via a VPC-attached `mssql-executor` Lambda; the on-prem tree was deleted in
Phase 5 (`plans/completed/longhaul-strangler-fig-cloud-migration.md:3-10`).

S1 `internal-system`. S2 adoption 3 *within our estate* (it is the production
dispatch system for Nelson Westerberg and Quality Move Management), 0 outside
it. S3 `internal`. S4 evidence grade **A** - the source *is* code and schema,
and I read the entity definitions, both services, the seed DDL, the vocabulary
lists, the contracts package, the write handlers and five design plans.

This is the **only source in our inventory where a trip is not a shipment**, so
it is read here mainly as the A3 witness, with A4/A5 close behind. It is also
the only artifact in which our own code states an activity lifecycle, an
arrival-window time model, and an HHG agent-role set together.

What our reading could **not** see: any live row. Every claim below is about
schema and the code that maintains it, not about the data's actual
distribution - except where a plan file records a production observation (e.g.
337 NWI trips zeroed, `apps/api/src/lib/longhaul-cloud-trip-summary.ts:19`).

## Model summary

Four aggregates, in the source's own nouns.

**Shipment** - one *order*, keyed `order_num`, read through the view
`v_longhaul_shipments_v2` over the pegII `sales` table
(`server/modules/shipments/model/migrate/shipment_v2.view.ts:5-53`). The planner
**never creates a shipment**; it is upstream pegII data joined to `account`,
`salesman` and a packing-coverage row. The planner writes back only a narrow
"shadow": `weight`, `lng_dis_comments`, `operations_id`, `operations_name`
(`shipments/model/shipment.pegasusShadow.entity.ts:12-32`).

**Trip** (`TripMaster`) - a *vehicle journey by one driver*, carrying a status, a
title, roll-up totals and a planned/actual day span
(`trips/model/trip.abstract.ts:8-95`; DDL
`server/migrations/CreateTripMaster.sql:12-35`). A trip has **no direct link to
a shipment**; `Trip.activities` is its only child collection
(`trips/model/trip.entity.ts:44-49`).

**Activity** (`LongDistanceDispatchActivity`) - the join *and* the event record.
One row = "do this one thing, of this type, for this order, at this address, on
this trip" (`activities/model/activity.abstract.ts:10-83`). It carries
`order_num` -> Shipment and `TripMaster_id` -> Trip, so **shipments attach to a
trip only through their activities**. `TripService.getTrip` reconstructs
`trip.shipments` from the distinct `order_num` of the trip's activities and
re-fetches those shipments (`trips/trip.service.ts:82-99`).

**ActivityType** (`Longhaul_ActivityType`) - a small editable catalog of 11
seeded codes with behavioral flags
(`activityTypes/model/activityType.abstract.ts:7-38`;
`server/migrations/Longhaul_ActivityType.sql:12-22`).

```
Shipment(order_num)  --<  Activity  >--  Trip(TripMaster.id)
   (pegII `sales`,           |                 |  driver_id --> Driver
    read-mostly)             |                 +- TripStatus_id --> MasterTripStatus
                             +- ActivityType_code --> Longhaul_ActivityType
                             +- location_id --> shipperaddresses (extra pickup/delivery)
```

Supporting: `Driver` (view `v_longhaul_drivers`, PK `driver_id`, carrying
`agent_code`), `State` (`v_longhaul_states`: `geo_code`/`geo_name`/`zone`),
`Zone` (`v_longhaul_zones`), `Note` (trip-scoped, single type `DISPATCH`),
`ShipmentCoverage` (per-activity-code agent commitment), three
`longhaul_weight_*` tables, and `Filter` (saved planning queries).

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `TripMaster` / "trip" | One driver's journey; owns activities, not shipments | A3 | `server/migrations/CreateTripMaster.sql:12` |
| `trip_title` | Free-text planner label for a trip | A3 | `trips/model/trip.abstract.ts:31` |
| `TripStatus` | Pending, Offered, Accepted, In-Progress, Finalized (ids 1-5) | A3 | `src/common/trip-status.ts:3-9`; seed `migrations/TripMasterStatuses.sql:8` |
| `internal_status` | `active` / `canceled` - cancellation, **orthogonal** to TripStatus | A3 | `trips/model/trip.abstract.ts:3-6,81` |
| "Unplanned" (0) / "Completed" (5) | UI-only labels; 0 has no `MasterTripStatus` row and 5 is the UI's name for Finalized | A3 | `src/utils/tripstatus-list.js:2-25` vs `migrations/TripMasterStatuses.sql:8` |
| `LongDistanceDispatchActivity` / "activity" | A typed task for one order at one address, optionally on a trip | A3/A4 | `migrations/CreateShipmentActivity.sql:11-27` |
| `ActivityType_code` | PACK, LOAD, XPU, R19I, R19O, WHSE, SITIN, SITOUT, RDEL, UNPK, XDEL (+ CFD, CFA in code only) | A4/A5 | seed `migrations/Longhaul_ActivityType.sql:12-22`; code map `activities/activity.service.ts:12-26` |
| `isPerformedAtOrigin` / `isPerformedAtDestination` | Which end of the move a type belongs to | A4 | `activityTypes/model/activityType.abstract.ts:24-28` |
| `isHasETA` | Whether this type can carry an estimated date at all | A4/A5 | `activityType.abstract.ts:33-34` |
| `isCanEditDates` | Whether ops may move this type's planned dates | A4 | `activityType.abstract.ts:30-31` |
| `sequencePriority` | Intended order of types **within one shipment** (PACK 10 ... XDEL 110) | A3 | `migrations/Longhaul_ActivityType.sql:12-22`; sorted at `src/redux/pending-trips/index.js:77` |
| `planned_start` / `planned_end` | The planner's date spread for an activity (calendar days) | A4/A5 | `activities/model/activity.abstract.ts:41-45` |
| `estimated_date` | The ETA - "when we now think it will happen" | A4 | `activity.abstract.ts:32-33` |
| `actual_date` | "Verified Complete" - the day it actually happened | A4 | `activity.abstract.ts:35-36`; label at `ActivityGantt.tsx:388` |
| `is_committed` | "Driver Commitment Made" | A4 | `ActivityGantt.tsx:392`; `activity.abstract.ts:29-30` |
| `is_confirmed` | "Confirmed With Driver" - gates entry of `actual_date` in the UI | A4 | `ActivityGantt.tsx:304,390` |
| `arrival_window_start` / `_end` / `_tz` | The "we'll be there 8-10" spread: **local wall clock `HH:mm` + IANA zone**, all-three-or-none | A4 | `plans/completed/5948dc44-activity-arrival-window.md:104-127` |
| `SITIN` / `SITOUT` | "Delivery into storage in transit" / "Delivery out of storage in transit" | A5 | `migrations/Longhaul_ActivityType.sql:18-19` |
| `whse_date` / `sit_date` | Planned SIT-in / planned SIT-out dates on the shipment | A5 | `activities/activity.service.ts:456,479` |
| `stgindicator` | `STG @ ORIGIN` / `STG @ DESTINATION`, derived from `stg_indicator` O/D | A5 | `shipment_v2.view.ts:30-34` |
| `stg_id` | Storage agent id on the shipment | A5/A8 | `shipments/model/shipment.abstract.ts:181-182` |
| `driver2_id` (`storage_delivery_driver_id`) | The driver of the storage delivery-out leg | A5 | `shipment.abstract.ts:265-266` |
| Rule 19 / `R19I` / `R19O` / `rule19_id` / `rule19_out_date` | "Agent Pickup" (residence -> local agent) and "Dock Load" (load from dock); `rule19_id` present **suppresses** PACK and LOAD | A5/A2 | `migrations/Longhaul_ActivityType.sql:15-16`; `lib/longhaul-build-activities.ts:112-163` |
| `WHSE` | "Services performed at warehouse" - neither origin nor destination flagged | A5 | `migrations/Longhaul_ActivityType.sql:17` |
| `XPU` / `XDEL` + `shipperaddresses.type` O/D | Extra pickup / extra delivery, one per active extra location | A3/A2 | `activity.service.ts:373-429`; `extraLocation.pegasusShadow.entity.ts:12-50` |
| `oshuttle` / `dshuttle` | `SHUTTLE @ ORIGIN` / `SHUTTLE @ DESTINATION` flags | A2 | `shipment_v2.view.ts:24-29` |
| `haul_mode` | Self (`Y`), **Atlas** (`N`), Other (`O`), Undecided (`U`), Pending (`P`) | A2/A8 | `src/utils/haulmode-list.js:1-21`; `haul-mode-mapping.js:1-7` |
| `shaul` | Short haul, `Y`/`N` | A2 | `src/utils/shaul-list.js:1-10` |
| `import_export` ("Move Type") | Interstate `H`, Hauler Only `HA`, Auto Only `A`, Military `M`, Small Shipment `SS` | A2 | `src/utils/movetype-list.js:1-22` |
| `avl_reg` | The van line's own registration number for the shipment | A9 | `shipment.abstract.ts:11-12` |
| `ba_name` / `booker_name` | Booking agent / booker | A8 | `shipment.abstract.ts:14-15,61-62` |
| `oa_id`/`oa_name`, `da_id`/`da_name` | Origin agent, destination agent | A8 | `shipment.abstract.ts:166-176` |
| `haul_id` / `haul_name` | Hauling agent | A8 | `shipment.abstract.ts:49-57` |
| `coordinator` / `operations_id` ("dispatcher") / `created_by_id` ("planner") | The three internal roles on a shipment/trip | A8 | `shipment.abstract.ts:25-30,250-251`; `trips/model/trip.entity.ts:58-72` |
| `vip` / `idc_break` ("supervip") | Priority flags counted onto the trip | A2 | `shipment.abstract.ts:130-134`; `trip.service.ts:404-405` |
| `packing_coverage` / `is_covered` / `coverage_agent_id` | "OA Committed?" - the origin agent's commitment to cover an activity code | A6/A8 | `shipments/model/coverage.abstract.ts:22-31`; label at `ShipmentDetail/components/Coverage/index.tsx:64` |
| `longhaul_shipment_weight_link` | Typed weight slots: `survey_weight_id`, `initial_weight_id`, `billable_weight_id`, `reweight_id` | A2/A10 | `shipments/model/weight.abstract.ts:10-28` |
| `longhaul_weight_detail` | A weigh event: `gross`, `tare`, `cubic_feet`, `weight_date`, `weight_vendor_name`, city/state/street, `weigh_master` | A6/A10 | `weight.abstract.ts:49-84` |
| `MasterZones` / `atlas_monitoring_pty` | 7 planning zones (North East ... Canada-West), each carrying a **van-line monitoring party code** (`9693NE`, `9693CW`, ...) | A3/A9 | `server/migrations/MasterZones.sql:5-19` |
| `total_effective_deadhead_miles` | Deadhead attributed to the trip | A3/A13 | `trip.abstract.ts:36-37` |
| `Note` / `NoteType.DISPATCH` | Trip-scoped free-text dispatch note, authored by a user | A6 | `trips/model/notes.abstract.ts:4-31` |
| `DriverConfirmedAvailability` | A driver's manually entered ready date + location; cleared when they are confirmed onto a trip | A13 | `handlers/longhaul-cloud/trips-write.ts:58-79` |
| "rejected trip" / `ArchivedTrip` | A Postgres snapshot of a trip a driver turned down, with a per-driver reason | A3 | `handlers/longhaul-cloud/rejected-trips.ts:2-21` |

## Lifecycles & events

### Trip status - the one real state machine in the source

`MasterTripStatus` is a **seeded, ordered enum** of exactly five rows:
`1 Pending, 2 Offered, 3 Accepted, 4 In-Progress, 5 Finalized`
(`server/migrations/TripMasterStatuses.sql:8`; enum mirror at
`src/common/trip-status.ts:3-9`). The cloud port depends on the ordering being
meaningful and says so: "`MasterTripStatus.status_id` is an ORDERED enum ... so
'Accepted or greater' is a `>=`" (`handlers/longhaul-cloud/driver-planning.ts:38-47`).

There is **no transition table**. Legal movement is expressed entirely as
numeric guards at the point of write, identically in both layers:

| Guard | Legacy | Cloud |
| --- | --- | --- |
| Cannot advance past Pending (`statusId > current && > 1`) with no driver assigned | `trips/trip.service.ts:330-341` | `handlers/longhaul-cloud/trips-write.ts:128-137` |
| Cannot reach Finalized (`>= 5`) while any activity lacks `actual_date` | `trip.service.ts:343-354` | `trips-write.ts:138-148` |
| Cannot change the driver once `status_id >= 4` (In-Progress) | `trip.service.ts:141-152` | `lib/longhaul-trip-save.ts:156-165` |
| Cannot cancel once `status_id >= 4` | `trip.service.ts:370-383` | `trips-write.ts:233-242` |
| Cannot remove an activity that already has an `actual_date` | `trip.service.ts:198-209` | `lib/longhaul-trip-save.ts:214-220` |
| A trip must have at least one shipment to save | `trip.service.ts:107-118` | (not re-ported) |

So the machine is: any status may be set to any other **provided** the numeric
guards hold. Nothing enforces Pending -> Offered -> Accepted in order; nothing
forbids going backwards. "Unplanned (0)" and "Completed (5)" in
`src/utils/tripstatus-list.js:2-25` are UI labels with no backing rows - 0 is
"no trip", and "Completed" is the UI's word for Finalized.

**Who causes each transition.** Every status change is an operations user's
`PATCH /trips/:id/status`; the driver never writes. The acting user is stamped
(`updated_by_id` on the trip, `modified_by`/`updated_at` cascaded to every one
of the trip's activities - `trips-write.ts:72-74`). "Offered" and "Accepted" are
therefore *assertions by the dispatcher about the driver*, not driver actions:
the mobile app only **reads** Offered trips to surface them
(`apps/mobile/src/services/tripService.ts:84-87`), and a decline is captured by
the dispatcher as a separate Postgres "rejected trip" snapshot with a free-text
reason rather than as a status (`handlers/longhaul-cloud/rejected-trips.ts:2-21`).
`driver_accepted_date` exists as a column (`trip.abstract.ts:66-67`) but is only
copied through from the DTO (`lib/longhaul-trip-save.ts:297`) - nothing sets it
from an acceptance event.

Two side effects ride a status change: every activity's `trip_status_id` and
`status` string are rewritten to match the trip (`trip.service.ts:366`;
`trips-write.ts:72-74`), and promoting Pending/Offered -> Accepted/In-Progress
**clears the driver's manually entered ready availability** in the same
transaction (`trips-write.ts:58-79,153-161`), warned about in the UI as a
destructive action (`Trip/utils/status-prompt.ts:32-46`). Cancellation is a
different axis: `internal_status = 'canceled'` plus **deletion** of the trip's
activities (`trip.service.ts:370-396`; `trips-write.ts:187-203`).

One *predicted* transition is proposed but never applied silently: if today
falls inside the planned span and the trip is Accepted the UI suggests
In-Progress; if today is past `planned_last_day` and the trip is not Finalized
it suggests Finalized - always behind a confirm dialog
(`Trip/utils/status-prompt.ts:9-25,36-56`).

### Activity lifecycle - flags, not states

`Activity.status` is a free string simply overwritten with the **trip's** status
name on every save (`trip.service.ts:273,287`; `trips-write.ts:73`), so it
carries no independent activity state. The real activity lifecycle is a ladder
of three flags, and the UI names each rung:

```
(nothing)  ->  is_committed       "Driver Commitment Made"
           ->  is_confirmed       "Confirmed With Driver"   (requires estimated_date)
           ->  actual_date set    "Verified Complete"
```

(`ActivityGantt.tsx:388-394`, icon ladder repeated at 411-418.) The UI exposes
the Actual Date picker only once `is_confirmed` is set *or* the type has no ETA
(`ActivityGantt.tsx:304`), and caps the actual date at **tomorrow**
(`ActivityGantt.tsx:355`, `maxDate={tomorrow}`). `is_active` is declared
(`activity.abstract.ts:23-24`) and always written `false` by both generators
(`activity.service.ts:117`; `lib/longhaul-build-activities.ts:54`) - dead.

**There are no reason codes anywhere.** No delay reason, no exception code, no
cancellation reason on the trip. The only reason text in the whole source is the
per-driver `reason` on a rejected-trip snapshot (`rejected-trips.ts:38`). This is
the sharpest gap in the source for A4.

### How activities come into being

Two generators, both pure functions of the shipment's date columns:

- **Required set** - `buildShipmentActivities`: PACK when `pack_date2` and no
  `rule19_id`; LOAD when `load_date2` and no `rule19_id`; **R19O instead** when
  `rule19_id` is set; RDEL unconditionally (`if (true)` in legacy)
  (`activities/activity.service.ts:142-237`; port at
  `lib/longhaul-build-activities.ts:112-177`).
- **Optional "extras"** - `buildExtraShipmentActivities`: offers R19I, WHSE,
  SITIN, SITOUT, UNPK, XPU (one per active `type='O'` extra location), XDEL (one
  per `type='D'`), CFD, CFA as *templates the planner may attach*
  (`activity.service.ts:239-545`). They are not persisted until placed on a trip.

Attaching a shipment to a trip = attaching its activities. The save diff matches
DTO activity to persisted row by the triple **(`order_num`, activity-type code,
this trip id)** - `sameSlot` at `lib/longhaul-trip-save.ts:205-209`, mirroring
`trip.service.ts:188-261`. That key is the model's real uniqueness rule: **one
activity of a given type per order per trip**.

## Time, identity, evidence

### Time

The richest part of the source, and unusually explicit for an internal system.

- **Four date columns per activity with distinct meanings**: `planned_start`,
  `planned_end` (the planner's spread), `estimated_date` (ETA), `actual_date`
  (`activity.abstract.ts:32-45`). The fallback chain is written in code -
  effective start is `actual_date ?? estimated_date ?? planned_start`, effective
  end is `actual_date ?? estimated_date ?? planned_end`
  (`trip.service.ts:407-417`).
- **All four are calendar days, not instants**, and the cloud port enforces it at
  the API boundary because clients were persisting `toISOString()` off a local
  Date and landing days at `05:00:00`
  (`apps/api/src/lib/longhaul-date-only.ts:1-35`; `DATE_ONLY_COLUMNS` at 30-35).
- **An inverted planned span is legal.** `planned_end < planned_start` occurs on
  real production rows and a guard against it broke 8 of them, so the rule is
  written down: "do NOT add a guard relating the window to any date column"
  (`plans/completed/5948dc44-activity-arrival-window.md:65-72`; also
  `plans/completed/ec8b8958-daily-dispatch.md:48-51`).
- **Arrival window** - the one place the source models *time of day*. Two
  `varchar(5)` `HH:mm` local wall clocks plus an **IANA zone id**, all three or
  none; UTC instants derived on read and never stored; the window has no date of
  its own, anchoring to `estimated_date ?? planned_start`
  (`5948dc44-activity-arrival-window.md:50-72,104-127`). The zone is *required
  rather than guessed* because 14 US states span two zones and a silent majority
  pick means "a customer texted an hour early" (ibid.:25-35). The server returns
  a `confident | likely | unknown` confidence with its suggestion
  (`packages/longhaul-contracts/src/arrival-window.ts:13-20`), and the zone list
  is a shared contract so UI and API cannot drift (ibid.:1-11,41-64). Canada is
  in scope (plan:158-162).
- **Trip-level time is derived, not entered**: `planned_first_day` /
  `planned_last_day` come from the earliest/latest activity by the effective-date
  chain, and `total_days` is their inclusive difference
  (`trip.service.ts:434-445`).
- **Shipment-level time** is a wide, redundant set of triples on the pegII row:
  `pack_date`/`pack_date2`/`plan_pack`/`pack_actual`, and the same for load and
  del, plus `lng_dis_ld_early`/`_late` and `lng_dis_del_early`/`_late` spreads
  (`shipment.abstract.ts:94-111,64-83`). The planner treats `*_date2` as the
  authoritative planned day and `plan_*` as the secondary
  (`lib/longhaul-build-activities.ts:116-145`). Nothing read explains the
  `_date` vs `_date2` vs `plan_` distinction - **open question**.
- **No time zone anywhere except the arrival window.** Every other date is a
  naive day with no stop-local zone.

### Identity & cross-references

Every id is a bare scalar on a flat row; there is no party or location entity.

- `order_num` - the pegII order number and the *only* shipment identity. It is
  also the activity's FK (`activity.entity.ts:31-39`), so the whole join graph
  hangs off it.
- `avl_reg` - the **van line's own registration number** for the same shipment
  (`shipment.abstract.ts:11-12`); the sole cross-reference to van-line numbering.
- Agent codes as opaque strings: `oa_id`, `da_id`, `haul_id`, `stg_id`, `ba_id`
  (via the view's join, `shipment_v2.view.ts:49`), plus `Driver.agent_code`
  copied onto each activity as `assigned_agent_code` (`trip.entity.ts:74-82`;
  `lib/longhaul-trip-save.ts:222-228`).
- `MasterZones.atlas_monitoring_pty` maps each planning zone to a van-line
  monitoring party code (`9693NE`, `9693SE`, `9693C`, `9693CE`, `9693CW`) - the
  only partner-facing identifier in the schema (`MasterZones.sql:5-19`).
- Internal people are `salesman.code` / `v_longhaul_salesman`, referenced three
  ways on one trip: `created_by_id` (planner), `dispatcher_id`, `updated_by_id`
  (`trip.entity.ts:58-72`).
- `rule19_id`, `pickup_num`, `location_id` (-> `shipperaddresses.id`) complete
  the foreign keys.

**Nothing is typed.** One flat row carries eight party ids as `@Column() string`
with no discriminator - exactly the failure the cloud port had to build a
contracts package to contain: four production bugs came from accessors naming
columns the view does not project (destination street is `consignee_name1/2` not
`del_address1/2`; Operations surname is `last_name` not `OpsLastName`; super-VIP
is `idc_break` not `supervip`; the SIT driver is `driver2_id`) -
`packages/longhaul-contracts/src/shipment-view.ts:9-21`. The fix is an exact
key-set type with **no index signature**, deliberately *without* per-column
scalar types, because the legacy entity's declarations disagree with the live
schema on ~8 columns (ibid.:149-164).

### Evidence, provenance and corrections

- **Assertion ladder** - `is_committed` -> `is_confirmed` -> `actual_date` is a
  genuine "who asserted this": the driver committed, ops confirmed with the
  driver, ops verified it happened (`ActivityGantt.tsx:388-394`).
- **Actor stamps** - `created_by_id` / `updated_by_id` / `finalized_id` on the
  trip; `modified_by` / `updated_at` on the activity, rewritten on *every* touch
  including a status cascade and even on the row about to be deleted
  (`trip.service.ts:662-683`; `trips-write.ts:192-193`).
- **Corrections are destructive overwrites.** No reversal or supersession: an
  edited `actual_date` replaces the old value; a removed activity is `DELETE`d,
  not tombstoned. The only history is an MSSQL AFTER DELETE trigger copying the
  row into `LongDistanceDispatchActivityHistory` with an explicit 25-column list
  - which is why the arrival-window columns were **not** added to that table,
  leaving a known audit gap for deleted activities
  (`5948dc44-activity-arrival-window.md:81-102`).
- **Known lossy path, recorded as a decision not a bug**: a trip save posts the
  DTO the page loaded, so a window (or `estimated_date`, or `is_confirmed`) set
  in another session after that load is overwritten with null (ibid.:229-232).
- **Absence is meaningful.** "No arrival-window row means *not communicated*,
  never an implied 8-10", and no backfill was done for exactly that reason
  (ibid.:51,251). The same discipline appears in the SIT filter: `whse_date`
  says a SIT-in was *scheduled*, a `SITIN` row with an `actual_date` says one
  *happened* (`plans/completed/sit-filter.md:38-50`).

## Scores

Weighting is a phase-3 decision; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 0 | 1 | 2 | 1 | 1 | 0 | The planner consumes orders, it does not run them. The only order-state predicate in the whole source is `shipment_status = 'A' AND del_actual IS NULL` = "active and not yet delivered" (`shipments-list.ts:305-318`). No offer/award/book/estimate/cancel. Dates are rich (C5): `shipment.abstract.ts:94-111`. |
| A2 Shipment structure | 2 | 2 | 1 | 2 | 2 | 2 | 1 | 1 | Shipment-vs-trip is unambiguous (`trip.entity.ts:44-49` - a trip owns activities, never shipments). Move types `H/HA/A/M/SS` (`movetype-list.js:1-22`), haul mode incl. **Atlas** (`haulmode-list.js:1-21`), short haul (`shaul-list.js`), shuttle + storage indicators (`shipment_v2.view.ts:24-34`), typed weight slots survey/initial/billable/reweight (`weight.abstract.ts:10-28`). No shipment-type discriminator (vehicle/PPM absent except Move Type `A` "Auto Only"); services ordered are implied by which activities exist, never declared. |
| A3 Trip, stop & assignment | 2 | 3 | 3 | 2 | 3 | 2 | 2 | 1 | **Best-in-inventory candidate.** Trip != shipment; consolidation via activities (`trip.service.ts:82-99`); one driver per trip cascaded to every activity (`trip.entity.ts:74-82`); five-state ordered lifecycle with six enforced invariants (table above); roll-ups recomputed from activities (`trip.service.ts:398-463`). C1 held at 2: **no stop entity, no stop sequence, no legs, no equipment** - see Weaknesses. C2=3 because the trip/activity/shipment three-way distinction is stated and defended (`lib/longhaul-trip-save.ts:183-196`). |
| A4 Execution events & tracking | 2 | 2 | 2 | 3 | 3 | 2 | 2 | 1 | Planned/estimated/actual + arrival window + tz + confidence (`5948dc44-activity-arrival-window.md:104-127`; `arrival-window.ts:13-64`) is a genuinely good time model - C5=3. C4=3: the vocabulary is HHG-native (PACK/LOAD/SIT/UNPK/Rule 19), not generic freight. C1 capped at 2 and C3 at 2: **one `actual_date` per activity, so there is no arrive/depart pair**, no ETA history, no telemetry, and - decisively - **no exception, delay or reason codes at all**. |
| A5 Storage-in-transit | 2 | 3 | 1 | 3 | 2 | 1 | 2 | 1 | SIT is first-class as activity types with defined meanings ("Delivery into/out of storage in transit", `Longhaul_ActivityType.sql:18-19`), with planned dates (`whse_date`/`sit_date`), an origin/destination storage indicator (`shipment_v2.view.ts:30-34`), a storage agent (`stg_id`), a separate storage-delivery driver (`driver2_id`), a distinct `WHSE` type, and Rule-19 agent-pickup/dock-load. C2=3 because the *planned vs actual SIT* distinction is written down as a decision (`sit-filter.md:38-50`). C3=1 and C6=1: **the warehouse is not a stop or a party** - the SITIN/SITOUT templates are stamped with the **consignee's** address (`activity.service.ts:458-464,481-487`), there is no SIT duration, no free-time clock, no permanent-storage boundary, and no in/out pairing invariant. |
| A6 Documents & evidence | 1 | 2 | 0 | 2 | 1 | 1 | 2 | 0 | No document entity at all - no BOL, POD, inventory, order for service, estimate, photo. Two partial exceptions: `longhaul_weight_detail` is a **weigh ticket in all but name** (gross, tare, cubic feet, date, vendor, address, `weigh_master` - `weight.abstract.ts:49-84`), and `packing_coverage` records an agent's "OA Committed?" assertion with author, note and timestamps (`coverage.abstract.ts:8-38`). C7=2 on the assertion ladder + actor stamps. **Caveat**: the weight header/detail tables are *declared* but only the link row is ever written (`shipments/shipment.service.ts:109-111`) - the weigh-ticket model is unexercised. |
| A7 Charges & billing hooks | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 0 | `line_haul` on the shipment (declared `string`, `shipment.abstract.ts:58-59`); `total_estimated_linehaul_usd` / `total_actual_linehaul_usd` + `total_miles` + `total_effective_deadhead_miles` on the trip (`trip.abstract.ts:33-49`). No accessorials, no charge events, no invoice. And the estimated/actual distinction is fictional: **both roll-ups sum the same `line_haul` column** (`trip.service.ts:430-431`). |
| A8 Parties & roles | 3 | 2 | 1 | 3 | n/a | 2 | 1 | 1 | C1=3 / C4=3: the HHG agent set is all present and native - booking agent (`ba_name`/`booker_name`), origin agent (`oa_id`/`oa_name`), destination agent (`da_id`/`da_name`), hauling agent (`haul_id`/`haul_name`), storage agent (`stg_id`), driver + `agent_code`, shipper, consignee, account/relo company (`shipment_v2.view.ts:41`), plus three internal roles (coordinator, dispatcher/`operations_id`, planner/`created_by_id`). C2=2 / C3=1: they are denormalized name+id string pairs on one flat row with **no party entity, no role lifecycle, and no explicit van line** - Atlas exists only as `haul_mode = 'N'` (`haulmode-list.js:8-11`) and as a zone-level monitoring party code (`MasterZones.sql:5-19`). |
| A9 Identity & cross-references | 2 | 2 | n/a | 3 | n/a | 2 | 1 | 1 | Our order number (`order_num`), the van line's registration (`avl_reg`), five agent codes, the zone-to-van-line monitoring party map, plus internal `TripMaster_id` / `driver_id` / `location_id` / `rule19_id` / `pickup_num`. C4=3 - these are HHG-specific cross-references, not generic ids. C6 held at 2: every one is an untyped scalar on a wide row, which produced four production bugs and required a contracts package to contain (`shipment-view.ts:9-21`). No SCAC, no BOL/PRO, no service-order number. |
| A10 Survey, estimating & inventory | - | - | - | - | - | - | - | - | Not scored (out of v1). See Out-of-v1 material. |
| A11 Claims & valuation | - | - | - | - | - | - | - | - | Absent from the source entirely. |
| A12 Rating & tariffs | - | - | - | - | - | - | - | - | Absent. |
| A13 Crew, driver & settlement | - | - | - | - | - | - | - | - | Not scored (out of v1). See Out-of-v1 material. |

**S5 fit to Pegasus data** - this source *is* Pegasus data, so the question
inverts: what can pegII/Cloud actually supply?

| Area | Fit | Note |
| --- | --- | --- |
| A1 | `partial` | Order state lives upstream in pegII `sales`; the planner sees only `shipment_status` and the date columns. |
| A2 | `yes` | Directly, via `v_longhaul_shipments_v2` - but see the QMM caveat below. |
| A3 | `yes` | `TripMaster` + `LongDistanceDispatchActivity` + `MasterTripStatus`, identically from legacy and Cloud (same MSSQL). |
| A4 | `yes` (events) / `no` (reasons, telemetry) | Activity dates and flags are supplyable today; exception/delay reasons and any GPS/telemetry are **not** - nothing to map from. |
| A5 | `partial` | SIT in/out and their planned dates: yes. Warehouse identity, SIT duration, free time: no. |
| A6 | `no` | No document store. Weight-ticket fields exist but are unwritten. |
| A7 | `partial` | Line-haul totals only; the estimated/actual split is not real (`trip.service.ts:430-431`). |
| A8 | `yes` | All agent roles present as id+name pairs; resolving them to party records is not. |
| A9 | `yes` | `order_num` + `avl_reg` + agent codes are readable today. |
| - | **caveat** | **Per-tenant schema drift is real**: QMM historically has no `v_longhaul_shipments_v2` at all (`5948dc44-activity-arrival-window.md:221-223`; `ec8b8958-daily-dispatch.md:165-167`), and NWI has three enabled activity triggers where QMM has none (5948dc44:82-84). Any catalog claim of the form "pegII supplies X" must be qualified per tenant. |

## Strengths worth adopting

1. **Trip, shipment and activity as three separate things, with the join carrying
   the event.** The activity row *is* the association (`order_num` +
   `TripMaster_id`) *and* the execution record (planned/estimated/actual). That
   one decision is why a trip can consolidate many shipments and why a shipment
   can span trips without either aggregate knowing about the other
   (`activity.entity.ts:17-39`). Keep the association and the event on one
   concept, or state explicitly why the model splits them.
2. **Cancellation as an orthogonal axis, not a status value.** `internal_status`
   (`active|canceled`) is deliberately separate from `TripStatus_id`, so
   "cancelled" never overwrites "where in the lifecycle this was"
   (`trip.abstract.ts:3-6,81`; the cloud port relies on the separation,
   `driver-planning.ts:44-47`). Worth copying for every lifecycle in the model.
3. **The three-rung assertion ladder**: committed (driver said) -> confirmed (ops
   confirmed with the driver) -> actual (verified complete)
   (`ActivityGantt.tsx:388-394`). A ready-made provenance vocabulary for A4/A7
   that separates *who asserted a fact* from *the fact*, in the words operations
   already uses.
4. **Arrival window = local wall clock + explicit IANA zone + confidence, never
   an instant** - including the refusal to guess the zone in split states, and
   the rule that *absence means "not communicated"*, never an implied default
   (`5948dc44-activity-arrival-window.md:25-35,51,104-127`;
   `arrival-window.ts:13-20`). Adopt both the representation and the
   absence-is-meaningful rule.
5. **Planned vs estimated vs actual as three separate columns with a stated
   fallback order**, all typed as calendar days rather than instants
   (`trip.service.ts:407-417`; `longhaul-date-only.ts:1-35`). The chain
   `actual ?? estimated ?? planned` is itself a reusable rule.
6. **"Scheduled" and "happened" are different questions.** The SIT-Dest filter
   decision - reject `whse_date` (a plan) in favor of a `SITIN` row with an
   `actual_date` (an occurrence) - is the cleanest statement of that distinction
   in any of our material (`sit-filter.md:38-50`).
7. **Activity types as data with behavioral flags**, not a hardcoded enum:
   `isPerformedAtOrigin` / `isPerformedAtDestination` / `isHasETA` /
   `isCanEditDates` / `sequencePriority` (`activityType.abstract.ts:24-37`). A
   catalog-with-flags is a better extension point than a closed event enum, and
   it is this source's only real C8 asset.
8. **The uniqueness key (`order_num`, activity-type code, trip)** - a crisp,
   defensible identity rule for a stop-like concept, and what makes the save
   diff possible at all (`lib/longhaul-trip-save.ts:205-209`).
9. **Derived roll-ups are recomputed, never accumulated.** Trip totals, day span,
   origin/destination state and VIP counts are recomputed from its activities on
   every save (`trip.service.ts:398-463`). The catalog should be explicit about
   which trip facts are derived.

## Weaknesses / traps

1. **There is no stop.** An activity carries a loose address (`street`, `unit`,
   `city`, `state`, `zip` - `activity.abstract.ts:56-69`) copied from the
   shipment at generation time. Two activities at the same door are two
   unrelated addresses; a warehouse visit is not a place. Following this source
   leaves the model with no location aggregate and no way to say "these three
   orders load at the same stop".
2. **There is no stop sequence.** `order_num` on the activity is the *order
   number*, not an ordinal - the DDL confirms it is the FK
   (`CreateShipmentActivity.sql:13`). The only ordering is
   `ActivityType.sequencePriority`, which orders types **within one shipment**
   (`src/redux/pending-trips/index.js:77`), plus date sorting in the Gantt. A
   trip with five shipments has no defined visit order. Largest A3 gap.
3. **There are no legs and no equipment.** A trip is driver + activities. No
   tractor, no trailer, no trailer swap, no relay, no co-driver - only
   `driver_id` plus the storage-delivery `driver2_id` on the shipment.
4. **No exception, delay or reason codes anywhere** (A4). If the catalog needs
   "delivery delayed, reason X", nothing here can supply it.
5. **SIT activities are stamped with the consignee's address, not the
   warehouse's** (`activity.service.ts:458-464,481-487`). Anyone reading a SITIN
   row's address as "where the goods are" will be wrong. Do **not** carry this
   into the model.
6. **`Activity.status` is not an activity state** - it is a copy of the trip's
   status name, rewritten on every save (`trips-write.ts:73`). Treat it as
   denormalization, never as a lifecycle.
7. **Estimated and actual line-haul are the same number** - both roll-ups sum
   `shipment.line_haul` (`trip.service.ts:430-431`). Any A7 mapping that trusts
   the column names is wrong.
8. **The flat-row identity model actively produces bugs.** Four production
   defects from column-name drift alone, plus one where two same-named columns in
   a wildcard SELECT made the driver return `operations_id: [1196, 1196]`
   (`shipment-view.ts:9-21,44-51`). Carry forward the contracts package's own
   lesson: model an **exact key set with no index signature**, and do not invent
   scalar types you cannot verify (ibid.:149-164).
9. **Derived-summary fragility.** The cloud port's first summary implementation
   read three columns the view does not project, silently wrote zeros, and zeroed
   `total_actual_lbs` on **337 NWI trips (4,289,839 lbs)** before it was caught
   (`lib/longhaul-cloud-trip-summary.ts:9-31`). Derived values with no provenance
   are a real hazard; the catalog should say what is derived and from what.
10. **Trip status transitions are guards, not a machine.** Any status can jump to
    any other if four numeric conditions hold; nothing prevents Finalized ->
    Pending. Do not read the five-value enum as an enforced sequence.
11. **"Offered" and "Accepted" are dispatcher assertions, not driver actions.**
    The driver has no write path; a decline becomes a *separate* Postgres
    snapshot rather than a status (`rejected-trips.ts:2-21`), and
    `driver_accepted_date` is never populated by an acceptance. A model treating
    these as driver-caused events will not match the data.
12. **Last-writer-wins over a stale page** silently nulls concurrent edits, and
    it is recorded as intended behavior rather than a defect
    (`5948dc44-activity-arrival-window.md:229-232`). Correction semantics in the
    model must be designed, not inherited.
13. **Tenant schema drift is normal here** (QMM lacks the v2 view; NWI has
    triggers QMM does not). "pegII can supply X" is a per-tenant claim.

## Out-of-v1 material

**A10 - survey, estimating & inventory.** The weight model is the useful part:
`longhaul_shipment_weight_link` gives a shipment **four typed weight slots** -
`survey_weight_id`, `initial_weight_id`, `billable_weight_id`, `reweight_id`
(`weight.abstract.ts:10-28`) - over a header/detail pair where each detail row is
a weigh event with `gross`, `tare`, `cubic_feet`, `weight_date`,
`weight_vendor_name`, street/city/state and `weigh_master`
(`weight.abstract.ts:30-84`). That is a survey/initial/billable/**reweigh**
vocabulary plus a weigh-ticket shape, ready to reuse. **Caveat: only the link row
is ever written** (`shipments/shipment.service.ts:109-111`); header and detail
have no read or write path, so this is designed-but-unexercised. Also here:
`survey_date`, `survey_remarks`, `total_est_wt` vs `weight` (actual)
(`shipment.abstract.ts:124-128,177-179,262-263`), and `type_packing`
(`shipment.abstract.ts:268-269`). No inventory items anywhere.

**A11 - claims & valuation.** Nothing. Not a single column.

**A12 - rating & tariffs.** Nothing beyond the raw `line_haul` string and
`mileage`. No tariff, no accessorial catalog.

**A13 - crew, driver & settlement.**
- Driver typing: `v_longhaul_drivers` carries `is_local_drv`,
  `is_long_dist_drv`, `is_shorthaul_driver` and a `TYPE` (NWI's own driver types
  are `['NWSUB','NW']` - `config/clients/nwi.js` `clientInfo.driverTypes`;
  columns at `driver-planning.ts:65-67`), plus `agent_code` tying a driver to an
  agent, and a `canada` flag referenced for cross-border work
  (`5948dc44-activity-arrival-window.md:158-162`).
- **Driver availability is modeled**: `DriverConfirmedAvailability` holds a
  manually entered `confirmed_date` + `confirmed_location`, lazily provisioned
  per tenant, and **automatically invalidated** when a driver is confirmed onto a
  trip (`trips-write.ts:58-79,153-161`). Otherwise "ready date / ready state /
  ready city" are derived from the driver's latest **Accepted-or-greater**,
  non-cancelled trip - a trip the driver has not taken on is explicitly *not* a
  commitment and must not move their ready position (`driver-planning.ts:38-47`).
- Settlement hooks: `total_effective_deadhead_miles`, `total_miles`,
  `total_estimated_linehaul_usd` / `_actual_` on the trip
  (`trip.abstract.ts:33-49`); `assigned_agent_code` stamped on every activity
  (`lib/longhaul-trip-save.ts:222-228`) - the beginnings of per-activity revenue
  attribution to an agent.
- Placeholder driver ids 99994-99999 are a *presentation* filter, and at least
  99995 ("CSS, C&F", agent code 3201, type NWSUB) is a genuine subcontractor
  (`driver-filter.ts:14-24`) - useful precedent that "placeholder" ranges in
  legacy data are not reliably placeholders.

**Beyond the rubric's areas.** The `longhaul-cloud` tree is also evidence about
*how a domain event catalog would have to be emitted from pegII*: the
arrival-window plan's own follow-up is "emit
`longhaul.activity.arrival_window.set` via `emitDomainEvent` ... note the emit is
a Postgres write in an MSSQL handler - **non-atomic by construction**; the event
carries ids only and the consumer refetches"
(`5948dc44-activity-arrival-window.md:242-246`). That is a constraint on catalog
design, not just on that feature.

## Open questions

1. **What distinguishes `pack_date` / `pack_date2` / `plan_pack` / `pack_actual`
   (and the load and del triples)?** The planner treats `*_date2` as
   authoritative planned and `plan_*` as fallback
   (`lib/longhaul-build-activities.ts:116-145`), but nothing read says what the
   bare `*_date` column means. Upstream pegII semantics - needs the user or the
   pegII source.
2. **What is the intended trip stop sequence?** Given no ordinal exists, how do
   dispatchers decide and communicate visit order today - by the Gantt's date
   layout, by `sequencePriority`, or out-of-band?
3. **Who really moves a trip to Offered and then Accepted?** The schema implies a
   driver decision, but no driver write path exists and `driver_accepted_date` is
   never set. Is acceptance verbal, or captured outside this system?
4. **Are `CFD` / `CFA` live?** They are in the code's `ACTIVITY_TYPE_CODE` map
   (`activity.service.ts:24-25`) but absent from the seeded catalog
   (`Longhaul_ActivityType.sql:12-22`), and the generator skips them when the
   type lookup misses (`activity.service.ts:516-518`). Meaning and status
   unknown.
5. **Is the weight header/detail model dead or merely unfinished?** Only the link
   row is written here. If pegII's desktop app writes it, it is our best internal
   A10/A6 source and should be re-read from the pegII side.
6. **What is `atlas_monitoring_pty` used for operationally?** It maps a planning
   zone to a van-line party code (`MasterZones.sql:5-19`) and is the only
   partner-facing identifier in the schema - likely the seam where Atlas/Allied
   status reporting would attach, which bears directly on the
   visibility-platform-readiness question.
7. **Does `avl_reg` have a defined format and issuing authority**, and is there a
   second registration for Allied vs Atlas shipments? The schema has exactly one
   such column.
8. **`shipment_status`** - only the value `'A'` appears in code
   (`shipments-list.ts:317`). What is the full domain, and is it the pegII order
   lifecycle we need for A1?
9. **`special4`** is projected by the view (`shipment-view.ts:104`) with no
   consumer and no name. Unknown.
