---
source: src:sirva-ade
analyzed: 2026-09-17
evidence_grade: A
material: |
  All 13 ADE PDFs under pegasus-workflows:platform/allied-vanlines/docs/ (text extracted
  with the PDF extractor). Read in full: SOE (40 pp), GSD (28 pp), ABS (11 pp), ASC (6 pp),
  GDOC (8 pp), ADOC (8 pp), LEU (8 pp), GAC (3 pp), AVAIL (3 pp), GS (2 pp).
  Read partially: LEP (pp 1-7, 12-15 read; pp 8-11 event samples enumerated by grep),
  LOD (pp 1-8 of 11 read; pp 9-11 are continued sample JSON), OAUTH (grepped, not read
  page-by-page). Also read the four published overlays under
  pegasus-workflows:platform/allied-vanlines/integrations/ and
  platform/allied-vanlines/README.md, plus platform/integrations/weichert/ for the
  RMC-side comparison.
---

# SIRVA / Allied Agent Data Exchange (ADE) — analysis

## Cite shorthand

All paths below are relative to `/home/steve/repos/pegasus-workflows/platform/allied-vanlines/docs/`.

| Tag | File |
| --- | --- |
| **SOE** | `ADE API Specification - Shipment Operational Event Communication Process.pdf` (40 pp) |
| **GSD** | `ADE API Specification - Get Shipment Operational Details.pdf` (28 pp) |
| **GAC** | `ADE API Specification - Get Shipment Agent Compensation.pdf` (3 pp) |
| **ABS** | `ADE API Specification - Abstract & Statement Communication.pdf` (11 pp) |
| **ASC** | `ADE Abstract - Service Description Examples.pdf` (6 pp) |
| **LOD** | `ADE API Specification - Lead Opportunity Detail Communication.pdf` (11 pp) |
| **LEP** | `ADE API Specification - Lead Opportunity Event Pull Communication.pdf` (15 pp) |
| **LEU** | `ADE API Specification - Lead Opportunity Event Push Communication.pdf` (8 pp) |
| **GDOC** | `ADE API Specification - Get Shipment Document from MS Imaging System.pdf` (8 pp) |
| **ADOC** | `ADE API Specification - Add Shipment Document into MS Imaging System.pdf` (8 pp) |
| **OAUTH** | `ADE API Specification - Agent System API Access Client OAuth.pdf` |
| **AVAIL** | `Agent Data Exchange Available API Communication.pdf` (3 pp) |
| **GS** | `Getting Started.pdf` (2 pp) |

Repo cites use the `pegasus-workflows:` prefix for paths under that repo.

## What it is

**Agent Data Exchange (ADE)** is SIRVA Moving Services' partner API for the agents of
its two US van lines — **Allied Van Lines (`AVL`)** and **northAmerican Van Lines
(`NVL`)** (AVAIL p.1; GSD p.5 `Brand` valid values). It is a RESTful JSON service over
OAuth 2.0 client-credentials whose purpose is stated as "reduce duplicate data entry,
reduce manual processing errors, accelerate response to leads and operational changes"
(AVAIL p.1). **S1 kind:** `vendor-api`. **S2 adoption:** 2 — it is the integration
surface for one of the two largest US van-line groups and GS p.1 names seven agent-system
vendors already integrated (MoversSuite/EWS, netsirv, MoveStar/EDC, Pegasus, Moovsoon,
Supermove, Technoir), so it is a de-facto standard for *Allied/NAVL agents* but is not
an industry standard. **S3 openness:** `gated-partner` — every page carries
"(c)2025 Sirva Confidential & Proprietary"; access requires an agent relationship
(GS p.2: email AgencyNetwork@sirva.com; 6-8 weeks for a custom integration).

**Our reading is grade A** for the operational core: the 40-page Shipment Operational
Event spec and the 28-page Get Shipment Detail spec were read end to end from the actual
published PDFs, as were the accounting, document and lead-push specs. **What we could
not read:** SOE pp. 35-37 and GSD p. 27 are *embedded screenshots* ("CSR Picture",
"Claim Original CSR Example Referenced") that carry no extractable text — every CSR field
in the spec is defined by pointing at a numbered callout on those images ("see CSR
Picture CSR Group 3 (11)"), so the **positional meaning of the CSR fields is unread**.
The OAuth 2.0 flow diagrams are vector art and extracted only as scattered labels. The
OAUTH spec itself was grepped, not read page by page. LEP pp. 8-11 and LOD pp. 9-11 were
enumerated/skimmed rather than read line by line; they are event samples and continued
sample JSON, and the event-name list from LEP was extracted by grep.

This source is **primary for us**: our tenants are Allied agents, so ADE is the actual
wire we will carry, not a comparator.

## Model summary

ADE is organized by **who calls whom**, not by entity. AVAIL pp. 2-3 groups nine APIs into
four "product" families:

| Family | APIs | Direction |
| --- | --- | --- |
| **Consumer Sales** | Lead/Opportunity Event (push *or* pull — "the Agency System is only allowed to use one of the two options", LEU p.1), Lead/Opportunity Detail | events to agent; detail pulled |
| **Operations** | Shipment Operational Event (**push only**), Get Shipment Detail | events to agent; detail pulled |
| **Accounting** | Get Agent Compensation (pull), Abstract (daily push), Statement (bi-monthly push) | mixed |
| **Miscellaneous** | Get Document / Add Document (SISTRS imaging) | pull + the **one** agent-to-SIRVA write of operational substance |

The **central entity is the "registration"** — SIRVA's word for a booked shipment. The
event stream is a *snapshot* stream: "The Request will consist of 1 or more events. For
each event the scope of the shipment details will vary based on Event Type" (SOE p.1),
yet ten pages later, "All the shipment elements are sent and will reflect null if change
does not impact element. The event description identifies the element that when applicable
will have the value reflected" (SOE p.10). Those two sentences describe different
contracts — see *Open questions*.

Structurally each event/detail record is:

```
Shipment (registration)
├── identity      Brand + CamisRegNumber(12) / RegNumber(6) + RegYear
├── segment       HaulingSegmentType in {MainLoad, Overflow, MassMove, Transfer}
│                 + RegOverflowNumber, RegTransferNumber          (GSD p.5)
├── trip          QPDTripNumber (10) and CamisTripNumber (5)      — two id systems
├── Resources[]   {Id, Name, Type, Owner}   role x ownership      (SOE p.6, GSD p.9)
├── Locations[]   {LocationTypeName, LocationTypeNumber, LocationSiteTypeName, addr,
│                  contact, LocationOverTimeIndicator, LocationSITIndicator}
├── Charges[]     Service/Qualifier/Location + SvcQuantity[] + SvcRates[]   (GSD p.10)
├── OpsRemarks[]  free-text, timestamped, per Transfer/Overflow segment      (GSD p.11)
└── Claims[] -> CSRGroup -> Groups 1-5 (dates / responsibility / agent summary /
                 check payment / ledger)                                     (GSD p.13)
```

The **lead side** is a separate object graph — `Lead -> Opportunity -> Quote ->
RegNbr` — living in "MoveScout Pro" (MSP), formerly QLAB; LOD p.1 notes the QLAB path
segment survives in the URL after the 2022 system replacement "to minimize Agent System
interface impact". `QuoteBooked` is the event that hands off from the sales graph to the
operations graph, and it is the only lead event that carries a `RegNbr` (LEU p.6).

**Accounting** is a third graph keyed to the same registration: a rated shipment produces
an **Abstract** (original / adjustment / cancel), and abstracts accumulate into a
**period-ending Statement** with **Posting Tickets** (ABS pp. 1-3).

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Registration** | A booked shipment. `RegNumber` (6 digits) "is the unique shipment identifier"; `RegDate` = "Registration Date that is used by Rating"; `RegEntryDate` = "the date when the shipment ShpmtStatDesc was updated to reflect Registered" | A1, A9 | GSD p.5 |
| **CamisRegNumber** | 12 digits: "The first 6 positions is the shipment number, next 2 positions reflect the OverFlow Sequence Number, Last 2 positions reflect Transfer sequence number" | A9, A2 | SOE p.2 |
| **Brand** | `AVL` = Allied, `NVL` = northAmerican. Scopes every id | A9 | GSD p.5; ABS p.2 |
| **HaulingSegmentType** | `MainLoad` / `Overflow` / `MassMove` / `Transfer` — the shipment's haul is decomposed into segments, each addressable | A2, A3 | GSD p.5 |
| **Overflow** | "the driver did not have sufficient space for the entire shipment to be loaded on the trailer, so another driver, tractor and trailer need to address transportation of the remaining items" | A2, A3 | SOE p.19 |
| **Transfer** | "The shipment has been transferred to another vehicle prior to delivery" | A3 | SOE p.24 |
| **Trip** | Never defined; identified twice — `QPDTripNumber` (10) and `CamisTripNumber` (5). Shipments are *assigned to* and *broken from* a trip | A3 | SOE pp. 2, 14 |
| **Assigned / Break** | "The shipment has been assigned to a trip" / "The shipment has been removed from a trip" | A3 | SOE p.14 |
| **Resource** | `{Id, Name, Type, Owner}`. `Type` in Booker, OriginAgent, DestinationAgent, LoadAgent, UnloadAgent, Hauler, R19Agent, RR19Agent, SITAgent, Driver, Tractor, Trailer. `Owner` in Corporate, Agent, Vendor. "Can contain agent, vendor, driver or equipment code based on the resource Type" | A8, A3 | GSD p.9; SOE p.6 |
| **Booker / SelfhaulIndicator** | "Yes when Booking Agent plans to self-haul shipment and No when Booker is planning to surrender shipment to van line to select the hauler" | A8 | GSD p.8 |
| **R19 / RR19** | Rule 19 pickup and Reverse Rule 19 delivery — an authorized substitute agent performs the pickup/delivery; carries its own `R19AuthNumber`, its own `R19Agent` resource, its own weight, and its own charge codes (`R19`, `RR19`, `BR19` booker charge, `HR19` hauler charge) | A8, A3, A12 | SOE pp. 16-17; ASC pp. 2, 5 |
| **SvcProvDataRecipient** | "unique code associated to the location within the agent company that intended to benefit from this web service communication transaction" (7 chars) | A9, A8 | SOE p.2 |
| **AgentNbr** | "Unique 7-digit number assigned to the agent (e.g., 0008000)". Sample ids show the trailing 3 digits as the branch (`0375003`, `0556000`) | A9, A8 | GAC p.2; GSD p.17 |
| **ShipmentStatus** | "Operational status of shipment" in `REGISTERED`, `CANCELLED`, `PLANNED`, `ASSIGNED`, `LOADED`, `DELIVERED` | A1, A4 | GSD p.8 |
| **Agreed Load Period (ALP) / Agreed Delivery Period (ADP)** | From/To **date pair plus** From/To hour+minute; "Not Required; but if one time load time parameter is specified then all four Load Time parameters are required" | A1, A5 | SOE pp. 4-5, 20 |
| **Will Advise** | `IntoWillAdvise` = "the shipment is changed to **remove** agreed load and delivery periods"; `OutOfWillAdvise` = "updated to reflect the agreed load and delivery periods". Sample addresses literally read `"DestinationAddress":"TBD"` / `"Will Advise"` | A1, A5 | SOE p.18; SOE p.11; LOD p.7 |
| **LoadDate / UnloadDate** | "Van Line **Driver** Load Date" / "Van Line **Driver** Unload Date" — the trip-side dates, distinct from the customer-side dates | A5, A3 | GSD p.7 |
| **PlannedCustLoadDate / ActualCustLoadDate** | "Planned Pickup date from Shipper origin location" / "Actual Pickup date from Shipper origin location" (same pair for delivery) | A5 | GSD p.7 |
| **Weight / WeightEstimate / WeightActual / WeightBilledEstimate / WeightBilledActual** | `Weight` is derived: "When Actual Weight > 0 then reflects Actual Weight otherwise will reflect Billed As Weight" | A2, A7 | GSD p.7 |
| **Location Type Names** | `MAINLOAD PICKUP`, `MAINLOAD DELIVERY`, `EXTRA STOP PICKUP`, `EXTRA STOP DELIVERY`, `STORAGE IN TRANSIT` — plus `LocationTypeNumber` (2 digits, `00` on the mainload) | A3, A5 | GSD p.25; SOE p.34 |
| **Location Site Type Names** | APARTMENT, CONDOMINIUM, DUPLEX, HIGHRISE, HOUSE, GARAGE, HOTEL, MOBILE, HOME, MINI STORAGE, OFFICE, RESIDENCE, RESTAURANT, TOWNHOUSE, WAREHOUSE | A3 | GSD p.25 |
| **SIT / SITLocation / SITAgent / InDate / OutDate** | Storage in Transit; `SITLocation` in `Origin`, `Destination`; `InDate` = "Into Warehouse Date", `OutDate` = "Out of Warehouse Date"; a `SITAgent` resource; `LocationSITIndicator` on a location | A5 | SOE pp. 3, 6, 24 |
| **Setoff / Port Handler / Settling agent** | Further agent functions appearing only in the claims/settlement view (`SetoffAgentCode`, `PortHandlerAgentCode`, `SettlementAgentCode`) | A8, A13 | GSD p.13 |
| **Abstract** | Per-shipment rated revenue statement pushed daily. `AdjCode` blank = Original, `ADJ` = adjustment (only changes), `CAN` = "cancelation so the amounts combined with the 'Original' amounts will zero out the shipment"; `BatchNbr` distinguishes reruns — "A shipment can have multiple Abstracts if SIRVA changes and rerates the shipment" | A7 | ABS p.3 |
| **Statement / Statement Half / Posting Ticket** | Bi-monthly agent account statement; `StatementHalf` = `1` or `2`; entries of `ReferenceType` `Shipment` or `Ticket` | A7 | ABS pp. 2, 9 |
| **TransRevenue** | "the Transportation Revenue that is intended to be distributed according to allocation rules to Origin Agent, Hauler, Destination Agent, SIRVA, etc." | A7, A13 | ABS p.3 |
| **ThruAcctCompleted / ThruAcctDateOrig / ThruAcctDateLastAdj** | "When Shipment has successfully processed through account 'Y'"; the processing dates that generated the original abstract and the last adjustment | A7 | GSD p.11 |
| **CSR** | Claim Settlement Record. Transaction kinds: `Original` = "Information to setup the claim", `Re-Open` = "Addition information to add", `Adjustment` = "Last Information which is **intended to replace** the prior claim CSRs information" | A11, A7 | GSD p.4 |
| **ServiceProviderFunction** | 2-digit role code used in claims/settlement: 05 Booker, 06 Origin Agent, 07 Packer, 08 Hauler 1, 10 Hauler 2, 12 Hauler 3, 14 Port Handler, 16 Destination Agent, 17 Settling Agent, 18 Settoff Agent, 20 Sirva Corporate — **and 06 R19 Agent, 16 RR19 Agent** (published as duplicates) | A8 | GSD p.26 |
| **Opportunity / Lead / Quote** | MSP sales graph. `Disposition` in New, Fax/busy, No answer, Left voicemail, Prefer call back, Do not call requested, Not interested, Wrong/disconnected #, Converted to qualified. `Status` in Converted, Dead, New, Unqualified, Working | A1 | LOD p.2 |
| **ExternalReference** | "Agent's internal lead reference" — the agent's own id, echoed back on SIRVA's events | A9, A7 | LEP p.3; LEU p.3 |
| **CustomerReference** | `{CustomerReferenceNumber, CustomerReferenceTypeCode}` — sample shows type `GBL` with `HAFC1111111` | A9 | GSD pp. 10, 19 |
| **TMOOriginBase / TMODestinationBase** | Transportation Military Office base codes, 4 chars, "Only has value when National Account Type reflects Military" | A9, A8 | GSD p.6 |
| **SISTRS** | SIRVA's document imaging system; `ReferenceType` `DomesticRegNumber` binds an image to a registration | A6, A9 | ADOC pp. 1, 3 |

## Lifecycles & events

### Shipment operational event types (the complete published list)

SOE pp. 10-29 defines each event by a one-line description plus a sample payload. The
**payload scope column is the spec's own statement of what that event carries**.

| `Type` value | Description (source's words) | Payload scope beyond `Id`/`DateTime`/`Type`/`CamisRegNumber`/`Brand` | Cite |
| --- | --- | --- | --- |
| `Register` | "A shipment has been registered" | The **full** element set — shipper/consignee, account, agreement, addresses, all agreed periods (nulls at registration), weights/cubes/charge estimate, discount, miles, salesperson/estimator, `SelfhaulIndicator`, `ShipmentStatus=REGISTERED`, `Resources[]` (Booker/OriginAgent/DestinationAgent), `Locations[]`. "When the Register Event with dates is included, the Request will also include the **Assign** event indicating selection of booking, origin and destination agents" | SOE pp. 10-13 |
| `ShipmentResourceAssign` | "Assigned — the shipment has been assigned to a trip" / "Resource Assigned to Shipment – booking agent / origin agent / destination agent" | trip numbers (may be null); `Resources[]` | SOE pp. 14, 26 |
| `ShipmentResourceRemove` | "Resource Removed from Shipment" | `Resources[]` | SOE p.27 |
| `TripResourceAssign` | "driver / tractor / trailer / hauler has been assigned to trip" | **trip numbers only, no `CamisRegNumber`** + `Resources[]` | SOE p.28 |
| `TripResourceRemove` | same, removal | trip numbers + `Resources[]` | SOE pp. 28-29 |
| `Break` | "The shipment has been removed from a trip" | `QPDTripNumber`, `CamisTripNumber` | SOE p.14 |
| `Cancel` | "The shipment has been cancelled" | nothing further — **no reason code** | SOE p.15 |
| `Reinstate` | "A previously canceled shipment has been restored to active status" | nothing further | SOE p.15 |
| `Deliver` | "The shipment has been delivered" | trip numbers, `UnloadDate`, `ProofOfDeliveryName` | SOE p.15 |
| `R19` / `R19Cancel` | "Rule 19 has been issued" / "…canceled" | `R19AuthNumber`, `Weight`, `Resources[R19Agent]` | SOE p.16 |
| `RR19` / `RR19Cancel` | "Reverse Rule 19 has been issued" / "…canceled" | `RR19AuthNumber`, `Weight`, `Resources[RR19Agent]` | SOE p.17 |
| `IntoWillAdvise` | "shipment is changed to **remove** agreed load and delivery periods" | nothing further | SOE p.18 |
| `OutOfWillAdvise` | "updated to reflect the agreed load and delivery periods" | `AgreedLoadFromDate/ToDate`, `AgreedDeliveryFromDate/ToDate` | SOE p.18 |
| `LoadDateChanged` | "the assigned load date (i.e. reflects when the driver is to load the shipment onto the trailer) has been changed **on the trip**" | trip numbers, `LoadDate` | SOE pp. 18-19 |
| `UnloadDateChanged` | "The assigned unload date for the shipment has been changed on the trip" | trip numbers, `UnloadDate` | SOE p.20 |
| `Loaded` | "the system is updated to reflect the driver has loaded the shipment" | trip numbers, `LoadDate` | SOE p.19 |
| `Overflow` | see Vocabulary | `Weight` (of the overflow portion) | SOE p.19 |
| `Transfer` | "transferred to another vehicle prior to delivery" | nothing further | SOE p.24 |
| `ALPChanged` | "The agreed load period of the shipment has been changed" | `AgreedLoadFromDate`, `AgreedLoadToDate` | SOE p.20 |
| `ADPChanged` | "The agreed delivery period of the shipment has been changed" | `AgreedDelvFromDate`, `AgreedDelvToDate` (**sample spells them differently from the field table**) | SOE p.20 |
| `ExtendADP` | "agreed delivery period … extended beyond the required delivery date or RDD (**Military shipments only**)" | trip numbers, `UnloadDate` | SOE p.22 |
| `PackingDatesAdded` / `PackingDatesChanged` | packing dates added / changed | `AgreedPackFromDate`, `AgreedPackToDate` | SOE p.21 |
| `ResidenceLoadDateAdded` | "The residence load date … have been added" | `LoadDate` | SOE p.21 |
| `DPSSurveyAdded` | "The DPS Survey for the shipment have been added" | nothing further | SOE p.22 |
| `WeightChange` | "Actual Weight has been changed" | `Weight` | SOE pp. 22-23 |
| `AddSIT` / `ChangeSIT` / `DeleteSIT` | "Storage in transit has been added / modified / deleted" | `Location` (`Origin`), `WarehouseAddress/City/State`, `Weight`, `InDate`, `OutDate`, `Resources[SITAgent]` | SOE pp. 24-26 |
| `Reg Change` | "Requires changed shipment details to be communicated to Operations/QPD" | nothing further | SOE p.29 |
| `ClaimOrignalCSR` (sic) | Claim settlement record | full CSR Groups 1-5 | SOE pp. 30-33 |

Claim events are explicitly a **partial build-out**: "Overall plan is to address Claims
processing cycle events: Claim New Open, ClaimOriginalPaid, Claim ReOpen, Claim ReOpen
Paid, ClaimOrignalCSR, ClaimReOpenCSR, ClaimAdjustmentCSR. Currently only addressing the
CSR Events the other will be addressed by future project" (SOE p.29; repeated GSD p.4,
which adds "only Moving Services **domestic** shipments Claims are addressed").

**Status vocabulary vs event vocabulary are different things.** `ShipmentStatus` has six
values (GSD p.8) while the event list has ~30 types. Many events change no status at all
(`ALPChanged`, `WeightChange`, `AddSIT`), and several statuses have no dedicated event
(`PLANNED` never appears as an event type).

### Lead/opportunity event types

Pull channel (LEP pp. 5-11): `LeadCreated`, `LeadChanged`, `AddOpportunitySuccess`,
`AddOpportunityFailed`, `OpportunityCreated`, `OpportunityChanged`, `ContactAdded`,
`CollaborationToAgencyAdded`, `CollaborationToAgencyDeleted`,
`CollaborationFromAgencyAdded`, `CollaborationFromAgencyDeleted`, `ActivityAdded`,
`ActivityChanged`, `OpportunityAttachmentAdded/Changed/Deleted`,
`NoteAdded/Changed/Deleted`, plus `QuoteCreated` (seen in the LEP p.13 sample, carrying
both `QuoteId` and `RegNbr`). Push channel (LEU pp. 4-6) exposes a **strict subset**:
`AddOpportunitySuccess`, `AddOpportunityFailed`, `OpportunityCreated`,
`OpportunityChanged`, `ActivityAdded`, `ActivityChanged`, `QuoteBooked`.

`Activities[].Status` is its own small lifecycle: `Cancelled`, `Done`, `In Progress`,
`Auto-Created`, `Not Started`, `On Hold`, `Request for Cancel`, `Denied Cancel Request`
(LOD p.6) — note the **request/deny pair**, the only place in ADE where a state models a
*pending request to change state*.

### Accounting lifecycle

`Rated` (charges computable, GSD p.3 "When Rating to calculate charges has completed
successfully") -> **Abstract Original** (`AdjCode` blank) -> **Abstract Adjustment** (`ADJ`,
"only changes") or **Abstract Cancel** (`CAN`, sums with the Original to zero) -> posted to
the **period Statement** (ABS p.3). `ThruAcctCompleted` Y/N is the shipment-level flag for
"has run through accounting" (GSD p.11). Compensation (`GetAgentComp`) is positioned as
the *early* read: "Avoid multiple steps … to pay Driver and Salesperson ASAP rather than
waiting days/weeks for the Abstract to be generated" (AVAIL p.3).

### Claim lifecycle

`Claim Status` in `SETUP`, `OPEN`, `ITEMCLOSED`, `CLOSED`, `REOPEN`, `ADJ CLOSED`, `DELETE`
(GSD p.26). `ClaimType` in Military Direct, Delay, Major Loss/Damage, PT, HOUSE, Quick,
National Account, Catastrophic, Military, Subrogation, Agent Settled, Agent Direct
(GSD p.25). `TypeOfMove` in Residence to Residence, Residence to Warehouse, Warehouse to
Residence, Warehouse to Warehouse, R19 to Warehouse, Warehouse to RR19, R19 to Residence,
Residence to RR19 (GSD p.26) — a compact encoding of the SIT/R19 topology of the move.

### Who may cause a transition

**Not modeled.** Every operational event is asserted by SIRVA and consumed by the agent;
no event carries an actor, a user, or a system-of-origin. The only inversions of that
direction in the whole surface are `AddDocument` (ADOC) and `AddOpportunity*` (the agent
posts a qualified lead and SIRVA replies with a `Success`/`Failed` event, LEU p.4).

## Time, identity, evidence

### Time

ADE distinguishes **four different time families** on the same shipment, and the
distinctions are real, named, and load-bearing:

1. **Agreed periods with the customer** — `AgreedLoadFrom/ToDate`, `AgreedPackFrom/ToDate`,
   `AgreedDeliveryFrom/ToDate`, each optionally narrowed by a From/To **hour + minute**
   ("Military Time format"), with the all-or-nothing rule that specifying one time part
   requires all four (SOE p.4). Absence is meaningful and has its own state —
   *Will Advise* (SOE p.18).
2. **Planned vs actual customer dates** — `PlannedCustLoadDate`/`PlannedCustDelvDate` vs
   `ActualCustLoadDate`/`ActualCustDelvDate` (GSD p.7).
3. **Trip/driver dates** — `LoadDate`/`UnloadDate`, explicitly "Van Line **Driver** Load
   Date", changed by `LoadDateChanged`/`UnloadDateChanged` "on the trip" (GSD p.7;
   SOE pp. 18-20). These are the *plan for the vehicle*, separate from (2).
4. **System-record time** — event `DateTime`, "Indicates when event was **recorded**"
   (SOE p.2), and `RegDate` (used by Rating) vs `RegEntryDate` (when the status flipped to
   Registered) (GSD p.5).

Date fields are date-only ISO 8601; event `DateTime` is an instant with 7 fractional
digits. **No field carries a time zone.** The only zone statements anywhere are on the
lead side: "Date (ISO 8601 **Eastern assumed**)" for `ReceiveDate`/`RequestedMoveDate`,
and "DateTime (ISO 8601 Eastern with UTC Offset)" for `Activities[].StartDate` (LOD
pp. 2, 5). Agreed load/delivery *hours* — which are inherently stop-local — have no zone
at all.

Semantics caution: `Loaded` is defined as "the system is updated to reflect the driver has
loaded" (SOE p.19) and `Deliver` likewise. The event `DateTime` is the *recording* time,
and there is no separate occurred-at.

### Identity

ADE is unusually rich here, and the identifiers are **structured, not opaque**:

- `CamisRegNumber` is a composite: `shipment(6) + overflowSeq(2) + transferSeq(2)`
  (SOE p.2) — i.e. splitting a shipment mints a *new value of the same identifier*, with
  the relationship encoded in the digits. `RegNumber` alone (6) is "the unique shipment
  identifier" (GSD p.5); `GetAgentComp` wants "the first 6 characters of the CAMIS
  Registration Number" (GAC p.2).
- The addressable key for a detail read is the **triple** `Brand + RegNumber + RegYear`
  (GSD p.15 REST path), i.e. reg numbers recycle across years and brands.
- Hauling segments are addressable independently: `GetShipmentDetail` accepts
  `TransferNumber`, `OverflowNumber`, `MassMoveNumber`, where `00` means "the main load"
  and null/space means "give me all segments" (GSD p.3).
- **Two ids for the same trip** — `QPDTripNumber` (10 digits) and `CamisTripNumber`
  (5 digits), both carried on every trip-bearing event (SOE p.2).
- **Agent identity is hierarchical** — a 7-digit `AgentNbr` where samples show the last
  three digits as the branch (`0375003`, `0556000`, `4433000`); `SvcProvDataRecipient`
  names the *receiving branch* on a push (SOE p.2). One `Client_Id` per agency regardless
  of branch count or dual branding (GSD p.1; OAUTH: "Each agent is issued a single Client
  ID, regardless of the number of branch locations or dual…").
- **The agent's own id round-trips** — `ExternalReference` = "Agent's internal lead
  reference" appears on SIRVA's lead events (LEP p.3), and `AddDocument` takes the agent's
  `ReferenceNumber` + `ReferenceType` (ADOC p.3).
- **Customer-side references are typed** — `CustomerReference[] {Number, TypeCode}` with a
  `GBL` sample (GSD pp. 10, 19); military bases as `TMOOriginBase`/`TMODestinationBase`.
- **Cross-system mapping is stated as the agent's job**: "Agent System will have the SIRVA
  Sales Person Code value cross-referenced to a respective Agency Sales Person Code Value"
  and the same for driver codes (ABS p.4).
- Sales-to-operations chain: `LeadId -> OpportunityId -> QuoteId -> RegNbr`, the last two
  appearing together only on `QuoteCreated`/`QuoteBooked` (LEP p.13; LEU p.6).

### Evidence, provenance, corrections

Weak on the operational side, strong on the financial side.

- **No actor, source, or confidence on any operational fact.** Events carry an `Id`, a
  recorded-at `DateTime`, and values. Nothing says who changed the weight.
- **Corrections are re-assertions, not reversals**, on the operations side:
  `WeightChange`, `ALPChanged`, `ADPChanged`, `PackingDatesChanged`, `ChangeSIT`,
  `DeleteSIT`, `ShipmentResourceRemove`, `Break`, `Reinstate`. Each is a fresh event with
  the new value; nothing marks the superseded one.
- **Financial corrections are explicit and invariant-bearing** — the `AdjCode`
  Original/`ADJ`/`CAN` triple with the stated invariant that a `CAN` "combined with the
  'Original' amounts will zero out the shipment in SIRVA Accounting System", and `BatchNbr`
  as the discriminator between reruns (ABS p.3). The CSR triple is the same idea with
  supersession: `Adjustment` is "intended to **replace** the prior claim CSRs information"
  (GSD p.4).
- **Documents are the evidence layer** and they are typed: `DocType` in Inventory, Cost
  Detail/Statement of Additional Svcs, **Bill of Lading Signed**, **Bill of Lading**,
  Bulky Article Condition Report, Change Order, Certificate of Self Inspection for Gypsy
  Moth, Miscellaneous Correspondence, Claim Form, DD619, DD619-1, Damage At/After Delivery,
  High Value Inventory, **Weight Tickets**, Claim Photo, Misc. Claim Doc., Third Party
  Invoices (ADOC p.8). Each image carries `BatchNumber`, `ScanLocation`, `Date` vs `DateIn`
  and a `ReferenceNumber`/`ReferenceType` binding to the registration (GDOC p.3; ADOC p.3).
  Nothing links a document to the *event* it evidences.
- **`ProofOfDeliveryName`** — "Name of person receiving shipment at destination … Only
  available for high value proviso 3 shipments" (SOE p.5) — is the single human-attestation
  field in the operational payload.
- **Role history is explicitly not kept.** GSD p.4: "If a service provider responsible for
  a delay was replaced with another service provider to provide the missed service (such as
  hauling) then this service provider will be referenced in the Agent Summary
  Chargeback/responsibility and **will not be found in the shipment Resource group**."
  `Resources[]` is current state only.
- **Free text carries what the schema doesn't.** `OpsRemarks[]` (timestamped, per
  transfer/overflow segment) is where real obligations live — the GSD p.19 sample contains
  the military reweigh rules, "SUBMIT WEIGHT TICKETS WITHIN 24 HRS OF LOAD", and "MUST
  PROVIDE *ETA* 48HRS IN ADVANCE".

## Scores

Weights are decided in phase 3; these are per-criterion scores with the evidence behind each.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 3 | 2 | 2 | 3 | 2 | 3 | 1 | 1 | C1: Register/Cancel/Reinstate/RegChange/Deliver + will-advise + `QuoteBooked` handoff (SOE pp. 10-29; LEU p.6); lead `Disposition`/`Status` cover the pre-order phase (LOD p.2). C2: each event has a one-line definition and `RegDate` vs `RegEntryDate` is precise (GSD p.5), but "registration" itself is never defined and `ShipmentType`/`ShipperType` are marked obsolete with no replacement documented. C3: six-value status enum + one event per transition + the ordering rule "Register … will also include the Assign event" (SOE p.10); no transition table, no invariants, no actor. C5: agreed windows + planned/actual + system-record dates, no time zone. C7: no provenance; corrections are silent re-assertions. C8: `Type` is `String (Max 40)`, event list grows by project (claims "future project", SOE p.29), agent picks a subscription list (SOE p.1) — extension points exist but no version marker in the payload. |
| **A2** Shipment structure | 3 | 3 | 2 | 3 | 1 | 3 | 1 | 1 | C1/C2: `HaulingSegmentType` MainLoad/Overflow/MassMove/Transfer with independently addressable segment numbers (GSD pp. 3, 5); `CamisRegNumber` decomposition (SOE p.2); the five weight/cube variants with the derivation rule for `Weight` (GSD p.7); shipment type Household vs OfficeIndustrial and shipper type PrivateTransferee/NationalAccount/Government/Military (GSD p.24). C3: `Overflow`/`Transfer` are events but segments have no state model. C5: estimate/actual pairs are versions of a measure with no effective dating. C7: `WeightChange` is a correction channel with no provenance. |
| **A3** Trip, stop & assignment | 2 | 2 | 2 | 3 | 2 | 3 | 0 | 1 | C1: trip-shipment membership (`ShipmentResourceAssign`/`Break`), trip resource assignment (driver/tractor/trailer/hauler, SOE p.28), `Locations[]` with type + `LocationTypeNumber`. **Missing: no stop entity with a sequence, no leg, no consolidation view** — a trip's *other* shipments are never expressed, so an agent cannot see the trip. C2: trip vs shipment is genuinely distinguished ("assigned to a trip" / "removed from a trip", SOE p.14) and `Transfer` = moved to another vehicle; but "trip" is never defined and `LocationTypeNumber` is never documented as an ordinal. C5: trip-side `LoadDate`/`UnloadDate` distinct from customer-agreed periods — a real planned-vs-agreed separation (SOE pp. 18-20). C6: two trip id systems + typed equipment ids (GSD p.9). C7: none. |
| **A4** Execution events & tracking | 3 | 2 | 2 | 3 | 2 | 3 | 1 | 1 | C1: the ~30-type list above, the most complete van-line event vocabulary we have. C2: one-line definitions, honest system-of-record framing ("the system is updated to reflect the driver has loaded", SOE p.19); **no arrive/depart at a stop and no ETA field anywhere** — telemetry appears only as `NearestCity`/`NearestState`/`DistanceToNearestCity`/`ReportedLattitude`/`ReportedLongitude`, "only available when shipment is in LOADED status" (GSD p.8). C3: status enum + event per transition; **no reason codes on any event** — `Cancel`, `Break`, `DeleteSIT`, `ExtendADP` all carry none. C7: recorded-at only, no occurred-at, no actor. |
| **A5** Storage-in-transit | 3 | 2 | 2 | 3 | 1 | 1 | 1 | 1 | C1: `AddSIT`/`ChangeSIT`/`DeleteSIT` with warehouse address, weight, `InDate`/`OutDate`, `SITAgent` (SOE pp. 24-26); `SITLocation` Origin/Destination; `STORAGE IN TRANSIT` as a location type and `WAREHOUSE` as a site type (GSD p.25); `LocationSITIndicator`; SIT charge codes `SITCFD` "SIT WH/HNDLING 1ST DAY" and `SITCAD` "SIT ADDITIONAL DAYS", `VSIT` vehicle SIT, `SETO` "SETOFF IN WAREHOUSE", `CART` "CARTAGE TO/FROM WAREHOUSE" (ASC pp. 2-3). **Permanent-storage boundary is present as a charge code only**: `NTSP` "NON-TEMP STORAGE CHARGE" (ASC p.2). C2: origin vs destination SIT named; SIT vs non-temp storage distinguished by charge code, never defined. C3: add/change/delete is the correction triple, but **SIT is modeled as a record with dates, not as in/out events** — there is no `SITIn`/`SITOut` event, and `InDate`/`OutDate` are pushed together at `AddSIT` time (SOE p.24 sample), so plan and actual are indistinguishable. C6: **a SIT occurrence has no identifier** — on a shipment with origin *and* destination SIT, `ChangeSIT`/`DeleteSIT` cannot say which one. C4: the `TypeOfMove` table (Residence to Warehouse, Warehouse to Warehouse, R19 to Warehouse…) encodes the SIT topology natively (GSD p.26). |
| **A6** Documents & evidence | 2 | 1 | 1 | 3 | 1 | 2 | 2 | 1 | C1: list/fetch/add with rich metadata (`PageCount`, `FileSize`, `BatchNumber`, `ScanLocation`, `FileType`) (GDOC p.3); `GetImageList` actions `GetAll` / `GetAbstract` (GDOC p.2). **No link from a document to the event it evidences.** C2: the `DocType` list is bare — no definitions, and it mixes categories ("Misc. Claim Doc."). C3: no document lifecycle; only `Date` vs `DateIn` hints at one. C4: the type list is deeply HHG-native — **Bill of Lading vs Bill of Lading Signed as separate types**, High Value Inventory, Weight Tickets, DD619/DD619-1, Bulky Article Condition Report, Gypsy Moth self-inspection certificate (ADOC p.8). C6: typed binding `ReferenceType: "DomesticRegNumber"` + `Brand` + `OrderYear` properties (ADOC p.7). C7: documents are the only agent-to-SIRVA assertion channel and carry scan provenance; `ProofOfDeliveryName` is the one attestation field (SOE p.5). C8: `DocType`/file-type tables are closed and SIRVA-owned. |
| **A7** Charges & billing hooks | 3 | 2 | 2 | 3 | 2 | 3 | 3 | 1 | C1: shipment `CHARGES[]` with `Service`/`Qualifier`/`Location` segment/`GrossChargeAmt`/`NetChargeAmt`/`DiscountPer` + `SvcQuantity[] {Quantity, UnitOfMeasure}` + `SvcRates[] {RateName, Rate, RateUsed}` (GSD pp. 10, 19-21); abstract; statement; posting tickets; per-agent compensation (GAC p.3). C2: line-haul (`TRAN` TRANSPORTATION, rated BASE + ADD'L on weight+miles) vs accessorial (`LOAD` PER CWT, `FSUR` PER MILE, `MVP`, `WHPD`) is clean in the sample; but `ChargeAmt` vs `GrossChargeAmt` vs `NetChargeAmt` is defined only as "typically reflects 0.0" / "varies per service" (GSD p.10) — genuinely ambiguous. C3: `ThruAcctCompleted` + `ThruAcctDateOrig` + `ThruAcctDateLastAdj` is an explicit billing-state flag (GSD p.11); rated->abstract->statement is stated prose, not a state machine. C5: `StatementYear`/`Month`/`Half`/`IssuedDate` + `BatchNbr` + `TransactionDateTime` — accounting periods are first-class (ABS p.2). C6: `ReferenceNbr` + `ReferenceType` (`Shipment` / `Ticket`) + `AgentNbr` + `BatchNbr` + `AgreementReference`. **C7 = 3**: `AdjCode` Original/ADJ/CAN with the zero-out invariant and multi-abstract reruns keyed by `BatchNbr` (ABS p.3) — the best correction semantics in the source. |
| **A8** Parties & roles | 3 | 3 | 2 | 3 | 1 | 3 | 1 | 1 | C1: the full van-line cast — Booker, OriginAgent, DestinationAgent, LoadAgent, UnloadAgent, Hauler, R19Agent, RR19Agent, SITAgent, Driver, Tractor, Trailer (GSD p.9), plus Packer, Port Handler, Settling Agent, Setoff Agent in the settlement view (GSD pp. 12-13, 26). **C2 = 3**: role and ownership are **orthogonal axes** — `Type` (function on this shipment) x `Owner` in Corporate/Agent/Vendor — and the GSD p.17 sample proves the same company can hold two roles at once (`TIER ONE RELOCATION` is both `Booker` and `DestinationAgent`, `Owner: Vendor`). `SelfhaulIndicator` defines the booker-hauls-or-surrenders decision explicitly (GSD p.8). C3: assign/remove events are scoped separately to shipment vs trip (SOE pp. 26-29) — a real membership lifecycle; no cardinality/exclusivity rules stated. C5: roles are not effective-dated; assign/remove events are the only time dimension. C6: 7-digit hierarchical agent id + branch-level `SvcProvDataRecipient` + a **second** 2-digit `ServiceProviderFunction` vocabulary for the same roles. C7: GSD p.4 explicitly states replaced providers vanish from `Resources` — honest, but it means no history. |
| **A9** Identity & cross-references | 3 | 3 | n/a | 3 | n/a | 3 | 2 | 1 | C1/C2/C6: see *Time, identity, evidence* — composite `CamisRegNumber` with documented positional decomposition, the `Brand+RegNumber+RegYear` addressable triple, per-segment addressing, two trip id systems, hierarchical agent/branch ids, typed `CustomerReference` (`GBL`), TMO base codes, agreement + sub-agreement numbers, `LeadId->OpportunityId->QuoteId->RegNbr` chain. C4: GBL/TMO/agreement numbers are HHG- and military-native. C7: `ExternalReference` round-trips the agent's own id (LEP p.3) and ABS p.4 states plainly that driver/salesperson code cross-referencing is the agent system's responsibility. C8: LOD p.1 — the obsolete `QLAB` path segment is deliberately retained after the system was replaced "to minimize Agent System interface impact", i.e. an explicit *anti*-versioning stance. |

**S5 — fit to Pegasus data** (evidence is the four published ADE overlays in
`pegasus-workflows:platform/allied-vanlines/integrations/` and the pegII-side Weichert
overlay; nothing here was read from pegII's schema directly, so most answers are bounded):

| Area | Fit | Note |
| --- | --- | --- |
| A1 | **partial** | `sirva_ade_shipment/mapping.json` lands `Lifecycle.{EventType, EventId, EventDateTime, Status}` and the floor `shipment_lifecycle_event` validates the six-value status enum (`rules.json` `shipment-status-known`), so the vocabulary is already carried as an inbound projection. Whether pegII has a *state* for `Reinstate`/`IntoWillAdvise` is unknown. |
| A2 | **partial** | The mapping carries `Reference.{Brand, Number, Year, CarrierRef, TripId}` and estimate/actual weight+cubes, but its own README states it covers "the core, representative fields … not the full ~100-field `GetShipmentDetail` surface" (`integrations/sirva_ade_shipment/README.md`). Segments (overflow/transfer/mass-move) are **not** mapped. |
| A3 | **no / unknown** | Only `Reference.TripId` (`CamisTripNumber`) is mapped; `QPDTripNumber` and `Resources[].Type` land but no trip or stop entity exists on our side in anything read here. |
| A4 | **partial** | Event ingest is live (`ade_shipment_event_ingest`) and lands snapshots in a projection keyed `{Brand}:{RegNumber}:{RegYear}`; telemetry fields are not mapped. |
| A5 | **no** | No SIT field appears in any of the four ADE overlays. |
| A6 | **partial** | `sirva_ade_document` maps the full `GetImageList` metadata to a `document_record` floor, including `Kind` from `Type`; the pull/push workflows move the bytes. Whether pegII stores a document *type* from this list is unknown. |
| A7 | **partial** | `sirva_ade_compensation` maps `Totals.{Credit, Debit, Net}` + `LineItems[]` with service code/description/group/driver codes onto a `financial_settlement` floor. Abstract/statement structure is validated inbound (`integrations/sirva_ade_compensation/inbound.json`) but only compensation is mapped. |
| A8 | **partial** | `Resources[] {Id, Name, Type, Owner}` passes through the mapping verbatim — the role vocabulary survives, but as strings on an event, not as parties. |
| A9 | **yes (for the ADE half)** | Every ADE key the overlays need is mapped and the projection key is the `Brand:RegNumber:RegYear` triple. The **correlation to the RMC's id is the gap** — see below. |
| A10-A13 | **unknown** | Nothing in the ADE overlays touches survey, claims, rating or settlement splits. On the pegII side, the Weichert overlay shows pegII *does* hold `Survey.CoreCost` and `Survey.SerivceStatus` (`platform/integrations/weichert/README.md`), so A10 is at least partly suppliable. |

## Strengths worth adopting

1. **Role and ownership as two independent axes.** `Resource.Type` (what function this
   party performs on *this* shipment) x `Resource.Owner` in Corporate/Agent/Vendor (what
   kind of party it is) — with the same company legitimately appearing under several types
   on one shipment (GSD p.17). Our A8 model should make role an attribute of the
   *assignment*, never of the party, and should carry the party's own kind separately.
2. **Four named time families on one shipment.** Agreed-with-customer window (with an
   optional hour/minute narrowing), planned customer date, actual customer date, and the
   *vehicle's* assigned load/unload date — plus the system-record time. ADE proves these
   are four different things that move independently, and that `LoadDateChanged` (the trip
   plan) is a different event from `ALPChanged` (the customer promise). Adopt the
   separation wholesale.
3. **Window absence as an explicit state.** *Will Advise* — `IntoWillAdvise` /
   `OutOfWillAdvise` (SOE p.18) — models "we had promised dates and no longer do" as a
   transition rather than as nulls. Most models can't express the difference between
   "never had dates" and "dates were withdrawn".
4. **Derived-vs-source measures stated as a rule.** "`Weight`: when Actual Weight > 0 then
   reflects Actual Weight otherwise will reflect Billed As Weight" (GSD p.7). Publishing
   the derivation alongside the sources is exactly what a reference model should require
   of any computed field.
5. **The financial correction triple.** Original / `ADJ` / `CAN` with the stated invariant
   that cancel + original sums to zero, plus `BatchNbr` to distinguish reruns, plus the CSR
   `Original`/`Re-Open`/`Adjustment` supersession rule (ABS p.3; GSD p.4). This is a
   complete, testable correction semantics — worth lifting as the pattern for **all**
   corrections in our model, including operational ones where ADE has none.
6. **Segment-addressable reads.** `GetShipmentDetail` lets the caller ask for all segments
   or one (`TransferNumber`/`OverflowNumber`/`MassMoveNumber`, where `00` means main load)
   (GSD p.3). A shipment that splits should stay one queryable thing with addressable parts.
7. **`ExternalReference` round-tripping.** The partner echoes *our* id back on its own
   events (LEP p.3), and the spec assigns cross-reference maintenance to the agent
   explicitly (ABS p.4). A9 should make "whose id is this" a first-class property.
8. **Per-recipient event subscription.** Each agent branch registers "the list of events
   that they desire to receive" against its own queue (SOE p.1). The catalog should
   anticipate that a consumer subscribes to a subset, not the firehose.
9. **Typed evidence with scan provenance.** `DocType` + `ReferenceType` +
   `BatchNumber`/`ScanLocation`/`DateIn` (ADOC p.7; GDOC p.3) — documents carry both what
   they are and where they entered the system.
10. **The `TypeOfMove` enumeration** (Residence/Warehouse/R19/RR19 pairs, GSD p.26) is a
    compact, battle-tested encoding of a move's storage/substitution topology. Worth
    keeping as a derived classification even if we model the topology structurally.

## Weaknesses / traps

1. **It is a van-line-to-agent *read* feed, not a domain model.** Every operational fact is
   asserted by SIRVA; the agent's only write channels are `AddDocument` and
   `AddOpportunity`. Modeling our shipment on ADE would produce a read-only aggregate in
   which the agent — who physically packs, loads and delivers — cannot assert anything.
2. **No stop model and no arrive/depart.** `Locations[]` is a set of addresses with type
   labels, not a sequence of stops; `LocationTypeNumber` is undocumented as an ordinal;
   there is no arrival, departure, or ETA field anywhere. Taking ADE as the A3/A4 source
   would bake in a shipment that teleports from `Loaded` to `Deliver`.
3. **`ShipmentStatus` is not the lifecycle.** Six values (GSD p.8) against ~30 event types;
   `PLANNED` has no event; a shipment sitting in SIT has no status of its own. Treat status
   as a coarse label derived from events, never as the state machine.
4. **Event `DateTime` is a recording time, not an occurrence time** (SOE p.2, and the
   `Loaded`/`Deliver` wording on SOE pp. 15, 19). A catalog that maps it to "when it
   happened" will silently misdate everything.
5. **No reason codes, anywhere.** `Cancel`, `Break`, `Reinstate`, `DeleteSIT`, `ExtendADP`,
   `Overflow` all arrive bare. The *why* lives in `OpsRemarks` free text (GSD p.19). Our
   A4 model must add reason codes rather than inherit their absence.
6. **Identity encodes structure.** `CamisRegNumber` packs overflow and transfer sequence
   into the key (SOE p.2), so a split changes the identifier. Model the split as a
   relationship between shipment parts; do not copy the digit-packing.
7. **Three parallel vocabularies for the same concepts.** Roles: `Resource.Type` strings
   vs 2-digit `ServiceProviderFunction` codes — and the published code table **collides**:
   `06` is both "Origin Agent" and "R19 Agent", `16` is both "Destination Agent" and
   "RR19 Agent" (GSD p.26). Trips: `QPDTripNumber` vs `CamisTripNumber`. Weights:
   estimate/actual vs billed-estimate/billed-actual. Import one canonical vocabulary plus
   explicit mappings, never all three.
8. **`Resources[]` is current state with no history, and the spec says so** (GSD p.4 — a
   replaced hauler survives only in the chargeback section). Never treat a resource list as
   an event log; the assign/remove events are the log, and they are incomplete because a
   replacement may generate no removal event the agent sees.
9. **SIT is a record, not a pair of events, and it has no id.** `InDate`/`OutDate` arrive
   together at `AddSIT` (SOE p.24) so planned-in and actual-in are indistinguishable, and
   `ChangeSIT`/`DeleteSIT` cannot identify which SIT they refer to on a multi-SIT shipment.
   Our A5 model needs a SIT occurrence with an identity and separate in/out events.
10. **The wire contract is not reliably documented.** The field table and the JSON sample
    disagree within the same document: table `LoadDate`/`UnloadDate` vs sample
    `ActualLoadDate`/`ActualDeliveryDate` (SOE pp. 5, 38); `AgreedDeliveryFromDate` vs
    `AgreedDelvFromDate` (SOE pp. 4, 20); `AddSIT` sends `CamisRegNumber` as 6 digits
    (`123456`) against a 12-digit definition (SOE pp. 2, 24); `AddSIT` uses a field
    `Location` that is not in the table (the table has `SITLocation`); `WarehouseState` and
    `CubesBilledEstimate`/`CubesBilledActual` appear in the JSON schema but not the field
    table; `AgreedLoadTimeToMinute` and `AgreedPackFromDate` are each listed **twice**
    (SOE pp. 4-5); `ClaimTyoe` and `ClaimOrignalCSR` are published misspellings (SOE p.30).
    **Do not treat the PDFs as the schema** — confirm against captured traffic.
11. **No time zone on anything** except two lead-side fields. Agreed load *hours* are
    inherently stop-local and carry no zone (SOE p.4). Our model must attach a zone to the
    stop; ADE cannot supply it.
12. **Obsolescence is announced without a successor.** `ShipmentType`, `ShipperType`,
    `SITLocation`, `Origin*`/`Destination*`/`Warehouse*` address fields are each marked
    "obsolete and is being replaced by …" naming fields (`ShipmentTypeName`,
    `ShipperTypeName`, `LocationType`, the `Location` block) that are **not defined in the
    same spec** (SOE pp. 2-3, 6). Both generations must be tolerated on the wire.
13. **No payload versioning.** The only version marker is the cover line
    "May 29, 2025 - Published". The consumer cannot tell which generation of a payload it
    received.

### Where the van-line view conflicts with the RMC (Weichert) view of the same shipment

Our tenants sit between both, so the same physical move is described twice, incompatibly.
Evidence for the Weichert side: `pegasus-workflows:platform/integrations/weichert/`
(`meta.json`, `mapping.json`, `rules.json`, `README.md`).

1. **Two authoritative order numbers, neither aware of the other.** SIRVA's key is
   `Brand + RegNumber + RegYear` (GSD p.15). Weichert's key is `serviceOrderNumber`
   (`O-198870`), which is both a body field and **the URL path segment** — the Weichert
   README records a live `404 "The resource specified has no entity"` on 2026-08-12 from
   using pegII's internal id instead. A9 must carry both as peer references, each tagged
   with its owning party; neither can be "the" order number.
2. **We are a different kind of party to each.** To SIRVA we are an **agent**, identified
   by a 7-digit `AgentNbr` whose trailing digits are the branch, and the branch is named
   again per-push as `SvcProvDataRecipient` (SOE p.2). To Weichert we are the
   **supplier**, and `shipments[].supplierShipmentId` is *our* identifier for the shipment
   (weichert/README.md). One tenant, one move, two role identities simultaneously.
3. **Two lifecycles on different axes.** SIRVA operational: `REGISTERED`, `PLANNED`,
   `ASSIGNED`, `LOADED`, `DELIVERED`, `CANCELLED` — dispatch milestones (GSD p.8).
   Weichert commercial: `Requested`, `Awarded`, `Accepted`, `Submitted`, `In Progress`,
   `Delivered`, `Completed` — procurement milestones (weichert/rules.json). They do not
   align: award/accept happen *before* an ADE registration exists; `Submitted` (estimate
   submitted) has no ADE counterpart at all; ADE's `ASSIGNED` (to a trip) has no Weichert
   counterpart. A shipment must be able to hold both, with neither derived from the other.
4. **The direction of assertion inverts for the same fact.** An actual delivery date is
   *received* from SIRVA (`Deliver`, `ActualCustDelvDate`) and *asserted* to Weichert,
   where their rule `delivered-requires-load-delivery-actuals` gates our submission on
   having load **and** delivery actuals on the same shipment order. The same date is
   inbound evidence in one context and an outbound claim in the other — provenance must
   record which, or a round-trip will look like corroboration when it is an echo.
5. **Shipment cardinality conflicts.** Weichert: one service order contains `shipments[]`.
   SIRVA: one registration *is* the shipment, and a split becomes segment digits inside the
   registration number. Our model needs an order-to-shipment relationship that can absorb
   both.
6. **Cost estimates are different artifacts at different times.** Weichert requires
   `estimatedTotalCost` (from `Survey.CoreCost`) before `In Progress`
   (`submit-requires-estimated-total-cost`). ADE's `ChargeEstimate` is `0` at registration
   (SOE p.12) and real charges only exist after rating — "When Rating to calculate charges
   has completed successfully" (GSD p.3), typically post-delivery. The RMC's estimate and
   the van line's rating are not the same number and never coexist.
7. **Survey is a first-class gate for the RMC and an afterthought for the van line.**
   Weichert gates submission on `surveyDate` (`submit-requires-survey-date`); ADE exposes
   `DPSSurveyAdded` as a bare event with no payload (SOE p.22) and `SurveyDate`/`SurveyId`
   as unvalidated strings on the opportunity (LOD p.5).

## Out-of-v1 material

**A10 — Survey, estimating & inventory.** `DPSSurveyAdded` event (SOE p.22);
`SurveyDate`, `SurveyTime`, `SurveyId`, `SurveyAppointments[]` on the opportunity (LOD
pp. 5, 15); `Activities[]` with `Type: "Customer Appointment"`, `Duration` in minutes and
the request-for-cancel status set (LOD p.6); `EstimatorID` and `SalesPersonID` (4 chars) on
the shipment (GSD p.8); `BindingEstimateIndicator` (GSD p.8); `WeightEstimate`/`CubesEstimate`
vs `WeightBilledEstimate`/`CubesBilledEstimate` (GSD p.7); lead move-profile fields
`DwelingType` (sic) with a bedroom-count enum, `FurnishLevel` Heavy/Light/Medium,
`SpecialItems`, `MovingVehicle`/`NumberVehicles`/`Make`/`Model`/`Year`, `DateFlexible`
(LOD pp. 3-4); reweigh obligations as ops remarks keyed to military rank (GSD p.19) and
the `REWH` "REWEIGH" and `BACK` "BACKWEIGH SUPERVISION" charge codes (ASC pp. 1, 3);
document types `Inventory` and `High Value Inventory` (ADOC p.8).

**A11 — Claims & valuation.** The whole CSR structure: Group 1 identification
(`TransactionType`, `SettlementDate`, `SettlementType` D/P where "It appears like this field
is settlement status not type", `SettlementAmount`, `RecvdDate`), Group 2 item
responsibility (`ServiceProviderFunction`, `Article`, `Type`, `Weight`,
`ResponsibilityAmount`), Group 3 agent summary chargeback (external / concealed /
mechanical / missing / other damage amounts, `DebitAmount`, `ChargetoECP`, plus
`OtherCharges` 1-3), Group 4 check payment, Group 5 ledger posting (GSD pp. 13-14; SOE
pp. 30-33). `ClaimType` and `Claim Status` enumerations and the `TypeOfMove` table (GSD
pp. 25-26). Valuation: `ValuationAmount`, `ValuationCost`, `ValuationCharge`,
`ValuationDeductOpt` (GSD p.8), the deductible enumeration NO/$250/$500 (SOE p.34), and
the `MVP` "MAXIMUM VALUE PROTECTION" charge whose `SvcRates[]` prices all three deductible
options with `RateUsed: "Y"` on the chosen one (GSD p.20) — a nicely explicit
"priced alternatives, one selected" structure. **Caveat: the CSR field semantics are
defined by callouts on unreadable screenshots** (SOE pp. 35-37; GSD p.27).

**A12 — Rating & tariffs.** The `CHARGES[]` structure with `SvcQuantity[]` (UoM `WEIGHT`,
`MILES`, `ECP-VAL`, `DEDUCT-OPTN`, `VAL-PER-LB`) and `SvcRates[]` (`RateName` in `PER CWT`,
`PER MILE`, `PERCENT`, `BASE`, `ADD'L`, `CHARGE`, deductible names; `RateUsed` Y/N)
(GSD pp. 19-21). `CustomerAgreementNumber` + `CustomerSubAgreementNbr` (sample `409NG`/`4`,
`C1793`/`1` — tariff-like agreement codes), `DiscountPercent`, `PeakSeasonIndicator`,
`WholeSalePricingIndicator`(+Description), `GPPCharge` ("Paid in Full"), `MilesTotalEstimate`
(GSD pp. 8, 16-17); `CGP` "PRICE LOCK", `FSUR`/`CSUR` fuel-related, `IRS*` customer charges
(ASC pp. 1-2). `Hauling Authority Type Names`: INTERSTATE / INTRASTATE (SOE p.34). Payment
type CHARGE/COD/PREPAID and the card/method enumeration (GSD p.24).

**A13 — Crew, driver & settlement.** The whole accounting stack is a settlement model:
`TransRevenue` "distributed according to allocation rules to Origin Agent, Hauler,
Destination Agent, SIRVA" (ABS p.3); the ~140-row **abstract service-code catalogue** with
its STS code and its 2-part **Abstract Code** (ASC pp. 1-6) — compensation codes `BOOK`
BOOKING COMPENSATION (1), `ORGN` ORIGIN COMPENSATION (2), `HAUL` HAULING COMPENSATION (3),
`LOADRT`/`LOADOT` LOAD COMPENSATION (4-A), `UNLDRT`/`UNLDOT` UNLOAD (4-B), `BKSVBA` BOOKER
SERVICE REVENUE (4-C), `SHLD`/`SHUL` shuttle load/unload, `OASABA`/`OASAOA` out-of-area by
booker vs OA, `PKPO`/`UNPO` packing/unpacking payout, `POSD` REPOSITIONING FUND DEBIT,
`IVEF` INTERIOR VAN EQUIP FUND. `Driver1Code`/`Driver2Code` "only present when the Service
Code value reflects HAULING", `SalesPersonCode` "only be present when the Service Code
reflects the value BASV" (ABS p.4) — i.e. **the payee is carried on the line item, keyed by
service**. Statement halves and posting tickets (ABS pp. 9-11). `GetAgentComp` as the
same-day read so agents "pay Driver and Salesperson ASAP" (AVAIL p.3).

**Beyond the rubric — integration operations.** OAuth 2.0 client-credentials with a
**10-minute** token and no refresh, one `Client_Id` per agency regardless of branches or
dual branding (OAUTH; GSD p.1) — note the GDOC p.5 sample nonetheless shows
`"expires_in":3600`. Push channels require the *agent* to host an authenticated endpoint
and return SIRVA's `Result{Results: Success|Failed, ResultsMessageCount, ResultsMessage[]}`
ack envelope (SOE pp. 9, 37). `GetImage` has a **200 MB / 2-minute** limit and the agent
must configure a 2-minute endpoint timeout (GDOC p.2); `AddDocument` allows **2 GB** of
base64 `FileData` (ADOC p.3). Pull uses a monotonic `Id` cursor with optional
`FromId`/`ToId` for replay (LEP p.3). Push and pull for leads are **mutually exclusive per
agency** (LEU p.1). The ADE landscape also names our competitors' coverage (GS p.1), which
records that "Pegasus" today supports only the two lead APIs.

## Open questions

1. **Which payload-scope contract is real?** SOE p.1 says "the scope of the shipment
   details will vary based on Event Type"; SOE p.10 says "All the shipment elements are
   sent and will reflect null if change does not impact element". These imply different
   consumers. Must be settled by captured traffic or by SIRVA, because it decides whether
   an event is a delta or a snapshot — and our `ade_shipment_event_ingest` currently treats
   each `Events[]` element as "a full shipment snapshot"
   (`pegasus-workflows:platform/allied-vanlines/ade_shipment_event_ingest/.../workflow.py`).
2. **Are push events ordered and de-duplicable?** `Id` is a timestamp-shaped string with 7
   fractional digits and is called "unique key for each event" (SOE p.2), and the *pull*
   channel treats `Id` as a monotonic cursor (LEP p.3). Is the push `Id` monotonic per
   queue? Is redelivery possible? Our projection upsert is idempotent, but ordering
   matters for status.
3. **What time zone are the agreed load/delivery hours in?** Stop-local, agent-local, or
   SIRVA Central? Nothing in SOE/GSD says, and the lead spec's "Eastern assumed" cannot be
   extrapolated.
4. **How is a SIT occurrence identified** for `ChangeSIT`/`DeleteSIT` on a shipment with
   both origin and destination SIT? And are `InDate`/`OutDate` planned or actual?
5. **Where do reasons live?** Is there any structured reason for `Cancel`, `Break`,
   `Reinstate`, `Overflow`, `ExtendADP` — or is `OpsRemarks` genuinely the only channel?
6. **What are the replacement fields** named but not defined: `ShipmentTypeName`,
   `ShipperTypeName`, `LocationType`, and the `Location`-prefixed address block that
   supersedes `Origin*`/`Destination*`/`Warehouse*` (SOE pp. 2-3, 6)? Are both generations
   sent today?
7. **Is `LocationTypeNumber` a stop sequence?** Every sample shows `00` on mainload
   pickup/delivery; extra stops presumably increment. If so, ADE does have a stop ordinal
   and it is simply undocumented.
8. **Which events will our agencies actually be subscribed to?** The queue is configured
   per agent location with a chosen event list (SOE p.1) — the effective catalog is a
   per-tenant subset, and we need the list before treating any event as guaranteed.
9. **Are the `ServiceProviderFunction` duplicates (06, 16) a typo or a real overload?**
   (GSD p.26.) If real, role decoding from claims/settlement is ambiguous.
10. **Does any ADE field carry the RMC's order number?** `CustomerReference[]` is typed
    (`GBL` in the sample) and `CustomerAgreementNumber` identifies the account — is there a
    reference type for a national-account/RMC service order, or must we correlate
    Weichert-to-SIRVA locally on shipper name + addresses + dates?
11. **What is the CSR field layout** behind the "CSR Picture" callouts (SOE pp. 35-37;
    GSD p.27)? Needed before A11 can be modeled from this source; the images would have to
    be OCR'd or the layout obtained from SIRVA.
12. **`Result.Results` polarity is inconsistent across specs** — `"Success"`/`"Failed"` in
    SOE p.9 and ABS p.4, but `"True"`/`"False"` in GSD p.4, GAC p.2 and GDOC p.3. Which
    does each endpoint actually return?
