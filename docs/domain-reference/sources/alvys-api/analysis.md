---
source: src:alvys-api
analyzed: 2026-09-17
evidence_grade: B
material: |
  Retrieved 2026-09-17 from https://docs.alvys.com (Mintlify; every page also
  serves a `.md` twin). Copies under sources/alvys-api/local/docs/ (license
  unstated, so local/ not captured/):
  - alvys-llms.txt, alvys-apiref.md (the 96-page API Reference index),
    alvys-v10.md (the guides index) - used to enumerate the full surface
  - webhooks_{overview,load-events,trip-events,tender-events,change-diffs,
    get-event-types}.md  - READ IN FULL; these carry the event vocabulary
  - trips_{get-trip,search-trips,list-trip-stops,get-trip-stop,assign-trip,
    dispatch-trip,record-stop-arrival,record-stop-departure,clear-stop-arrival,
    set-stop-appointment,log-a-trip-check-call,list-trip-check-calls,
    upload-trip-document}.md
  - loads_{get-load,search-loads,update-load,upload-load-document,
    get-equipment-types}.md
  - tenders_{get-tender,create-tender,accept-tender,reject-tender}.md
  - visibility_{get-inbound-visibility-history,record-asset-location,
    record-asset-telemetry}.md, invoices_get-invoice.md,
    drivers_search-driver-events.md, locations_get-location.md
  - guides: dates-timestamps, timestamps, idempotency, concurrency,
    edi-integrations, versioning, currency
  - sources/alvys-api/local/alvys-auth.html (pre-existing capture of the
    authentication page; sha256 f73e7b20d29204d3ca995b228c3a23c9a9f6494f13198397daca036a84d9a027)
  Several reference pages embed the OpenAPI fragment for their own endpoint, so
  the schemas quoted below (StopResponse polymorphism, TripAssignmentRequest,
  TenderResponse) are read from the spec, not from prose.
  NOT read - and this is why the grade is B, not A:
  - **the consolidated OpenAPI document `https://docs.alvys.com/openapi/alvys.json`
    is login-gated** (302 -> /login?redirect=...). We never saw the whole spec in
    one piece, so no complete enum inventory exists in this reading.
  - ~65 of the 96 reference pages (carriers, customers, deductions, fuel, tolls,
    trailers, trucks, users, maintenance, settlement statements, most webhook
    management endpoints) - enumerated from the index and summarised from their
    one-line descriptions only, never opened.
  - the 254-page Help Center (operator-facing), the Spanish tree, the MCP-tools
    catalogue, the changelog.
  - **no live API call was made** (OAuth client-credentials required).
  Consequence: every *status string* below is quoted from a filter description or
  a prose sentence. Alvys publishes no single normative status enum that we saw,
  and stop status values in particular are never enumerated anywhere we read.
---

# Alvys TMS Public API - analysis

## What it is

The public REST + webhook API of **Alvys**, a modern cloud **trucking TMS** for
carriers and brokers (tenders, loads, trips, dispatch, drivers, carriers,
settlement, invoicing). **S1 kind:** `vendor-api`. **S2 adoption: 1-2** - a young,
fast-moving product with a serious API programme (versioned `v1.0`, OAuth 2.0
client credentials, signed webhooks, an MCP server), but a small installed base
relative to McLeod / TMW, and no HHG presence at all. **S3 openness:** `public`
for the documentation and mostly-public for the per-endpoint OpenAPI fragments;
the **consolidated spec and the API keys are gated** (docs login; "Existing Alvys
customers can obtain API access by contacting their account representative",
`guides/edi-integrations`).

It is in the registry as a **comparator**: the question it answers is "how does a
product that *has* to separate a customer's shipment from a truck's journey
actually do it?" - the exact structural question `src:smartmoving-api` cannot
answer and `src:pegasus-cloud-domain` gets wrong. On A3/A4/A9 it is the most
articulate vendor source in the set. On A5/A10/A11 it is silent, and on A4 its
event vocabulary is freight's, not ours.

**Grade B** is a coverage statement, not a quality one: what we read, we read as
specification; we simply did not read all of it, and the assembled spec was
behind a login. See the `material` block for the exact split.

## Model summary

Alvys separates **four** things where most systems have one or two, in its own
words:

```
Tender  ──(accept)──▶  Load  ──(1..n)──▶  Trip  ──(1..n, ordered)──▶  Stop
(inbound EDI 204       (the customer's     (the execution assignment:  (a visit:
 offer; Status,         commercial          Carrier + Dispatcher +      $type =
 ShipmentId, SCAC,      shipment;           Driver1/2 + Truck +         appointment |
 Entities[N1Qual],      LoadNumber,         Trailer; TripNumber          delivery_window |
 Stops[] w/ Orders[],   OrderNumber,        "T100245-1"; its own         waypoint)
 ExpirationDate)        PONumber,           status ladder + rates)
                        Linehaul/FSC/
                        Accessorials,
                        Origin/Destination
                        DERIVED from stops)
```

The load-vs-trip split is load-bearing and stated, not implied:

- A load **cannot exist without a trip**: `GET /loads` returns 404 when "a load
  record exists but has no associated trips (abandoned creation). These loads are
  treated as non-existent by the API" (`loads_get-load.md`).
- A load **can have several trips**, and history is preserved: `GET /trips` takes
  `includeDeleted` - "also returns trips that are deleted or invisible (for
  example, **an original trip superseded by a load split**)"
  (`trips_get-trip.md`). Splitting a load for a relay replaces one trip with two
  and keeps the superseded one addressable.
- The **load's Origin and Destination are derived, not stored**: "Address of the
  load's first pickup stop, **derived from the load's stops**. `null` when the
  load has no pickup stop" (`loads_get-load.md`). Stops belong to the trip
  (`Alvys.Models.Trips.StopResponse` is what the *load* response embeds); the load
  merely projects them.
- Money is split along the same seam: the **load** carries `Linehaul`,
  `FuelSurcharge`, `CustomerAccessorials`, `CustomerRate`, `InvoicedAmount`
  (revenue), while the **trip** carries `Carrier.Rate`, `Carrier.Linehaul`,
  `Carrier.TotalPayable`, `TripValue`, `Driver1.RatesV2[]` (cost).

The one cardinality it does **not** support, on the evidence we read: a trip
carries exactly one `LoadNumber` (`trips_get-trip.md`, a scalar). One load may
become many trips; nothing we read shows many loads on one trip - i.e. **no
consolidation**.

## Vocabulary

Cites are to `local/docs/<file>.md` as listed in `material`.

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Tender** | An inbound offer, normally an EDI 204. Carries `ShipmentId`, `CompanyCode`, `SCAC`, `Status`, `DateImported`, `ExpirationDate`, `Rate`, `Equipment`, `Entities[]`, `Stops[]`, `References[]`, `RoutingSequenceCode`, `TransportationMethodTypeCode`, `Etag`. | A1, A9 | `tenders_get-tender` (`TenderResponse`) |
| **Load** | The customer's commercial shipment and the invoicing unit. `LoadNumber` is "unique by subsidiary". | A1, A2, A7 | `loads_get-load` |
| **OrderNumber** | "An optional external order number" - explicitly "the partner-facing **Shipment Id**", max 30 chars, and **the only writable field on a load**. | A9 | `loads_get-load`, `loads_update-load` |
| **Trip** | The execution assignment: one carrier + dispatcher + driver(s) + truck + trailer moving one load through a sequence of stops. `TripNumber` is derived from the load number with a suffix (`T100245-1`). | A3 | `trips_get-trip`, `trips_list-trip-check-calls` (example) |
| **TenderAs / TenderAsSubsidiaryType** | "Role under which the trip was tendered" / "Subsidiary type under which the trip was tendered (e.g. `"Carrier"`)" - the same company plays a different role per trip. | A8 | `trips_get-trip` |
| **Stop** | A visit on a trip, with **stable `Id`**, `StopType` (`Pickup`, `Delivery`, `Waypoint`), `Status`, `ArrivedAt`, `DepartedAt`, `References[]`, `CompanyId`/`CompanyNumber`/`CompanyName`, `Coordinates`, `Eta`. | A3, A4 | `trips_list-trip-stops`, `trips_get-trip-stop` |
| **`$type`** | "Polymorphic type discriminator for the stop representation (`appointment`, `delivery_window`, `waypoint`)" - **the stop's scheduling shape is its subtype**. | A3, A5 | `trips_list-trip-stops`; schemas `AppointmentStopResponse` / `DeliveryWindowStopResponse` / `WaypointStopResponse` in `loads_get-load` |
| **ScheduleType** | `APPT` or `FCFS`. `APPT` requires `AppointmentDate`; `FCFS` requires `WindowBegin` (+ optional `WindowEnd`). | A3, A5 | `trips_set-stop-appointment` |
| **AppointmentRequested / AppointmentConfirmed** | Two independent booleans: an appointment can be asked for and not yet confirmed. | A3 | `trips_set-stop-appointment`, `trips_get-trip-stop` |
| **LoadingType** | `Live`, `Drop`, `Hook`, `Drop&Hook` - **how the trailer is handled at the stop**. | A3, A5 | `trips_set-stop-appointment` |
| **Eta { Planned, Live, Manual }** | Three separately-sourced estimates for the same stop. `Planned` = "ETA from route planning, set when the trip is planned or re-planned"; `Live` = "recalculated from the latest vehicle location while the trip is in transit"; `Manual` = "entered by a user or integration, or defaulted from the stop date or appointment". `null` when none exists. | A4 | `trips_get-trip`, `trips_list-trip-stops` |
| **ArrivedAt / DepartedAt** | Actual stop times, ISO 8601. "A value sent without a UTC offset is read as **the stop's local time**." Recorded by `PUT .../arrival` and `PUT .../departure`; **cleared by `DELETE .../arrival`**. | A4 | `trips_record-stop-arrival`, `trips_record-stop-departure`, `trips_clear-stop-arrival` |
| **Check call** | "A driver status update" logged on an in-progress trip: `Description`, `Activity` (e.g. `Driving`, `At Pickup`), `DriverId`, `Location`, `SetpointTemperature`, `ReturnTemperature`; response adds `ResponseType` ("Categorization of the response (e.g. arrival, departure)"), `CreatedBy`, `CreatedAt`. | A4 | `trips_log-a-trip-check-call`, `trips_list-trip-check-calls` |
| **Reference** | A first-class identifier object, not a string: `{ Id, Name, Value, Type (Text/Date/Bool/List), Access (Internal/Public), Origin (Manual/Integration), ReferenceId }`. Exists on loads **and on each stop**. | A9 | `loads_get-load`, `trips_get-trip-stop` |
| **TenderEntityResponse** | A party on a tender in **EDI terms**: `Type`, `Name`, `CompanyName`, `N1Qualifier`, `IdCodeQualifier`, `IdCode`, address, phone, email. | A8, A9 | `tenders_get-tender` |
| **TenderDateTimeResponse** | `{ DateTime, TimeZoneCode }` - **the only place a time carries its zone as data**. | A4, A5 | `tenders_get-tender` |
| **Mileage** | `{ Distance: { Value, UnitOfMeasure }, Source, ProfileId, ProfileName }` - a distance **with the engine that produced it**. Trip carries `TotalMileage`, `EmptyMileage`, `LoadedMileage`; load carries `CustomerMileage`. | A7, A9 | `trips_get-trip`, `loads_get-load` |
| **Subsidiary** | A legal entity inside the tenant, with MC/DOT and remit address; **the webhook routing key** and the scope in which `LoadNumber` is unique. | A8 | `webhooks_overview`, `alvys-apiref` (subsidiaries) |
| **Accessorial** | `{ Id, Type (Detention, Layover, Fuel Surcharge), Rate, RateType (Flat/PerHour/PerMile), Uom (Hour/Mile/Stop), Quantity, Total, IsPaid, **StopId**, CreatedAt, UpdatedAt }` - charges can be **stop-scoped**. | A7 | `loads_get-load` (`CustomerAccessorialsDetails[]`) |
| **`data.diff`** | On `load.changed` / `trip.changed`: `{ changes: [{kind, target?}], previousAttributes }`. Change kinds are "domain-named ... they never expose internal field names or JSON paths". | A4, A6, A9 | `webhooks_change-diffs` |
| **Visibility (inbound / outbound)** | Position/status updates **received from** carriers vs **pushed to** customer platforms, each with its own history and its own error log. | A4 | `visibility_get-inbound-visibility-history`, `alvys-apiref` (visibility) |
| **RecordedAt / ReceivedAt** | "Observation time the position is ordered by" vs "When Alvys accepted the position" - two distinct clocks on one reading. | A4 | `visibility_record-asset-location` |

## Lifecycles & events

### Load and trip status ladders

Both are quoted only as filter allow-lists, and **they are the same 16 strings**:

> `In Review, Open, Quoted, Reserved, Covered, Dispatched, In Transit, Delivered,
> TONU, Released, Queued, Invoiced, Financed, Completed, Paid, Cancelled`
> - `loads_search-loads` ("Status ... One of the following"), and
>   `trips_search-trips` ("Must be one or more of the allowed values ... Will
>   always be one of the allowed values")

No definition is given for any of them - `TONU` (truck ordered, not used),
`Released`, `Queued`, `Financed` and `In Review` are never explained in anything
we read. The ladder fuses **operational** states (Covered, Dispatched, In Transit,
Delivered) with **financial** ones (Invoiced, Financed, Paid), which is a
deliberate choice worth noting: a load is not "done" when it is delivered.

Transitions are documented only in fragments, but the fragments are precise:

- `POST /trips/{tripId}/dispatch` - "transitioning the trip from **Assigned to
  Dispatched** and notifying the driver on the mobile companion app"
  (`trips_dispatch-trip`). Note "Assigned" is not in the status list above -
  assignment is a separate axis.
- `POST /trips/{tripId}/assign` takes `TripAssignmentRequest { CarrierId*,
  DispatcherId*, Driver1Id, Driver2Id, TruckId, TrailerId, CarrierRate }` -
  **carrier and dispatcher are required, driver and equipment are not**
  (`trips_assign-trip`, embedded schema).
- `POST /trips/{tripId}/check-calls`: "The trip must be in progress (`Covered`,
  `Dispatched`, or `In Transit`); a check call on a terminal, pre-dispatch, or
  post-delivery-billing trip is **rejected with 422**"
  (`trips_log-a-trip-check-call`). A published precondition tied to named states.
- `409 Conflict` on an update means "The record cannot be changed at all - money
  already settled. Do not retry. **Post a correction instead.**"
  (`guides/concurrency`).

**Stop status exists and is never enumerated.** `Stops[].Status` is described as
"The current operational status of the stop" in three places and its values appear
nowhere in what we read - a real hole in an otherwise well-specified surface.

### Tender lifecycle - an EDI 204/990 state machine

`webhooks_tender-events` gives the fullest lifecycle in the source:

| Event | Fires when | Extra `data` |
| --- | --- | --- |
| `tender.created` | "A new inbound tender is received, before anyone reviews or accepts it" | `tender` |
| `tender.change.created` | A change tender arrives for an existing tender | `queuedForReview`, `changeCount`, `changeTypes`, `tender` |
| `tender.accepted` | | `loadId`, `loadNumber`, `tender` |
| `tender.rejected` / `tender.cancelled` / `tender.change.accepted` | | `tender` |
| `tender.bid.submitted` | | `bidAmount` |
| `tender.stop.arrived` / `.departed` / `.eta_updated` | | `stopId`, `arrivedAt` \| `departedAt` \| `estimatedAt`, **`reason`** |
| `tender.invoiced` | | `invoiceId` |

Two details are the reason this is worth copying:

1. **`queuedForReview` changes the meaning of the payload.** When `true` (the
   tender has a linked load) "the changes are queued and await acceptance" and
   `data.tender` holds "the tender **before** the proposed changes"; when `false`
   "its fields were replaced outright" and `data.tender` is the tender **after**.
   The doc warns explicitly: "Reading `data.tender.rate` on a queued `LoadRate`
   change gives you the current rate, not the proposed one."
2. **`changeTypes` is a published, closed-per-entity vocabulary** of *proposed*
   changes - tender-level `LoadRate, TotalWeight, Trailer, PaymentMethod,
   PalletQuantity, Distance, TenderNotes, TenderCharges, AccessorialsUpdate,
   PurchaseOrderNumber, TenderReferenceAdded, TenderReferenceRemoved`; stop-level
   `StopSchedule, StopAddress, StopAdded, StopRemoved, StopNotes,
   StopPositionChanged, StopOrderDetailsChanged, StopPoNumberChanged,
   StopInfoChanged, StopReferenceAdded, StopReferenceRemoved`. "These values are a
   stable contract. Treat any value outside this list as unrecognized rather than
   failing on it."

The EDI mapping is stated as a decision table (`guides/edi-integrations`):
204_00 -> `POST /tenders`; 204_04 -> `POST /tenders/update`; 204_01 ->
`POST /tenders/cancel`; 990 accept/reject -> `POST /tenders/{id}/accept|reject`;
204_04 acceptance -> `/accept-updates`; 204_01 confirmation -> `/accept-cancel`.
Its design principles are quotable in their own right:

> "**REST expresses intent; webhooks confirm outcome.** A successful REST response
> indicates the request was received, not that the workflow is complete."
> "**Model state explicitly.** Tenders may be pending, accepted, rejected,
> cancelled, expired, or awaiting update approval. Do not assume immediate state
> transitions."

### Execution-event vocabulary (`data.diff.changes`)

The closed per-entity change-kind lists in `webhooks_change-diffs` are the nearest
thing Alvys has to a domain event catalog:

- **load.changed:** `StatusChanged, RateChanged, FuelSurchargeChanged,
  AccessorialsChanged, MileageChanged, InvoicedChanged, PaymentRecorded,
  InvoicingChanged, CustomerChanged, ContractChanged, ScheduleChanged,
  DueDateChanged, Delivered, DimensionsChanged, CommodityChanged, NotesChanged,
  ReferencesChanged, FieldChanged`
- **trip.changed:** `StatusChanged, ReleasedChanged, DispatchChanged,
  CarrierChanged, CarrierPayOnHoldChanged, DriverChanged, TruckChanged,
  TrailerChanged, TemperatureChanged, CarrierRateChanged, TripValueChanged,
  FuelSurchargeChanged, DriverRatesChanged, CarrierPaymentRecorded,
  DueDateChanged, StopAdded, StopRemoved, StopReordered, StopAddressChanged,
  StopTypeChanged, StopCommodityChanged, StopNotesChanged,
  StopReferencesChanged, StopInstructionsChanged, AppointmentChanged,
  ScheduleChanged, ArrivalRecorded, DepartureRecorded, StopStatusChanged,
  PickedUp, Delivered, MileageChanged, TenderChanged, ReferencesChanged,
  FieldChanged`

Note what this vocabulary *distinguishes*: `ArrivalRecorded` (a fact was written)
is a different kind from `StopStatusChanged` (the stop's state moved) and from
`PickedUp` / `Delivered` (the milestone was reached). Three ideas that a naive
model would fuse into one "arrived" event.

## Time, identity, evidence

**Time.** Three named kinds, defined in `guides/dates-timestamps`: *Date Only*
(`yyyy-MM-dd`), *Date Time (timezone aware)* (`...±HH:mm`), *Date Time (UTC)*
(`...Z`), all RFC 3339. `guides/timestamps` adds the rule that matters: standard
timestamps are always UTC, **except** that "in some instances, such as location
normalization, timestamps are returned in the **local stop time** of the event",
with the offset included. The stop-write endpoints enforce it at the boundary: "A
value sent without a UTC offset is read as **the stop's local time**", and
`MM/dd/yyyy` "is rejected with `400` and the offending field named"
(`trips_record-stop-arrival`). On a tender, the zone is carried as data -
`TenderDateTimeResponse { DateTime, TimeZoneCode }`.

The planned/estimated/actual triad is modelled three separate ways, correctly:

| Layer | Planned | Estimated | Actual |
| --- | --- | --- | --- |
| Load | `ScheduledPickupAt`, `ScheduledDeliveryAt` | - | `PickedUpAt`, `DeliveredAt` |
| Trip | `PickupDate`, `DeliveryDate` | `Eta { Planned, Live, Manual }` (final stop) | `PickedUpAt`, `DeliveredAt` |
| Stop | `AppointmentDate` (APPT) or `StopWindow {Begin, End}` (FCFS) | `Eta { Planned, Live, Manual }` | `ArrivedAt`, `DepartedAt` |

`Eta` is the single best C5 idea in the source: **three estimates that differ by
who produced them**, kept side by side rather than overwritten, each nullable.
A consumer can tell a route-planner's estimate from a telematics-derived one from
a dispatcher's phone call. (Caveat worth recording for our own build: `Planned`
and `Live` "require HOS-aware ETAs (Growth or Scale package, or the **Samsara
Premium add-on**); `Manual` is available on every plan" - i.e. the richest ETA is
a paid telematics integration, not a TMS-native computation.)

**Identity.** Dense and deliberate:

- Per entity: `Id` (opaque) **plus** a human number - `LoadNumber` ("unique by
  subsidiary"), `TripNumber` (derived, `T100245-1`), `Number` on invoices,
  `StopId` (stable across reorders).
- Cross-party: `OrderNumber` (the partner's shipment id), `PONumber`, `TenderId`
  on the load ("`null` if the load was created manually or through a non-tender
  channel"), `ShipmentId` on the tender, `SCAC`, `CompanyCode`, carrier `MC`/`DOT`,
  `CompanyId`/`CompanyNumber` per stop, `ExternalId` on tracking submissions.
- **`References[]` is the generalised mechanism, and it is typed**: each reference
  has a `Name`, a `Value`, a `Type` (`Text`/`Date`/`Bool`/`List`), an `Access`
  (`Internal`/`Public`) and an `Origin` (`Manual`/`Integration`). On a tender the
  EDI form is kept: `{ Id, Qualifier, Description }`, with parties identified by
  `N1Qualifier` + `IdCodeQualifier` + `IdCode`.
- A warning it publishes about its own correlation: a change tender that cannot be
  matched re-fires `tender.created`, so "A `data.tender.shipmentId` you have
  already seen can therefore arrive a second time under a different `tenderId` -
  **key your own records on `tenderId`, not on the shipment identifier.**"

**Evidence, provenance and corrections.** The strongest part of the source.

- **Actor on every fact**: `CreatedBy`, `UpdatedBy`, `CancelledBy`,
  `DispatchedBy`, `DispatcherId` on loads/trips; `SharedBy` on visibility updates;
  `CreatedBy` on a check call is the integration's own name
  (`"public-api-tl743-integration"` in the example).
- **Source on every derived number**: `Mileage.Source` + `ProfileName`;
  `Eta.Planned|Live|Manual`; position `Source: PublicApi`; reference `Origin`.
- **Observation vs receipt**: `RecordedAt` vs `ReceivedAt` on a position; and on
  tender stop events, "The envelope `timestamp` is the moment the underlying
  business event occurred. For the three stop events it is when Alvys
  **recorded** the update, which can be later than the arrival, departure, or ETA
  the payload itself reports - use `data.arrivedAt` ... when you need the
  operational time."
- **Corrections are explicit operations**: `DELETE /trips/{id}/stops/{id}/arrival`
  "removes the `ArrivedAt` timestamp ... effectively marking the stop as **not yet
  arrived**", so drivers or dispatchers "can log the correct time";
  `PUT /loads/{n}/documents/{id}/type` reclassifies "an upload that arrived as
  Unclassified". On money, the opposite rule: "**A correction is a new record, not
  a retry** - give it a new key" (`guides/idempotency`), and "Moving money to a
  different parent is a delete and a create, not an edit" (`guides/concurrency`).
- **Optimistic concurrency as a general rule, not a quirk**: "Every `PATCH` ... is
  guarded by an **ETag**. This is the general mechanism, not a per-endpoint quirk"
  - `428` = no `If-Match`, `412` = stale, `409` = closed. Plus the warning "**Do
  not drop the header to get past a `412`.** The header is not the obstacle - the
  concurrent edit is."
- **Idempotency separated from concurrency**: `ExternalId` on creates ("An
  idempotency key protects a record that may not exist yet; an ETag protects one
  that already does"), with the failure it exists to prevent named in one sentence:
  "Sending it again without a key is how a single detention charge becomes two."
  Reusing a key with a changed amount is `409`, not an overwrite.
- **Change feeds that admit their own limits**: `data.diff.changes` is "a
  **filtering hint only** - it is never authoritative and never suppresses an
  event"; `previousAttributes` diffs keyed collections by stable `id`
  (`removed` full element / `changed` sparse / `added` id-only). And the honest
  note that a single user action fans out: editing a trip re-saves its parent load,
  producing a companion `load.changed` with `changes: []`.

## Scores

Weights are set per area in phase 3; these are the raw 0-3 criterion scores.
Cites are to `local/docs/<file>.md` as named in Vocabulary and Lifecycles.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 3 | 2 | 2 | 0 | 2 | 3 | 3 | 3 | C1=3: **offer/accept/decline is native** - tender created / accepted / rejected / cancelled / change-created / change-accepted / bid-submitted / invoiced (`webhooks_tender-events`) plus a 16-value load ladder and an explicit EDI 204/990 decision table (`guides/edi-integrations`). C2=2 not 3: the ladder is quoted as a filter allow-list and **no status string is ever defined** - `TONU`, `Released`, `Queued`, `Financed`, `In Review` are unexplained. C3=2: real preconditions with status codes (check call 422 outside `Covered/Dispatched/In Transit`; 409 = settled; `Assigned -> Dispatched` on dispatch) and a named actor on each transition, but no published transition table. C4=0: zero HHG. C7=3 / C8=3: ETag+`ExternalId`, `changeTypes` "a stable contract", "tolerate values outside this list", versioned path + semver guide. |
| A2 Shipment structure | 2 | 3 | 2 | 0 | 2 | 3 | 3 | 2 | C2=3 for the distinction that matters most to us: **the load is the commercial shipment and the trip is the execution**, stated and enforced - stops live on the trip, the load's `Origin`/`Destination` are "derived from the load's stops", and a load with no trip is a 404. Shipment quantity is typed (`Weight {Value, UnitOfMeasure}`, `Volume`, `RequiredEquipment[]`, `LoadType: Revenue / Non-Revenue`, `CustomerType`, commodity via `CommodityChanged`), and a tender carries per-stop `Orders[]` with `Quantity`/`Weight`/`Volume`/`PoNumber`/`SequenceNumber`. C1=2 not 3: **no services-ordered list and no shipment typing** - one generic freight load; the only "type" is equipment. C4=0. |
| A3 Trip, stop & assignment | 3 | 3 | 2 | 0 | 3 | 3 | 3 | 3 | **The best A3 in the comparator set.** C1=3/C2=3: load->trip->ordered stops, with a **polymorphic stop** (`$type = appointment / delivery_window / waypoint`), `ScheduleType APPT/FCFS` driving which time fields are required, `LoadingType Live/Drop/Hook/Drop&Hook`, `StopType Pickup/Delivery/Waypoint`, and assignment as a first-class command (`TripAssignmentRequest`: carrier + dispatcher required, driver/truck/trailer optional) separate from dispatch. **Stop identity is stable and the docs say so twice** - stop-scoped change kinds carry `target {type: "Stop", id: "<StopId>"}`, "the stable stop identity from the snapshot - **never a positional index**". Re-sequencing is its own event (`StopReordered`). C3=2: trip ladder + `Assigned->Dispatched`, but **`Stops[].Status` values are never enumerated anywhere we read**. C5=3 (appointment vs window vs ETA vs actual, per stop). C4=0: no crew, no agent, no SIT. **Limit to record: one trip = one `LoadNumber`** - splitting is supported (a load split supersedes a trip, retrievable via `includeDeleted`), consolidation is not evidenced. |
| A4 Execution events & tracking | 3 | 3 | 2 | 0 | 3 | 3 | 3 | 3 | C1=3: arrive/depart as explicit commands **plus a clear-arrival command**, check calls with `Activity` and `ResponseType`, inbound and outbound visibility histories with their own error log, asset position and telemetry ingestion, and a closed change-kind vocabulary. C2=3 for distinguishing `ArrivalRecorded` (a fact written) from `StopStatusChanged` (state moved) from `PickedUp`/`Delivered` (milestone reached). **C5=3 - `Eta { Planned, Live, Manual }` is the single idea most worth stealing**, plus `RecordedAt` vs `ReceivedAt` and the envelope-timestamp-vs-operational-time warning on tender stop events. C7=3: `SharedBy`, `Source`, `Origin`, actor on every write, at-least-once + dedupe on `X-Alvys-Event-Id`, HMAC signatures. C4=0: **no pack, load, unload, deliver-at-residence, no shuttle, no reweigh**; the milestone set is freight's two (`PickedUp`, `Delivered`). Delay/exception **reason codes are not published** - `Reason` on a visibility update is "There is defined list on system, depending on integration. E.g.: `"NA"` - Normal Appointment", i.e. the partner's code list, not Alvys's. |
| A5 Storage-in-transit | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **Absent.** No storage, no warehouse party, no SIT in/out, no duration, no permanent-storage boundary anywhere in what we read. The only structural analogues are `$type = waypoint` (a stop with a window and no appointment - the shape a warehouse stop would take) and `LoadingType = Drop` / `Hook` (trailer left or collected, i.e. goods resting between legs). Worth noting because they show the *stop* model could carry SIT without change - the *business* model has nothing. |
| A6 Documents & evidence | 2 | 2 | 1 | 1 | 1 | 2 | 2 | 2 | C1=2: documents on load, trip, carrier, driver, truck, trailer, each with an **enumerated allowed-type list** (trip: `Proof of Delivery, Bill of Lading, Carrier Rate Confirmation, Load Manifest, Trip Report, Temp. Log, Proof of Pickup, Scale Ticket, Notice of Assignment, NOA, Shipping Labels`; load: the four rate/load-confirmation variants + POD/POP/BOL/Shipping Labels), size caps (10 MB, 25 MB on trips) and MIME allow-lists. C4=1: `Scale Ticket` is a weight ticket, `Proof of Delivery`/`Bill of Lading` are shared with HHG - but no inventory, no order for service, no estimate, no valuation form. **C3=1 and C7=2 both rest on one feature**: `Change ... document type` "for example filing a driver upload that arrived as **Unclassified**" - an implicit `Unclassified -> typed` state and a published reclassification path. C5=1, and the decisive weakness: **a document attaches to an entity, never to an event or a fact** - a POD is filed against a trip, not against the delivery it evidences. |
| A7 Charges & billing hooks | 3 | 3 | 2 | 0 | 2 | 3 | 3 | 2 | C1=3/C2=3: the **linehaul-vs-accessorial split is structural, not a code list** - `Linehaul`, `FuelSurcharge`, `CustomerAccessorials`, `CustomerRate` ("includes all applicable customer accessorials like Linehaul (LH) + Fuel Surcharge (FSC)...") on the revenue side, `Carrier.Linehaul` / `Carrier.Rate` / `Carrier.TotalPayable` / `TripValue` on the cost side. `CustomerAccessorialsDetails[]` carries `Type`, `Rate`, `RateType (Flat/PerHour/PerMile)`, `Uom (Hour/Mile/Stop)`, `Quantity`, `IsPaid` and **`StopId`** - accessorials can be scoped to the stop that caused them (detention). Invoices are typed (`LoadInvoice / OrderInvoice / SummaryInvoice / StandaloneInvoice`) with `Draft / AwaitingPayment / Paid`, `InvoicedDate` / `DueDate` / `PaidDate`, `RemainingBalance`, `OverPaymentAmount`, `SupplementalInvoiceType`, and charge *events* exist (`PaymentRecorded`, `InvoicedChanged`, `AccessorialsChanged`, `CarrierPaymentRecorded`). C7=3 - the idempotency guide is written *about* charges ("how a single detention charge becomes two"), and structural fields are immutable: "An accessorial or credit cannot move to a different load, trip, stop, or accessorial type." C4=0: no valuation, no SIT charges, no 400N/400NG. |
| A8 Parties & roles | 2 | 2 | 2 | 0 | n/a | 3 | 2 | 2 | Customer, Carrier (MC/DOT, insurance expiry, safety rating, lane preferences), Driver1 / Driver2 / OwnerOperator with `ContractorType`, Dispatcher, Fleet, Location (saved shipper/consignee with receiving hours), and per-stop `CompanyId`/`CompanyNumber`/`CompanyName`. C6=3 for **EDI-grade party identification** on tenders (`N1Qualifier` + `IdCodeQualifier` + `IdCode`) and MC/DOT/SCAC elsewhere. C3=2 for a carrier status machine ("transitioning between active, inactive, blocked, and pending"). **The one idea that maps to our agent roles is `TenderAs` / `TenderAsSubsidiaryType`** - "role under which the trip was tendered (e.g. `Carrier`)", i.e. our own subsidiary's role is per-trip data, not a fixed attribute. C4=0: no van line, no booking/origin/hauling/destination agent, no warehouse, no shipper-vs-transferee (the customer is a broker's customer, and the goods' owner is not modelled at all). |
| A9 Identity & cross-references | 3 | 3 | n/a | 0 | n/a | 3 | 3 | 3 | **The best A9 in the comparator set.** Opaque `Id` + human number per entity; `TripNumber` derived from `LoadNumber`; `LoadNumber` unique *per subsidiary* (scope stated); `OrderNumber` = "the partner-facing Shipment Id" and the only writable field on a load; `PONumber`; `TenderId` on the load with its null-meaning spelled out; `ShipmentId` + `SCAC` + `CompanyCode` on the tender. **C2=3/C7=3 for `References[]` as a typed object with `Type`, `Access (Internal/Public)` and `Origin (Manual/Integration)`** - visibility and provenance travel with the identifier. C8=3: `FieldChanged` names fields by an explicit allow-list with the PascalCase-vs-camelCase mismatch documented ("Do not use `target.id` as a direct key into the payload"). And the published correlation hazard: key on `tenderId`, not `shipmentId`. |

Areas **A10 (survey, estimating & inventory)** and **A11 (claims & valuation)**
are **absent** - not scored, nothing to record. **A12** and **A13** are recorded
under *Out-of-v1 material*.

**S5 - fit to Pegasus data.** Alvys holds none of our data; the column reads "can
pegII / Cloud express the concept this source makes explicit?", judged against
`src:pegii-order`, `src:pegii-longhaul`, `src:pegasus-cloud-domain`,
`src:pegasus-cloud-prisma`.

| Area | Fit | Note |
| --- | --- | --- |
| A1 | partial | pegII has order status + `KeyMoveDates`; **no tender/offer object** is evidenced on our side, and our inbound work comes from van-line registration, not EDI 204. Cloud has 5 generic move states. |
| A2 | partial | pegII: one Sale == one shipment (`src:pegii-order`), so the load-vs-trip seam has no pegII counterpart. Cloud has **no shipment entity at all**. |
| A3 | **no** | The concept Alvys is clearest about is the one we are least able to supply: Cloud's `Stop.moveId` is mandatory (no trip), and pegII's trip surface is MSSQL-only (`src:pegii-longhaul`). Adopting an Alvys-shaped A3 would be a new aggregate in both systems. |
| A4 | partial | pegII has `SettlementUniqueInfo.Actual{Pack,Load,Deliver}Date` and `LocalDispatchUniqueInfo.{Earliest,Latest}...` - actuals and windows, but **no ETA of any kind and no arrival/departure**. Nothing on our side can express `Eta {Planned, Live, Manual}` today. |
| A5 | n/a | Alvys has no SIT; it cannot inform this area. |
| A6 | partial | pegII's `DocumentationDates` positional array vs Alvys's per-entity typed document lists - Alvys is a better shape but a worse HHG vocabulary; neither links a document to an event. |
| A7 | partial | Cloud's 400NG rater produces linehaul-vs-accessorial codes but `QuoteLineItem.description` is free text (`src:pegasus-cloud-domain`); **the stop-scoped accessorial (`StopId` on a detention charge) has no counterpart on our side.** |
| A8 | partial | `TenderAs` (role-per-trip) is directly relevant to booking/origin/hauling/destination agent, which neither pegII nor Cloud models. |
| A9 | partial | `IntegrationCorrelation` in Cloud's Prisma schema is the nearest thing we have (`src:pegasus-cloud-prisma`); Alvys's typed `References[]` with `Access` + `Origin` is strictly richer and is the target shape. |

## Strengths worth adopting

1. **The load/trip seam, stated as invariants.** Not "we have both entities" but:
   stops belong to the **trip**; the load's origin/destination are **derived**
   from them; a load without a trip is **not addressable**; splitting a load
   **supersedes** a trip and the superseded one remains retrievable
   (`includeDeleted`). Our A2/A3 boundary should be expressible as that same short
   list of rules.
2. **`Eta { Planned, Live, Manual }`.** Three estimates kept side by side,
   distinguished by *who produced them* (route planner / telematics / human or
   integration), each independently nullable. This is the cleanest answer in the
   whole source set to "planned vs estimated vs actual", and it generalises: any
   forecast we publish should say which engine produced it.
3. **Polymorphic stops by scheduling shape** - `$type = appointment |
   delivery_window | waypoint`, with `ScheduleType APPT/FCFS` deciding which time
   fields are *required*. An appointment and a window are not the same fact with a
   null; they are different subtypes with different obligations. Plus
   `AppointmentRequested` and `AppointmentConfirmed` as **two** booleans.
4. **Stable stop identity, asserted against positional indexing.** "the stable
   stop identity from the snapshot - never a positional index", and `StopReordered`
   as a first-class change. Our A3 must not let stop sequence be the identity -
   pegII's `DocumentationDates` positional array is exactly the failure mode.
5. **Separate `ArrivalRecorded` from `StopStatusChanged` from `PickedUp`.** Three
   kinds, three meanings: a fact was written; the stop's state moved; a shipment
   milestone was reached. Our event catalog should keep all three apart, because
   corrections write the first without moving the second.
6. **An explicit un-do for an operational fact.** `DELETE .../stops/{id}/arrival`
   "effectively marking the stop as not yet arrived ... so drivers or dispatchers
   can log the correct time." A published correction operation, distinct from an
   edit - and contrasted with money, where "a correction is a new record, not a
   retry".
7. **Typed references carrying visibility and provenance.**
   `{ Name, Value, Type, Access: Internal|Public, Origin: Manual|Integration }`.
   Adopting `Access` alone would answer "may this identifier be echoed to a
   partner?" - a question our integration floors currently answer by convention.
8. **Change kinds are business concepts and are admitted to be advisory.** "Kind
   names describe business concepts - they never expose internal field names or
   JSON paths"; and "Treat `changes` as a **filtering hint only** - it is never
   authoritative and never suppresses an event ... always tolerate change kinds
   you don't recognize." Both halves belong in our catalog's versioning policy.
9. **`previousAttributes` diffed by stable id, with the cascade admitted.** Keyed
   collections diff as `removed` (full previous element) / `changed` (sparse) /
   `added` (id only), and the docs tell you that editing a trip re-saves its parent
   load and emits a content-free `load.changed` you should filter out. A model that
   publishes its own fan-out noise is one you can build against.
10. **A distance carries its engine** - `Mileage { Distance {Value, UnitOfMeasure},
    Source, ProfileName }`. The same discipline as SmartMoving's
    `VolumeWeightCalculationMode`, arrived at independently: **a derived number is
    not a fact until it names its method.**
11. **ETag/If-Match as a blanket rule, with `412` vs `409` given different
    meanings** ("try again with fresh information" vs "this record is closed, stop
    asking"), and the explicit prohibition on dropping the header to get past a
    conflict. Relevant directly to our own `put_projection` / correlation surface.
12. **`TenderAs` - the role a party played on this movement is per-movement data.**
    The seed of an agent-role model, from a system that has no agents.

## Weaknesses / traps

1. **Zero HHG.** No survey, estimate, inventory, valuation, claim, SIT, warehouse,
   crew, shuttle, reweigh, agent, packing, or residence access. C4 is 0 in every
   scored area and that is not a scoring artefact: adopting Alvys wholesale would
   give us a freight-broker model with a moving company bolted on the side.
2. **Statuses are filter allow-lists, not a vocabulary.** Sixteen strings, no
   definitions, and they **fuse operational with financial state** (`In Transit`
   and `Financed` on one ladder). Our A1 should keep those axes separate - a load
   that is `Delivered` and a load that is `Paid` differ in which lifecycle moved.
3. **Stop status is referenced three times and never enumerated.** A consumer
   cannot build a stop state machine from the published docs at all.
4. **One trip carries one load - no consolidation.** The single most important HHG
   A3 requirement (several shipments on one van, picked up and delivered in
   interleaved sequence) is not expressible. Alvys solves the *inverse* problem
   (one load, several trips, via splits). Borrowing its cardinality would be a
   direct model failure for us.
5. **Two milestones only.** `PickedUp` and `Delivered`. HHG needs at minimum
   pack / load / depart origin / arrive destination / unload / deliver, plus SIT
   in and out - and Alvys's shape gives us no guidance on how to place them.
6. **Exception and delay reasons are the partner's, not the platform's.** The only
   `Reason` field we saw is "defined list on system, **depending on integration**"
   with `"NA" - Normal Appointment` (an EDI 214 AT7 code) as the example. Alvys
   passes reason codes through; it does not own a catalog. Our A4 must own one.
7. **Documents attach to entities, never to events.** A POD is filed against a
   trip. Nothing says which delivery it evidences, and there is no
   signed/complete state - only the document's *type*, and a reclassification path
   for uploads that arrived `Unclassified`.
8. **The richest ETA is a paid telematics add-on.** `Eta.Planned` / `Eta.Live`
   "require HOS-aware ETAs (Growth or Scale package, or the **Samsara Premium
   add-on**)". Copy the *shape* (three sourced estimates) but do not assume the
   values are cheap to produce - on our side they would be Samsara/Omnitracs
   derived, and `Manual` would be the common case.
9. **Money currency is inconsistent across surfaces**: `Money {Amount, Currency}`
   with Currency as an ISO-4217 **string** on loads and trips, but "`Total.Currency`
   | **Integer** | The currency in which the invoice is issued" on invoices
   (`invoices_get-invoice`). A reminder that a value-object is only as good as its
   consistent use.
10. **Legacy fields ship alongside their replacements** - `Driver1.Rates[]`
    ("**Legacy field.** ... may be empty or outdated") next to `RatesV2[]`, "no
    longer populated for new trips created after migration to Driver Settlement".
    Honest, but it means a consumer must know the migration date. An argument for
    versioning the *event*, not deprecating in place.
11. **`FieldChanged` is an escape hatch with a two-entry allow-list** (`OrderNumber`,
    `PONumber` on loads; nothing on trips). The moment a business value has no
    semantic kind, the catalog leaks a field name - and in the wrong casing.
12. **Grade-B caveat:** everything above rests on ~30 of 96 reference pages.
    Carriers, customers, trailers, trucks, settlement and most webhook-management
    endpoints were read only as one-line index descriptions. Do not treat any
    "Alvys has no X" claim as final without opening those pages or the gated spec.

## Out-of-v1 material

- **A12 - rating & accessorials.** `CustomerAccessorialsDetails[]` is a compact
  accessorial model: `Type` (Detention, Layover, Fuel Surcharge), `RateType`
  (`Flat` / `PerHour` / `PerMile`), `Uom` (`Hour` / `Mile` / `Stop`), `Quantity`,
  `Rate`, `Total`, `IsPaid`, `StopId`. Invoice line items carry
  `Rate { UnitOfMeasurement, Units, Rate }` and a `Category`. Mileage is rated off
  a named **profile** (`CustomerMileage.ProfileId` / `ProfileName`) with a
  `Source` - i.e. the mileage engine is configuration, and which one was used is
  recorded on the record.
- **A13 - driver, carrier & settlement.** The deepest out-of-v1 material in the
  source. `Driver1.RatesV2[]` is a **pay-policy model**: `PolicyId`, `PolicyName`,
  `PerTripRate { Rate, RateId, RateName, LineItems[] }`,
  `TripValuePercentageRate { Percentage, RateId, RateName, LineItems[] }` - i.e.
  pay is an applied *policy* producing *line items*, not a number. Plus: driver and
  carrier **settlement statements** (searchable, retrievable by statement number,
  with "per-trip breakdown, line items, deductions, and net pay"); **deductions**
  (one-time and recurring, with frequency and effective dates, tied to the
  settlement they apply to); `CarrierPayOnHoldChanged` and `DriverRatesChanged` as
  events; `record-invoice-financing` (factoring: funder, funded amount, reserve,
  remittance) and the `Financed` load status; **fuel** and **toll** transactions
  per card/driver/unit; `search-driver-events` (`EventType`: `Vacation`,
  `Restart`, `Other`, with start/end and address) - HOS/availability as first-class
  events; **dispatch preferences** ("routing, equipment, home-time, and lane
  preferences configured for drivers"); **maintenance** records per truck/trailer
  (work order, vendor, parts, labour, completion).
- **Telematics boundary (informs A4 for our Samsara/Omnitracs work).** Alvys draws
  the line explicitly: `POST /tracking/{assetId}/location` and `/telemetry` ingest
  positions "from an external ELD or a self-reporting vehicle" with
  `Coordinates`, `RecordedAt`, optional `Address` (else reverse-geocoded), optional
  `TripId` ("Omit it and Alvys selects the asset's **active trip with the nearest
  stop**"), `Odometer` + `OdometerReadingAt`, and it returns `Source`,
  `ReceivedAt`, `TripId`, `TripNumber`. Telemetry adds speed, heading, fuel level,
  ambient temperature. **Positions are attributed to a trip by the platform, not
  by the sender** - a rule worth copying. `search-truck-events` /
  `search-trailer-events` expose "telematics events ... with load or trip context".
- **Outbound visibility as a distinct, fallible channel.** `get-outbound-visibility-history`
  ("every position ping and status event Alvys **pushed to customer platforms**")
  and `search-outbound-visibility-errors` ("by customer platform, load number,
  error type, and failure date range"). The shipper-visibility obligation is
  modelled as data with its own error log - directly relevant to the user's
  "shippers may require visibility platforms later" note.
- **Webhook operations surface** (read only as index entries): delivery logs,
  export delivery logs, health metrics, secret reveal/rotate, enable/disable,
  test delivery, verify ownership. If we publish a catalog, this is the
  operational surface that has to exist around it.

## Open questions

1. **What are the values of `Stops[].Status`?** Referenced in three response
   schemas, enumerated nowhere. Without it the stop state machine is unreadable -
   and A3/A4's C3 scores would move if it turned out to be rich.
2. **What do `TONU`, `Released`, `Queued`, `Financed` and `In Review` mean, and
   which transitions are legal?** The 16 strings are an allow-list, not a machine.
   (`TONU` is almost certainly "truck ordered, not used", but the docs never say
   so - flagged rather than assumed.)
3. **Can one trip ever carry more than one load?** `TripDetailsResponse.LoadNumber`
   is a scalar and `search-trips` filters by "load number", which reads as 1:1 -
   but we did not read the load-split or multi-stop-consolidation documentation, if
   any. This is the single most consequential unknown for using Alvys as the A3
   comparator.
4. **Is `Assigned` a status, an assignment flag, or both?** `dispatch-trip` says
   "transitioning the trip from Assigned to Dispatched", yet `Assigned` is not in
   the trip status allow-list. Either the list is incomplete or assignment is a
   second axis - which would itself be a useful modelling finding.
5. **What is in the gated `openapi/alvys.json`?** One fetch behind a docs login
   would upgrade this whole analysis to grade A and settle questions 1-4. Cheap,
   and worth asking the user whether a free docs account is acceptable.
6. **Does Alvys model anything between pickup and delivery that rests?** `waypoint`
   stops and `LoadingType = Drop` are the two candidates. If a drop-and-hook at a
   yard is representable as a pair of stops, that is the shape our SIT-as-stops
   option would take - worth testing before we decide A5's structure.
7. **How are stop-scoped accessorials reconciled with a stop that is later
   removed?** "An accessorial cannot move to a different load, trip, stop"
   (`guides/concurrency`) plus `StopRemoved` as a change kind implies an orphaning
   case the docs do not address.
