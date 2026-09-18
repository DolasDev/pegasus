---
source: src:omnitracs-roadnet
analyzed: 2026-09-17
evidence_grade: A
material: >
  sources/omnitracs-roadnet/local/roadnet-swagger.yaml (OpenAPI 3.0, 66,975 lines,
  90 paths, 558 component schemas). Read: info.description integration guidelines,
  all 49 tag descriptions, the x-tagGroups grouping, the complete
  /events/{subscriber} operation, and ~60 component schemas covering the event,
  order, route, stop, actual, worker-log, position, form and identity models (line
  numbers cited per claim). NOT read: the remaining ~500 schemas (mostly admin CRUD
  envelopes - *Container / *Request / *Response wrappers - and reference data such
  as ServicePattern, Territory, CellSet); no public web page was fetched.
---

# Omnitracs Roadnet (Omnitracs One / "Omnitracs REST Web Services") - analysis

## What it is

The public OpenAPI 3.0 contract for **Omnitracs REST Web Services** - the
integration API of Omnitracs One (the platform formerly sold as Roadnet Anywhere,
now Solera). It is a **vendor-api** (S1) for a routing-and-dispatch plus
telematics platform: plan routes from orders, dispatch them to drivers on a
mobile device, and read back what actually happened. Adoption **S2 = 2** - a
long-established North American routing/ELD product with a real installed base in
distribution and household-goods fleets (one of our own tenants runs it), but not
an industry-wide standard anyone else must implement. Openness **S3 = public**
(the swagger is served unauthenticated at
`https://apex-prod-integration.aws.roadnet.com/integration/api-docs/swagger.yaml`;
the API itself requires a customer login).

Our reading covered the parts that matter for a domain model: the whole event
subsystem, the Daily Plan (orders / routes / stops) object graph, the parallel
"Actual" object graph, the reports (route actuals, equipment positions, equipment
status, form responses, worker HOS logs, unassigned vehicle activity), and the
identity/versioning conventions. We did **not** read the ~500 remaining schemas,
which are overwhelmingly request/response envelopes and admin reference data
(service patterns, territories, cell sets, package/product types); spot checks
showed nothing domain-bearing hiding there. We did not open the rendered HTML docs
site or any Roadnet Anywhere desktop documentation.

**Delivery model note:** Roadnet has **no webhooks**. Events are retrieved by
polling `GET /events/{subscriber}` for a pre-registered *Event Subscriber*
(`tags[Events]`; `paths./events/{subscriber}`) - a pull-based batch feed with
`beginDate` / `endDate` / `timeSource` / `region` / `pageIndex` / `pageSize`, and
the tag text warns that events "occur very frequently".

## Model summary

Roadnet's object graph, in its own words:

```
Region  - owns/shares -  Location, Worker, Equipment, Device, Route
  |                        Location.locationType in {Service, Depot, Restricted,
  |                                                  Layover, Fuel, Maintenance, Landmark}
Session (Daily / Rolling / Planning "Strategic")
  |
  +-- Order ---- tasks[] : WorkerTask {taskType in Pickup|Delivery}
  |     |                   -> locationIdentity, quantities[3], lineItems[] -> SKU
  |     +-- orderClassIdentity  (determines service times + service windows)
  |
  +-- RoutePlan  "A Route represents a set of planned work to be assigned to a driver."
        +-- workersInfo[]   (driver + helper)
        +-- equipmentInfo[] (tractor, trailer; equipment can be associated to equipment)
        +-- stops[] : Stop  - one of nine stop types, each with its own *Info body
                ServiceableStop -> orders[]   (many Orders collapse onto one Stop)
                                -> tripNumber (a Route may contain several trips)

  ... and in parallel, the execution record:

RouteActual -- stopActuals[] : StopActual -- orderActuals[] : OrderActual
                                             +-- tasks[] : WorkerTaskActual
                                                   quantities : OSDQuantities
```

Two structural ideas dominate and are worth stealing:

1. **A parallel plan/actual type hierarchy.** Every planning type has an `*Actual`
   twin with the same shape plus data-sourced execution values:
   `Order`/`OrderActual`, `RoutePlan`/`RouteActual`, `Stop`/`StopActual`,
   `ServiceableStop`/`ServiceableStopActual`, `WorkerTask`/`WorkerTaskActual`,
   `LineItem`/`LineItemActual`, `RouteTimestamps`/`RouteActualTimestamps`. The
   actual side then *also* carries the planned values (`StopActualPlannedData`
   adds `plannedArrivalTimestamp`, `plannedDepartureTimestamp`,
   `plannedDistanceTo`, `plannedTravelDurationTo` on top of `StopActualData`;
   `RouteActual` carries both `totals`/`plannedTotals` and
   `timestamps`/`plannedTimestamps`). Plan-vs-actual is not a flag, it is a type.
   (L58581, L60936, L61058, L61085, L58163)

2. **A typed stop union.** `Stop` is a discriminated union
   (`x-omni-valid.TypeDiscriminator: [stopType]`, `TypeInfo: [originDepotStopInfo,
   destinationDepotStopInfo, midrouteDepotStopInfo, serviceableStopInfo,
   breakStopInfo, layoverStopInfo, maintenanceStopInfo]`, L58660). Only
   `ServiceableStop` carries orders; the rest are non-serviceable stops with their
   own meaning. The *Actual* union adds two kinds that only ever exist as
   execution facts and can never be planned: `UnknownStop` ("created by the system
   and is not associated with any known stop") and `DiversionStop` ("a
   non-serviceable stop that is used to indicate a change to a planned route")
   (L58581, L60993).

**Order vs Route vs Trip.** An `Order` is *demand* (work to do at a location); a
`RoutePlan` is *supply* ("a set of planned work to be assigned to a driver"); the
two meet at a `ServiceableStop`. `Order.tasks` documents the shipment shape
explicitly (L57435):

> - **Pickup Order** (First/Final Mile pickups from the service location back to
>   the depot) - Contains a single task of TaskType Pickup.
> - **Delivery Order** ... - Contains a single task of TaskType Delivery
> - **Delivery & Pickup** (...simultaneous delivery and pickup at the same service
>   location) - Contains two Tasks ... Both tasks reference the same LocationIdentity.
> - **Transfer** (Over-the-Road Loads, and special cases within First/Final Mile)
>   - Contains two Tasks, the first a Pickup and the second a Delivery.
>   **Quantities (and Line items if relevant) must be identical between the two
>   tasks.**

That last invariant is the closest thing in either telematics source to "a
shipment is one thing that moves from A to B", and it is stated as a constraint,
not a comment. A *third* level exists below Route: `ServiceableStop.tripNumber`
and `MidrouteDepotStop.tripNumber` (L58857, L59672) - with
`MidrouteDepotStop.loadAction in {AsNeeded, Empty, Full, None}` a single Route
decomposes into several **trips** separated by reloads at a depot.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Order** | Demand at a Location; must name an `orderClassIdentity`, which "determines the Service Times and service Windows". Carries `beginDate`/`endDate` = "the allowable range for service of this Order". | A1, A2 | `tags[Orders]`; schema `Order` L57435 |
| **Order Class** | Grouping of "several factors that affect an order's delivery, such as the service times and service windows, as well as the type of equipment that can be used" (e.g. `DEL`, `MER`). | A1, A2 | `tags[Order Class]` |
| **WorkerTask** | "Represents one step of work that needs to be completed to fulfill the Order." `taskType in {Pickup, Delivery}`. | A2 | `WorkerTask` L58016 |
| **Transfer** (order shape) | Two tasks, Pickup then Delivery, quantities and line items **must be identical**. Used for "Over-the-Road Loads". | A2 | `Order.tasks` description L57435 |
| **Quantities** | A fixed array of exactly 3 numbers (`minItems: 3, maxItems: 3`) - the three configurable "sizes" (size1/size2/size3) a region measures capacity in. | A2 | `Quantities` L61688; `CommonAttributes.considerSize1..3` |
| **Route** | "A Route represents a set of planned work to be assigned to a driver." | A3 | `RoutePlan` L58225 |
| **Route Actual** | "A Route Actual represents the results of a set work, that was assigned to a driver." | A3, A4 | `RouteActual` L58163 |
| **Stop** | Typed union of nine stop kinds; only `ServiceableStop` has orders. | A3 | `Stop` L58660, `StopType` L61417 |
| **Serviceable Stop** | "A service point in the Route." Aggregates `orders[]`, carries `runningQuantityAfter`, `missedTimeWindowDuration(Type)`, `tripNumber`. | A3 | `ServiceableStop` L58857 |
| **Midroute Depot Stop** | "A stop at a depot on a route that is commonly used for reloading." Has `loadAction`. | A3, A5 | `Stop.midrouteDepotStopInfo` L58660; `MidrouteDepotStop` L59672 |
| **Diversion Stop** | "A non-serviceable stop that is used to indicate a change to a planned route." Actual-only. | A3, A4 | `StopActual.diversionStopInfo` L58581 |
| **Unknown Stop** | "A Stop on a Route that was created by the system and is not associated with any known stop." Actual-only. | A4 | `StopActual.unknownStopInfo` L58581 |
| **tripNumber** | Integer on serviceable and midroute-depot stops; segments a Route into trips around reloads. | A3 | `ServiceableStop.tripNumber` L58857 |
| **Session** | Daily / Rolling / Planning("Strategic") container all plan objects hang off (`SessionBasedObject`). | A3 | `x-tagGroups`; `SessionBasedObject` |
| **Region** | "Each organization or area for which you create routes ... you set up separate regions for each depot." Owns or shares resources; is the unit of event filtering. | A3, A8 | `tags[Region]`, `tags[Events]` |
| **Worker** | "employees who are tracked through Omnitracs One, such as drivers, technicians, dispatchers, salespeople, and helpers." Typed by `WorkerType`. | A8 | `tags[Workers]`, `tags[Worker Type]` |
| **Equipment** | Individual physical units (tractors, trailers, bay trucks, hand trucks); equipment can be associated with other equipment and with a worker, so both auto-assign to a route. | A3, A8 | `tags[Equipment]`, `tags[Equipment Type]` |
| **Device** | `deviceType in {mobile, telematics}` - a phone/tablet or an in-vehicle telematics unit, associated to Equipment. | A3, A4 | `Device` L56924 |
| **Carrier** | "An operating authority identified by a DOT number. A single company may have multiple carriers under its structure." | A8 | `Carrier` L62663 |
| **Account** | "an optional way of grouping locations together that are for the same client, buyer, or purchaser." | A8 | `tags[Accounts]` |
| **Location** | Customers, vendors, depots, yards. `locationType in {Service, Depot, Restricted, Layover, Fuel, Maintenance, Landmark}`; has `coordinate`, `geocodeAccuracy`, `timeZone`, `yard` flag. | A3, A8 | `Location` L55652 |
| **Identity** | `{entityKey (system-assigned), identifier (customer-facing label), description}` - the universal reference shape. | A9 | `Identity` L54531 |
| **Event Subscriber** | Named consumer registered in the desktop client; `GET /events/{subscriber}` returns that subscriber's batch. | A4 | `tags[Events]`; `paths./events/{subscriber}` |
| **eventSource** | On stop events: `MobileDevice \| Dispatch \| Unknown` - *who asserted this*. | A4, A6 | `StopEventInfo.eventSource` L60381 |
| **DataSource** | On actual timestamps/distances: `NotSet, Projected, AssumedFromProjection, DispatcherEntered, AutoCaptured, GeoComputed, Computed, OdometerComputed, IgnitionComputed`. | A4 | `DataSource` L61544 |
| **OSDQuantities** | Actual quantities paired with a `ReasonCode`; OSD = **O**ver / **S**hort / **D**amaged. | A4, A6 | `OSDQuantities` L60570 |
| **ReasonCode** | `{type in Delivery\|Pickup\|Over\|Short\|Damaged, identity, description}` - the *type* is fixed, the code list is tenant data. | A4 | `ReasonCode` L60581 |
| **unserviceable** | "whether a stop has been marked as 'unserviced' through the use of the 'undeliver' function on the mobile device. This value is only relevant for stops of type ServicableStop." | A4 | `StopEventInfo.unserviceable` L60381 |
| **Workflow Extension** | Driver-app custom properties at four nesting levels: Route = level 1, Stop = level 2, Order = level 3, LineItem = level 4. | extensibility | `RoutePlan` L58225, `Stop` L58660, `Order` L57435, `LineItem` L58125 |
| **Custom Property** | Tenant-defined key/values on nearly every entity, but must be pre-declared in the desktop client under Administration / Custom Properties or they cannot be posted or retrieved. | extensibility | repeated description, e.g. `Order.customProperties` L57435 |

## Lifecycles & events

### Event vocabulary - `Event.eventType`, 18 values (L60047)

`StopArrived`, `StopDeparted`, `StopServicing`, `StopCancelled`,
`StopSequenceChanged`, `StopDeliveryDetailsChanged`, `RouteStatusChanged`,
`RouteStarted`, `RouteDeparted`, `RouteArrived`, `RouteCompleted`, `RouteChanged`,
`WorkerStatusChanged`, `CriticalEvent`, `IgnitionStatusChanged`, `FaultCode`,
`DriveTask`, `SendOrders`.

Each `Event` carries exactly one populated body, selected by
`EventInfo.eventInfoType in {Route, Stop, Worker, Equipment, FaultCode, Task}`
("Only the Info corresponding to the event type will be populated", L60096).

Note the shape of the arrival/departure pair: there are **separate route-level and
stop-level** arrive/depart events. `RouteStarted` / `RouteDeparted` /
`RouteArrived` / `RouteCompleted` describe the driver's day (start of shift,
departure from origin depot, arrival at destination depot, end); `StopArrived` /
`StopServicing` / `StopDeparted` describe a single stop. The three-state stop
sequence (arrived -> servicing -> departed) separates *being at the location* from
*working*, which is exactly the distinction an HHG pack/load day needs.

### Route status vs route state - two orthogonal enums

`StatusType` (L60136), the **planning/dispatch lifecycle** of a route:
`PlanningActive, PlanningBuilt, DispatchPending, DispatchInProgress, Arrived,
Completed, Schedule, Plan, Dispatch, Archive, Strategic`. The
`tags[Daily Plan Overview]` text gives the entry rule: "By default Routes are
created in Dispatch status so they are ready to be executed. To override this
behavior, use the query parameter `setStatusToRouting=true` and the Routes will be
available in the Routing application. Note, when retrieving these Routes their
status field will be marked as either **DispatchPending** or **PlanningActive**."

`RouteStateType` (L60151), the **live execution state**, 17 values:
`Pending, Started, Traveling, WaitingAtStop, ServicingStop, AtNonServiceableStop,
AtMidRouteDepotStop, Arrived, Completed, Delayed, PreStartDelay, PostStartDelay,
AtUnknownStop, AtRestrictedStop, AtLayoverStop, Suspended, AtMaintenanceStop`.

Keeping these apart is a genuinely good idea: *where the plan is in its
authoring/dispatch workflow* is not *what the truck is doing right now*.

### Stop status - `StopEventInfo.status` (L60381)

`Servicing, Cancelled, Serviced, Add, Delete, Change`. The last three are not
states of a stop at all - they are **mutations of the plan** riding the same
channel, which is a modelling smell worth not copying (see Traps). Alongside it
sit `unserviceable` (driver "undeliver") and `statusReasonCodeIdentity`.

### Order state - `OrderActual.orderState` (L61104)

"field to provide detail about the last state of the orders included in the
Serviceable Stops of the completed routes": `Assigned, Cancelled, Dispatched,
Inactive, PartiallyAssigned, PartiallyCancelled, PartiallyDispatched,
PartiallyInactive, PartiallyRouted, PartiallyServiced, Routed, Serviced,
Unassigned, Unrouted, Unserviceable`.

The `Partially*` half of the enum is the tell that an Order is a *set* of tasks
that can be in different states - Roadnet handles a multi-task order by rolling up
to a `Partially...` value rather than by giving each task its own state. Useful
prior art, and a known weakness (see Traps).

### Reason codes

- **OSD**: `ReasonCode.type in {Delivery, Pickup, Over, Short, Damaged}` with a
  tenant-defined `identity`/`description` per code (example `"DEL"`). Attached to
  actual quantities via `OSDQuantities` on `WorkerTaskActual.quantities` and
  `ServiceableStopActual.quantities` (L61190, L60936). So an over/short/damage
  reason is recorded **per task and per stop against a quantity delta**, not as a
  free-floating exception event.
- **Stop status reason**: `StopEventInfo.statusReasonCodeIdentity` - a reason code
  for the status itself (e.g. why cancelled / undelivered).
- **Not-routed reasons**: `NotRoutedOrderReasons`, 43 values
  (`CouldNotBeDetermined, MaxTime, StartTime, RouteMinimums, MaxQuantity, Template,
  ReloadAsLastStop, MaxStops, MaxReloads, RequiredOrigin,
  LocationEquipmentTypeRestrictions, CellBoundaries, PreferredRouteId, ...,
  LocationNotGeocoded, LocationDeleted, MaxTravelTime, CompartmentCapacity,
  NoMatchingCompartment, LocationWorkerRestriction, ReloadDepotSkuRestrictions,
  DepotSkuMinimums`). `NotRoutedOrderResults` gives **two** reasons per order -
  `reasonNotOnNearbyRoute` and `reasonNotOnNewRoute` - plus
  `orderType in {None, Delivery, Pickup, DeliveryAndPickup, Transfer}`. A planning
  *refusal* is a first-class, explained outcome, not a silent no-op.
- **Time-window miss**: `ServiceableStop.missedTimeWindowDurationType in
  {None, ServiceWindowEarly, ServiceWindowLate, OpenCloseEarly, OpenCloseLate}`
  with `missedTimeWindowDuration` (L58857) - an exception typed by *which* window
  was missed and in which direction.

### Duty status / HOS

Three related but deliberately different vocabularies:

- `WorkerLogEventsDetailInfo.activity in {OffDuty, OnDuty, Driving, SleeperBerth,
  Unknown, Login, Logout}` (L62307) - log-entry activity; includes app
  login/logout as duty-log events.
- `LastKnownDutyStatus in {OnDuty, OffDuty, Driving, SleeperBerth, Unknown}`
  (L61557) - current-state snapshot.
- `WorkerEventInfo.loginStatus in {LoggedIn, LoggedOut}` (L60622), plus
  `workerViolationInfo[]`.

### Vehicle-side / telemetry vocabularies (explicitly *not* business events)

- `EquipmentEventInfo` (L60657): `ignitionStatus`, `ignitionStateChangeTrigger in
  {Unknown, DataGap, RPM, BatteryVoltage, Device}` (i.e. *how we inferred the
  ignition change*), `engineRunTime`, `fuelLevel`, `voltage`, `odometer`.
- `CriticalEventInfo.incidentType in {HardBrake, LaneDepartureWarning,
  StabilityControl, FollowingTime, ForwardCollisionWarning, Overspeed}` (L60695).
- `FaultCodeEventInfo` (L60773): `diagnosticTroubleCodeType in {J1587, J1939,
  OBD2}`, `troubleCode`, `failureModeIdentifier`, `sourceAddress`,
  `occurrenceCount`, with `startInfo`/`endInfo` - a fault is an *interval*, not an
  instant.
- `OperationalInfo.lastKnownMotionState in {Unknown, Stopped, Idling, InMotion,
  IndeterminateStationary}`.

### Where telemetry stops and business events begin

The spec draws this line structurally, and it is the single most useful thing here
for our A4 scoping:

| Layer | Endpoint(s) | Object | Cadence |
| --- | --- | --- | --- |
| Raw telemetry | `GET /reports/equipmentpositions` | `Position` - GPS ping with `coordinate`, `odometer`, `speed`, `heading`, `satellitesUsed`, `horizontalDilution`, `horizontalAccuracy` | every ping |
| Current state | `GET /reports/equipmentstatus` | `EquipmentStatus` -> `OperationalInfo` (ignition, odometer, fuel, lastKnownPosition/Time) + `TelemetryStateInfo` (`telemetryData` as an open key/value map) | snapshot |
| Vehicle events | `Event` types `IgnitionStatusChanged`, `FaultCode`, `CriticalEvent` | `EquipmentEventInfo`, `FaultCodeEventInfo`, `CriticalEventInfo` | per occurrence |
| **Business events** | `Event` types `Stop*`, `Route*`, `SendOrders`, `DriveTask` | `StopEventInfo`, `RouteEventInfo`, `TaskEventInfo` | per work transition |
| Business record | `GET /reports/routeactuals`, `GET /reports/formResponses` | `RouteActual`, `FormResponse` | after the fact |
| Compliance | worker compliance/logs, unassigned vehicle activity | `WorkerLogs`, `UnassignedVehicleActivity` | per log day |

Telemetry never carries order or stop identity; `Position.associations`
(`PositionAssociations`) and `EquipmentStatusAssociations` are where the two worlds
are stitched - the latter carries `currentRouteIdentity`, `workerIdentity`,
`coWorkerIdentity`, `telematicsDeviceIdentity`, `mobileDeviceIdentity`. A GPS ping
is correlated to a route through the *equipment*, not directly.

Region filtering makes the same split visible (`tags[Events]`): `Route`, `Stop`,
`DriverTask`, `SendOrders` filter by the **Route's** region;
`IgnitionStatusChanged` by the **TelematicDevice's**; `WorkerStatusChanged` by the
**Worker's**; `CriticalEvent` by the **Equipment's**; `FaultCode` is global. Each
event type declares its *main entity*, and the main entity determines scoping.
That is a small, portable idea: **every event names the aggregate it belongs to**.

## Time, identity, evidence

### Time

- **Planned vs actual is typed, not flagged** (see Model summary). `StopActualData`
  (L61058) holds `arrivalTimestamp`/`departureTimestamp` as `DataSourcedTimestamp`;
  `StopActualPlannedData` (L61085) adds `plannedArrivalTimestamp` /
  `plannedDepartureTimestamp` as plain `Timestamp`. Planned times carry no
  provenance because a planner computed them; actual times always do.
- **Event time vs system time.** `Event.eventTimestamp` = "the timestamp when the
  event occurred ... for worker status events, this is the date that the original
  event was created on the drivers mobile device prior to any edits";
  `Event.systemTimestamp` = "when the event is stored on the server". Both UTC
  (L60047). The query side honours the distinction: `timeSource in {Device,
  System}` selects which one `beginDate`/`endDate` filter on - with a documented
  exception ("Worker status events are always selected by the `modifiedDate` in the
  `workerLogDetailInfo` object regardless of which `timeSource` parameter is passed
  in").
- **Positions carry both too**: `PositionTimestamps.deviceTimestamp` ("recorded on
  the device") vs `.systemTimestamp` ("recorded by the system") (L61606).
- **Four times on an HOS log row** (`WorkerLogsBaseDetailInfo`, L62226):
  `recordTime` ("Date the original event was created on the drivers mobile device
  prior to any edits ... returned in the drivers local time"), `recordTimeUTC`
  (same instant in UTC), `editedDate` ("the moment a user *requested* a change ...
  prior to any approval or confirmation"), `modifiedDate` ("when the event is
  stored on the server ... in the scenario of a log edit, the timestamp at which
  the modifications are officially acknowledged"). Requested-vs-acknowledged is a
  distinction most systems never make.
- **Zones.** `Location.timeZone` per location; `WorkerEventInfo.timeZone`;
  `WorkerLogs.reportTimestamp` explicitly "midnight to midnight of the given date,
  based on the time zone of the Drivers Primary Region". Date-only vs instant is
  respected: `Order.beginDate`/`endDate`/`assignedDate` are `format: date`;
  everything else is `date-time`.
- **Windows.** `StopTimeWindowDetails` splits `openCloses[]` (when the location is
  physically open) from `serviceWindows[]` (when it prefers to be served), each an
  array of `TimeWindowDetail`; `TimeWindowType` is a reusable, order-class-aware
  rule set. Misses are typed by which window and which direction (above).
- **Departure discipline.** `DepartureType in {FixedDuration, FixedDeparture,
  FixedArrival}` - a stop's timing can be anchored at its arrival, its departure,
  or its duration.

### Identity & cross-reference

`Identity` (L54531) is used for *every* reference in the API and is a deliberate
two-key object:

- `entityKey` - "the entity's unique identifier that is **assigned by the system**"
- `identifier` - "a value that the entity can be used for identification and
  labeling purposes" (the customer-facing natural key, e.g. `ROUTE2`, `DEL`)
- `description` - free text, "not all entity types will have a description ...
  best practice to test if the property actually exists"

Variants narrow it: `EntityKeyOnlyIdentity`, `IdentifierOnlyIdentity`,
`EntityReadOnlyIdentity`, `AssociationIdentity`, `LocationIdentity` (+
`LocationIdentityType`). `x-omni-valid` on each schema classifies every field as
`PrimaryIdentity` / `RequiredRelatedIdentity` / `OptionalRelatedIdentity` /
`ReadonlyRelatedIdentity` / `CalculatedReadonly` / `MonolithicChildCollection` - a
machine-readable statement of *which fields are references and who owns them*.
That vendor extension is the most reusable piece of engineering in the file.

Cross-references to the outside world are thin but present: `Carrier` by DOT
number, `EquipmentStatus.vehicleIdentificationNumber` (VIN), `Device`
phone/telematics hardware ids, `preferredRouteIdentifier` as a string route key.
There is **one** customer identifier slot per entity, not a namespaced map - see
Traps.

Concurrency and audit: `Entity` (L54700) carries `createdBy`, `createdTimestamp`,
`modifiedBy`, `modifiedTimestamp`, and `version` - "In PUT/PATCH operations, if
this field is included then the number will be compared with the current version of
the entity, and an error returned if they do not match." Optimistic concurrency is
part of the contract.

### Evidence, provenance and corrections - the strongest thing in this source

1. **`DataSource` on every measured actual** (L61544):
   `NotSet, Projected, AssumedFromProjection, DispatcherEntered, AutoCaptured,
   GeoComputed, Computed, OdometerComputed, IgnitionComputed`.
   Applied via `DataSourcedTimestamp` (L61770), `DataSourcedDistance`,
   `EquipmentDataSourcedDistance`, `EquipmentDataSourcedDuration`. So an actual
   arrival time is never just a time: it is a time plus *how we came to believe it*
   - a geofence computation, an ignition or odometer inference, a dispatcher typing
   it in, or a projection we assumed because nothing arrived.
   `AssumedFromProjection` is an explicit "this is a planned value masquerading as
   an actual because we never heard otherwise" marker.
2. **`eventSource` on stop events**: `MobileDevice | Dispatch | Unknown` (L60381) -
   the driver's device asserted this, or a dispatcher did, or we do not know. This
   is the provenance distinction the brief asked about, and Roadnet states it at the
   event level rather than leaving it to be reconstructed from an actor id.
3. **Two independent measurements kept side by side.** `StopActualData` carries
   `distanceToOdometer` ("determined by the vehicle's odometer reading") *and*
   `distanceToGps` ("determined by the vehicle's GPS positions") *and* the
   `DataSourced` `distanceTo` that picks one. `RouteActualTotals` does the same with
   `distanceOdometer`/`distanceGps`, and warns that although both fields appear in
   `plannedTotals` they "are only ever returned in the **totals** object ... cannot
   be determined during the planning phase."
4. **Correction semantics on HOS logs.** `WorkerLogEventsDetailInfo.edit in {None,
   Correction}`, plus `confirmed: boolean`, plus `WorkerLogs.edited: boolean`, plus
   `WorkerLogs.sensorFailure: boolean`, plus the `editedDate` (requested) vs
   `modifiedDate` (acknowledged) pair. A correction is a typed, attributed,
   two-phase thing.
5. **Attribution of unattributed activity.** `UnassignedVehicleActivity` (L65105)
   models the whole life of a driving record nobody claimed:
   `classification in (unassigned, assigned, rejected, reclassified)`,
   `previousDriver`/`nextDriver` with their session boundary times,
   `rejectedBy`/`rejectedById`/`rejectedName`/`rejectedReason`/`rejectedDateTime`
   (+ `...Local`), `reclassify` ("Shorthaul, Unassigned, NonCompanyDriver,
   LowSpeedYardMove etc."), `reclassifyDetails`, `note`/`noteReason`/
   `noteUpdateBy`/`noteUpdatedDate`, and `modifiedByName`. A complete *claim /
   counter-claim / annotation* model for a disputed fact.
6. **Geocode quality as evidence.** `Location.geocodeAccuracy in {NotApplicable,
   StreetExact, RooftopExact, StreetHigh, RooftopHigh, StreetMedium, RooftopMedium,
   StreetLow, RooftopLow, PostalDetail, Postal, City}` (L55652) - how much to trust
   the coordinate, as a calculated read-only field.
7. **Signature capture as evidence.** `StopEventInfo.signature` (base-64) with
   `consignee` ("signee name"): "A Base-64 encoded string that represents a
   signature capture event. This event includes the signature and delivery images as
   well as a delivery description and its parent route." Same pair on
   `ServiceableStopActual`.

What is **missing**: no event id (only `eventHash`, example `20180203073000`, type
string - unclear as an idempotency key), no event supersession or reversal, no way
to retract a `StopArrived` other than a subsequent `Change` status, and no
provenance on plan-side data at all.

## Scores

Weights are set in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 2 | 2 | 0 | 2 | 3 | 1 | 3 | Dispatch-side order only. `orderState` 15 values incl. `Partially*` (`OrderActual` L61104); `isRouted`; `POST /dailyplan/orders/{entityKey}/unassign`; 43 typed refusal reasons (`NotRoutedOrderReasons`). **No** offer/award, accept/decline, book, estimate or quote anywhere - C4=0 is not a near miss, the commercial half of A1 is absent. C5: `beginDate`/`endDate` "allowable range for service", `assignedDate` derivation rule spelled out (L57435). C7: only `Entity.createdBy/modifiedBy/version` (L54700). C8: `workflowExtensions` at 4 levels + `customProperties` + URL major versioning (`info.description`). |
| A2 Shipment structure | 2 | 3 | 1 | 0 | n/a | 2 | 1 | 3 | C2=3 for the four documented order shapes and the **Transfer** invariant "Quantities (and Line items if relevant) must be identical between the two tasks" (`Order.tasks` L57435), plus `orderType in {None, Delivery, Pickup, DeliveryAndPickup, Transfer}` (`NotRoutedOrderResults`). C1=2: `Order` -> `WorkerTask` -> `LineItem` -> `SKU`, `Quantities[3]`, `hazmatTypes`, `CategoryQuantities` - but capacity is three abstract "sizes" (`Quantities` L61688), not weight/cube/pieces, and there is no shipment-vs-order distinction or services-ordered catalog. C3=1: tasks have no state of their own. C4=0: no HHG shipment types (HHG/storage/vehicle/PPM). |
| A3 Trip, stop & assignment | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 3 | Best-in-class for the area. C1/C2: nine-member typed stop union (`Stop` L58660, `StopType` L61417); `tripNumber` + `MidrouteDepotStop.loadAction` decomposing a route into trips around reloads (L58857, L59672); consolidation of many orders onto one stop via `ServiceableStop.orders[]`; worker + equipment + device assignment (`RoutePlan` L58225, `EquipmentStatusAssociations`); route templates, territories, sessions. C3: `StatusType` 11 (L60136) **and** `RouteStateType` 17 (L60151) as orthogonal enums, with the `setStatusToRouting` entry rule in `tags[Daily Plan Overview]`. C5: `plannedSequenceNormalized` vs `sequence`; planned vs actual times/distances/durations throughout (L61085). C6: `Identity` on every relation + `x-omni-valid` reference classification. C7: `DataSource` on every actual (L61544). C4=0: no agent/van-line structure, no crew roles, no HHG equipment semantics beyond generic tractor/trailer. |
| A4 Execution events & tracking | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 2 | C1: 18 event types over six info bodies (`Event` L60047, `EventInfo` L60096). C2: `StopArrived`/`StopServicing`/`StopDeparted` separate *being there* from *working*; route-level vs stop-level arrive/depart are distinct events; `unserviceable` is defined by the mobile gesture that produces it (L60381); `DiversionStop`/`UnknownStop` are actual-only (L58581). C3: the two route enums plus `StopEventInfo.status` and `statusReasonCodeIdentity`. C5: `eventTimestamp` vs `systemTimestamp` both defined, `timeSource in {Device, System}` on the query, `PositionTimestamps` device vs system (L61606), `missedTimeWindowDurationType` (L58857). C7: `eventSource` + `DataSource` + odometer-vs-GPS dual measurement + `edit: Correction` + `UnassignedVehicleActivity` claim/reject/reclassify (L65105). C8=2: the event-type list is a closed enum with no per-event versioning; extension is only via `customProperties`, and those must be pre-declared in the desktop client. |
| A5 Storage-in-transit | 1 | 1 | 0 | 0 | 1 | n/a | n/a | n/a | No storage concept. Only adjacent structures: depot stops with `loadAction in {AsNeeded, Empty, Full, None}` and `runningQuantityAfter` (a warehouse as a *reload point*, not a *holding place*), `LayoverStop`/`LayoverLocationInfo`, `MultiDayRoutingOptions` and `ReloadOptions` in `CommonAttributes`, `DepotInfo`/`DepotSKU`. Nothing models goods resting, a storage duration, an SIT-in/SIT-out pair, a delivery-out leg, or a permanent-storage boundary. C5=1 for `MultiDayRoutingOptions` alone. |
| A6 Documents & evidence | 2 | 2 | 1 | 0 | 2 | 3 | 2 | 2 | C1/C2: `FormResponse` (L62734) from "Roadnet Mobile custom forms that drivers fill out during their work day", with `FormControlResponse` {`question`, `answeredTime`, `sequence`, `repetitionNumber`, `value`} and `Response.responseType in {Text, Binary, Entity}` - an answer can *be a reference to another entity*; base-64 `signature` + `consignee` on stop events and `ServiceableStopActual`. C3=1: no document state machine - a form response either exists or does not; no required/submitted/archived. C6=3: `FormResponse` binds `stopInfo`, `equipmentIdentity`, `workerIdentity`, `orderIdentity`, `lineItemIdentity`, `customFormIdentity` - six-way correlation of one piece of evidence. C7=2: `consignee` names the signer and `answeredTime` is per control, but there is no correction or supersession of a submitted response. C4=0: no BOL, weight ticket, inventory, order for service or estimate. |
| A7 Charges & billing hooks | 1 | 1 | 0 | 0 | n/a | n/a | n/a | n/a | Cost model only, for route optimisation: `Order.netRevenue`, `WorkerCosts`/`PerHourCosts`/`PerDistanceCosts`/`PerUnitCosts`, `EquipmentTypeDistanceCost`, `RouteTotals`/`RouteActualTotals` with `paidTime`/`unpaidTime`. No charge events, no invoice, no line-haul vs accessorial split, no billing party. |
| A8 Parties & roles | 2 | 2 | 1 | 0 | n/a | 3 | 2 | 3 | C2=2 for two crisp definitions: `Carrier` = "An operating authority identified by a DOT number. A single company may have multiple carriers under its structure." (L62663) and `Account` = "grouping locations together that are for the same client, buyer, or purchaser" (`tags[Accounts]`). Worker/WorkerType covers driver + helper + dispatcher (`tags[Workers]`); `Location.contact`/`alternateContact`; `consignee` as the receiving party at a stop; `coWorkerIdentity` for team drivers. C3=1: roles are configuration, not a lifecycle. C4=0: **no** booking / origin / hauling / destination agent, no van line, no RMC-vs-shipper distinction, no warehouse role. C8=3: `WorkerType`, `EquipmentType`, `OrderClass`, `ServiceTimeType`, `TimeWindowType` are all tenant-defined type systems. |
| A9 Identity & cross-references | 3 | 3 | n/a | 0 | n/a | 3 | 2 | 2 | C2=3 for the explicit split in `Identity` (L54531) between system-assigned `entityKey` and customer-facing `identifier`, carried into `EntityKeyOnlyIdentity`/`IdentifierOnlyIdentity` and into path/query semantics. C6=3: every relation is an `Identity`, and `x-omni-valid` declares each field's referential role machine-readably. External keys present: DOT (`Carrier`), VIN (`EquipmentStatus`), device phone number, `preferredRouteIdentifier`. C7=2: `createdBy`/`modifiedBy`/`version` (L54700), `recordEntityKey` on log rows. C8=2: **one** identifier slot per entity, not a namespaced external-id map - you cannot hold "Allied's registration number" and "Atlas's order number" on the same object without abusing `customProperties`. C4=0: no order-no / registration-no / SCAC / BOL / PRO / service-order-no vocabulary. |

**S5 - fit to Pegasus data:** `unknown` for every area. This analysis did not read
pegII or Cloud (explicitly out of scope for this task). What can be said without
guessing: Roadnet is a *sink and source* for our tenants, not a description of our
data, so S5 here is really "can pegII/Cloud feed Roadnet orders and consume Roadnet
events", which is a phase-5 mapping question rather than a property of this source.
Flagged in Open questions.

## Strengths worth adopting

1. **Plan and actual as parallel types, with the actual carrying the plan.**
   `StopActualPlannedData = StopActualData + planned*`; `RouteActual.timestamps`
   *and* `.plannedTimestamps`, `.totals` *and* `.plannedTotals`. Variance is
   derivable at the point of reading, and nobody has to join back to a planning
   record that may have been re-planned since. Adopt the shape, and especially the
   rule that **planned values have no provenance and actual values always do**.
2. **`DataSource` as a value-object companion to every measured actual.** A
   `DataSourcedTimestamp` is `{value, dataSource}`. Nine sources, including
   `DispatcherEntered` (a human asserted it), `GeoComputed` (a geofence did),
   `IgnitionComputed`/`OdometerComputed` (a sensor inference did) and
   `AssumedFromProjection` (nobody did - we kept the plan). For HHG this maps
   straight onto "the driver's app said loaded at 14:10" vs "the coordinator typed
   it" vs "we assumed it because the ticket came back".
3. **`eventSource: MobileDevice | Dispatch | Unknown` at event level.** Provenance
   as a first-class field on the event. Our catalog should carry at minimum
   `{device, office, partner, derived, unknown}`.
4. **Separating dispatch-workflow status from execution state.** `StatusType`
   (where the plan is) vs `RouteStateType` (what the truck is doing). pegII's
   form-and-save CRUD very likely conflates these into one status field; the split
   is cheap to adopt and immediately clarifies "cancelled the plan" vs "abandoned
   the run".
5. **A nine-member typed stop union, including actual-only members.** Depot /
   serviceable / break / layover / maintenance / restricted, plus `UnknownStop`
   ("system created, not associated with any known stop") and `DiversionStop`
   ("indicates a change to a planned route"). HHG needs exactly this: origin
   residence, destination residence, warehouse, agent facility, weigh station,
   fuel, overnight - and it needs somewhere to put the stop that happened but was
   never planned.
6. **`tripNumber` + reload `loadAction`.** A Route is not the unit of loading; a
   Route contains trips, separated by depot reloads, each with its own running
   quantity. The right prior art for an HHG trip that goes residence -> warehouse
   -> residence, or for a shuttle.
7. **Every event declares its main entity.** The region-filter table
   (`tags[Events]`) is really a statement that `Stop`/`Route`/`DriverTask`/
   `SendOrders` belong to the Route aggregate, `IgnitionStatusChanged` to the
   Device, `WorkerStatusChanged` to the Worker, `CriticalEvent` to the Equipment,
   and `FaultCode` to nothing. Our catalog should publish the same table.
8. **Refusals are explained, twice.** `NotRoutedOrderResults` gives
   `reasonNotOnNearbyRoute` **and** `reasonNotOnNewRoute` from a 43-value
   vocabulary. A planning system that declines to do something should say why, in
   codes, per alternative it rejected.
9. **The claim / reject / reclassify model for unattributed activity**
   (`UnassignedVehicleActivity`) - portable to any disputed HHG fact (disputed
   weight, disputed arrival, disputed damage).
10. **`x-omni-valid` as machine-readable referential metadata.** Declaring per field
    whether it is the primary identity, a required/optional/read-only related
    identity, a calculated read-only, or a "monolithic child collection"
    (replace-whole-collection semantics) is exactly what a code generator and a
    mapping layer both need. Worth mirroring in our model files.
11. **Two-phase corrections.** `editedDate` = when the change was *requested*;
    `modifiedDate` = when it was *acknowledged on the server*; `confirmed` and
    `edit in {None, Correction}` alongside. Corrections in HHG (reweigh, revised
    delivery spread, re-signed inventory) have the same request/approve shape.
12. **Open/close windows vs service windows, kept separate**, each typed and
    order-class-aware, with misses reported as `{duration, which window, early or
    late}`.

## Weaknesses / traps

1. **There is no shipment.** The Transfer order (pickup task + delivery task with
   identical quantities) is as close as it gets, and even then the two tasks can
   land on *different routes* (`WorkerTask.assignedRouteIdentity` is per task). An
   HHG shipment has an identity, a weight, a valuation, a registration number and a
   set of services that survive every re-plan; a Roadnet order does not. Taking
   Roadnet's order as our shipment would make "which route is shipment 12345 on" a
   query over tasks instead of a fact.
2. **Plan mutations ride the status enum.** `StopEventInfo.status in {Servicing,
   Cancelled, Serviced, **Add**, **Delete**, **Change**}`. Three of those six are
   not states - they are CRUD verbs leaking into an event channel. Do not copy:
   keep `StopAdded` / `StopRemoved` / `StopResequenced` as separate event types with
   their own payloads (Samsara does exactly this - see `src:samsara`).
3. **`Partially*` states instead of per-task states.** Because `WorkerTask` has no
   state of its own, a two-task order that is half done gets `PartiallyServiced`.
   For HHG - where origin services complete weeks before destination services, with
   SIT in between - this collapses the very distinction we need. Model task/leg
   state; roll up for display only.
4. **One identifier per entity.** `Identity.identifier` is a single string. Our
   tenants are agents for **both Allied and Atlas** and will hold a van line
   registration number, an agent order number, and possibly a shipper reference on
   the same shipment. Roadnet forces those into pre-declared `customProperties`,
   which "must be predefined for the specific entity type in the Roadnet Anywhere
   Desktop Client ... If not predefined, they will not be able to be posted or
   retrieved." Adopt a **namespaced external-id map** instead (Samsara's
   `externalIds` is the better prior art).
5. **Quantities are three anonymous numbers.** `Quantities` is `minItems: 3,
   maxItems: 3` of `number`, given meaning only by region settings
   `considerSize1/2/3`. Convenient for a capacity solver, useless as a domain term.
   HHG needs named, unit-bearing quantities (net weight, gross weight, tare, cube,
   piece count) and needs to say which are *actual* vs *estimated* vs *reweighed*.
6. **Events are polled, not pushed, and have no clean idempotency key.**
   `GET /events/{subscriber}` with `pageIndex`/`pageSize` and a documented warning
   that events "occur very frequently"; the only candidate key is `eventHash`
   (`type: string`, example `20180203073000`, undocumented semantics). Our catalog
   must not assume the upstream gives exactly-once delivery or a stable event id.
7. **`AssumedFromProjection` is a silent lie if you ignore `dataSource`.** An actual
   arrival time can be a *planned* arrival time that was never contradicted.
   Consuming `arrivalTimestamp.value` without reading `.dataSource` will quietly
   populate our "actual" fields with projections. A real integration hazard for the
   tenant work, not a modelling nicety.
8. **No SIT, no storage, no warehouse-as-holder.** A depot is a reload point. If we
   let Roadnet shape A5 we will model SIT as "a stop at a depot", which cannot
   express duration, storage authority, monthly storage charges, or the delivery-out
   leg being a separate service.
9. **No commercial lifecycle and no agent network.** Nothing about offer/award,
   booking agent vs hauling agent, revenue splits, or a van line. Roadnet sits
   entirely downstream of those decisions. Do not read its silence on A1/A8 as "those
   areas are simple".
10. **`Timestamp`/`Duration`/`Distance`/`Weight` are custom wrapper types** rather
    than ISO-8601 / unit-bearing primitives, and several fields are
    `format: date-Time` (sic) or plain `string`. A reminder that our model should
    specify units and formats explicitly rather than inherit a vendor's.
11. **Config-gated extensibility.** Custom properties and workflow extensions are
    powerful but require a desktop-client declaration first. A field that exists in
    the API but silently drops on write is worse than no field; if we adopt
    extension points, their registration must be part of the same API.

## Out-of-v1 material

**A13 - Crew, driver & settlement** (the richest out-of-v1 seam here):
- `WorkerCosts`, `PerHourCosts`, `PerDistanceCosts`, `PerUnitCosts` - pay structures
  used to cost a route; `tags[Workers]` says worker "pay information ... is used to
  help determine the cost of a route".
- `RouteActualTotals.paidTime` / `.unpaidTime` / `.breakTime` / `.waitTime` /
  `.layoverTime` / `.delayTime` - a full paid/unpaid decomposition of a work day,
  per route.
- `DailyWorkerPerformance`, `WorkerPerformance`, `PerformanceInfo`,
  `PerformanceDataContext`, `PerformanceMonitoringMetrics`, `Goals`.
- HOS compliance: `WorkerComplianceInfo`, `WorkerComplianceOptimizedInfo`,
  `HOSRules`, `HOSRulesForRegion`, `HosSetting`, `AccumulatedDailyTimes`,
  `RemainingDailyTimes`, `WeeklyTimes`, `ResetTimes`, `CountryCompliance`,
  `WorkerEventViolationInfo`, `tags[Worker]`.
- `UnassignedVehicleActivity` doubles as a settlement artefact (whose hours were
  these).
- `Territory` / `TerritoryWorker` / `TerritoryEquipment` / `CellSet` / `Cell` /
  `CellWorker` - geographic assignment of crews to areas.
- `RegionRegulatoryInfo`, `Jurisdiction`, `JurisdictionDistance`,
  `DistanceByJurisdictionRequest/Response` - IFTA-style mileage by jurisdiction.

**A10 - Survey, estimating & inventory** (weak but not empty): `SKU` with per-SKU
service-time detail - `tags[SKU]`: "you can specify that it takes longer to deliver
a keg than a case of 12-ounce cans, and the service time calculated for the order
will reflect this difference". Structurally the same idea as an HHG survey's
cube-to-labour-hours conversion, driven from an item catalog. Also
`ServiceTimeType`, `ServiceTimeDetail`, `PlannedServiceTime`, `ServiceTimeOverrides`,
`forceBulkServiceTime` (bulk threshold), `ProductType`, `PackageType`,
`EquipmentTypeCompartment` + compartment routing.

**A11 - Claims & valuation:** nothing. The `Over`/`Short`/`Damaged` reason codes
(`ReasonCode.type`) are the *trigger* for a claim but carry no claim, no valuation,
no liability. Worth recording as the hand-off point.

**A12 - Rating & tariffs:** nothing. `Order.netRevenue` is a single number used by
the optimiser.

Also out of v1 but worth keeping: `ActiveAlertRecipient` and
`ServiceLocationActiveAlertSubscriptions` (`tags[Active Alert Recipient]`) - a
customer-notification subscription model (who gets told when service is near), i.e.
prior art for the shipper-visibility notifications the user wants to be ready for.

## Open questions

1. **Which Roadnet product edition do the tenants run, and do they have the Drive
   app?** `TaskEventInfo` is marked "Only customers using Omnitracs Drive
   application", and `Stop.workflowStopType` / `workflowIdentity` /
   `workflowExtensions` are all "Only relevant when the Drive app is in use". If
   they run Roadnet Mobile rather than Drive, the `DriveTask` event type and the
   whole workflow-extension mechanism are unavailable, and `FormResponse` becomes
   the only structured driver-capture channel. - user / tenant.
2. **Is an event subscriber already configured, and for which event types?** "An
   event subscriber must be configured through the client before any events can be
   retrieved" (`tags[Events]`). Subscription is configured outside the API, so the
   available set cannot be discovered from the spec. - user / tenant.
3. **What is `eventHash` and is it a stable idempotency key?** Undocumented; the
   example value looks like a timestamp. Determines whether our ingestion can dedupe.
   - Omnitracs, or an empirical test.
4. **Is there a separate Omnitracs Event Subscription Service / XRS macro (form)
   API** beyond this REST surface? The registry already tracks
   `src:omnitracs-one-xrs` as `needs-user`; the macro/form definition schema is the
   piece most likely to carry HHG-specific driver capture (inventory, OS&D,
   signature) and is not in this file. - user.
5. **Does the tenant's Roadnet hold HHG registration numbers at all**, and if so in
   `Identity.identifier`, in a pre-declared custom property, or nowhere? This decides
   whether Roadnet events can be correlated back to a Pegasus shipment without a side
   table. - tenant data.
6. **How do the tenants represent a warehouse / SIT hold today**, given the model has
   no storage concept - as a depot stop, as a separate order, or outside Roadnet
   entirely? - user.
7. **S5 for every area is unknown.** Needs a pegII/Cloud read (a separate task) to
   answer "can our systems supply these concepts today".
8. **Is `Quantities[3]` configured to weight / cube / pieces at these tenants?** The
   three sizes are region settings; the mapping is a prerequisite for any
   weight-bearing event we publish from Roadnet data. - tenant config.
