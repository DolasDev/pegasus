---
source: src:samsara
analyzed: 2026-09-17
evidence_grade: A
material: >
  sources/samsara/local/samsara-api.json (OpenAPI 3.0.1, 4.4 MB, single-line JSON -
  no line numbers, so claims cite JSON pointers such as components.schemas.<Name>).
  266 paths, 5,477 component schemas. Read: info.description overview, the full tag
  list, the complete path inventory, and ~45 domain-bearing schemas covering routes,
  route stops, route events, the route audit-log feed, canonical orders and order
  tasks, webhooks, documents, form submissions, DVIRs, HOS/ELD events, trips,
  driver-vehicle assignments, addresses/geofences, alert incidents and the alert
  trigger catalog. NOT read: the ~5,400 remaining schemas, which are almost entirely
  per-operation error envelopes (twelve *ErrorResponseBody variants per endpoint) and
  request/response wrappers; and the Industrial, Camera/Media, Tachograph,
  Maintenance-parts, Ridership and Functions subsystems, which are out of domain.
  NOT AVAILABLE IN THIS FILE and therefore not read: **the webhook payload shapes**.
  The spec names all 35 webhook event types (components.schemas.
  WebhookResponseResponseBody.eventTypes) but contains no payload schema for any of
  them; those live at https://developers.samsara.com/docs/webhook-reference, which we
  did not fetch. Everything said below about webhooks is about the *catalog*, not the
  payloads.
---

# Samsara API - analysis

## What it is

The public OpenAPI 3.0.1 contract for the **Samsara** fleet platform - a
**vendor-api** (S1) spanning telematics hardware (gateways, dashcams, sensors),
compliance (HOS/ELD, DVIR, IFTA, tachograph), driver workflow (routes, stops,
documents, forms, messages), maintenance, and safety. Adoption **S2 = 3** within
its niche: it is the de-facto modern North American fleet-telematics platform,
with a large installed base and an API most TMS vendors already integrate; it is
not a standard, but it is the one everyone builds against. Openness **S3 = public**
(`https://developers.samsara.com/openapi/samsara-api.json`, unauthenticated;
API access needs an org token).

Our reading concentrated on the **driver-workflow and event surfaces** - the parts
that describe work rather than hardware. The spec is built in layers the info text
acknowledges: a "next-generation" REST surface, a `/v1/...` legacy surface, and
explicitly labelled `[beta]` and `[preview]` channels (`tags`: `Beta APIs`,
`Preview APIs`, `Legacy APIs`). This matters for us: **canonical Orders - the only
Samsara object that resembles a shipment - are in `[preview]`**
(`/preview/fleet/orders`, `/preview/fleet/orders/batch`,
`/preview/fleet/orders/stream`, `/preview/fleet/orders/deletions`), and the Hub /
Plan / route-template planning layer is `[beta]`.

The most important gap in our reading is named in the front matter: **webhook
payloads are not in this file.** We have the complete event-type catalog and
nothing about what each payload carries.

## Model summary

Samsara's object graph, in its own words:

```
Organization
  +-- Hub  [beta]  - a depot/planning origin; owns locations, capacities, skills,
  |                  custom properties and route templates
  |     +-- Plan [beta] --- Route[]
  |
  +-- Order  [preview]  "A canonical customer order."
  |     +-- tasks[] : OrderTask  "An action belonging to a canonical order."
  |             taskType in {unknown, delivery, pickup, pickupDelivery}
  |             serviceLocation, serviceWindows[], serviceDurationSeconds,
  |             quantities[], skills[], positionConstraintType, routeId
  |
  +-- Route  - stops[] (minItems: 2), driver, vehicle, settings, externalIds
  |     +-- RouteStop
  |           state in {unassigned, scheduled, "en route", skipped, arrived, departed}
  |           scheduledArrival/DepartureTime, eta, enRouteTime,
  |           actualArrival/DepartureTime, skippedTime,
  |           appointmentWindows[] (max 3), ontimeWindowBefore/AfterArrivalMs,
  |           plannedDistanceMeters vs actualDistanceMeters,
  |           orders[] (order-task references), documents[], forms[], issues[],
  |           address | singleUseLocation, liveSharingUrl, externalIds
  |
  +-- Driver / Vehicle / Trailer / Equipment / Asset   (four distinct asset kinds)
  +-- Address  - geofence (circle or polygon) + addressTypes[] + externalIds
  +-- Document / DocumentType       - driver-submitted evidence, typed fields
  +-- FormSubmission / FormTemplate - driver-submitted evidence, with approval loop
  +-- DVIR / Defect / DefectType
  +-- HOS log / ELD event / violation / clock
  +-- Trip            - vehicle movement, independent of any route
  +-- Alert configuration -> Alert incident (68 trigger types)
  +-- Webhook         - 35 event types, versioned
  +-- Live Sharing Link - externally shareable tracking URL
```

Three things define the shape of this model:

1. **Stops carry state; orders do not.** The `RouteStop.state` enum is the only
   execution state machine in the workflow domain. `FleetOrderTaskObjectResponseBody`
   has `createdAtTime`, `updatedAtTime`, a `routeId` when attached - and **no status
   field at all**. Order progress is inferred from the state of the stop its task is
   attached to. This is the exact inverse of what HHG needs.

2. **Work products attach to the stop, not the order.** `documents[]`, `forms[]`,
   `issues[]` and `orders[]` all hang off `RouteStopWithOrdersResponseObjectResponseBody`.
   Evidence is collected at the place and moment of work.

3. **Three separate event channels, with different guarantees.**
   - `GET /route-events/stream` - a business-event stream, 8 typed event kinds,
     each with `happenedAtTime` *and* `eventTime`.
   - `GET /fleet/routes/audit-logs/feed` - "a feed of immutable, append-only
     updates for routes", cursor-paged, carrying a **before/after diff**, an
     `operation` (10 values) and a **`source` (`automatic | driver | admin`)**.
   - Webhooks - 35 event types pushed to a URL, versioned (`2018-01-01`,
     `2021-06-09`), with a shared secret and up to 5 custom headers.
   Plus a fourth, derived channel: **Alerts** - `GET /alerts/incidents/stream`,
   where an org-configured alert configuration produces incidents with
   `isResolved` / `resolvedAtTime`, drawn from a catalog of 68 trigger types.

**Trip vs route - the distinction is explicit and clean.** A `Trip`
(`components.schemas.TripResponseBody`) belongs to an **asset**, not a route:
`{asset, tripStartTime, tripEndTime, startLocation, endLocation,
completionStatus in {inProgress, completed}, finalDistanceMeters, tripPurpose}`.
It is a movement of a vehicle between two rests, with no order, no stop, no
customer. A `Route` is planned work. Samsara never conflates the two - there is no
field linking a Trip to a Route in this spec. That separation is the single
cleanest piece of A3 evidence in either telematics source.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Order** (canonical) | "A canonical customer order." Holds `samsaraCustomerOrderName` (human-readable label), `externalIds` ("Org-scoped external identifiers"), `customerProperties`, and `tasks[]`. No state. | A1, A2 | `components.schemas.FleetOrderObjectResponseBody` |
| **Order task** | "An action belonging to a canonical order." `taskType in {unknown, delivery, pickup, pickupDelivery}`; carries `serviceLocation`, `serviceWindows[]`, `serviceDurationSeconds`, `quantities[]`, `positionConstraintType`, `hubId`, `routeId`, `dispatcherNotes`, `driverNotes`. | A2, A3 | `components.schemas.FleetOrderTaskObjectResponseBody` |
| **positionConstraintType** | `unknown \| none \| first \| last` - constrains where on a route the task may be sequenced. | A3 | same |
| **Route** | Planned work; `stops[]` with `minItems: 2`; `driver`, `vehicle`, `externalIds`, `notes`, `orgLocalTimezone`, `settings`, `recurringRouteLiveSharingLinks`. | A3 | `components.schemas.BaseRouteWithOrdersResponseObjectResponseBody` |
| **Route settings** | `routeStartingCondition in {departFirstStop, arriveFirstStop}`; `routeCompletionCondition in {arriveLastStop, departLastStop}`; `sequencingMethod in {unknown, scheduledArrivalTime, manual}`. An explicit, configurable definition of *when a route starts and ends*. | A3 | `components.schemas.RouteSettingsResponseBody` |
| **Route stop** | A stop with its own state machine, three time families and attached work products. | A3, A4 | `components.schemas.RouteStopWithOrdersResponseObjectResponseBody` |
| **state** (stop) | `unassigned, scheduled, "en route", skipped, arrived, departed`. Note `"en route"` contains a space. | A4 | same; also `MinimalRouteStopResponseBody` |
| **appointmentWindow** | `{startTime, endTime}`, max 3 per stop - the customer-facing promise. | A3, A5 | `components.schemas.RouteStopAppointmentWindowResponseBody` |
| **ontimeWindowBeforeArrivalMs / AfterArrivalMs** | "the time window (in ms) before/after a stop's scheduled arrival time during which the stop is considered 'on-time'." Tolerance as data, per stop. | A4 | `RouteStopWithOrdersResponseObjectResponseBody` |
| **enRouteTime** | "The time the stop became en-route" - a distinct timestamp from departure of the previous stop. | A4 | same |
| **skippedTime** | Timestamp of a skip; the stop keeps its identity and sequence. | A4 | same |
| **singleUseLocation** | An ad-hoc address for one stop, as opposed to a catalogued `address`. | A3 | same |
| **liveSharingUrl** | "The shareable url of the stop's current status." Per stop, plus route-level and location-level Live Sharing Links with `expiresAtTime`. | A4, A9 | same; `LiveSharingLinkFullResponseObjectResponseBody` |
| **Trip** | Asset movement: `{asset, tripStartTime, tripEndTime, startLocation, endLocation, completionStatus, finalDistanceMeters, tripPurpose}`. Not linked to a route. | A3, A4 | `components.schemas.TripResponseBody` |
| **tripPurpose** | `unknown, unassigned, personal, business, commute` - "the driver-assigned purpose ... `unassigned` means the driver has not classified the trip. Reflects the explicit Driver App classification, not automatic classification." | A4 | same |
| **Address** | A place *and its geofence*: `formattedAddress`, `latitude`/`longitude` ("Will be geocoded from `formattedAddress` if not provided"), `geofence` (circle **or** polygon, "but not both"), `addressTypes[]`, `contacts[]`, `tags[]`, `externalIds`, `notes` (max 280 chars). | A3, A9 | `components.schemas.Address`, `AddressGeofence` |
| **addressTypes** | `yard, shortHaul, workforceSite, riskZone, industrialSite, alertsOnly, agricultureSource, avoidanceZone, knownGPSJammingZone, authorizedZone, unauthorizedZone, vendor, inventory, customerSite` - "Reporting location type ... (used for ELD reporting purposes)". Multi-valued. | A3, A8 | `components.schemas.Address` |
| **Document** | Driver-submitted evidence bound to `documentType`, `driver`, `vehicle`, `route`, `routeStop`; typed `fields[]`; `state in {required, submitted, archived}`. | A6 | `components.schemas.documentResponseObjectResponseBody` |
| **Document state** | "`Required` documents are pre-populated documents for the Driver to fill out in the Driver App and have not yet been submitted. `Submitted` documents have been submitted by the driver in the Driver App. `Archived` documents have been archived by the admin in the cloud dashboard." | A6 | `components.schemas.V1DocumentBase.state` |
| **Field value type** | `ValueType_String, ValueType_Number, ValueType_MultipleChoice, ValueType_Photo, ValueType_Barcode, ValueType_DateTime, ValueType_Signature` - a signature value is `{name, signedAtMs, url, uuid}`; a barcode is `{barcodeType (e.g. "org.gs1.EAN-13"), barcodeValue}`. | A6 | `components.schemas.V1DocumentFields` |
| **Form submission** | The newer, richer evidence object: `formTemplate`, `fields[]`, `status`, `submittedBy` (polymorphic user), `assignedTo`, `assignedAtTime`, `dueAtTime`, `durationMs`, `score`, `geofence`, `location`, `routeId`, `routeStopId`, `approvalDetails`, `externalIds`. | A6 | `components.schemas.FormSubmissionResponseObjectResponseBody` |
| **Form submission status** | `notStarted, completed, archived, inProgress, needsReview, changesRequested, approved`. | A6 | same |
| **durationMs** | "Duration between when the form submission was started on the client and submitted ... Omitted until the form is actually submitted or when the client start timestamp was not recorded." | A6 | same |
| **DVIR** | `inspectionType in {preTrip, postTrip, mechanic, unset}`, `relatedDevices[]` (vehicles/trailers), built on a base form submission; up to three signatures. | A6 | `components.schemas.Dvir2SubmissionResponseObjectResponseBody`, `DvirSignature`/`DvirSecondSignature`/`DvirThirdSignature` |
| **hosStatusType** | `offDuty, sleeperBed, driving, onDuty, yardMove, personalConveyance`. | A13 | `components.schemas.HosLogEntry`, `CurrentDutyStatus` |
| **eldEventRecordOrigin** | "whether it is automatically recorded, or edited, entered or accepted by the driver, requested by another authenticated user, or assumed from unidentified driver profile" (values 1-4, per 49 CFR 395 App. A s7.22). | A4, A6 | `components.schemas.HosEldEventObjectResponseBody` |
| **eldEventRecordStatus** | "whether an event is active or inactive and further, if inactive, whether it is due to a change or lack of confirmation by the driver or due to a driver's rejection of change request" (values 1-4, s7.23). | A4, A6 | same |
| **assignmentType** | How a driver-vehicle assignment was asserted: `invalid, unknown, HOS, idCard, static, faceId, tachograph, safetyManual, RFID, trailer, external, qrCode, driverApp, voiceSignIn, smartAssign`. | A3, A8 | `components.schemas.DriverVehicleAssignmentV2ObjectResponseBody` |
| **Carrier Proposed Assignment** | An assignment *offered* to a driver, with `firstSeenTime`, `acceptedTime`, `rejectedTime`, `activeTime`, `shippingDocs`, `vehicle`, `trailers`. | A1, A8 | `components.schemas.CarrierProposedAssignment*` |
| **externalIds** | "The [external IDs] for the given object" - a customer-specified key->value map, org-scoped, addressable in a path as `key:value` (e.g. `payrollId:ABFS18600`). | A9 | `components.schemas.Address.externalIds`; `components.parameters.V1DispatchRouteIdOrExternalIdParam` |
| **Live Sharing Link** | `type in {assetsLocation, assetsNearLocation, assetsOnRoute}`, with `expiresAtTime` and a public `liveSharingUrl`. | A4, A9 | `components.schemas.LiveSharingLinkFullResponseObjectResponseBody` |
| **Hub / Plan / Route template** | `[beta]` planning layer: a hub has `locations`, `capacities`, `skills`, `customProperties`; plans contain routes; route templates have depot start/end. | A3 | `paths./hubs`, `/hub/plans`, `/hub/route-templates`, `/hub/capacities`, `/hub/skills` |

## Lifecycles & events

### Route stop state machine

`unassigned -> scheduled -> "en route" -> arrived -> departed`, with `skipped` as
a terminal branch. Both the read model (`RouteStopWithOrdersResponseObjectResponseBody.state`)
and the audit feed (`MinimalRouteStopAuditLogsResponseBody.state`) use the same six
values. Each transition has a matching timestamp field on the stop -
`enRouteTime`, `actualArrivalTime`, `actualDepartureTime`, `skippedTime` - so the
state is derivable from the timestamps and vice versa.

Note there is **no "servicing" state**. Samsara's stop is arrived-or-departed;
whether the crew is working is not modelled. Roadnet's `StopServicing` has no
counterpart here. For HHG, where "arrived at origin" and "started packing" are
hours apart, this is a material omission (see Traps).

### Route event stream - `eventType`, 8 values

`GET /route-events/stream`, `components.schemas.RouteEventResponseResponseBody`:

`stopArrived`, `stopCompleted`, `stopEnRoute`, `stopSkipped`,
`stopTaskCompleted`, `stopTaskSkipped`, `stopEtaUpdated`, `unspecified`.

Every event carries `id`, `eventType`, **`happenedAtTime`** ("Time the event
happened") and **`eventTime`** ("Time the event was processed"), plus normalised
`route` and `stop` references that each carry their own `externalIds`. Type-specific
detail lives in `eventDetails`, a union keyed by event type:
- `stopEtaUpdated` -> `{etaMs, etaUpdatedAtMs}` - the ETA **and when it was
  recalculated**, as two separate values.
- `stopTaskCompleted` / `stopTaskSkipped` -> `{taskId, taskType in {form, document}}`.

`unspecified` as an explicit enum member is a forward-compatibility contract: new
event kinds arrive as `unspecified` rather than breaking a consumer's enum.

### Route audit-log feed - `operation` (10 values) and `source` (3 values)

`GET /fleet/routes/audit-logs/feed`: "Subscribes to a feed of immutable,
append-only updates for routes. The initial request ... returns a cursor, which can
be used on the next request to fetch updated routes that have had state changes
since that request."

`components.schemas.RouteFeedObjectResponseBody`:
- `operation`: `stop scheduled`, `stop en route`, `stop skipped`, `stop arrived`,
  `stop departed`, `stop ETA updated`, **`stop arrival time updated`**,
  **`stop completion time updated`**, **`stop order changed`**,
  **`stop arrival prevented`**.
- `source`: `automatic | driver | admin` - "The source of this route update.
  Updates that are triggered by time or by the route being completed are
  'automatic'."
- `type`: `route tracking` (single-valued today, documented as extensible: "this
  will change in the future when additional types are added").
- `changes`: `{before, after}`, each a `MinimalRouteAuditLogs` carrying **only the
  fields that changed** - "Only the fields that have changed are present in the
  response. All other fields, including the route id, will not be present."

The four bolded operations are the interesting ones: `stop arrival time updated`
and `stop completion time updated` are **corrections to a previously asserted
fact**, delivered as their own operation with a before/after diff; `stop order
changed` is a resequence; `stop arrival prevented` is a refused transition. Samsara
separates "this happened" from "what we said happened was wrong" - which Roadnet
does not (it overloads `status: Change`).

### Webhook event catalog - 35 types

`components.schemas.WebhookResponseResponseBody.eventTypes`:

`AddressCreated`, `AddressDeleted`, `AddressUpdated`, `AlertIncident`,
`AlertObjectEvent`, `DocumentSubmitted`, `DriverCreated`, `DriverUpdated`,
`DvirSubmitted`, `EngineFaultOff`, `EngineFaultOn`, `FormSubmitted`, `FormUpdated`,
`GatewayUnplugged`, `GeofenceEntry`, `GeofenceExit`, `IssueCreated`,
`MissingDvirPastDue`, `PredictiveMaintenanceAlert`, `RouteStopArrival`,
`RouteStopDeparture`, `RouteStopEarlyLateArrival`, `RouteStopEtaUpdated`,
`RouteStopResequence`, `SevereSpeedingEnded`, `SevereSpeedingStarted`,
**`ShipmentTrackingEvent`**, `SpeedingEventEnded`, `SpeedingEventStarted`,
`SuddenFuelLevelDrop`, `SuddenFuelLevelRise`, `VehicleCreated`, `VehicleUpdated`,
`VisualSearchMatch`, `WorkOrderCreatedOrChanged`.

Structure of the catalog: entity CRUD (`*Created`/`*Updated`/`*Deleted`),
work-execution (`RouteStop*`), evidence submission (`DocumentSubmitted`,
`FormSubmitted`, `FormUpdated`, `DvirSubmitted`), geofence transitions, vehicle
health, safety intervals (paired `*Started`/`*Ended`), and one outward-facing
integration event, `ShipmentTrackingEvent`.

`ShipmentTrackingEvent` is the only occurrence of the word "shipment" anywhere in
the 4.4 MB spec, and it has **no schema, no path and no other reference**. It is
almost certainly the hook for third-party visibility platforms (project44 /
FourKites style). Given the user's explicit "shippers don't require visibility
platforms at the moment but I'd like to be ready", this single string is the most
important lead in the file - and we cannot read its payload from here. Flagged in
Open questions.

Webhooks are **versioned**: `WebhookResponseResponseBody.version in {2018-01-01,
2021-06-09}`, alongside `secretKey`, `url`, and `customHeaders` (max 5). Alert
webhooks additionally choose a payload shape: `payloadType in {legacy, enriched}`
(`components.schemas.WebhookParamsObjectRequestBody`).

### Alerts - a configurable derived-event layer, 68 triggers

`GET /alerts/incidents/stream` returns
`GetWorkflowIncidentResponseObjectResponseBody`:
`{configurationId, conditions[], happenedAtTime, updatedAtTime, isResolved,
resolvedAtTime, incidentUrl}`. An incident is an *interval with a resolution*, not
an instant, and it points back at the configuration that defined it. Each condition
carries `{triggerId, description, details}`.

`components.schemas.WorkflowIncidentDetailsObjectResponseBody` enumerates the 68
trigger kinds. The route/work-relevant subset:
`routeStopArrival`, `routeStopDeparture`, `routeStopETA`,
`routeStopEarlyLateArrival`, `routeStartDelayed`, `outOfRoute`,
`outOfSequenceStopArrival`, `geofenceEntry`, `geofenceExit`, `insideGeofence`,
`outsideGeofence`, `driverAppSignIn`, `driverAppSignOut`, `driverDocumentSubmitted`,
`formSubmitted`, `formUpdated`, `dvirSubmittedDevice`, `missingDvirPastDue`,
`issueCreated`, `hosDutyStatus`, `hosViolation`, `unassignedDriving`,
`vehicleTrailerMismatch`, `trailerMovingWithoutPower`, `driverMessageSent`,
`driverMessageReceived`, `inactivity`, `doorOpen`, `panicButton`,
`workerSafetySos`. The remainder are vehicle-health, camera and safety triggers.

Two exception payloads worth copying verbatim:
- `RouteStopEarlyLateArrivalDataResponseBody`: `{arrivalStatus in {early, late},
  deviationMinutes ("The absolute deviation in minutes from the scheduled arrival
  time. Always positive. Use arrivalStatus to determine if early or late."),
  driver, vehicle}`. Direction and magnitude, separately, with the sign convention
  documented.
- `OutOfRouteDetailsObjectResponseBody`: `{maxOffRouteMeters ("The minimum distance
  in meters a vehicle has to be from its active route path to be considered out of
  its route"), minDurationMilliseconds ("The number of milliseconds the trigger
  needs to stay active before alerting")}`. The **threshold that defined the
  exception travels with the exception**. That is unusual and very good: a consumer
  can tell whether a 15-minute "late" was late by the org's rules or by ours.

### HOS / duty status and ELD

- `hosStatusType in {offDuty, sleeperBed, driving, onDuty, yardMove,
  personalConveyance}` (`HosLogEntry`, `CurrentDutyStatus`). `CurrentDutyStatus`
  documents a failure mode explicitly: "If the driver app is disconnected, an empty
  string will be returned."
- ELD events (`/beta/fleet/hos/drivers/eld-events`,
  `HosEldEventObjectResponseBody`) are modelled directly on 49 CFR 395 Appendix A:
  `eldEventType` (s7.25), `eldEventCode` (s7.20), `eldEventRecordOrigin` (s7.22),
  `eldEventRecordStatus` (s7.23), `malfunctionDiagnosticCode` (s7.34, values
  `P,E,T,L,R,S,O,1..6`), plus `accumulatedVehicleMeters`, `elapsedEngineHours`,
  `totalVehicleMeters`, `totalEngineHours`, `location`, `remark`.
- `PATCH /hos/daily-logs/log-meta-data` - "Update the `shippingDocs` field of an
  existing assignment." The ELD shipping-document reference is the one place where
  a freight identifier is expected to appear in the compliance record.

### Where telemetry stops and business events begin

| Layer | Endpoint(s) | Shape |
| --- | --- | --- |
| Raw location | `/fleet/vehicles/locations` + `/history` + `/feed`, `/fleet/equipment/locations*`, `/assets/location-and-speed/stream`, `/v1/fleet/assets/{id}/locations` | snapshot / history / cursor feed - three access patterns for the same data |
| Raw engine & sensor | `/fleet/vehicles/stats` + `/history` + `/feed`, `/fleet/trailers/stats*`, `/v1/sensors/{temperature,humidity,door,cargo}`, `/readings/*` | same triple pattern |
| Derived movement | `/trips/stream`, `/v1/fleet/trips`, `/idling/events`, `/speeding-intervals/stream` | intervals, not instants |
| Vehicle health | `EngineFaultOn`/`EngineFaultOff` webhooks, `/v1/fleet/maintenance/list`, DVIR defects | paired start/end |
| Compliance | `/fleet/hos/{clocks,logs,daily-logs,violations}`, `/beta/fleet/hos/drivers/eld-events` | regulatory record |
| **Business events** | `/route-events/stream`, `/fleet/routes/audit-logs/feed`, `RouteStop*` webhooks | typed, sourced, diffed |
| **Evidence** | `/fleet/documents`, `/form-submissions`, `/dvirs`, `/cameras/media` | state machines with approval |
| Derived exceptions | `/alerts/incidents/stream` (68 triggers) | interval with resolution |

The boundary is drawn by *object*, not by endpoint family: telemetry objects
(`Trip`, vehicle stats, locations) reference an **asset or vehicle**; business
objects (`RouteStop`, `Document`, `FormSubmission`) reference a **route/stop and a
driver**. The bridge between them is the **driver-vehicle assignment** with its
`assignmentType`, which is the only thing that says "this vehicle's GPS is this
driver's work right now".

## Time, identity, evidence

### Time

The route stop carries **four distinct time families**, which is the cleanest
planned / estimated / actual separation in either telematics source:

| Family | Fields |
| --- | --- |
| Planned / promised | `scheduledArrivalTime`, `scheduledDepartureTime`, `appointmentWindows[]` (max 3), `plannedDistanceMeters` |
| Estimated (live) | `eta` ("if this stop is currently en-route"), plus `stopEtaUpdated` events carrying `etaMs` + `etaUpdatedAtMs` |
| Actual | `enRouteTime`, `actualArrivalTime`, `actualDepartureTime`, `skippedTime`, `actualDistanceMeters` |
| Tolerance | `ontimeWindowBeforeArrivalMs`, `ontimeWindowAfterArrivalMs` |

Note that **scheduled and appointment are separate**: the schedule is our plan, the
appointment window is the customer's promise, and a stop can hold up to three
appointment windows. HHG needs exactly this (a delivery spread is not a scheduled
arrival).

Route-level: `scheduledRouteStartTime` / `scheduledRouteEndTime` vs
`actualRouteStartTime` / `actualRouteEndTime`, with `RouteSettings` defining *which
stop event* constitutes the start and the end.

Event-level: `happenedAtTime` vs `eventTime` on every route event; `etaMs` vs
`etaUpdatedAtMs` on ETA updates; `happenedAtTime` vs `updatedAtTime` vs
`resolvedAtTime` on alert incidents; `createdAtTime` / `assignedAtTime` /
`dueAtTime` / `submittedAtTime` / `updatedAtTime` / `durationMs` on a form
submission; `signedAtMs` inside a signature value.

Zones: `orgLocalTimezone` / `orgLocalTimezone` on routes, with the IANA convention
spelled out and linked ("Timezones use IANA timezone database keys (e.g.
`America/Los_Angeles`)"). Timestamps are RFC 3339 throughout, with millisecond
precision and offsets supported - except that several older objects use
`...Ms` epoch-millisecond integers-as-strings (`etaMs`, `signedAtMs`,
`dateTimeMs`), so two time encodings coexist.

Feeds are **cursor-based, not time-range-based** (`after` = the previous
`endCursor`), which sidesteps the clock-skew problem Roadnet's `timeSource`
parameter has to solve.

### Identity & cross-reference

`externalIds` is the standout, and it is what Roadnet lacks:

- Present on `Route`, `RouteStop`, `Driver`, `Vehicle`, `Address`, `Order`,
  `FormSubmission`, and the normalised `route`/`stop` stubs inside route events.
- It is a **map**, not a single field: `{"maintenanceId": "250020", "payrollId":
  "ABFS18600"}` - "customer specified key-value pairs", org-scoped.
- It is **addressable**: `components.parameters.V1DispatchRouteIdOrExternalIdParam`
  - "To specify an external ID as part of a path parameter, use the following
  format: `key:value`. For example, `payrollId:ABFS18600`". You can `GET` a route
  by *your own* identifier without storing Samsara's.
- Because route events carry `externalIds` on their normalised route and stop
  stubs, an inbound event can be correlated to our shipment **without a lookup
  table**.

For tenants that are agents for **both Allied and Atlas**, this is the decisive
capability: `{"alliedRegistration": "...", "atlasOrder": "...", "pegasusShipment":
"..."}` can all live on the same route stop.

Other identity surfaces: `Contacts`, `Tags` (cross-cutting grouping, with
tag-level safety scoring), `Attributes` (typed key-values by entity type),
`customerProperties` on orders and order tasks, `hub/customProperties` `[beta]`.
Driver QR codes (`/drivers/qr-codes`) and `assignmentType: qrCode` give a physical
identity-assertion mechanism.

### Evidence, provenance and corrections

Samsara's provenance story is spread across four mechanisms, and taken together it
is at least as strong as Roadnet's:

1. **`source: automatic | driver | admin` on every route update**
   (`RouteFeedObjectResponseBody`). Directly comparable to Roadnet's
   `eventSource: MobileDevice | Dispatch | Unknown`, with the addition of an
   explicit `automatic` value for system-derived transitions ("Updates that are
   triggered by time or by the route being completed are 'automatic'"). Roadnet's
   `Unknown` is an absence; Samsara's `automatic` is an assertion.
2. **`assignmentType` - how the driver/vehicle binding was asserted.** Fifteen
   values (`HOS, idCard, static, faceId, tachograph, safetyManual, RFID, trailer,
   external, qrCode, driverApp, voiceSignIn, smartAssign, unknown, invalid`). The
   confidence you can place in "driver D was in vehicle V" differs enormously
   between `static` (someone typed it once) and `faceId`. Nothing in Roadnet does
   this.
3. **ELD record origin and status** (`HosEldEventObjectResponseBody`). The
   regulation's own four-way origin - automatically recorded / edited-entered-or-
   accepted by the driver / requested by another authenticated user / assumed from
   unidentified driver profile - plus the four-way status distinguishing *active*,
   *inactive pending driver confirmation*, and *inactive because the driver
   rejected the change request*. This is a complete propose/accept/reject
   correction protocol, and it is the most rigorous provenance model either
   telematics source contains. It is worth reading not as a compliance detail but
   as a **specification of how a corrected fact behaves**.
4. **Form approval loop.** `status` moves `notStarted -> inProgress -> completed ->
   needsReview -> changesRequested -> approved` (or `archived`), with
   `approvalDetails.comment` ("Comment from the approver when requesting changes or
   approving the submission") and `submittedBy` as a **polymorphic user** (driver
   or dashboard user). Evidence has a reviewer, a verdict and a reason.
5. **Before/after diffs.** `RouteChangesResponseBody` = `{before, after}` with only
   changed fields present. An append-only, immutable feed of *what changed*, not
   just *what is now*.
6. **Situated evidence.** A form submission records `location` and `geofence` at
   submission time; a signature records `{name, signedAtMs, url}`; a barcode
   records its symbology (`org.gs1.EAN-13`) alongside its value; a document records
   `driver`, `vehicle`, `route`, `routeStop`.
7. **Deletion tombstones.** `GET /preview/fleet/orders/deletions` returns
   `FleetOrderDeletionMarkerObjectResponseBody` = `{id, deletedAtTime}`, and
   `GET /places/deletions` `[beta]` does the same for places. A poller can learn
   that something *stopped existing*, which most APIs never tell you.

And one explicitly documented **failure** of correction propagation, which is worth
quoting because it is the kind of honesty we should demand of our own catalog
(`TripResponseBody`):

> `finalDistanceMeters` - "Only populated once the trip has completed ... **Later
> corrections (e.g. late-arriving GPS data) are not signaled by updatedAtTime.**"

while, in the same object, a different correction *is* propagated:

> `tripPurpose` - "When a driver changes the purpose after the trip completes, the
> trip is re-served through the `updatedAtTime` feed with the new value."

Two corrections to the same object, one observable and one not, documented as such.

## Scores

Weights are set in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 2 | 1 | 0 | 2 | 3 | 2 | 3 | Canonical orders exist but have **no state field at all** (`FleetOrderObjectResponseBody`, `FleetOrderTaskObjectResponseBody`) - C3=1 rests solely on `CarrierProposedAssignment` (`firstSeenTime`/`acceptedTime`/`rejectedTime`/`activeTime`), the only offer/accept/decline lifecycle in either telematics source, and it is about a driver assignment, not a customer order. C1=1: upsert / delete / stream / deletion-markers, no offer, award, book, estimate or cancel-with-reason. C5=2: `createdAtTime`/`updatedAtTime`/`deletedAtTime` + per-task `serviceWindows`. C6=3: `externalIds` map + `samsaraCustomerOrderName`. C7=2: tombstones + update timestamps, no actor. C8=3: `externalIds`, `customerProperties`, and the whole object is `[preview]` - a declared pre-GA channel. |
| A2 Shipment structure | 2 | 2 | 0 | 0 | 2 | 3 | 1 | 3 | C1=2: order -> tasks -> `quantities[]`, `serviceLocation`, `serviceWindows[]`, `serviceDurationSeconds`, `skills[]` (`OrderTaskSkillObjectResponseBody`, e.g. "Forklift Operation"), `positionConstraintType`. C2=2: `taskType in {unknown, delivery, pickup, pickupDelivery}` - note there is **no `transfer`**, so a linehaul (pick up here, deliver there) is two unrelated tasks with no stated invariant binding them; Roadnet is strictly better here. C3=0: tasks have no state. C4=0: no shipment types, no weights/cube vocabulary, no services-ordered catalog. C6=3: `externalIds` on the order. |
| A3 Trip, stop & assignment | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 3 | C2=3 for two definitions Roadnet lacks: (a) `RouteSettings` makes "when does a route start/end" **configurable and explicit** (`routeStartingCondition`, `routeCompletionCondition`, `sequencingMethod`); (b) `Trip` is an **asset** movement with `completionStatus` and no route link at all (`TripResponseBody`) - trip and route are never conflated. C1=3: route, stops (`minItems: 2`), driver, vehicle, trailer, hub/plan/route-template `[beta]`, `singleUseLocation` vs catalogued `address`, `Address.addressTypes[]` multi-valued. C3=3: six-state stop machine + 10-value `operation` vocabulary on the audit feed. C5=3: four time families (scheduled / appointment / eta / actual) + on-time tolerance windows + `plannedDistanceMeters` vs `actualDistanceMeters` + IANA `orgLocalTimezone`. C6=3: `externalIds` on route, stop, driver, vehicle. C7=3: `source: automatic\|driver\|admin` + 15-value `assignmentType`. C4=0: no agent roles, no van line, no crew. |
| A4 Execution events & tracking | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 3 | C1=3: four channels - 8 route-event types, 35 webhook types, 10 audit operations, 68 alert triggers - plus geofence entry/exit and the telemetry feeds. C2=3: `stopArrived` vs `stopCompleted` vs `stopEnRoute` vs `stopSkipped`; stop-level vs task-level completion (`stopTaskCompleted{taskId, taskType in {form, document}}`); `arrivalStatus in {early, late}` + `deviationMinutes` with the sign convention documented; `outOfSequenceStopArrival` as its own trigger. C3=3: state machine + operation vocabulary + `stop arrival prevented` as a refused transition. C5=3: `happenedAtTime` vs `eventTime` on every event; `etaMs` + `etaUpdatedAtMs`; cursor feeds instead of time-range queries; alert incidents as intervals with `resolvedAtTime`. C7=3: `source`, before/after diffs, `stop arrival time updated` / `stop completion time updated` as first-class corrections, and the exception threshold (`maxOffRouteMeters`, `minDurationMilliseconds`) shipped with the exception. C8=3: webhook `version in {2018-01-01, 2021-06-09}`, `payloadType in {legacy, enriched}`, `unspecified`/`unknown` enum members as forward-compat, `type: "route tracking"` documented as extensible. **Caveat: webhook payload shapes were not readable from this file.** |
| A5 Storage-in-transit | 0 | n/a | n/a | 0 | n/a | n/a | n/a | n/a | Absent. The nearest structures are `insideGeofence`/`outsideGeofence` dwell alerts and `Address.addressTypes` including `yard` and `inventory`, but nothing models goods held over time, an SIT-in/SIT-out pair, storage authority, a delivery-out leg, or a permanent-storage boundary. Scoring anything above 0 on C1 would be generous to the point of misleading. |
| A6 Documents & evidence | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 3 | The strongest area in either telematics source, and the one to lean on for A6. C1=3: `Document` + `DocumentType` catalog + PDF generation/export, `FormSubmission` + `FormTemplate` (with conditional field sections, tables, scoring, approval config), `DVIR` + `Defect` + `DefectType`, camera media. C2=3: the `Required`/`Submitted`/`Archived` definitions are quoted verbatim in Vocabulary and leave nothing ambiguous; `isRequired` on a stop form means "the driver must complete the form before departing the stop" (`RouteStopFormResponseObjectResponseBody`). C3=3: two state machines - document `required -> submitted -> archived` and form `notStarted/inProgress -> completed -> needsReview -> changesRequested -> approved/archived`. C5=3: created/assigned/due/submitted/updated + `durationMs` (client start to submit) + `signedAtMs`. C6=3: a document binds `documentType`, `driver`, `vehicle`, `route`, `routeStop`; form submissions add `externalIds`, `routeId`, `routeStopId`, `asset`, `geofence`. C7=3: `submittedBy` polymorphic, `approvalDetails.comment`, DVIR first/second/third signatures, submission `location` + `geofence`. C8=3: typed field metadata (`signatureValueTypeMetadata`, `multipleChoiceValueTypeMetadata`, `numberValueTypeMetadata`), tenant-authored templates, barcode symbology carried with the value. C4=0: no BOL, weight ticket, inventory, high-value inventory, or order for service. |
| A7 Charges & billing hooks | 1 | 1 | 1 | 0 | n/a | 2 | n/a | n/a | Freight billing is absent. What exists is maintenance and fuel finance: `Route.cost` (a bare double on the `[beta]` hub route object), `POST /fuel-purchase` ("Create a fuel purchase transaction"), `/maintenance/purchase-orders` `[beta]` with a status lifecycle, `/maintenance/invoice-scans`, `/maintenance/warranty-claims`, `/maintenance/parts/transactions`. C3=1 and C6=2 reflect the purchase-order/work-order surface only; none of it touches line-haul, accessorials, or a customer invoice. |
| A8 Parties & roles | 2 | 2 | 2 | 0 | n/a | 3 | 2 | 3 | C1/C2=2: `Driver`, `User` + `/user-roles`, `Contact`, maintenance `vendors` `[beta]`, `Tags` as cross-cutting grouping, `Address.contacts[]`, `addressTypes` including `vendor` and `customerSite`, coaching `driver-coach-assignments`. C3=2 rests on `CarrierProposedAssignment` (offer -> firstSeen -> accept/reject -> active) and on `/fleet/asset-sharing/agreements` `[beta]`, which is a genuine **inter-organisation** lifecycle (create / accept / reject / cancel a data-sharing agreement, then share assets under it) - the only place either source models a relationship *between two companies*. C4=0: no booking/origin/hauling/destination agent, no van line, no RMC, no warehouse role, no crew. C6=3: `externalIds` on drivers and vehicles. C8=3: `Attributes`, `Tags`, `customerProperties`, `user-roles`. |
| A9 Identity & cross-references | 3 | 3 | n/a | 0 | n/a | 3 | 1 | 3 | Best-in-class, and the specific thing to adopt. C1/C2/C6=3: `externalIds` as an org-scoped **key->value map** on every major object, documented on its own doc page, carried on the normalised route/stop stubs inside events, and **addressable in a path as `key:value`** (`components.parameters.V1DispatchRouteIdOrExternalIdParam`, "For example, `payrollId:ABFS18600`"). Plus `Tags`, `Attributes`, `Contacts`, driver QR codes, `hos/daily-logs` `shippingDocs`, and Live Sharing Links as externally-shareable identity-free references. C7=1: no actor on identifier changes. C8=3: unbounded, customer-defined namespace. C4=0: no HHG identifier vocabulary (registration no., SCAC, BOL/PRO, service order no.) - the *mechanism* is there, the *terms* are not. |

**S5 - fit to Pegasus data:** `unknown` for every area. This analysis did not read
pegII or Cloud (explicitly out of scope). As with Roadnet, S5 here really asks "can
pegII/Cloud publish orders into Samsara and consume its events", which is a phase-5
mapping question. One thing can be said without guessing: because `externalIds` is
a map addressable by our own key, **whatever identifiers pegII already has can be
pushed into Samsara without pegII changing**, which makes the correlation problem
strictly easier on this side than on Roadnet's.

## Strengths worth adopting

1. **`externalIds` as a namespaced, org-scoped, path-addressable identifier map** -
   on every object, and carried on the normalised references inside events. This is
   the answer to "our tenants are agents for both Allied and Atlas". Adopt the
   mechanism *and* the addressability: being able to fetch by `alliedReg:123456`
   without holding our id in their system removes an entire class of sync bug.
2. **`source: automatic | driver | admin` on every state change**, with `automatic`
   as an explicit value rather than an absence. Combine with Roadnet's
   `eventSource` to get `{driver-device, office/admin, system-derived, partner,
   unknown}`.
3. **`assignmentType` - provenance on a *binding*, not just on a fact.** Fifteen
   ways a driver-vehicle assignment can be asserted, ranked implicitly by
   trustworthiness. HHG has the same problem with crew-to-shipment and
   trailer-to-shipment bindings.
4. **Four separate time families on a stop: scheduled, appointment window, ETA,
   actual - plus an explicit on-time tolerance.** The scheduled/appointment split
   is exactly the HHG distinction between our plan and the customer's delivery
   spread, and `ontimeWindowBefore/AfterArrivalMs` makes "late" a *derived, policy-
   parameterised* judgement rather than a hard-coded one.
5. **`RouteSettings` makes "when does a route start and end" explicit data**
   (`departFirstStop` vs `arriveFirstStop`; `arriveLastStop` vs `departLastStop`),
   with the documented consequence that the unused timestamp "should not be set".
   Every system has this ambiguity; almost none declare it.
6. **Trip and route are separate objects with no link.** A `Trip` is an asset
   moving; a `Route` is planned work. Our model should keep vehicle movement out of
   the shipment aggregate entirely and bridge only through the assignment.
7. **Corrections as first-class operations.** `stop arrival time updated` and
   `stop completion time updated` are distinct from `stop arrived` and
   `stop departed`, and arrive with a before/after diff on an immutable
   append-only feed. Our catalog should have explicit correction events, not
   re-emitted originals.
8. **The exception carries the threshold that produced it**
   (`OutOfRouteDetailsObjectResponseBody`: `maxOffRouteMeters`,
   `minDurationMilliseconds`; `RouteStopEarlyLateArrival`: `arrivalStatus` +
   `deviationMinutes` with "Always positive" stated). A downstream consumer can
   re-evaluate the judgement instead of inheriting it.
9. **The document/form evidence model in full** - `required -> submitted ->
   archived` for documents; `notStarted -> inProgress -> completed -> needsReview ->
   changesRequested -> approved` with an approver comment for forms; typed field
   values including signature (`{name, signedAtMs, url}`) and barcode (with
   symbology); `isRequired` meaning "must be completed before departing the stop";
   `durationMs` from client start to submit; capture location and geofence recorded
   with the submission. This is the best A6 material we have from any telematics
   source and should be the starting point for HHG documents (inventory, BOL, high-
   value inventory, weight ticket, POD).
10. **ELD `recordOrigin` / `recordStatus` as a correction protocol.** Auto-recorded
    vs driver-entered vs requested-by-another-user vs assumed-from-unidentified, and
    active vs inactive-pending-confirmation vs inactive-driver-rejected. Read as a
    general pattern: a proposed correction to someone else's assertion is *pending*
    until they accept it, and a rejection is a recorded outcome, not a deletion.
11. **Deletion tombstones** (`/preview/fleet/orders/deletions`, `/places/deletions`)
    so a poller can learn that something ceased to exist.
12. **Forward-compatible enums.** `unspecified` / `unknown` as declared members, a
    single-valued `type: "route tracking"` documented as "this will change in the
    future when additional types are added", explicit `[beta]` / `[preview]` /
    `[legacy]` labels in operation summaries, and **versioned webhooks**. Our
    published catalog needs the same three devices: a catch-all member, declared
    maturity, and a version on the envelope.
13. **Cursor feeds over time-range queries.** `after` = previous `endCursor`,
    "immutable, append-only". Avoids the device-clock-vs-server-clock filtering
    problem entirely.
14. **Live Sharing Links** (`assetsLocation | assetsNearLocation | assetsOnRoute`,
    with `expiresAtTime`) and per-stop `liveSharingUrl`. Directly relevant to the
    user's "ready for visibility later" requirement: a shareable, expiring,
    identity-free tracking reference is a modellable concept, not just a UI feature.

## Weaknesses / traps

1. **The order has no state.** `FleetOrderObjectResponseBody` and
   `FleetOrderTaskObjectResponseBody` have `createdAtTime`/`updatedAtTime` and
   nothing else. All execution state lives on `RouteStop`. Copy this and "where is
   shipment 12345" becomes unanswerable when the shipment is between routes -
   awaiting dispatch, in SIT, or re-planned. HHG shipments spend most of their life
   *not on a route*.
2. **No `transfer` task type.** `delivery | pickup | pickupDelivery` covers
   first/final-mile only. A linehaul move is two tasks with no declared relationship
   and no quantity-equality invariant. Roadnet's `Transfer` is the better prior art;
   do not inherit Samsara's gap here.
3. **No "servicing" state.** A stop is `arrived` or `departed`. For HHG, arrival at
   origin and start-of-pack can be hours apart, and the dwell between them is the
   billable event. We need at minimum `arrived -> work started -> work completed ->
   departed`.
4. **`"en route"` contains a space**, and epoch-millisecond strings (`etaMs`,
   `signedAtMs`, `dateTimeMs`) coexist with RFC 3339. Cosmetic for them, a warning
   for us: fix the lexical conventions of our vocabulary before publishing, because
   they are permanent.
5. **The order object is `[preview]`, the planning layer is `[beta]`.** The parts
   of Samsara that most resemble a domain model are the least stable parts of the
   API. Do not build a mapping that assumes `/preview/fleet/orders` is durable, and
   do not treat preview shapes as evidence of a settled vendor model.
6. **Documented correction blindness.** `finalDistanceMeters` - "Later corrections
   (e.g. late-arriving GPS data) **are not signaled by `updatedAtTime`**." A
   consumer polling by `updatedAtTime` will hold a stale distance forever with no
   indication. The lesson is not "Samsara is sloppy" (they documented it) but that
   **every value in our catalog needs a stated answer to "how would I learn this
   changed?"**.
7. **Alerts are org configuration, not domain truth.** 68 triggers, all
   parameterised by thresholds someone set in a dashboard. A `routeStopEarlyLate`
   incident says "this org considers this late", not "this is late". Never promote
   an alert incident straight into our catalog as a domain event.
8. **Webhook payloads are not in the spec** - only the 35 names. Any plan that
   depends on webhook content is unverified until
   `developers.samsara.com/docs/webhook-reference` is read.
9. **`ShipmentTrackingEvent` is a name with nothing behind it** in this file. It is
   the most tantalising string in the spec for our future-visibility requirement and
   we know nothing about it. Do not design around it yet.
10. **Four overlapping asset kinds** - `Vehicle`, `Trailer`, `Equipment`, `Asset`
    (plus `Industrial asset`, a fifth and unrelated one) - with separate endpoints,
    separate stats feeds, separate assignment objects (`driver-vehicle-assignments`,
    `driver-trailer-assignments`, `trailer assignments`, `asset assignments`
    `[beta]`). Historical accretion, not a designed taxonomy. HHG needs tractor,
    trailer, straight truck, shuttle and container to be one typed concept.
11. **No SIT, no storage, no warehouse-as-holder** - same trap as Roadnet, and here
    there is not even a depot-reload analogue.
12. **No commercial lifecycle, no agent network, no charges.** Same silence as
    Roadnet on A1/A7/A8. Two vendor APIs agreeing that an area is empty is not
    evidence the area is simple; it is evidence that both sit downstream of it.
13. **Scale is not depth.** 5,477 schemas, but roughly 5,400 of them are
    per-operation error envelopes and wrappers. C1 credit is earned by the ~45
    domain objects, not by the file size.

## Out-of-v1 material

**A13 - Crew, driver & settlement** (rich):
- Coaching: `/coaching/sessions/stream`, `/coaching/driver-coach-assignments`.
- Safety scoring: `/safety-scores/{drivers,vehicles,tags,tag-group}`,
  `/v1/fleet/drivers/{id}/safety/score`, and `/safety-events` +
  `PATCH /safety-events/batch` (safety events can be *reviewed and corrected*).
- Training: `/training-assignments` (create/update/delete/stream),
  `/training-courses`.
- Qualifications `[beta]`: `/qualification-records` + `/qualification-types`, with
  archive/unarchive - licence and certification tracking.
- Driver efficiency: `/beta/fleet/drivers/efficiency`, `/driver-efficiency/*`
  (legacy), `/fleet/reports/drivers/fuel-energy`.
- HOS everything (see Lifecycles), `payrollId` as the canonical `externalIds`
  example, driver QR codes, `/fleet/drivers/remote-sign-out`.
- Tachograph (EU) driver activity and file history.

**A11 - Claims & valuation:** nothing for **cargo** claims. `/maintenance/warranty-
claims` and `/maintenance/warranties` are vehicle-warranty objects and must not be
mistaken for cargo-loss-and-damage. Record the absence.

**A12 - Rating & tariffs:** nothing. IFTA (`/fleet/reports/ifta/{jurisdiction,
vehicle}`, `/ifta-detail/csv`) is fuel-tax apportionment, not freight rating -
though `JurisdictionDistance`-style mileage-by-state is a shared input with
mileage-based tariffs, and both this source and Roadnet have it.

**A10 - Survey, estimating & inventory:** nothing. `Address.addressTypes` includes
`inventory`, and `/maintenance/parts/inventory-location` exists, but both are parts
inventory.

**Beyond the rubric, worth keeping:**
- **Asset-sharing agreements** `[beta]` (`/fleet/asset-sharing/agreements`, with
  create / accept / reject / cancel and per-asset share/cancel batches). An
  inter-company data-sharing consent lifecycle - direct prior art for agent-to-agent
  or agent-to-van-line visibility sharing, which is exactly the future requirement
  the user flagged.
- **Live Sharing Links** with expiry - shareable tracking without granting API
  access.
- **Issues** (`/issues`, `IssueCreated` webhook, issues attached to a route stop,
  `FormsIssueCreatedByFieldObjectResponseBody` - an issue *raised by a form field
  answer*). A generic exception/ticket object bound to work, which HHG needs for
  claims intake and service failures.
- **Functions** `[beta]` (`/functions`, `/functions-storage`) - Samsara ships an
  in-platform serverless runtime, a close analogue of our own workflow SDK. Worth a
  look when we design the partner-extension story, not for the domain model.

## Open questions

1. **What does `ShipmentTrackingEvent` carry, and what produces it?** The only
   "shipment" in the spec, with no schema, path or reference. If it is the
   visibility-platform hook (project44 / FourKites / Trucker Tools), it is the
   single most relevant object in this source to the user's stated future
   requirement. Needs `developers.samsara.com/docs/webhook-reference`. - web fetch,
   or Samsara.
2. **What are the 35 webhook payload shapes?** Same doc. Determines whether
   webhooks can replace polling the route-events stream, and whether webhook
   payloads carry `externalIds` (the stream's do).
3. **Do the tenants use canonical Orders (`[preview]`) at all, or only Routes with
   ad-hoc stops?** This decides whether we map a Pegasus shipment to a Samsara order
   or only to a stop. Preview status means it may not be enabled on their org. -
   user / tenant.
4. **Are `externalIds` already in use on the tenants' Samsara objects, and under
   what keys?** If a key namespace already exists, we must not collide with it; if
   not, we get to define the convention. - tenant data.
5. **Which tenant runs Samsara and which runs Omnitracs - or do both run both?**
   The brief says "tenants run OMNITRACS and SAMSARA". If a single tenant runs both,
   the correlation model has to span them, and only Samsara has a usable external-id
   map. - user.
6. **Is Samsara's `Trip` usable as evidence for line-haul segments**, given it has
   no route link? Answering needs an empirical check of whether trip start/end
   locations line up with route stops. - empirical.
7. **Does the tenant's Samsara org have Forms (newer) or only Documents (older)?**
   The two evidence models coexist and differ substantially (only Forms has the
   approval loop and `externalIds`). - tenant config.
8. **S5 for every area is unknown** pending a pegII/Cloud read.
9. **Which alert configurations exist in the tenants' orgs, and with what
   thresholds?** Needed before any alert-derived signal is trusted; the thresholds
   are org data, not spec data. - tenant config.
