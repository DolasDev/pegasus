---
source: src:project44
analyzed: 2026-09-17
evidence_grade: B
material: |
  sources/project44/local/p44-api-v4.json — project44 REST API v4.0.0, OpenAPI 3.x,
    53 971 lines / 2.0 MB, 136 paths, 734 component schemas, 54 tags.
    sha256 f7b6fdc05aa8c1932984fdd8ecf0deb4acdabd5a8c78ff6c8bba2f5c7b767563
    (the registry records no sha256 for this file — orchestrator should add it).
    Retrieved per registry from
    https://developers.project44.com/_spec/api-reference/@v4/api-docs.json?download
  NOT read: the narrative developer guides the spec itself points at
    (https://developers.project44.com/guides/shippers, /guides/carriers, the webhook
    guide, tracking-method onboarding docs). Those carry project44's own prose
    explanation of how tracking is established; everything below is read off the
    machine-readable contract only.
---

# project44 API v4 — analysis

## What it is

project44 is a commercial **real-time transportation visibility platform** (RTVP).
Its v4 REST API is the integration surface a shipper or broker uses to hand p44 a
shipment, let p44 acquire position data from the carrier by whatever means it can,
and read back a normalised stream of events, states, ETAs and exceptions. The
document's own framing: *"Version 4.0.0 of project44's API… we recommend checking
out our guides first"* (`local/p44-api-v4.json`, `info.description`), licensed
`"© 2024 project44 - Terms of Use"` (`info.license`).

**S1 kind:** `vendor-api`. **S2 adoption: 3** for what it is — p44 is one of the two
platforms a large shipper is most likely to mandate, and the API is versioned, dated
(2024) and evidently in production. **S3 openness:** `public` (the spec downloads
without login; the licence is a terms-of-use, not an open licence — hence `local/`,
not `captured/`).

**What our reading covered.** The complete schema and path inventory (all 734 schema
names, all 136 paths with tags and summaries), then the **full text of every schema
material to A3, A4, A6 and A9** — the event, state, milestone, stop, status,
exception, identifier, tracking-method, document and party models. Every enum quoted
below is read directly from the file. **What we did not see:** the developer guides
(above), any sample payload beyond the `example` values embedded in the spec, and any
statement of retention or correction policy — p44 documents *fields*, not *rules*.
Several descriptions ship as unrendered template placeholders (e.g.
`"${ShipmentPlan.apiModel.class.value}"`, `"${MobileTrackingEventDetails.apiModel.code.value}"`),
so some concepts are present as a name with **no definition at all**. Evidence grade
is **B** for that reason: we read the authoritative artefact, but the artefact
withholds the prose.

**Multi-modal caveat.** v4 is one API over seven modes (`AIR`, `OCEAN`, `RAIL`,
`TRUCKLOAD`, `PARCEL`, `LTL`, `BARGE` — `TransportationMode`). Much of the vocabulary
is ocean/air (gate-in/gate-out, rollover, demurrage). The truckload and LTL subsets
are the ones that matter to us and are called out as such below.

## Model summary

p44's spine, in its own nouns:

```
TrackedShipment (id = "master shipment id", uuid)
  identifiers[]        LogisticsIdentifier {type ∈ 70-value enum, value}
  routeInfo
     stops[]           TrackedShipmentStop {id(uuid), location, type}
     routeSegments[]   TrackedShipmentRouteSegment {fromStopId, toStopId,
                                                    transportationMode, identifiers[]}
  events[]             TrackedShipmentEvent {type ∈ ~90-value enum, stopId,
                                             routeSegmentId, plannedDateTime,
                                             estimateDateTime, dateTime,
                                             receivedDateTime, dateTimes[], details}
  states[]             TrackedShipmentState {type, startDateTime, endDateTime, stopId}
  milestones[]         ShipmentMilestone  (derived: eventType × positional stop)
  exceptions[]         ShipmentException {namespace, category, reason, timeline[]}
  attributes[]         CustomAttribute (≤ 25, user-defined)
Load  ── masterShipmentId, pickupStopReference, deliveryStopReference
```

Three structural decisions are worth naming before anything else.

**1. A shipment is a stop list; a *route segment* is the thing between two stops.**
`RouteSegment` is *"A portion of the journey through which a shipment is meant to
travel, defined by its nodes: the 'to' and 'from' stops"*
(`components.schemas.RouteSegment`) and `TrackedShipmentRouteSegment` *"Describes how
a shipment moved between 2 stops"*, carrying its own `transportationMode` and its own
`identifiers` — *"Identifiers that are not part of the overall shipment but are
relevant to this route segment."* `ShipmentRouteInfo` states the invariant: *"There
will always be 1 fewer route segment than number of stops."* Events point at a
segment as well as a stop: `TrackedShipmentEvent.routeSegmentId` — *"this will be
populated with the id of a route segment on which this event occurred. **This can be
used to associate the event with a specific vehicle**"* (`:49595`). **p44's answer to
"trip vs shipment" is therefore: the shipment is the subject, the vehicle is an
attribute of a segment, and there is no trip entity at all.**

**2. `Load` is the only thing shaped like our shipment-on-a-trip — and it is the
inverse operation.** *"A collection of goods that are being moved strictly from point
A to point B. The collection of goods may contain many orders and many items of
inventory and there is a single consignee for the load. The load is tied to a
shipment and **exactly two stops**."* (`:34845`) — with `pickupStopReference` /
`deliveryStopReference`, its own `identifiers[]` and its own `involvedParties[]`. A
load **divides** a multi-stop shipment into A→B pieces; it never joins two shipments.

**3. A milestone is a *derivation*, not an event.** `ShipmentMilestone.type` is
documented as a list of formulae: `ARRIVAL_AT_EXPORT_WAREHOUSE` = *"ARRIVAL_AT_STOP
event at ORIGIN stop"*; `LOAD_AT_FIRST_PORT` = *"LOAD event at the first
PORT_OF_LOADING stop in the route"*; `LAST_FREE_DAY_DEMURRAGE_AT_LAST_PORT` =
*"LAST_FREE_DAY event with event description 'Import Demurrage' at the last
PORT_OF_DISCHARGE stop"* (`:45515`). **A milestone is `(event type × positionally
identified stop)`, named once and given a stable time tuple.** That separation — raw
events below, a small named vocabulary of business milestones above — is the single
most reusable idea in this source.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite (`local/p44-api-v4.json`) |
| --- | --- | --- | --- |
| `TrackedShipment` | *"Shipment tracking model used to initiate a shipment."* `id` is the *"Master shipment id"* | A2, A9 | `components.schemas.TrackedShipment` |
| `Load` | *"A collection of goods… moved strictly from point A to point B… tied to a shipment and exactly two stops."* | A2, A3 | `:34845` |
| `capacity provider` | p44's word for carrier throughout (`CapacityProvider`, `capacityProviderAccountGroup`, `TruckloadCapacityProviderTenderDecline`) | A8 | `components.schemas.CapacityProvider` |
| `TrackedShipmentStop.type` | 16 values: `ORIGIN`, `DESTINATION`, `TRANSFER`, `OTHER`, `PICKUP`, `DELIVERY`, `RETURN`, `WAREHOUSE`, `HUB`, `AIRPORT`, `PORT_OF_LOADING`, `ORIGIN_CFS`… | A3 | `:49978` |
| `TruckloadShipmentStop.stopType` | truckload subset: `PICKUP`, `DELIVERY`, `DELIVERY_PICKUP` | A3 | `:51723` |
| `stopNumber` | *"The user-defined stop number, where '1' is for the origin and the destination has the largest number, with any stops in between **ordered by appointment time**"* | A3 | `:51723` |
| `TruckloadShipmentStop.uuid` | stable stop identity **plus a written natural key**: *"two shipment stops are considered effectively the same if they match across stop number, tenant location id, stop name, stop type, and involved parties"* | A3, A9 | `:51723` |
| `appointmentWindow` (LTL) | *"These appointment windows are the **requested** appointment windows found on the bill of lading. If the stop type is 'ORIGIN', it is a requested pickup appointment window…"* | A3, C5 | `:35574` (`LtlCapacityProviderPushShipment.shipmentStops.description`) |
| `additionalAppointmentWindows` | user-defined extra windows on a stop; *"The associated appointmentWindow values will always be the **default window in terms of measuring on time performance**"*; carries an IANA zone id (*"'America/Chicago'"*), defaulting to *"the timezone local to the stop"* | A3, C5 | `:51723` |
| `RouteSegment` | *"A portion of the journey… defined by its nodes: the 'to' and 'from' stops."* | A3 | `components.schemas.RouteSegment` |
| `TrackedShipmentEvent` | *"An event is something that occurs at a point in time for a shipment."* ~90-value `type` enum | A4 | `:49595` |
| `TrackedShipmentState` | a *duration*: `{type, startDateTime, endDateTime, stopId, routeSegmentId}`; `type` ∈ `AT_STOP`, `IN_TRANSIT`, `IN_TRANSIT_VESSEL`, `IN_TRANSIT_RAIL`, `IN_TRANSIT_AIRCRAFT`, `CUSTOMS_HOLD`, `COMPLETED`, `SCHEDULED`, `IDLE`, `ACTION_REQUIRED` | A4 | `:49935` |
| `ShipmentMilestone` | derived named milestone = event type × positional stop; carries the full time tuple (below) | A4, C5 | `:45515` |
| `TrackedShipmentDateTime` | *"A dateTime for the event provided by a certain source."* — `{type, source, sourceIdentifiers[], selected, sequence, id, lastModifiedDateTime, dateTime, endDateTime}` | A4, A9, C7 | `:49524` |
| `type` (on a dateTime) | *"PLANNED - Denotes that a dateTime is planned or scheduled to occur. ACTUAL - Denotes that a dateTime actually occurred. ESTIMATE - Denotes that a dateTime is a calculated estimate."* | C5 | `:49524` |
| `source` (on a dateTime) | `CARRIER`, `BROKER`, `FFW`, `USER` (*"Can only provide this value in POST/PUT"*), `CONTRACT` (*"Contractually defined dateTime"*), `GEOFENCE` (*"provided by GEOFENCE logic"*), `FACILITY`, `P44` (*"calculated by other P44 services"*), `NVOCC`, `UNKNOWN` | C7 | `:49524` |
| `timelinessCode` / `arrivalCode` | `UNKNOWN`, `EARLY`, `ON_TIME`, `LATE` — *"The arrival status is **relative to the user-defined appointment window** for the stop"* | A4, C5 | `:49295`–`:49360`, `:51789` |
| `ArrivalStatus` | the same four codes **plus a `duration`** — how early/late, not merely whether | A4 | `components.schemas.ArrivalStatus` |
| `deltaActual` / `deltaEstimated` | *"The difference in time, in minutes, between the planned time of this event and its actual [estimated] time. A positive value represents later than planned."* | A4, C5 | `:45515` |
| `initialPlannedDateTime` vs `plannedDateTime` | *"The **initial** planned date and time"* vs *"The **latest** planned date and time"*, each split by asserter: `carrierInitialPlanned…`, `customerInitialPlanned…`, `carrierLatestPlanned…`, `customerLatestPlanned…` | C5, C7 | `:45515` |
| `receivedDateTime` | *"The time when project44 **received or calculated** this event"* — distinct from `dateTime`, the occurrence | C5, C7 | `:49595` |
| `TruckloadShipmentStatusUpdate.statusCode` | `DISPATCHED`, `IN_TRANSIT`, `AT_STOP`, `COMPLETED`, `TRACKING_FAILED`, `INFO`, `DELETED` | A4, C3 | `components.schemas.TruckloadShipmentStatusUpdate` |
| `TruckloadShipmentStopStatus.statusCode` | `UNKNOWN`, `EN_ROUTE`, `ARRIVED`, `DEPARTED` — *"the status of the vehicle **relative to this stop**"* | A3, A4 | `:51789` |
| `TruckloadTrackingMethodDetails.trackingType` | *"Type of the tracking data source."* — **`MOBILE_PHONE`, `TELEMATICS`, `API`** | A4, C7 | `:52139` |
| `equipmentIdentifierSource` | `CUSTOMER`, `CARRIER`, `AUTOMATIC` | A9, C7 | `:52139` |
| `TruckloadShipmentTrackingMethods` | *"An **ordered** list of tracking methods that can be used to track a shipment, with the **most robust** method available listed first."* | A4 | `components.schemas.TruckloadShipmentTrackingMethods` |
| `ShipmentException` | *"Exception is a recorded fact that something is going wrong or went wrong along the shipment journey"* — `{namespace, category, reason, status, definitionId, timeline[]}` | A4, C7 | `:45061` |
| `namespace` (on an exception) | `TRUCKLOAD_TRACKING`, **`P44_DETECTED`**, **`CARRIER_REPORTED`**, `ROOT_CAUSE_ANALYSIS`, `DISRUPTION` | A4, C7 | `:45061` |
| `LogisticsIdentifier` | *"Any standardized 3rd party identifier. Can be used to identif[y] a shipment, freight, vehicle, carrier, or other freight entity."*; the type enum is *"The standard which defines **who assigns** the identifier and **what it identifies**"* | A9 | `:35454` |
| `LtlShipmentIdentifier.source` | `CUSTOMER` / `CAPACITY_PROVIDER`, with a written rationale: *"you can't control whether duplicates exist among the capacity-provider-sourced identifiers, but you can ensure on your end that all of your provided identifiers are unique"* | A9, C7 | `:36157` |
| `primaryForType` | *"The primary shipment identifier for a type will always be attempted before other identifiers of that type with the capacity provider."* | A9 | `:36157` |
| `DocumentEventDetails` | `{documentType, fileFormat, scope, url, **version: integer**}`; `scope` ∈ `SHIPPER`, `CARRIER`, `DRIVER` | A6, C7, C8 | `:31879` |
| `DocumentType` | 18 values incl. `BILL_OF_LADING`, `PROOF_OF_DELIVERY`, `DELIVERY_RECEIPT`, `WEIGHT_CERTIFICATE`, `INSPECTION_CERTIFICATE`, `LUMPER_CERTIFICATE`, `HAZMAT_DOCUMENT`, `OTHER` | A6 | `components.schemas.DocumentType` |
| `PartyType` | `SHIPPER`, `CONSIGNEE`, `BILL_TO`, `NOTIFY_PARTY`, `BOOKING_AGENT`, `CARRIER_BOOKING_OFFICE`; `Party.partyType` = *"The relationship **the shipper has** to the party"* | A8 | `components.schemas.PartyType`, `.Party` |
| `SharingContext` / `DataOriginator` | *"populated when the data is shared across tenants… which tenant(s) are involved with the shared data"* | A8, C7 | `components.schemas.SharingContext` |
| `CustomAttribute` on a shipment | *"An optional user-defined set of custom attributes"*, **maxItems 25** | C8 | `components.schemas.TrackedShipment` |

## Lifecycles & events

**Four parallel vocabularies for one journey, and p44 does not reconcile them.** This
is the most important structural fact about the source.

1. **Event types** — one ~90-value enum on `TrackedShipmentEvent.type`, repeated
   verbatim on `ShipmentMilestone.eventType` (`:49595`, `:45515`). It mixes at least
   five kinds of thing in one flat list:
   - *physical*: `ARRIVAL_AT_STOP`, `DEPARTURE_FROM_STOP`, `LOAD_ONTO_VEHICLE`,
     `UNLOAD_FROM_VEHICLE`, `PICKED_UP`, `DELIVERY`, `OUT_FOR_DELIVERY`, `HANDOVER`;
   - *geofence*: `ENTERED_GEOFENCE` / `EXITED_GEOFENCE` and inner/outer/final variants;
   - *custodial / commercial*: `RECEIVE_FROM_SHIPPER`, `RECEIVE_FROM_CARRIER`,
     `MANIFEST`, `ISSUE_FREIGHT_BILL`, `COST_UPDATE`, `DOCUMENT_ADD`, `DOCUMENT_REMOVE`;
   - *exceptions*: `EXCEPTION_DELAYED`, `EXCEPTION_DELIVERY_MISSED`, `EXCEPTION_HELD`,
     `EXCEPTION_PICKUP_MISSED`, `EXCEPTION_LATE_DEPARTURE`, `RETURN_TO_SENDER`;
   - *meta — about the tracking itself*: `TRACKING_INITIATE`, `TRACKING_START`,
     `TRACKING_COMPLETE`, `TRACKING_FAILED`, `TRACKING_END_DUE_TO_TIMEOUT`,
     `TRACKING_END_BY_USER`, `DRIVER_DENY_TRACKING`, `MISSING_EQUIPMENT_IDENTIFIER`,
     `SHARING_STOPPED`.

   There is **no definition of any of them** — the enum is bare. `UNKNOWN` is the
   first member of essentially every enum in the file.
2. **States** — `TrackedShipmentState` gives the same journey as a set of *intervals*
   with `startDateTime`/`endDateTime`, each optionally anchored to a stop or a segment
   (`:49935`). Events are points; states are spans; both are published.
3. **Mode-specific status + reason pairs** — and here, uniquely, p44 *does* write a
   transition constraint down, in prose, inside a field description
   (`TruckloadShipmentStatusReason.code`, `:51656`):

   > *"A status of 'DISPATCHED' will have one of the following reason codes:
   > 'PENDING_TRACKING_METHOD', 'SCHEDULED', 'PENDING_APPROVAL', 'PENDING_CARRIER' or
   > 'ACQUIRING_LOCATION'. A status of 'IN_TRANSIT' will have one of the following
   > reason codes: 'IN_MOTION' or 'IDLE'. A status of 'AT_STOP' will not have a
   > reason. A status of 'COMPLETED' will have one of the following reason codes:
   > 'APPROVAL_DENIED', 'TIMED_OUT', 'CANCELED', or 'DEPARTED_FINAL_STOP'."*

   That is a **status × reason product table expressed as a constraint** — the only
   place in the file where legal combinations of two code lists are stated. Note what
   the COMPLETED reasons reveal: *how a shipment stopped being tracked* and *how a
   shipment finished* are the same field. `TIMED_OUT` and `DEPARTED_FINAL_STOP` are
   not the same kind of ending.

   The LTL reason list is different again (`:36255`): `PICKUP_INFO`, `PICKED_UP`,
   `PICKUP_MISSED`, `INTERLINE_INFO`, `INTERLINE_MISSED`, `DEPARTURE_INFO`,
   `DEPARTURE_MISSED`, `HELD`, `DELAYED`, `DELIVERY_INFO`, `DELIVERY_MISSED`,
   `DELIVERY_APPOINTMENT`, `DELIVERED`, `EXCEPTION`, `CANCELED`, `TIMED_OUT`, plus
   four data-staleness codes `NOT_RECEIVING_DATA_12_TO_23` … `_MORE_THAN_72`.
   **`INTERLINE_INFO` / `INTERLINE_MISSED` is the closest thing in the whole source to
   an agent-to-agent interline handoff.**
4. **Per-stop vehicle status** — `EN_ROUTE` | `ARRIVED` | `DEPARTED`, with the
   invariant stated: *"One and only one status will always be returned for each stop.
   If the shipment does not have status 'COMPLETED' or 'DISPATCHED', this list will
   always contain one and only one stop status with a code of either 'EN_ROUTE' or
   'ARRIVED'"* (`TruckloadShipmentStatus.latestStopStatuses`). A real invariant, and a
   good one.

**Exceptions are a lifecycle of their own** (`:45061`). An exception has a `namespace`
(**who or what asserted it** — `P44_DETECTED` vs `CARRIER_REPORTED` vs
`ROOT_CAUSE_ANALYSIS`), a `category` (34 buckets: `RUNNING_LATE`, `HOLD`, `DWELL`,
`WEATHER`, `STRIKE`, `VISIBILITY_TELEMATICS`, `VISIBILITY_APP`, `TRANSIT_TIME`…), a
`reason` (*"the most granular enumeration"*, ~75 values from `REFUSED_DELIVERY`,
`ALL_SHORT` and `BAD_ORDER` to `DRIVER_DENIED_LOCATION_ACCESS` and
`VEHICLE_NEVER_ENTERED_GEOFENCE`), a two-value `status` (`ACTIVE` — *"The shipment
currently matches the exception criteria"* — / `RESOLVED`), a `definitionId` pointing
at *"the definition of the exception… a logic which determines how the exception would
be derived"*, and a `timeline[]` that *"timeframes the status transitions"*. **An
exception is a predicate over the shipment that turns on and off**, not an event — and
it is the one place p44 models both provenance and resolution.

**Tender / booking** (a small, separate corner). `BookingStatus` (`:28434`): *"Bookings
start out in a `PROCESSING` state, only to be `BOOKED` or `REJECTED` by a carrier. A
booking may enter the `UNDER_REVIEW` state after `PROCESSING` if the response must be
polled after request. The state may shift to `CANCELLED` due to actions caused by
**either party** in any state. A booking is `EXPIRED` if it sits in the `PROCESSING` or
`UNDER_REVIEW` status upon the time which it is set to expire."* — the only place in
the file with states, transitions *and* actor attribution. Rejection carries a typed
reason (`BookingRejectionReason`: `COST_NOT_AGREED`, `SHORT_ON_STAFF`,
`NOT_WITHIN_SCOPE`, `TRANSIT_TIME_TOO_SHORT`, `REQUESTED_EQUIPMENT_NOT_AVAILABLE`,
`OTHER`), and the truckload tender push has its own decline vocabulary (`:50734`:
`DECLINED_CAPACITY_TYPE`, `DECLINED_CAPACITY_UNAVAILABLE`, `DECLINED_EQUIPMENT_TYPE`,
`DECLINED_EQUIPMENT_UNAVAILABLE`, `DECLINED_LENGTH_OF_HAUL`, `DECLINED_PERMITS`,
`DECLINED_WEIGHT`) plus free-text `declineReason` and the carrier's own
`capacityProviderDeclineIdentifier`. `CarrierResponseMethod` = `API` | `EDI` | `EMAIL`
— **p44 treats EDI as one transport among three for the same semantics**, which is
exactly the posture we want.

## Time, identity, evidence

### Time — the strongest part of the source

Three layers, and they do not agree with each other, which is itself the finding.

**Layer 1 — `Timing`, the tidy version.** `Timing = {scheduled, estimate, actual}`,
each a small object, each carrying its **own** `timelinessCode` (`TimingScheduled` /
`TimingEstimate` / `TimingActual`, `:49280`–`:49360`). `TimingEstimate` adds
`estimatedTimeWindow` and `lastCalculatedDateTime` — *"When this estimate was last
computed."* **An estimate that does not say when it was computed is not an estimate**,
and p44 gets this right in three independent places
(`TimingEstimate`, `TruckloadArrivalEstimate.lastCalculatedDateTime`,
`TrackedShipmentEvent.estimateLastCalculatedDateTime`).

**Layer 2 — the event's flat time fields** (`:49595`). One event carries, side by side:
`plannedDateTime` + `plannedEndDateTime` (a *window*, not an instant), `estimateDateTime`
+ `estimateLastCalculatedDateTime` (*"Only populated if event has not occurred yet"*),
`dateTime` (*"Will only be populated for events that have already happened"*, with a
written time-zone rule — *"If relevant, the offset will be relative to **where the
event occurred**, otherwise will be in UTC"*), and `receivedDateTime` (*"The time when
project44 **received or calculated** this event"*). **Occurrence time and knowledge
time are separate fields.** That distinction is the thing an event catalogue most often
forgets.

**Layer 3 — `dateTimes[]`, the honest version** (`TrackedShipmentDateTime`, `:49524`).
*"A list of times retrieved from different sources."* Each entry is a full assertion
record:

| field | what it carries |
| --- | --- |
| `type` | `PLANNED` \| `ACTUAL` \| `ESTIMATE` \| `UNKNOWN` |
| `source` | who said so — `CARRIER`, `BROKER`, `USER`, `CONTRACT`, `GEOFENCE`, `FACILITY`, `P44`, `FFW`, `NVOCC` |
| `sourceIdentifiers[]` | *"standardized 3rd party identifiers which provide more detail about the source… Can indicate a specific **device, vehicle, carrier**, or other freight entity"* |
| `dateTime` / `endDateTime` | an instant, or the start and end of a window |
| `id` | *"An identifier for the underlying record this dateTime was derived from. **This is not unique per dateTime: dateTimes derived from the same underlying record carry the same value.**"* |
| `sequence` | *"the order in which dateTimes of the same type and source were received"* |
| `lastModifiedDateTime` | when that assertion last changed |
| `selected` | *"whether this dateTime is the one used as the top level dateTime of the event"* |

**This is a complete provenance model for a single time value** — assertion, asserter,
asserter's device, source record, arrival order, revision time, and an explicit flag
for which competing assertion won. Everything in layers 1 and 2 is a *projection* of
this; `selected` is the projection rule made visible.

**The originally-contracted time — what is and is not kept.** The registry note for
this source says p44 *"documents that originally contracted time is NOT retained"*.
Our reading refines that, and the refinement matters:

- At **milestone** level p44 *does* keep the first promise. `ShipmentMilestone` carries
  `initialPlannedDateTime`/`initialPlannedEndDateTime` (*"The **initial** planned…"*)
  beside `plannedDateTime`/`plannedEndDateTime` (*"The **latest** planned…"*), and
  splits both by asserter: `carrierInitialPlanned…` vs `customerInitialPlanned…`,
  `carrierLatestPlanned…` vs `customerLatestPlanned…` (`:45515`). Four planned times per
  milestone: *what we asked for, what we now expect, what they promised, what they now
  promise.*
- At **event** level it does not. `TrackedShipmentEvent` has only `plannedDateTime` —
  no `initialPlanned` counterpart (`:49595`).
- At **stop** level it does not. `TruckloadShipmentStop.appointmentWindow` is a single
  `ZonedDateTimeWindow`, and the update endpoints invite you to rewrite it: *"You can
  update location fields or **appointment windows** to reflect changes with this
  endpoint"* (PUT truckload shipment). The only surviving trace of the original is
  whatever `dateTimes[]` entry happens to carry `source: CONTRACT` — optional, and
  nowhere required.
- And `timelinessCode` is computed *"relative to the **user-defined** appointment
  window"* (`:51789`) — i.e. relative to whatever the window says **now**.

**The cost, stated plainly:** if the window is edited, every EARLY/ON_TIME/LATE
judgement silently re-bases against the new promise and on-time performance becomes
unfalsifiable. p44 pays for this with a four-way planned-time tuple at the milestone
layer and a `CONTRACT` source code at the assertion layer — two patches over one
missing idea, which is that *the agreed time is a different fact from the currently
expected time and must be a separate, immutable record*. In HHG this is not academic:
the delivery spread on an Order for Service is a contractual promise, and "we moved the
spread" is exactly the fact a claim or a 49 CFR 375 dispute turns on.

**Time zones.** Handled better than most sources. Stop-relative times *"will always be
in the time zone of the stop, and a time zone offset will always be provided"*
(`:51789`); the additional-appointment-window field carries an IANA zone id
(*"'America/Chicago'"*) and *"If not provided the system will default to the timezone
local to the stop"* (`:51723`); events use the offset *"relative to where the event
occurred, otherwise… UTC"*. `LocalDateTimeWindow`, `ZonedDateTimeWindow`,
`OffsetDateTimeWindow` and `SplitOffsetDateTime` are **distinct types** — p44 treats
"which kind of time is this" as a typing problem, not a formatting problem.

### Identity

- `LogisticsIdentifier {type, value}` with a **70-value typed qualifier** (`:35454`)
  whose own definition is *"The standard which defines **who assigns** the identifier
  and **what it identifies**."* It deliberately spans document ids (`BILL_OF_LADING`,
  `PRO`, `AIR_WAYBILL`, `RAIL_WAYBILL`), party ids (`CARRIER_SCAC`,
  `CARRIER_US_DOT_NUMBER`, `CARRIER_MC_NUMBER`, `NVOCC_SCAC`, `FFW_SCAC`), equipment
  ids (`TRAILER_ID`, `LICENSE_PLATE`, `TRAILER_LICENSE_PLATE`, `CONTAINER_ID`,
  `VEHICLE_IDENTIFICATION_NUMBER`, `SEAL_NUMBER`), device ids (`TIVE_DEVICE_ID`,
  `EMERSON_DEVICE_ID`, `SENSITECH_DEVICE_ID`), relationship ids
  (`CAPACITY_PROVIDER_ACCOUNT_CODE`, `SUBSCRIPTION_ID`) and people
  (`DRIVER_MOBILE_PHONE_NUMBER`). **One list, deliberately heterogeneous, because all
  of them are ways of finding the same shipment.**
- Identifiers attach at **three grains**: the shipment, the route segment
  (*"identifiers that are not part of the overall shipment but are relevant to this
  route segment"*), and the load.
- `primaryForType` disambiguates several identifiers of one type; `source`
  (`CUSTOMER` / `CAPACITY_PROVIDER`) records who contributed each, with the written
  reason that you can only guarantee uniqueness over your own (`:36157`).
- Stop identity is a **uuid plus a documented natural key** — *"effectively the same if
  they match across stop number, tenant location id, stop name, stop type, and involved
  parties"* (`:51723`). p44 had to solve "is this the same stop I was told about last
  time?" and wrote the answer down.

### Evidence & provenance

Five distinct mechanisms, all worth stealing:

1. `TrackedShipmentDateTime.source` + `sourceIdentifiers` + `selected` + `sequence` —
   per-value provenance and the winner flag (above).
2. `TruckloadTrackingMethodDetails.trackingType` = **`MOBILE_PHONE` | `TELEMATICS` |
   `API`** (`:52139`), with `equipmentIdentifierSource` = `CUSTOMER` | `CARRIER` |
   `AUTOMATIC`, and the tracking-method list *"ordered… with the **most robust** method
   available listed first."* **How the fact was obtained is a stored attribute of the
   shipment, and the methods are ranked.** The Capacity Provider Metadata endpoint adds
   where the data really comes from: *"in some cases, like with truckload tracking, a
   capacity provider account is not needed to connect to a capacity provider — e.g., if
   project44 has an **ELD connection** set up with that capacity provider directly."*
3. `ShipmentException.namespace` = `P44_DETECTED` vs `CARRIER_REPORTED` — **the
   platform's own inference is labelled as such and never presented as the carrier's
   assertion.**
4. `MobileTrackingEventDetails.code` (`:36884`) — a 15-value log of the *consent and
   onboarding chain* behind phone tracking: `DRIVER_ACCEPTED_TERMS_AND_CONDITIONS`,
   `DRIVER_CONFIRMED_PHONE_NUMBER`, `DRIVER_PROVIDED_INSUFFICIENT_LOCATION_PERMISSION`,
   `DRIVER_DELETED_ACCOUNT`, `DRIVER_COMPLETED_SHIPMENT_MANUALLY`,
   `DRIVER_REJECTED_SHIPMENT_MANUALLY`, `SHIPMENT_ASSIGNED_VOIP_NUMBER`. When the sensor
   is a person's phone, *whether they agreed* is part of the data model.
5. `DocumentEventDetails` `{documentType, scope ∈ SHIPPER|CARRIER|DRIVER, url,
   **version: integer**}` (`:31879`) plus the `DOCUMENT_ADD` / `DOCUMENT_REMOVE` event
   types — documents are versioned, scoped to who may see them, and their addition and
   removal are themselves events.

**Corrections.** There is no correction, reversal or supersession primitive for
business facts. The nearest things are: `sequence` + `lastModifiedDateTime` +
`selected` on a dateTime (a later assertion can win without deleting the earlier one —
the closest to a real correction model), `ShipmentException.status: RESOLVED`,
`DOCUMENT_REMOVE`, the `DELETED` shipment status code, and `LtlShipmentCancellation`.
"We said it arrived and it didn't" has no retraction.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 2 | 0 | 1 | 2 | 1 | 1 | Only the booking/tender corner: `BookingStatus` with prose transitions and *"caused by either party"* (`:28434`), `BookingRejectionReason`, `TruckloadCapacityProviderTenderDecline` reason codes (`:50734`), `QuoteStatus`, `RateRequestStatus`, `CarrierResponseMethod` (API/EDI/EMAIL). C3=2 is earned **only** there. No order, no service catalogue, no estimate lifecycle; cancelling a shipment is `TruckloadShipmentAction.code` with exactly one value, `CANCEL`, and no reason. |
| A2 Shipment structure | 1 | 1 | 0 | 0 | n/a | 2 | 1 | 2 | `TrackedShipment` is an identity plus a stop list; contents live in `Load`/`LoadItem`/`HandlingUnit`/`LineItem` on the LTL and order-visibility side. `Load` is well defined (`:34845`); `relatedShipments` exists. No shipment *type* taxonomy and no services-ordered concept (accessorials appear only in the rating/dispatch subtree). C8=2 for `CustomAttribute` (≤25) + `ShipmentAttributeDefinition`. |
| A3 Trip, stop & assignment | 2 | 2 | 1 | 0 | 3 | 3 | 2 | 2 | Stops with types, `stopNumber` ordering, `uuid` + natural-key identity rule, per-stop appointment windows with IANA zones, and `RouteSegment` as a first-class between-stops entity carrying its own mode and identifiers (`:51723`, `components.schemas.RouteSegment`, `ShipmentRouteInfo`). **C1 held at 2 and C2 at 2 because there is no trip and no vehicle assignment**: the vehicle is reachable only as *"the id of a route segment… can be used to associate the event with a specific vehicle"* (`:49595`), and consolidating several shipments onto one vehicle is not expressible — `Load` divides a shipment, never joins two. C5=3: zoned windows, additional windows, and the written default-window rule. |
| A4 Execution events & tracking | 3 | 2 | 2 | 0 | 3 | 3 | 3 | 2 | The area this source wins. ~90 event types + 11 states-as-intervals + per-stop EN_ROUTE/ARRIVED/DEPARTED + derived milestones + a full exception subsystem (`:49595`, `:49935`, `:51789`, `:45515`, `:45061`). C5=3 on `dateTimes[]` (`:49524`), occurrence-vs-`receivedDateTime`, `lastCalculatedDateTime` on every estimate, `deltaActual`/`deltaEstimated`, and EARLY/ON_TIME/LATE **with a duration** (`ArrivalStatus`). C7=3 on source+sourceIdentifiers+selected+sequence, `trackingType` MOBILE_PHONE/TELEMATICS/API (`:52139`), `P44_DETECTED` vs `CARRIER_REPORTED`, and the driver-consent codes (`:36884`). **C2 capped at 2: the event enum is undefined** — ~90 bare strings, some descriptions shipped as unrendered templates, and `LOAD_ONTO_VEHICLE` vs `LOAD` vs `PICKED_UP` nowhere distinguished. C3=2: real invariants exist (one stop status per stop; the status×reason table at `:51656`) but no transition graph. |
| A5 Storage-in-transit | 0 | n/a | n/a | 0 | n/a | n/a | n/a | n/a | Absent. Grepping the whole file for *storage* yields only `ULTRA_COLD_STORAGE_VACCINES` (a product-category value) and the ocean free-time/demurrage fields; `WAREHOUSE` exists only as a `TrackedShipmentStop.type` value and a `WAREHOUSE_MOVEMENT_ORDER` identifier type. The dwell machinery (`TruckloadShipmentPointOfInterestStatus.totalDwellTime`, `recordedEntries` = *"ordered list of all paired entries and exits events"*, the `DWELL_AT_STOP` exception) measures hours at a gate, not a storage account. Scored 0 rather than 1: there is no SIT concept here to reuse. |
| A6 Documents & evidence | 2 | 2 | 1 | 1 | 1 | 2 | 3 | 2 | 18-value `DocumentType` incl. `PROOF_OF_DELIVERY`, `DELIVERY_RECEIPT`, `WEIGHT_CERTIFICATE`, `LUMPER_CERTIFICATE`; `DocumentEventDetails` with `scope` and an integer `version` (`:31879`); `DOCUMENT_ADD`/`DOCUMENT_REMOVE` events; an eBOL subtree (`Ebol`, `RequestEbol`, `EbolImages`, `EbolReferenceNumbers`, `EbolMessageStatus`) and an image-retrieval/push-imaging API (`LtlTrackedShipmentImageReference`, `ImageType` = `ORIGINAL`/`THUMBNAIL`). C7=3: a document is evidence attached to an event, scoped and versioned. C4=1 for `WEIGHT_CERTIFICATE` alone; no inventory, no order for service, no agent paperwork. |
| A7 Charges & billing hooks | 1 | 1 | 1 | 0 | n/a | 1 | 1 | 1 | Present but shallow for our purposes: `Charge`, `LinehaulCharge`, `FuelSurchargeCharge`, `AccessorialCharge`, `OtherCharge`, `TrackedShipmentCost`, the `COST_UPDATE` and `ISSUE_FREIGHT_BILL` event types, `PaymentTerms`, `TruckloadVendorCharge`, `CurrencyConversionAuditInfo` (*"Exchange rate information will also be returned… for audit purposes"*). Line-haul vs accessorial **is** the split, which matches ours. No invoice lifecycle. |
| A8 Parties & roles | 1 | 1 | n/a | 0 | n/a | 2 | 2 | 1 | `PartyType` is six values and `Party.partyType` is *"The relationship **the shipper has** to the party"* — the model is written from the shipper's chair. `involvedParties` attaches parties per stop and per load (*"your customers receiving freight at this stop or your suppliers providing freight from this stop"*). `capacityProvider` + `CapacityProviderAccountGroup` is a real carrier-identity subsystem. C7=2 for `SharingContext`/`DataOriginator`/`DataRecipient` and `AccessGroup`. **C4=0: no van line, no booking/origin/hauling/destination agent, no driver as a party (only `DRIVER_MOBILE_PHONE_NUMBER` as an identifier and `scope: DRIVER` on a document), no crew, no warehouse operator, no account/RMC.** |
| A9 Identity & cross-references | 3 | 3 | n/a | 1 | n/a | 3 | 3 | 3 | The other area this source wins. 70-value typed `LogisticsIdentifierTypeEnum` whose own definition is *"the standard which defines **who assigns** the identifier and **what it identifies**"* (`:35454`); identifiers at shipment / segment / load grain; `primaryForType`; `source: CUSTOMER\|CAPACITY_PROVIDER` with a written uniqueness rationale (`:36157`); the stop natural-key rule (`:51723`). C4=1: `PRO`, `BILL_OF_LADING`, `CARRIER_SCAC` are present but there is no registration number, service-order number or van-line order number. C8=3: new identifier types are enum additions, and `EXTERNAL` / `REFERENCE_NUMBER` / `CUSTOMER_REFERENCE` are the documented escape hatches. |

**S5 — fit to Pegasus data.** `unknown` for A1–A9: this analysis read no pegII or Cloud
schema. Two hypotheses to test in phase 5, flagged now because they are the expensive
ones. **(a)** pegII almost certainly stores *one* spread/appointment per stop and
overwrites it on change, so `initialPlanned` vs `latestPlanned` — and any
EARLY/ON_TIME/LATE claim derived from it — may be unreconstructable from history.
**(b)** pegII is form-and-save CRUD, so `source` / `trackingType` / `receivedDateTime`
— *who told us and when we learned it* — probably do not exist as fields at all, and a
visibility consumer asks for exactly those.

## Strengths worth adopting

1. **A time value is an assertion, not a number.** `TrackedShipmentDateTime` —
   `{type: PLANNED|ACTUAL|ESTIMATE, source, sourceIdentifiers, dateTime, endDateTime,
   id-of-underlying-record, sequence, lastModifiedDateTime, selected}` — is the single
   best structure in this source. Adopt the shape *and* `selected`: publishing the
   winner alongside the candidates makes the resolution rule auditable instead of
   implicit.
2. **Separate `receivedDateTime` from `dateTime`.** Occurrence time vs knowledge time.
   Cheap, and without it late-arriving telematics silently rewrites history.
3. **Every estimate carries `lastCalculatedDateTime`.** An ETA with no as-of is not an
   ETA. p44 enforces this in three places independently.
4. **`initialPlanned…` beside `latestPlanned…`, split by asserter (carrier vs
   customer).** Four planned times per milestone: what we asked, what we now expect,
   what they promised, what they now promise. In HHG that maps onto *requested spread /
   current spread / agent-confirmed spread* — keep the original immutable, which is the
   one thing p44 does at milestone level and fails to do at stop level.
5. **EARLY / ON_TIME / LATE with a `duration`, and a written statement of what it is
   measured against.** Both halves matter; the second is what p44 gets wrong in
   practice and what we should get right.
6. **A milestone is `(event type × positionally-identified stop)`.** Two layers: a
   wide, cheap, append-only raw event stream, and a small stable named milestone
   vocabulary *derived* from it by an explicit rule. That is exactly the shape of a
   published catalogue over a CRUD legacy — pegII rows produce raw events; the
   catalogue publishes milestones with stated derivations.
7. **Events (points) and states (intervals) are different entities.** `AT_STOP`,
   `IN_TRANSIT`, `IDLE`, `ACTION_REQUIRED` with start/end and a stop or segment anchor.
   SIT, awaiting-disposition and held-for-payment are all interval facts; modelling
   them as point events is a category error we can avoid for free.
8. **Exceptions as a labelled predicate** with `ACTIVE`/`RESOLVED`, a `definitionId`
   for the derivation rule, a `timeline[]` of transitions, and a `namespace` saying who
   asserted it. `P44_DETECTED` vs `CARRIER_REPORTED` is the discipline: never present
   your own inference as the counterparty's assertion.
9. **`trackingType: MOBILE_PHONE | TELEMATICS | API`, methods ranked "most robust
   first", and the identifier's own source recorded.** Given the tenants run Omnitracs
   and Samsara we will have exactly this problem — telematics on the line-haul tractor,
   a crew member's phone at destination, an agent's API on the interline leg. Record
   *how we know* on the fact.
10. **Driver-consent events as first-class data** (`:36884`). When the sensor is a
    person's phone, the terms-accepted / permission-denied / account-deleted chain is
    part of the record. There is a real compliance argument for this in HHG.
11. **The identifier type says who issues it.** One typed cross-reference table
    spanning documents, parties, equipment, devices and people, with `primaryForType`
    for "which PRO do we actually call them about" and `source` for who contributed it.
    Better than an untyped map, and the right answer to A9.
12. **Stop identity = surrogate uuid + a written natural key.** Whether or not we adopt
    p44's key, adopt the practice of **writing the key down**.
13. **Typed time classes** — `LocalDateTimeWindow` / `ZonedDateTimeWindow` /
    `OffsetDateTimeWindow` / `SplitOffsetDateTime`, plus *"always in the time zone of
    the stop."* A delivery spread is a local date range at destination; the type system
    should say so.
14. **Status × reason as a constraint table** (`:51656`). Reason codes legal only under
    particular statuses, written down — do this in the catalogue rather than shipping
    two independent enums.

## Weaknesses / traps

- **There is no trip, and no consolidation.** A shipment owns its stops; a vehicle is
  inferred from a route-segment id. Several shipments on one van — our normal case —
  cannot be said at all. Taking p44's shipment-centric shape would collapse A3 into A2
  and make the van line's actual planning object unrepresentable. `Load` is the opposite
  operation and must not be mistaken for it.
- **The current appointment window is the only window, and the timeliness verdict
  re-bases when it is edited.** `timelinessCode` is *"relative to the user-defined
  appointment window"* and the update endpoint invites you to edit it. Adopt this and
  "was the delivery late?" becomes a question about the present, not the past. **The
  agreed spread must be an immutable, separately recorded fact.**
- **A ~90-value event enum with zero definitions.** `LOAD_ONTO_VEHICLE`, `LOAD`,
  `PICKED_UP`, `CP`-style completion codes coexist with no stated difference, and some
  descriptions ship as unrendered template strings. Copying this vocabulary would import
  ambiguity we would then litigate per partner. Take the *structure*, not the list.
- **Four overlapping vocabularies for one journey** (events, states, mode-specific
  status+reason, per-stop vehicle status), each mode carrying its own variant (`Ltl…`,
  `Truckload…`, `Rail…`, `Ocean…`, `Parcel…`). The cost is visible in the file:
  `TIMED_OUT` is a *completion* reason, so "we lost the signal" and "the job finished"
  arrive in the same field.
- **"How the shipment ended" and "how tracking ended" are conflated.**
  `COMPLETED / TIMED_OUT`, `TRACKING_FAILED`, `TRACKING_END_BY_USER`, `SHARING_STOPPED`
  sit beside `DEPARTED_FINAL_STOP`. A visibility platform can afford that; a system of
  record cannot.
- **No SIT, no storage, no warehouse-as-a-leg.** Anything imported for A5 would be
  invention. The dwell/point-of-interest machinery is a decoy: gate hours, not a storage
  account with an in-date, an out-date, a lot number and a charge clock.
- **Party roles are written from the shipper's chair** and are six values deep. *"The
  relationship the shipper has to the party"* is the wrong frame for a van line where
  the commercial counterparty is an account/RMC, the payer may be none of the parties at
  the stops, and the operational chain is booking → origin → hauling → destination
  agent. `BOOKING_AGENT` here is an ocean booking office, **not** our booking agent —
  a dangerous false friend.
- **No driver, no crew, no equipment as entities.** The driver is a phone number in an
  identifier enum and a `scope` value on a document; equipment is a `TRAILER_ID` string.
  For A3/A13 there is nothing to take.
- **No correction or reversal semantics** for business facts. `sequence` + `selected`
  corrects a *time*; nothing corrects an *event*. Do not assume a visibility feed's
  "latest wins" is adequate for a system of record.
- **Mutation-by-PUT with full-document replacement** (*"you must pass the entire details
  for the shipment, just as you would on a POST"*) is REST plumbing, not domain meaning,
  and is the reason several of the gaps above exist. Do not carry it into `model/`.
- **`UNKNOWN` as the first member of nearly every enum.** Pragmatic for a platform
  aggregating dozens of carriers; corrosive in a system of record, where it lets a
  required fact be silently absent.
- **Custom attributes capped at 25 and untyped** (`CustomAttribute`;
  `ShipmentAttributeDefinition`'s entire schema is a `name`). The escape hatch exists
  but carries no semantics — the same gravity well as OTM's `externalAttributes`.

## Out-of-v1 material

- **A10 (survey/estimating, inventory detail).** A whole order-visibility subtree:
  `InventoryOrder`, `InventoryItem`, `OrderIdentifierType`, `OrderTag`,
  `DerivedOrderHealth` (with `estimatedTimeOfArrival`), `OrderArrivalStatus`,
  `OrderHealthCriteria` / `OrderHealthDateCriteria` / `OrderHealthDeltaCriteria`,
  `supplierReadyDateTimeWindow`, and — note — `originalDeliveryDateTimeWindow` as a
  distinct retained field with `ORIGINAL_DELIVERY_WINDOW_START_DATETIME` exposed as a
  sort key. **The order layer keeps the original promise that the shipment layer drops.**
  Also the accessorial-as-requirement catalogue (`LiftgateAccessorial`,
  `LimitedAccessCode`, `DockRequiredAccessorial`, `CallBeforeArrivalAccessorial`,
  `WhiteGloveAccessorial`, `ExcessLengthAccessorials`, `SpecificationKind_*`) — a
  survey-findings analogue, and `WhiteGloveAccessorial` is the nearest thing to an HHG
  service in the file.
- **A11 (claims & valuation).** Triggers only, never claims: exception reasons
  `ALL_SHORT`, `REFUSED_DELIVERY`, `BAD_ORDER`, `TEMPERATURE_BREACHED`;
  `QualityControlEventDetails.code` (`:40668`) with `DAMAGE_HELD`, `SURVEY`,
  `EXPORT_SURVEY`, `QUALITY_CONTROL_HELD`, `RELEASE`, `AVAILABLE` — a hold/release
  vocabulary usable for damage inspection. `FullValueCoverageDetails` and declared value
  sit on the LTL rating side and are the closest to valuation.
- **A12 (rating & tariffs).** Substantial and out of scope: `RateQuote`,
  `RateQuoteDetail`, `AlternateRateQuote`, `MarketQuote`, `TransitTimeQuote`,
  `RateIdentifier` with `RateIdentifierSource` (*"A `SYSTEM` identifier is internal to
  p44; an `EXTERNAL` identifier is known by a non-p44 system"* — a neat
  identifier-provenance idiom), `FuelSurchargeCalculationMethod`, `FreightClass`,
  `NmfcCode`, `ClassificationCode`, `AccessorialChargeCode`.
- **A13 (crew, driver & settlement).** Nothing on settlement. Driver material is the
  mobile-tracking consent codes (`:36884`) and `DRIVER_MOBILE_PHONE_NUMBER`.
  `CarrierPerformance` / `CarrierLanePerformance` / `MonthlyCarrierPerformance` /
  `CarrierMetrics` are a carrier-scorecard subsystem worth remembering if we ever score
  agents.
- **Beyond the rubric.** The `Appointments` / `Slots` / `Site Codes` / `Reason Codes`
  tags are a dock appointment-booking API with `AvailableSlot`, `BookedSlot`,
  reschedule-with-reason (`RESCHEDULE_CUSTOMER_REQUEST`, `RESCHEDULE_OPERATIONAL_DELAY`)
  and a **site-scoped reason-code service** (`GET /services/appointments/v1/reasoncodes`,
  *"Get reason codes **by site**"*, example values `CANCEL_WEATHER`,
  `CANCEL_DRIVER_UNAVAILABLE`, `CANCEL_EQUIPMENT_ISSUE`). Two ideas: reason codes as a
  **served, per-site vocabulary** rather than a compiled-in enum, and
  reschedule-with-reason as a first-class operation. Also `Geofence`, `GeoJsonObject`,
  `EmissionData`, and the sensor subtree (`TruckloadTrackingUpdateReadings`: temperature
  zones, humidity, shock, vibration, tire pressure, fuel, battery) — the shape of a raw
  telematics feed, which is what Samsara/Omnitracs will hand us.

## Open questions

1. **Do we keep the agreed time as a separate immutable fact, or keep `initial` +
   `latest` on the same record?** p44 does both in different layers and is incoherent as
   a result. Decide once, in A4, before the catalogue fixes it — and decide in writing
   what an EARLY/ON_TIME/LATE verdict is measured against.
2. **What is our trip?** p44 has no answer and neither does OTM's consignment. The van
   line's planning object (one vehicle, many shipments, SIT interruptions, agent
   handoffs) needs a source that models it; if none exists, it is an original modelling
   decision and should be recorded as one.
3. **Do we adopt the two-layer raw-events / derived-milestones split?** If yes, each
   milestone's derivation rule must be written down the way p44 writes *"ARRIVAL_AT_STOP
   event at ORIGIN stop"* — that is what makes the catalogue reproducible from pegII
   rows.
4. **How do we record "how we know"?** p44's `trackingType` and `source` are the right
   shape, but our sources differ (crew app, driver phone, Omnitracs, Samsara, agent
   portal, a phone call typed into a form). The enum must be ours and must include *"a
   human typed it"* honestly — the majority case in pegII today. Cross-check against
   src:samsara and src:omnitracs-roadnet.
5. **Does a future visibility consumer need us to emit p44's shape, or only to be able
   to answer its questions?** Concretely, p44 onboarding needs: a shipment identifier it
   can match, a stop list with appointment windows and zones, a tracking method, and
   arrive/depart per stop. Everything else is ours. That minimum should be written into
   the catalogue as an explicit conformance target so nobody re-derives it when a
   shipper finally asks.
6. **`INTERLINE_INFO` / `INTERLINE_MISSED` (`:36255`) is the only interline vocabulary
   found here.** Is there a better source for agent-to-agent custody transfer? The 214
   pair `J1 Delivered to Connecting Line` / `R1 Received from Prior Carrier` (see
   src:stedi-x12-reference) may be it; phase 3 should compare them head to head for
   A4/A8.
7. **Registry housekeeping (orchestrator, not done here):** add
   `sha256 f7b6fdc05aa8c1932984fdd8ecf0deb4acdabd5a8c78ff6c8bba2f5c7b767563` to the
   `project44` entry's `files:`, which currently records none.
