---
source: src:open-trip-model
analyzed: 2026-09-17
evidence_grade: A
material: |
  sources/open-trip-model/local/otm-api-v5.6.yaml (full OpenAPI 3.0 spec, 29 702 lines,
    sha256 2202f771dbd49c062b7d94821bd19c36bb1f644fa7809479cfabc8bb954d7185, retrieved
    2026-09-17 from https://raw.githubusercontent.com/opentripmodel/documentation/HEAD/app/api/otm-api-v5.6.yaml)
  sources/open-trip-model/local/otm-api-v5.7-rc.1.yaml (sha256
    4671736861c5e842639b33f29e5156c5882e3833697e2bf9168215b7e527c6f6, same retrieval — read
    only for the extended action-result reason catalogue)
  sources/open-trip-model/local/otm5-index.html (captured 5.8 docs index — entity prose)
  sources/open-trip-model/local/otm5.8-docs-llm.md (5.8 docs as markdown, incl. full changelog,
    https://otm-api-spec.redocly.app/api/5.8/otm.md)
---

# Open Trip Model 5 (OTM5) — analysis

## What it is

OTM5 is a **lightweight, open data model for exchanging real-time logistic trip
data on the web**, published by the Dutch SUTC community and maintained openly on
GitHub (`opentripmodel/documentation`, change requests in `opentripmodel/otm5-change-requests`).
Its stated purpose is "to make it easier for shippers, carriers, software vendors,
OEMs, and truck manufacturers to create new multi-brand applications and services"
(`local/otm5.8-docs-llm.md`, "Why OTM?"). **S1 kind:** `reference-model` delivered
*as* an OpenAPI 3.0 contract — it is simultaneously a conceptual model and a REST
message standard, with PUT/GET/DELETE per entity and server-side UUID generation.
**S2 adoption: 1–2** — actively maintained (5.6 Nov 2023, 5.7 May 2025, 5.8 Mar 2026;
`otm5.8-docs-llm.md` changelog) with .NET and Java reference libraries, but the
deployed base is European road freight and telematics, not North American HHG.
**S3 openness:** `public` (docs repo public; license unstated on the docs, MIT on the
Java library — hence the spec copies are parked in `local/`, not `captured/`).

**What our reading covered:** the entire 5.6 OpenAPI document — every entity schema,
every enum, every association pattern — plus the 5.7-rc.1 `action-result-reason`
schema and the complete 5.8 changelog and entity prose. **What we did not read:**
the narrative documentation site at `opentripmodel.org` (usage guidance, worked
scenarios, the ADR dangerous-goods annex it defers to), and the 5.8 machine-readable
spec (not published in the docs repo at time of reading; the captured 5.8 HTML
index carries the prose but keeps every field table collapsed behind JavaScript).
**Version caveat:** field-level citations below are to **5.6**; where 5.7/5.8 changed
something material it is cited to the changelog and flagged.

## Model summary

Twelve top-level entities, each with its own `/api/v5/<entity>` resource. They split
cleanly into **static entities** (things that exist) and **dynamic entities** (things
that happen), and the whole model turns on that split:

**Static:** `Vehicle`, `Route`, `Sensor`, `Location`, `Actor`, `Consignment`, `Goods`
(→ `items` | `transportEquipment`), `TransportOrder`, `Document`, `Constraint`.

**Dynamic:** `Trip` (an *aggregate*), `Action`, `Event`.

> "A **Trip** is an aggregate entity that combines various entities to model visiting
> various locations, potentially doing one or multiple actions on each location, such
> as loading or unloading consignments. It is optionally coupled to a Vehicle that
> is/was driving this trip." — `local/otm5-index.html`, "Trip"

> "**Actions** are dynamic entities that are able to couple together various static
> entities at a certain moment in time. For instance a Load action couples together a
> Consignment and a Vehicle at the moment the Loading happens." — ibid., "Action"

The shape that matters for us:

```
TransportOrder --< Consignment --< Goods (items | transportEquipment)
                        ^
                        | (referenced by load/unload/handOver)
                        |
Trip --< actions[] = Stop (sequenceNr, location, startTime/endTime, lifecycle)
             '--< actions[] = Load | Unload | HandOver | Wait | Break
                             | AttachTransportEquipment | DetachTransportEquipment
                             | Refuel | GenericAction
Trip -- vehicle -- Actor(driver, carrier, subcontractor...)
Move  = the action of travelling *between* stops (optionally with Route detail)
```

**A trip carries no goods.** The only thing that puts a consignment on a vehicle is a
`load` action at a stop referencing that consignment; the only thing that takes it off
is an `unload`. Consolidation of several consignments on one trip therefore needs no
new concept — it is several `load` actions at different stops
(`local/otm-api-v5.6.yaml:4427–4536`, the worked `/api/v5/trips` example: stop 0
"already done" with a `load`, stop 1 "still needs to be visited" with the matching
`unload` of the same consignment UUID).

**Every association is polymorphic in one of three ways** — the single most
transferable idea in the spec. Any reference field accepts:

| `associationType` | meaning | cite |
| --- | --- | --- |
| `inline` | the full nested entity | `otm-api-v5.6.yaml:13760–13772` (trip.vehicle) |
| `reference` | `{uuid, entityType}` — typed pointer, 34-value `entityType` enum | `otm-api-v5.6.yaml:7354–7407` |
| `attributeRestriction` | "the entity matching these attributes", e.g. a vehicle by `licensePlate` | `otm-api-v5.6.yaml:14391–14410` (locationUpdateEvent example names a vehicle by licence plate alone) |

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `TransportOrder` | "the top-level entity to model a group of related consignments that might be transported separately, but need to be administered together. For consistency, even if there is only one consignment, it is still required to use a transport order." | A1, A2 | `otm5-index.html`, "TransportOrder" |
| `Consignment` | "a description of an identifiable collection of goods items to be transported between the consignor and the consignee. This information may be defined within a transport contract." | A2 | `otm5-index.html`, "Consignment" |
| `Goods` → `items` / `transportEquipment` | items = "the actual goods to be transported"; transport equipment = "equipment used to carry the actual goods… (usually) a means to an end, not something that needs to be transported on itself, such as pallets" | A2 | `otm5-index.html`, "Goods" |
| `Trip` | aggregate of stops/actions, optionally coupled to a vehicle (quoted above) | A3 | `otm5-index.html`, "Trip"; schema `otm-api-v5.6.yaml:13672` |
| `Stop` (an `actionType`) | "models visiting a certain location at a certain time and potentially doing several other actions at that location" | A3 | `otm5-index.html`, "Action"; schema `otm-api-v5.6.yaml:17925` |
| `Move` (an `actionType`) | "models moving between two or more locations, potentially with detailed route information on how to move between these locations" | A3 | `otm5-index.html`, "Action"; schema `:8351` |
| `Load` / `Unload` | loading/unloading "one or multiple Consignments into/from a vehicle or some sort of container" | A3, A4 | `otm5-index.html`; `:14872` / `:17291` |
| `HandOver` | "indicates transferring a consignment from one Actor to another" — carries `from` and `to` actor refs | A4, A8 | `otm5-index.html`; `:10595`, `from`/`to` at `:10737`/`:10749` |
| `Attach`/`DetachTransportEquipment` | attach/detach equipment to the vehicle — "you can both load/unload **and** attach/detach TransportEquipments. For instance loading a container on a ship, or attach a trailer to a truck. So choose the one that is most appropriate." | A3 | `otm5-index.html`, "Action" |
| `Break` | "a mandatory resting period for the driver of the vehicle. During this period the driver is prohibited from doing any driving activities or other work" | A3, A13 | `otm5-index.html`; `:9857` |
| `Wait` | waiting at a location; distinguished from Break because "waiting times **can be shortened** because of changing circumstances. For example, if the original waiting time was expected to be 15 minutes because of an occupied dock, but the driver is 10 minutes late, the waiting time can be shortened to 5 minutes until the dock is free." | A3, A4 | `otm5-index.html`, "Action"; `:9051` |
| `GenericAction` | escape hatch "for whenever any of the above actions cannot model the situation appropriately" | A3, C8 | `otm5-index.html`, "Action" |
| `lifecycle` | "A lifecycle models **when** the data in the action is taking place. You can provide the **same action in multiple lifecycles** to model how it changes over time." Enum: `requested`, `planned`, `projected`, `actual`, `realized` | A4, C5 | `otm-api-v5.6.yaml:18081–18099` (on `stop`; an identical block appears on every action and event) |
| `result` | "The result of the action, **can only be present in the actual or realized lifecycles**." `{status, remark, reason}` | A4, C7 | `otm-api-v5.6.yaml:18098–18145`, status enum `:18134–18138` |
| `contextEvents` | "optional information about the events that can provide additional information on the current state of this entity… your system might send ETA information for the arrival of a vehicle on a location. To make it clear what caused this ETA to be updated, we can include some information about what caused this ETA update" | A4, C7 | `otm-api-v5.6.yaml:7266–7290` and on every entity |
| `externalAttributes` | "meant for additional meta data and/or additional ID's of an entity. This can also help to identify an OTM entity in a system by the ID of that system. **Please, use this with caution**: having too many external attributes can be a sign of not using OpenTripModel as it was intended." | A9, C8 | `otm-api-v5.6.yaml:7296–7310` |
| `sequenceNr` | "The sequence number of this action within the entity it is taking place. **Can be used to indicate order when no times are present**" | A3 | `otm-api-v5.6.yaml:18148–18153` |
| `timeFormat` | `dateTime` / `recurringDateTime` / `duration` — selects whether `startTime`+`endTime`, an RFC 5545 `recurrence`, or an ISO 8601 `duration` carries the timing | A3, C5 | `otm-api-v5.6.yaml:18180–18212` |
| `Actor` roles | `shipper`, `carrier`, `consignee`, `consignor`, `receiver`, `driver`, `subcontractor`, `owner` | A8 | `otm-api-v5.6.yaml:11076–11137` (definitions), enum `:14378–14386` |
| `Location.type` | `warehouse`, `store`, `environmentalZone`, `restrictedArea`, `customer`, `operationalBase` (+ 5.7: `fuelStation`, `serviceStation`, `other` with `otherLocationType`) | A3, A5 | `otm-api-v5.6.yaml:21319–21325`; 5.7 additions in `otm5.8-docs-llm.md` changelog |
| `Constraint` | value objects asserting what must hold: `timeWindowConstraint`, `temperatureConstraint`, `weightConstraint`, `accessConstraint`, `emissionStandardConstraint`, `fuelTypeConstraint`, `valueBoundConstraint`, composable with `and`/`or`/`not` | A3, A10 | `otm5-index.html`, "Constraint"; schemas `:15150`, `:15172`, `:14854`, `:14832` |
| `Document` | "either you provide the content of the document directly as a base64 encoded string, or you provide a link to the document"; has `documentType`, `mimeType`, `creator`, `owner`; attachable to `load`/`unload`/`handOver` and `consignment` | A6 | `otm5-index.html`, "Document"; schema `:11668`, `documentType` `:11758` |

## Lifecycles & events

**Two orthogonal axes, and keeping them apart is the design.**

**Axis 1 — entity status** (`Trip.status`, `Consignment.status`, one shared enum):
`draft`, `requested`, `confirmed`, `inTransit`, `completed`, `cancelled`, plus
`accepted` (deprecated, replaced by `confirmed`) and `modified` (deprecated, replaced
by the `lastModified` field) — "deprecated since OTM5.1, but will be supported for the
whole OTM5.X line" (`otm-api-v5.6.yaml:13738–13749` for trip, `:21030–21048` for
consignment). **No transition table, no invariants, and no statement of who may cause
a transition.** The states are asserted, not governed.

**Axis 2 — `lifecycle` on every action and event**: `requested`, `planned`,
`projected`, `actual`, `realized`. This is *not* a status; it says which temporal
reading of the same fact you are looking at. The same stop can be published five times
— once per lifecycle — and the differences between them *are* the plan-vs-execution
record (`otm-api-v5.6.yaml:18081–18099`). The trip example ships a stop with
`lifecycle: realized` beside one with `lifecycle: planned` in a single payload
(`:4448` and `:4496`).

**Action results** exist only on the `actual`/`realized` lifecycles:

- `result.status` ∈ `succeeded` | `failed` | `partiallySucceeded` | `cancelled`
  (`otm-api-v5.6.yaml:18134–18138`).
- `result.reason` — 5.6 supports only `damage` and `receiverAbsent`
  (`:18140–18143`). **5.7 expands it to a 10-value catalogue** with a per-value
  definition: `damage`, `deliveredElsewhere`, `deliveredToWrongReceiver`,
  `inaccessibleAddress`, `incomplete`, `invalidAddress`, `invalidShippingLabel`,
  `receiverAbsent`, `rejectedByReceiver`, `other` — where `other` is explicitly
  "designed to capture edge cases… The specific reason is provided in the `remark`
  property" (`local/otm-api-v5.7-rc.1.yaml:13327–13361`, schema `action-result-reason`).
- `result.remark` is defined against the action's own `remark`: "differs from the
  remark on an action, which is a remark that is relevant **before** the execution of
  the action. Whereas this remark is relevant for the result **after** execution"
  (`otm-api-v5.6.yaml:18122–18131`).
- **5.8 adds sub-results**: "the unload action can be succeeded for certain goods and
  failed for others, in which case the overall result would be partially succeeded and
  the sub results would indicate which goods were unloaded successfully and which were
  not" (`otm5.8-docs-llm.md`, 5.8 changelog, change request 115).

**Event taxonomy** (`otm5-index.html`, "Event") — the spec classifies its own events
by *why they exist*, not by subject:

- *Real-time updates:* `LocationUpdateEvent` (GPS; carries `geoReference` with
  `speed` and `heading`, `otm-api-v5.6.yaml:14391–14541`), `SensorUpdateEvent`,
  `StartMovingEvent` / `StopMovingEvent` / `StartEngineEvent` / `StopEngineEvent`
  ("events provided by Fleet Management Systems"), `StartWaitingEvent` /
  `StopWaitingEvent`.
- *Both real-time and projected/realized:* `EmissionEvent`, `FuelConsumedEvent` —
  each "can be provided as an actual value, projected based on some calculation, or
  realized as measured by some sensor" (the lifecycle axis doing real work).
- *Updates on earlier provided data:* `UpdateEvent` — "The **fields** of the entity
  that need to be updated. All fields that are not present remain **unchanged**. If
  you want to unset a field explicitly use null" (`otm-api-v5.6.yaml:14128–14133`);
  `AssociationCreatedEvent` / `AssociationRemovedEvent` — "allow for static entities
  to be coupled **after the fact**. Such as coupling a Vehicle to a Trip."

**Where telemetry stops and events begin** is drawn explicitly: telemetry arrives as
`LocationUpdateEvent` / `SensorUpdateEvent` *events*, and business facts arrive as
*action results*. The join between them is `contextEvents` — a business fact can name
the telemetry event that caused it.

## Time, identity, evidence

**Time.** Three mechanisms, layered:

1. The `lifecycle` axis (requested / planned / projected / actual / realized) —
   planned vs estimated vs actual is a *dimension of the same record*, not five field
   names. OTM's `projected` is the ETA reading and `realized` the settled one.
2. `timeFormat` selects the timing representation per action: an instant pair
   (`startTime`/`endTime`, "in ISO format"), an RFC 5545 `recurrence`, or an ISO 8601
   `duration` (example `PT168H` = 168 h) — `otm-api-v5.6.yaml:18180–18212`.
3. `timeWindowConstraint` carries the *agreed* window separately from the actual
   times, with optional start and end, and replaced the older
   `startDateTimeConstraint`/`endDateTimeConstraint` pair in 5.2 because "the new
   solution is shorter and simpler" (`otm5-index.html`, "Constraint"; schema `:15150`).

**No time zone anywhere.** Times are "ISO format" strings with no field for the
stop's local zone and no statement about date-only versus instant. For HHG, where a
delivery spread is a *local* date at the destination, this is a real gap.

**Identity.** `id` is "Uniquely identifie[d]… A URI can be assigned by the client to
indicate where more information can be retrieved… since OTM5.2 it is not required to
send it in the request. One can be generated for you by the server"
(`otm-api-v5.6.yaml:13689–13693`). Cross-party identity is handled three ways:
typed `reference` (`{uuid, entityType}` against a 34-value entityType enum),
`attributeRestriction` (match by business key — e.g. a location update naming a
vehicle only by `licensePlate`, `:14400–14404`), and `externalAttributes` (a free
`additionalProperties` map, explicitly for "additional ID's of an entity… to identify
an OTM entity in a system by the ID of that system", with the spec's own warning
against overuse). Standard code lists appear where they exist: `unCode` and `gln` on
Location, `eori` and `vatCode` on Actor, ISO country/currency codes, GS1 packaging
codes (`otm5.8-docs-llm.md`, 5.3 changelog).

**Evidence & provenance.** Four distinct devices:

- `actors` on every event and action, with `roles` carried *on the association* — so
  the same legal entity can be `carrier` on one association and `owner` on another.
  5.8 explicitly disambiguates `actors[].entity.role` from `actors[].roles`
  (`otm5.8-docs-llm.md`, 5.8 changelog, change request 109).
- `contextEvents` — the causal chain behind a changed value ("if the ETA was caused by
  a traffic accident on the route of the vehicle, you can include that event in the
  context").
- `Document` with `creator` and `owner` actor associations, attached to the very
  action it evidences ("proving some package was delivered with help of a photo, or
  some scanned document that establishes that the transferred goods are accepted on
  handover").
- `UpdateEvent` — the correction mechanism, with sparse-merge semantics and explicit
  `null` to unset. **Corrections are events, not silent overwrites.** There is,
  however, no reversal/void concept and no "who asserted this field" at field grain.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 1 | 0 | 2 | 2 | 1 | 3 | `TransportOrder` is a grouping envelope only (`otm5-index.html`); status enum `:13738` / `:21040` is one shared 6-value list with no transitions and no actor authority; nothing on offer/award/accept/decline/estimate. C5 credited for the `lifecycle` axis + `timeWindowConstraint`. C8: `externalAttributes` + `GenericAction` + a disciplined changelog with 5.x-long deprecation support. |
| A2 Shipment structure | 2 | 2 | 1 | 0 | n/a | 2 | 1 | 3 | TransportOrder→Consignment→Goods(items / transportEquipment) with `grossWeight` (5.1) and `volume` (5.8); `relatedConsignments` (5.3); items-vs-equipment distinction defined (`otm5-index.html`, "Goods"). C2 capped: `Consignment.type` is **free text** "(e.g. frozen, fragile)" (`:21049–21054`) — no typed shipment taxonomy, no "services ordered". |
| A3 Trip, stop & assignment | 3 | 3 | 2 | 0 | 3 | 3 | 2 | 3 | The area this source wins. Trip-as-aggregate, ordered `Stop` actions with `sequenceNr`, nested per-stop actions, vehicle/actor/route associations, consolidation falls out of load/unload (worked example `:4427–4536`). C2=3 on the Wait-vs-Break definition and the Attach-vs-Load guidance. C3 held at 2: statuses without transitions. C5=3 on the lifecycle axis + `timeFormat`. C6=3 on inline/reference/attributeRestriction. |
| A4 Execution events & tracking | 3 | 3 | 2 | 0 | 3 | 3 | 3 | 3 | Actions carry `result` on actual/realized only; the event taxonomy is classified by purpose; telemetry (`LocationUpdateEvent` with speed/heading) is kept distinct from business facts and joined by `contextEvents`. C7=3: result status+reason+remark, the 10-value 5.7 reason catalogue with `other`+free text (`otm-api-v5.7-rc.1.yaml:13327–13361`), 5.8 sub-results, `UpdateEvent` sparse-merge corrections, actors on events. C3 held at 2 — no arrive/depart state machine, no authority model. |
| A5 Storage-in-transit | 1 | 0 | n/a | 0 | 2 | n/a | n/a | n/a | Effectively absent. Only adjacent material: `Location.type = warehouse` (`:21319`), the `duration` timeFormat with a `PT168H` example (`:18205–18212`), and 5.6's "loading and unloading consignment in and from transport equipment" (changelog, change request 63), which is the nearest thing to vault handling. No storage state, no in/out, no delivery-out leg, no permanent-storage boundary. |
| A6 Documents & evidence | 2 | 2 | 1 | 0 | 1 | 2 | 3 | 3 | `Document` entity with inline base64 **or** URL content, `creator`/`owner` actors, attached to the evidenced action (`otm5-index.html`, "Document"; `:11668+`). C7=3 for document-as-evidence-of-an-action being a first-class link. C2 capped: `documentType` is a free-text string "such as a photo, text document, PDF etc." (`:11758`) — no catalogue, so no BOL / POD / weight-ticket semantics. |
| A7 Charges & billing hooks | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | No money anywhere in the spec. `valueBoundConstraint` (5.5) constrains cargo value, not charges. |
| A8 Parties & roles | 2 | 3 | n/a | 0 | n/a | 3 | 2 | 3 | Eight roles, each defined, plus a paragraph on how they relate and the explicit rule that "a single actor can have multiple roles… if the role of the actor fits any of the above it **must** be present" (`:11103–11137`); person/company specialisations (5.7). C6=3: roles ride on the *association*, not the actor, and actors attach to trip, action, event, document and consignment. C4=0: no booking / origin / hauling / destination agent, no van line, no warehouse operator, no account/RMC. |
| A9 Identity & cross-references | 2 | 2 | n/a | 0 | n/a | 3 | 1 | 3 | Client-or-server `id` as a resolvable URI (`:13689`); typed `reference` with a 34-value `entityType` enum (`:7354–7407`); `attributeRestriction` match-by-business-key; `externalAttributes` for foreign system ids with a self-aware warning; `unCode`/`gln`/`eori`/`vatCode`. C4=0: no SCAC, BOL/PRO, registration number or service-order number. |

**S5 — fit to Pegasus data.** Not assessable from this source alone: this analysis
read no Pegasus II or Cloud schema. Recorded as `unknown` for **A1–A9** pending the
internal-system source analyses, with one flag for phase 3: the concepts most likely
to be missing on the pegII side are the ones this source is strongest on — a *stored*
`lifecycle` discriminator (planned vs projected vs realized copies of the same stop)
and a *typed* action result with a reason, neither of which a form-and-save CRUD
screen normally persists. Treat that as a hypothesis to test, not a finding.

## Strengths worth adopting

1. **The `lifecycle` dimension instead of parallel planned/actual field names.** One
   stop record, published at `requested` / `planned` / `projected` / `actual` /
   `realized`, rather than `planned_arrival`, `eta`, `actual_arrival` columns bolted
   onto one row. It extends to a new temporal reading without a schema change, it
   makes "what we promised vs what happened" a diff between two readings of the same
   fact, and it keeps an ETA (a projection) from ever being mistaken for an observation.
2. **`result` is only valid on `actual`/`realized`.** A plan cannot carry an outcome.
   That invariant is worth stating explicitly in our own model.
3. **Action result = `{status, reason, remark}` with `partiallySucceeded` and 5.8
   sub-results.** HHG is full of partial outcomes — short shipment, items refused at
   delivery, a crew that loads half a residence. A binary succeeded/failed will not
   survive contact with the domain; OTM's overall-result-plus-per-goods-sub-result is
   the right shape.
4. **Two remarks with a defined boundary** — instructions *before* execution vs
   explanation *after*. Cheap, and it stops one free-text field becoming both.
5. **`contextEvents`: the cause of a changed value travels with the value.** "This ETA
   moved because of *that* traffic event / *that* location update." This is the
   provenance mechanism A4 needs and it costs one association.
6. **`UpdateEvent` as a first-class correction**, with sparse-merge and explicit `null`
   to unset — corrections are recorded facts, not overwrites.
7. **Three association modes on every reference** (`inline` / `reference` /
   `attributeRestriction`). The third is the sleeper: it lets a partner assert a fact
   about "the vehicle with licence plate X" without ever having learned our id —
   exactly the shape of an Omnitracs or Samsara feed arriving before correlation.
8. **Consolidation needs no concept.** A trip has stops; a stop has load/unload
   actions referencing consignments. N shipments on one trip is the default reading,
   not a special case.
9. **`sequenceNr` orders stops "when no times are present."** Ordering survives a plan
   with no committed times — which is the normal state of a dispatch board.
10. **`Wait` vs `Break`, distinguished by whether the duration can be shortened.** A
    definition written from an operational consequence rather than a taxonomy. Worth
    copying as a *style*: our own distinctions should be justified by what changes.
11. **`GenericAction` plus `externalAttributes`, with the spec warning against leaning
    on them.** An escape hatch documented as a smell.

## Weaknesses / traps

- **One status enum for both `Trip` and `Consignment`.** `draft` / `requested` /
  `confirmed` / `inTransit` / `completed` / `cancelled` applied to a vehicle journey
  *and* to a collection of goods. For HHG these are different lifecycles entirely — an
  order is booked, awarded, surveyed, estimated and accepted long before any trip
  exists, and a shipment can be "completed" at origin while sitting in SIT with no
  trip at all. Reusing one enum here would collapse A1 into A3.
- **Statuses with no transitions and no authority.** Nothing says who may cancel, or
  that `completed` cannot precede `inTransit`. Adopting the vocabulary without adding
  a transition model and a "who may cause it" would import the gap.
- **No storage-in-transit at all, and the `warehouse` location type is a trap.**
  Modelling SIT as "a stop at a warehouse location" loses the duration, the storage
  account, the in/out legs, and the permanent-storage boundary. OTM has no vocabulary
  here and we must not pretend it does.
- **No charges, so no billing hooks.** An event catalogue derived only from OTM would
  silently omit A7.
- **`Actor` use is optional** — "The use of Actors is optional, and is not necessary to
  use OpenTripModel" (`otm5-index.html`, "Actor"). In HHG the party chain (booking /
  origin / hauling / destination agent, van line, driver, crew) is *the* hard part; a
  model that treats parties as optional garnish is the wrong default for us.
- **The eight roles are wholesale wrong for HHG.** `shipper` / `consignee` /
  `consignor` presume a seller shipping goods to a buyer. In a household move the
  shipper, the consignor and the consignee are typically the same natural person, the
  commercial counterparty is an account or RMC that is none of those, and the roles
  that matter (booking agent, hauling agent, destination agent) have no OTM
  equivalent. Taking this enum would actively mislead.
- **No time zone, no date-only type.** Every time is an "ISO format" string. A delivery
  spread is a local date range at the destination; `2026-07-14T00:00:00Z` is not that.
- **`Consignment.type` and `Document.documentType` are free text.** Both are exactly
  where we need a controlled vocabulary (HHG / vehicle / SIT-storage; BOL / inventory /
  weight ticket / POD). Copying the field shape would push semantics into strings.
- **`externalAttributes` is a gravity well.** The spec's own caution is right; in our
  model the cross-reference table should be typed (issuer + id type + value), not an
  untyped map.
- **REST-resource shape ≠ domain model.** OTM is delivered as PUT/GET/DELETE per
  entity with UUID paths. Some of its structure (`associationType` discriminators,
  `entity1`/`entity2` on association events) is transport plumbing, not domain
  meaning, and must not be carried into `model/`.

## Out-of-v1 material

- **A10 (survey / estimating, inventory detail):** the `Constraint` subsystem is where
  "what this job requires" lives — `temperatureConstraint`, `weightConstraint`,
  `accessConstraint` (5.5, change request 69), `valueBoundConstraint` (5.5, 61),
  `emissionStandardConstraint`, `fuelTypeConstraint`, `timeWindowConstraint`,
  composable with `and`/`or`/`not` and, since 5.6, carrying an **`enforceability`**
  flag (changelog, 75) and a `description`. An access constraint on a Location is a
  close analogue of a shuttle / long-carry survey finding. `Goods` carries ADR
  dangerous-goods classification with points and transport category (5.3, 31) — the
  pattern of *deferring a regulated catalogue to its own standard* is worth copying
  for 400NG.
- **A11 (claims & valuation):** only the `damage` result reason (5.6) and the 5.7
  additions `deliveredToWrongReceiver`, `rejectedByReceiver`, `incomplete` — i.e. the
  *trigger* for a claim, never the claim. `valueBoundConstraint` is cargo value, not
  valuation coverage.
- **A13 (crew, driver & settlement):** `Break` as a modelled, mandatory driver rest
  period with its own start/end (`:9857`) plus the `break-constraint` schema (`:9475`)
  — hours-of-service material. Actor role `driver`; `subcontractor` for the
  carrier→subcontractor delegation ("the carrier remains responsible"); `Vehicle.sensors`
  plus `FuelConsumedEvent`/`EmissionEvent` as the cost/telemetry substrate. No money,
  no splits, no settlement.
- **Beyond the rubric:** `Route` with `geoReference` supporting GeoJSON, OpenLR and TMC
  location referencing (`:10065`, `:8982`) — relevant if we ever exchange a *path*
  with a telematics vendor rather than just a stop list.

## Open questions

1. **Do we adopt the lifecycle axis as a stored dimension, or as separate named time
   fields?** OTM's answer is elegant but pushes complexity into every consumer ("which
   reading am I looking at?"). Decide in phase 3 (A4) before the event catalogue fixes
   it. A cheaper middle path — a `basis` discriminator on time *values* only, not on
   whole records — should be considered explicitly and rejected in writing if we go
   full OTM.
2. **Is the trip/consignment split sufficient for HHG,** where a shipment can exist
   with no trip for weeks (in SIT) and can be split across several trips and several
   carriers? OTM never has to answer this because a consignment there is short-lived.
   Needs a source that models SIT (no trip-shaped source will).
3. **What is the correct correction semantic for us** — OTM's sparse-merge
   `UpdateEvent`, or an append-only correcting event that supersedes a prior one?
   OTM's mutates the entity; an event catalogue arguably cannot. A core-model decision,
   not a source decision.
4. **Where does `HandOver` belong in our model?** OTM makes transfer-of-custody an
   action with `from`/`to` actors, distinct from unload. HHG has exactly this at an
   agent-to-agent interline and at a SIT hand-in, and pegII may have no equivalent.
   Confirm against the internal-system sources.
5. **Registry housekeeping (for the orchestrator; not done here):** three files were
   fetched into `sources/open-trip-model/local/` and need `files` entries with the
   sha256 values recorded in this file's front matter. The docs repo states no license
   for the spec text, which is why they went to `local/` rather than `captured/` —
   worth confirming before anyone promotes them.
6. **Is 5.8's machine-readable spec obtainable?** Our field-level reading is 5.6 plus
   the 5.7 reason catalogue; 5.8 (Mar 2026) adds action sub-results, vehicle-level
   actions and goods volume, all of which we cited from prose only.
