---
source: src:gtfs
analyzed: 2026-09-17
evidence_grade: A
material: |
  sources/gtfs/captured/gtfs-schedule-reference.html — full GTFS Schedule Reference,
    "Revised April 27, 2026" (https://gtfs.org/documentation/schedule/reference)
  sources/gtfs/captured/gtfs-realtime-reference.html — full GTFS Realtime Reference v2.0
    (https://gtfs.org/documentation/realtime/reference/)
  Both read end to end as text (HTML converted locally); every field table, enum and
  normative note in both pages was read.
---

# GTFS Schedule + GTFS Realtime — analysis

## What it is

GTFS is the public-transit data standard: **GTFS Schedule** is a zipped set of CSV
files describing an agency's published timetable, and **GTFS Realtime** is a Protocol
Buffer feed describing what is actually happening against that timetable. Maintained
by MobilityData with the GTFS community through a public change process.
**S1 kind:** the registry records `reference-model`; more precisely Schedule is a
*dataset/interchange format* and Realtime is a *message standard* — and the pairing is
the point. **S2 adoption: 3** — the most widely deployed public model of scheduled
movement in existence, consumed by every major trip planner. **S3 openness:** `public`
(spec text CC BY 3.0, protobuf Apache-2.0). **Normative rigour is high**: RFC 2119
keywords ("MUST", "SHOULD", "MAY"), an explicit `Presence` vocabulary (Required /
Optional / Conditionally Required / **Conditionally Forbidden** / Recommended), typed
fields, and a declared primary key per file
(`captured/gtfs-schedule-reference.html` → "Document Conventions", "Presence",
"Dataset Attributes").

**What our reading covered:** both reference pages in full — every file, field, enum,
and normative note, including the experimental Trip Modifications messages. **What we
did not read:** `gtfs-realtime.proto` itself (the pages are the normative field
documentation but the .proto carries the wire-level cardinalities and extension
ranges), the GTFS Best Practices pages, the data examples pages the reference links to
for on-demand routing behaviour, and the revision history.

**It is not freight.** There are no goods, no consignment, no custody, no charges
beyond passenger fares, no documents, and no storage. Everything below should be read
as *mechanism*, not as vocabulary to import.

## Model summary

**Schedule (the plan).** Six required-ish files carry the structure:

```
agency.txt        one row per transit brand; carries agency_timezone and agency_lang
routes.txt        "A route is a group of trips that are displayed to riders as a
                   single service"
trips.txt         "A trip is a sequence of two or more stops that occur during a
                   specific time period"   (route_id, service_id, trip_id, block_id,
                                            shape_id, direction_id)
stop_times.txt    PK (trip_id, stop_sequence) — arrival_time, departure_time,
                   stop_id, pickup_type, drop_off_type, timepoint
stops.txt         location_type 0 stop/platform | 1 station | 2 entrance | 3 node
                   | 4 boarding area, with parent_station hierarchy and stop_timezone
calendar.txt /    service_id -> which dates the trip actually runs
calendar_dates.txt
shapes.txt        the geometry of the path between stops
```

The load-bearing relationship: a **trip is a template**, a **service_id says on which
dates it is instantiated**, and a **block_id says which template-instances a single
vehicle performs back to back** — "A block consists of a single trip or many sequential
trips made using the same vehicle, defined by shared service days and block_id"
(`gtfs-schedule-reference.html` → trips.txt, `block_id`). Blocks are the
vehicle-continuity concept; `transfers.txt` with `transfer_type` 4/5 ("Linked trips")
overrides them and supports 1-to-n, n-to-1 and n-to-n continuations for vehicles that
couple and uncouple — "If both a linked trips transfer and a block_id are provided and
they produce conflicting results, then the linked trips transfer shall be used."

**Realtime (the execution).** One `FeedMessage` = a `FeedHeader` plus N `FeedEntity`,
each carrying exactly one of:

| entity | what it is |
| --- | --- |
| `TripUpdate` | "Realtime update on the progress of a vehicle along a trip" — N `StopTimeUpdate`s |
| `VehiclePosition` | where the vehicle is, and its status relative to the current stop |
| `Alert` | a human-facing disruption notice, scoped by `EntitySelector` |
| `Shape` | a new path added at runtime (detour) — experimental |
| `Stop` | a stop added at runtime — experimental |
| `TripModifications` | a structured detour applied to many trips at once — experimental |

**The plan/execution join is by reference, never by copy.** A `StopTimeUpdate` names
`stop_sequence` and/or `stop_id` and says how the real world differs from the row of
`stop_times.txt` with that key. Nothing is restated unless the trip is `NEW` or
`REPLACEMENT`, in which case the realtime feed becomes authoritative and must supply
the whole stop list: "If trip.schedule_relationship is NEW or REPLACEMENT,
stop_time_updates must be provided for all stops in the new or replacement trip,
including stops with times in the past, and **the stop times in the static GTFS are not
used**" (`gtfs-realtime-reference.html` → message TripUpdate, `stop_time_update`).

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `route` | "A route is a group of trips that are displayed to riders as a single service." | A3 | Schedule → Dataset Files, routes.txt |
| `trip` | "A trip is a sequence of two or more stops that occur during a specific time period." | A3 | Schedule → Dataset Files, trips.txt |
| `stop_times` | "Times that a vehicle arrives at and departs from stops for each trip." PK `(trip_id, stop_sequence)` | A3, A4 | Schedule → stop_times.txt |
| `stop_sequence` | "Order of stops… for a particular trip. The values **must increase** along the trip but **do not need to be consecutive**." (1, 23, 40 is a valid sequence) | A3 | Schedule → stop_times.txt, `stop_sequence` |
| `block_id` | "a single trip or many sequential trips made using the same vehicle, defined by shared service days and block_id" | A3 | Schedule → trips.txt, `block_id` |
| `Leg` / `Journey` / `Sub-journey` | leg = "Travel in which a rider boards and alights between a pair of subsequent locations along a trip"; journey = "Overall travel from origin to destination, including all legs and transfers in-between" | A3 | Schedule → Term Definitions |
| `Service day` | "a time period used to indicate route scheduling… service days often do not correspond with calendar days. A service day may exceed 24:00:00 if service begins on one day and ends on a following day." | A3, A4, C5 | Schedule → Term Definitions |
| `Time` (field type) | "measured from 'noon minus 12h' of the service day… For times occurring after midnight on the service day, enter the time as a value greater than 24:00:00" — e.g. `25:35:00` | C5 | Schedule → Field Types |
| `Local time` (field type) | "a wall-clock time shown in the local time of the specified location" — a *distinct* type from `Time` | C5 | Schedule → Field Types |
| `timepoint` | `0` = "Times are considered approximate" (interpolated), `1` = "Times are considered exact". "All records… with defined arrival or departure times should have timepoint values populated." | A4, C5, C7 | Schedule → stop_times.txt, `timepoint` |
| `pickup_type` / `drop_off_type` | `0` regularly scheduled, `1` none available, `2` must phone agency, `3` must coordinate with driver — *what kind of service happens at this stop* | A3 | Schedule → stop_times.txt |
| `start_pickup_drop_off_window` / `end…` | the window in which on-demand service is available at a stop/zone; **forbidden if arrival_time or departure_time is defined** | A3, C5 | Schedule → stop_times.txt |
| `location_type` | `0` stop/platform, `1` station, `2` entrance/exit, `3` generic node, `4` boarding area — with `parent_station` rules per level | A3 | Schedule → stops.txt |
| `TripDescriptor` | "A descriptor that identifies a **single instance** of a GTFS trip" — with explicit rules for when `trip_id` alone is insufficient | A9 | Realtime → message TripDescriptor |
| `schedule_relationship` (trip) | `SCHEDULED`, `ADDED` (deprecated), `UNSCHEDULED`, `CANCELED`, `REPLACEMENT`, `DUPLICATED`, `NEW`, `DELETED` | A3, A4 | Realtime → enum ScheduleRelationship (TripDescriptor) |
| `schedule_relationship` (stop) | `SCHEDULED`, `SKIPPED`, `NO_DATA`, `UNSCHEDULED` | A4 | Realtime → enum ScheduleRelationship (StopTimeUpdate) |
| `StopTimeEvent` | "Timing information for a single predicted event (either arrival or departure). Timing consists of **delay and/or estimated time, and uncertainty**." | A4, C5 | Realtime → message StopTimeEvent |
| `uncertainty` | "roughly specifies the expected error in true delay… If uncertainty is omitted, it is interpreted as unknown. To specify a completely certain prediction, set its uncertainty to 0." | A4, C7 | Realtime → message StopTimeEvent |
| `VehicleStopStatus` | `INCOMING_AT` ("just about to arrive"), `STOPPED_AT` ("standing at the stop"), `IN_TRANSIT_TO` ("has departed the previous stop and is in transit") | A4 | Realtime → enum VehicleStopStatus |
| `Incrementality` | `FULL_DATASET` = "this feed update will **overwrite all preceding realtime information** for the feed… a full snapshot"; `DIFFERENTIAL` = "currently unsupported and behavior is unspecified" | A4, C7 | Realtime → enum Incrementality |
| `Alert.cause` / `.effect` / `.severity_level` | 13 causes, 11 effects, 4 severities, each pairable with a free-text `cause_detail` / `effect_detail` "that allows for agency-specific language; more specific than the Cause" | A4 | Realtime → message Alert, enums Cause / Effect / SeverityLevel |
| `attributions.txt` | "defines the attributions applied to the dataset" — scoped to the whole dataset, or to one `agency_id`, `route_id` **or** `trip_id`, exclusively | A9, C7 | Schedule → attributions.txt |

## Lifecycles & events

**GTFS's whole answer to "plan vs execution" is one field name reused at two grains:
`schedule_relationship`.**

**Trip grain** (`TripDescriptor.schedule_relationship`, Realtime → enum
ScheduleRelationship):

| value | meaning (source's words, abbreviated) |
| --- | --- |
| `SCHEDULED` | "running in accordance with its GTFS schedule, or close enough to the scheduled trip to be associated with it" |
| `CANCELED` | "existed in the schedule but was removed" |
| `DELETED` | removed **and must not be shown to users** — "DELETED should be used instead of CANCELED to indicate that a transit provider would like to entirely remove information about the corresponding trip from consuming applications, so the trip is not shown as cancelled to riders, e.g. a trip that is entirely being replaced" |
| `REPLACEMENT` | "replaces an existing scheduled trip… the original schedule from the GTFS static isn't used for the replaced instance. REPLACEMENT… **must not be used to communicate real-time schedule deviations (predictions)**" |
| `DUPLICATED` | "the same as an existing scheduled trip except for service start date and time" |
| `NEW` | "An extra trip unrelated to any existing trips" |
| `UNSCHEDULED` | a frequency-based trip (`frequencies.txt` with `exact_times = 0`) |
| `ADDED` | **deprecated** — "This value has been deprecated as the behavior was unspecified. Use DUPLICATED… or NEW…", with a published migration guide |

**Stop grain** (`StopTimeUpdate.schedule_relationship`): `SCHEDULED` (default),
`SKIPPED`, `NO_DATA`, `UNSCHEDULED`.

Three things make this rigorous rather than a status string list:

1. **Precedence is stated.** "If the trip is canceled or deleted, no stop_time_updates
   need to be provided. If stop_time_updates *are* provided for a canceled or deleted
   trip then the **trip.schedule_relationship takes precedence** over any
   stop_time_updates and their associated schedule_relationship."
2. **Propagation is stated, per value.** `SKIPPED` "is not propagated to subsequent
   stops in the same trip… Delay from a previous stop in the trip *does* propagate over
   the SKIPPED stop." `NO_DATA` by contrast "is propagated through subsequent stops so
   this is the recommended way of specifying from which stop you do not have realtime
   timing information."
3. **The distinctions are drawn by consequence, not taxonomy.** `CANCELED` vs `DELETED`
   differs only in what the rider should be shown. `REPLACEMENT` vs a plain delayed
   `SCHEDULED` trip is defined by whether the static schedule still applies.

**Reason codes.** GTFS puts the *why* on Alerts, not on stop events: `Cause` ∈
{UNKNOWN_CAUSE, OTHER_CAUSE, TECHNICAL_PROBLEM, STRIKE, DEMONSTRATION, ACCIDENT,
HOLIDAY, WEATHER, MAINTENANCE, CONSTRUCTION, POLICE_ACTIVITY, MEDICAL_EMERGENCY,
SPECIAL_EVENT}; `Effect` ∈ {NO_SERVICE, REDUCED_SERVICE, SIGNIFICANT_DELAYS, DETOUR,
ADDITIONAL_SERVICE, MODIFIED_SERVICE, OTHER_EFFECT, UNKNOWN_EFFECT, STOP_MOVED,
NO_EFFECT, ACCESSIBILITY_ISSUE}; `SeverityLevel` ∈ {UNKNOWN_SEVERITY, INFO, WARNING,
SEVERE}. The **cause/effect split is the interesting part** — one enum for what
happened, an independent one for what it does to service — and each has a
`*_detail` free-text companion gated on the enum being present ("If cause_detail is
included, then Cause must also be included"). An Alert is scoped by `EntitySelector`
(agency / route / route_type / trip / stop / direction), not attached to one trip.

**A disruption is modelled twice, deliberately.** The rider-facing `Alert` and the
machine-facing `TripModifications` are separate entities, linked by
`Modification.service_alert_id` — "An id value from the FeedEntity message that
contains the Alert describing this Modification **for user-facing communication**."
The structured detour carries `start_stop_selector`, `end_stop_selector`,
`replacement_stops[]`, and `propagated_modification_delay` ("The number of seconds of
delay to add to all departure and arrival times subsequent to the last stop inserted by
a modification… If multiple modifications apply to the same trip, the delays
accumulate as the trip advances").

**Telemetry stops here.** `VehiclePosition` carries `position` (lat/lon/bearing/odometer/
speed), `timestamp` ("Moment at which the vehicle's position was measured"),
`current_stop_sequence`, `stop_id` and `current_status`. It makes **no business
assertion** — it never says "arrived", only `STOPPED_AT` with respect to a stop
sequence index. The business-grade statement lives in `TripUpdate`, where a past event
is expressed as a `StopTimeEvent` whose `uncertainty` is 0. **That is the whole
telemetry/event boundary:** position is a measurement with a measurement timestamp;
an arrival is a `StopTimeEvent` at a `stop_sequence` whose uncertainty says whether it
was observed or predicted.

## Time, identity, evidence

**Time — the strongest part of the source.**

- **Three distinct time types, not one timestamp.** `Date` ("Service day in the
  YYYYMMDD format"), `Time` ("measured from 'noon minus 12h' of the service day",
  may exceed 24:00:00), and `Local time` ("a wall-clock time shown in the local time of
  the specified location"). Date-only vs instant vs wall-clock are different types with
  different rules (Schedule → Field Types).
- **Service day ≠ calendar day**, and the >24:00:00 convention exists precisely so that
  a trip that crosses midnight stays one ordered sequence (Schedule → Term Definitions;
  worked example in trips.txt "Example: Blocks and service day", where trip_3 runs
  24:00:00–24:55:00 and belongs to Friday).
- **Time zone is resolved by an explicit rule with a stated reason.** "The times
  provided in stop_times.txt are in the timezone specified by `agency.agency_timezone`,
  **not** `stop_timezone`. This ensures that the time values in a trip always increase
  over the course of a trip, regardless of which timezones the trip crosses"
  (Schedule → stops.txt, `stop_timezone`). Stops still *carry* a local zone; it is just
  not what the schedule is expressed in.
- **Planned / estimated / actual, precisely:** the plan is `stop_times.arrival_time` /
  `departure_time`, qualified by `timepoint` (exact vs interpolated — i.e. the *plan
  itself* is marked for confidence). The estimate is `StopTimeEvent.time` and/or
  `.delay`, with a stated precedence rule: "If both time and delay are specified,
  **time will take precedence** (although normally, time, if given for a scheduled trip,
  should be equal to scheduled time in GTFS + delay)". The actual is the same
  `StopTimeEvent` for a past event: "In most cases information about past events is a
  **measured value** thus its uncertainty value is recommended to be 0."
- **Windows** exist as a first-class alternative to point times:
  `start_pickup_drop_off_window` / `end_pickup_drop_off_window` for demand-responsive
  service, mutually **forbidden** with `arrival_time`/`departure_time` — you commit to
  a point or to a window, never both.
- **Trip-level vs stop-level delay has a precedence rule too:** "Delay information in
  StopTimeUpdates take precedent of trip-level delay information, such that trip-level
  delay is only propagated until the next stop along the trip with a StopTimeUpdate
  delay value specified."
- **Three separate freshness clocks:** `FeedHeader.timestamp` (when this feed was
  built), `TripUpdate.timestamp` ("The most recent moment at which the vehicle's
  real-time progress was measured to estimate StopTimes in the future"), and
  `VehiclePosition.timestamp` (when the position was measured). The spec explicitly
  asks for TripUpdate.timestamp "in order to evaluate the freshness of the data".

**Identity.**

- **ID fields are typed by role**, with a naming convention: "An ID is labeled 'unique
  ID' when it must be unique within a file… IDs that reference an ID in another table
  are labeled '**foreign ID**'" (Schedule → Field Types). Every file declares a
  **primary key**, including composite ones (`stop_times.txt` PK is
  `(trip_id, stop_sequence)`) and the degenerate cases: "Primary key (*) is used when
  all provided fields for a file are used to uniquely identify a row. Primary key
  (none) means that the file allows only one row."
- **Identifying a trip *instance* is treated as a hard problem and solved explicitly**
  (Realtime → message TripDescriptor): `trip_id` alone is enough only sometimes; it is
  insufficient for frequency-based trips (needs `start_date` + `start_time`), for trips
  lasting >24 h, and for trips "delayed such that [they] would collide with a scheduled
  trip on the following day". If `trip_id` is unavailable, `route_id` + `direction_id` +
  `start_date` + `start_time` together identify the instance. And the failure mode is
  named: "If the TripDescriptor does not resolve to a single trip instance (i.e., it
  resolves to zero or multiple trip instances), it is **considered an error** and the
  entity containing the erroneous TripDescriptor may be discarded by consumers."
- **Stop identity inside a trip** is disambiguated the same way: "stop_sequence is
  required for trips that visit the same stop_id more than once (e.g., a loop)."
- **No cross-party identity at all.** One publisher owns every id in the feed; there is
  no place to record a partner's identifier for the same trip. `agency_id` "identifies
  a transit brand"; that is the extent of multi-party reference.

**Evidence, provenance, corrections.**

- **Confidence is a field**: `timepoint` on the plan, `uncertainty` on every prediction.
  A consumer can tell a measurement from a guess without being told who produced it.
- **Corrections are wholesale replacement.** `FULL_DATASET` means "this feed update
  will overwrite all preceding realtime information for the feed" — a correction is
  simply the next snapshot, and there is no retraction event, no supersedes link, and no
  history. `DIFFERENTIAL` exists in the enum but is "currently… unsupported and behavior
  is unspecified".
- **Provenance is coarse.** `attributions.txt` attributes data to an agency, route, or
  trip ("If one agency_id, route_id, or trip_id attribution is defined, the other ones
  must be empty"), plus roles (producer / operator / authority). `feed_info.txt` carries
  `feed_publisher_name`, `feed_version`, and `feed_start_date`/`feed_end_date` — and the
  date range is described as an *assertion*: "If feed_start_date or feed_end_date extend
  beyond the active calendar dates… the dataset is **making an explicit assertion that
  there is no service** for dates within the range but not included in the active
  calendar dates." That is a nice piece of stating what a silence means.
- **Nobody signs a fact.** There is no actor on a StopTimeUpdate, no "the driver
  reported this", no evidence artefact. The agency is the sole author by construction.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A3 Trip, stop & assignment | 3 | 3 | 2 | 0 | 3 | 2 | 1 | 2 | Ordered stop sequence with a non-consecutive-increasing rule; route/trip/stop_time/leg/journey all defined in one sentence each (Schedule → Dataset Files, Term Definitions); `block_id` for vehicle continuity across trips and `transfer_type` 4/5 linked trips with n-to-1 coupling; `shapes.txt` for the path; station/platform hierarchy. C3=2: the schedule itself has no trip lifecycle — the states arrive from Realtime's `schedule_relationship`. C4=0: no goods on the trip at all; assignment is to a *vehicle class*, never a named driver or crew. C6=2: strong on trip-*instance* identity, nil on cross-party. C7=1: attributions only. |
| A4 Execution events & tracking | 3 | 3 | 3 | 0 | 3 | 2 | 2 | 3 | The reference example for keeping plan and execution in one model. TripUpdate/StopTimeUpdate as deltas against `stop_times`; two `schedule_relationship` enums with **stated precedence and propagation**; `VehicleStopStatus` INCOMING_AT/STOPPED_AT/IN_TRANSIT_TO as the arrive/depart boundary; Alert cause+effect+severity with free-text detail gated on the enum. C5=3 on scheduled/predicted/delay/uncertainty/measured-past plus three freshness clocks. C7=2: `uncertainty` and `timepoint` carry confidence and `FULL_DATASET` is a coherent correction model, but no actor asserts anything and there is no retraction. C8=3: `gtfs_realtime_version`, protobuf, field-level "Caution: this field is still experimental", and deprecation-with-migration-guide (`ADDED` → `NEW`/`DUPLICATED`). |
| A5 Storage-in-transit | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. The nearest structure is a layover between two trips of a block, which is vehicle idle time, not custody of goods at a facility. The registry lists A5 for this source; on a full read that is **not** supported — recommend dropping A5 from its registry `areas`. |
| A6 Documents & evidence | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | No document concept. `TranslatedImage` on an Alert is an illustration, explicitly "must not be the only location of essential information". |
| A7 Charges & billing hooks | 1 | 2 | 0 | 0 | 2 | 1 | 0 | 2 | GTFS-Fares v2 (`fare_products`, `fare_media`, `rider_categories`, `fare_leg_rules`, `fare_leg_join_rules`, `fare_transfer_rules`, `timeframes`, `areas`, `networks`) is a substantial *rating* model, which the rubric puts in A12, not A7. There is **no charge event, no invoice, no billing hook** — fares are computed by the consumer from rules, never asserted per journey. C5=2 for `timeframes.txt` making fares time-of-day/date dependent. Detail recorded under Out-of-v1. |
| A8 Parties & roles | 1 | 1 | n/a | 0 | n/a | 1 | 1 | 1 | `agency.txt` only: "Identifies a transit brand which is often synonymous with a transit agency. Note that in some cases, such as when a single agency operates multiple separate services, agencies and brands are distinct" — a brand/operator distinction is acknowledged and then not modelled. `attributions.txt` adds `is_producer` / `is_operator` / `is_authority` roles over data, not over the move. No driver, no crew, no customer, no counterparty. |
| A9 Identity & cross-references | 2 | 3 | n/a | 0 | n/a | 2 | 1 | 2 | C2=3 on the "unique ID" / "foreign ID" typing convention, the per-file declared primary key including composites and the `(*)` / `(none)` degenerate cases, and above all the `TripDescriptor` instance-resolution rules with a declared error outcome for ambiguity. C6=2: excellent *within* one publisher's namespace, absent *across* publishers — there is nowhere to put a partner's id for the same trip. C4=0: no external identifier schemes of any kind. |

**S5 — fit to Pegasus data.** Not assessable from this source: this analysis read no
Pegasus II or Cloud schema. **A3/A4 `unknown`**, all other areas `n/a` (the source does
not cover them). One note for phase 3: GTFS's central assumption — that a published,
rider-visible schedule exists and every prediction is expressed as a deviation from it
— is the question to ask of our data. If pegII stores only a single date per stop and
overwrites it, then `delay` has no referent and only the OTM-style "keep both readings"
mechanism is available to us. Flagged as a hypothesis, not a finding.

## Strengths worth adopting

1. **One field name, two grains, with stated precedence.** `schedule_relationship` at
   trip level and at stop level, and an explicit rule for which wins. Our catalogue will
   have the same problem (a cancelled shipment vs a skipped stop) and the answer should
   be written down the same way, not discovered by consumers.
2. **Propagation semantics as part of a code's definition.** "SKIPPED is not propagated
   to subsequent stops… delay *does* propagate over the SKIPPED stop"; "NO_DATA is
   propagated through subsequent stops". A status code that does not say what it implies
   about the codes after it is under-specified. Copy the habit.
3. **`NO_DATA` as a first-class value.** "We are not tracking this stop" is different
   from "on time" and different from "skipped". Any HHG tracking vocabulary needs this
   and usually omits it.
4. **`uncertainty` on every predicted time, with `0` meaning observed.** One field
   distinguishes a measurement from a projection without a separate record type — a
   genuinely cheaper alternative to OTM's lifecycle axis, and the two should be compared
   head-to-head in phase 3 (A4).
5. **`timepoint`: mark confidence on the *plan*, not just on the prediction.** Some
   planned stop times are committed and some are interpolated filler. HHG has exactly
   this (a committed load date vs a notional intermediate stop) and pegII almost
   certainly does not record the difference.
6. **`stop_sequence` must increase but need not be consecutive.** Insertion of a stop
   never renumbers the trip, so no downstream reference breaks. Free stability; take it.
7. **Committed point time XOR service window, enforced.** `arrival_time` is *forbidden*
   when a pickup/drop-off window is given. HHG lives on spreads and windows; making them
   mutually exclusive with a point time prevents the classic "which one is the promise?"
   ambiguity.
8. **Time zone resolved by rule, with the reason stated** — times expressed in the
   agency's zone "so that the time values in a trip always increase… regardless of which
   timezones the trip crosses", while stops still carry their local zone. A cross-country
   HHG move has the identical problem, and this is the cleanest published answer to it.
9. **Three time *types*** (service `Date`, `Time` that may exceed 24:00:00, wall-clock
   `Local time`) rather than one timestamp type used three ways.
10. **`CANCELED` vs `DELETED` distinguished by what the audience should see.** A status
    whose definition is "and this is what the customer is shown" is more useful than one
    defined structurally. Worth an explicit pass over our own cancellation vocabulary.
11. **Separate the machine-readable change from the human-readable notice, and link
    them.** `TripModifications` (structured detour with replacement stops and accumulated
    propagated delay) references the `Alert` that explains it to riders via
    `service_alert_id`. Our exception events and our customer-facing notifications should
    be related the same way, not conflated.
12. **A declared primary key per file, plus "Conditionally Forbidden" as a presence
    class.** Stating what must *not* be present under a condition is as valuable as
    stating what must — and it is how GTFS keeps mutually exclusive representations from
    coexisting.
13. **Field-level maturity markers** ("Caution: this field is still experimental, and
    subject to change") and deprecation with a published migration guide. A versioned
    event catalogue needs exactly this per-field, not per-release.
14. **Naming the ambiguity failure.** "If the TripDescriptor does not resolve to a single
    trip instance… it is considered an error and the entity… may be discarded." Saying
    what a consumer should do with an unresolvable reference belongs in our catalogue too.

## Weaknesses / traps

- **A GTFS trip is a recurring template, ours is a one-off job.** `trips.txt` +
  `service_id` + `calendar.txt` exist because the same trip runs every Tuesday. An HHG
  trip happens once. Importing the template/instance split — or the `service_id` and
  calendar machinery — would add a whole dimension that models nothing in our domain.
  The trip-instance identity rules in `TripDescriptor` are *entirely* a consequence of
  this, and lose their motivation for us.
- **A GTFS trip carries no cargo.** There is no consignment, no load/unload, no custody
  transfer, no "which shipment is on this vehicle". The single most important join in our
  A3 — trip ↔ shipment — has no GTFS analogue, so the source cannot be used to design it
  and must not be used to argue it is unnecessary.
- **Delay presumes a published schedule the audience already trusts.** `delay` is
  meaningless without `stop_times`. HHG promises are spreads and windows negotiated per
  order, often revised; "12 minutes late" is not the shape of the customer statement we
  need. Take `uncertainty`; be very careful with `delay`.
- **Realtime is a stateless snapshot with no history.** `FULL_DATASET` "will overwrite
  all preceding realtime information". There is no event log, no supersedes link, no
  retraction, no "who changed this". A domain **event catalogue** is the opposite kind of
  artefact — durable, append-only, attributable. Do not let the feed shape leak into the
  catalogue shape.
- **Single-publisher, single-author by construction.** No actor asserts a fact; no
  partner identifier has anywhere to live. In HHG the *same* arrival is asserted by the
  driver's ELD, the hauling agent, and the destination agent, sometimes inconsistently.
  GTFS offers nothing here and will quietly encourage a model with one writer.
- **`block_id` is not a leg model.** It is vehicle continuity across timetable entries.
  Reading it as "multi-leg shipment" would be a category error.
- **Stops are public infrastructure with stable ids** (a platform, a station). Our stops
  are residences and warehouses, created per order, and a `stops.txt`-shaped master list
  of them is the wrong default — though `location_type` + `parent_station` is a genuinely
  good pattern for a warehouse with docks.
- **No exception has an operational reason code.** `Alert.Cause` is about network
  disruption (STRIKE, WEATHER, POLICE_ACTIVITY) and is scoped to a route or agency, not
  to one stop event. HHG needs a per-event reason at the stop (shipper not ready, no
  parking, elevator unavailable, shuttle required) and GTFS has no slot for it.
- **`SKIPPED` ≠ "we did not deliver".** In transit, skipping a stop harms nobody's
  contract. Reusing the word for a missed HHG delivery would import a reassuring
  connotation onto a serious event.
- **Evidence grade note:** everything above is grade A for the two reference pages, but
  the pages document the *format*; they do not show how agencies actually populate it.
  Nothing here is evidence about implementation practice.

## Out-of-v1 material

- **A12 (rating & tariffs) — the most valuable out-of-v1 find.** GTFS-Fares v2 is a
  complete, public, rules-table rating model worth studying when A12 is built:
  `fare_products.txt` (the purchasable thing), `fare_media.txt` (how it is carried —
  separate from the product), `rider_categories.txt` (elderly/student), `areas.txt` +
  `stop_areas.txt` and `networks.txt` + `route_networks.txt` (the geography and service
  groupings a rule can match on), `timeframes.txt` (date/time-dependent pricing, with its
  own "Timeframe Local Time Semantics" section), `fare_leg_rules.txt` (price a leg by
  matching network/from-area/to-area/timeframe), `fare_transfer_rules.txt` (price the
  *junction* between two legs — transfer count, duration, and cost combination), and
  `fare_leg_join_rules.txt` with the **Effective Fare Leg** concept ("a sub-journey of
  two or more legs that should be treated as a single leg for matching rules… for the
  purposes of fare calculation"). The architecture — *rate a leg, then separately rate
  the join between legs, with an explicit rule for when several legs count as one* — is
  a strong analogue for line-haul plus accessorials plus interline splits. Cite: Schedule
  → the fare_* files and Term Definitions.
- **A1 (booking), on-demand service:** `booking_rules.txt` models how far ahead a
  rider-requested trip must be booked — `booking_type` (0 real-time / 1 same-day with
  advance notice / 2 prior day(s)), `prior_notice_duration_min` / `_max`,
  `prior_notice_last_day`, `prior_notice_last_time` ("Ride must be booked 1 day in
  advance before 5PM" → `prior_notice_last_day=1`), plus service-day and start-day
  qualifiers. A compact, declarative model of *lead time as data*, directly relevant to
  HHG booking windows and cut-offs.
- **Facility modelling (warehouses, later):** `pathways.txt` and `levels.txt` model the
  inside of a station as a graph of walkable links with traversal times and physical
  attributes. If warehouse operations ever needs dock/bay/aisle structure, this is the
  reference pattern; `location_type` + `parent_station` is the same idea one level up.
- **Accessibility as first-class data** (`wheelchair_accessible` on trips,
  `wheelchair_boarding` on stops, text-to-speech companion fields throughout, a defined
  `Text-to-speech field` type). Not our domain, but a good example of a cross-cutting
  attribute carried consistently at every grain instead of in a notes field.
- **`translations.txt`** — a general mechanism for translating any field of any record by
  (table, field, record id), rather than per-entity language columns. Relevant if the
  catalogue ever carries customer-facing text.

## Open questions

1. **Deviation-from-plan (GTFS `delay` + `uncertainty`) or parallel readings of the same
   fact (OTM `lifecycle`)?** These are the two coherent answers to A4/C5 in this cluster
   and they are mutually exclusive in practice. GTFS's is cheaper and depends on a stable
   published plan; OTM's is heavier and survives a plan that is constantly renegotiated —
   which is the HHG case. Phase 3 (A4) must choose, with the weighting written down.
2. **Do we need `NO_DATA`, and what is our equivalent of `timepoint`?** Both encode
   "we do not actually know", which HHG systems habitually render as a confident empty
   field. Requires a pegII read to answer.
3. **Who asserts an execution event in our domain, and can one event have competing
   assertions?** GTFS structurally cannot ask this (one publisher); OTM half-answers it
   (`actors` on events). Neither trip-shaped source resolves it, and HHG needs it — the
   driver's ELD, the hauling agent and the destination agent all report the same arrival.
   Take this to the EDI 214 / visibility-platform sources.
4. **What is the analogue of a *window* in our promises** — is a delivery spread a
   window on a stop, a constraint on the order, or both? GTFS forbids a point time when a
   window is present; OTM carries the window as a separate `timeWindowConstraint`
   alongside point times. Two different answers; we need one.
5. **Registry correction (for the orchestrator; not edited here):** the entry lists
   `areas: [A3, A4, A5]`. A full read finds **no** storage-in-transit material — suggest
   `[A3, A4]`, optionally noting A12 for the fare subsystem recorded above.
6. **Should `gtfs-realtime.proto` be captured?** The reference pages are normative for
   field semantics, but the .proto carries wire cardinality and the extension mechanism,
   which is what a C8 judgement on the *extensibility* of the format should really rest on.
