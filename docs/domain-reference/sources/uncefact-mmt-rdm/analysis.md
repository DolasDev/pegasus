---
source: src:uncefact-mmt-rdm
analyzed: 2026-09-17
evidence_grade: A
material: |
  All paths relative to sources/uncefact-mmt-rdm/local/uncefact-reference-data-models/
  READ IN FULL:
    - BRS_MultiModalTransportReferenceDataModel-MMT/BRS_T+L-MMT.pdf (16 pp., "Public Draft v1.0", 01 Mar 2018)
    - BRS_MultiModalTransportReferenceDataModel-MMT/BRS_T+L-MMTDataElements.xls
      (sheets "MMT SHIP Master Message" 12 rows, "MMT CCL Subset" 1474 rows - the MMT data
      dictionary: UNID, ABIE/BBIE/ASBIE, business name, definition, cardinality, dictionary entry
      name, path. Read via xlrd; cited below as "MMT CCL Subset row N".)
    - MMT-RDM_D19A/XSD/schema/uncefact/...ReusableAggregateBusinessInformationEntity_101.xsd
      (117 complexTypes, the D19A machine-readable model; element names, types, cardinalities)
    - MMT-RDM_D19A/XSD/schema/uncefact/...QualifiedDataType_101.xsd (code-list bindings)
    - MMT-RDM_D19A/XSD/schema/errors.txt
    - BRS_BuyShipPay_v1.0.pdf (16 pp., Jul 2019) - the parent BSP-RDM that consolidates MMT + SCRDM
  READ (enumerated, values only - see "What we could not read"):
    - BRS_MultiModalTransportReferenceDataModel-MMT/BRS_T+L-MMT-xsd-Master_1p0_28FEB18/*.xsd (76 files, D16B vintage)
    - MMT-RDM_D19A/XSD/schema/uncefact/*.xsd (82 files, D18B vintage)
  NOT READ: MMT-RDM_D19A/UML/UML-Diagram/ (see below)
---

# UN/CEFACT Multimodal Transport Reference Data Model (MMT-RDM) - analysis

## What it is

UNECE / UN/CEFACT's **neutral, syntax-independent reference data model for multimodal
transport**, produced by the Transport & Logistics domain of the SHIP Programme Development
Area (project P1024). It is not a message format: it is a *contextualised subset of the
UN Core Component Library (CCL)* from which concrete message/document structures ("Business
Data Exchange Structures") are later derived - BRS_T+L-MMT.pdf p.5. MMT is one of two
sibling subsets of the **Buy-Ship-Pay Reference Data Model**; the other is the SCRDM
(analysed separately as `src:uncefact-scrdm`) - same p.5, "The UN/CEFACT MMT Reference Data
Model is a subset of the Buy/Ship/Pay Reference Data Model and a sister to the Supply Chain
Reference Data Model (SCRDM)".

- **S1 Kind:** `reference-model`
- **S2 Adoption / maturity:** **2**. UN-published and stable as a *vocabulary* (its CCL
  entities are reused by the WCO Data Model and the UN/EDIFACT transport message lineage), and
  the D19A/D22A releases are real dated library versions. But the MMT BRS itself is still
  labelled "ACTION: Draft for Public Review / STATUS: Public Draft v1.0" (BRS_T+L-MMT.pdf p.1),
  and the derived CCBDA message structures were largely unpublished at the time ("At this
  moment only the CI Invoicing CCBDA RSM has been published" -
  BRS_SupplyChainReferenceDataModel-SCRDM p.4 fn.3). Nobody in North-American household goods
  implements MMT directly.
- **S3 Openness:** `public` (UN/CEFACT IPR policy waiver, BRS_T+L-MMT.pdf p.1 disclaimer).
- **S4 Evidence grade:** **A** - we read the normative business-requirements spec, the full
  data dictionary with definitions, and the machine-readable schema. Two qualifications below.

### What we could not read

1. **Code-list *meanings*.** Every code list ships in this package as a bare XSD
   `xsd:enumeration` list of values with **no names and no definitions** - e.g.
   `...UNECE_TransportMovementStageCode_D18B.xsd` is literally `value="1" value="2" value="3"...`.
   We can state how many codes each list has and what element binds it; we **cannot** state
   what any individual code means. The meanings live in UNTDID/UNECE code-list
   recommendations that are referenced but not included here (the dictionary points at them:
   MMT CCL Subset row 468 cites "[UNECE Recommendation 24]" for Logistics Status Condition
   Code). Anywhere below that a code list is characterised, it is characterised by *size and
   binding*, not by content.
2. **UML diagrams.** `MMT-RDM_D19A/UML/UML-Diagram/` is one class diagram exported as
   **33,272 tiled 500x500 GIFs** across a 3,562 x 2,376,435-pixel canvas, stitched by an HTML
   table (`MMT D19A Context SHIP Master_UNECE.html`, 4.8 MB of `<IMG>` tags). Not readable at
   any useful scale. The same content is in the XSD and the dictionary, which we did read, so
   nothing is lost - but we did not look at the picture.
3. The D16B-vintage `BRS_T+L-MMT-xsd-Master_1p0_28FEB18/` schema set was enumerated and
   spot-checked but analysed from its D18B successor in `MMT-RDM_D19A/`, which is a superset
   (adds `TransportEquipmentMovementStatusCode`, `TransportEquipmentOperationalStatusCode`,
   `TransportEquipmentMovementLegalStatusCode`, `TransportStatusCode_4`, `TimeOnlyFormatCode`,
   `AddressType`).

## Model summary

MMT's shape, in its own words.

**The two contracts.** Everything hangs off a distinction between the **Sales Order Contract**
and the **Transport Service Contract** (BRS_T+L-MMT.pdf pp.10-11, Figures 4 and 5). MMT is
scoped to the transport side only: "the MMT scope therefore includes the transport booking,
transport ordering and freight invoicing processes together with the actual transportation and
the required border clearance processes" (p.11). Quotation, sales-order confirmation, despatch
advice and sales invoicing are **explicitly out of scope of MMT** (p.11 sec 8.1.1).

**The goods spine** (BRS_T+L-MMT.pdf pp.14-16, Figure 6 and the business rules under it):

```
Sales Order --1..*--> Trade Item        (commercial view: product, qty, unit price, tariff code)
                          |
                          +- aggregated by tariff code / packaging -> Consignment Item
                          |
Shipment ---- an identifiable collection of Trade Items, Seller -> Buyer, one Customs UCR
                          |
Consignment - a separately identifiable collection of Consignment Items, one Consignor ->
              one Consignee, under ONE transport service contract
                          |
Customs Item - aggregation with a distinct tariff code, for reporting to Customs
```

**The movement spine** (from the D19A schema, `LogisticsTransportMovementType` /
`SupplyChainConsignmentType`):

```
Supply Chain Consignment
  +- PreCarriage / MainCarriage / OnCarriage / BorderCrossing / AtArrival / AtDeparture
  |     Logistics Transport Movement        <- the journey legs, by role not by sequence number
  +- Utilized Logistics Transport Equipment <- containers/ULDs, not vans
  +- Transport Logistics Package
  +- ~20 named Transport Event slots (PickUp, Delivery, Storage, BondedWarehouseStorage,
  |     Vanning, Devanning, Examination, Transshipment, ...)
  +- ~35 named Trade Party role slots (see A8 below)
  +- ~10 named Logistics Location slots (CarrierAcceptance, Transshipment, ConsigneeReceipt,
  |     LoadingBaseport, UnloadingBaseport, Transit, FinalDestination, Loading, Unloading, ...)
  +- Reported Logistics Status [0..*]

Logistics Transport Movement
  +- Used Logistics Transport Means   (the vehicle/vessel/aircraft)
  +- Master Responsible / Crew Transport Person
  +- Loading / Unloading / Arrival / FirstArrival / Departure / Call / BorderCrossing /
  |     Transshipment / ShipToShip / Specified Transport Event
  +- Itinerary Transport Route [0..*]  --> Itinerary Stop Transport Event [0..*]
```

**Cardinality between the two spines** is stated normatively only in the parent BSP BRS
(BRS_BuyShipPay_v1.0.pdf p.16): "A transport movement corresponds to one or more consignment,
one consignment may include more than one transport movement." That is the many-to-many
trip-to-shipment relation, and it is the single most transferable structural claim in the
package.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Shipment** | "an identifiable collection of one or more Trade Items (available to be) transported together from the Seller (Original Consignor/Shipper), to the Buyer (Final/Ultimate Consignee)". Can only be destined for one Buyer; can draw Trade Items from one or more Sales Orders; may form part or all of a Consignment **or may be transported in different Consignments**. | A2 | BRS_T+L-MMT.pdf p.15 |
| **Consignment** (aka **Transport Service Order**) | "a separately identifiable collection of Consignment Items (available to be) transported from one Consignor to one Consignee via one or more modes of transport as specified in one single transport service contractual document". Exactly one Transport Service Buyer, one Transport Service Provider, one Consignor, one Consignee. | A2, A9 | BRS_T+L-MMT.pdf p.15 |
| **Consignment Item** | "A separately identifiable quantity of products grouped together by Customs tariff code or packaging for transport purposes ... the lowest level of information within a Consignment." | A2 | BRS_T+L-MMT.pdf p.16 |
| **Trade Item** | "the lowest level of 'commercial' information in a Sales Order between the Buyer and the Seller". Rule in MMT: "A single Trade Item **cannot** be split across Shipments." | A2 | BRS_T+L-MMT.pdf p.15 |
| **Logistics Transport Movement** | "The conveyance (physical carriage) of goods or other objects used for logistics transport purposes." Its `ID` is "such as a voyage number, flight number, **or trip number**". | A3 | MMT CCL Subset rows 587, 591 |
| **Transport Movement. Stage Code** | "The code specifying the stage of this logistics transport movement." 30 codes (values only). | A3 | MMT CCL Subset row 588; `...TransportMovementStageCode_D18B.xsd` |
| **Transport Means** | "The devices used to convey goods or other objects from place to place during logistics cargo movements." | A3 | MMT CCL Subset row 551 |
| **Transport Route** | "A way or course taken from one location to another for the purpose of transporting cargo and or passengers." Carries `Itinerary Stop Event [0..*]`, a `Scheduled Period`, a `Frequency Type Code`, and a `Status Code` "such as **planned or actual**". | A3 | MMT CCL Subset rows 1439, 1446, 1447 |
| **Transport Event** | "A significant occurrence or happening during transport." | A4 | MMT CCL Subset row 1397 |
| **Supply Chain Event** | "A significant occurrence or happening in a supply chain." Carries `Description Binary Object` - "Binary object data, **such as a photograph**, describing this supply chain event". | A4, A6 | MMT CCL Subset rows 1043, 1048 |
| **Logistics Status** | "The information relevant to a condition or a position related to logistics." Has `Condition Code` + `Reason Code`, both "[UNECE Recommendation 24]", plus `Reference Date Time`, `Sequence Number` ("such as within a status report"), `Validity Period`, and four reported-event slots (Arrival / Departure / Loading / Unloading). | A4 | MMT CCL Subset rows 467-479 |
| **Logistics Location** | "A logistics related physical location or place." `ID` is "such as a United Nations Location Code (UNLOCODE) or GS1 Global Location Number (GLN)"; `Type Code` binds LocationFunctionCode (305 codes). | A3, A9 | MMT CCL Subset rows 407-410 |
| **Logistics Transport Equipment** | "A piece of equipment used to hold, protect or secure cargo for logistics purposes." Carries Storage / Bonded Warehouse Storage / **Positioning** / **Pick-Up** / Delivery events. Positioning = "delivered and available for pick-up"; Pick-Up = "collected, i.e. picked-up by the carrier". | A3, A5 | MMT CCL Subset rows 480, 536-540, 548 |
| **Despatch Party** | "The party where goods are collected or taken over by the transport services provider. **Operational term is 'Pick-up Place'.**" | A8 | BRS_T+L-MMT.pdf p.12 |
| **Delivery Party** | "The party to which goods should be delivered by the transport services provider. **Operational term is 'Place of Positioning'.**" | A8 | BRS_T+L-MMT.pdf pp.12-13 |
| **Transport Services Buyer** | "The buyer of transport services as stipulated in a Transport Service Contract." May be performed by either Consignor or Consignee depending on Terms of Delivery. | A8 | BRS_T+L-MMT.pdf pp.12, 13 |
| **Transport Service** | "A service associated with a transport movement." Has `Category Type Code`, `Condition Type Code`, `Priority Code`, `Service Requirement Code [0..*]`, `Charge Amount`, `Requester` and `Responsible Party`. | A2, A7 | MMT CCL Subset rows 1450-1465 |
| **Logistics Service Charge** | "A charge made for a logistics related service." | A7 | MMT CCL Subset row 442 |
| **Referenced Document** | "Written, printed or electronic matter that is referenced." | A6 | MMT CCL Subset row 696 |
| **Exchanged Document** | "A collection of data for a piece of written, printed or electronic matter that is exchanged between two or more parties." | A6 | MMT CCL Subset row 191 |
| **Customs UCR** | Unique Consignment Reference. "A Shipment can have only one Customs UCR"; "A Consignment can have one or more Customs UCRs." | A9 | BRS_T+L-MMT.pdf pp.15-16 |
| **Vanning / Devanning Transport Event** | stuffing/unstuffing a container. Named event slots on Consignment. | A4 | `...ReusableAggregate..._101.xsd`, `SupplyChainConsignmentType` |

## Lifecycles & events

**There is no state machine anywhere in MMT.** No spec in this package names a state, a
transition, a guard, or an actor permitted to cause one. What exists is:

**(a) Named event slots, not an event type enumeration.** MMT's dominant idiom is to attach a
`Transport Event` to a parent under a *role-qualified association name* rather than to give
the event a type code from an enumeration. On `SupplyChainConsignmentType`
(`...ReusableAggregateBusinessInformationEntity_101.xsd`) the event slots are:
`DeliveryTransportEvent [0..1]`, `PickUpTransportEvent [0..1]`, `TransportEvent [0..*]`,
`ExaminationTransportEvent [0..*]`, `StorageTransportEvent [0..*]`,
`BondedWarehouseStorageTransportEvent [0..*]`, `VanningTransportEvent [0..1]`,
`DevanningTransportEvent [0..*]`. On `LogisticsTransportMovementType`:
`LoadingTransportEvent`, `UnloadingTransportEvent`, `ArrivalTransportEvent`,
`FirstArrivalTransportEvent`, `DepartureTransportEvent`, `CallTransportEvent [0..*]`,
`BorderCrossingTransportEvent [0..*]`, `TransshipmentIntermediateTransportEvent [0..*]`,
`ShipToShipTransportEvent [0..*]`, `SpecifiedTransportEvent [0..*]`. On
`LogisticsTransportEquipmentType`: `StorageEvent`, `BondedWarehouseStorageEvent`,
`PositioningEvent`, `PickUpEvent`, `DeliveryEvent`. `Transport Event` *also* carries a
free `Type Code` (MMT CCL Subset row 1399) but the code list backing it is not bound in the
schema - it is plain `udt:CodeType`, i.e. open.

**(b) A status object, separate from events.** `Logistics Status` (MMT CCL Subset rows
467-479) is the reporting vehicle: `Condition Code` + `Reason Code [0..*]`, both drawn from
**UNECE Recommendation 24** (bound in `...QualifiedDataType_101.xsd` as
`LogisticsStatusCodeType` -> `clm6Recommendation24:TransportStatusCodeContentType`, 336
values in `...TransportStatusCode_4.xsd`, `listAgencyID` fixed to "6"). Crucially it keeps
**status and reason as separate coded fields drawn from the same list**, plus a free-text
`Reason Text`, plus a `Validity Period`, plus the four reported events that justify it. This
is the "status + reason code" pattern the rubric asks about, and MMT has it cleanly.

**(c) A second, unrelated status code.** `qdt:StatusCodeType` -> `...StatusCode_D18B.xsd`
(491 values) is bound to `LogisticsTransportMovement.StatusCode`, `TransportRoute.StatusCode`
and `TradeTax.StatusCode` only. So MMT carries **two different status vocabularies** - one for
the goods (Rec 24, on Logistics Status) and one for the journey/route (StatusCode). Nothing in
the package reconciles them.

**(d) Document lifecycle, which is the only thing resembling a lifecycle.** `Exchanged
Document` (MMT CCL Subset rows 191-233) has `Purpose Code` (MessageFunctionCode, 69 values),
`Amendment Purpose Code`, `Status Code`, `Version ID`, `Revision Date Time`, `Acceptance Date
Time`, `Submission Date Time`, `Cancellation Date Time`, `Rejection Response Date Time`,
`Response Date Time`, `Response Request Type Code`, and four ordered signatory-authentication
slots. Corrections in MMT are *document* corrections: you reissue the document with a new
version and an amendment purpose. There is no correction or reversal semantic on an *event*.

**Code-list inventory** (D18B set in `MMT-RDM_D19A/XSD/schema/uncefact/`; counts are
`xsd:enumeration` counts; **values only, no names - see "What we could not read"**):

| List | Codes | Bound to |
| --- | --- | --- |
| `TransportStatusCode_4` (UNECE Rec 24) | 336 | `LogisticsStatus.ConditionCode`, `LogisticsStatus.ReasonCode` |
| `StatusCode_D18B` | 491 | `LogisticsTransportMovement.StatusCode`, `TransportRoute.StatusCode`, `TradeTax.StatusCode` |
| `PartyRoleCode_D18B` | 605 | `TradeParty.RoleCode [0..*]` |
| `PartyRoleCode_ChargePaying_D18B` | 21 | charge-paying party role |
| `ReferenceTypeCode_D18B` | 817 | `ReferencedDocument.ReferenceTypeCode` |
| `DocumentNameCode_D18B` | 786 | `ReferencedDocument.TypeCode`, `ExchangedDocument.TypeCode` |
| `DocumentStatusCode_D18B` | 39 | `ReferencedDocument.StatusCode`, `ExchangedDocument.StatusCode` |
| `MessageFunctionCode_D18B` | 69 | `ExchangedDocument.PurposeCode` |
| `LocationFunctionCode_D18B` | 305 | `LogisticsLocation.TypeCode` |
| `TransportMovementStageCode_D18B` | 30 | `LogisticsTransportMovement.StageCode` |
| `TransportMovementTypeCode_D18B` | 5 | (declared; unbound in the RAB we read) |
| `TransportModeCode_2` | 10 | `LogisticsTransportMovement.ModeCode` |
| `TransportMeansTypeCode_2007` | 279 | transport means type |
| `TransportServiceCategoryCode_D18B` | 23 | transport service category |
| `TransportServiceRequirementCode_D18B` | 66 | `TransportService.ServiceRequirementCode [0..*]` |
| `TransportServiceConditionCode_D18B` | 39 | `TransportService.ConditionTypeCode` |
| `TransportEquipmentFullnessCode_D18B` | 13 | equipment fullness |
| `TransportEquipmentMovementStatusCode_D18B` | 4 | equipment movement status |
| `TransportEquipmentOperationalStatusCode_D18B` | 23 | equipment operational status |
| `PackageTypeCode_2006` | 377 | package type |
| `ActionCode_D18B` | 118 | action |
| `EventTimeReferenceCode_D18B` | 65 | **see the note below - NOT bound to transport events** |
| `TimePointFormatCode_D18B` | 6 | date-time format qualifier |

**Correction to a likely expectation: `EventTimeReferenceCode` is not MMT's planned/estimated/
actual mechanism.** In `...QualifiedDataType_101.xsd` it surfaces as `TimeReferenceCodeType`, and
the only element in the whole D19A RAB typed `qdt:TimeReferenceCodeType` is
`TradeTaxType/DueDateTypeCode` (line 7576) - a *tax payment due-date* qualifier. MMT does the
planned/estimated/actual job structurally instead, with named attributes on `Transport Event`.
Anyone mining this package for a time-qualifier vocabulary will find the list, and it will be
the wrong list.

## Time, identity, evidence

### Time - the strongest part of MMT

`TransportEventType` (`...ReusableAggregateBusinessInformationEntity_101.xsd`; definitions at
MMT CCL Subset rows 1397-1427) carries, as **separate, simultaneously-populatable attributes**:

- `EstimatedOccurrenceDateTime` - "the estimated date ... of the occurrence of this transport event"
- `ActualOccurrenceDateTime`
- `ScheduledOccurrenceDateTime`
- `RequestedOccurrenceDateTime`
- `ScheduledArrivalRelatedDateTime` / `ActualArrivalRelatedDateTime`
- `ScheduledDepartureRelatedDateTime` / `ActualDepartureRelatedDateTime`
- `ArrivalRelatedDateTime [0..*]` / `DepartureRelatedDateTime [0..*]`
- `EstimatedTransportMeansArrivalOccurrenceDateTime` - "when the arrival of a means of
  transport at the location of this transport event is estimated to occur" (i.e. an ETA for
  the *vehicle* distinct from the ETA of the *event*)
- `OccurrenceSpecifiedPeriod [0..*]` - a **window**, not an instant
- `DelayOccurrenceSpecifiedPeriod [0..*]` - the delay itself is a period, not a flag
- `TransportMeansStayOccurrenceSpecifiedPeriod` - dwell
- `LaycanOccurrenceSpecifiedPeriod` - the maritime laydays/cancelling window

Four points worth carrying forward:

1. **One event object holds all four time flavours at once** (scheduled/requested/estimated/
   actual). The event is not re-emitted per flavour; it is *revised*. That is a different shape
   from an event *stream* and has consequences for a Cloud event catalog.
2. **Arrival and departure are attributes of an event, not separate events.** A "call at a
   location" is one `Transport Event` with scheduled and actual arrival *and* departure times.
3. **Delay is modelled as a period**, and a delay can also be attached by reference:
   `DelaySpecifiedReferencedTransportEvent [0..*]` on `TransportEventType`, where
   `ReferencedTransportEventType` = scheduled arrival + scheduled departure + **`ReasonTypeCode`**
   + occurrence period. So "we are late, here is the schedule we missed and why" is expressible.
4. **Date-only vs instant** is handled by a format qualifier, not by separate types: all of these
   are `udt:DateTimeType` / `qdt:FormattedDateTimeType` with `TimePointFormatCode` (6 values) or
   `TimeOnlyFormatCode` carrying the precision. Time zone is **not** modelled as a property of
   the stop - `LogisticsLocation` has ID, name, type code, country, coordinates, address,
   subordinate location, servicing party, stay period, and **no time zone** (MMT CCL Subset
   rows 407-417). That is a real gap for our domain.

### Identity and cross-references - also strong

MMT's identity idiom is **one identifier attribute per asserting party**, so who assigned a
number is encoded in the attribute name rather than in a qualifier:

- `SupplyChainConsignment`: `ID`, `ConsignorAssignedID`, `ConsigneeAssignedID`,
  `CarrierAssignedID` ("such as a **booking reference number** when cargo space is reserved
  prior to loading"), `FreightForwarderAssignedID`, `CustomsID [0..*]`, `TradedParcelID`
  (MMT CCL Subset rows 891-897)
- `LogisticsTransportMovement`: `ID`, `ScheduledID` ("as stated in a schedule"),
  `TradingConsolidatorAssignedID`, `TerminalOperatorAssignedID [0..*]`, `StayID`
  (rows 591-595)
- `ExchangedDocument`: `TraderAssignedID`, `SenderAssignedID`, `RecipientAssignedID`,
  `CustomsID`, `VersionID` (rows 209-213)
- `TradeParty`: `ID`, `RegisteredID [0..*]`, plus `SpecifiedTaxRegistration` and
  `SpecifiedGovernmentRegistration` (row 1196 and `TradePartyType` in the RAB)
- Generic typed reference: `ReferencedDocument.ReferenceTypeCode` over an 817-value list.

Above that sits the **UCR ladder**, stated only in the parent BSP BRS
(BRS_BuyShipPay_v1.0.pdf p.13): "**TUCR** (Trade Transaction level reference), **HUCR**
(House Consignment level reference) and **MUCR** (Master consignment level reference)", to
"support the many-to-many Master Transport Contract and House Transport Contract consignment
relationships". That is exactly the house/master bill layering, named.

### Evidence and provenance - weak

- The only "who asserted this" hook on an event is `CertifyingTradeParty [0..*]` on
  `TransportEventType` (MMT CCL Subset row 1421, "A certifying party for this transport
  event"). There is no general actor-of-assertion, no observation source, no confidence.
- `TransportEventType.RelatedSpecifiedObservation [0..*]` (`SpecifiedObservationType`,
  "A specified act or instance of viewing or noting a fact or occurrence for some scientific or
  other special purpose" - row 798) is the nearest thing to sensor provenance. It is generic.
- Photographic evidence exists only on `Supply Chain Event` (`Description Binary Object`,
  row 1048) and as `AttachedSpecifiedBinaryFile` on documents - **not** on `Transport Event`.
- Corrections: document-level only (`Purpose Code`, `Amendment Purpose Code`, `Version ID`,
  `Revision Date Time`, `Cancellation Date Time`). Nothing retracts or supersedes an *event*.

## Scores

Weighting is decided in phase 3; these are the raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 1 | 2 | 1 | 0 | 1 | 2 | 1 | 3 | MMT deliberately covers only booking + transport ordering + freight invoicing (BRS p.11 sec 8.1.2); quotation/order-confirmation "out of scope of MMT" (p.11 sec 8.1.1). No states/transitions anywhere. C3=1 only for `ExchangedDocument` Purpose/Amendment Purpose/Acceptance/Rejection/Cancellation date-times (CCL rows 201, 206-207, 215-217). C6 for `CarrierAssignedID` = booking reference (row 895). C8=3: formal CCL change-request process, dated library versions (Guideline sec 8, pp.21-23). |
| **A2** Shipment structure | 3 | 3 | 1 | 0 | 1 | 3 | 1 | 3 | Shipment / Consignment / Consignment Item / Trade Item all defined with explicit numbered business rules, BRS pp.14-16 - this is C2=3 material. Weights: `GrossWeightMeasure`, `NetWeightMeasure`, `ChargeableWeightMeasure`, `GrossVolumeMeasure`, `LoadingLengthMeasure` (CCL rows 904-908). Services ordered = `TransportService` with category/requirement/condition codes (rows 1450-1460). **Zero** HHG shipment typing (C4=0): no HHG/storage/vehicle/PPM distinction. |
| **A3** Trip, stop & assignment | 2 | 2 | 1 | 0 | 2 | 3 | 1 | 3 | `LogisticsTransportMovement` ID is explicitly "voyage number, flight number, **or trip number**" (CCL row 591); legs by role - `PreCarriage`/`MainCarriage`/`OnCarriage`/`BorderCrossing`/`AtArrival`/`AtDeparture` (RAB `SupplyChainConsignmentType`); trip-to-shipment is many-to-many (BSP BRS p.16). Consolidation expressible (`ConsignmentQuantity` on the movement; movement -> many consignments). **Stop sequence is the gap:** `TransportRoute.ItineraryStopTransportEvent [0..*]` has **no sequence number** - `TransportEventType` has none (checked: the only `SequenceNumeric`s in the model are on package, status, equipment, means, consignment and consignment item - CCL rows 426, 473, 502, 513-514, 563, 725, 742, 824, 898-899, 948). Driver/crew exists as `TransportPerson` but is FAL-form shaped, not an assignable resource. |
| **A4** Execution events & tracking | 3 | 2 | 1 | 0 | 3 | 2 | 1 | 3 | ~20 named event slots covering arrive/depart/load/unload/pickup/deliver/store/vanning/examination/transshipment (RAB, listed above). C5=3: four time flavours on one event + windows + delay-as-period + reason-coded referenced delay event (CCL rows 1401-1412, 1417; `ReferencedTransportEventType.ReasonTypeCode`). Status+reason pair from one Rec 24 list (rows 468, 471). C2=2 because definitions are one-liners - "a significant occurrence or happening during transport" does not distinguish *loaded* from *departed*; the distinction is carried by the association name, which is nowhere defined. C7=1: `CertifyingTradeParty` only. |
| **A5** Storage-in-transit | 1 | 1 | 0 | 0 | 1 | 1 | 0 | 2 | Storage exists but as *customs/container* storage, not SIT: `StorageTransportEvent [0..*]` and `BondedWarehouseStorageTransportEvent [0..*]` on Consignment (CCL rows 995-996), same pair on Transport Equipment (rows 536-537), `WarehouseArrivalDateTime` on Consignment (row 903), `LogisticsLocation.StaySpecifiedPeriod [0..*]`. **No** SIT-in/SIT-out pair, no storage duration/billing clock, no delivery-out leg, no permanent-storage boundary, no warehouse-as-a-stop-on-a-trip. |
| **A6** Documents & evidence | 3 | 2 | 2 | 0 | 1 | 3 | 2 | 3 | `ReferencedDocument` carries `TypeCode` (786-value DocumentNameCode), `StatusCode`, `ReferenceTypeCode` (817 values), `CategoryCode`, `IssuerTradeParty`, `IssueLogisticsLocation`, `LodgementLogisticsLocation`, `AuthenticatedOriginalIndicator`, `ElectronicPresentationIndicator`, `SignatoryDocumentAuthentication [0..*]`, `AttachedSpecifiedBinaryFile [0..*]` (CCL rows 696-712). Named document slots on Consignment: `TransportContractReferencedDocument`, `ManifestAssociatedReferencedDocument`, `CustomsRequiredInvoiceReferencedDocument`, `PreviousAdministrativeReferencedDocument`. C3=2 for the document version/amendment/cancellation chain. C7=2: issuer + signatories + authenticated-original flag is genuine evidentiary structure, but it attaches to documents only - **documents are not linked to the events they evidence**. |
| **A7** Charges & billing hooks | 2 | 2 | 0 | 0 | 1 | 2 | 1 | 3 | Freight invoicing in scope (BRS p.11). `LogisticsServiceCharge` with `PaymentArrangementCode` [UNCL 4237], `TariffClassCode` [UNCL 5243], `ChargeCategoryCode`, `ServiceCategoryCode`, `CalculationBasisCode` "such as by volume or per unit", `PayingPartyRoleCode`, `AppliedAmount`. Consignment carries `TotalChargeAmount`, `TotalCollectChargeAmount`, `TotalPrepaidChargeAmount`, `TotalDisbursementAmount`, `CODAmount`, `TotalAllowanceChargeAmount` (CCL rows 913-920). Notably `ApplicableLogisticsServiceCharge` **and** `EstimatedApplicableLogisticsServiceCharge` are separate associations on Consignment (RAB) - estimated vs applied charges, structurally. No invoice-issued / invoice-paid lifecycle (SCRDM's half). No line-haul vs accessorial split. |
| **A8** Parties & roles | 3 | 3 | 1 | 1 | n/a | 3 | 1 | 3 | Two mechanisms at once. (i) `TradeParty.RoleCode [0..*]` over a 605-value PartyRoleCode list. (ii) **~35 role-named party slots on Consignment alone**: Consignor, Consignee, Carrier, CarrierAgent, FreightForwarder, Importer, Exporter, Despatch, Delivery, ShipFrom, ShipTo, Notified[*], CustomsImport/Export/TransitAgent, ConnectingCarrier[*], DangerousGoodsNotifier, IntermediateConsignee[*], Consolidator, Deconsolidator, ConsignorAgent, ConsigneeAgent, GroupingCentre[*], LocalConsigneeAgent, PickUp, TransportServicesBuyer, Invoicee, Associated[*] (RAB `SupplyChainConsignmentType`). C2=3: BRS pp.12-14 defines each role in prose, including the *same party, two contracts* mapping (Seller <-> Original Consignor; Buyer <-> Final Consignee). C4=1: `ConsolidatorTradeParty` / `ConsignorAgentTradeParty` / `LocalConsigneeAgentTradeParty` rhyme with our agent chain but nothing names booking/origin/hauling/destination agent, van line, RMC, or crew. |
| **A9** Identity & cross-references | 3 | 3 | n/a | 1 | n/a | 3 | 2 | 3 | The `<Party>AssignedID` pattern across Consignment, Movement and Document (CCL rows 891-897, 591-595, 209-213); `ReferenceTypeCode` 817 values; UCR rules (BRS pp.15-16: shipment <-> one UCR, consignment <-> one-or-more UCRs); TUCR/HUCR/MUCR ladder (BSP BRS p.13). C4=1 because SCAC/PRO/BOL/registration-number are not named, though `ReferenceTypeCode` would hold them. C7=2: identity provenance is explicit (the asserter is in the attribute name), correction of an identifier is not. |

**S5 - fit to Pegasus data** (`yes` / `partial` / `no` / `unknown`):

| Area | pegII | Cloud | Note |
| --- | --- | --- | --- |
| A1 | partial | unknown | MMT's A1 content is so thin that "fit" is near-vacuous; the booking/order/invoice triad maps, the absent lifecycle does not constrain us. |
| A2 | partial | unknown | Shipment/Consignment/Consignment Item is a structure we would have to *choose* to adopt; pegII has order and shipment but no consignment layer, and no tariff-code aggregation to hang Consignment Item on. |
| A3 | partial | unknown | We can supply a trip and its legs; we cannot supply MMT's mode/stage codes meaningfully (everything is road) and MMT cannot take our stop sequence. |
| A4 | partial | unknown | We can supply actual event times; scheduled/requested/estimated as *four coexisting fields on one event* is not how either system stores them today - confirm against `src:pegii-order` / `src:pegii-longhaul`. |
| A5 | no | unknown | MMT has nothing to receive SIT into. |
| A6 | partial | unknown | Document type + issuer + attachment map; document-as-evidence-for-an-event has no MMT target. |
| A7 | partial | unknown | Charge amounts and payment arrangement map; accessorial catalogue does not. |
| A8 | partial | unknown | Our agent chain has to be squeezed into `RoleCode` + `AssociatedTradeParty [0..*]`; the named slots do not include our roles. |
| A9 | yes | unknown | Every Pegasus identifier has a home here, either as a `<Party>AssignedID` or as a typed `ReferenceTypeCode` reference. |

## Strengths worth adopting

1. **Four time flavours on one event object, plus windows.** `Scheduled` / `Requested` /
   `Estimated` / `Actual` occurrence times coexisting on a single `Transport Event`, with
   `OccurrenceSpecifiedPeriod` for windows and `DelayOccurrenceSpecifiedPeriod` for the delay
   itself. Our A4/A5 need exactly this: the delivery spread is a window, the requested delivery
   date and the scheduled delivery date are different facts, and the actual one arrives later.
   Adopt the **shape**; we will need one more flavour (see Weakness 5).
2. **Separate scheduled/actual for arrival *and* departure on the same event.** A stop is one
   event with four times, not two events. Worth testing against our arrive/depart pairs.
3. **An ETA for the vehicle distinct from an ETA for the event**
   (`EstimatedTransportMeansArrivalOccurrenceDateTime` vs `EstimatedOccurrenceDateTime`).
   "The truck will be there at 09:00; the unload will finish at 14:00" are different assertions
   and MMT has both.
4. **Delay as a referenced event with a reason code**, not a boolean: "here is the schedule we
   missed, here is why" (`ReferencedTransportEventType`: scheduled arrival + scheduled departure
   + `ReasonTypeCode` + period).
5. **Status and reason as two codes from the same vocabulary**, plus free-text reason, plus a
   validity period, plus the events that justify the status (`Logistics Status`). Better than a
   single status string with an optional note.
6. **`<Party>AssignedID` as the identity idiom.** Encoding the asserter in the attribute name
   (`ConsignorAssignedID`, `CarrierAssignedID`, `FreightForwarderAssignedID`,
   `TerminalOperatorAssignedID`) is more legible than a bag of typed references and answers
   "whose number is this?" without a lookup. Our A9 has exactly this problem across van line /
   booking agent / hauling agent / RMC numbers.
7. **The UCR ladder (TUCR / HUCR / MUCR)** as a named pattern for master-vs-house references in
   a consolidation. Directly analogous to a van-line shipment number over agent order numbers.
8. **Trip-to-shipment is explicitly many-to-many**, stated as a business rule rather than left
   to the schema (BSP BRS p.16). Worth stating as bluntly in our model.
9. **The "operational term" gloss.** The BRS names the party *and* the operational place term
   in the same definition - "Despatch Party ... Operational term is 'Pick-up Place'" (p.12).
   Cheap, and it kills a whole class of party-vs-place confusion.
10. **Legs by role, not only by sequence.** `PreCarriage` / `MainCarriage` / `OnCarriage`
    distinguishes the linehaul from the local leg at each end semantically. Our origin-agent /
    linehaul / destination-agent split is the same idea and we should name it, not derive it
    from stop order.

## Weaknesses / traps

1. **It is a freight-consignment model and it shows.** Zero household-goods vocabulary - we
   grepped the entire 1,474-row dictionary and the BRS for "household", "removal", "personal
   effect", "furniture", "moving": **no hits**. No survey, no binding/non-binding estimate, no
   reweigh, no valuation/released-rate, no SIT, no agent chain, no transferee. Adopting MMT's
   entity names wholesale would give us a model with the wrong centre of gravity.
2. **The goods spine is aggregated by customs tariff code.** `Consignment Item` exists because
   "each Consignment Item must have only one associated Customs tariff code in order to satisfy
   Customs requirements" (BRS p.16). For a domestic HHG move there is no tariff code, so the
   Consignment Item layer collapses to noise. Do **not** import a three-level goods hierarchy
   whose middle level has no domestic justification.
3. **A hidden contradiction in the source itself.** MMT says "A single Trade Item **cannot** be
   split across Shipments" (BRS p.15); the sibling SCRDM says "A single Trade Item **can** be
   split across Deliveries/Shipments" (BRS_SupplyChainReferenceDataModel-SCRDM p.16); the parent
   BSP says "A single trade item **is related to one shipment**" (BRS_BuyShipPay p.15). Three
   UN/CEFACT documents in one download, three different rules. Do not cite "UN/CEFACT says" on
   this point without saying which document.
4. **No stop sequence.** `Itinerary Stop Event [0..*]` is an unordered collection in XSD terms.
   If we take MMT's route/event structure we must add ordering ourselves - and must not assume
   XML document order carries it.
5. **No time zone on a location.** `Logistics Location` has coordinates and a postal address and
   no zone. For a US interstate move where "9 AM Tuesday" means a different instant at origin
   and destination, this is a defect, not a simplification.
6. **"Estimated" is doing two jobs.** MMT has `Estimated` and `Scheduled` but no separate notion
   of a *committed/promised* date distinct from an internally planned one. In HHG the
   binding-estimate world cares intensely about promised-vs-planned. Add the flavour; don't
   assume MMT's four are sufficient.
7. **Events carry no provenance and cannot be corrected.** There is no "who reported this",
   no "this supersedes event X", no reversal. If we copy MMT's event shape we inherit a model
   where a driver's mistaken "delivered" scan has no representable retraction.
8. **Two unreconciled status vocabularies** (Rec 24 TransportStatusCode on goods, StatusCode on
   movement/route). Picking one at random produces a model that cannot say "the shipment is X
   while the trip is Y".
9. **The named-slot idiom does not scale to our roles.** MMT gets its precision from ~35
   hard-coded party slots and ~20 hard-coded event slots. That works because UN/CEFACT owns the
   list. If we copy it, every new agent role or event kind is a schema change. Prefer a typed
   role/kind with a governed vocabulary - MMT itself offers that as the *other* mechanism
   (`RoleCode`), so we can take MMT's names as a starting vocabulary without its structure.
10. **Crew/driver is the wrong shape.** `TransportPerson` is built for FAL forms (birth date,
    nationality country, onboard personal effects, crew list document). It is not a driver
    assignment, a crew roster, or a settlement subject.
11. **It is a data model, not a process model.** There is no answer in this package to "who may
    cause this transition", because there are no transitions. Do not expect MMT to settle any
    A1 question.

## Out-of-v1 material

- **A10 (survey/estimating/inventory):** nothing on survey or estimate types. The only
  inventory-shaped entity is `StoresItemInventory` (ship's stores), plus `Logistics Package`
  with `Sequence Number`, `Physical Logistics Shipping Marks` and `Logistics Label` ("a label
  used for identifying goods for logistics purposes, such as a barcode, a radio frequency tag
  or a **Vehicle Identification Number (VIN)**" - MMT CCL Subset row 403). `Spatial Dimension`
  gives per-package length/width/height. `SpecifiedPersonalEffectsType` exists in the D19A XSD
  (`SequenceNumeric`, `Description`, `TypeCode`, `OnboardQuantity`) but it is the **crew's**
  personal effects on a FAL-4 declaration, not a household inventory - and it is absent from the
  MMT CCL Subset entirely. Easy to misread; flagged so nobody else does.
- **A11 (claims & valuation):** absent. `Transport Cargo Insurance`,
  `Consignment.InsuranceValueAmount` / `InsurancePremiumAmount` / `NilInsuranceValueIndicator`,
  `DeclaredValueForCarriageAmount`, `DeclaredValueForCustomsAmount` (CCL rows 910-911, 919, and
  `SupplyChainConsignmentType`) are the coverage/declared-value hooks - no claim, no liability
  regime, no released-vs-full-value distinction, no loss/damage event. `IdentifiedFault` ("An
  identified defect or fault", row 341) and `SealConditionCode` (seal intact/broken) are the
  nearest damage-adjacent constructs.
- **A12 (rating & tariffs):** `FreightChargeTariffCode` (tariff class, "an entry in a table of
  fixed charges", UNCL 5243), `FreightChargeQuantityUnitBasisCode`, `FreightCostCode` identifier
  list, `LogisticsServiceCharge.CalculationBasisCode` "such as by volume or per unit",
  `TransportPaymentArrangementCode` (UNCL 4237), `TradeAllowanceCharge`. Enough to *reference* a
  tariff, nothing to *express* one. No 400N/400NG analogue.
- **A13 (crew, driver & settlement):** `TransportPerson` (crew/passenger, with
  `CertifiedAccreditation` - a competency credential, row 1438), `LogisticsConvoy` ("a number of
  means of transport following each other with a common logistics purpose", row 397),
  `MasterResponsibleTransportPerson`, `CrewQuantity`. No compensation, no revenue split, no
  scheduling.
- **Environmental:** `CalculatedEmission` (row 24) on `LogisticsTransportMovement` - outside our
  rubric entirely but present, and increasingly asked for in RFPs.

## Open questions

1. **Do we adopt a Consignment layer between Order and Shipment at all?** MMT's Shipment /
   Consignment split exists because one commercial shipment can travel under several transport
   contracts. In HHG that is real (interline, agent-hauled segments, SIT with a different hauler
   out) but it is not how pegII is shaped. Decide against `src:pegii-order`, `src:sirva-ade` and
   the van-line sources, not from MMT.
2. **How many time flavours does HHG actually need?** MMT offers four. We probably need
   requested / promised-or-committed / planned / estimated / actual - five - plus spread windows
   on pack and delivery. Settle in the A4 comparison against `src:pegii-longhaul`,
   `src:project44`, `src:samsara`.
3. **Which status vocabulary anchors A4?** MMT offers two incompatible ones (Rec 24 vs
   StatusCode) and we cannot read either list's meanings from this package. If Rec 24 matters,
   someone must obtain the actual UNECE Recommendation 24 code table - it is not in this
   download, and the registry entry should record that as a gap.
4. **Do we want events with mutable time fields, or an append-only event stream?** MMT's model
   is a *revisable record* (one event, four times, updated in place). A domain event catalog for
   Cloud is naturally append-only. These two shapes disagree about what "the ETA changed" is,
   and the disagreement should be settled explicitly in `model/`, not by accident.
5. **Stop sequence, leg identity and trip identity** - MMT gives a trip number and named leg
   roles but no ordered stop list. Which source *does* give an ordered stop list with planned vs
   actual per stop? (`src:x12-858-implementation-guide` S5 stop-off segments and
   `src:open-trip-model` are the obvious candidates; resolve in the A3 comparison.)
6. **Does anybody in our ecosystem speak UN/CEFACT?** The tenants are Allied and Atlas agents on
   Omnitracs and Samsara, with no EDI and no visibility platform today. If MMT is only ever a
   *vocabulary donor* and never a wire format, mine it for distinctions and do not spend effort
   on conformance. Confirm before anyone proposes an MMT-shaped API.
