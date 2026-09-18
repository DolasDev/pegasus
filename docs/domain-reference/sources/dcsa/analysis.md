---
source: src:dcsa
analyzed: 2026-09-17
evidence_grade: A
material: |
  All paths below are relative to docs/domain-reference/ and live under
  sources/dcsa/captured/DCSA-OpenAPI/.
  Read in full or in substantial part:
  - tnt/v3/tnt.yaml (Track & Trace 3.0.0-Beta-1, all 1180 lines incl. worked examples)
  - tnt/v3/README.md, tnt/v2/README.md (changelogs = the versioning policy in practice)
  - domain/event/event_domain_v3.1.0.yaml (the event shape and every T&T code list)
  - domain/event/README.md (release history)
  - domain/dcsa/dcsa_domain_v3.0.0.yaml (referenceType, delayReasonCode, transportCall
    references, voyage/service references, equipmentReference, emptyIndicatorCode,
    Api-Version-Major)
  - bkg/v2/BKG_v2.0.5.yaml (booking lifecycle: bookingStatus / amendedBookingStatus /
    bookingCancellationStatus, ShipmentLocation, Transport leg, Charge,
    OtherDocumentParty, notification model)
  - jit/v2/JIT_v2.0.0.yaml (Timestamp, TerminalCall, PortCallService - the ERP-A model)
  - jit/v2/README.md
  - README.md (repo scope)
  Not read - see "What we could not see".
---

# DCSA (Digital Container Shipping Association) OpenAPI standards - analysis

## What it is

DCSA is the standards body founded by the major container carriers (Maersk, MSC,
CMA CGM, Hapag-Lloyd and others) to publish "vendor-neutral, technology-agnostic
standards for IT and non-competitive business practices" (`README.md`). Its output is a
set of versioned OpenAPI interface standards plus shared "domain" component libraries -
Track & Trace (TNT), Booking (BKG), Port Call / Just-in-Time (JIT), Operational Vessel
Schedules (OVS), Commercial Schedules (CS), electronic Bill of Lading (EBL/PINT), Reefer,
IoT, and Event Hubs.

For our purposes it is **the best-documented working example of a multi-party logistics
event catalog**: a carrier publishes events, a shipper or visibility provider subscribes,
and the whole thing has been through five major versions of real-world adoption pressure.

- **S1 Kind** - `message-standard` (a family of API interface standards). It is *backed
  by* a reference model - the DCSA Information Model - which is referenced from the specs
  but is a separate PDF we do not hold.
- **S2 Adoption / maturity** - 3 for the ocean-container industry. Member carriers move
  the large majority of global container volume and implement these interfaces; T&T is on
  its third major version with a documented changelog per release. Adoption **outside**
  container shipping is ~0, which matters for us (see "Weaknesses").
- **S3 Openness** - `public`. Apache-2.0 (`LICENSE`, and `info.license` in every spec).
- **S4 Evidence grade** - **A**. These OpenAPI documents *are* the normative artefacts;
  there is no separate prose standard that overrides them. We read the T&T 3.0 spec, its
  event domain, the DCSA shared domain, the Booking 2.0.5 spec and the JIT 2.0 spec
  directly, including descriptions and worked examples.

### What we could not see

- **The DCSA Information Model PDF** (`DCSA_Information-Model-2022.Q4-final.pdf`,
  referenced at `tnt/v3/tnt.yaml` L8). Not captured. The conceptual entity-relationship
  rationale behind the API shapes is therefore inferred from the APIs, not read.
- **The reference-data CSVs on the DCSA-Information-Model GitHub repo**
  (`shipmenteventtypecodes.csv`, `equipmenteventtypecodes.csv`,
  `transporteventtypecodes.csv`, `documenttypecodes.csv`, `referencetypes.csv`,
  `publisherrole.csv`, `operationseventtypecodes.csv`). Every code list in the OpenAPI
  says "More details can be found on GitHub" and links there. What we have is
  **code + short label only** - e.g. `GTIN (Gated in)` - not the authoritative
  definition. This is the main cap on C2 for the event-code lists. Only
  `domain/dcsa/reference-data/imoclasses-v3.1.0.csv` and a handful of EBL
  code-list-provider CSVs are captured locally.
- **The eBL folders were pruned from this capture** (no `ebl/`, `ebl_iss/`, `ebl_sur/`
  directories; `pint/` survives). The task brief flagged this. It affects A6 most: the
  electronic bill of lading's own document lifecycle, issuance and surrender semantics are
  not available here. `bkg/v2` still exposes the `SURR` (Surrendered) and `ISSU` (Issued)
  shipment-event codes, and `documentTypeCode` `TRD` (Transport Document), so the *hooks*
  are visible even though the eBL spec is not.
- **SMDG code list DELAY** - `delayReasonCode` is defined by reference to
  `https://smdg.org/documents/smdg-code-lists/delay-reason-and-port-call-activity/`
  (`domain/dcsa/dcsa_domain_v3.0.0.yaml` L479-485). The actual delay-reason values are
  **not** in this capture and were not fetched. Example values seen: `WEA` (weather),
  `STR` (strike). **This is the one code list most directly relevant to A4's
  "exceptions/delays with reasons" and we do not have it.**
- We did not read OVS, CS, Reefer, IoT, the Event Hub specs, `an/` (Arrival Notice),
  `cbf/`, `dei/`, `deo/`, `adopt/`, or `reference-data/` beyond the listing.

## Model summary

### The T&T event shape (this is the part that matters most for our envelope)

T&T 3.0 restructured the event from a flat object into **`metadata` + `payload`**
(`tnt/v3/README.md` L8, L20; `domain/event/event_domain_v3.1.0.yaml` L707-755):

```
event
  metadata           (common to every event type; mandatory)
    eventID                  string, <=100 chars   - "the unique identifier for this
                                                     event (*the message - not the source*)"
    eventCreatedDateTime     date-time             - when the event was created
    retractedEventID         string, optional      - if present, this event RETRACTS that one
    publisher                {partyName, carrierCode, carrierCodeListProvider}
    publisherRole            CA | AG | VSP | SVP
    eventType                SHIPMENT | EQUIPMENT | TRANSPORT   (the discriminator)
  payload            (conditional: MUST be absent if retractedEventID is present)
    eventClassifierCode      ACT | PLN | EST  (| REQ elsewhere)
    eventDateTime            date-time  - "when the event took place or WILL take place"
    ...type-specific business attributes
```

Two things about this shape are worth more than the rest of the spec combined:

1. **The envelope/payload split is explicit and named.** `metadata` is "all non-business
   related attributes" (L826); `payload` is "the business attributes related to the
   `ShipmentEvent`" (L843). A retraction is metadata-only, which is why the payload is
   conditional. Our catalog needs exactly this seam.
2. **Every event names its own publisher and the *role* that publisher played** - a
   carrier (`CA`), a carrier's local agent (`AG`), a visibility service provider (`VSP`),
   or any other service provider (`SVP`) (L2603-2622). Made mandatory in event domain
   3.1.0 (`domain/event/README.md`, v3.1.0 bullet: "`publisher` and `publisherRole` added
   as part of the `metadata` object and **made mandatory** to provide"). In a
   multi-party chain where the same fact can be asserted by several parties with different
   authority, this is the fix for EPCIS's biggest provenance gap.

### The three event types - the split we were asked to look at

| Type | What it is about | Required payload fields | Cite |
| --- | --- | --- | --- |
| **ShipmentEvent** | "all events related to **documents**" - the status of a document in a process | `shipmentEventTypeCode`, `documentTypeCode`, `documentReference` | event_domain L762-816 |
| **TransportEvent** | "all events related to **transportation**" - a conveyance arriving at or departing from a call | `transportEventTypeCode`, `transportCall` | L858-906 |
| **EquipmentEvent** | "all events related to **equipment (containers)**" - what happened to a physical unit | `equipmentEventTypeCode`, `emptyIndicatorCode` | L948-1069 |

That is a genuinely useful three-way cut and it is **not** the cut we would naively make:

- The **document** axis is separate from the **physical** axis. "Booking confirmed",
  "B/L issued", "shipping instruction rejected" are ShipmentEvents - they are status
  transitions of a *document*, carrying `documentTypeCode` + `documentReference` so the
  consumer knows *which* document changed state. Nothing physical moved.
- The **conveyance** axis (TransportEvent: the truck/vessel/train arrived or departed) is
  separate from the **cargo unit** axis (EquipmentEvent: the container was loaded,
  discharged, gated in, stuffed, stripped). One truck arriving can carry ten containers;
  ten container-load events can happen on one vessel call. **Conflating these is exactly
  the trip-vs-shipment error the brief asks about**, and DCSA resolves it by making the
  conveyance a separate event stream that cargo events *reference* rather than duplicate.
- Notably, **TransportEvent has only two codes: `ARRI` (Arrived) and `DEPA` (Departed)**
  (L2623-2635). Everything else that happens to a journey is either an equipment event or
  a JIT port-call-service timestamp. The conveyance stream is deliberately tiny.

Reefer and IoT events exist as further payload types in the event domain (L691-706,
L1207-1420) but are separate APIs, not part of T&T 3.0's `eventTypes` enum.

### Trip vs shipment, and stops

DCSA's answer is the **TransportCall** (`event_domain_v3.1.0.yaml` L1831-1905):

- A `transportCall` is *one visit by one conveyance to one place* - identified by
  `transportCallReference` ("a carrier defined reference to a `TransportCall`... In the
  case the Means of Transport is a `Vessel` and the facility is a `Port`/`Terminal` this
  reference should be considered a **Terminal Call Reference**",
  `domain/dcsa/dcsa_domain_v3.0.0.yaml` L1534-1541).
- **`transportCallSequenceNumber`** - "Transport operator's key that uniquely identifies
  each individual call. **This key is essential to distinguish between two separate calls
  at the same location within one voyage**" (L1547-1552). That is the stop-sequence
  problem stated exactly, and solved by an explicit sequence number rather than by
  ordering on time.
- It is polymorphic on **`modeOfTransport`** with a discriminator:
  `vesselTransportCall`, `bargeTransportCall`, `railTransportCall`, `truckTransportCall`
  (L1890-1902). Each carries mode-appropriate identity: a vessel has IMO number + voyage
  numbers; a **truck has `licencePlate` and `chassisLicencePlate`** (L1938-1963); a rail
  call has `railCar`, `railService`, `departureID`.
- Location is itself polymorphic on `locationType`: `UNLO` (UN location code), `FACI`
  (facility), `ADDR` (address), `GEOL` (geolocation) (L1844-1863).
- `facilityTypeCode` says what *role* the facility plays in this call: `BORD` (border),
  `CLOC` (**customer location**), `COFS` (container freight station), `OFFD` (off-dock
  storage), `DEPO` (depot), `INTE` (inland terminal), `POTE` (port terminal), `RAMP`,
  `WAYP` (waypoint) (L1866-1889).
- Above the call sits the **voyage / service**: `carrierServiceCode` +
  `universalServiceReference`, `carrierExportVoyageNumber` /
  `carrierImportVoyageNumber` + `universalExportVoyageReference` /
  `universalImportVoyageReference` (dcsa_domain L237-275, L1617-1640).

And in JIT, one level finer: a **PortCall** contains N **TerminalCalls**
(`terminalCallSequenceNumber` = "A sequential number assigned to each **Terminal Call**
within a **Port Call**, indicating the order in which the calls are **scheduled** to
occur", `jit/v2/JIT_v2.0.0.yaml` L3195-3200), each containing N **PortCallServices**
(berth, cargo operations, pilotage, towage, mooring, bunkering), each with N
**Timestamps**. A terminal call can be **`omitted`** - a boolean, read-only, "set to
`true` it indicates that the **Terminal Call** has been omitted by the carrier" (L3262-3269).

The **Transport Plan** in Booking is the planned counterpart: "A single `leg` of the
`Transport Plan`", with `transportPlanStage` = `PRC` (Pre-Carriage) / `MNC` (Main Carriage)
/ `ONC` (On-Carriage), a `transportPlanStageSequenceNumber`, a `loadLocation` and a
`dischargeLocation`, `plannedDepartureDate` / `plannedArrivalDate` (date-only), and
`modeOfTransport` including combined modes (`RAIL_TRUCK`, `BARGE_TRUCK`, `MULTIMODAL`)
(`bkg/v2/BKG_v2.0.5.yaml` L7154-7212).

**So the full hierarchy is:** service -> voyage -> port call -> terminal/transport call
(sequenced) -> port call service -> timestamp; and, orthogonally, booking -> transport plan
-> leg (sequenced, staged) -> shipment locations. Cargo (equipment) events reference the
call; they never contain the journey.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `metadata` / `payload` | "The `metadata` ... includes all non-business related attributes"; payload = "The business attributes related to the ...Event". | A4 | event_domain L826, L843 |
| `eventID` | "The unique identifier for this event (*the message - not the source*)." string <=100. | A4, A9 | event_domain L2286-2291 |
| `eventCreatedDateTime` | "The timestamp of when the event was created." | A4 | event_domain L2292-2297 |
| `eventDateTime` | "The local date and time, when the event took place **or when the event will take place**." | A4 | event_domain L2298-2303 |
| `eventClassifierCode` | "Code for the event classifier. Values can vary depending on eventType": `ACT` (Actual), `PLN` (Planned), `EST` (Estimated), `REQ` (Requested). | A4 | event_domain L2272-2285; per-type constraints L776-781, L866-876, L956-966 |
| `retractedEventID` | "Reference to an Event that is to be retracted. If provided, the `payload` of the event **MUST not** be included." | A4 | event_domain L2509-2515 |
| `publisher` | "The party sending the event" - `{partyName, carrierCode, carrierCodeListProvider}`; the latter two required. | A8 | event_domain L1506-1528 |
| `publisherRole` (`tntPublisherRole`) | "The party function code of the publisher": `CA` (Carrier), `AG` (Carrier local agent), `VSP` (Visibility Service Provider), `SVP` (Any other service provider). | A8 | event_domain L2603-2622 |
| `ShipmentEvent` | "a specialized event to handle all events related to **documents**". | A6 | event_domain L762-765 |
| `shipmentEventTypeCode` | "**The status of the document in the process**." 17 values. | A1, A6 | event_domain L2523-2564 |
| `documentTypeCode` | "used to identify the type of information `documentReference` points to". 23 values. | A6, A9 | event_domain L2157-2211 |
| `documentReference` | The identifier of the document whose status this event reports. | A6, A9 | event_domain L794-796 |
| `relatedDocumentReferences` | "An optional list of key-value (`type`-`value`) pairs representing links to objects relevant to the event." Same 23-value type list. | A9 | event_domain L1758-1829 |
| `references` | "References provided by the **shipper or freight forwarder** at the time of booking... Carriers **share it back** when providing track and trace event updates... Customers can use these references to track shipments in their internal systems." | A9 | event_domain L2071-2089 |
| `referenceType` | `FF` (Freight Forwarder's), `SI` (Shipper's), `PO` (Purchase Order), `CR` (Customer's), `AAO` (Consignee's), `ECR`, `CSI` (Customer shipment ID), `BPR`, `BID`, `EQ` (Equipment), `RUC`, `DUE`, `CER`, `AES`. | A9 | dcsa_domain L1291-1330 |
| `TransportEvent` | "a specialized event to handle all events related to transportation." | A4 | event_domain L858-861 |
| `transportEventTypeCode` | `ARRI` (Arrived), `DEPA` (Departed). Two values only. | A4 | event_domain L2623-2635 |
| `EquipmentEvent` | events "related to equipment (containers)". | A4 | event_domain L1070-1073 |
| `equipmentEventTypeCode` | `LOAD`, `DISC`, `GTIN`, `GTOT`, `STUF`, `STRP`, `PICK`, `AVPU`, `DROP`, `AVDO`, `INSP`, `RSEA`, `RMVD`, `CUSS`, `CUSI`, `CUSR`, `CROS`. 17 values. | A4 | event_domain L2221-2262 |
| `emptyIndicatorCode` | "Code to denote whether the equipment is empty or laden": `EMPTY` \| `LADEN`. Required on every EquipmentEvent. | A2, A4 | dcsa_domain L596-602 |
| `isTransshipmentMove` | "Indicates whether this event is originated in relation to an ocean transshipment or inter terminal move", legal only with `LOAD`/`DISC`/`GTIN`/`GTOT`/`PICK`/`DROP`. | A3, A4 | event_domain L989-1000 |
| `transportCall` | A single visit by one conveyance to one place. | A3 | event_domain L1831-1905 |
| `transportCallReference` | "A carrier defined reference to a `TransportCall`." | A3, A9 | dcsa_domain L1534-1541 |
| `transportCallSequenceNumber` | "Transport operator's key that uniquely identifies each individual call. This key is essential to distinguish between **two separate calls at the same location within one voyage**." | A3 | dcsa_domain L1547-1552 |
| `portVisitReference` | "The unique reference that can be used to **link different `transportCallReferences` to the same port visit**. The reference is provided by the port." | A3, A9 | dcsa_domain L1228-1234 |
| `facilityTypeCode` | Role the facility plays in the call: `BORD`, `CLOC`, `COFS`, `OFFD`, `DEPO`, `INTE`, `POTE`, `RAMP`, `WAYP`. | A3, A5 | event_domain L1024-1049, L1866-1889 |
| `eventLocation` | "General purpose object to capture the location in the `EquipmentEvent` whenever it is **not** associated with a `TransportCall` (this could be stuffing and stripping)." | A3, A4 | event_domain L1001-1023 |
| `delayReasonCode` | "Reason code for the delay. See SMDG Code list DELAY." max 3 chars. Examples `WEA`, `STR`. | A4 | dcsa_domain L479-485; jit L3594-3600 |
| `changeRemark` / `remark` | Free text, "to provide additional information on the context", e.g. "Port closed due to strike". 250/500 chars. | A4 | event_domain L2145-2150, L2503-2508 |
| `reason` | "used to explain why a specific `ShipmentEvent` has been sent". 250 chars. | A1, A6 | event_domain L2476-2481 |
| `Timestamp` (JIT) | "Date and time for an `ERP-A` **Timestamp** when a **Port Call Service** should be provided (for `ERP`) or **has been** provided (for `A`)." | A4 | jit L3526-3530 |
| `replyToTimestampID` | "The identifier of the **Timestamp** being replied to... Can only reply to a **Timestamp** with the same `portCallServiceID`." | A4 | jit L3539-3550 |
| `isFYI` | "If set to `true` it indicates that this message is primarily meant for another party - but is sent as a FYI." | A8 | jit L3604-3611, L3265-3272 |
| `bookingStatus` | Status of the booking; 9 values, see lifecycle below. | A1 | bkg L2461-2477 |
| `amendedBookingStatus` | "The status of latest amendment added to the `Booking`. If no amendment has been requested - then this property is empty." | A1 | bkg L2477-2487 |
| `bookingCancellationStatus` | "The status of the latest booking cancellation." | A1 | bkg L2488-2496 |
| `Transport` (booking) | "A single `leg` of the `Transport Plan`." | A3 | bkg L7154-7157 |
| `transportPlanStage` | `PRC` (Pre-Carriage) \| `MNC` (Main Carriage) \| `ONC` (On-Carriage). | A3 | bkg L7160-7171 |
| `ShipmentLocation` | "Maps the relationship between `Shipment` and `Location`, e.g., the `Place of Receipt` and the `Place of Delivery` for a specific shipment." | A2, A3 | bkg L5201-5207 |
| `locationTypeCode` | `PRE` (Place of Receipt), `POL` (Port of Loading), `POD` (Port of Discharge), `PDE` (Place of Delivery), `PCF`, `OIR`, `ORI`, `IEL`, `PTP`, `RTP`, `FCD`, `ROU`. | A2, A3 | bkg L5211-5231 |
| `partyFunction` (OtherDocumentParty) | `DDR`, `DDS`, `COW`, `COX`, `N1`, `N2`, `NI`, `NAC`, `CSR`. | A8 | bkg L4545-4574 |
| `Charge` | "Addresses the monetary value of freight and other service charges for a `Booking`": `extendedChargeName`, `currencyAmount`, `currencyCode`, `paymentTermCode` (`PRE` prepaid / `COL` collect), `calculationBasis`, `unitPrice`. | A7 | bkg L7479-7540 |

## Lifecycles & events

### Booking - a real, documented, multi-track state machine (A1)

This is the strongest lifecycle material in either of my two sources. `bookingStatus`
(`bkg/v2/BKG_v2.0.5.yaml` L2461-2477):

| Value | Meaning (verbatim) |
| --- | --- |
| `RECEIVED` | "Booking request has been received" |
| `PENDING_UPDATE` | "An update is required to the Booking" |
| `UPDATE_RECEIVED` | "An update has been received and is awaiting to be processed" |
| `CONFIRMED` | "Booking has been Confirmed" |
| `PENDING_AMENDMENT` | "An amendment is required to the Booking" |
| `REJECTED` | "Booking discontinued by **carrier before** it has been Confirmed" |
| `DECLINED` | "Booking discontinued by **carrier after** it has been Confirmed" |
| `CANCELLED` | "Booking discontinued by **shipper**" |
| `COMPLETED` | "The Transport Document this Booking is connected to has been Surrendered for Delivery" |

**Three of the nine values exist purely to record *who* ended the booking and *when in the
lifecycle*.** REJECTED / DECLINED / CANCELLED are semantically "it stopped", and the
standard still gives each its own code, because "the carrier said no before confirming",
"the carrier backed out after committing" and "the customer walked" have different
commercial consequences. That is C3's "who may cause each transition" encoded directly in
the vocabulary rather than in prose. **This is the single most transplantable idea in the
DCSA corpus for A1** - our order lifecycle has the identical problem (agent declines an
offer vs van line pulls an awarded order vs shipper cancels).

**Amendment runs on a parallel track, not on the main status.** `amendedBookingStatus`
takes `AMENDMENT_RECEIVED` / `AMENDMENT_CONFIRMED` / `AMENDMENT_DECLINED` /
`AMENDMENT_CANCELLED` and "is only available after the provider has approved the `Booking`"
(L1122). Crucially: "The `Amended Booking` and the 'original' `Booking Request` will
**co-exist**" until the amendment resolves (L573) - and `bookingStatus` **stays**
`CONFIRMED` while `amendedBookingStatus` moves (L599). Cancellation runs on a *third* track
(`bookingCancellationStatus`: `CANCELLATION_RECEIVED` / `_DECLINED` / `_CONFIRMED`),
because cancelling a confirmed booking is itself a request the carrier can refuse.

Transitions are stated as **preconditions on the endpoint**, e.g. "send an update to a
newly created Booking (precondition: `bookingStatus='RECEIVED'`)"; "`bookingStatus` will
stay as `PENDING_AMENDMENT` but `amendedBookingStatus` will change to `AMENDMENT_RECEIVED`
... (precondition: `bookingStatus='PENDING_AMENDMENT'`)" (L595-599), and "In order to
cancel a `Booking`, the `bookingStatus` must be one of..." (L1513-1520). The whole thing is
organised around numbered **Use Cases** (UseCase 2 - Request to update Booking request,
UseCase 5 - Confirm Booking request, UseCase 6 - Request to amend confirmed Booking,
UseCase 7 - Request amendments to confirmed Booking), each mapping to an endpoint plus a
precondition plus a resulting status.

### Document status - `shipmentEventTypeCode` (A6)

"**The status of the document in the process**" (event_domain L2523-2545), 17 values:
`RECE` (Received), `DRFT` (Drafted), `PENA` (Pending Approval), `PENU` (Pending Update),
`PENC` (Pending Confirmation), `CONF` (Confirmed), `REJE` (Rejected), `APPR` (Approved),
`ISSU` (Issued), `SURR` (Surrendered), `SUBM` (Submitted), `VOID` (Void), `REQS`
(Requested), `CMPL` (Completed), `HOLD` (On Hold), `RELS` (Released), `CANC` (Cancelled).

The design move here is that **one generic status vocabulary is applied to 23 different
document types** via `documentTypeCode`. "Booking confirmed" is
`{shipmentEventTypeCode: CONF, documentTypeCode: BKG, documentReference: ABC123059}`;
"B/L issued" is `{ISSU, TRD, 84db923d-...}`. There is no per-document-type event catalog -
the document type is *data*, not part of the event name. This keeps the catalog small and
makes a new document type a data change rather than a schema change. It also means a
consumer cannot tell from the event name alone which lifecycle is being described.

ShipmentEvents are **constrained to `eventClassifierCode: ACT`** - "For `ShipmentEvents`
the `eventClassifierCode` **must** be `ACT`" (event_domain L776-781). A document status
change is always an actual; there is no "estimated B/L issuance".

### Equipment and transport codes (A4)

- `transportEventTypeCode`: `ARRI`, `DEPA` only (L2623-2635) - with `OMIT` visibly
  commented out in the enum.
- `equipmentEventTypeCode`: 17 values covering load/discharge, gate in/out, stuff/strip,
  pick-up/drop-off **and their availability precursors** (`AVPU` Available for Pick-up,
  `AVDO` Available for Drop-off), inspection/reseal/removal, and three customs codes
  (`CUSS` Selected for Scan, `CUSI` Selected for Inspection, `CUSR` Released) (L2221-2262).
  The `AVPU`/`AVDO` pair is a nice pattern: "it is now possible for you to do X" is a
  distinct, publishable event from "X happened".
- **Definitions for these codes live in CSVs we do not have** (see "What we could not
  see"). We have codes and labels only.

### The JIT ERP-A negotiation (A4, C5)

JIT models timestamps as a *conversation*, not a feed (`jit/v2/JIT_v2.0.0.yaml`
L3554-3585):

- `classifierCode` is `ACT` / `EST` / `PLN` / `REQ`, and **who may say which is
  constrained by role**: "`EST`, `PLN` and `ACT` can **only** be used by the **Service
  Provider** when sending a **Timestamp** to the **Service Consumer**. `REQ` is **only** to
  be used by the **Service Consumer**."
- `replyToTimestampID` threads a timestamp to the one it answers, and may only reply within
  the same `portCallServiceID`.
- There are further conditions on which classifier is legal for which service type (`ACT`
  for any service except `MOVES`; `EST`/`REQ`/`PLN` only for the listed berth/cargo/pilotage/
  towage/mooring/bunkering/anchorage services).

So: the consumer *requests* a time, the provider *plans* and *estimates* it, and eventually
*actualises* it, with each message linked to its predecessor and each party restricted to
the classifiers their role permits. That is an appointment-negotiation protocol expressed
entirely in the event vocabulary. For HHG delivery-window negotiation between agent,
driver and customer this is a very close structural analogue.

### Retraction

DCSA's correction model is **one mechanism, and it is blunt**: publish an event whose
`metadata.retractedEventID` names a prior event, and omit the payload entirely
(event_domain L2509-2515; worked example at `tnt/v3/tnt.yaml` L595-608). There is:

- no reason code on a retraction,
- no distinction between "did not happen" and "wrong data",
- no `correctiveEventID` pointing at the replacement,
- no declared retraction time separate from `eventCreatedDateTime`.

A corrected fact is just a *new* event; nothing links it to the retraction. This is
strictly weaker than EPCIS's `errorDeclaration`, and it arrived only in T&T 3.0
("Retracted events are no possible using the `retractedEventID`", `tnt/v3/README.md` L9).

## Time, identity, evidence

### Time - the classifier is the headline idea

**One timestamp field plus one classifier, rather than N named timestamp fields.**
`eventDateTime` is "the local date and time, when the event took place **or when the event
will take place**" (event_domain L2298-2303), and `eventClassifierCode` says which reading
applies: `ACT` / `PLN` / `EST` / `REQ`.

This is the design decision our catalog most needs to make consciously. The alternatives
are (a) separate fields - `plannedLoadDate`, `estimatedLoadDate`, `actualLoadDate` - or
(b) DCSA's one field + classifier. DCSA's wins on extensibility (a new classifier is not a
new field on every event) and on the fact that **the same event type can be published
repeatedly as the answer firms up** - `EST` arrival, revised `EST` arrival, then `ACT`
arrival, all `transportEventTypeCode: ARRI`. It loses on "what is the current ETA" being a
query rather than a field, and on the risk of a consumer double-counting an `EST` and an
`ACT` as two arrivals.

Constraints per event type are explicit: ShipmentEvent `ACT` only; TransportEvent and
EquipmentEvent `ACT` / `PLN` / `EST`; `REQ` appears only in JIT (event_domain L776-781,
L866-876, L956-966; the `REQ` value is commented out of the T&T parameter at L285-300).

**`eventCreatedDateTime` vs `eventDateTime`** is the same two-clock split EPCIS makes, and
both are independently filterable with a genuinely good operator syntax:
`eventCreatedDateTime:gte=2021-04-01T14:12:56-01:00`, with `:gte`, `:gt`, `:lte`, `:lt`,
`:eq`, and a range expressed by repeating the parameter with two operators and an implied
AND (event_domain L306-361). Default sort is `eventCreatedDateTime` ascending
(`tnt/v3/tnt.yaml` L17, L59) - i.e. **the poll model is explicitly ordered by record time,
not event time**, which is the correct choice for resumable polling.

**Weaknesses in the time model:**
- **No time zone concept beyond the ISO-8601 offset embedded in the value.** Examples use
  `+08:30`, `+02:00`, `-01:00`, so an offset is conveyed - but nothing says whose offset it
  is, and there is no separate field as in EPCIS. "The **local** date and time" implies the
  event location's local time, but it is not stated normatively.
- **No windows.** No `earliest`/`latest`, no appointment range. A window would have to be
  two events.
- **Date-only appears in Booking, with a magic sentinel**: `plannedDepartureDate` /
  `plannedArrivalDate` are `format: date`, and "**In case no date is available, the date
  `1970-01-01` should be used**" (bkg L7182-7196). That is an anti-pattern - a sentinel
  value in a nullable field - and worth citing as a thing *not* to do.

### Identity and cross-references (A9 - DCSA's strongest area)

Three distinct reference mechanisms, deliberately separated:

1. **`documentReference` + `documentTypeCode`** - the *subject* of a ShipmentEvent. "Which
   document is this event about."
2. **`relatedDocumentReferences[]`** - "links to objects relevant to the event", typed by
   the same 23-value document type list (event_domain L1758-1829). "What else does this
   event touch." In the worked example, a `TRD` issuance event carries
   `relatedDocumentReferences: [{type: BKG, value: ABC123059}]` (`tnt/v3/tnt.yaml`
   L189-191).
3. **`references[]`** - "References provided by the **shipper or freight forwarder** at the
   time of booking... **Carriers share it back** when providing track and trace event
   updates... **Customers can use these references to track shipments in their internal
   systems**" (event_domain L2071-2079), typed by `referenceType` (`FF`, `SI`, `PO`, `CR`,
   `AAO`, `CSI`, `BPR`, `BID`, `EQ`, ...).

Point 3 is the one to steal. **It is a designated, typed slot for the *counterparty's* own
identifiers, carried on every event, with an explicit contract that the publisher echoes
them back.** That is precisely our problem: a van line's order number, an agent's job
number, an account's authorization number and a military GBL all have to ride along and
come back on every message, and today they do it in whatever field survives. DCSA names the
slot, types the values, and writes down the obligation to return them.

Identifier design elsewhere is notably careful about the **carrier-specific vs universal**
axis: every voyage and service reference comes in both flavours - `carrierServiceCode` +
`universalServiceReference` (pattern `^SR\d{5}[A-Z]$`), `carrierExportVoyageNumber` +
`universalExportVoyageReference` (pattern `^\d{2}[0-9A-Z]{2}[NEWS]$`, decoded as 2-digit
year + 2-char sequence + direction) (dcsa_domain L237-275, L1617-1640). One party's private
id and the cross-party agreed id are *both* carried, side by side, always. `portVisitReference`
plays the same role at the port level: "the unique reference that can be used to link
different `transportCallReferences` to the **same port visit**... provided by the port"
(L1228-1234) - a neutral third party's id used to correlate two carriers' private ids.

`equipmentReference` is defined against an external standard with a documented fallback:
ISO 6346 BIC container number, and "If a container does not comply with ISO 6346, it is
suggested to follow Recommendation #2: Containers with non-ISO identification from SMDG"
(dcsa_domain L603-612).

**`eventID` is "the unique identifier for this event (*the message - not the source*)"**
(event_domain L2286-2291) - an explicit warning that the event id identifies the assertion,
not the thing asserted about. Worth copying verbatim into our catalog's prose. Note it was
**changed from UUID to a 100-char string** in event domain 3.1.0 (`domain/event/README.md`),
i.e. they loosened it to accommodate implementers' existing ids.

### Evidence and provenance

- **`publisher` + `publisherRole` on every event, mandatory** (event_domain L634-639,
  L1506-1528, L2603-2622). The role vocabulary distinguishes the carrier itself from the
  carrier's local agent from a visibility service provider reselling the data. This is the
  right answer to "who asserted this fact" and it is the thing EPCIS lacks.
- **`isFYI`** (JIT) - "this message is primarily meant for another party but is sent as a
  FYI" (jit L3604-3611). An explicit addressee-vs-observer flag on a broadcast message.
  Useful when the same event goes to several subscribers with different standing.
- **`Notification-Signature` header** computed from a subscriber-supplied Base64 `secret`
  ("A Base64 encoded secret shared between the Publisher and the Subscriber. It is used to
  compute the contents of the Notification-Signature header", event_domain L2516-2522),
  rotatable via `PUT /v3/event-subscriptions/{subscriptionID}/secret`. Plus a
  `Subscription-ID` header so the receiver knows *which* subscription caused a delivery,
  and an `API-Version` header carrying the version of the API **sending** the event
  (`tnt/v2/README.md` L74-78).
- **No evidence pointers at all.** No document link, no photo, no signature, no device id,
  no telemetry provenance on a T&T event. A `LOAD` event does not say how the carrier knows.
  (Reefer/IoT events carry measurements, but they are separate event families.) This is the
  inverse of EPCIS's strength.
- Booking carries a `Feedback` object for "unsupported properties / changed values /
  removed properties / general information" (bkg L2515-2523) - the provider telling the
  consumer what it did to their submission. A good pattern for partner-integration
  round-trips.

### Versioning and extension (C8)

DCSA's versioning discipline is the best I have seen in a source of this kind, and it is
*process*, not just syntax:

- **Every spec is a file named with its exact version**, and old versions stay in the repo:
  `tnt/v1/`, `tnt/v2/` (2.2.0, 2.3.0), `tnt/v3/` (3.0.0-Beta-1); `domain/event/` holds
  twelve versions from 1.0.0 to 3.2.0. Nothing is overwritten.
- **Shared component libraries are themselves versioned and pinned by URL**: every `$ref`
  names an exact domain version, e.g.
  `https://api.swaggerhub.com/domains/dcsaorg/EVENT_DOMAIN/3.1.0#/components/schemas/event`
  (tnt/v3/tnt.yaml L153). A spec cannot drift when its shared types change.
- **Per-release changelogs record every field-level change**, including renames,
  deprecations and removals - `tnt/v3/README.md` lists ~40 discrete changes for 3.0.0,
  down to "`eventType` filter renamed to `eventTypes`" and "deprecated filters removed
  (`bookingReference`, `transportDocumentID` and `scheduleID`)".
- **Deprecation is a marked state, not a deletion.** Fields carry `deprecated: true` with a
  note saying what supersedes them and why they are still required (`chargeName` vs
  `extendedChargeName`, bkg L7487-7497); the v2.3.0 changelog lists five `TransportCall`
  fields deprecated in favour of the `location` object (`tnt/v2/README.md` L16-21).
- **The major version is in the URL path** (`/v3/events`) **and** in an optional
  `API-Version` request header which "**MUST** only contain **MAJOR** version [and] **MUST**
  be aligned with the URI version" (dcsa_domain L1931-1939); responses echo `API-Version`.
- **Optionality is explicit and machine-signalled.** "All subscription based endPoints are
  **optional** to implement. If not implemented a `501 Not Implemented` must be returned"
  (`tnt/v3/tnt.yaml` L717), with a dedicated `notImplemented` error schema. A profile
  mechanism without calling it one.

**What DCSA does *not* have: extension points.** Every enum is closed. There is no
namespaced-extension mechanism, no `additionalProperties`, no vendor field. Adding a value
means a new version of the shared domain and a new release of every API that references it.
That is the opposite trade-off from EPCIS, and the changelogs show the cost: "added new
enum values to `shipmentEventTypeCode` - `PENC`, `CANC`" is a versioned release event
(`tnt/v2/README.md` L10-12).

### Subscription and filtering

- **Poll is mandatory, push is optional.** "`GET /v3/events` ... **This endPoint is
  mandatory to implement.**" / "The push model is **optional** to implement"
  (`tnt/v3/tnt.yaml` L17-24). A consumer can always fall back to polling. Sensible for a
  catalog whose publishers have wildly different capabilities - directly relevant to
  Pegasus II vs Cloud.
- **A subscription is a saved filter plus a callback.** "All values in the subscription body
  except `callback`, `secret` and `subscriptionID` will be used as filters. All filters
  specified **must** be fulfilled in order to match an Event. A logical **AND** is used
  between filters [and] filters specified as `,` separated lists use logical **OR** between
  list values" (L720-735). The same field names serve as query parameters on the poll
  endpoint and as filter fields in the subscription body - one filter vocabulary, two
  delivery modes. That symmetry is worth copying.
- Filter fields span every axis: event type, the three type-specific code lists, document
  type and reference, equipment reference, transport call reference, vessel IMO, import and
  export voyage numbers (carrier and universal), service code, UN location code, and both
  timestamps with operators (`tnt/v3/tnt.yaml` L62-131).
- Pagination is by `limit` + `Current-Page` / `Next-Page` / `Prev-Page` / `First-Page` /
  `Last-Page` headers; `cursor` and `offset` were **removed** in v3 because "pagination is
  implementation specific" (`tnt/v3/README.md` L36).
- Booking uses a different push model worth noting: notifications come in a **lightweight**
  flavour (status + references only) and a **full state transfer** flavour (the entire
  Booking document embedded), and the subscriber chooses (bkg L1816-1846, L2533-2553). The
  thin-vs-fat event debate, resolved by offering both and letting the subscriber pick.

## Scores

Weighting is decided in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 3 | 3 | 3 | 0 | 2 | 3 | 2 | 3 | C1: request, update, confirm, amend, cancel, reject, decline, complete all present (bkg L2461-2496) plus the document-status vocabulary (event_domain L2523-2564). C2: each status defined in one precise sentence, and the definitions carry the actor. C3: **the best lifecycle material in either of my sources** - 3 parallel status tracks (booking / amendment / cancellation), explicit preconditions per endpoint (bkg L595-599, L1513-1520), amendment co-existing with the original (L573), and `REJECTED` vs `DECLINED` vs `CANCELLED` encoding who ended it and when. C4: 0 - it is an ocean booking, not an HHG order; no offer/award, no agent acceptance. C5: `plannedDeparture/ArrivalDate` are date-only with a `1970-01-01` sentinel (L7182-7196). C7: `reason` free text on ShipmentEvent (L2476-2481) and a structured `Feedback` object (L2515-2523), but no evidence. |
| **A2** Shipment structure | 2 | 2 | 1 | 0 | n/a | 3 | 1 | 3 | C1: booking carries commodities, requested equipment, `ShipmentLocation` with 12 `locationTypeCode`s (bkg L5201-5231), and the shipment/equipment distinction is real; but there is one shipment type only. C2: `ShipmentLocation` is defined ("Maps the relationship between `Shipment` and `Location`"), `emptyIndicatorCode` EMPTY/LADEN is a genuinely useful state distinction on the unit (dcsa_domain L596-602). C3: the shipment itself has no lifecycle - the *documents* do. C4: 0 - containers, not HHG; no HHG/storage/vehicle/PPM split, no shipment weight concept comparable to net/gross/tare in our sense. C6: equipment reference, booking reference, document reference all typed and correlated. C7: no evidence for structure assertions. |
| **A3** Trip, stop & assignment | 3 | 3 | 2 | 0 | 2 | 3 | 1 | 3 | C1: the conveyance journey is fully modelled - service, voyage (import and export), port call, transport/terminal call, port call service, and the booking's Transport Plan legs (bkg L7154-7212). **Consolidation is handled structurally**: many equipment events reference one call. C2: `transportCallSequenceNumber` "essential to distinguish between two separate calls at the same location within one voyage" (dcsa_domain L1547-1552) is precisely the stop-sequence distinction; `transportPlanStage` PRC/MNC/ONC names leg roles; `facilityTypeCode` says what role the place plays. C3: `omitted` on a terminal call (jit L3262-3269) and `OMIT` in operations events; no full state machine for a journey. C4: 0 - vessel/barge/rail/truck calls, no crew, no driver, no HHG equipment. C5: JIT's ERP-A (jit L3554-3585) is excellent for a stop's times; the Transport Plan's planned dates are date-only. C6: carrier-specific *and* universal references for every voyage and service; `portVisitReference` correlates across carriers. C7: publisher role only. |
| **A4** Execution events & tracking | 3 | 2 | 2 | 0 | 3 | 3 | 2 | 3 | C1: arrive/depart (transport), 17 equipment codes incl. gate in/out, stuff/strip, load/discharge, pick/drop and their availability precursors, inspection and customs (event_domain L2221-2262); delay reason + remark; retraction. **Missing: any evidence/telemetry attachment.** C2: **capped by missing definitions** - the authoritative definitions of every event code live in CSVs on the DCSA-Information-Model repo that are not captured (see "What we could not see"); we have code + label only. `isTransshipmentMove` and `emptyIndicatorCode` are properly defined and carry real meaning. C3: classifier constraints per event type are enforced (L776-781, L866-876, L956-966), and JIT constrains classifier by **party role** (jit L3554-3568), but events have no state machine. C5: **best in class** - one `eventDateTime` + `eventClassifierCode` ACT/PLN/EST(/REQ), plus `eventCreatedDateTime` as a separate record clock, plus range operators on both (L306-361), plus JIT's reply-threaded negotiation. Loses a point only for having no windows and no explicit zone field. C6: `references[]` (counterparty ids echoed back), `relatedDocumentReferences[]`, transport call and equipment references all on the event. C7: `publisher`/`publisherRole` mandatory (strong); retraction exists but is bare - no reason, no corrective link, no separate declaration time (L2509-2515). C8: versioned, pinned, changelogged, deprecation-marked - but **closed enums, no extension point**. |
| **A5** Storage-in-transit | 1 | 1 | 0 | 0 | 1 | 2 | 1 | 3 | C1: the pieces that exist are `facilityTypeCode` `OFFD` (off-dock storage) / `DEPO` (depot) / `COFS` (container freight station) (event_domain L1024-1049), the `GTIN`/`GTOT` gate-in/gate-out pair, `AVPU`/`AVDO` availability codes, `STUF`/`STRP`, and demurrage/detention fields in Booking. **There is no storage entity, no dwell duration, no in/out pairing as a unit, no permanent-storage boundary.** C2: `OFFD` has a label, no definition (CSV not captured). C5: no duration type anywhere. C6: the equipment reference does correlate a gate-out to a prior gate-in. Weighting note for phase 3: **DCSA should not be the source of record for A5.** |
| **A6** Documents & evidence | 3 | 2 | 3 | 1 | 2 | 3 | 1 | 3 | C1: 23 typed document types (event_domain L2157-2211) including invoice, customs clearance, VGM, cargo survey, certificates; every one gets status events. C2: **codes and labels only** - the definitions are in the uncaptured CSV, and the eBL specs that would define issuance/surrender were pruned. C3: **3 - the standout.** `shipmentEventTypeCode` is an explicit 17-value document-status vocabulary (L2523-2564) applied uniformly across document types, with `ACT` forced (L776-781) and `reason` carried (L2476-2481). This is the thing EPCIS completely lacks. C4: 1 - `CAS` (Cargo Survey), `VGM` (Verified Gross Mass) and `ICE` (Inspection Certificate) are recognisable analogues of survey and weight documents, but nothing HHG-specific. C5: document events are always actual. C6: `documentReference` + `relatedDocumentReferences` + `references` (three distinct reference roles). C7: **1 - documents are referenced by id only.** No content, no version, no hash, no signature, no attachment. A document status event is not evidence of anything. |
| **A7** Charges & billing hooks | 1 | 2 | 1 | 0 | n/a | 2 | 1 | 3 | C1: `Charge` exists on the Booking (bkg L7479-7540) with amount, currency, calculation basis, unit price; `INV` is a document type with status events. **No charge events, no invoice lifecycle beyond generic document status, no accessorial catalog.** C2: `paymentTermCode` `PRE` (prepaid) / `COL` (collect) is properly defined, incl. who bears the charge; `calculationBasis` is "the code specifying the measure unit used for the corresponding unit price for this cost, such as per day, per ton, per square metre". C3: an invoice can carry `ISSU`/`CMPL`/`VOID` via the generic document vocabulary, nothing charge-specific. C6: charges hang off the booking reference. |
| **A8** Parties & roles | 2 | 2 | n/a | 0 | n/a | 3 | 2 | 3 | C1: **two distinct role vocabularies for two distinct purposes** - `publisherRole` (CA/AG/VSP/SVP) for who asserted the event (event_domain L2603-2622), and booking `partyFunction` (DDR/DDS/COW/COX/N1/N2/NI/NAC/CSR, bkg L4545-4574) for commercial roles on the document, plus named roles like `BookingAgent`. No crew, no driver, no warehouse operator. C2: the notify-party cascade note (if the consignee is a notify party, N1 becomes N2 and N2 becomes NI, bkg L4570) is the kind of precision we want; most other roles are code + gloss. C4: 0 for HHG - none of booking/origin/hauling/destination agent, van line, driver, crew. C6: parties identified by `carrierCode` + `carrierCodeListProvider` (i.e. **code plus the authority that issued it**, e.g. `SMDG`) - a pattern worth copying for SCAC and our own agent codes. C7: publisher role is a genuine provenance signal, but there is no delegation or on-behalf-of model beyond `isFYI`. |
| **A9** Identity & cross-references | 3 | 3 | n/a | 1 | n/a | 3 | 2 | 3 | C1: booking-request reference, booking reference, transport-document reference, shipping-instruction reference, equipment reference, transport-call reference, port-visit reference, voyage references (carrier + universal), service references (carrier + universal), event id, subscription id - and a typed slot for the counterparty's own ids. C2: **the carrier-specific vs universal distinction is explicit, defined and applied consistently** (dcsa_domain L237-275, L1617-1640); `eventID` is defined as identifying "the message - not the source" (L2286-2291); `portVisitReference` is defined as the third-party correlator across carriers (L1228-1234). C4: 1 - `referenceType` includes shipper/forwarder/consignee/PO/customer reference slots that map almost directly onto our account, agent and order numbers, even though no HHG identifier is named. C6: **3, and this is DCSA's best area.** Three separate reference mechanisms with distinct contracts, typed values, external-standard anchoring (ISO 6346 with documented fallback), and a stated obligation to echo the customer's references back on every event. C7: references carry a type but no issuer field beyond the code-list-provider pattern on party codes. C8: closed type lists, but versioned and changelogged; new reference types have been added in point releases (`tnt/v2/README.md` L22-27). |

### S5 - fit to Pegasus data

| Area | Fit | Note |
| --- | --- | --- |
| A1 | `partial` | Pegasus II is form-and-save CRUD, so an order's status is a column, not a transition log. It can supply *current* status; whether it can supply *who* caused a transition and *when* (which is what makes DCSA's model valuable) depends on whether pegII keeps an audit trail. Cloud should be able to do this properly. Needs the pegII source analysis to confirm. |
| A2 | `partial` | pegII certainly has shipment-level structure; DCSA's container-shaped equipment model has little to receive it. Only the shipment-vs-unit separation transfers. |
| A3 | `unknown` | Whether pegII models a trip/manifest as an entity distinct from the shipment - and whether it has an explicit stop sequence number rather than ordering by date - is the open question. If it orders stops by date, DCSA's `transportCallSequenceNumber` is a gap to fill, not a mapping. |
| A4 | `partial` | pegII can almost certainly supply actual milestone dates. The `eventClassifierCode` model asks whether pegII distinguishes a *planned* load date field from an *actual* load date field, or overwrites one field - form-and-save CRUD usually overwrites, which would mean we can publish `ACT` but reconstruct no `EST` history. Likely the single biggest catalog-design constraint from the legacy side. |
| A5 | `no` | DCSA has nothing meaningful to map SIT onto. |
| A6 | `partial` | pegII has document numbers and probably document status columns; the 23-type/17-status matrix is a good target shape but the type list must be replaced wholesale. |
| A7 | `partial` | pegII has charges; DCSA offers only a booking-time charge structure, no charge events. |
| A8 | `partial` | The code-plus-code-list-provider identity pattern maps well onto SCAC and internal agent codes. The role vocabularies do not transfer. |
| A9 | `yes` | This is the highest-value, lowest-friction transfer in the whole source: the three-slot reference model (subject / related documents / counterparty's own references) can be adopted essentially as-is. |

## Strengths worth adopting

1. **`metadata` + `payload` as the named envelope seam**, with the payload conditional so a
   retraction can be metadata-only. Our envelope should have this split explicitly, not by
   convention.
2. **`publisher` + `publisherRole` mandatory on every event.** Distinguishing the principal
   (`CA`) from its local agent (`AG`) from a reselling visibility provider (`VSP`) is
   exactly the van-line / agent / third-party-platform distinction we will face. Make it
   required from v1; it cannot be retrofitted.
3. **One `eventDateTime` + an `eventClassifierCode` (ACT/PLN/EST/REQ)** rather than parallel
   named date fields. Same event type, republished as the answer firms up. Constrain which
   classifiers are legal per event type, as DCSA does (document status is always `ACT`).
4. **JIT's ERP-A negotiation**: `REQ` may only be sent by the consumer, `EST`/`PLN`/`ACT`
   only by the provider, and `replyToTimestampID` threads the conversation. This is an
   appointment-negotiation protocol built from events, and HHG delivery-window agreement is
   the same shape.
5. **Separate the conveyance stream from the cargo stream.** TransportEvent (the truck
   arrived) is not EquipmentEvent (the unit was loaded); the cargo event *references* the
   call. This is the structural answer to trip-vs-shipment, and it is what makes
   consolidation representable - N shipments' events pointing at one call.
6. **`transportCallSequenceNumber`** - "essential to distinguish between two separate calls
   at the same location within one voyage". Stop order must be an explicit number, never
   inferred from timestamps. A two-stop day at the same warehouse breaks time-ordering.
7. **The three-slot reference model** - `documentReference` (what this event is about),
   `relatedDocumentReferences[]` (what else it touches), `references[]` (**the
   counterparty's own identifiers, which the publisher undertakes to echo back**). Adopt
   all three, and adopt the stated obligation in slot 3.
8. **Carrier-specific *and* universal identifiers side by side, always.** Every voyage and
   service carries both the private id and the cross-party agreed id, with a checksummed
   pattern on the universal one. Our equivalent: the agent's job number *and* the van line's
   registration number, both, on every event.
9. **`portVisitReference` as a neutral third-party correlator** - an id issued by the port,
   used to link two carriers' private call references to one real-world visit. We have the
   same need where an origin agent and a hauling agent each have their own id for the same
   pickup.
10. **A code plus the authority that issued it** (`carrierCode` + `carrierCodeListProvider:
    SMDG`). Never a bare code. Directly applicable to SCAC, DOT/MC numbers, and tenant agent
    codes.
11. **`REJECTED` (carrier, pre-confirm) vs `DECLINED` (carrier, post-confirm) vs `CANCELLED`
    (shipper).** Encode *who* ended it and *at what stage* in the status value itself. Our
    order lifecycle needs precisely this and will otherwise get one `CANCELLED` and a
    free-text note.
12. **Parallel status tracks for amendment and cancellation**, with the main status holding
    steady and the amended version co-existing with the original until resolved. This is how
    to model "the order is confirmed, and separately there's a pending revision" without
    corrupting the primary state.
13. **One generic document-status vocabulary applied across many document types**, with the
    type as data (`documentTypeCode`) rather than as part of the event name. Keeps the
    catalog small; a new document type is a data change.
14. **`AVPU` / `AVDO`** - "available for pick-up" as a distinct publishable event from
    "picked up". The transition to *ready* is often the one the customer wants.
15. **Poll mandatory, push optional, one filter vocabulary shared between them**, with
    `501 Not Implemented` as the machine-readable signal for an unimplemented optional
    capability. Given Pegasus II and Cloud will have different capabilities, a catalog with
    explicitly optional, discoverable parts is the right design.
16. **Default poll ordering by `eventCreatedDateTime` ascending**, with range operators on
    both clocks (`eventCreatedDateTime:gte=...`). Resumable polling requires record-time
    ordering; make it the documented default.
17. **Lightweight vs full-state-transfer notifications, subscriber's choice** (Booking).
    Settles the thin-vs-fat event argument by not settling it.
18. **Versioning as process**: version in the filename and the URL, shared component
    libraries pinned by exact version in every `$ref`, a field-level changelog per release,
    and `deprecated: true` with a stated successor rather than deletion. Copy the whole
    discipline.

## Weaknesses / traps

1. **Retraction is far too thin. Do not copy it.** `retractedEventID` with no reason, no
   corrective link and no separate declaration time (event_domain L2509-2515) cannot
   distinguish "it never happened" from "the time was wrong", and leaves the replacement
   event unlinked. Take EPCIS's `errorDeclaration` here instead; DCSA is the weaker source
   on corrections despite being the stronger source on almost everything else.
2. **No evidence, anywhere, on a T&T event.** No attachment, no document link, no photo, no
   signature, no device or geofence provenance. In HHG, "delivered" without the signed POD is
   half a fact. If we adopt DCSA's event shape we must add an evidence slot ourselves -
   EPCIS's `sensorElement` / `certificationInfo` / `upevt` patterns are the model.
3. **Closed enums with no extension mechanism.** Every code list is a fixed enum; adding a
   value is a versioned release of a shared domain plus a release of every dependent API.
   For a platform with per-tenant vocabulary needs this is the wrong trade-off as stated -
   but note it is *why* DCSA's consumers can exhaustively switch on a code. Decide
   deliberately; do not inherit by default.
4. **Definitions live outside the spec.** Every code list says "More details can be found on
   GitHub" and links to a CSV in another repo. The spec alone gives code + label. We should
   keep definitions *in* the catalog, not in a sibling repo, or we will reproduce exactly
   the gap that caps this source's C2 at 2 for A4.
5. **`1970-01-01` as "no date available"** (bkg L7182-7196). A sentinel in a nullable field.
   Cite as an anti-pattern; use null and say what null means.
6. **No time-zone model beyond the offset inside the ISO-8601 string.** "The **local** date
   and time" is asserted in prose but there is no field saying whose local time, and nothing
   forces the offset to be the stop's. EPCIS is strictly better here and the fix is cheap.
7. **No windows or ranges on an event.** An appointment window has to be two events or a
   convention. HHG spread dates and delivery windows are first-class facts for us; DCSA has
   no slot.
8. **Ocean-container assumptions run deep.** `emptyIndicatorCode` presumes a reusable
   container; `isTransshipmentMove` presumes ocean transshipment; the whole
   port-call/terminal-call/berth hierarchy presumes a vessel. Borrow the *structure* (call,
   sequence, service, timestamp) and discard the vocabulary entirely. Do not try to map an
   HHG residence stop onto a `facilityTypeCode`.
9. **The shipment has no lifecycle - only documents do.** DCSA's answer to "what state is my
   shipment in" is "look at the document statuses and the event stream". That works when the
   B/L is the contract; in HHG the order is the spine and customers ask about the *order*.
   Do not let document-status-as-lifecycle displace an actual order lifecycle.
10. **`eventID` was loosened from UUID to a 100-char string** (event domain 3.1.0 changelog)
    to accommodate implementers. Pick your id type once, and pick it wide enough.
11. **Booking is a two-party carrier/shipper negotiation.** HHG routinely has four or more
    parties with independent standing (account/RMC, van line, booking agent, origin agent,
    hauling agent, destination agent). The booking state machine's shape is excellent; its
    two-party assumption is not.
12. **Versions in this capture are not all final.** T&T v3 is `3.0.0-Beta-1`
    (`tnt/v3/tnt.yaml` L3) and its README says "This is a moving target"; JIT v2 is likewise
    a beta snapshot. Booking 2.0.5 is a point release of a shipped major. Cite accordingly.

## Out-of-v1 material

- **A10 (survey, estimating & inventory).** `documentTypeCode` includes `CAS` (Cargo
  Survey), `VGM` (Verified Gross Mass), `ICE` (Inspection Certificate), `OOG` (Out of
  Gauge), `DGD` (Dangerous Goods Declaration) (event_domain L2157-2211) - each a document
  that can carry the full status vocabulary, which is a usable pattern for "survey
  submitted / approved / superseded". `equipmentEventTypeCode` `INSP` (Inspected) is the
  physical counterpart. Booking carries commodity and requested-equipment structures
  (bkg L5360 `RequestedEquipment`) not examined in detail here.
- **A11 (claims & valuation).** Nothing direct. The nearest hooks are `INSP` / `RSEA`
  (resealed, i.e. a seal was broken and remade) and the `seals` object pulled into
  EquipmentEvent from the documentation domain (event_domain L1065). `HOLD` / `RELS` in the
  document vocabulary give a hold/release pattern. No claim entity, no valuation, no
  liability concept.
- **A12 (rating & tariffs).** Booking's `Charge` object (bkg L7479-7540) with
  `calculationBasis` ("per day, per ton, per square metre"), `unitPrice`, `currencyAmount`,
  `currencyCode` and `paymentTermCode` (`PRE`/`COL`) is a compact, reusable charge-line
  shape. Demurrage and detention fields exist on the booking. No tariff, no rate table, no
  accessorial catalog.
- **A13 (crew, driver & settlement).** Nothing. No person entity anywhere in what we read.
  The closest is `truckTransportCall.licencePlate` / `chassisLicencePlate` - the vehicle,
  never the driver. Notably, **DCSA deliberately stops at the conveyance**; if we want
  driver and crew assignment modelled, no part of this source will help.
- **Beyond the rubric:** the **Event Hub** specs (`event_hub/`, `ovs_event_hub/`,
  `documentation_event_hub/`) are a separate architectural pattern - a shared event bus
  fronting multiple publishers - that may be worth reading when we design distribution
  rather than the catalog itself. Not read here. The `pint/` (Platform Interoperability)
  specs address transfer of a document's custody between platforms, which is conceptually
  close to transferring an order between van-line systems; also not read.

## Open questions

1. **Does pegII keep planned vs actual as separate columns, or does a form-and-save edit
   overwrite one field?** If the latter, we can publish `ACT` events but can never
   reconstruct the `EST` history, and the classifier model buys us less on the legacy side
   than it appears to. This is the highest-value question to put to the pegII source
   analysis.
2. **Does pegII (or Cloud) have an explicit stop *sequence*, or does it order stops by
   date?** `transportCallSequenceNumber` exists because time-ordering fails for two calls at
   the same place in one voyage - and an HHG driver doing two stops at one warehouse in a day
   has exactly that problem.
3. **Do we want a document-status vocabulary applied across document types (DCSA) or
   per-document event types (one `EstimateApproved`, one `BolIssued`)?** DCSA's keeps the
   catalog small at the cost of a consumer not knowing the lifecycle from the event name.
   Decide once, in phase 4.
4. **Open or closed enums?** DCSA closed, EPCIS open. Closed gives exhaustive consumer
   switches and a real release process; open gives tenant extension without a release. This
   is the same question the EPCIS analysis raises and it should get one answer for the whole
   catalog.
5. **How many parties can assert the same fact, and does `publisherRole` need a
   delegation/on-behalf-of model?** DCSA's four roles assume one principal and its agents.
   With booking, origin, hauling and destination agents all publishing against one order, we
   may need "asserted by X on behalf of Y" - which DCSA does not have.
6. **Should our event carry an evidence slot from v1?** DCSA shipped without one and it is
   visibly the gap. Adding an optional, typed evidence reference (document id, photo,
   signature capture, device reading) at design time is cheap; adding it in v2 means every
   consumer's parser changes.
7. **Where do the authoritative definitions of our event codes live?** DCSA's are in a CSV in
   another repo, which is why we could not score its C2 higher. Ours should live in the
   catalog. This is a process decision for phase 4, and this source is the cautionary
   example.
8. **Do we need the missing SMDG DELAY code list before designing A4 reason codes?** It is
   the closest thing to an industry-standard delay taxonomy in either source, and we do not
   have it. Worth an inbox request.
