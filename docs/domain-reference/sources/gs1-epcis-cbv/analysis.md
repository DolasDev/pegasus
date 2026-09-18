---
source: src:gs1-epcis-cbv
analyzed: 2026-09-17
evidence_grade: B
material: |
  All paths below are relative to docs/domain-reference/.
  Read in full or in substantial part:
  - sources/gs1-epcis-cbv/captured/EPCIS/EPCIS-JSON-Schema.json (all 2331 lines)
  - sources/gs1-epcis-cbv/captured/EPCIS/Ontology/EPCIS.ttl (property/class definitions, grepped by term)
  - sources/gs1-epcis-cbv/captured/EPCIS/Ontology/CBV.ttl (bizStep / disposition / BTT / SDT / error-reason definitions)
  - sources/gs1-epcis-cbv/captured/EPCIS/REST Bindings/query-schema.json (all 959 lines)
  - sources/gs1-epcis-cbv/captured/EPCIS/REST Bindings/query-schedule.json
  - sources/gs1-epcis-cbv/captured/EPCIS/REST Bindings/openapi.yaml (path list, /capture, /capture/{captureID}, /queries/{queryName}/subscriptions)
  - sources/gs1-epcis-cbv/captured/EPCIS/Implementation Guideline/*.md (all four drafts)
  - sources/gs1-epcis-cbv/captured/EPCIS/JSON/Example_9.6.1-ObjectEvent.jsonld
  - sources/gs1-epcis-cbv/captured/EPCIS/README.md
  Not read - see "What we could not see".
---

# GS1 EPCIS 2.0 + Core Business Vocabulary (CBV) 2.0 - analysis

## What it is

EPCIS is GS1's **visibility event** standard: a data model and interchange format for
statements of the form "this object, at this time, at this place, in this business
context". CBV is its companion **vocabulary** standard supplying the controlled value
lists (business steps, dispositions, business-transaction types, source/destination
types, error reasons) that populate EPCIS's context fields. Together they are the most
widely deployed *event-shape* standard in logistics - the shape that DSCSA (US pharma),
EU FMD and GS1 food-traceability programmes all serialize to.

- **S1 Kind** - `message-standard` with a formal `ontology` companion (the repo ships
  OWL/RDF + SHACL at `captured/EPCIS/Ontology/`). Not a domain/reference model: it
  deliberately has no business entities, only events about identified objects.
- **S2 Adoption / maturity** - 3. EPCIS 1.0 dates to 2007, 2.0 is ratified and in
  production use across pharma, retail and food; the repo's own README points at the
  ratified artefacts at `https://ref.gs1.org/standards/epcis`
  (`captured/EPCIS/README.md` L16-22).
- **S3 Openness** - `public`. Apache-2.0 on the repo (`captured/EPCIS/LICENSE`); the
  ratified standards are free downloads under GS1 IP policy.
- **S4 Evidence grade** - **B**. We read the *machine-readable normative artefacts*
  cover to cover (JSON Schema, the EPCIS and CBV ontologies including every
  `rdfs:comment` definition, the REST binding, the query-language schema) plus the
  draft implementation-guideline sections. We did **not** read the ratified prose
  specification documents, where the SHALL/SHOULD conformance rules live. Where a
  definition is quoted below it comes from the ontology, which carries the standard's
  own wording.

### What we could not see

- **The EPCIS 2.0 and CBV 2.0 prose specifications** (PDF, at ref.gs1.org). Not in
  `captured/`. Anything about capture/query *conformance obligations*, event-ordering
  guarantees, or the normative "EPCIS Capturing Application" role is therefore inferred
  from artefact comments, not read.
- **This repo is the 2.0 *development* repo, not the ratified release.** Its README
  states public review closed 11 Nov 2021 and points elsewhere for "the current ratified
  standards" (`captured/EPCIS/README.md` L4-22). Field names and vocabularies matched
  what we would expect of 2.0.0 throughout, but the artefacts here may differ in detail
  from 2.0.1. `captured/EPCIS/public_review_2_1/` holds a 2.1 draft context we did not
  diff.
- **The Conformance Requirements matrices**
  (`captured/EPCIS/Conformance Requirements/1 Functional Requirements/`) - listed, not read.
- **Binary diagrams** (`captured/EPCIS/Diagrams/*.png`) - not read.
- **The GS1 Tag Data Standard**, which defines the EPC URI schemes
  (`urn:epc:id:sgtin:...`, `sgln`, `sscc`) that EPCIS identifiers draw on. Referenced by
  `Ontology/EPCIS.ttl` L642 but not captured here.

## Model summary

EPCIS models **one thing only: an event**. There is no order, no shipment, no trip, no
party record. Everything else is either an identifier inside an event or "master data"
hung off an identifier.

Every event answers **four dimensions**, and 2.0 adds a fifth:

| Dimension | Fields | Meaning |
| --- | --- | --- |
| **What** | `epcList` / `quantityList` / `parentID` / `childEPCs` / `inputEPCList` / `outputEPCList` | which objects the event is about, by instance (EPC) or by class + quantity + uom |
| **When** | `eventTime`, `recordTime`, `eventTimeZoneOffset` | when the capturing application asserts it happened; when the repository stored it; the offset in force *at the place it happened* |
| **Where** | `readPoint`, `bizLocation` | where it was observed vs. where the objects now are |
| **Why** | `bizStep`, `disposition`, `persistentDisposition`, `bizTransactionList`, `sourceList`, `destinationList`, `action`, `ilmd` | the business context |
| **How** (2.0) | `sensorElementList` | sensor/telemetry evidence attached to the business event |

The How dimension is explicitly a *business-oriented aggregation* of telemetry, not a
raw feed: "EPCIS is not meant to transmit raw sensor data dumps... organisations should
model EPCIS events transmitting sensor data very carefully"
(`captured/EPCIS/Implementation Guideline/Section3.5NEW_TheHOWDimension.md`;
`Section5dot9.md` L3). The raw stream is referenced by URI (`sensorReport.rawData`), not
embedded. **This is the cleanest statement we have found anywhere of where telemetry
stops and events begin** - the exact question A4 asks.

Five concrete event types specialize a common `Event` base
(`captured/EPCIS/EPCIS-JSON-Schema.json` L395-425, L1087, L1286, L1429, L1574, L1823):

- **ObjectEvent** - something happened to these objects. The workhorse.
- **AggregationEvent** - these children were put into / taken out of this parent
  ("a strong physical relationship ... until such time as they are disaggregated",
  `Ontology/EPCIS.ttl` L68-72).
- **AssociationEvent** - a *longer-lived* association, including object-to-*location*;
  2.0 added it precisely because AggregationEvent was being abused for permanent
  installs (`Ontology/EPCIS.ttl` L77-79; `Implementation Guideline/Section5dot10.md`).
- **TransactionEvent** - declares "these objects are (or are no longer) associated with
  these business transactions" *unequivocally*, as opposed to the merely contextual
  `bizTransactionList` on other event types (`Ontology/EPCIS.ttl` L93-95).
- **TransformationEvent** - these inputs became these outputs; `transformationID` chains
  several events into one long-running transformation.

Plus **Extended-Event**: any `type` not in the five falls through to a generic event
shape (`EPCIS-JSON-Schema.json` L154-183), so vendors can mint event types.

Events are carried in an **EPCISDocument** with `schemaVersion`, `creationDate`,
`sender`, `receiver`, `instanceIdentifier`, an `epcisHeader.epcisMasterData` block and
`epcisBody.eventList` (L2099-2173). Query results come back as an **EPCISQueryDocument**
carrying `queryName` + `subscriptionID` (L2208-2240).

## Vocabulary

Terms in the source's own spelling; definitions quoted or condensed from
`captured/EPCIS/Ontology/*.ttl`.

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `EPCISEvent` | "A logistics event. This is a common superclass (base type) for all EPCIS events." | A4 | Ontology/EPCIS.ttl L61-65 |
| `eventTime` | "The date and time at which the EPCIS Capturing Applications **asserts** the event occurred." | A4 | Ontology/EPCIS.ttl L471-476 |
| `recordTime` | "The date and time at which this event was recorded by an EPCIS Repository... does not describe anything about the real-world event, but is rather a bookkeeping mechanism that plays a role in the interpretation of standing queries." Ignored on capture, present on query. | A4 | Ontology/EPCIS.ttl L743-748 |
| `eventTimeZoneOffset` | "The time zone offset **in effect at the time and place the event occurred**." Mandatory on every event. | A4 | Ontology/EPCIS.ttl L481-486; EPCIS-JSON-Schema.json L407-410, L421-424 |
| `readPoint` | "The read point at which the event took place." | A3, A4 | Ontology/EPCIS.ttl L713-718 |
| `bizLocation` | "The business location where the objects associated with the EPCs may be found, **until contradicted by a subsequent event**." | A3, A4 | Ontology/EPCIS.ttl L212-217 |
| `action` | "How this event relates to the lifecycle of the EPCs named in this event." `ADD` / `OBSERVE` / `DELETE`. | A2, A4 | Ontology/EPCIS.ttl L201-206; JSON-Schema L464-471 |
| `bizStep` | The business process step. 41 CBV values. | A4 | JSON-Schema L472-524 |
| `disposition` | Business condition of the objects *after* the event. 32 CBV values. | A4 | JSON-Schema L525-569 |
| `persistentDisposition` | Dispositions explicitly `set` / `unset` by this event, persisting until changed. | A4 | JSON-Schema L570-611 |
| `bizTransaction` | `{type, bizTransaction}` - a typed URI reference to a business document. | A6, A9 | JSON-Schema L659-673 |
| `source` / `destination` | `{type, source}` - typed endpoint of the *business transfer* this event is part of. | A8, A9 | JSON-Schema L689-720 |
| `owning_party` | "the party who owns (or is intended to own) the objects at the originating endpoint or terminating endpoint ... of the business transfer". | A8 | Ontology/CBV.ttl L827-832 |
| `possessing_party` | "the party who has (or is intended to have) **physical possession** of the objects at the originating endpoint or terminating endpoint". | A8 | Ontology/CBV.ttl L834-840 |
| `location` (SDT) | source/destination as a physical location; "SHOULD be consistent with the Read Point specified in that event". | A3, A9 | Ontology/CBV.ttl L820-825 |
| `errorDeclaration` | "indicates that this event serves to assert that the assertions made by a prior event are in error." | A4, A6 | Ontology/EPCIS.ttl L451-456 |
| `declarationTime` | "The date and time at which the declaration of error is made. (Note that the eventTime of this event must match the eventTime of the prior event being declared erroneous...)" | A4 | Ontology/EPCIS.ttl L348-353 |
| `correctiveEventIDs` | Events "intended to replace the erroneous event". | A4, A6 | Ontology/EPCIS.ttl L329-334 |
| `ilmd` | "Instance/Lot master data that describes the objects **created during this event**." Legal only when `action=ADD`. | A2 | Ontology/EPCIS.ttl L521-526; JSON-Schema L1247-1283 |
| `certificationInfo` | "CertificationDetails relevant for Objects, Places and/or Organizations mentioned in this Event". | A6 | Ontology/EPCIS.ttl L271-276 |
| `sensorElement` | Optional `sensorMetadata` + one or more `sensorReport`. | A4 | JSON-Schema L1032-1059 |
| `transformationID` | Links TransformationEvents "having an identical value of transformationID" into one long-running transformation. | A4 | Ontology/EPCIS.ttl L879-884 |
| `epcisMasterData` / `vocabularyElement` | `{id, attributes[], children[]}` - hierarchical master data for locations, parties etc., carried in the document header. | A8, A9 | JSON-Schema L252-324 |

### Business steps worth quoting verbatim (A4, C2)

These are the distinctions the rubric's C2 explicitly asks for, and CBV states them:

- **`shipping`** - "Indicates the **overall process** of `staging_outbound`, `loading`
  and `departing`. It may be used when more granular process step information is unknown
  or inaccessible... The use of `shipping` is **mutually exclusive** from the use of
  `staging_outbound`, `departing`, or `loading`." (`Ontology/CBV.ttl` L421-427)
- **`loading`** - "an object is loaded into shipping conveyance." (L310-316)
- **`departing`** - "an object leaves a location on its way to a destination." (L223-229)
- **`arriving`** - "an object arrives at a location." Example: "Truckload of a shipment
  arrives into a yard. **Shipment has not yet been received or accepted.**" (L152-158)
- **`receiving`** - "an object is being received at a location and is **added to the
  receiver's inventory**. The use of `receiving` is **mutually exclusive** from the use of
  `arriving` and `accepting`." (L342-348)
- **`accepting`** - "an object **changes possession and/or ownership**." (L143-149)
- **`storing`** - "an object is moved into and out of storage within a location." (L455-461)
- **`holding`** - "an object is **segregated for further review**" - the quarantine /
  exception step. (L276-282)
- **`packing`** / **`unpacking`** - into / out of a larger container; "Aggregation of one
  unit to another typically occurs at this point." (L326-332, L481-487)
- **`void_shipping`** - "declaring that one or more objects in a prior outbound process
  (captured in an EPCIS event having business step `shipping`, `departing`, or
  `consigning`) **were not shipped** (or departed or consigned) as previously indicated."
  (L490-496)

That set - arrive != receive != accept; ship = stage + load + depart as a rollup and you
must pick one level; a first-class *un-ship* step - is directly transplantable to a moving
milestone catalog.

## Lifecycles & events

**There is no lifecycle in EPCIS.** No states, no transitions, no guards, no actor
permissions. This is deliberate: EPCIS asserts observations, and state is whatever a
consumer derives by replaying them. Three partial exceptions:

1. **`action` is a membership lifecycle for the *What* dimension.** `ADD` = these EPCs come
   into existence / into this aggregation here; `OBSERVE` = they were seen; `DELETE` = they
   leave. The JSON Schema enforces a genuine invariant: `ilmd` may appear **only** when
   `action=ADD` (`EPCIS-JSON-Schema.json` L1247-1283), because instance master data
   describes objects created by the event.
2. **`disposition` is a state value carried on the event**, and
   **`persistentDisposition.set` / `.unset`** is an explicit "this flag now holds / no
   longer holds until changed" mechanism (L570-611). State assertion without a state machine.
3. **`errorDeclaration` is a reversal protocol** (see "Time, identity, evidence").

Code lists are quoted **by reference**, not copied wholesale:

- `bizStep` - 41 values, `EPCIS-JSON-Schema.json` L472-524; each defined in the BizStep
  section of `Ontology/CBV.ttl` (approx. L140-500).
- `disposition` - 32 values, L525-569; defined in `Ontology/CBV.ttl` approx. L505-790.
- `bizTransaction-type` (BTT) - `bol`, `cert`, `desadv`, `inv`, `pedigree`, `po`, `poc`,
  `prodorder`, `recadv`, `rma`, `testprd`, `testres`, `upevt`. L634-658; defined at
  `Ontology/CBV.ttl` L43-133.
- `source-dest-type` (SDT) - `owning_party`, `possessing_party`, `location`. L674-688.
- `error-reason` (ER) - `did_not_occur`, `incorrect_data`. L346-359.

**Reason codes are thin.** EPCIS has exactly two reason codes, both about *data
correctness*, and none about *operational* exceptions (delay, refusal, damage found).
Operational exception is expressed as a `disposition` (`damaged`, `stolen`, `expired`,
`recalled`, `non_conformant`, `needs_replacement`) or as a `bizStep` (`holding`,
`inspecting`), not as a reason on a normal event. There is **no free-text reason field at
all** anywhere in the event schema.

## Time, identity, evidence

### Time

**Two-clock model, plus a mandatory offset.** `eventTime` is the asserted occurrence time;
`recordTime` is when the repository stored it and is explicitly *not* about the real world,
existing "to play a role in the interpretation of standing queries" (`Ontology/EPCIS.ttl`
L743-748). Both are queryable independently - `GE_eventTime` / `LT_eventTime` and
`GE_recordTime` / `LT_recordTime` (`REST Bindings/query-schema.json` L318-329). That pair
is exactly what a subscriber needs to say "give me everything recorded since I last polled,
regardless of when it happened" - the late-arriving-event problem.

`eventTimeZoneOffset` is **required on every event** (`EPCIS-JSON-Schema.json` L421-424)
and is defined as the offset at the **place the event occurred**, not the publisher's zone.
For a domain where a stop's local time is the operationally meaningful one, this is the
right primitive, and it is mandatory rather than optional.

**Windows** exist only in the How dimension: `sensorMetadata.startTime` / `endTime` =
"Earliest time of observation period" / "Most recent time of observation period"
(`Implementation Guideline/Section3.5NEW_TheHOWDimension.md` L17-19).

**What is missing: planned and estimated time, entirely.** There is no ETA, no planned
time, no requested time, no appointment window, no date-only type. EPCIS records only what
a capturing application asserts *happened*. An "expected observation failed to occur" can be
captured as an ObjectEvent (`Ontology/EPCIS.ttl` L86), but there is no field for the
expectation itself.

### Identity

Everything is a **URI**. `epcList` entries are EPC "pure identity" URIs
(`urn:epc:id:sgtin:0614141.107346.2017`); locations are GLN-based SGLN URIs;
`bizTransaction` values are URIs; `readPoint.id` / `bizLocation.id` are URIs. Class-level
identity is `epcClass` + `quantity` + `uom` (`EPCIS-JSON-Schema.json` L440-457) - the "we
cannot serialize every carton" case.

**Cross-references are typed, and that is the important part.** A single event can carry:

- N typed business-document references (`bizTransactionList`: `{type: "po", ...}`,
  `{type: "desadv", ...}` - see `captured/EPCIS/JSON/Example_9.6.1-ObjectEvent.jsonld`),
- N typed transfer endpoints (`sourceList` / `destinationList`, each tagged owning-party vs
  possessing-party vs location),
- a parent (`parentID`), and
- a process-chain key (`transformationID`).

**`eventID` is a content hash.** The examples use
`ni:///sha-256;df7bb3c352fef055578554f09f5e2aa41782150ced7bd0b8af24dd3ccb30ba69?ver=CBV2.0`
- an RFC 6920 named-information URI over the canonicalized event, versioned by the CBV
release used to canonicalize it (`JSON/Example_9.6.1-ObjectEvent.jsonld`). `eventID` is
optional on capture: "If event IDs are missing, the server should populate the event ID with
a unique value. Otherwise, it won't be possible to retrieve these events by eventID"
(`REST Bindings/openapi.yaml` L115-116). A deterministic content-derived id gives idempotent
re-delivery for free.

**Identity of the publisher is weak.** The event itself has no "who asserted this" field.
`sender` / `receiver` sit on the enclosing `EPCISDocument` (`EPCIS-JSON-Schema.json`
L2123-2128), so provenance is per-batch, not per-event, and is lost the moment events are
re-hosted by a repository. Contrast DCSA, which puts `publisher` + `publisherRole` in every
event's metadata.

### Evidence, provenance and corrections

This is EPCIS's strongest suit after the event shape itself.

**Corrections have a first-class protocol.** An `errorDeclaration` block carries
`declarationTime` (required), `reason` (`did_not_occur` | `incorrect_data`) and
`correctiveEventIDs[]` (`EPCIS-JSON-Schema.json` L360-394). The semantics are precise:

- The erroneous event is **not deleted or mutated**. A *new* event is published whose
  `eventTime` **must equal** the original's, and whose `declarationTime` says when the
  correction was asserted (`Ontology/EPCIS.ttl` L348-353). Append-only, with the correction
  timestamped separately from the occurrence.
- `did_not_occur` - "The prior event is considered erroneous because it did not actually
  occur. There are no corrective events. (In a CBV-Compliant Document, this error reason
  SHALL NOT be used in an error declaration that contains one or more corrective event
  IDs.)" (`Ontology/CBV.ttl` L796-801). A pure retraction.
- `incorrect_data` - "some or all of the data in the event are incorrect. Subsequent events
  may provide a correct indication of what actually occurred... These events may be linked
  using the corrective event IDs" (L803-809). A replacement with an explicit pointer.
- The separation of *retract* from *supersede*, and the rule that you cannot claim both, is
  a modelling decision worth copying outright.
- Corrections are **queryable**: `EXISTS_errorDeclaration`, `EQ_errorReason`,
  `EQ_correctiveEventID`, `GE_errorDeclaration_Time` / `LT_errorDeclaration_Time`
  (`query-schema.json` L468-489). A consumer can ask "what has been corrected since I last
  synced".

**Evidence pointers.** `certificationInfo` (URIs to certification details);
`bizTransactionList` type `upevt` = "Event ID URI(s) of event(s) provided by an upstream
supplier, such as packing and shipping events (e.g., as the basis for the inferred
completeness of inbound aggregations)" (`Ontology/CBV.ttl` L127-132) - an event citing
*another party's events* as its evidence. `sensorReport.rawData`, `.deviceID`,
`.deviceMetadata`, `.dataProcessingMethod`, `.bizRules` give a full telemetry provenance
chain by reference (`Implementation Guideline/Section3.5NEW_TheHOWDimension.md` L20-34).

**Inference is labelled.** Dispositions include `completeness_verified` vs
`completeness_inferred` (`EPCIS-JSON-Schema.json` L556-557) - the model distinguishes "we
checked" from "we deduced".

### Versioning and extension (C8)

- **Every vocabulary field is `anyOf [ your-own-URI, CBV-enum ]`.** `vocab-other-uri` is
  defined as any URI that does **not** start with `urn:epcglobal:cbv` or
  `https://ns.gs1.org/cbv/` (`EPCIS-JSON-Schema.json` L341-345). So `bizStep`,
  `disposition`, `bizTransaction-type`, `source-dest-type` and `error-reason` are all open:
  mint `https://pegasus.example/cbv/bizstep/sit_in` and it validates. Extension is by
  *namespace*, not by an `OTHER` escape hatch.
- **Unknown event types validate** via `Extended-Event` (L154-183).
- **Arbitrary extension fields** are allowed anywhere a `propertyNames` union includes
  `vocab-uri` - i.e. any namespaced URI key is legal on the event, on `errorDeclaration`, on
  `sensorMetadata`, on the document. The example carries
  `"example:myField": "Example of a vendor/user extension"`.
- **Versioning is explicit and multi-layered**: `schemaVersion` on the document;
  `owl:versionInfo "2.0"` on both ontologies (`Ontology/EPCIS.ttl` L27, `Ontology/CBV.ttl`
  L26); per-term `sw:term_status` (all 112 CBV terms currently `"stable"` - no deprecations
  yet, but the mechanism exists); HTTP headers `GS1-EPCIS-Version` and `GS1-CBV-Version`
  negotiated per request; and the content hash in `eventID` is stamped `?ver=CBV2.0` so a
  hash is tied to the vocabulary release that produced it. The JSON-LD `@context` is a
  required property on every standalone event (`EPCIS-JSON-Schema.json` L2324-2329), which
  pins term meanings.

### Subscription and filtering (directly relevant to our envelope)

Two delivery models, both specified:

- **Poll**: `GET /events`, plus *resource-shaped* shortcuts `/eventTypes/{t}/events`,
  `/epcs/{epc}/events`, `/bizSteps/{s}/events`, `/bizLocations/{l}/events`,
  `/readPoints/{r}/events`, `/dispositions/{d}/events` (`REST Bindings/openapi.yaml`, path
  list L386-2748). Every vocabulary is also a browsable collection.
- **Push**: `POST /queries/{queryName}/subscriptions`. "EPCIS 2.0 implementations must
  support Webhook subscriptions." The subscriber supplies a callback plus a self-generated
  `signatureToken`; the server signs each delivery into a `GS1-Signature` header (HMAC-SHA256
  or JWS). A subscription must set **either** `stream: true` (notify on every match) **or** a
  cron-style `schedule` (`query-schedule.json`: second / minute / hour / dayOfMonth / month /
  dayOfWeek), and `reportIfEmpty` controls whether a scheduled run fires with no matches
  (`openapi.yaml` L2390-2420).

The **query language** (`REST Bindings/query-schema.json`) is the part worth studying: a flat
vocabulary of prefixed predicates - `EQ_`, `GE_`, `GT_`, `LE_`, `LT_`, `MATCH_`, `EXISTS_`,
`WD_` (within-descendants, for location hierarchies) - plus `orderBy` / `orderDirection` /
`eventCountLimit` / `maxEventCount` (L490-505). Filters exist on every dimension including
user extensions (`^EQ_[a-z][a-zA-Z0-9]*\:\w+$`, L617) and nested structures (`EQ_INNER_...`,
`EQ_ILMD_...`, `EQ_SENSORREPORT_...`). Named queries are server-side resources
(`/queries/{queryName}`) that subscriptions then attach to - **the filter is a first-class,
named, reusable object**, not a subscription-time blob.

**Capture is asynchronous and transactional.** `POST /capture` returns `202` plus a
capture-job URL; `GET /capture/{captureID}` reports `running` / `success` /
`captureErrorBehaviour` / `errors`. By default "EPCIS events are only stored if the entire
capture job was successful", overridable with the `GS1-Capture-Error-Behaviour` header
(`openapi.yaml` L110-130, L316-340). Servers advertise `GS1-EPCIS-Capture-Limit` and
`GS1-EPCIS-Capture-File-Size-Limit` via `OPTIONS`. Batch atomicity as an explicit,
negotiable choice is a good pattern.

## Scores

Weighting is decided in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A2** Shipment structure | 1 | 3 | 2 | 0 | n/a | 3 | 3 | 3 | C1: no shipment entity, no services-ordered, no weights beyond generic `quantity` + `uom` (JSON-Schema L440-457); only containment. C2: Aggregation vs Association vs Transaction distinctions are crisply defined (Ontology/EPCIS.ttl L68-99) and the reason 2.0 split them is documented (Impl. Guideline Section5dot10.md). C3: `action` ADD/OBSERVE/DELETE governs membership and `ilmd`-only-on-ADD is a schema-enforced invariant (L1247-1283). C4: retail/pharma containment, not HHG shipment. |
| **A3** Trip, stop & assignment | 1 | 2 | 0 | 0 | 1 | 2 | 2 | 3 | C1: **no trip, no stop sequence, no leg, no vehicle/driver assignment**; only `readPoint`/`bizLocation` per event, sequence implied by `eventTime` ordering. C2: the readPoint-vs-bizLocation distinction is real and well defined (Ontology/EPCIS.ttl L212-217, L713-718), as is SDT `location` (CBV.ttl L820-825). C5: single `eventTime`, no ETA. |
| **A4** Execution events & tracking | 2 | 3 | 1 | 0 | 2 | 3 | 3 | 3 | C1: arrive/depart/load/unload/pack/unpack/ship/receive/store/hold/inspect all present (JSON-Schema L472-524) - but **no ETA, no delay/exception-with-reason, no planned time**; only two data-correctness error reasons (L346-359). C2: best-in-class; see quoted `shipping`/`arriving`/`receiving`/`accepting` definitions (CBV.ttl L143-496). C3: no state machine, no actor permissions; `persistentDisposition` set/unset is the only state mechanism (L570-611). C5: `eventTime` / `recordTime` / mandatory `eventTimeZoneOffset` (Ontology/EPCIS.ttl L471-486, L743-748) - excellent for actual + record + local zone, zero for planned/estimated. C6: typed `bizTransactionList`, `sourceList`, `destinationList` on every event. C7: `errorDeclaration` + `correctiveEventIDs` + `did_not_occur` vs `incorrect_data` (CBV.ttl L796-809); sensor provenance chain (Impl. Guideline Section3.5 L20-34). C8: `vocab-other-uri` (L341-345), `Extended-Event` (L154-183), `@context`, `schemaVersion`, `sw:term_status`. |
| **A5** Storage-in-transit | 1 | 2 | 0 | 0 | 1 | 2 | 2 | 3 | C1: only the `storing` and `holding` business steps (CBV.ttl L455-461, L276-282) plus `sellable_not_accessible` / `unavailable` dispositions. **No SIT concept, no in/out pairing, no duration, no warehouse-as-stop, no permanent-storage boundary.** C2: both steps are properly defined, but `storing` is explicitly "into **and out of** storage", so one step covers both directions - a problem for us, not a virtue. A SIT-shaped worked example (interim storage -> cold storage -> shipping area, each a `storing` ObjectEvent) is at Impl. Guideline Section5dot9.md. |
| **A6** Documents & evidence | 2 | 3 | 0 | 0 | n/a | 3 | 3 | 3 | C1: documents appear only as typed *references* (`bizTransactionList`, 13 BTT values, JSON-Schema L634-658); no document entity, content, version or status. Evidence side is strong: `certificationInfo`, `upevt`, sensor `rawData`. C2: every BTT defined (CBV.ttl L43-133) - e.g. `desadv` "by means of which the seller or consignor informs the consignee about the despatch of goods". C3: **no document status or lifecycle at all** - the single biggest gap vs DCSA's `shipmentEventTypeCode`. C4: `bol` and `inv` only; no inventory, weight ticket, POD or order for service. C7: error declaration; `upevt` cites upstream parties' events as the basis for an inference (CBV.ttl L127-132); `completeness_verified` vs `completeness_inferred` (L556-557). |
| **A8** Parties & roles | 1 | 3 | n/a | 0 | n/a | 3 | 1 | 3 | C1: exactly two party roles exist (`owning_party`, `possessing_party`), and only as transfer endpoints; plus document-level `sender`/`receiver` (L2123-2128) and master-data `vocabularyElement` (L252-274). No agent / carrier / driver / warehouse notion. C2: the owning-vs-possessing-party distinction is defined precisely (CBV.ttl L827-840) and is exactly the custody-vs-ownership split HHG needs. C4: zero HHG roles. C7: **per-event publisher is absent** - provenance is per-document only. |
| **A9** Identity & cross-references | 3 | 3 | n/a | 0 | n/a | 3 | 2 | 3 | C1: instance ids (EPC URIs), class ids (`epcClass` + qty + uom), location ids, party ids, document ids, event ids, process-chain ids (`transformationID`), parent ids - all present, all typed. C2: `readPoint` vs `bizLocation`; SDT `location` "SHOULD be consistent with the Read Point" (CBV.ttl L820-825). C6: multiple typed references per event, correlatable and queryable (`EQ_bizTransaction_*`, `EQ_source_*`, `EQ_destination_*` pattern properties, query-schema.json L599-616). C7: ids carry no issuer/assertion metadata beyond master data. C8: URI namespacing means any party's id scheme drops in. |

**Not covered at all:** **A1** (order & service lifecycle - EPCIS has no order, no
offer/award/accept, no booking; `bizTransaction` type `po` is a bare reference), **A7**
(charges & billing - only `inv` as a document-reference type; no monetary field exists
anywhere in the schema), **A10-A13** (see "Out-of-v1 material").

### S5 - fit to Pegasus data

| Area | Fit | Note |
| --- | --- | --- |
| A2 | `unknown` | Whether pegII carries a stable per-piece or per-lot identifier (inventory tag numbers) that could act as an `epcList` member is unknown to this analysis; the pegII / Cloud source readers must answer. |
| A3 | `no` | EPCIS has nothing here to supply *to*; pegII trip/stop data has no EPCIS home. |
| A4 | `partial` | pegII is form-and-save CRUD, so an "event" is a row edit. It can almost certainly supply *actual* milestone times and a location; the mandatory `eventTimeZoneOffset` (offset **at the stop**) is very likely **not** stored - pegII probably holds a naive local or server-zone datetime. A real migration question, not a formatting one. |
| A5 | `no` | EPCIS supplies no SIT concept to map to. |
| A6 | `partial` | pegII certainly has document numbers (BOL, order) that map to `bizTransaction`; document *status* has no EPCIS target. |
| A8 | `partial` | pegII's agent roles are far richer than owning/possessing party; only the custody/ownership axis maps. |
| A9 | `yes` | Every pegII identifier can be minted as a URI in our own namespace and carried in a typed reference - the one area where EPCIS's shape imposes no cost. |

## Strengths worth adopting

1. **The five-dimension frame - What / When / Where / Why / How - as the skeleton of our
   envelope.** A genuinely complete checklist for "did I say enough about this event", and
   the How dimension gives a designated, bounded home for Samsara / Omnitracs telemetry that
   keeps it *out* of the business payload.
2. **Telemetry by reference, not by value.** "EPCIS is not meant to transmit raw sensor data
   dumps... provide applications business-oriented, aggregated sensor data", and point at the
   raw stream with `rawData` (Section5dot9.md L3). This is the answer to "where does telemetry
   stop and an event begin" for A4, stated by an industry standard rather than invented by us:
   a position ping is not an event; "arrived, evidenced by this geofence crossing at this
   device" is.
3. **`eventTime` vs `recordTime` as two independent, independently queryable clocks**, with
   `recordTime` explicitly declared to be about bookkeeping and standing queries, not about
   the world. Our catalog needs exactly this so a consumer can resync on record order while
   reporting on occurrence order.
4. **Mandatory time-zone offset defined as the offset at the place of occurrence** - not the
   publisher's zone, not UTC-only. For a domain whose facts are "the crew arrived 8am local at
   the residence", this should be a required field, and EPCIS shows it is affordable.
5. **The correction protocol**: append-only, `eventTime` preserved, `declarationTime`
   separate, and `did_not_occur` (retract; successor forbidden) distinguished from
   `incorrect_data` (supersede; successor linked). Copy nearly verbatim, including the rule
   that a retraction MUST NOT carry corrective ids - it forces the publisher to decide which
   thing they mean.
6. **Corrections are queryable as a class** (`EXISTS_errorDeclaration`, `EQ_errorReason`,
   `EQ_correctiveEventID`). A catalog that supports corrections but hides them from filters has
   only half-solved the problem.
7. **Rollup steps explicitly mutually exclusive with their components.** `shipping` =
   staging_outbound + loading + departing, and using `shipping` excludes the three. We face the
   identical problem with "loaded" vs pack-day / load-day / depart, and "delivered" vs unload /
   placement / setup. Publishing both granularities without a stated exclusivity rule is how
   double-counting starts.
8. **`arriving` != `receiving` != `accepting`**, with `arriving`'s example spelling out
   "Shipment has not yet been received or accepted". Custody, inventory and possession are
   three separate assertions; HHG needs the same triad at destination and at a warehouse.
9. **`void_shipping`** - a named step for "the outbound event I published did not happen as
   stated", distinct from a data-error correction. Operational reversal and data reversal are
   different, and both are needed.
10. **Open vocabularies by namespace.** `anyOf [ non-CBV URI, CBV enum ]` lets a tenant mint a
    value without a spec revision and without an `OTHER` bucket that destroys filterability.
11. **Content-hash event ids** (`ni:///sha-256;...?ver=CBV2.0`) with the vocabulary version
    baked into the hash: free idempotency under at-least-once delivery, and `?ver=` guards
    against a hash silently changing meaning across vocabulary releases.
12. **`persistentDisposition.set` / `.unset`** - assert that a flag now holds or no longer
    holds, without inventing a state machine. Good fit for "flagged for reweigh", "on hold for
    payment".
13. **Named, server-side, reusable queries that subscriptions attach to**, plus a filter
    grammar with a designated prefix for user-extension fields.
14. **`completeness_verified` vs `completeness_inferred`** - label whether a fact was checked
    or deduced. Directly applicable to inventory reconciliation at delivery.
15. **`upevt`: cite another party's event id as the evidence for your own event.**
    Cross-party provenance with no shared database - exactly what a van-line / agent / driver
    chain needs.

## Weaknesses / traps

1. **EPCIS has no notion of an order, a shipment, a trip or a stop. Do not let its shape
   become our model.** It is an *envelope and vocabulary* source, not a domain source.
   Adopting it wholesale would force us to express "shipment 12345" as a URI in `epcList` -
   modelling a business aggregate as a tracked physical object. That works right up until the
   shipment splits across two trips or is partly in SIT, at which point the abstraction
   collapses.
2. **No planned or estimated time. At all.** A moving catalog is roughly half forward-looking
   - pack date, load date, RDD, spread dates, ETA, appointment window. Take DCSA's
   `eventClassifierCode` for this and EPCIS's shape for everything else; do not take EPCIS's
   time model whole.
3. **No per-event publisher.** `sender` / `receiver` live on the document (L2123-2128), so
   once events are aggregated by a repository you lose who asserted what. "The hauling agent
   says loaded" and "the driver's device says loaded" are different facts with different trust.
4. **Two reason codes, both about data quality, and no free-text reason.** Our domain runs on
   operational reasons - delayed for weather, refused delivery, shipper not ready, held for
   storage charges. Do not inherit this scarcity.
5. **`storing` covers into-and-out-of storage in one step** (CBV.ttl L455-461). For SIT, in
   and out are separate, dated, chargeable and often months apart. Reusing `storing` for both
   would destroy the distinction A5 most needs.
6. **Documents have no status.** EPCIS can say "this event relates to BOL X"; it cannot say
   "BOL X was issued / amended / voided". Half of what customers want from T&T is document
   status.
7. **`disposition` conflates state-of-object with business state**, and the enum is
   pharma/retail-shaped (`retail_sold`, `dispensed`, `no_pedigree_match`,
   `partially_dispensed`). Mining it for HHG values is not worth the confusion.
8. **Anything can be a URI, so anything can be an opaque string.** The typed-reference
   discipline is only as good as the namespace governance behind it. Adopting
   `vocab-other-uri`-style extension means owning a registry of our URIs.
9. **The sensor model is bolted on and carries a 70+ value physical-quantity enum**
   (L775-858). Almost none applies; take the *pattern* (metadata + reports + provenance by
   reference), not the enum.
10. **We read artefacts from the 2.0 development repo, not the ratified standard.** Before
    anything here is normative for us, diff the captured JSON Schema and ontology against the
    ratified 2.0.1 artefacts at `https://ref.gs1.org/standards/epcis/artefacts`.

## Out-of-v1 material

- **A10 (survey, estimating & inventory).** `ilmd` (instance/lot master data attached at the
  moment of creation, ADD only) is the structural answer to "attributes true of this item from
  birth" - an inventory item's declared condition at survey would sit there. `epcisMasterData`
  / `vocabularyElement` with `attributes[]` and `children[]` (JSON-Schema L252-291) gives a
  hierarchical attribute store for locations and items, with `WD_readPoint` / `WD_bizLocation`
  (within-descendants) queries over the hierarchy (query-schema.json L384-401). The
  `inspecting` bizStep and the `damaged` / `non_conformant` / `needs_replacement` dispositions
  (CBV.ttl L569-575) are the condition vocabulary.
- **A11 (claims & valuation).** `damaged` is defined as "Object is impaired in its usefulness
  and/or reduced in value due to a defect", with business steps `accepting`, `inspecting`,
  `receiving`, `removing`, `repairing`, `replacing` listed as the ones it co-occurs with, and
  an explicit note that damage may be *non-apparent* and detected from sensor data (CBV.ttl
  L569-575). A usable skeleton for exception-at-delivery -> claim. `certificationInfo` and the
  `cert` / `testres` document types are the evidence hooks. No valuation, no claim lifecycle,
  no money.
- **A12 (rating & tariffs).** Nothing. No monetary field exists in EPCIS.
- **A13 (crew, driver & settlement).** Nothing. No person, no crew, no assignment.
- **Beyond the rubric:** `AssociationEvent` for object-to-location and long-lived
  object-to-object bonds (Impl. Guideline Section5dot10.md) is the right primitive if we ever
  model equipment (trailer, container, lift van, vault) as a durable asset with installed
  components - relevant to warehouse vault management.

## Open questions

1. **Does pegII store a time-zone offset (or any zone) with milestone timestamps, or only a
   naive local/server datetime?** EPCIS makes offset-at-the-place mandatory; if pegII cannot
   supply it, our envelope must choose between making it optional (living with ambiguity) or
   deriving it from the stop's location (owning the derivation). A question for the pegII
   source analysis, and load-bearing.
2. **Do we want a content-hash event id?** Free idempotency, but it requires a
   canonicalization spec and freezes the meaning of "the same event". Cheap at design time,
   near-impossible to retrofit.
3. **Retract vs supersede - do we need EPCIS's strict separation, or is one `correction` event
   with a reason code enough?** EPCIS's rule (a retraction may not name a successor) catches a
   real mistake; decide deliberately rather than by default.
4. **Is a rollup milestone plus its components acceptable in our catalog if we state
   exclusivity, or should the catalog only ever publish one granularity?** EPCIS chose "both,
   mutually exclusive"; DCSA chose "one granularity, classified". The answer probably differs
   for Pegasus II (coarse, form-and-save) vs Cloud (fine).
5. **Who is the "capturing application" in our world, and is per-event publisher identity a
   required field?** Given agent / van line / driver device / partner as distinct assertion
   sources, we probably need it required - confirm against A8's answer on party roles.
6. **Should our vocabulary fields be open (URI-or-enum, EPCIS style) or closed (enum-only,
   DCSA style)?** Open means tenants extend without a release; closed means a consumer can
   exhaustively switch on the value. The biggest C8 decision in the catalog; make it once, in
   phase 4, not per field.
7. **What does the ratified 2.0.1 artefact set differ on?** Someone should do that diff before
   we cite line numbers from this repo as normative.
