# A3 — Trip, stop & assignment

**Status:** decided · **Date:** 2026-09-18 (round-2 revision) · **Confidence:** see §7
**This document is subordinate to [`00-shared-decisions.md`](00-shared-decisions.md).** Where the
two disagree, the shared layer wins and this document is wrong. Every change required of A3 by
[shared §10.1](00-shared-decisions.md) is made below and listed in §9.

**Scope rule in force:** this is an **ideal target model built from external sources only**.
Our own systems (`packages/domain`, the Prisma schema, the integration floors, the pegII order
shape, the long-haul app, our integration configs) are `role: mapping-only` in
[`registry.yaml`](../sources/registry.yaml) and are **not cited here as evidence for what the
domain is**. Round 1 framed part of the stop-ownership fork around them; that framing is
discarded. Partner contracts (Weichert, SIRVA ADE, Atlas) _are_ external evidence — they
describe how counterparties behave. **Nothing here is designed for migration from anything we own.**
**S5 (fit to Pegasus data) is withdrawn** ([rubric.md](../rubric.md) § Per-source attributes);
S5 lines in round-1 analyses are ignored throughout.

**Disclosure rule.** Every claim below either cites a source that says **that** thing, or is marked
**[ORIGINAL]** inline at the point of use. A source that says something narrower than the claim does
not support the claim. Where two sources each supply half of a shape and the join is mechanical,
the mark is **[SYNTHESIS]**. Round 2 found this document's worst defect to be invention laundered as
evidence; §9 lists every citation withdrawn.

**Atlas is blocked.** No `Ocp-Apim-Subscription-Key` exists anywhere in the repo, and Atlas's
operational vocabulary is **not merely unfetched but unpublished** — the code-list extraction over
the operational specs returns nothing
([`analysis-supplement-vocabulary.md`](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md)
§1, §2.2). **Atlas A3 C2 is corrected from 2 to 1.** Every Atlas-derived element in this document is
**column-name evidence** and is re-cited as such. **No claim here is scheduled for resolution by
fetching Atlas `/Types` endpoints, and none may be** — the round-1 "cheap confidence plan" in the
previous revision of §7 is deleted outright, not footnoted.

**Weighting for this area** (per [round-1-crosscheck.md](round-1-crosscheck.md) §Recommended
order, item 1): **C4 (HHG fidelity) and C1 (coverage) weighted heavily; C5 and C7 discounted**,
because nine sources already do time and provenance well and rewarding them would let Samsara or
Omnitracs "win" an area neither can express. Two additional criteria are introduced below (§3.4).

---

## 1. The question, stated sharply

> **Several household-goods shipments ride one van, picked up and delivered in interleaved
> sequence, with a storage-in-transit interruption mid-journey and agent-to-agent custody
> handoffs. What entity holds that, and does a stop belong to the trip or to the shipment?**

Four sub-questions fall out, and they are one decision, not four:

1. **Where do stops live?** On the trip, on the shipment, or nowhere (an independent entity both
   reference)?
2. **What is the join?** Is "shipment 12345 is on trip T-900" a foreign key, a membership row, or
   a set of actions?
3. **Can a shipment exist with no trip?** For weeks, in SIT, having already been picked up.
4. **Can a shipment ride two successive trips and stay one shipment?**

A fifth is added in this revision, because the critique showed the model could not answer it and
the answer changes the shape: **5. What happens when the movement is performed by a party whose
vehicle, trip and stop sequence we never see?** (§3.2, and [shared §8](00-shared-decisions.md).)

### Why this is irreversible or expensive to change later

- **It is the envelope of every published event.** The whole point of this reference model is the
  domain event catalog ([README.md](../README.md) §Layers). If an arrival record is keyed by
  shipment, a vehicle-level arrival is permanently unsayable; if it is keyed by trip, a
  shipment-level fact with no trip (stored, awaiting assignment, delivered out of a warehouse by a
  local crew) is permanently unsayable. Round 1 established that _"a published event cannot be
  unpublished"_ ([crosscheck §Contradictions 8](round-1-crosscheck.md)). Partners parse the
  envelope; the envelope cannot be renamed.
  **The envelope is no longer A3's to design.** It is settled in
  [shared §1](00-shared-decisions.md): one `subject`, a typed reference to **any one** aggregate
  (`trip` and `stop` and `stopAction` and `assignment` among them), never a path, never
  shipment-rooted, with other aggregates carried in a non-authoritative `context[]`. A3 adopts it
  wholesale. What A3 still owns is _which_ aggregate is canonical for which fact (§3.2).
- **The failure is asymmetric.** Getting it wrong in the direction of _stop-owned-by-trip_ costs a
  join on every read and a derived projection. Getting it wrong in the direction of
  _stop-owned-by-shipment_ makes consolidation **structurally inexpressible** — not hard,
  unaskable. `src:project44` demonstrates this: its `Load` is _"tied to a shipment and exactly two
  stops"_ and _"divides a shipment rather than joining two"_; its own analysis records that
  consolidating several shipments onto one vehicle _"is not expressible"_ and that the vehicle is
  reachable only as _"the id of a route segment [which] can be used to associate the event with a
  specific vehicle"_. There is no migration out of that; you re-key the catalog.
- **Nine sources score C1=3 here and not one scores above 2 on C4.** This is the crosscheck's
  headline finding and it means A3 cannot be settled by picking a best source. **A3 is a synthesis
  with load-bearing original design**, and this document records it as one.

---

## 2. The positions in the external corpus

Ordered by what each _buys_, not by score.

### 2.1 "Consolidation needs no concept" — `src:open-trip-model` (grade A)

A `Trip` is _"an aggregate entity that combines various entities to model visiting various
locations, potentially doing one or multiple actions on each location, such as loading or
unloading consignments"_, and it _"is **optionally** coupled to a Vehicle that is/was driving this
trip"_ (`otm5-index.html`, "Trip"; schema `otm-api-v5.6.yaml:13672`). **A trip carries no goods.**
The only thing that puts a consignment on a vehicle is a `load` action at a stop referencing that
consignment; the only thing that takes it off is an `unload`. A `Stop` _"models visiting a certain
location at a certain time and potentially doing several other actions at that location"_
(`:17925`) — **no movement is required for a stop to exist**. The worked `/api/v5/trips` example
(`otm-api-v5.6.yaml:4427–4536`) ships stop 0 "already done" with a `load` beside stop 1 "still needs
to be visited" with the matching `unload` of the same consignment UUID.

**Buys:** N shipments on one trip is the _default reading_, not a special case. Partial load and
partial unload fall out (two load actions at two stops). `sequenceNr` orders stops _"when no times
are present"_ — dispatch-board ordering survives a plan with no committed times. `lifecycle` ∈
{requested, planned, projected, actual, realized} on every action; `result` **legal only on
actual/realized** — a plan cannot carry an outcome. `result.status ∈ succeeded | failed |
partiallySucceeded | cancelled` with a 10-value `result.reason` catalogue in 5.7 and **5.8
sub-results** (_"the unload action can be succeeded for certain goods and failed for others"_).
`HandOver` — _"indicates transferring a consignment from one Actor to another"_ — is a distinct
action with `from`/`to` actor refs.
**Costs:** zero HHG (C4=0 across the board). No SIT at all, and the analysis flags
`Location.type = warehouse` as _"a trap"_. The eight actor roles (shipper/consignor/consignee) are
_"wholesale wrong for HHG"_. One status enum shared by `Trip` and `Consignment`, which _"would
collapse A1 into A3"_. No time zone anywhere.

_Round-2 correction: the previous revision read OTM for its Action primitive and then failed to
take its `result` shape, which is exactly the shape the critique found missing. That is now taken —
via [shared §2](00-shared-decisions.md), which factors it with Shippeo's grid._

### 2.2 "The visit is the primitive; cargo events reference it" — `src:dcsa` (grade A)

A `TransportCall` is **one visit by one conveyance to one place**, polymorphic on `modeOfTransport`
(`vesselTransportCall` / `bargeTransportCall` / `railTransportCall` / `truckTransportCall`, the last
of which **may** carry `licencePlate`). `transportCallSequenceNumber` is _"Transport operator's key
that uniquely identifies each individual call. This key is essential to distinguish between **two
separate calls at the same location within one voyage**"_ (`dcsa_domain L1547-1552`) — the
stop-sequence problem stated exactly, and solved by an explicit sequence number rather than by
ordering on time. `facilityTypeCode` says what **role** the place plays in this call (`CLOC`
customer location, `DEPO` depot, `OFFD` off-dock storage, `WAYP` waypoint). Above it sits
voyage/service; below it, in JIT, PortCall → TerminalCall (`terminalCallSequenceNumber`) →
PortCallService → Timestamp, and a terminal call can be **`omitted`**. Orthogonally, Booking's
Transport Plan is _"a single `leg`"_ with `transportPlanStage` PRC/MNC/ONC and a
`transportPlanStageSequenceNumber`.

**Buys:** sequence as data, never as time-order. Plan legs and execution calls kept in separate
structures. A **role-of-the-place-in-this-visit** code rather than a property of the place.

> **Withdrawn, and this is the single most important correction in this revision.** The previous
> revision called _"Cargo (equipment) events reference the call; they never contain the journey"_
> **"DCSA's structural rule"** and **"the single most important sentence in the corpus for this
> decision"**, and §7 then rated the whole stop-ownership fork HIGH partly because _"`src:dcsa`
> states the principle explicitly."_ **It does not.** In `dcsa/analysis.md` that sentence is the
> **analyst's** summarising clause at line 195 — it follows _"So the full hierarchy is:…"_ and,
> uniquely among DCSA quotations in that file, carries **no line citation** while every neighbouring
> DCSA quote carries an `L`-ref. It is an inference from schema shape that was attributed to the
> publisher as an explicit principle. The critique is right and the citation is withdrawn.
>
> DCSA in fact ships the **opposite affordance**, and it is useful rather than embarrassing:
> `eventLocation` is a _"General purpose object to capture the location in the `EquipmentEvent`
> whenever it is **not** associated with a `TransportCall` (this could be stuffing and stripping)"_
> (`event_domain L1001-1023`). That is DCSA's own answer to "a cargo event at a place we have no
> call for", and it is the published precedent for the `ExternallyPerformedLeg` this revision
> adopts (§3.2, [shared §8.2](00-shared-decisions.md)).

**Costs:** C4=0 — ocean. No crew, no driver, no HHG equipment. `TransportEvent` has only two codes
(`ARRI`, `DEPA`).

### 2.3 "One stop primitive, shared across four message types, with a mandatory reason" — `src:stedi-x12-reference` (grade A/B)

`S5 Stop Off Details` is the same segment in the **204** (planning the stops), the **990**
(per-stop acceptance), the **214** (status) and the **210** (invoice). `S501` is Stop Sequence
Number; **`S502` Stop Reason Code is mandatory**, from element 163's 19 values including
**`PL` Part Load, `PU` Part Unload, `CN` Consolidate, `TL` Transload, `DT` Drop Trailer,
`WL` Weigh Loaded, `IN` Inspection**. `S511 Accomplish Code` is a _"stop status indicator"_ — the
same record carries plan and accomplishment. The 204 carries `N7` equipment **per stop** (Loop 0380),
and the 210 carries a per-stop `S5` loop so accessorials attach to the stop that incurred them.
Element 1650 supplies the interline custody pair **`J1` Delivered to Connecting Line** / **`R1`
Received from Prior Carrier**, plus `BA` Connecting Line or Cartage Pick-up.

**Buys:** the industry names consolidation as a **stop purpose**, not as a cardinality. Part load
and part unload are anticipated _by the standard_, which is decisive for HHG split pickup and split
delivery. One primitive reused by planning, acceptance, status and billing — the strongest argument
that the stop is a shared object and not a child of either party's aggregate. And a published pair
for handing goods to, and receiving them from, another carrier.
**Costs:** C4=1. Licensed; code lists must be cited by element number, not copied. No transition
rules (`Accomplish Code` exists, its state machine does not).

### 2.4 "Many shipments on one piece of equipment, done properly, with no journey" — `src:x12-212-trailer-manifest` (grade B)

The one standard whose entire reason for existing is _several shipments on one vehicle_. Loop 0200
repeats **9 999 shipments** under one `MS2` equipment. **`TSD Trailer Shipment Details`** has two
elements and both matter: `TSD-01` _"Indicates the loading sequence and relative shipment position
on the trailer"_ and `TSD-02` _"Relative position of shipment in car, trailer, or container"_.
`BLR` puts a **carrier SCAC on each shipment line**, with `BLR-02` an **effective date** — the
standard expects the shipments on one trailer to belong to different carriers, i.e. interline
consolidation stated structurally and time-scoped. `AT9` carries the trailer envelope and tare;
`M7` the seals. Weight is always qualified (element 187 `G`/`N`/`T` plus `RG`/`RN`/`RT` **reweigh**).

**Buys:** _the membership carries data of its own_ — loading sequence, physical position, this
shipment's weight on this trailer, this shipment's carrier. That is a load plan, and `TSD-01` is
the field that makes _"which shipment can we deliver first"_ answerable.
**Costs, verified by direct query on the segment inventory:** **no `S5`, no `S5A`/`S5B`, no `N7`
anywhere in the 212.** No stops, no sequence, no legs, no driver. One `AT7` status for the whole
trailer — _no shipment in a 212 has a status of its own_. And **a shipment appears exactly once per
manifest, so "a shipment at more than one stop" is not merely unsupported, it is unaskable** —
part load / part unload cannot be stated in a 212 at all. `TSD-02` is _"mutually defined"_: a slot
with no vocabulary. Verdict, in the analysis's own words: **a load plan, not a trip**.

### 2.5 "Typed stop union; the route decomposes into trips at reloads" — `src:omnitracs-roadnet` (grade A)

`Stop` is a discriminated union of nine kinds; **only `ServiceableStop` carries orders**. The
`*Actual*` union adds two kinds that can only ever be execution facts: **`UnknownStop`** (_"created
by the system and is not associated with any known stop"_) and **`DiversionStop`** (_"a
non-serviceable stop used to indicate a change to a planned route"_). `ServiceableStop.tripNumber`
plus `MidrouteDepotStop.loadAction` ∈ {AsNeeded, Empty, Full, None} decompose one Route into several
**trips** separated by reloads at a depot. `StatusType` (where the plan is in its authoring/dispatch
workflow) and `RouteStateType` (what the truck is doing right now) are two orthogonal enums. Plan
and actual are **parallel types**, and the actual carries the plan (`StopActualPlannedData` =
`StopActualData` + `planned*`).

**Buys:** a place to put the stop that happened but was never planned; a middle layer between "the
driver's day" and "a stop"; the plan-status / execution-state split.
**Costs:** **there is no shipment.** The nearest thing is the `Transfer` order — two tasks (Pickup
then Delivery) with the stated invariant _"Quantities (and Line items if relevant) must be identical
between the two tasks"_ — and even then the two tasks can land on _different routes_. `Partially*`
rollup states instead of per-task states, which _"collapses the very distinction we need"_ for HHG
where origin services complete weeks before destination services. Plan mutations (`Add`, `Delete`,
`Change`) ride the stop _status_ enum — a modelling smell explicitly flagged as not-to-copy.
No SIT: _"a depot is a reload point"_.

_Round-2 correction: the previous revision cited Omnitracs's **region-filter table** as the source
for a catalog-wide rule that "every event declares the aggregate it belongs to". A filter table is a
query facility. The citation is **withdrawn** ([shared §1.5](00-shared-decisions.md)); the envelope
rule is authored and is justified in the shared layer on its own terms._

### 2.6 "Assignment is an assertion, and route ≠ trip" — `src:samsara` (grade A)

`RouteSettings` makes _when a route starts and ends_ explicit and configurable:
`routeStartingCondition` ∈ {departFirstStop, arriveFirstStop}, `routeCompletionCondition` ∈
{arriveLastStop, departLastStop}, `sequencingMethod` ∈ {unknown, scheduledArrivalTime, manual}.
`Trip` in Samsara is an **asset** movement (`{asset, tripStartTime, tripEndTime, startLocation,
endLocation, completionStatus, tripPurpose}`) with **no route link at all** — trip and route are
never conflated. `positionConstraintType` ∈ {unknown, none, first, last} constrains _where on a
route a task may be sequenced_. And the headline: **`assignmentType` — fifteen ways a
driver-vehicle binding is asserted** (`invalid, unknown, HOS, idCard, static, faceId, tachograph,
safetyManual, RFID, trailer, external, qrCode, driverApp, voiceSignIn, smartAssign`).

**Buys:** the binding of a driver to a vehicle is a **fact with provenance**, not a foreign key.
`source: automatic | driver | admin` on every route update, with `automatic` as an explicit
assertion rather than an absence.
**Costs:** C4=0 — no agent roles, no van line, no crew.

### 2.7 "One trip = one load" — `src:alvys-api` (grade B, the explicit counter-example)

The load/trip seam is stated as **invariants**, and they are the best-argued in the corpus:
stops belong to the **trip**; the load's `Origin`/`Destination` are _"derived from the load's
stops"_ and never stored; **a load with no trip returns 404** (_"treated as non-existent by the
API"_); splitting a load for a relay **supersedes** a trip and the superseded one stays addressable
(`includeDeleted`). Money splits along the same seam: revenue on the load, cost on the trip. Stop
identity is stable _"never a positional index"_, and `StopReordered` is its own change kind. Stops
are polymorphic by scheduling shape (`$type` ∈ {appointment, delivery_window, waypoint}).
Assignment is a first-class command (`TripAssignmentRequest`: **carrier + dispatcher required,
driver/truck/trailer optional**) and is separate from dispatch.

**Buys:** proof that the seam can be stated as five short rules; the derived-origin/destination
rule; the assignment-is-a-command shape.
**Costs, and this is the whole point of reading it:** `TripDetailsResponse.LoadNumber` is a
**scalar**. One trip carries exactly one load. Alvys solves the _inverse_ problem — one load, many
trips, via splits. Its own analysis: _"Borrowing its cardinality would be a direct model failure for
us."_

_Round-2 correction: the previous revision also adopted Alvys's `Eta {Planned, Live, Manual}` and
its `ArrivalRecorded` / `StopStatusChanged` / `Loaded` three-way split "wholesale and without
argument". **Both are rejected** by [shared §4.5](00-shared-decisions.md) — see §3.4._

### 2.8 "Numbers above and below the trip" — `src:atlas-world-group-api` (grade B — **column names only, C2 = 1**)

A van line's real schema, on the wire. A `Stop` carries **`ord_hdrnumber` AND `lgh_number` AND
`mov_number` AND `mfh_number` independently** — the stop is a join point, not a child. `lgh_number`
("leg header") is the trip; `mov_number` (move) sits **above** it; `mfh_number` (manifest) sits
**between** trip and stop with its own stop sequence `stp_mfh_sequence` and its own mileage
accumulator. **A stop's mileage is four numbers** — `stp_ord_mileage` / `stp_lgh_mileage` /
`stp_mfh_mileage` / `stp_trip_mileage`. Every assigned service carries **two** statuses:
`<service>_cmpid_status` (has the assigned company accepted?) and `service_status` (has it been
performed?). `PUT /Tonnages/request` + `/accept` are the only lifecycle transitions modelled as
**verbs** in the whole catalog. `legHauler` is _"the party actually hauling the leg, distinct from
`carrier` and from the agents"_. `OnSiteStaffMember` carries `onSiteStaffMemberLocations[]` binding
named people to `stop_Number`s.

**The standing of all of that, corrected.** The previous revision said _"C2 is properly held at 2."_
It is not. The committed supplement corrects **A3 C2 → 1** and records that the five operational
stop-type axes (`stp_type`, `stp_type1`, `stp_reftype`, `awg_stp_triptype`, `stp_transfer_type`)
have _"no code list and no description anywhere in the catalog"_, that no event-code lookup path
exists in any of the 24 documents, and that the Atlas _"A3 nomination weakens correspondingly"_
(supplement §2.2, §3). **So every Atlas contribution below is a claim that a distinction exists,
never a claim that it is defined:** the manifest layer (§6.2), the accept/perform two-status
lifecycle (§5.8), crew (§5.7), the four mileage accumulators (§4.5). Each is marked at its point of
use. There is **no cheap remedy**: 47 endpoints _would_ be reachable if a key existed, no key exists
in the repo, and the supplement's own conclusion is that a complete capture _"would not raise A4's
semantic precision, and would raise A3's and A5's only partially"_ (§2.4) because the operational
vocabulary carries no code-list binding at all.

**Two Atlas observations that _are_ usable, because they come from the estimating API's declared
enums and worked examples rather than operational column names — and this document is required to
engage both (shared §9, §10.1.10). Both are engaged, one adopted in part and one rejected with an
argument, in §3.2 and §5.4.**

1. **Stop types are directional pairs.** The observed `/Estimating/Stop/Types` values are `Origin`,
   `Destination`, `Origin Extra Stop`, `Destination Extra Stop`, `Origin Airport Stop`,
   `Destination Airport Stop` — _"every type is qualified by which end of the move it belongs to,
   rather than being a bare role. A real modeling idea, and one the ideal model should weigh"_
   (supplement §2.3, table row `stops[].type`). Standing: **six values observed in vendor worked
   examples — a lower bound, not a code list.**
2. **SIT is not a stop type.** The observed values contain no storage or warehouse member; in
   `estimating-v2`, `StorageInTransitModel` hangs off `StopModel.storageInTransit`, so _"storage is
   modeled as a **service at** an Origin or Destination stop, not as a **stop of its own**"_, with a
   worked example showing origin-side and destination-side SIT coexisting on one order
   (supplement §2.5).

**Also costs:** Atlas's own `shipment-management-v1` nests `trips[]` **inside** `Shipment`, which its
analysis calls an artefact of serving the trip filtered to one order and warns: _"Do not model trip
as a child of shipment."_ The two specs disagree about whether a trip has one crew assignment or
many (the `Segment` layer exists in one and not the other).

### 2.9 "Segments as a van line's own consolidation vocabulary" — `src:sirva-ade` (grade A)

`HaulingSegmentType` ∈ **MainLoad / Overflow / MassMove / Transfer**, each independently
addressable. **Overflow** is defined operationally: _"the driver did not have sufficient space for
the entire shipment to be loaded on the trailer, so another driver, tractor and trailer need to
address transportation of the remaining items"_ (SOE p.19). **Transfer**: _"The shipment has been
transferred to another vehicle prior to delivery"_ (SOE p.24). Shipments are
`ShipmentResourceAssign`-ed to a trip and `Break`-ed from it. **`TripResourceAssign` carries the trip
numbers and no `CamisRegNumber` at all** (SOE p.28) — a trip-scoped fact with no shipment on it,
which is direct evidence that a trip is an entity in its own right. The agent cast is the fullest in
the corpus (Booker, OriginAgent, DestinationAgent, LoadAgent, UnloadAgent, Hauler, R19Agent,
RR19Agent, SITAgent, Driver, Tractor, Trailer), with role and ownership as **orthogonal axes**
(`Type` × `Owner` ∈ Corporate/Agent/Vendor). **R19 / RR19** is a modelled custody-and-performance
handoff: _an **authorized substitute agent** performs the pickup or delivery_, with its own
`R19AuthNumber`, its own agent resource, its own weight and its own charge codes (`R19`, `RR19`,
`BR19`, `HR19`) — SOE pp.16-17, ASC pp.2,5 — and `R19`/`R19Cancel`/`RR19`/`RR19Cancel` as
first-class events. `TypeOfMove` (GSD p.26) names the substitute-agent endpoints as **move
endpoints**: `R19 to Warehouse`, `Warehouse to RR19`, `R19 to Residence`, `Residence to RR19`.

**Buys:** the only van-line-native vocabulary for _why_ a shipment is split across vehicles; proof
that trip-scoped events exist; and — uncited in the previous revision and now load-bearing — the
best evidence in the corpus that **a movement performed by a substitute party is published as a
thing with its own authorisation number, its own party and its own weight** (§3.2).
**Costs:** **no stop entity with a sequence, no leg, and no consolidation view.** `LocationTypeNumber`
exists but is _"never documented as an ordinal"_. The decisive failure, in the analysis's words:
_**"a trip's other shipments are never expressed, so an agent cannot see the trip."**_ And
`CamisRegNumber` = shipment(6) + overflowSeq(2) + transferSeq(2) means **splitting a shipment mints
a new value of the same identifier** — identity is destroyed by a physical event. `Resources[]` is
current-state only; a replaced hauler _"will not be found in the shipment Resource group."_

### 2.10 "Ordered sequence, plan vs execution, no cargo" — `src:gtfs` (grade A)

`stop_sequence` values _"**must increase** along the trip but **do not need to be consecutive**"_
(1, 23, 40 is valid) — so a stop can be inserted without renumbering. **`block_id`** = _"a single
trip or many sequential trips made using the same vehicle"_ — vehicle continuity **above** the trip.
`Leg` = _"travel in which a rider boards and alights between a pair of subsequent locations along a
trip"_; `journey` = _"overall travel from origin to destination, including all legs and transfers
in-between"_. A **service day** _"may exceed 24:00:00"_.
**Buys:** the sequence-numbering rule, the block concept, and clean leg/journey definitions.
**Costs:** _no cargo on a trip_, so the trip↔shipment join — the whole problem — has no analogue.
Assignment is to a vehicle _class_, never a named driver or crew. Its `FULL_DATASET` overwrite is the
corpus's explicit counter-example on retraction ([shared §4.3](00-shared-decisions.md)).

### 2.11 The HHG operational sources: real vocabulary, no trip

- **`src:dp3-tender-of-service` (grade A):** the **hauling provider's legal name and US DOT number
  must be recorded against the shipment within 2 GBD of origin departure** (§B.3.f) — an assignment
  fact with a deadline, and, in its analysis's words, _"the only place in the corpus where the party
  actually performing must be named."_ **Double brokering is prohibited** (_"when a TSP assigns a
  shipment to a carrier who then brokers the shipment to another carrier"_). The **origin servicing
  agent** must be the _actual_ servicing rep, named in DPS before the pre-move survey, and an **MMC
  may not be named as the origin servicing agent** (§B.20). **TSP for Carriage** — the line-haul
  carrier that collects a lot **from** an NTS warehouse — is a named third party in the custody
  chain (NTS §1.6.10, §5.8). Delivery notification is a duty with a deadline and an escalation
  (§C.3.c-f). _Still: no vehicle, no route, no stop sequence, no consolidation._
- **`src:dtr-part-iv` (grade A):** **Diversion** = _"a change made in the route of a shipment while
  in transit"_, operationally a new destination **more than 30 miles** from the original,
  **excluding shipments already in SIT at destination** (#255; A-402 §E.1 p.21); the shipment keeps
  its identity and its BL and only the destination changes. A **Diversion Point** is a named,
  recorded location. **Termination and reshipment are a different operation**: a terminated shipment
  moving onward travels **on a new BL** (§E.4(4)(c); #596, #702). The **SIT control number** is
  9 digits — `YY` + Julian day of entry + a 4-digit sequence (A-406 §A.11 p.5) — and a split
  shipment gets one **per increment** (#662). _No trip, no leg sequence, no vehicle, no driver, no
  consolidation. The word "van" appears only in packing rules._
- **`src:dp3-400ng` (grade B):** **Stop off** = _"extra stops… made at locations necessary to
  accomplish the extra pickup or extra delivery of portions of the shipment. Extra stops are
  additional pickups made **after the first pickup** or additional deliveries made **prior to the
  final delivery**. Each such extra stop shall constitute an extra pickup or delivery"_ (Item 28.3),
  authorised in **block 13 of the BL**, with the rate computed over BPC miles from block 19 to block
  18 **via** the authorised stop-offs. **Shuttle Service** (Item 125) = a truck-to-truck transfer
  where linehaul equipment cannot access origin or destination, pre-approval required, with an
  enumerated cause list (building structure, inaccessibility by highway, inadequate/unsafe road,
  overhead obstructions, narrow gates, sharp turns, trees/shrubbery, roadway deterioration, the
  nature of an article). Item 27.3: delivery to an NTS facility makes **the facility the final
  destination** under that BL, and further movement is _"under separate BL/invoice"_. Item 4 Note 2:
  on duplicate reweighs, _"DPS must be updated with the **lower** of the net reweigh weights"_.
- **`src:cfr-49-375` (grade A):** the driver **must hold the BOL before the vehicle leaves the
  residence of origin** (§375.505(c)); the vehicle id(s) go **on the BOL** (§375.505(b)(9)); and
  §375.705 rates a shipment _"transported on more than one vehicle"_. **The previous revision used
  §375.705 as evidence that shipment identity survives custody changes and storage. It is not.** Its
  own analysis scores CFR at A3 C1=1 / C3=0, describes §375.705 as _"'transported on more than one
  vehicle' as a **charging** rule"_, and instructs: _**"Do not use this source for A3."**_ The
  citation is withdrawn and the claim it supported is re-grounded and re-rated in §3.2 and §7.

### 2.12 Small but load-bearing contributions

- **`src:nmfta-ebol`:** `trailerId` = _"the shipment is associated to a specific, **spotted
  trailer**"_; **`manifestId` = _"the shipment is associated to a manifest that includes multiple
  shipments, possibly across multiple spotted trailers"_**. A manifest is therefore **not** the
  equipment — one manifest can span several trailers.
- **`src:uncefact-rec24`:** the only published **custody** distinction in the corpus —
  **41 `Handed_over_under_continued_responsibility`** (_"under responsibility of the **same**
  transport operator"_) versus **349 `Handed_over`** (to **another** party). Plus 15 `Consolidated`,
  100 `Transshipment`, 131 `For_transfer_to_another_carrier`, 98/99 `Transferred_in`/`Transferred_out`,
  369 `Trip_plan_revised_manually`. Note the caveat carried from round 1: in the captured
  UN/CEFACT package these lists are bare enumerations; Rec 24 rev3 supplies the **names**, which is
  why these codes can be cited at all.
- **`src:smdg-delay-codes`:** a compact **vocabulary of plan changes to a multi-stop journey** —
  `ADHO` add an unplanned stop, `OMIT` drop a planned one, `ROTC` change the sequence, `BLNK` cancel
  the whole journey _"to the effect that each port call in the voyage is cancelled"_, `SLID` roll
  the work to the next scheduled trip, `CUTR` _"the vessel must sail at the scheduled time even if
  cargo operations are not completed"_, `BUNK` a stop _"only for bunkering, not for load+discharge
  operations"_ — a stop that exists for the vehicle's needs, not the cargo's.
- **`src:shippeo`:** the **(situation, justification) code pair** on every event — _"the event
  (milestone) is indicated by a pair of event codes"_ — with `LIV/MQP` delivered-but-short,
  `REN/MQP` refused-for-short, `REN/AVA` refused-for-damage, `REN/DAF` consignee-absent, which its
  analysis calls _"the most important single import"_ for HHG. `trigger.type` ∈ {manual, geofencing}
  is **required** on every outbound event, and **exactly 7 of the table's 38 rows are
  geofence-eligible — not one of them is an exception row.** (Corrected count, per
  [shared §5.2 M3](00-shared-decisions.md): the committed `event-list-order-level.md` is 40 lines —
  one header, one separator, **38 data rows** — of which 25 carry a justification other than `CFM`
  conform / `ARS` arrival / `DES` departure, and every one of those 25 is blank in the geofence
  column. "7 of 41" and "24 exception rows" were inherited approximations; the finding is
  unchanged.) A machine may assert _where a vehicle is_; it may never assert
  _why something went wrong_. Its own trap is instructive: `CON_LOAD`/`CON_UNLOAD` **are** marked
  geofence-eligible, letting a geofence crossing imply a clean outcome — which it cannot witness.
- **`src:macropoint`:** `TripSheet` (_"captures stop details on a load"_) is **required** on Create
  Order; `SequenceNumber` is _"the sequencial order of the stop. Typically used for round trip
  shipments"_. But `StopType` has **exactly two values**, `PickUp` and `DropOff` — no consolidation,
  no legs, no crew.
- **`src:milmove-mymove`:** no trip, vehicle, driver or crew anywhere. Its one real idea is the
  **diversion chain**: a rerouted shipment becomes a _new shipment_ linked by
  `divertedFromShipmentId`, with the gloss _"diverted shipments are all one single shipment, but
  going to different locations."_ A model forced to re-unify what its own structure split.

---

## 3. The decision

### 3.1 The shape

> **The stored spine is `Trip → Stop → StopAction`, with `ExternallyPerformedLeg` beside it for
> movements we do not perform. Nothing else in A3 is stored.**
> A `Stop` belongs to exactly one `Trip`. A `Shipment` never owns a `Stop`.
> A `Shipment` is joined to a `Trip` only through `StopAction`s — and everything else
> (consolidation, legs, the shipment's origin and destination, "who else is on this van",
> "which trips did this shipment ride") is **derived**.

```
Trip  ──1:N (ordered, sequence explicit)──▶  Stop
 │                                            │
 │ Assignment[]  (dated, typed, asserted)      │ 1:N
 │   hauling party · driver · co-driver        ▼
 │   power unit · trailer · crew member    StopAction  ──N:1──▶  Shipment
 │   each with: offered/accepted status,    (the join: one act type,          ▲
 │   performance status, assertedBy,         one stop, one shipment           │
 │   assertedHow, effective interval)        or one Portion of it)            │
 │                                              │                             │
 └──────────── derived: manifest ───────────────┘                             │
                                                                              │
ExternallyPerformedLeg  (shared §8.2; a party's undertaking, not a journey) ───┘
   performedBy · from / to · custodyBasis · authoritativeAsserter
```

**No `Custody` interval.** The previous revision hung
`Custody ──(interval, orthogonal to Trip)──▶ Shipment` off the spine, with `party · from · until ·
basis`. It is **deleted** ([shared §4.8](00-shared-decisions.md)): custody is a **projection** — the
named, versioned fold `custodyAt(goods, instant)` over the `FactResolved`-selected `handover`
assertions and over `ExternallyPerformedLeg.custodyBasis` (shared §4.8.3). Deleting it is what makes
the headline sentence above literally true: **nothing else in A3 is stored.** A3 loses no field — the
fold returns party, from, until, basis and evidencing act, computed rather than written, which is
A3's own `Leg` rule (§3.2) applied to the one derived thing the previous revision exempted from it.

**No `quantity` anywhere.** The previous revision put a quantity on `StopAction`. It is **deleted**
([shared §3](00-shared-decisions.md), §3.3 row 1): a quantity floating on an act is a measure with
no identity, so a second act cannot say _"the same part"_. Partiality is carried by the **`Portion`**
— the single sub-shipment grain for the whole model.

**No `result`.** The previous revision said a `StopAction` carries "a result" and never said what a
result was. It is replaced by the shared **`outcome` + `reasons[]`** factorisation
([shared §2](00-shared-decisions.md)), which is a **[SYNTHESIS]** of `src:shippeo`'s grid and
`src:open-trip-model`'s `result.status` — not an original design and not written up as one.

### 3.2 Definitions

**Trip** — _one vehicle journey performed by an assigned resource set: an ordered sequence of
stops, from the moment the plan is committed to the moment the last stop is completed._ A trip
carries **no goods**; it carries stops, assignments and a status. The trip is the unit of
**dispatch and cost**, never of revenue. Adapted from `src:open-trip-model` (trip as aggregate,
no goods, vehicle _optionally_ coupled) + `src:alvys-api` (the cost/revenue seam) + `src:samsara`
(start/end are an explicit, configurable rule, not an assumption — `routeStartingCondition` /
`routeCompletionCondition`).

> **A day of service performed at one place with no linehaul is a Trip with one Stop.** A pack-only
> day, a delivery-out-only day from a warehouse, a survey day. This closes former §6.3 and is
> **binding from [shared §8.4](00-shared-decisions.md)**. The **sourced premise is
> `src:open-trip-model`**, twice over: a Stop "models visiting a certain location at a certain time
> and potentially doing several other actions at that location" — no movement is required of it —
> and a Trip "is **optionally** coupled to a Vehicle that is/was driving this trip". **[ORIGINAL]:**
> the conclusion.
>
> _Citation corrected._ The previous revision also offered `src:dp3-400ng` Item 28.3 as a sourced
> premise. **It is not one and is withdrawn as support for this rule.** Item 28.3 defines a
> _stop-off_ — extra pickups "made **after the first pickup**" and extra deliveries "made **prior to
> the final delivery**", rated over BPC miles from block 19 to block 18 _via_ them — so every stop it
> describes lies on a linehaul route, which is exactly the thing the no-linehaul day lacks. What Item
> 28.3 does support, and all it supports, is the narrower premise that a service act performed at a
> place is **stop-shaped and rated as a stop**; it is re-cited for that in §3.1 and nowhere else.
>
> Consequence, and it is the point: **the trip's resource set need not include a vehicle.** A crew
> alone is an assigned resource set.

**Shipment** — _the goods of one customer moving under one bill of lading (or the counterparty's
single equivalent), with an identity that survives every vehicle, every re-plan and every custody
change._ A shipment exists before any trip and may exist for weeks with none. Its origin and
destination are **derived** from its acts **over stops and externally-performed legs alike**, and
are never stored (`src:alvys-api`: _"derived from the load's stops"_, extended to legs per
[shared §8](00-shared-decisions.md)). (A2 owns the shipment's internal structure; this decision
constrains only its identity, and only as follows.)

> **[ORIGINAL] — identity across physical splits.** _A physical event does not mint a new shipment
> identity._ `src:sirva-ade`'s identifier-minting (`CamisRegNumber` = shipment + overflowSeq +
> transferSeq) is **rejected**. **No source states this rule.** The previous revision claimed
> `src:cfr-49-375` §375.705 as support; that is a **charging** rule and its own analysis says _"do
> not use this source for A3"_ — the citation is **withdrawn** (§2.11, [shared §8.1](00-shared-decisions.md)).
> What the corpus actually supplies is (a) a negative: `src:milmove-mymove` splits and then has to
> re-unify (_"diverted shipments are all one single shipment"_), and `src:sirva-ade` destroys
> identity and then needs `TransferNumber`/`OverflowNumber` to put it back; and (b) a positive but
> **narrow** one: `src:dtr-part-iv`'s **diversion** keeps the shipment's identity _and its BL_, with
> only the destination changing (A-402 §E.1). Rated accordingly in §7 — **medium**, not high.
>
> **Scope, and the reconciliation with `fork-order` the critique demanded (cross-document conflict
> #4).** This rule is about **physical** events — a second vehicle, an overflow, a transfer, a
> shuttle. It says **nothing** about a **documentary** event. `src:dtr-part-iv` is explicit that a
> **terminated** shipment moving onward travels **on a new BL** (§E.4(4)(c)) and that diversion
> **expressly excludes shipments already in SIT at destination** (#255). So: `store-out` after an
> ordinary SIT stay names the same shipment as `store-in`; `store-out` after a **terminated** stay
> may not, and **A3 does not decide that** — it is an A2/A5 question and
> [shared §10.4](00-shared-decisions.md) leaves it open. What holds either way is that the **`stay`
> is an aggregate with its own identity** (shared §1.2, §7.4 — the DTR **SIT control number**), so
> the stay has an owner regardless of how the shipment boundary resolves — and _who held the goods_
> needs no owner at all, because it is not a stored thing: it is the fold
> `custodyAt(goods, instant)` ([shared §4.8.3](00-shared-decisions.md)) over published `handover`
> assertions. **There is no `Custody` interval to own**; shared §10.4 was restated the same way in
> the same revision. The previous revision's blanket "survives **every** storage interval" is
> withdrawn as over-broad.

**Stop** — _a visit to one place, at one position in one trip's sequence._

> **"One identified vehicle" is struck** ([shared §8.1](00-shared-decisions.md), and the critique is
> right that it was the most damaging single word in the document). The previous revision defined a
> Stop as _"a visit by one **identified vehicle** to one place"_ and called that "directly
> `src:dcsa`'s `TransportCall`." DCSA's call is by a **conveyance on a voyage**, polymorphic across
> four modes, and its truck variant merely **may** carry a `licencePlate`; `src:open-trip-model`
> says independently that a Trip _"is **optionally** coupled to a Vehicle"_. Neither source states
> the rule that was imported, and that rule is what made three of the nine scenarios inexpressible.
> **The vehicle and crew are `Assignment`s on the trip, not part of the stop's identity.**

A stop carries:

- an explicit **`sequence`** integer that **must increase along the trip but need not be
  consecutive** (`src:gtfs`), so inserting a stop never renumbers the plan;
- a **typed purpose** (§5.4, ORIGINAL), following `src:stedi-x12-reference`'s rule that a stop
  reason is **mandatory** (`S502`), and `src:dcsa`'s `facilityTypeCode` rule that the _role the
  place plays in this visit_ is a property of the visit, not of the place;
- a **stable identity that is never the sequence number** (`src:alvys-api`: _"never a positional
  index"_), with resequencing as its own record type (`StopResequenced`; `src:smdg-delay-codes`
  `ROTC`).

Two stops at the same place on one trip are two stops — this is exactly what
`transportCallSequenceNumber` exists for (`dcsa_domain L1547-1552`).

_The plan/actual pair is no longer a property of the Stop._ The previous revision gave the Stop _"a
plan/actual pair kept as parallel readings of the same record"_, citing Omnitracs's parallel
`*Actual` types. [Shared §4](00-shared-decisions.md) supersedes it: plan and actual are two
**Assertions** with the same fact key `(subject, type)` at different `basis` values, and a mutable current-state
field is forbidden on the envelope. Omnitracs's parallel-types observation survives as a _reading of
a source_, not as our shape.

**ExternallyPerformedLeg** — _a named party's undertaking to move goods between two places, where
we cannot see the vehicle, the trip or the stop sequence._ Adopted verbatim from
[shared §8.2](00-shared-decisions.md): `{legId, shipment | portion, performedBy, from/to,
custodyBasis, authoritativeAsserter}`, a first-class `subject`, in the stop canonical-subject
family. Acts are published against it exactly as against a stop. This is how an auto transporter's
delivery, an interline hauling agent's linehaul, a warehouse delivery-out crew that is not ours, and
a third-party shuttle are recorded. **Why it is not a phantom trip:** we are not modelling a journey
we cannot see; we are modelling the undertaking, which is the only part anyone is accountable for.
The HHG-native evidence is `src:sirva-ade`'s **R19/RR19** (an authorised substitute agent with its
own `R19AuthNumber`, its own resource, its own weight and its own charge codes) and
`src:dp3-tender-of-service` §B.3.f (the party actually hauling must be **named**, with a legal name
and a DOT number, within 2 GBD); `src:stedi-x12-reference` element 1650 supplies the interline
handover pair `J1`/`R1`; `src:dcsa`'s `eventLocation` is the precedent for a cargo event at a place
we have no call for. **[ORIGINAL]:** the aggregate itself and the rule that origin and destination
derive over legs as well as stops.

**StopAction (the join)** — _one act performed on one shipment (or on one `Portion` of it) at one
stop_, naming exactly one shipment-or-portion and exactly one stop. This is
`src:open-trip-model`'s `Action` with HHG verbs. **The verbs below are prose, not the vocabulary**
([shared §4.7](00-shared-decisions.md) note 5, [shared §10.1 item 20](00-shared-decisions.md)); the
record `type` is shared §4.7.1's spelling, and the mapping is:

| A3's prose verb                      | Record `type` (shared §4.7.1)                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pack`                               | **`packing`**                                                                                                                                                                                                                                                |
| `load`                               | **`loading`**                                                                                                                                                                                                                                                |
| `unload`                             | **`unloading`**                                                                                                                                                                                                                                              |
| `store-in`                           | **`storeIn`**                                                                                                                                                                                                                                                |
| `store-out`                          | **`storeOut`**                                                                                                                                                                                                                                               |
| `transfer-out` **and** `transfer-in` | **one `handover` type, asserted once by each side** — the `J1`/`R1` shape (shared §4.7's `handover` row), **not two types**                                                                                                                                  |
| `attempt`                            | **not a type at all** — an attempted delivery is `type = delivery` with `outcome = NOT_COMPLETED` and at least one reason (shared §2.5's **A-TYPE** forbids a type that names the outcome; shared §2.6 works this exact scenario, and so does §8 scenario 3) |
| `unpack`, `weigh`, `survey`          | **no shared §4.7.1 member yet.** Recorded as **absent and owed** at [shared §4.7.3](00-shared-decisions.md) and [`A8` §9 item 8](A8-authority-skeleton.md). **A3 does not mint one**, and must not: shared §4.7 is the only declaration.                     |

The membership is **an
entity with its own identity, not a foreign key** (`src:x12-212-trailer-manifest`: the 212's loop
0200 is _"not a list of shipment ids — each membership carries the shipment's weight on this
trailer, its marks, its dates, its carrier, and its loading sequence and physical position"_). A
`load` action carries the **loading sequence and position in the vehicle** (`TSD-01`/`TSD-02`).
**It carries no quantity and no result** (§3.1).

**Assignment** — _a dated, typed binding of a resource to a trip, which is itself an asserted
fact._ Not a foreign key. Modelled on `src:alvys-api` (`TripAssignmentRequest`: responsible party
required, physical resources optional; assign is separate from dispatch), `src:atlas-world-group-api`
(**two statuses per assigned service** — accepted vs performed; and offer/accept as **verbs**,
`PUT /Tonnages/request` + `/accept` — **column-name evidence, C2=1**: the _structural_ observation
that two lifecycles exist stands, the semantics do not), and `src:samsara` (`assignmentType` — _how_
the binding was asserted, fifteen ways). Regulation binds it: `src:dp3-tender-of-service` §B.3.f
requires the hauling provider's legal name and DOT number against the shipment **within 2 GBD of
origin departure**, and prohibits double brokering — so the assignment must name a _legal party with
an identifier_, and must record whether that party delegated. **An `Assignment` has an effective
interval**, which is how a driver change is expressed (§6.1).

**Leg** — **derived, never stored.** Two kinds, deliberately named apart:

- a **trip leg** is the movement between stop _n_ and stop _n+1_ on one trip (`src:open-trip-model`'s
  `Move`, `src:gtfs`'s `Leg`);
- a **shipment leg** is one continuous span in which one shipment is in one custody on one trip or
  on one `ExternallyPerformedLeg` — origin leg, linehaul leg, delivery-out leg (`src:dp3-400ng`'s
  _"delivery-out"_, `src:dcsa`'s `transportPlanStage` PRC/MNC/ONC as the naming precedent).
  Both are folds over `StopAction`s, `ExternallyPerformedLeg`s and `custodyAt(goods, instant)` — which
  is itself a fold and not a stored interval (`[SD §4.8.3]`). Storing them is
  how they come to disagree with the records. (Note the deliberate asymmetry: an
  `ExternallyPerformedLeg` **is** stored, because it is a party's undertaking and someone is
  accountable for it; a _derived_ leg is an inference from acts.)

**Custody** — **a projection, not an entity**: _the fold `custodyAt(goods, instant)`_ over the
`FactResolved`-selected **`handover`** assertions and over `ExternallyPerformedLeg.custodyBasis`
([shared §4.8](00-shared-decisions.md), §4.8.3). It is never stored, never asserted and never
corrected; it returns `{holder, basis, since, until, evidencedBy}` or `UNKNOWN`, and `UNKNOWN` is a
real outcome that is never filled in. The **basis stays exactly where it was — on the act** — and
distinguishes `src:uncefact-rec24`'s two codes: **41 continued-responsibility** (same operator — a
shuttle handing to that same agent's own linehaul van) versus **349 handed-over** (another party —
agent-to-agent interline, an R19 substitute agent, a `TSP for Carriage` collecting from an NTS
warehouse). Custody remains **orthogonal to the trip**: it changes _at_ stops and at leg boundaries
but is not a property of one. See §5.2 — **the fold is [ORIGINAL]; only the two-value basis is
sourced**, and Rec 24 supplies it as two status codes, **not as an entity**.

> _The previous revision made this a stored interval on the spine._ Shared §4.8 rejects that on A3's
> own terms: a `Leg` is _"a fold over `StopAction`s, `ExternallyPerformedLeg`s and `Custody`
> intervals. Storing them is how they come to disagree with the records"_ — and custody is a fold
> over the same acts, so it inherits the same verdict. A3 had applied its own rule to one of its two
> derived things and not to the other.

Custody _authority_ — whose assertions govern while they hold the goods — is **not settled here**: on
an `ExternallyPerformedLeg` it is the `authoritativeAsserter` field (shared §8.2), and the general
rule is [`A8`](A8-authority-skeleton.md)'s. **A8 now exists**, and the previous revision's "which does
not exist yet" is withdrawn: it supplies the hinge (**A8-MOVE** on `custodyBasis` 41 vs 349), the
instant rule (**A8-INSTANT**), and a per-fact-class role table for eleven classes. **But the cap has
moved rather than lifted** (shared §10.4): A8 §10's last row caps A8's own contribution at **medium**,
and only for the fact classes in its §5 — so a dependent claim may now be scored **medium**, may
still **not** be scored high, and gains **nothing at all** for a fact class shared §4.7 marks
**owed**. **No claim in §7 depends on it.**

#### Where each kind of fact lives — the envelope, applied

The critique's requirement was: _keep stop-, trip- and shipment-scoped records distinct, but express
them through the shared envelope._ Both halves are met, and the mechanism is
[shared §1](00-shared-decisions.md) plus **E-CANON** (shared §1.3, §4.3): each record `type` — which
_is_ its fact class, there being one classification axis and not two — declares exactly one canonical
**subject family**, a named closed set of aggregate kinds. Competing assertions pair on the **fact
key** `(subject, type, qualifier?)`, which is derived from fields the record already carries, never on
subject alone and never on a `context[]` member.

**The declaration is [shared §4.7](00-shared-decisions.md)'s canonical-subject table, and this table
cites it rather than restating it.** Revision 3 wrote the families here as "a singleton everywhere
except `stop = {stop, externallyPerformedLeg}`". Shared §4.7 note 2 makes it **three**: `stop =
{stop, externallyPerformedLeg}` (§8.2), **`goods` = {shipment, portion}** (shared §3.3 licenses a
separately-timed act to name a Portion directly), and `identity`, whose family is the **whole
`aggregate` enum** (shared §7.1). Every other family is a singleton. `goods` is the one A3 was
already relying on without naming: the split-delivery and overflow rows in §3.3 mint Portions and
then act on them. **Shared §4.7 outranks any per-document restatement, this one included**; the rows
below are A3's ancestor of that table, kept because they carry A3's own reasons, and where the two
ever differ §4.7 wins.

| The fact                                                       | `type` ([shared §4.7](00-shared-decisions.md))               | Canonical subject **family**                                          | `context[]`              | Why                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The vehicle arrived at / departed a stop                       | `arrival`, `departure`                                       | **`stop`** = {stop, externallyPerformedLeg}                           | trip, shipments on board | E-CANON's own worked example. A vehicle arrival is not about any one shipment.                                                                             |
| An act was performed on goods (load, pack, deliver, store-in…) | `loading`, `packing`, `delivery`, `storeIn`, …               | **`goods`** = {shipment, portion}                                     | stopAction, stop, trip   | Shared §2.6's worked form. The act is about the goods; the place is context. The **`portion`** member is what §3.3's split-delivery and overflow rows use. |
| The membership was offered / accepted / broken                 | `membershipOffer`, `membershipResponse`, `membershipRelease` | **`stopAction`** _(singleton)_                                        | trip, shipment           | §5.8's lifecycle. It is a fact about the _relation_, not about either end.                                                                                 |
| A resource was assigned / accepted / released                  | `assignmentOffer`, `assignmentResponse`, `assignmentRelease` | **`assignment`** _(singleton)_                                        | trip, resource           | `src:sirva-ade`'s `TripResourceAssign` carries trip numbers and **no shipment** — this record kind exists in a live partner contract.                      |
| The trip was delayed, resequenced, cancelled                   | `tripDelay`, `tripResequence`, `tripCancellation`            | **`trip`** _(singleton)_                                              | every shipment on board  | `src:smdg-delay-codes` `ADHO`/`OMIT`/`ROTC`/`BLNK` are journey-level plan changes.                                                                         |
| An externally-performed movement happened                      | _(the acts above, on the leg)_                               | **`externallyPerformedLeg`** — the second member of the `stop` family | shipment                 | Shared §8.2.                                                                                                                                               |

**This answers the critique's cross-document objection directly.** It said: _"the driver's app
asserts arrival at a **stop**; the destination agent asserts arrival of a **shipment**; a selection
rule keyed on (subject, milestone) never sees the two claims as competitors."_ That was correct
**only under a subject-keyed resolution rule**, which is not what the model adopts. Resolution keys
on the fact key, and `arrival` declares the **`stop` family** as its canonical subject.

**What happens to the destination agent's shipment-level phrasing — reject, not re-key.** Revision 3
wrote that the phrasing "resolves to that stop (shipment in `context[]`)". That reads as the
**boundary** re-keying a record onto a subject the asserter never named, and
[shared §4.6](00-shared-decisions.md) abolished it. Corrected, in three parts:

1. **The boundary refuses.** `shipment` is not a member of `arrival`'s declared family, so under
   **E-CANON-STRICT** the record _as phrased_ is **not admitted**: it acquires no `eventId`, is filed
   under no fact key and enters no contest. The boundary performs no substitution, no nearest-match
   and no best-guess. Naming the canonical subject is an **obligation on the asserter**, not a
   courtesy the catalog performs for them.
2. **Re-phrasing is an ingest-side act, and it is named.** Before submission, a **published,
   versioned subject-resolution rule** (`{ruleId, ruleVersion}`, the shape of `FactResolved.rule`)
   may re-phrase the claim onto its canonical subject — **and only if it returns exactly one
   candidate** (**E-CANON-RESOLVE**). The resulting Assertion is still the agent's: `assertedBy` and
   `assertedAt` remain theirs, `subject` is the stop, the shipment they actually named goes in
   `context[]`, their inbound message goes in `evidence[]`, and `capturedBy` is `PARTNER_ASSERTED`
   (or `KEYED_BY_PERSON` where a human operator supplied the stop). The claim is theirs; the
   resolution is ours; both are visible on the record.
3. **Zero or more than one candidate is a failure, not a tie-break.** Resolution fails, the
   submission is retained outside the catalog with the rule attempted and the candidate set it
   returned, and an **obligation is emitted to the asserting party** naming what it must supply
   (**E-CANON-OBLIGATION**). There is no fallback to recency, to the later stop, to the nearer
   geofence or to the stop whose planned window contains the asserted time — **A8-NAMED's ban on
   implicit last-writer-wins has a subject-side twin, and there is no implicit
   nearest-subject-wins either.**

**The `ExternallyPerformedLeg` half survives unchanged, and is not a fallback.** Where no stop of
ours exists, the leg is the other member of the same `stop` family, so it is a legitimate
**candidate** for the resolution rule and keys into the same contest rather than starting a second
one. What it is not is something the boundary reaches for when the stop is ambiguous. Both the
one-candidate and the **two-candidate** case are worked in §8, scenario 7 — the two-candidate case
being split delivery, which is A3's own worked shape (§3.3).

### 3.3 How each requirement is discharged

| Requirement                                                     | How the shape answers it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Several shipments on one van**                                | N shipments have `StopAction`s at stops of one trip. No concept added (`src:open-trip-model`). The trip's manifest is a **query over its stops' actions** — which is precisely the read `src:sirva-ade` cannot serve (_"an agent cannot see the trip"_).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Interleaved pickup and delivery**                             | Stop sequence is explicit and independent of which shipment is acted on. Shipment A may load at stop 1 and unload at stop 5 while shipment B loads at stop 2 and unloads at stop 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Split pickup / split delivery**                               | Several `load` acts for one shipment at several stops, each naming a **`Portion`** (shared §3) — _not_ a quantity. `src:dp3-400ng` Item 28.3 makes _"each such extra stop… an extra pickup or delivery"_, and `src:stedi-x12-reference` element 163 supplies `PL` Part Load / `PU` Part Unload as _stop reasons_. The 212's one-row-per-shipment membership **cannot** state this.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Overflow**                                                    | Two `load` acts naming two `Portion`s on **two different trips**. One shipment, two vehicles. `src:sirva-ade` names the operational case (and its `Overflow` event carries the portion's `Weight` and nothing else — a `MEASURED` Portion, exactly); its identifier-minting answer is rejected (§3.2, **[ORIGINAL]**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **SIT interruption**                                            | A `store-in` act at a warehouse stop on trip 1 ends the shipment's participation in trip 1. The shipment then has **no trip at all** for the storage interval. A `store-out` act at a warehouse stop on trip 2 (days or months later) resumes it; that trip may be a one-stop delivery-out day (§3.2) and may be performed by a different agent — or, if we cannot see their vehicle, by an `ExternallyPerformedLeg`. The delivery-out leg is derived. **The trip-discontinuity licence is [ORIGINAL] — see §5.1, which is this row's caveat.** (A5 owns storage duration, billing days, the permanent-storage boundary and the warehouse party; A3 owns only the two seam acts and the fact that the journey is legitimately discontinuous. The `stay` is its own aggregate with the DTR SIT control number as its identifier — shared §7.4.) |
| **Agent-to-agent custody handoff**                              | One **`handover`** type asserted once by each side (shared §4.7.1; the `J1`/`R1` shape) — the releasing side against trip 1, the receiving side against trip 2, or against an `ExternallyPerformedLeg` where the receiving party's journey is invisible to us — carrying `custodyBasis = 349 handed-over` (`src:uncefact-rec24`; `src:stedi-x12-reference` element 1650 `J1`/`R1`). **There is no `Custody` interval record**: who holds the goods is the fold `custodyAt(goods, instant)` over those assertions ([shared §4.8.3](00-shared-decisions.md)), and the basis rides on the act. A shuttle that hands to the same agent's own linehaul van publishes the same pair with `custodyBasis = 41 continued-responsibility`.                                                                                                               |
| **A shipment riding two successive trips stays one shipment**   | Shipment identity is independent of every trip. Two sets of `StopAction`s reference two trips. Nothing about the shipment changes. **[ORIGINAL]** — see §3.2's identity rule and its scope limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Diversion**                                                   | A plan change on the trip, not a new shipment — and here the source says so: `src:dtr-part-iv`'s diversion keeps the shipment's identity **and its BL**, changing only the destination. The stop is re-addressed or a new stop inserted (`src:smdg-delay-codes` `ADHO`/`OMIT`/`ROTC`); the **Diversion Point** is recorded as a stop. `src:milmove-mymove`'s new-shipment-plus-`divertedFromShipmentId` chain is **rejected** — its own gloss admits the split is an artefact. **Limit, stated because the critique required it:** DTR's diversion **excludes shipments already in SIT at destination**, for which DTR's route is terminate-and-reship on a new BL. That case is A2/A5's (§3.2).                                                                                                                                               |
| **A stop that happened but was never planned**                  | A stop asserted only at `basis = ACTUAL`, with no `PLANNED` assertion under the same fact key (`src:omnitracs-roadnet`'s `UnknownStop` / `DiversionStop` are the precedent for the _category_; the mechanism is shared §4, not a parallel type).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A stop for the vehicle, not the cargo**                       | A stop with a vehicle-purpose type and zero `StopAction`s (`src:smdg-delay-codes` `BUNK`; `src:omnitracs-roadnet`'s fuel / maintenance / layover / break stops).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A movement performed by a party whose journey we cannot see** | An `ExternallyPerformedLeg` (§3.2; shared §8.2). **New in this revision** — the previous shape could not express it, and it was the critique's must-fix #8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 3.4 The criteria weighted, and why

Beyond the crosscheck's instruction (C4 and C1 heavy, C5 and C7 discounted), four criteria decided
this, in order:

1. **Irreversibility, weighted highest.** The two candidate errors are not symmetric (§1). A model
   that over-normalises is repaired with a derived projection; a model that puts the stop on the
   shipment is repaired by re-keying every published record.
2. **Can a shipment exist for weeks with no trip?** This is the HHG requirement no trip-shaped
   source has ever had to satisfy (`src:open-trip-model` open question 2 states it outright: OTM
   _"never has to answer this because a consignment there is short-lived"_). **Only a
   non-owning join passes.** It eliminates every shipment-owns-stops position and every
   one-trip-one-load position at once.
3. **Can it answer "who else is on this van?"** The crosscheck records the operational failure in
   `src:sirva-ade` plainly. A van-line agent needs the manifest; a model where the trip is reachable
   only from one shipment cannot produce it. This eliminates any shape in which the trip is a child
   of the shipment — including `src:atlas-world-group-api`'s own `shipment-management-v1`
   serialisation, which its analysis diagnoses as _"an artefact of serving the trip filtered to one
   order."_
4. **Does the industry name consolidation, or only tolerate it?** It names it. **Four independent
   vocabularies**, not five: `CN Consolidate` is a _mandatory stop reason_ in X12 element 163;
   `manifestId` in the NMFTA e-BOL spans trailers; `HaulingSegmentType` is a van line's own word for
   it; Rec 24 code 15 is `Consolidated`. **`SMD Consolidated Shipment Manifest Data` is dropped from
   the count** — the critique is right that its three elements are *service level + method of payment
   - pick-up-or-delivery code*, so only the **segment's title** mentions consolidation. The criterion
     survives on four, and the count in the previous revision was inflated.

**What this document does _not_ decide, corrected.** The previous revision's closing paragraph said
C5 and C7 were taken "wholesale and without argument" as _"settled cross-cutting decisions
([crosscheck §Recommended order item 6])"_. **That claim is deleted; the critique is right that
crosscheck item 6 settles nothing — it names candidates and instructs that the decision be made
once.** It has now been made once, in [`00-shared-decisions.md`](00-shared-decisions.md), and it
went **against** two of the four things this document had adopted:

- **`src:alvys-api`'s `Eta {Planned, Live, Manual}` is rejected** (shared §4.5). The triple fuses two
  axes the model already carries separately: _Planned_ is `basis = PLANNED`; _Live_ is
  `basis = ESTIMATED` with `capturedBy ∈ {DERIVED_BY_RULE, DEVICE_TELEMETRY}`; _Manual_ is
  `basis = ESTIMATED` with `capturedBy = KEYED_BY_PERSON`.
- **`src:alvys-api`'s three-way `ArrivalRecorded` / `StopStatusChanged` / `Loaded` split is
  rejected** (shared §4.5). `ArrivalRecorded` is `assertedAt` on the arrival assertion — a clock,
  not a record; `StopStatusChanged` is forbidden, because state is a projection and a mutable
  current-state field is forbidden on the envelope; `Loaded` is an act record. Publishing all three
  double-counts every arrival. **A3 accepts this and withdraws its adoption**, including from
  §Cross-area, where it had been handed to A4 as settled.
- What survives from that paragraph: `capturedBy` on every assertion (shared §5.1, seven members,
  each traceable to a source including Omnitracs's `DataSource` — though **Omnitracs's
  `AssumedFromProjection` on a measured actual is now explicitly forbidden**, shared M1), and
  `assignmentType` on every binding (`src:samsara`), which is A3's own and is retained.

### 3.5 Explicitly rejected

| Rejected                                                                                     | Source                                                                                | Why                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop owned by the shipment                                                                   | `src:project44`                                                                       | Makes consolidation unaskable; its own analysis says so.                                                                                                                                             |
| Trip nested inside shipment                                                                  | `src:atlas-world-group-api` `shipment-management-v1`                                  | _"Inverts the real relation"_ — Atlas's own analysis.                                                                                                                                                |
| One trip = one load                                                                          | `src:alvys-api`                                                                       | Forecloses the single most important HHG A3 requirement.                                                                                                                                             |
| Membership with exactly one load stop and one unload stop                                    | `src:x12-212-trailer-manifest`; `src:project44`'s `Load` (_"exactly two stops"_)      | Cannot express split pickup, split delivery or part load — which `src:dp3-400ng` Item 28.3 and X12 element 163 both make first-class.                                                                |
| Splitting a shipment mints a new identifier                                                  | `src:sirva-ade` `CamisRegNumber`                                                      | A physical event must not destroy commercial identity. **[ORIGINAL]** — the previous revision's `src:cfr-49-375` §375.705 support is withdrawn (§2.11, §3.2).                                        |
| Diversion as a new shipment in a chain                                                       | `src:milmove-mymove`                                                                  | Re-unifies at read time what the model split at write time; `src:dtr-part-iv`'s diversion keeps the BL.                                                                                              |
| Rolling `Partially*` states instead of per-act outcomes                                      | `src:omnitracs-roadnet`                                                               | _"Collapses the very distinction we need"_ — origin services complete weeks before destination services.                                                                                             |
| Plan mutations (Add/Delete/Change) carried on the stop **status** enum                       | `src:omnitracs-roadnet`                                                               | CRUD verbs leaking into a state field. Keep `StopAdded` / `StopRemoved` / `StopResequenced` as record types (`src:alvys-api` `StopReordered`, `src:smdg-delay-codes` `ADHO`/`OMIT`/`ROTC`).          |
| Stop order implied by appointment time                                                       | `src:project44` (`stopNumber` _"ordered by appointment time"_)                        | `src:dcsa` `dcsa_domain L1547-1552`: a sequence number exists precisely because time-ordering fails for two calls at one place.                                                                      |
| Stop sequence used as stop identity                                                          | `src:x12-212-trailer-manifest` (`LX` ordinal); `src:sirva-ade` (`LocationTypeNumber`) | `src:alvys-api`: _"never a positional index."_                                                                                                                                                       |
| Trip as the invoicing unit                                                                   | `src:alvys-api` splits it correctly; recorded so it is not re-litigated               | Revenue is per shipment; the trip carries cost. Accessorials scope to the **stop** that caused them (`src:alvys-api` `StopId` on a detention charge; the X12 210's per-stop `S5` loop).              |
| Adopting Atlas's field names                                                                 | `src:atlas-world-group-api`                                                           | _"A database schema on the wire"_ — `ord_`/`stp_`/`lgh_`/`mfh_` prefixes leak a TMS. Adopt the **structure**, never the names.                                                                       |
| Treating an Atlas untyped string as free text                                                | `src:atlas-world-group-api`                                                           | It is _"a closed code list we cannot see"_ — the worse of the two errors. And after the supplement, the list is not merely unseen but **unpublished**, so it can never be resolved from this source. |
| **Directional stop types as an axis of the stop-purpose vocabulary**                         | `src:atlas-world-group-api` `/Estimating/Stop/Types`                                  | **New in this revision — the required engagement. Rejected, with an argument: see §5.4.**                                                                                                            |
| **A `quantity` on an act**                                                                   | previously A3's own                                                                   | A measure with no identity; a second act cannot name "the same part". Replaced by the `Portion` (shared §3).                                                                                         |
| **`Eta {Planned, Live, Manual}`; the `ArrivalRecorded`/`StopStatusChanged`/`Loaded` triple** | `src:alvys-api`                                                                       | Shared §4.5. See §3.4.                                                                                                                                                                               |

---

## 4. What this forecloses, and the cost if it is wrong

**Foreclosed by design:**

1. **`shipment.stops[]` as a read.** Every consumer that wants a shipment's itinerary joins through
   `StopAction` (and now through `ExternallyPerformedLeg` too). Mitigation, adopted deliberately:
   publish a **derived** shipment itinerary projection, following `src:alvys-api`'s rule that origin
   and destination are _derived, never stored_. The moment that projection is stored and writable,
   this decision is undone. A second discipline is required by the shared envelope
   ([shared §1.4](00-shared-decisions.md) rule 1): a consumer filtering by `subject` **must not** be
   served `context[]` matches by default, or the shipment-rooted envelope returns through the query
   layer.
2. **Trip-level revenue.** The trip carries cost. If the business later needs per-trip revenue (a
   consolidated load sold as one movement), that is a new aggregate, not a field. Recorded as a
   known future cost, not a defect.
3. **A "trip" that is not a resource journey.** A dispatcher's board, a warehouse's labour roster,
   a region's day — none of these are trips here. Note the boundary moved in this revision: a **pack
   crew's day with no vehicle and no linehaul _is_ a Trip** (§3.2), so the foreclosure is narrower
   than it was. `src:omnitracs-roadnet`'s Route (_"a set of planned work to be assigned to a
   driver"_) is still broader than this Trip on purpose; the broader reading would make "which trip
   is this shipment on" ambiguous.
4. **Answering "where is this shipment" from one row.** It is a fold: latest act, plus
   **`custodyAt(goods, instant)`** ([shared §4.8.3](00-shared-decisions.md)) for who holds it, plus
   the current trip's latest stop or the open `ExternallyPerformedLeg`. **The custody half was
   itself written as a stored interval in the previous revision; it is now a second fold, not a
   row** (shared §4.8), which makes the cost slightly larger and the drift risk smaller. This is a
   real ergonomic cost and the honest reason most vendor APIs do not do it.
5. **A single "miles" number.** `src:atlas-world-group-api` has four accumulators per stop
   (`stp_ord_mileage` / `stp_lgh_mileage` / `stp_mfh_mileage` / `stp_trip_mileage`) — **column-name
   evidence, C2=1** (§2.8): it establishes that a real van line separates them, not what each one
   means. Taken as an existence claim only, it is still enough to reject a single `miles` field, and
   distance becomes a set of accumulators, which is more expensive.

**If the decision is wrong, the cost is:**

- **If HHG consolidation turns out to be rare for our tenants** (the most plausible way to be
  wrong): we have paid a join on every read and a projection to serve the common case. Recoverable
  in a release. Note that this is unlikely to be _fully_ wrong — consolidation is the normal case
  for a van-line agent, and four independent vocabularies name it (§3.4 criterion 4).
- **If the act-per-shipment-per-stop grain is too fine** — i.e. if operations genuinely think in
  whole-shipment loads and never in partial ones: we have an action table with one row per load and
  one per unload where a membership row would do. Also recoverable; a membership is a view over two
  acts.
- **If `ExternallyPerformedLeg` turns out to be redundant** — i.e. if in practice we always learn
  the performing party's stop sequence: we have a second aggregate serving a case that a Stop with
  an optional vehicle would have covered. Cheap to collapse, because acts against a leg and acts
  against a stop have the same shape by construction (shared §8.2, canonical-subject family: stop).
- **If it is wrong in the other direction** — if we had put stops on the shipment — consolidation,
  the SIT interruption, split delivery, custody handoff and partial loads would each be
  individually unrepresentable, and the repair is re-keying the published catalog. **There is no
  recovery path.** This asymmetry is the decision.

**The known soft spot.** The layer between trip and stop — `src:atlas-world-group-api`'s
`mfh_number` / `stp_mfh_sequence` and `src:nmfta-ebol`'s `manifestId` _"across multiple spotted
trailers"_ — is **not** in this shape. Two real sources have it and this model treats the trip's
stop set as the manifest. If the manifest turns out to be a first-class thing our tenants dispatch
against (a load plan that outlives a trip, or spans two trailers), a layer must be inserted between
Trip and Stop. Inserting it later is a schema change to the spine, which is the most expensive
correction contemplated here. **And it now has no cheap remedy.** The previous revision proposed
fetching Atlas's `/Types` endpoints; there is no key in the repo, and the supplement records that a
complete capture of all 47 reachable endpoints _"would raise A3's and A5's [semantic precision] only
partially"_ because `mfh_number` and every operational stop axis carry no code-list binding at all.
The only things that can settle it are an Atlas or van-line **contact** and tenant dispatch
practice — both outreach, neither a fetch. §7 rates it accordingly.

---

## 5. ORIGINAL DESIGN — what household-goods moving needs that no source supplied

Each item below is asserted **without source support**. Where a source supplies a partial seed it
is named; the gap after the seed is ours. Items marked **[SYNTHESIS]** are joins of two sources and
are _not_ original design.

1. **[ORIGINAL] The SIT interruption as a legitimate trip discontinuity.** _(This is the caveat for
   §3.3's SIT row, which now points here rather than at §4.)_
   No source has a shipment that leaves a vehicle, holds **no journey at all** for weeks, and
   rejoins a _different_ vehicle. `src:open-trip-model` has no SIT and its `warehouse` location type
   is flagged as a trap. `src:omnitracs-roadnet`: _"a depot is a reload point"_, no goods rest.
   `src:alvys-api`, `src:samsara`, `src:project44`, `src:gtfs`, `src:x12-212-trailer-manifest`:
   absent. `src:atlas-world-group-api` comes closest — SIT hung off a stop, with `sit_stop_number`
   and `sit_xdl_stop_number` naming the cross-dock delivery-out stop — but that still assumes both
   stops sit in **one** plan, and it is column-name evidence (§2.8). **Ours:** `store-in` and
   `store-out` are acts on **two different trips**, separated by an interval in which the shipment
   has no trip. The A3 seam is exactly those two acts and the licence for the gap; A5 owns
   everything inside it, and the `stay` aggregate (shared §1.2) owns the interval's identity.

   **The Atlas "SIT is not a stop type" observation, engaged and answered deliberately** (required
   by shared §9 item 2 / §10.1.10, and the critique's must-fix #10). Atlas's _estimating_ vocabulary
   models storage as a **service at** an Origin or Destination stop, not as a stop of its own. We
   **agree with the observation and split the concept in two rather than inheriting either answer**:
   - **The storage itself is not a stop.** It is a **`stay`** — an aggregate with its own identity
     (`src:dtr-part-iv`'s SIT control number: `YY` + Julian day + intra-day sequence, one **per
     increment** of a split shipment), its own duration and its own warehouse party. A5 owns it.
   - **The warehouse _visit_ is a stop**, because a vehicle physically went somewhere, someone was
     paid for a stop-off, and accessorials anchor to the stop that caused them (§Cross-area, A7).
     Treating the visit as an attribute of a service would leave cartage, warehouse handling and the
     delivery-out stop-off with no anchor.
     **[ORIGINAL]:** the split. Atlas states the estimating side; DTR states the stay identifier; no
     source puts them together. The previous revision's error was not that it used a warehouse stop —
     it is that it made a warehouse **stop** the _entire_ SIT seam, with no stay, which is what the
     critique caught.

2. **[ORIGINAL] Custody as a fold, independent of the trip.**
   _(Restated from "Custody as a first-class **interval**" per [shared §4.8](00-shared-decisions.md)
   and [shared §10.1 item 23](00-shared-decisions.md). The claim moves; the evidence below does not,
   and it reads **better** against a fold than it ever did against an entity.)_
   `src:uncefact-rec24` supplies the only distinction that matters — code **41** handover under
   _continued_ responsibility versus code **349** handover to _another_ party — and supplies it as
   two status codes, **not as an entity**. `src:stedi-x12-reference` element 1650 supplies the
   interline pair `J1`/`R1` — also two codes, not an interval. `src:sirva-ade` models substitute
   performance (R19/RR19) as an _authorisation_, and explicitly discards history: a replaced hauler
   _"will not be found in the shipment Resource group."_ `src:dp3-tender-of-service` names a
   `TSP for Carriage` in the custody chain and prohibits double brokering, but models neither as an
   interval. **Every source publishes the acts and none publishes the interval.** **Ours:** the
   **fold** `custodyAt(goods, instant)` — party, from, until, basis, evidencing act — **computed**
   over the selected `handover` assertions and over `ExternallyPerformedLeg.custodyBasis`, answering
   across every trip, every externally-performed leg and every storage interval, and never stored.
   This is A3's own `Leg` rule applied to itself: _"Storing them is how they come to disagree with
   the records."_ Nothing A3 modelled is lost — the five fields are the five the fold returns — only
   their storage is. **Its authority consequence is _not_ claimed here** (see §3.2's closing note).

3. **[ORIGINAL] The shuttle as a trip in its own right.**
   `src:dp3-400ng` Item 125 defines shuttle service and enumerates its causes; no source models the
   shuttle vehicle as a second journey. `src:alvys-api`'s `LoadingType` ∈ {Live, Drop, Hook,
   Drop&Hook} is the nearest structural analogue and is about trailers, not about a second truck.
   **Ours:** a shuttle is a `Trip` with its own assignment, whose acts are `loading` at the
   residence and a `handover` at the transfer point — asserted once by each side, the releasing
   shuttle and the receiving linehaul trip (`[SD §4.7]`, the `J1`/`R1` shape), not two types — with
   `custodyBasis` usually `41 continued-responsibility` (same agent) and the 400NG cause
   carried as a `reason` on the trip. **Where the shuttle is a third party we do not dispatch, it is
   an `ExternallyPerformedLeg` instead** (shared §8.2) — new in this revision.

4. **[ORIGINAL] The stop-purpose vocabulary for household goods — and why it is one dimension, not
   two.**
   `src:stedi-x12-reference` element 163 gives the organising precedent — a **mandatory** stop
   reason, from a closed list, including `PL`/`PU`/`CN`/`TL`/`DT`/`WL` — and it is LTL-shaped and
   licensed, so it must be **cited by element number, never copied**. `src:omnitracs-roadnet`'s
   nine-member union is a fleet's vocabulary; `src:macropoint` has two values. No source names
   residence-pack, residence-load, residence-delivery, warehouse-in, warehouse-out,
   agent-facility-transfer, shuttle-transfer, weigh-loaded, weigh-empty, or attempted-service.
   **Ours**, with X12 163's _shape_ (closed, mandatory, one code per stop) and `src:dcsa`'s
   `facilityTypeCode` rule that it describes the **role the place plays in this visit**, not the
   place.

   **The Atlas directional-pairs observation, engaged — and rejected, with the argument stated**
   (required by shared §9 item 1 / §10.1.10; the critique was right that the previous revision
   omitted the one van-line-native stop-type vocabulary in the corpus). Atlas's observed
   `/Estimating/Stop/Types` are six values, every one qualified by which **end of the move** it
   belongs to: `Origin`, `Destination`, `Origin Extra Stop`, `Destination Extra Stop`, `Origin
Airport Stop`, `Destination Airport Stop`. The supplement calls the directionality _"a real
   modeling idea, and one the ideal model should weigh."_ Weighed, and **rejected as an axis of the
   stop's purpose**, for one reason:

   > **[ORIGINAL] Direction is shipment-relative, and a stop is trip-relative.** On a consolidated
   > van — the case this whole document exists for — the _same physical stop_ is an origin for
   > shipment A and a destination for shipment B. A directional stop type is only well-defined when a
   > stop belongs to exactly one order, which is exactly the shape Atlas's **estimating** API has
   > (an estimate for one order) and exactly the shape §3.1 rejects. Putting direction on the stop
   > would re-import the shipment-owns-the-stop assumption through the vocabulary after rejecting it
   > in the structure.
   > **What is adopted instead:** direction is **derived per (stop, shipment)** from the act — a
   > `load`/`pack` act makes that stop origin-side _for that shipment_, an `unload`/`unpack` act makes
   > it destination-side. Every Atlas value is then reconstructible at the grain where it is true
   > (`Origin Extra Stop` = a non-first origin-side stop for that shipment; `src:dp3-400ng` Item 28.3's
   > _"additional pickups made after the first pickup"_ is the same idea stated as a rating rule), and
   > the consolidated case does not break. **Standing of the source, stated honestly:** six values
   > observed in vendor worked examples, a lower bound, not a code list; and the supplement's own open
   > question 2 asks whether the endpoint also returns non-directional types. If it turns out to return
   > warehouse/SIT/transfer members too, the pairing is _not_ exhaustive and this rejection gets
   > easier, not harder — but that check cannot be run (Atlas is blocked), so the argument stands on
   > its own merits or not at all.

5. **[ORIGINAL] A vocabulary for physical position in the vehicle.**
   `src:x12-212-trailer-manifest` supplies `TSD-02 Position` and states that it is **"mutually
   defined"** — a slot with no vocabulary. Nose / mid / doors / deck / overhead / vault-number is
   ours to define, and we should, because it is what makes a load plan _checkable_.

6. **[ORIGINAL] The load-order invariant.**
   Nothing in the corpus states the physical rule that **what is loaded behind cannot be unloaded
   first**. `TSD-01` gives the data (_"the loading sequence and relative shipment position"_) and no
   source gives the rule. **Ours:** an invariant over a trip's acts, not a field — the reason
   `TSD-01` is worth carrying at all.

7. **[ORIGINAL] Crew as an assignment distinct from the driver.**
   HHG packs and loads with a crew that is frequently not the driver's and frequently the _agent's_,
   not the hauler's. `src:omnitracs-roadnet` has `Worker`/`WorkerType` (driver, helper) and
   `coWorkerIdentity`; `src:atlas-world-group-api` has `OnSiteStaffMember` with
   `onSiteStaffMemberLocations[]` binding named people to `stop_Number`s — the closest thing in the
   corpus, and **column-name evidence only: zero enums, zero property descriptions, A3 C2=1** (§2.8),
   so it establishes that a van line binds named people to stops and nothing about what the binding
   means. No source models crew as a trip- or stop-level assignment carrying its own employer.
   **Ours**, seeded by Atlas's shape and by nothing of Atlas's semantics. This is also what makes
   §3.2's vehicle-less Trip work: a crew is an assignable resource set.

8. **[ORIGINAL, seeded] The shipment-on-trip relation has a lifecycle of its own.**
   Carried as records whose `subject` is the **`stopAction`** (§3.2's table; shared §1.2 makes
   `stopAction` a subject kind precisely so this has a home), and distinct from both the trip's
   status and the shipment's status.

   **The lifecycle is three different things, and the previous revision wrote them as one arrow
   chain** — _"Offered → accepted → loaded → in-transit → unloaded"_. Split per
   [shared §4.7.2d](00-shared-decisions.md)'s closing paragraph and
   [shared §10.1 item 22](00-shared-decisions.md):

   - **offer / response / release are the membership records**, and they are the only ones whose
     subject is the `stopAction`: `membershipOffer`, `membershipResponse`, `membershipRelease`
     (shared §4.7.1). Accept and decline are not two records — they are the two `outcome`s of
     `membershipResponse`, because **A-TYPE** forbids a type that names the outcome. "Broken" is
     `membershipRelease`.
   - **`loaded` and `unloaded` are not membership transitions at all.** They are the **`loading`**
     and **`unloading`** act records on the **`goods`** family (shared §4.7.1), and republishing
     them as membership transitions is exactly the double-counting shared §4.5 rejects in the Alvys
     `ArrivalRecorded` / `StopStatusChanged` / `Loaded` three-way split. A3 already rejects that
     split at §Cross-area; it must not re-import it one table to the left.
   - **`in-transit` is not a record.** It is a projection, and shared §1.1 forbids a mutable
     current-state field on the envelope.

   `src:atlas-world-group-api` is the seed and it is on the wrong object: it puts **two statuses on
   every assigned service** — `<service>_cmpid_status` (accepted?) and `service_status` (performed?).
   **The structural observation stands; the semantics do not** (C2=1, §2.8 — every one of those
   status fields is an untyped nullable string with no code list). `src:alvys-api` has
   `Stops[].Status` referenced three times and **never enumerated anywhere**, so a stop state
   machine cannot be built from it either. **Ours:** that the _membership_ is an asserted-about
   relation with its own records. _(The previous revision said "the accept/**perform** split lifted
   from Atlas's services onto the trip membership and onto the assignment." **The perform half is
   withdrawn as a second lifecycle:** performance is the act rows above, on the goods, and Atlas's
   structural observation supports the existence of two statuses, not the publication of the
   performed one twice.)_ Note the shape constraint from the shared layer: these are **assertions**,
   not a mutable status column (shared §1.1).

   **Confidence note — the authority is owed and A3 does not fill it in.** The three membership
   `type`s are declared at [shared §4.7.1](00-shared-decisions.md), which marks their authoritative
   role **owed** against [`A8` §9 item 8](A8-authority-skeleton.md): A8 §5 has no membership row, and
   the provisional two-sided reading offered in shared §4.7.1 is **[ORIGINAL]** and is **barred from
   scoring a dependent decision at any level**. A3 has no answer of its own here and must not supply
   one. The same applies to the three `assignment…` types this item's assignment half relies on.

9. **[ORIGINAL] A trip-scoped record with no shipment on it is legitimate and publishable.**
   `src:sirva-ade` proves such records exist in practice — `TripResourceAssign` carries the trip
   numbers and **no `CamisRegNumber`** (SOE p.28) — but publishes them into a model with no trip
   entity and no way for an agent to see the trip. **Ours:** trip-scoped records are first-class in
   the catalog, with the trip as `subject`.
   _Correction: the previous revision added "adopt `src:omnitracs-roadnet`'s rule that every event
   declares the aggregate it belongs to — its region-filter table is exactly that statement."_
   **A filter table is a query facility; the citation is withdrawn** (shared §1.5). The
   envelope rule is authored, it lives in the shared layer, and A3 consumes it rather than claiming
   it.

   **Confidence note — the authority is owed and A3 does not fill it in.** The trip-scoped class is
   declared at [shared §4.7.1](00-shared-decisions.md) as three `type`s — `tripDelay`,
   `tripResequence`, `tripCancellation` — on `subject = trip`, and that row marks the authoritative
   role **owed** against [`A8` §9 item 8](A8-authority-skeleton.md): **A8 §5 has no trip row, and no
   source in the corpus binds a plan change to an asserting role.** The provisional reading shared
   §4.7.1 offers (the party dispatching the trip) is **[ORIGINAL]** and is **barred from scoring a
   dependent decision at any level**. `src:sirva-ade`'s `TripResourceAssign` proves such records
   **exist**; it says nothing about **who may assert** them, and A3 must not close that gap by
   inference. Note also that the row's `boundBy` is **owed** and is expressly _not_ `CUSTODY`: a plan
   change is not a fact about the goods, so shared §4.8's fold does not reach it.

10. **[ORIGINAL] "Who else is on this van" is a published read.**
    No source in the corpus offers a shipment-side view of a trip's manifest to a party who is not
    the carrier. `src:sirva-ade`'s analysis records the failure explicitly. Whether we _expose_ it
    to partners is §6.6; that the model can _answer_ it is a design commitment made here.

11. **[SYNTHESIS] `outcome` + `reasons[]` on every act.** Not original, and recorded here so it is
    not mistaken for original: it is `src:shippeo`'s (situation, justification) grid joined to
    `src:open-trip-model`'s `result.status` + 5.7 reason catalogue + 5.8 sub-results, per
    [shared §2](00-shared-decisions.md). A3 consumes it; A3 did not invent it, and the previous
    revision's unspecified "result" was the hole it fills.

12. **[SYNTHESIS] The `Portion` as the one sub-shipment grain.** `src:dp3-400ng` Item 17.13
    (enumerated: partial SIT withdrawal by inventory item number) + the same rule's _"actual weight
    of the portion withdrawn"_ (measured) + `src:sirva-ade`'s `Overflow` carrying only a `Weight` +
    `src:x12-212-trailer-manifest`'s `MAN` mark ranges. Per [shared §3](00-shared-decisions.md).
    A3's contribution is negative: it **deletes** the `quantity` field it had.

---

## 6. What only the user can decide

These are business, operational and commercial questions. Each changes the model if answered one
way and not the other; none can be settled from the corpus. **Two items that were here in the
previous revision are now closed** and are retained as closed entries so that cross-references to
§6.1 and §6.3 do not silently re-point.

1. **Is a driver change a new trip, or a new assignment interval on the same trip? — RESOLVED
   INTERNALLY: a new assignment interval.**
   The critique found the document contradicting itself — the prose said "one assigned resource set"
   (implying a new trip) while the structure gave `Assignment[]` an effective interval (implying a
   new interval). **The structure wins**, per [shared §10.1.13](00-shared-decisions.md), and §3.2's
   Trip definition is reworded to "an assigned resource set" accordingly. Reasons: an `Assignment`
   is already a dated, typed, asserted fact with a hauling party, so an interval is free; splitting
   the trip would renumber the stop sequence and break the `StopAction`s' stop references for no
   gain; and `src:gtfs`'s `block_id` shows vehicle continuity is normally modelled **above** the
   trip, not by minting trips. `src:alvys-api` does the opposite (a relay split **supersedes** a
   trip, with the superseded one addressable via `includeDeleted`) — that is a real alternative and
   it is rejected, not overlooked, because Alvys's trip carries exactly one load and ours carries
   many, so superseding a trip would disturb every other shipment on the van.
   **What remains a user question, and it is narrower:** how do the tenants actually dispatch a
   relay — does the second driver get a new dispatch document, and does the van line settle the
   linehaul as one movement or two? That is a settlement question (A13) with money attached, not a
   structural one. `src:atlas-world-group-api`'s two specs disagree about whether a trip has one crew
   assignment or many (the `Segment` layer exists in one and not the other), and that disagreement is
   **column-name evidence** and cannot settle anything (§2.8).

2. **Is there a manifest / load-plan layer between Trip and Stop?** — _the highest-cost open
   question._ `src:atlas-world-group-api` has `mfh_number` with its own `stp_mfh_sequence` and its
   own mileage accumulator (**column names, C2=1**); `src:nmfta-ebol`'s `manifestId` spans _"multiple
   spotted trailers"_ (a real, described field, and the stronger of the two). If the answer is yes, a
   layer must be inserted into the stored spine, which is the most expensive correction in §4.
   **There is no cheap resolution path.** The previous revision proposed the Atlas `/Types` fetch;
   **that plan is deleted** — no key exists in the repo, the inventory is 63 endpoints not ~35, and
   the supplement states that even a complete capture would raise A3's semantic precision only
   partially because `mfh_number` carries no code-list binding. Resolving it needs an Atlas or
   van-line **contact**, or observation of how a tenant dispatches a multi-trailer load.

3. **Is a local-move day with a pack crew and no linehaul a Trip? — CLOSED: yes, a Trip with one
   Stop.**
   Settled by [shared §8.4](00-shared-decisions.md) and no longer a user question. The critique's
   must-fix #9 is right that it was blocking: three high-confidence claims silently assumed the
   answer, A5's delivery-out leg needs it, and A7's "accessorials scope to the stop that caused
   them" leaves a packing charge with no anchor if the answer is no. Consequence carried into §3.2:
   **a Trip's assigned resource set need not include a vehicle**, which is `src:alvys-api`'s shape
   (responsible party required, physical resources optional) and `src:open-trip-model`'s (vehicle
   optionally coupled). The conclusion is **[ORIGINAL]**; the premises are sourced.

4. **On overflow, does the shipment keep one identifier?** This model says yes and rejects
   `src:sirva-ade`'s identifier-minting. But our tenants' billing and the van lines' settlement key
   off SIRVA's `CamisRegNumber`, whose overflow and transfer sequences _are_ the split. This is a
   decision with money attached and it is not ours to make unilaterally. (Note the shared layer
   softens the cost: identifiers are assertions at N per `(subject, scheme, vocabularyScope)` — rule
   **I-KEY**, shared §7.1 — with an effective interval, so carrying SIRVA's minted values _as_ identifiers of the one shipment is
   expressible without adopting their semantics.)

5. **What do we call the party that holds the vehicle when they differ?**
   `src:sirva-ade` says `Hauler`; `src:atlas-world-group-api` distinguishes `legHauler` from
   `carrier` from the agents (column names); `src:dp3-tender-of-service` says the TSP is _"solely
   responsible for the acts and omissions of any third party it contracts with"_ and prohibits
   double brokering. A8 will not settle this without a business ruling on which of these our tenants
   _are_.

6. **Do we publish trip-scoped records to partners at all, or only shipment-scoped ones?**
   `src:sirva-ade` publishes `TripResourceAssign` with no shipment id. Publishing trip-scoped records
   exposes the manifest — i.e. tells a partner which _other_ customers' shipments share a van. That
   is a confidentiality decision, not a modelling one. (The shared envelope makes it _expressible_;
   it does not make it _publishable_.)

7. **Who owns the stop sequence — us, or the dispatch system?** Tenants running Omnitracs or Samsara
   have a planner that owns the route. If the plan is theirs, our stop sequence is an inbound
   projection and resequencing records arrive rather than originate. `src:omnitracs-roadnet` also has
   no webhooks (polled `GET /events/{subscriber}`) and _"no clean idempotency key"_ — `eventHash`
   is undocumented.

8. **May a machine assert a stop arrival? — narrowed by the shared layer, one part left open.**
   [Shared §5](00-shared-decisions.md) settles the rule: `DEVICE_GEOFENCE` **may** assert arrival,
   departure, position and ETA change (M5, on five of `src:shippeo`'s seven geofence-eligible rows);
   it may **never** assert an exception or a possession-changing fact (M2, M3), and
   `ASSUMED_FROM_PLAN` may never carry `basis = ACTUAL` (M1). What is left for the user is narrower
   and operational: **do we accept a telematics feed as the asserter of record for arrivals at
   customer residences**, given that the geofence is around a house and the crew may park two
   streets away? That is a tolerance decision, not a modelling one.

---

## 7. Confidence

| Claim                                                                                                                        | Confidence                                        | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The stop belongs to the trip, and the shipment never owns a stop                                                             | **High — re-grounded**                            | **The DCSA "states the principle explicitly" support is withdrawn** (§2.2). What remains, and is enough: `src:open-trip-model` _defines_ a Trip as an aggregate of stops and actions that carries no goods and is only optionally coupled to a vehicle (`otm-api-v5.6.yaml:13672`), with a worked consolidated example; `src:omnitracs-roadnet`, `src:samsara`, `src:gtfs` and `src:atlas-world-group-api` all put stops on the route/trip structurally; and **both counter-examples self-diagnose** — `src:project44`'s analysis records that consolidation _"is not expressible"_, and `src:atlas-world-group-api`'s calls its own nesting an inversion and says _"do not model trip as a child of shipment."_ **Where I disagree with the critique:** it implies the rating should fall with the citation. It should not — the citation was decorative, not load-bearing. Removing one analyst's summarising sentence leaves five structural sources and two self-diagnosed counter-examples, which is a stronger evidentiary base than the sentence ever was. What _is_ conceded is that the previous revision leaned on the sentence rhetorically ("the single most important sentence in the corpus") and that was invention laundered as evidence. |
| A shipment must be able to exist with no trip                                                                                | **High**                                          | Forced by SIT, which is A5's best-covered area externally and which no trip-shaped source can hold. **No longer conditioned on an open user question** — the delivery-out day is a Trip with one Stop (§3.2, shared §8.4), so the store-out half has a home.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A shipment's identity survives **physical** splits, multiple vehicles and ordinary storage                                   | **Medium — [ORIGINAL]**                           | **Downgraded from High, and the `src:cfr-49-375` §375.705 support is withdrawn** (§2.11): it is a _charging_ rule and its own analysis says _"do not use this source for A3."_ What supports it is one narrow positive (`src:dtr-part-iv`: diversion keeps identity **and the BL**) and two negatives (`src:milmove-mymove` splits then re-unifies; `src:sirva-ade` mints and then needs three sequence fields to put it back). The rule itself is ours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The same identity survives a **terminated** stay and reshipment                                                              | **Not claimed**                                   | `src:dtr-part-iv` says a terminated shipment moves **on a new BL** (§E.4(4)(c)) and diversion _excludes_ shipments already in destination SIT. A2/A5's question (shared §10.4). The previous revision's "survives **every** storage interval" is withdrawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The join is an **act** (per shipment-or-portion, per stop) rather than a membership with two stops                           | **Medium**                                        | The corpus splits. Chosen on a domain requirement — split pickup and split delivery (`src:dp3-400ng` Item 28.3; X12 element 163 `PL`/`PU`) — not on a source. If operations never split, a membership would be simpler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `outcome` + `reasons[]` on every act; no quantity                                                                            | **High — but not A3's**                           | [Shared §2](00-shared-decisions.md) and [§3](00-shared-decisions.md), on two grade-A sources (`src:shippeo`'s published grid; `src:open-trip-model`'s `result.status` + 5.8 sub-results). A3 consumes it. Its own confidence is the shared layer's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Origin and destination derive over stops **and externally-performed legs**; `ExternallyPerformedLeg` exists                  | **High on the need; [ORIGINAL] on the aggregate** | [Shared §8](00-shared-decisions.md). The need is a live partner contract (`src:sirva-ade` R19/RR19 with its own auth number, party, weight and charge codes) plus a regulation (`src:dp3-tender-of-service` §B.3.f: the performing party must be named). Nobody publishes the constituents as one entity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Nothing else in A3 is stored (derived legs, manifest, itinerary)                                                             | **Medium**                                        | One strong precedent (`src:alvys-api`'s derived origin/destination) and a general argument that stored derivations drift. Not independently corroborated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| No manifest layer between Trip and Stop                                                                                      | **Medium-low, and now with no cheap remedy**      | Two real sources have one — `src:nmfta-ebol`'s `manifestId` (described, spans trailers) and `src:atlas-world-group-api`'s `mfh_number` (**column name only, C2=1**). This is the main reason overall confidence is not high, and it is the most expensive thing in §4 to get wrong. **The previous revision's resolution plan is deleted, not footnoted:** Atlas is blocked (no key in the repo) and its operational vocabulary is unpublished, so a capture could not settle it even if a key appeared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Direction is derived per (stop, shipment), not an axis of stop purpose                                                       | **Medium — [ORIGINAL]**                           | Argued against the one van-line-native stop-type vocabulary in the corpus (Atlas's six observed estimating values). The argument is structural (§5.4): a directional stop type presumes one order per stop. Standing of the contested source: six values from worked examples, a lower bound, C2=1 on the operational axes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| SIT = a `stay` aggregate plus stop-actions at warehouse stops (not a stop type, not a bare service)                          | **Medium — [ORIGINAL] split**                     | Engages Atlas's "SIT is not a stop type" observation (estimating enums, usable) and `src:dtr-part-iv`'s SIT control number. The split is ours; A5 owns the stay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Custody as a **fold** (`custodyAt(goods, instant)`, shared §4.8.3); SIT as a trip discontinuity; the shuttle as its own trip | **Low-to-medium — ORIGINAL**                      | No source supplies any of the three. Seeded by Rec 24's two codes + X12 1650's `J1`/`R1`, Atlas's stop-hung SIT (column names), and 400NG Item 125 respectively. Untested against any implementation. **The custody claim changed shape in this revision and not direction:** it was rated here as _"custody as an interval"_; shared §4.8 makes it a projection, and the rating is unchanged because the same two codes and the same `J1`/`R1` pair are the whole of its support either way — indeed they support a fold better, since both sources publish **acts** and neither publishes an interval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The stop-purpose vocabulary, the position vocabulary, the load-order invariant, the crew assignment                          | **Low — ORIGINAL**                                | Asserted. X12 163 and `TSD` supply the _shape_; the crew seed is Atlas column names; the values are ours and have never been validated against an operator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| The membership lifecycle (offered/accepted/performed)                                                                        | **Low-to-medium — ORIGINAL, seeded**              | Atlas's two-status-per-service is **structural evidence only** (C2=1): it shows a van line separates acceptance from performance, not what either state means. Alvys's `Stops[].Status` is never enumerated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Overall: medium-high on the structural fork (§3.1–§3.2), medium on the join grain and on shipment
identity, low on the original design in §5.** The structural fork is the irreversible part and it is
the part best supported; the original design is the reversible part and it is the part least
supported. That is the right way round, and it is the reason this shape is recommended rather than a
synthesis that scores better on paper. **Two ratings moved down in this revision** (shipment identity;
the confidence plan behind the manifest layer) and **one moved up in substance without moving on
paper** (the stop-ownership fork, re-grounded on structural evidence after its rhetorical support was
withdrawn).

**What would move confidence materially — and it is no longer cheap.**
The previous revision named two "cheap" items; one of them was refuted by material already in the
corpus at the time of writing. Corrected:

- **Deleted: fetch the Atlas `/Types` endpoints.** No `Ocp-Apim-Subscription-Key` exists anywhere in
  the repo; the inventory is 63 endpoints, not ~35; and the supplement's measured conclusion is that
  even a complete capture of the 47 reachable ones _"would not raise A4's semantic precision, and
  would raise A3's and A5's only partially"_, because the operational vocabulary is **not merely
  unfetched but unpublished**. **This remedy must not be proposed again for any A3 claim.**
- **Still open and still cheap: read TS 217 Motor Carrier Loading and Route Guide** — the one unread
  X12 set whose name suggests loading rules _and_ routing, flagged in
  `src:x12-212-trailer-manifest` open question 1 as the only candidate that might contradict the
  central finding that **no standard joins N shipments × M sequenced stops × one vehicle in a single
  document, and the reference model must supply that join itself.**
- **Not cheap, and now the only route to §6.2:** an Atlas or van-line **contact** on `mfh_number`, or
  direct observation of how a tenant dispatches a multi-trailer load. Outreach, not a fetch.
- **Not cheap, and the only route to §5.4/§5.5/§5.7:** an operator review of the stop-purpose,
  position and crew vocabularies. They have never been shown to anyone who loads a van.

---

## 8. Acceptance — the nine scenarios, run explicitly

Each scenario is stated, then expressed in the model, then marked **EXPRESSIBLE** /
**EXPRESSIBLE, with a named dependency** / **NOT EXPRESSIBLE HERE**. Where the previous revision
failed, the failure is named. Record shapes follow [shared §1](00-shared-decisions.md)'s envelope;
`subject` / `context[]` per §3.2's table.

### 1. Five families' goods on one van over four days — **EXPRESSIBLE**

One `Trip` with an ordered `Stop` sequence spanning four service days; five shipments, each with its
own `load` and `unload` acts at different stops. `sequence` increases and need not be consecutive
(`src:gtfs`), so a stop inserted on day 3 renumbers nothing. The van's manifest is a query over the
trip's stops' `StopAction`s — the read `src:sirva-ade` provably cannot serve. `TSD-01`/`TSD-02`
carry loading order and position, and §5.6's load-order invariant is checkable over them.

_The critique's objection here was internal contradiction, not inexpressibility:_ Trip said "one
assigned resource set" while `Assignment[]` had an effective interval. **Resolved in favour of the
structure** (§6.1): a driver change on day 3 is a **new `Assignment` interval on the same trip**, so
the four-day trip survives a relay intact and the other four families' stop references do not move.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **EXPRESSIBLE**

`store-in` act at a warehouse stop on trip 1. The shipment then holds **no trip** for six weeks — the
licence for that gap is **[ORIGINAL]**, §5.1. The interval itself is a **`stay`**, an aggregate with
its own identity (`src:dtr-part-iv`'s SIT control number, 9 digits, one per increment), owned by A5.
Six weeks later: a `store-out` act at a warehouse stop on **trip 2**, which is a **one-stop
delivery-out day** — a Trip whose assigned resource set is a crew and no linehaul vehicle (§3.2,
shared §8.4). Different agent: a **`handover` assertion with `custodyBasis = 349 handed-over`**
(`src:uncefact-rec24`) — _not_ a `Custody` boundary record, because there is no `Custody` entity
([shared §4.8](00-shared-decisions.md)); who holds the goods across the six weeks is the fold
`custodyAt(goods, instant)` over that assertion and the one before it — and the agent named on
trip 2's `Assignment`. **If that agent's dispatch is
invisible to us** — the usual case for a warehouse delivery-out crew that is not ours — the
delivery-out is an `ExternallyPerformedLeg` with `performedBy` = that agent and
`authoritativeAsserter` = the same, and the shipment still has a destination because origin and
destination derive over **legs as well as stops**.

_Previous failure, now fixed:_ this was rated **High** while silently depending on the open question
"is a delivery-out day a Trip?", and a different agent's crew could produce no Stop at all. Both are
closed. _Limit, stated:_ if the stay was **terminated** rather than ordinary, whether `store-out`
names the same shipment is A2/A5's (§3.2).

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **EXPRESSIBLE**

This is the scenario the previous revision could not express at all: `StopAction` carried "a result"
with no vocabulary and no item grain, so _"delivered, two items short"_ was neither a delivery nor a
non-delivery. The critique was right, and both sources that supply the missing shape were sources
this document already reads at grade A. Expressed per [shared §2](00-shared-decisions.md) and
[§3](00-shared-decisions.md):

```
Act  type=Delivery   subject=shipment:S   context=[stopAction:A1, stop:T1, trip:R7]
     basis=ACTUAL   capturedBy=KEYED_BY_PERSON
     outcome=NOT_COMPLETED
     reasons=[{ code=CONSIGNEE_ABSENT, scope=PARTY,
                attribution={roleClass: customer},
                remedy={newWindow: …} }]                      ← Shippeo REN/DAF + required new_slot

Act  type=Delivery   subject=shipment:S   context=[stopAction:A2, stop:T2, trip:R7]
     basis=ACTUAL   capturedBy=OBSERVED_BY_PERSON
     outcome=PARTIALLY_COMPLETED
     reasons=[{ code=REFUSED_DAMAGE, scope=GOODS,
                attribution={roleClass: carrier}, appliesTo=[portion:P1] },     ← Shippeo REN/AVA
              { code=SHORT,          scope=GOODS,
                attribution={roleClass: unknown}, appliesTo=[portion:P2] }]     ← Shippeo LIV/MQP
```

`P1` and `P2` are **`ENUMERATED` Portions** naming item refs — which is what makes the two short
items addressable again when they surface in the warehouse a week later, and what a quantity never
could. Two acts, not one, because they are two visits at two stops (shared §2.3 invariant 3). The
type names the **act**, never the outcome (**A-TYPE**) — `Delivery.Completed` is not a legal type
name, and the evidence is a published schema defect in `src:shippeo` itself.

### 4. A reweigh in transit — **EXPRESSIBLE, and not A3's to resolve**

A3 supplies the stop: `weigh` is a stop purpose (X12 element 163 `WL` Weigh Loaded is the shape
precedent), so a reweigh is an act at a stop on the trip and the scale's stop-off is billable against
that stop. The **resolution** of two competing net weights is [shared §4.4](00-shared-decisions.md):
both are Assertions at `basis = ACTUAL`, a reweigh is **not** a correction (the first weighing
occurred and was recorded correctly), and `FactResolved` names the rule — `R-WEIGHT-LOWER`, from
`src:dp3-400ng` Item 4 Note 2 (_"DPS must be updated with the **lower** of the net reweigh
weights"_), scoped as a DoD program rule and not promoted to a universal. Weight kinds stay typed
(`src:x12-212-trailer-manifest` element 187 `G`/`N`/`T` + `RG`/`RN`/`RT`). A3 asserts nothing about
which weight wins.

### 5. A car on a separate carrier, delivered a week apart — **EXPRESSIBLE**

The previous revision's clearest failure: a `Stop` required _one identified vehicle_ on one of our
trips, and origin/destination derived from `StopAction`s only, so an auto transporter's delivery was
unrecordable and **the car shipment had no destination at all**. Both halves are fixed
([shared §8](00-shared-decisions.md)): "one identified vehicle" is struck from the Stop definition,
and the car's movement is an `ExternallyPerformedLeg`:

```
ExternallyPerformedLeg  legId=L-12
  shipment    = the vehicle shipment (a second shipment under the same order — fork-order's call)
  performedBy = the auto transporter, named, with an identifier (shared §7)
  from / to   = the residence of origin  →  the destination residence
  custodyBasis        = 349 handed-over          ← src:uncefact-rec24
  authoritativeAsserter = the auto transporter   ← shared §8.2
```

Acts publish against the leg exactly as against a stop (`capturedBy = PARTNER_ASSERTED`), so the
delivery a week later is a `Delivery` act with `subject = shipment`, `context = [leg:L-12]`, and the
car shipment's destination derives. Sourced constituents: `src:sirva-ade` R19/RR19 (a substitute
performer published with its own auth number, party and weight), `src:dp3-tender-of-service` §B.3.f
(the performing party must be a **named legal party with a DOT number**), `src:dcsa`'s `eventLocation`
(a cargo event at a place with no call of ours). **The aggregate is [ORIGINAL].**

### 6. Cancelled after packing, before loading, materials charged — **EXPRESSIBLE in A3's part**

The pack day is a **Trip with one Stop** (§3.2; shared §8.4), so:

- the `pack` act exists, with `subject = shipment`, `context = [stop:P1]`, and an `outcome`;
- the shipment **has an origin**, because origin derives from acts and there is now an act;
- the packing-materials charge **has an anchor** — §Cross-area binds accessorials to _the stop that
  caused them_, and there is a stop;
- the cancellation of the onward movement is an act with `outcome = CANCELLED` (shared §2.2, from
  `src:open-trip-model`'s `cancelled`) on the load that never happened, or a trip-scoped cancellation
  (`src:smdg-delay-codes` `BLNK`) if the whole journey is called off.

**Named dependency, not A3's:** what a _shipment boundary that never acquires its bill of lading_ is
— `src:cfr-49-375` §375.505(c) means a move cancelled before loading normally has no BOL at all — is
`fork-order`'s §5.2 to answer (shared §10.2 item 9 says so explicitly). A3 supplies the stop, the
act, the origin and the charge anchor; it does not define the shipment boundary.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **EXPRESSIBLE**

The critique's sharpest cross-document point: A3 keeps stop-scoped and shipment-scoped records
distinct and _"must not be fused"_, so _"a selection rule keyed on (subject, milestone) never sees
the two claims as competitors."_ **The inference is correct about a subject-keyed rule and the model
does not use one.**

```
Assertion  type=arrival  subject=stop:T9  basis=ACTUAL  value=14:05
           assertedBy={driver, role: driver}   capturedBy=DEVICE_GEOFENCE

Assertion  type=arrival  subject=stop:T9  basis=ACTUAL  value=14:40
           assertedBy={agent, role: destinationAgent}  capturedBy=KEYED_BY_PERSON
           context=[shipment:S]

           → both have the same derived fact key ( stop:T9 , arrival ), which is
             what makes them competitors rather than two unrelated records

FactResolved  factRef=( stop:T9 , arrival )  subject=stop:T9
              selected=<one of them>  considered=[both]  rule={ruleId, ruleVersion}
```

_(Shape per shared §1.3: one classification axis, so `type` **is** the fact class; one `subject`, the
envelope's; and the fact key `(subject, type, qualifier?)` is derived rather than carried in a
`factRef` object. Only the meta-record spells `factRef` out, because its own `type` names its record
class.)_

Two mechanisms do the work, both from the shared layer: **pairing runs on the fact key, never on
subject alone** (shared §1.4 rule 3, §4.3), and **E-CANON** declares `arrival` to have the **`stop`
family** as its canonical subject.

**How the agent's record came to be phrased on `stop:T9` — and it was not the boundary that did it.**
Revision 3 wrote that the shipment-phrased claim "resolves onto the stop… rather than becoming a
second, unpairable fact", which reads as boundary re-keying. [Shared §4.6](00-shared-decisions.md)
abolished that reading, and §3.2 above states the correction in full. Applied here:

- **The agent's submission, as phrased, is refused.** `subject = shipment:S` is not in `arrival`'s
  family, so **E-CANON-STRICT** does not admit it: no `eventId`, no fact key, no contest. The
  boundary substitutes nothing.
- **A named, versioned subject-resolution rule re-phrases it _before_ submission** — an
  **ingest-side** act, **[E-CANON-RESOLVE]**, and only where the rule returns **exactly one**
  candidate stop. That is the record shown above: `subject = stop:T9`, `context = [shipment:S]`,
  `assertedBy` still the agent's, `assertedAt` still when _they_ said it, their inbound message in
  `evidence[]`, `capturedBy = PARTNER_ASSERTED` (or `KEYED_BY_PERSON` where an operator supplied the
  stop). The claim is theirs; the resolution is ours; both are on the record.
- **Where no stop of ours exists**, the `ExternallyPerformedLeg` is the other member of the same
  family and is therefore a legitimate **candidate** for that rule, keying into the same contest. It
  is not a fallback the boundary picks when the stop is unclear.

**The two-candidate case, which is A3's own worked shape.** Shipment S is **split-delivered** on this
trip: stop T4 takes the first Portion, stop T9 the balance (§3.3's split-delivery row). The agent
keys "shipment S arrived" with no stop named. The resolution rule returns **two** candidates, T4 and
T9, and **fails on cardinality**. It does not fall through to the later stop, to the nearer geofence,
to recency, or to the stop whose planned window contains the asserted time. The submission is
retained outside the catalog with both candidates recorded, and an **obligation is emitted to the
destination agent to name the stop** (**E-CANON-OBLIGATION**).

**And the contest runs without it.** `FactResolved` over `(stop:T4, arrival)` and `(stop:T9,
arrival)` considers the driver's two geofence assertions and selects under
`AUTHORITATIVE-ROLE-AT-INSTANT` ([`A8` §5 row 1](A8-authority-skeleton.md)). The agent's claim is
**not** in `considered[]` — `considered[]` names every assertion _in_ the contest, and this one never
entered one. That absence is honest and is itself queryable through the obligation. When the stop is
supplied, a **new** Assertion is minted with the agent's own `assertedBy`/`assertedAt`, and
`FactResolved` for `(stop:T9, arrival)` is **republished** over the enlarged `considered[]`.
Append-only throughout. **The successful and the failed path produce the same kind of record** — one
behaviour with a cardinality gate, not two behaviours.

_(The symmetric case is A3's too and is settled the same way: a driver's app naturally phrases
`delivery` against the stop it is standing at, and `delivery`'s family is `goods`, so that record is
refused in the opposite direction. E-CANON is not a rule about partners being sloppy.)_

`capturedBy` is retained on both, so the geofence claim is visibly machine-captured — and under
shared M5 a geofence **may** assert an arrival, while under M2/M3 it could not have asserted the
delivery or any exception. A3's "three kinds must not be fused" survives intact: they are three
**subject kinds**, not three resolution universes.

### 8. A mid-journey custody handoff — **Expressible — dwell classification deferred to A5, custody authority deferred to A8**

One **`handover`** type asserted once by each side (shared §4.7.1) — the releasing side against a
stop on trip 1, the receiving side against a stop on trip 2 — each carrying
**`custodyBasis = 41 continued-responsibility`** (same operator — a shuttle to that agent's own
linehaul) or **`349 handed-over`** (another party), with the X12 element 1650 pair `J1` Delivered to
Connecting Line / `R1` Received from Prior Carrier as the industry's own two-sided vocabulary — which
is exactly why it is **one type asserted twice, not two types**. **There is no `Custody` boundary
record**: who holds the goods is the fold `custodyAt(goods, instant)`
([shared §4.8.3](00-shared-decisions.md)) over precisely these two assertions, and the basis stays on
the act. Where the receiving hauler's journey is invisible to us, the second half is an
`ExternallyPerformedLeg` rather than a trip — which is the common interline case, was unrecordable
before, and whose declared `custodyBasis` is the fold's other input.

**The thin part, stated rather than hidden** (the critique's objection): goods **dwelling on a
cross-dock overnight between two trips** sit inside an interval with no trip. The model permits that
— a shipment may hold no trip (§3.4 criterion 2) — and the fold `custodyAt(goods, instant)` answers
_who holds them_ across the dwell, without an entity and without naming the dwell. **Where only one
of the two handovers has been published the fold returns `UNKNOWN`, and `UNKNOWN` is never filled in**
(shared §4.8.3 rule 3) — which is a more honest answer than an open interval, not a weaker one. What
A3 does **not** supply is _what the dwell is_. Two answers are available and A3 chooses
neither: if the dwell is billable or bounded, it is a **`stay`** (shared §1.2, with DTR's control
number as the identifier) and A5 owns it; if it is incidental, it is simply the gap between the
releasing and receiving `handover` assertions, with no entity. **[ORIGINAL] position:** A3 asserts only that the
gap is legitimate and that custody covers it; naming the dwell is A5's, and forcing it into SIT here
would pre-empt A5's storage boundary. This is a smaller gap than the critique described (custody is
covered; the interval is not nameless, only unclassified) but it is a real one.

**Custody authority is still not claimed here** (cross-document conflict #7): whose assertions govern
during the handoff is [`A8`](A8-authority-skeleton.md)'s, except on an `ExternallyPerformedLeg`,
where `authoritativeAsserter` answers it (shared §8.2). **The deferral is refreshed, and the cap has
moved rather than lifted.** A8 **now exists** — it supplies the hinge (**A8-MOVE** on `custodyBasis`
41 vs 349, read off exactly the two `handover` assertions above), the instant rule
(**A8-INSTANT**), and a per-fact-class role table for eleven classes, which
[shared §4.7](00-shared-decisions.md)'s authority column quotes. **But A8 §10's last row caps A8's
own contribution at _medium_, and only for the fact classes in its §5** (shared §10.4): a dependent
decision may now be scored **medium**, may still **not** be scored high, and gains **nothing at all**
for a fact class shared §4.7 marks **owed**. No §7 rating depends on it either way. _(What custody
**is** is no longer open: shared §4.8 settles it as a projection. What remains open is whose
assertions win.)_

### 9. A partial load under one bill of lading — **EXPRESSIBLE, and the four-way conflict is closed**

Two `load` acts at two stops, each naming a **`Portion`** of the one shipment; the bill of lading is
unchanged, because **minting a Portion is not splitting a shipment** (shared rule **P-IDENTITY**).
The first Portion may be `MEASURED` only — the crew knows the weight and not the contents, which is
`src:sirva-ade`'s `Overflow` event exactly (it carries a `Weight` and nothing else) — and may become
`ENUMERATED` later **without changing its `portionId`** (rule **P-MEMBER**). Portions may overlap and
nest (**P-OVERLAP**), which is what makes "the twelve items that went into SIT" and "the three of
those refused on delivery-out" both expressible.

_The critique's cross-document conflict #3 — one phenomenon, four models — is closed by deletion on
A3's side:_ the `quantity` on `StopAction` is **gone**; `fork-order`'s divergence-only weighed
Portion is replaced by the shared one; `fork-time`'s `item` subject survives as a subject kind and as
an `ENUMERATED` Portion of one; `src:open-trip-model`'s 5.8 sub-results are expressed as
`reasons[].appliesTo` refs rather than nested inside a published record. Sourced as
[shared §3](00-shared-decisions.md) marks it — **[SYNTHESIS]**, with the one-entity-two-forms join
authored. _(Which of `item` and `Portion` to reach for is not a matter of taste: shared §5.4 gives
the test — a value **per article** is an `item`-subject assertion, a **scope of an act** is a
Portion, even a Portion of one.)_

**Score: nine stated, nine expressible**, three with named dependencies that belong elsewhere
(scenario 6's shipment boundary → `fork-order`; scenario 4's weight resolution → shared §4.4;
scenario 8's cross-dock dwell → A5, with custody authority → A8). In the previous revision, five of
the nine failed.

| #   | Scenario                    | Status                                                                                  |
| --- | --------------------------- | --------------------------------------------------------------------------------------- |
| 8   | Mid-journey custody handoff | **Expressible — dwell classification deferred to A5, custody authority deferred to A8** |

_(Scenario 8's status cell uses the common label fixed at [shared §10.5](00-shared-decisions.md),
because the three documents were saying the same thing in three different words — "expressible",
"partial" and "yes, with a deferral" — and a reader comparing the scoreboards could not tell that
they agreed.)_

---

## Cross-area consequences to record

- **A2 (shipment structure)** — this decision constrains shipment _identity_ only, and only against
  **physical** splits (§3.2, **[ORIGINAL]**). The documentary boundary — whether a new bill of lading
  means a new shipment — is **not** A3's, and A3 makes no claim about the terminated-stay case. The
  order↔shipment cardinality fork is `fork-order`'s.
- **A4 (execution events)** — the envelope is **not A3's to hand over**: it is
  [shared §1](00-shared-decisions.md). What A3 contributes is the **canonical-subject table**
  (§3.2): stop-scoped, trip-scoped, stopAction-scoped, assignment-scoped and shipment-scoped records
  are distinct kinds and must not be fused — expressed as distinct `subject` kinds, with pairing on
  the derived fact key `(subject, type, qualifier?)` (shared §1.3), which is one axis and not two.
  **Withdrawn from the previous revision:** the Omnitracs region-filter citation for the
  envelope rule (shared §1.5), and `src:alvys-api`'s `ArrivalRecorded` / `StopStatusChanged` /
  `Loaded` three-way split, which shared §4.5 rejects as double-counting every arrival. The A4 reason
  vocabulary's **shape** is shared §2.4; its **content** is A4's.
- **A5 (storage-in-transit)** — A3 hands A5 exactly two seam acts (`store-in`, `store-out`), the
  guarantee that a shipment may hold no trip, and the one-stop delivery-out Trip. It also hands A5 a
  question it must answer rather than inherit: **the storage is a `stay`, the warehouse visit is a
  stop** (§5.1's split, **[ORIGINAL]**, engaging Atlas's "SIT is not a stop type" observation). Stay
  identity is published — `src:dtr-part-iv`'s SIT control number, one per increment. Duration,
  billable days, re-entry, the delivery-out service and the permanent-storage boundary are A5's.
  **One constraint A5 inherits rather than chooses** ([shared §5.3](00-shared-decisions.md)): the
  `storeIn` **act** and the `sitEntryDate` are two record types, not one. The act is witnessed by
  whoever performed it (M2); the date is computed from the TSP's first available delivery date and
  is mandatorily `DERIVED_BY_RULE` (M4). 400NG Item 29.6 / 17.20 and DTR §D.5.b(2) both exist
  precisely to stop an observed date being filed as the accrual date, so A5 may not collapse them
  back into one.
- **A7 (charges)** — accessorials scope to the **stop** that caused them (`src:alvys-api` `StopId` on
  a detention charge; the X12 210's per-stop `S5` loop; `src:dp3-400ng`'s extra-stop rating over BPC
  miles _via_ the authorised stop-offs). The stop must therefore be stable and addressable from
  billing, which reinforces "never a positional index." **Now unblocked:** because a pack-only day is
  a Trip with a Stop, a packing-materials charge on a cancelled move has an anchor. Charges against
  an externally-performed movement anchor to the `ExternallyPerformedLeg` — `src:sirva-ade` already
  bills R19/RR19 that way (`R19`, `RR19`, `BR19`, `HR19`).
- **A8 (parties)** — `Assignment` is where role lives, on the assignment and never on the party
  (`src:sirva-ade`'s orthogonal `Type` × `Owner`; `src:alvys-api`'s `TenderAs`). Assignment history
  must be retained — `src:sirva-ade` explicitly discards it and says so. **A8 owes A3 one rule A3
  cannot supply:** whose assertions govern while a party holds the goods (custody authority,
  cross-document conflict #7). [`A8`](A8-authority-skeleton.md) now supplies it — A8-MOVE evaluated
  per A8-INSTANT, over the eleven fact classes in its §5 — so the debt is discharged for those
  classes and open for the rest. **The cap moved rather than lifted:** A8 §10 rates its own
  contribution `medium`, so an A3 claim resting on it may be scored medium and no higher, and a
  class A8 §5 leaves **owed** still carries no rating at all.
- **A9 (identity)** — equipment identity is **owner-scoped**: `MS2` pairs an owner SCAC with an
  owner-assigned equipment number, so trailer `12345` is unique only inside its owner's numbering
  (`src:x12-212-trailer-manifest`). Carrier attribution is at _shipment_ grain and **time-scoped**
  (`BLR` + `BLR-02` effective date) — a single `shipment.carrier` field cannot express interline.
  **Both requirements are now met by [shared §7](00-shared-decisions.md)**, which makes an identifier
  an Assertion with a `vocabularyScope`, an effective interval and every aggregate grain — including
  the `trip` grain A3 needs (`src:sirva-ade` carries `QPDTripNumber` **and** `CamisTripNumber` for one
  trip) and the `resource` grain equipment needs.

---

## 9. Changed in revision (round 2 → this document)

**Citations withdrawn** (the critique's "invention laundered as evidence" finding; all four are
withdrawn in full, not softened):

1. **`src:dcsa` "states the principle explicitly"** — _"cargo events reference the call; they never
   contain the journey"_ is the **analyst's** summarising clause in `dcsa/analysis.md` (line 195),
   carrying no line citation while every neighbouring DCSA quote carries one. §2.2 records the
   withdrawal; §7 re-grounds the stop-ownership rating on structural evidence and **argues that the
   rating should stay High** — a disagreement with the critique, stated as one.
2. **`src:cfr-49-375` §375.705** for shipment identity across custody changes and storage — a
   _charging_ rule whose own analysis says _"do not use this source for A3."_ §2.11, §3.2, §3.5.
   The claim is now **[ORIGINAL]**, narrowed to physical splits, and **downgraded to Medium**.
3. **`src:omnitracs-roadnet`'s region-filter table** as the source of a catalog-wide envelope rule —
   a filter table is a query facility (shared §1.5). §2.5, §5.9.
4. **"Settled cross-cutting decisions [crosscheck item 6]"** — crosscheck item 6 settles nothing; it
   names candidates and instructs that the decision be made once. §3.4.

**Claims re-cited or re-rated:**

5. **Atlas A3 C2: 2 → 1**, with every Atlas-derived element (manifest layer, accept/perform
   lifecycle, crew, mileage accumulators) re-marked as **column-name evidence** at its point of use:
   §2.8, §4.5, §5.7, §5.8, §6.2, §7.
6. **The "cheap confidence plan" (fetch Atlas `/Types`) is deleted**, not footnoted — no key in the
   repo, 63 endpoints not ~35, and the vocabulary is unpublished rather than unfetched. §4 (soft
   spot), §6.2, §7.
7. **§3.4 criterion 4: five vocabularies → four.** `SMD Consolidated Shipment Manifest Data` is
   dropped; only the segment's title mentions consolidation.
8. **§3.3's SIT row now points at §5.1's ORIGINAL caveat**, not at §4.

**Shape changes required by [`00-shared-decisions.md`](00-shared-decisions.md):**

9. **Envelope adopted wholesale** (shared §1). A3 keeps the stop/trip/shipment distinction and now
   expresses it as distinct `subject` kinds, with a canonical-subject-family table added at §3.2 and
   pairing on the derived fact key `(subject, type, qualifier?)` (shared §1.3).
10. **"One identified vehicle" struck from the `Stop` definition** (shared §8.1). §3.2.
11. **`ExternallyPerformedLeg` added** (shared §8.2), and origin/destination now derive over **stops
    and legs**. §3.1, §3.2, §3.3, §7, scenarios 2/5/8.
12. **`quantity` deleted from `StopAction`; the `Portion` adopted** (shared §3). §3.1, §3.3, §5.12.
13. **`outcome` + `reasons[]` added; A-TYPE adopted** (shared §2) — the type names the act, never the
    outcome. §3.1, scenario 3. Marked **[SYNTHESIS]**, not original.
14. **`Eta {Planned, Live, Manual}` and the `ArrivalRecorded`/`StopStatusChanged`/`Loaded` triple
    rejected** (shared §4.5). §2.7, §3.4, §3.5, §Cross-area. The Stop's "plan/actual parallel
    readings" is likewise replaced by two Assertions at different `basis`.
15. **Former §6.3 closed: a pack-only or delivery-out-only day is a Trip with one Stop** (shared
    §8.4). §3.2, §6.3, and the conditional confidence removed from the SIT rows in §3.3 and §7.
16. **§6.1 resolved internally**: a driver change is a **new `Assignment` interval**, not a new trip;
    the Trip definition is reworded from "one assigned resource set" to "an assigned resource set",
    and Alvys's supersede-the-trip alternative is rejected explicitly rather than left hanging.
17. **Both usable Atlas observations engaged** (shared §9, §10.1.10): directional stop-type pairs are
    **rejected as a stop-purpose axis** with a structural argument and replaced by
    direction-derived-per-(stop, shipment) (§5.4); **SIT-as-a-service-at-a-stop** is engaged by
    splitting storage into a `stay` (A5's, with DTR's control number) and a warehouse **visit** that
    remains a stop (§5.1).

**Additions:**

18. **§8, a nine-scenario acceptance section**, run explicitly, with the previous revision's five
    failures named. Five of nine failed before; nine of nine are expressible now, two with named
    dependencies in other documents and one with a deliberately unclassified interval.
19. **A fifth sub-question at §1** — movements performed by a party whose journey we cannot see —
    because it changed the shape and was absent from the question the previous revision asked.
20. **This section.**

**Points of disagreement with the critique, argued rather than absorbed:**

21. **The stop-ownership fork keeps its High rating** (§7, row 1). The critique says "re-ground or
    re-rate"; this document re-grounds and declines to re-rate, because the withdrawn DCSA sentence
    was rhetorical rather than evidentiary — five structural sources and two self-diagnosing
    counter-examples remain. What is conceded is the rhetoric.
22. **Directional stop types are rejected, not adopted**, against the supplement's recommendation
    that the ideal model "should weigh" them (§5.4). Weighed; the argument is that direction is
    shipment-relative while a stop is trip-relative, so a directional stop type silently re-imports
    the shipment-owns-the-stop shape. Marked **[ORIGINAL]** as a conclusion.
23. **The cross-dock dwell gap is narrower than the critique described** (§8, scenario 8): custody
    _is_ covered by the `Custody` interval, and the shipment-with-no-trip state is licensed. What is
    genuinely open is only whether the dwell is a `stay`, and that is A5's to name — forcing it here
    would pre-empt A5's storage boundary. Recorded as a real but smaller gap.

**Revision 3 — shared-layer coherence fixes.** None changes a decision here; each removes a second
way of saying something, or corrects a citation.

24. **One classification axis** (`[SD §1.3]`). `factClass` and `factRef` are gone as fields: `type`
    **is** the fact class, the envelope `subject` is the only subject, and the fact key
    `(subject, type, qualifier?)` is derived. §3.2's canonical-subject table and §8's scenario-7
    records are restated on that basis; only `FactResolved` spells `factRef` out.
25. **E-CANON restated as a subject _family_** (§3.2, §8.7): a closed set of aggregate kinds. This is
    what A3's own externally-performed-leg scenario has been relying on, and it is now the rule
    rather than an aside. _(Revision 4 item 32 corrects the count this item gave — the non-singleton
    families are three, not one.)_
26. **Item 28.3 withdrawn** as a premise for the pack-only-day Trip (§3.2). Item 28.3's extra stops
    are pickups "after the first pickup" and deliveries "prior to the final delivery" — every one on
    a linehaul route, which is exactly what the no-linehaul day lacks. `src:open-trip-model` carries
    the rule alone, and shared §8.4 drops the decision's confidence to **medium** in consequence.
    Item 28.3 is re-cited at §3.1 for the narrower thing it does say: a service act performed at a
    place is stop-shaped and is rated as a stop.
27. **Shippeo's counts corrected** (§3.1): the committed `event-list-order-level.md` has **38 data
    rows**, of which 7 are geofence-marked and 25 carry a non-conform justification — none of the 25
    geofence-marked. "7 of 41" and "24 exception rows" were inherited approximations; the finding is
    unchanged.
28. **The `storeIn` act and the `sitEntryDate` are two record types** (`[SD §5.3]`), stated in the
    A5 hand-off so A5 inherits the constraint rather than rediscovering it. A3's two seam acts are
    unaffected — they are acts, and the date was never one of them.
29. **The item-vs-Portion test cited at §8.9** (`[SD §5.4]`): a value **per article** is an
    `item`-subject assertion; a **scope of an act** is a Portion, even of one.
30. **Scenario 8's label aligned** with `fork-order` and `fork-time` (`[SD §10.5]`) —
    _Expressible — dwell classification deferred to A5, custody authority deferred to A8_. Item 23
    above stands as the argument; only the word "expressible" versus "partial" changes, and it
    changes in all three documents at once.

**Revision 4 — conformance to the binding layer** (`[SD §10.1]` items 18 and 19). Both are mechanical:
no conclusion in this document moves, and nothing is re-argued.

31. **E-CANON is reject, not re-key** (`[SD §4.6]`, `[SD §10.1 item 18]`). §3.2's "the destination
    agent's shipment-level phrasing **resolves to** that stop (shipment in `context[]`)" and §8
    scenario 7's "resolves onto the stop … rather than becoming a second, unpairable fact" both read
    as the **boundary** re-keying a record onto a subject the asserter never named. Corrected in both
    places, in the same three parts: **E-CANON-STRICT** refuses the record as phrased (no `eventId`,
    no fact key, no contest, no substitution); **E-CANON-RESOLVE** names who re-phrases — a published,
    versioned **subject-resolution rule**, **ingest-side, before the boundary**, returning **exactly
    one** candidate, with the asserter's `assertedBy`/`assertedAt` kept, the subject they named in
    `context[]` and their message in `evidence[]`; and **E-CANON-OBLIGATION** retains the submission
    with its candidate set and emits an obligation where the rule returns zero or more than one.
    Naming the canonical subject is an **obligation on the asserter**. §8 scenario 7 now also carries
    the **two-candidate** case — split delivery over stops T4 and T9, which is A3's own worked shape
    (§3.3) — where resolution **fails on cardinality** with no recency, nearest-geofence or
    planned-window fallback, and the contest runs without the claim. The `ExternallyPerformedLeg`
    half is unchanged in substance: it is a second member of the same family and therefore a
    _candidate_, never a fallback the boundary picks.
32. **§3.2's family table cites `[SD §4.7]` instead of declaring** (`[SD §10.1 item 19]`). The
    canonical-subject declaration is shared §4.7's table, which outranks any per-document
    restatement; §3.2's "Where each kind of fact lives" is its ancestor, is kept for the reasons it
    carries, and now names §4.7 as the authority and the `type` spellings alongside each row. Item 25
    above said the families were "singleton everywhere except `stop`"; **shared §4.7 note 2 makes it
    three** — `stop = {stop, externallyPerformedLeg}`, **`goods` = {shipment, portion}**, and
    `identity` over the whole `aggregate` enum. The added `goods` family is the one A3 was already
    relying on without naming it: §3.3's split-delivery and overflow rows mint Portions and then act
    on them.

**Revision 5 — conformance to the binding layer** (`[SD §10.1]` items 20, 21 second half, 22 and 23).
All five are mechanical: **no conclusion in this document moves, no confidence rating moves, and no
requirement is added.** Two of them delete a claim A3 was making; three restate a claim in the
vocabulary the shared layer publishes.

33. **`Custody` is a projection, not a stored entity** (`[SD §4.8]`, `[SD §10.1 item 23]`), applied
    at every place A3 named one. **§3.1's spine diagram** drops
    `Custody ──(interval, orthogonal to Trip)──▶ Shipment` and its `party · from · until · basis`
    line — which is what makes the headline sentence _"Nothing else in A3 is stored"_ literally
    true — with a `No Custody interval` note in the same form as the existing `No quantity` / `No
result` notes. **§3.2's `Custody` definition** now reads _a projection — the fold
    `custodyAt(goods, instant)` over the `FactResolved`-selected `handover` assertions and over
    `ExternallyPerformedLeg.custodyBasis`_, with the 41/349 basis kept **exactly where it was, on the
    act**. **§3.3's agent-to-agent handoff row** names the fold instead of an interval boundary.
    **§4 foreclosure 4** folds `custodyAt(goods, instant)` rather than reading "the current `Custody`
    interval". **§5.2 item 2's [ORIGINAL] claim** moves from _"Custody as a first-class **interval**"_
    to _"Custody as a **fold**"_ — which is A3's own `Leg` rule (_"Storing them is how they come to
    disagree with the records"_) applied to the one derived thing the previous revision exempted from
    it, and which keeps A3's own honest observation that Rec 24 supplies _"two status codes, **not**
    an entity"_. **§7's confidence row** is relabelled and its **rating is unchanged**, with the
    reason stated: the same two codes and the same `J1`/`R1` pair are the whole of the support either
    way, and both sources publish acts rather than intervals. **§8 scenario 2's** _"a `Custody`
    boundary with basis 349"_ becomes _"a `handover` assertion with `custodyBasis = 349`"_, and **§8
    scenario 8** is restated the same way, with the fold's `UNKNOWN` outcome named as what covers a
    half-published cross-dock dwell. **A3 loses no field** — the fold returns party, from, until,
    basis and evidencing act. _(A ninth place, not enumerated in `[SD §10.1 item 23]` but carrying the
    same abolished entity and the same sentence `[SD §10.4]` was corrected in: §3.2's
    shipment-identity scope note, which read "the `Custody` interval and the stay have an owner
    regardless" and now says the stay has an owner and who held the goods needs none. Item 23 above,
    in the revision-2 list, describes the state before this change and is left as the historical
    record it is.)_
34. **Type names are `[SD §4.7]`'s, and §3.2's `StopAction` verb list is prose** (`[SD §10.1 item
20]`, `[SD §4.7]` note 5). The list now carries the mapping explicitly: `pack` → **`packing`**,
    `load` → **`loading`**, `unload` → **`unloading`**, `store-in` → **`storeIn`**, `store-out` →
    **`storeOut`**; `transfer-out` / `transfer-in` → **one `handover` type asserted once by each
    side** (the `J1`/`R1` shape), **not two types**; **`attempt` is not a type at all** — an
    attempted delivery is `type = delivery` with `outcome = NOT_COMPLETED` and at least one reason,
    which A-TYPE requires and which §8 scenario 3 already publishes correctly. `unpack`, `weigh` and
    `survey` have **no `[SD §4.7.1]` member**; A3 records them against `[SD §4.7.3]`'s absent list and
    [`A8` §9 item 8](A8-authority-skeleton.md) and **mints nothing** — `[SD §4.7.3]` now carries
    `weighing` and `unpacking` explicitly, with the argument for minting them and the family question
    that blocks it. The `handover` spelling is applied in the two other sentences this revision was
    already rewriting (§3.3's handoff row, §8 scenario 8).
35. **§5.8's lifecycle is split three ways** (`[SD §10.1 item 22]`, `[SD §4.7.2d]`'s closing
    paragraph). _"Offered → accepted → loaded → in-transit → unloaded"_ was three different things in
    one arrow chain: **offer / response / release** are the `stopAction`-subject records
    (`membershipOffer` / `membershipResponse` / `membershipRelease`, with accept and decline as the
    two `outcome`s of one response, not two types); **`loaded` and `unloaded` are the `loading` and
    `unloading` act records on the `goods` family** and are **not** republished as membership
    transitions — that is the double-counting `[SD §4.5]` rejects in the Alvys
    `ArrivalRecorded`/`StopStatusChanged`/`Loaded` triple, which A3 already rejects at §Cross-area;
    and **`in-transit` is not a record at all** — it is a projection, forbidden as a field by
    `[SD §1.1]`. The phrase _"the accept/**perform** split lifted from Atlas's services onto the trip
    membership and onto the assignment"_ is **dropped**: the perform half is the act rows, not a
    second lifecycle. What survives as **[ORIGINAL, seeded]** is narrower and truer — that the
    membership is an asserted-about relation with its own records.
36. **§5.8's and §5.9's confidence notes now record that the nine lifecycle members' authority is
    _owed_, and do not fill it in** (`[SD §10.1 item 21]`, second half). Both point at
    [`A8` §9 item 8](A8-authority-skeleton.md); both state that the provisional readings in
    `[SD §4.7.1]` are **[ORIGINAL]** and **barred from scoring a dependent decision at any level**;
    §5.9 additionally records that **A8 §5 has no trip row and no source in the corpus binds a plan
    change to an asserting role**, so `src:sirva-ade`'s `TripResourceAssign` proves such records
    exist and says nothing about who may assert them. The trip row's `boundBy` is likewise **owed**
    and expressly _not_ `CUSTODY`.
37. **Two stale A8 references refreshed** to what `[SD §10.4]` now says, in the same words
    `fork-time` §7 row (b) and `fork-order` §8.8 already use. §3.2's _"the general rule is A8's,
    **which does not exist yet**"_ and §8 scenario 8's _"Custody authority is not claimed… is A8's"_
    both now record that [`A8`](A8-authority-skeleton.md) **exists** — supplying A8-MOVE, A8-INSTANT
    and an eleven-class role table — and that **the cap has moved rather than lifted**: A8 §10's last
    row caps A8's own contribution at **medium**, and only for the classes in its §5, so a dependent
    claim may be scored medium, may still not be scored high, and gains nothing at all for a class
    `[SD §4.7]` marks **owed**. No A3 rating moves, because no A3 rating depended on it.

38. **The `Leg`/`Custody` quotation pair, restated on both sides at once.** §3.2's `Leg` definition
    read _"folds over `StopAction`s, `ExternallyPerformedLeg`s and `Custody` intervals"_, which
    `[SD §4.8.2]` quoted **verbatim** as the disqualifying test custody inherits — so neither side
    could be edited alone without breaking the other's quotation. Both now read
    `custodyAt(goods, instant)`, and `[SD §4.8.2]` records that revision 5 restated the phrase on
    both sides rather than silently diverging from its own citation. No argument moves: the
    disqualifying test is unchanged and still applies to custody.
39. **§5.3's shuttle prose conformed to item 34.** `load` → **`loading`**; `transfer-out` at the
    transfer point paired with `transfer-in` on the linehaul trip → **one `handover` asserted once by
    each side** (the releasing shuttle, the receiving linehaul trip), with `custodyBasis`
    **`41 continued-responsibility`** where it is the same agent. §5.4's incidental-dwell sentence
    likewise now reads _"the gap between the releasing and receiving `handover` assertions"_.

**Not changed, and named so the omission is visible rather than silent.** §Cross-area's A8 note still
reads _"Until A8 exists, no A3 claim is rated on it."_ It is not enumerated in `[SD §10.1]`, and item
37's cap now governs how it reads.

**Conformed to binding layer rev 5** (`00-shared-decisions.md`, revision 5) — items 33-39 above are
what that claim rests on.
