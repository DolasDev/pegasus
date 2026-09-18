---
source: src:uncefact-scrdm
analyzed: 2026-09-17
evidence_grade: A
material: |
  Shares the local tree with src:uncefact-mmt-rdm. All paths relative to
  sources/uncefact-mmt-rdm/local/uncefact-reference-data-models/
  READ IN FULL:
    - BRS_SupplyChainReferenceDataModel-SCRDM_v1.0.0.2.pdf (19 pp., 15 Dec 2016)
    - RSM_SCRDM_v1.0.0.2.pdf (17 pp., 15 Dec 2016) - the Requirement Specification Mapping
    - BRS_BuyShipPay_v1.0.pdf (16 pp., Jul 2019) - the parent BSP-RDM consolidating SCRDM + MMT
    - WhitePaper-ReferenceDataModel_Eng.pdf (13 pp.) - what an RDM is and how it is governed
    - Guideline-ReferenceDataModel-v1.0.0.2.pdf (27 pp.) - how an RDM is built and updated
    - SCRDM_D22A/Context CCL/SCRDM Context CCL_D22A.xlsx, sheet "Reference BIE", 1967 rows
      (141 ABIEs with their BBIEs/ASBIEs, definitions, cardinalities). Read via openpyxl;
      cited below as "SCRDM Context CCL row N".
    - SCRDM_D22A/XSD/schema/uncefact/SCRDMCCBDAMasterMessageStructure_131pD22A.xsd (the master
      structure) and the D21B code-list / qualified-data-type schemas (78 files, enumerated)
  NOT READ:
    - SCRDM_D22A/UML/UML-Diagram/ (5,996 tiled GIFs + a stitching HTML; see below)
    - SCRDM Context CCL_D21B.xlsx (the prior release; D22A read instead)
    - The six Cross Industry BRSs (Quotation, Ordering, Delivery, Scheduling, Invoicing,
      Remittance Advice) that SCRDM was distilled from - referenced at
      BRS_SupplyChainReferenceDataModel-SCRDM p.7, not included in this download.
---

# UN/CEFACT Supply Chain Reference Data Model (SCRDM D22A) + Buy-Ship-Pay BRS - analysis

## What it is

The **commercial / ordering / settlement half** of UN/CEFACT's reference-model pair. Where
MMT (`src:uncefact-mmt-rdm`) models the transport service contract, SCRDM models the **sales
order contract**: catalogue -> quotation -> order -> delivery/scheduling -> invoice ->
remittance advice. Both are contextualised subsets of the UN Core Component Library, and both
are subsets of the parent **Buy-Ship-Pay RDM** (BRS_BuyShipPay_v1.0.pdf p.4: the BSP project
"aims to create an intermediate subset of the UN CCL focusing on the shared aspects across the
international supply chain and transport-logistics chains", because "if the current two RDMs
are developed separately, any changes in one will require changes to the other").

SCRDM was reverse-engineered from six existing document specs: "The SCRDM has been created
from the artefacts, semantics used in RSMs belonging to the above specified BRSs. The document
centric artefacts were the basis for the development of the non document, process driven SCRDM
artefacts" (BRS p.7). That origin shows: it is strong on document-shaped facts and weak on
process.

- **S1 Kind:** `reference-model`
- **S2 Adoption / maturity:** **2**. Published UN/CEFACT output approved by the Bureau
  (RSM p.3 sec 1.1) and carried forward through real library versions (D16B -> D21B -> D22A in
  this download). Its descendants are widely implemented in spirit - the Cross Industry
  Invoice is the direct ancestor of the European EN 16931 / Factur-X / ZUGFeRD e-invoicing
  stack - but SCRDM *as SCRDM* is not implemented by anyone in our ecosystem, and at
  publication "only the CI Invoicing CCBDA RSM has been published" (BRS p.4 fn.3, RSM p.4 fn.2).
- **S3 Openness:** `public`.
- **S4 Evidence grade:** **A** - we read the BRS, the RSM, the parent BSP BRS, the governing
  white paper and guideline, and the full 1,967-row D22A Context CCL with definitions.

### What we could not read

1. **SCRDM UML diagrams.** `SCRDM_D22A/UML/UML-Diagram/` is the "SCRDM D19A Context BUY Master"
   class diagram exported as **5,996 tiled 500x500 GIFs** stitched by an 873 KB HTML table. Not
   readable. The RSM's own inline figures (Figure 3 "Class Diagram SCRDM Master", Figure 4
   "Class Diagram Supply Chain Transaction", Figure 5 "Class Diagram Trade Settlement_Payment",
   RSM pp.13-14) are raster images in the PDF and did not survive text extraction either - we
   see the captions and the surrounding prose, not the diagrams. The same structure is in the
   Context CCL and the master XSD, which we did read.
2. **Code-list meanings.** Same problem as MMT: the D21B code-list XSDs are bare
   `xsd:enumeration` value lists with no names or definitions. Sizes and bindings below; no
   claims about what any individual code means.
3. **The six source Cross Industry BRSs** are not in this download (BRS p.7 lists them). Their
   activity diagrams are where SCRDM's process content would live, which is part of why C3
   scores low here.

## Model summary

**The master structure** (`SCRDMCCBDAMasterMessageStructure_131pD22A.xsd`) is six slots:

```
SCRDM CCBDA Master Message Structure
  +- ExchangedDocumentContext          [0..1]
  +- ExchangedDocument                 [0..1]   the envelope: who, when, version, purpose
  +- SpecifiedSupplyChainConsignment   [0..*]   the transport view (shared with MMT)
  +- TradeSettlementPayment            [0..1]   remittance advice only
  +- SupplyChainTradeTransaction       [0..*]   THE core
  +- ValuationBreakdownStatement       [0..1]   priced bill of quantities (invoicing only)
```

**`Supply Chain Trade Transaction`** is "the most important ABIE in the SCRDM Master ... It
covers elements of data on agreements, deliveries and payment" (RSM p.13). Its shape is the
**agreement / delivery / settlement triad, at two levels**:

```
Supply Chain Trade Transaction
  +- ID, Type Code, Shipment_Identification (the UCR), Issue Date Time, Line Item Quantity
  +- Applicable Header_ Trade Agreement    <- quotation, order, order response, contract, terms
  +- Applicable Header_ Trade Delivery     <- the movement facts: qty, events, documents
  +- Applicable Header_ Trade Settlement   <- invoice, tax, payment terms, monetary summations
  +- Included Supply Chain_ Trade Line Item [0..*]
        +- Line_ Trade Agreement / Line_ Trade Delivery / Line_ Trade Settlement
              +- Subordinate Line_ Trade Agreement / Delivery / Settlement
```

That three-way split repeated at header and line level is SCRDM's signature idea, and it is
the cleanest thing in the package: **what we agreed / what moved / what we settle** are three
separate objects over the same line item, each with its own identifiers, dates, parties and
documents.

**Terminology note that matters.** SCRDM calls the shipment a **Delivery**: "Delivery ... A
delivery is an identifiable collection of one or more Trade Items (available to be) transported
together from the Seller (Original Consignor/Shipper), to the Buyer (Final/Ultimate Consignee)"
with footnote 10: "**In other domains than Supply Chain, the term 'Shipment' is used.**"
(BRS p.16). MMT calls the same thing a Shipment. BSP writes it "Shipment/Delivery" and glosses
"The term 'Deliver' is more often used in supply chain, while 'Ship' is used more often in
transport and logistics processes" (BSP BRS p.8 fn.3).

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Delivery** (= Shipment elsewhere) | "Shipping arrangements between buyer and seller about movement of products and or services including despatch and delivery. A delivery is an identifiable collection of one or more Trade Items (available to be) transported together from the Seller ... to the Buyer". Can be destined for only one Buyer; can draw from one or more Sales Orders; "may form part or all of a Consignment or may be transported in different Consignments". | A2 | BRS p.16 + fn.10 |
| **Consignment (Transport Service Order)** | "a separately identifiable collection of Consignment Items (available to be) transported from one Consignor to one Consignee via one or more modes of transport as specified in one single transport service contractual document." | A2 | BRS p.16 |
| **Trade Item** | "the lowest level of 'commercial' information in a Sales Order between the Buyer and the Seller". SCRDM rule: "A single Trade Item **can** be split across Deliveries/Shipments." (Contradicts MMT - see Traps.) | A2 | BRS pp.15-16 |
| **Header_ Trade Agreement** | "The contractual terms of a header trade agreement." | A1 | SCRDM Context CCL, `Header_ Trade Agreement. Details` |
| **Header_ Trade Delivery** | "Shipping arrangements and movement of products and or services including despatch and delivery at a header level." | A2, A4 | SCRDM Context CCL |
| **Header_ Trade Settlement** | "The information, at a header level, that enables the reconciliation of a financial transaction, with the item(s) that the financial transaction is intended to settle, such as a commercial invoice." | A7 | SCRDM Context CCL |
| **Supply Chain Event** | "A significant occurrence or happening in a supply chain." Attributes: `Identification`, `Occurrence Date Time`, `Type Code`, `Description`, `Description Binary Object` ("such as a photograph"), `Unit Quantity`, `Earliest_ Occurrence Date Time`, `Latest_ Occurrence Date Time`, `Time_ Occurrence Date Time`, `Occurrence Specified_ Period`, `Occurrence Logistics_ Location`, `Associated Supply Chain_ Reference`. | A4 | SCRDM Context CCL, `Supply Chain_ Event.*` |
| **Trade Workflow Object** | "An object used in the management of the status changes in a business process." Three attributes only: `Identification. Identifier`, `Status. Code`, **`Previous_ Status. Code`**. | A1 | SCRDM Context CCL, `Trade_ Workflow Object.*` |
| **Recorded Status** | "Recorded information relevant to a condition or a position of an object." `Condition. Code` [1..1], **`Changer Name. Text`** ("The name of the person or system, expressed as text, that changed this recorded status") [0..1], **`Changed. Date Time`** [1..1]. | A1, A4 | SCRDM Context CCL rows 1031-1034 |
| **Logistics Status** | "The information relevant to a condition or a position related to logistics." In SCRDM reduced to `Condition. Code` "[UNECE Recommendation 24]", `Description. Text`, and `Reported. Supply Chain_ Event`. (MMT's richer version adds a Reason Code, validity period and four event slots.) | A4 | SCRDM Context CCL, `Logistics_ Status.*` |
| **Supply Chain Reference** | "The identification of related information in a supply chain context." `Type. Code`, `Identification. Identifier`, `Abbreviation. Text`, `Description. Text`, `Status. Text`, `Comment. Text`, `Value. Code`, `Value. Text`, `Property Reference. Code`. | A9 | SCRDM Context CCL, `Supply Chain_ Reference.*` |
| **Delivery Adjustment** | "A correction or modification to reflect actual delivery conditions." `Reason. Code`, `Reason. Text`, `Actual. Amount`, `Actual. Quantity`, `Actual. Date Time`. | A4, A7 | SCRDM Context CCL, `Delivery_ Adjustment.*` |
| **Financial Adjustment** | "A correction or modification to reflect actual financial conditions." Same five-attribute shape. | A7 | SCRDM Context CCL, `Financial_ Adjustment.*` |
| **Valuation Breakdown Statement** | "A detailed statement of work, prices, and dimensions for this valuation." Contains `Grouped_ Work Item` / `Basic_ Work Item` / `Work Item_ Dimension` / `Work Item_ Quantity Analysis`. **This is a construction bill of quantities, not cargo valuation.** | A7, A12 | SCRDM Context CCL, `Valuation_ Breakdown Statement.*` |
| **Despatch Party / Delivery Party** | Same definitions as MMT, with the same operational glosses: Despatch Party's "operational term is 'Pick-up Place'"; Delivery Party's is "'Place of Positioning'". | A8 | BRS p.13 (Table 1); RSM p.11 (Table 2) |
| **Transport Service Buyer** | "The party stipulated as the buyer of transport services in a Transport Service Contract. The Transport Service Buyer role may be performed by either the Consignor or the Consignee depending on the Terms of Delivery specified in the associated Sales Order Contract." | A8 | BRS p.14 |
| **TUCR / HUCR / MUCR** | Trade-Transaction / House-Consignment / Master-consignment level Unique Consignment References, introduced "in order to support the many-to-many Master Transport Contract and House Transport Contract consignment relationships". | A9 | BSP BRS p.13 |

## Lifecycles & events

SCRDM has **more lifecycle machinery than MMT, but still no state machine**. Four mechanisms:

**(1) The planned/requested/confirmed/actual event matrix on Trade Delivery.** This is SCRDM's
best idea and the most directly reusable thing in either package. `Header_ Trade Delivery`
carries `Supply Chain_ Event` under *qualified association names* forming a
**{qualifier} x {event kind}** matrix (all from SCRDM Context CCL, `Header_ Trade Delivery.*`;
`Line_ Trade Delivery` mirrors it):

| | Despatch | Pick-Up | Release | Delivery | Receipt | Loading | Unloading |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Requested_** | | | | yes | | | |
| **Planned_** | yes | | yes | yes | | | |
| **Confirmed_** | yes | yes | yes | | | | |
| **Actual_** | yes | yes | | yes | yes | yes | yes |
| **Previous_** | | | | yes | | | |

plus `Ultimate Ship To_ Delivery. Supply Chain_ Event` and `Planned Ship From_ Delivery. Supply
Chain_ Event`. Four things to note: **Confirmed** is a distinct qualifier from both Planned and
Actual (the promise, as opposed to the plan or the outcome); **Previous_ Delivery** preserves
the superseded event rather than overwriting it; the qualifiers sit on the *association*, not
inside the event, so the event object itself stays simple; and **Release** is a first-class
event kind distinct from Despatch (the authorisation to move, separate from the movement).

**(2) `Trade Workflow Object`** - `Identification` + `Status Code` + `Previous_ Status Code`.
Three attributes, no transition table, no guard, no actor. It records *that* a status changed
and what it changed from. It is the whole of SCRDM's explicit lifecycle apparatus.

**(3) `Recorded Status`** - `Condition Code` (mandatory) + `Changer Name` ("the person **or
system**") + `Changed Date Time` (mandatory). Attached in the CCL only to `Basic_ Work Item`
and `Grouped_ Work Item` ("A changed recorded status for this ... work item", SCRDM Context CCL
rows 64, 335), i.e. it is used for construction work items, not for orders. But the **shape** -
condition + who changed it + when, with both mandatory - is the provenance pattern our A4/A6
C7 criterion is asking for, and it is here, in a UN/CEFACT model, with "or system" written into
the definition.

**(4) Document-level correction, which is genuinely thorough.** `Exchanged_ Document` carries a
full revision chain: `Version_ Identification`, `Revision_ Identification`, **`Previous
Revision_ Identification`**, `First Version Issue. Date Time`, `Revision. Date Time`,
`Amendment_ Purpose. Code`, `Purpose. Code` and `Purpose. Text`, `Status. Code`,
`Cancellation. Date Time`, `Acceptance. Date Time`, `Rejection_ Response. Date Time`,
`Response. Date Time`, **`Response Reason. Code`**, `Requested_ Response Type. Code`,
`Creation. Date Time`, `Submission. Date Time`, `Urgency. Code`. Accept / reject-with-reason /
amend / cancel / supersede-a-named-prior-revision are all expressible. `Referenced_ Document`
independently carries `Revision_ Identification`, `Global_ Identification`, `Issuer Assigned_
Identification`, `URI_ Identification`, `Receipt. Date Time`, `Copy. Indicator`.

**(5) Adjustment as a first-class entity.** `Delivery_ Adjustment` and `Financial_ Adjustment`
are both "a correction or modification to reflect actual ... conditions" with a `Reason. Code`
and the `Actual` amount/quantity/date-time. A correction is a *record*, not an overwrite.

**Business-process framing** comes from the parent BSP BRS (pp.6-7), which names four main and
three supportive use cases with one-line definitions: **Establish business agreement** ("A
buyer issues a request for quotation to sellers ... The buyer negotiates with the selected
sellers to agree the terms for a contract agreement"), **Order** ("The buyer recognizes a need
... and places an order under a contract agreement. The seller receives order and responds"),
**Ship**, **Pay**; supportive: **Identify potential trading partner**, **Check credit** (out of
scope), **Manufacture**. Prose only - no states, no transitions, no permissions.

**Code-list inventory** (D21B set in `SCRDM_D22A/XSD/schema/uncefact/`; **values only, no
names**):

| List | Codes |
| --- | --- |
| `StatusCode_D21B` | 496 |
| `TransportStatusCode_4` (UNECE Rec 24) | 336 |
| `PartyRoleCode_D21B` | 624 |
| `PartyRoleCode_ChargePaying_D21B` | (present) |
| `ReferenceTypeCode_D21B` | 817 |
| `DocumentNameCode_D21B` | 803 |
| `DocumentNameCode_Accounting_D21B` | (present) |
| `DocumentStatusCode_D21B` | 44 |
| `MessageFunctionCode_D21B` | 69 |
| `MessageFunctionCode_Acknowledgement_D21B` | (present) |
| `AdjustmentReasonDescriptionCode_D21B` | 105 |
| `AutomaticDataCaptureMethodCode_D21B` | 10 |
| `EventTimeReferenceCode_D21B` | 65 |
| `EventTimeReferenceCodePaymentTermsEvent_D21B` | 5 |
| `LocationFunctionCode_D21B` | 305 |
| `TransportMovementStageCode_D21B`, `TransportModeCode_2`, `TransportMeansTypeCode_2007`, `TransportServiceRequirementCode/ConditionCode/PriorityCode`, `DeliveryTermsCode_2020`, `PackagingMarkingCode`, `DateOnlyFormatCode`, `TimeOnlyFormatCode`, `TimePointFormatCode` | (present) |

Two observations. First, SCRDM **does** restrict `EventTimeReferenceCode` into a purpose-built
qualified subset - `EventTimeReferenceCodePaymentTermsEvent_D21B`, 5 codes out of 65 - which is
the white paper's subsetting mechanism in action ("Subsets of code lists are published as
qualified code lists (e.g. non-restricted as 'adjustment reason code' and - for use in
finance-related data exchanges - restricted as 'financial adjustment reason code'",
WhitePaper p.11 sec 3.6). Second, `AutomaticDataCaptureMethodCode` (10 codes) is the only
capture-provenance vocabulary in either package - how a fact was captured (scan vs key vs
sensor) - and it is in SCRDM, not MMT.

## Time, identity, evidence

### Time

SCRDM puts the time semantics **on the association**, not on the event:
`Planned_ Delivery. Supply Chain_ Event` vs `Actual_ Delivery. Supply Chain_ Event` are two
distinct associations to two instances of the same simple `Supply Chain_ Event` class, each
with one `Occurrence Date Time`. This is the exact inverse of MMT's choice (one event object
with four differently-named date-time attributes) and the pair is worth holding side by side
when we design A4:

| | MMT | SCRDM |
| --- | --- | --- |
| Where the qualifier lives | attribute name inside the event | association name outside the event |
| One event, four times? | yes | no - one event per flavour |
| Superseded values | overwritten | kept, as `Previous_ Delivery. Supply Chain_ Event` |
| Qualifiers offered | Scheduled, Requested, Estimated, Actual | Requested, Planned, **Confirmed**, Actual, Previous |
| Windows | `Occurrence Specified_ Period`, plus delay/stay/laycan periods | `Occurrence Specified_ Period` + `Earliest_`/`Latest_ Occurrence Date Time` |
| Time zone on the location | absent | absent |

`Supply Chain_ Event` also has `Time_ Occurrence. Date Time` (a time-of-day separate from the
date) and the `Earliest_`/`Latest_ Occurrence Date Time` pair, which is a delivery-window
expressed as two instants rather than as a period object. `Header_ Trade Delivery` carries
independent flat dates too: `Formatted_ Pick-Up Availability. Date Time`, `Ultimate Ship To
Delivery. Date Time`, `Goods Ownership Change. Date Time` (title transfer, separate from
physical delivery - a distinction MMT does not draw).

### Identity and cross-references

- **`Supply Chain_ Reference`** is a properly typed, self-describing reference:
  `Type. Code` + `Identification. Identifier` + `Value. Code` / `Value. Text` +
  `Abbreviation` + `Description` + `Status. Text` + `Comment` + `Property Reference. Code`.
  It attaches to `Supply Chain_ Event` ("A reference associated with this supply chain event")
  among others. A single generic mechanism, in contrast to MMT's per-party named ID attributes.
- **UCR at transaction level**: `Supply Chain_ Trade Transaction. Shipment_ Identification.
  Identifier` - "An identifier, **such as the Unique Consignment Reference (UCR)**, for the
  shipment which is the subject of this supply chain trade transaction."
- **Party-scoped references** on the agreement: `Buyer_ Reference. Text`, `Seller_ Reference.
  Text`, plus `Revision_ Identification` on the agreement itself; on settlement:
  `Creditor Reference. Identifier` + `Creditor Reference Type. Code` + `Creditor Reference
  Issuer. Identifier` (a reference, its type, *and who issued it* - three fields), `Payment
  Reference. Text`, `Invoice Issuer_ Reference. Text`, `Payer_ Reference. Text`.
- **`Referenced_ Document`** carries `Issuer Assigned_ Identification`, `Global_
  Identification`, `URI_ Identification`, `Revision_ Identification`, `Line. Identifier`.
- **The RSM's role-to-slot mapping table** (RSM pp.9-11, Tables 1 and 2) is itself an identity
  artefact: for each business role it lists *every structural slot the role can occupy* - e.g.
  Seller maps to `Header_ Trade Agreement. Seller. Trade_ Party` **and** `Line_ Trade Agreement.
  Seller. Trade_ Party` **and** `Supply Chain_ Consignment. Consignor. Trade_ Party` **and**
  `Header_ Trade Delivery. Ship From. Trade_ Party` **and** `Line_ Trade Delivery. Ship From.
  Trade_ Party`. That is a worked answer to "the same real party wears five hats" and it is
  written down rather than left implicit.

### Evidence and provenance - better than MMT, still thin

- `Recorded_ Status`: `Changer Name` ("person **or system**") + `Changed Date Time`, both with
  `Condition Code` mandatory. Nearest thing to an actor-of-assertion in either package.
- `AutomaticDataCaptureMethodCode` (10 codes): how a value was captured.
- `Supply Chain_ Event. Description. Binary Object` - "such as a photograph".
- `Document_ Authentication` + signatory slots on `Exchanged_ Document`.
- `Delivery_ Adjustment` / `Financial_ Adjustment` with reason codes, and
  `AdjustmentReasonDescriptionCode_D21B` (105 codes) behind them.
- **Missing:** no event-level asserter, no supersedes/retracts link between two events (only
  the single `Previous_ Delivery` slot), no confidence or source-system field on a fact.

## Scores

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 2 | 3 | 2 | 0 | 2 | 3 | 3 | 3 | Quotation-request -> quotation -> order -> order-response -> contract are all present as named `Referenced_ Document` slots on `Header_ Trade Agreement`, with `Buyer_ Approved. Date Time` and `Revision_ Identification`. Accept/reject/amend/cancel on `Exchanged_ Document` with `Response Reason. Code`. `Trade_ Workflow Object` (status + previous status) and `Recorded_ Status` (condition + changer + changed-when). BSP BRS pp.6-7 defines the four use cases in prose. **C3=2 not 3**: no transition table, no invariants, no statement of who may cause a transition. C2=3: the BRS/RSM define every term including the Sales-Order-Contract vs Transport-Service-Contract role split (BRS pp.13-14). C4=0. |
| **A2** Shipment structure | 3 | 3 | 2 | 0 | 2 | 3 | 2 | 3 | Delivery / Consignment / Consignment Item / Trade Item with numbered business rules (BRS pp.15-17), the Delivery-is-Shipment gloss (fn.10), and the header/line/subordinate-line decomposition. Quantity vocabulary is unusually rich: `Requested`, `Agreed`, `Despatched`, `Remaining_ Requested`, `Due In_ Available / Forecasted / Requested`, `Modification_ Forecasted`, plus `Partial Delivery Allowed`, `Over Delivery Allowed`, `Fully Delivered`, `Final Delivery` indicators and `Quantity Calculation Method. Code`. C4=0: no HHG shipment typing, weights are not modelled at delivery level at all (they live on Consignment, i.e. on the MMT side). |
| **A3** Trip, stop & assignment | 1 | 2 | 0 | 0 | 1 | 2 | 1 | 3 | SCRDM reuses `Logistics_ Transport Movement`, `Logistics_ Transport Means` and `Logistics_ Transport Equipment` from the shared CCL (all three ABIEs are in the D22A Context CCL) but adds nothing: no route, no itinerary, **no `Transport_ Route` ABIE in the SCRDM subset** (MMT has one), no stop sequence, no assignment. Score this area from MMT or elsewhere; SCRDM contributes the Consignment link (`Header_ Trade Delivery. Related. Supply Chain_ Consignment` and `. Planned. Supply Chain_ Consignment`) and nothing more. |
| **A4** Execution events & tracking | 2 | 2 | 1 | 0 | 3 | 2 | 2 | 3 | The qualifier x event-kind matrix above is the whole of it: despatch, pick-up, release, delivery, receipt, loading, unloading - **no arrive/depart, no in-transit, no exception event, no ETA**. C1=2 for that reason. C5=3: five qualifiers including `Confirmed_` and `Previous_`, plus earliest/latest, plus period. C7=2: `Recorded_ Status` changer/changed-when, `AutomaticDataCaptureMethodCode`, photo binary object, `Delivery_ Adjustment` reason codes. C3=1: `Trade_ Workflow Object` previous-status is the only transition trace. |
| **A5** Storage-in-transit | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 2 | Nothing on SIT. The only storage-adjacent content is `Supply Chain_ Inventory` ("Supply chain goods and materials held in stock", with stock quantity, min/max stock level, planned stock, average demand, `Specified. Logistics_ Location`) - a *stock-level* model, not a custody-during-a-move model. There is no storage-in / storage-out pair, no duration clock, no delivery-out leg. |
| **A6** Documents & evidence | 3 | 2 | 3 | 0 | 2 | 3 | 3 | 3 | Named document slots throughout: Quotation, Quotation Request, Order Response, Buyer/Seller/Marketplace Order, Contract, Requisition, Price List, Catalogue, Purchase/Sales Conditions, Demand Forecast, Promotional Deal (on Agreement); Despatch Advice, Receiving Advice, Delivery Note, Packing List, Shipment Schedule, Consumption Report (on Delivery). C3=3: the `Exchanged_ Document` revision chain with `Previous Revision_ Identification` + `First Version Issue. Date Time` + `Amendment_ Purpose. Code` + `Cancellation. Date Time` + `Rejection_ Response. Date Time` + `Response Reason. Code` is a genuine document lifecycle with explicit supersession. C7=3: issuer, authentication/signatory, copy indicator, receipt date-time, plus the adjustment entities. C2=2: definitions are the CCL's flat one-liners. |
| **A7** Charges & billing hooks | 3 | 3 | 2 | 0 | 2 | 3 | 3 | 3 | Header/Line/Subordinate-Line `Trade Settlement`; `Trade Settlement Header_ / Line_ / Payment_ Monetary Summation`; `Trade_ Allowance Charge` + `Applied_ Allowance Charge`; `Trade_ Tax` + `Applied_ Tax` + `Registered_ Tax` + `Tax_ Registration`; `Trade_ Payment Terms` / `Discount Terms` / `Penalty Terms`; `Trade Settlement_ Payment` / `_ Payment Means` / `_ Financial Card`; `Advance_ Payment`; `Header_ / Payment_ Balance Out`; `Creditor`/`Debtor Financial Account` and `Financial Institution`; `Financial_ Adjustment` with reason code; five currency codes on one settlement (tax / order / invoice / price / payment / quotation). Invoice lifecycle hooks: `Invoice. Date Time`, `Next_ Invoice. Date Time`, `Scheduled_ Payment. Date Time`, `Closing Book_ Due. Date Time`, `Credit Reason. Code`, `Due Payable. Amount`. This is by a distance the best-covered area in the package. C4=0: nothing moving-specific (no accessorial catalogue, no line-haul split, no SIT billing). |
| **A8** Parties & roles | 3 | 3 | n/a | 1 | n/a | 3 | 1 | 3 | Same party table as MMT (BRS pp.13-14) **plus** the RSM's role-to-structural-slot mapping (RSM pp.9-11 Tables 1-2), which MMT does not have. Commercial roles MMT lacks: Sales Agent, Buyer Requisitioner, Buyer/Seller Assigned Accountant, Buyer/Seller Tax Representative, Product End User, Buyer Agent, Procurement, Catalogue Information Provider/Receiver, Inventory Manager, Disposal party, Invoicer/Invoicee, Payer/Payee, Creditor/Debtor. `Trade_ Party` with `Role. Code` over 624 values. C4=1: "Sales Agent" and "Buyer Agent" rhyme with booking agent / RMC but nothing is named for our chain. C7=1: no provenance on party assertions. |
| **A9** Identity & cross-references | 3 | 3 | n/a | 1 | n/a | 3 | 2 | 3 | `Supply Chain_ Reference` (typed, self-describing, attachable to events); UCR at transaction level; the three-field creditor-reference pattern (reference + type + **issuer**); `Buyer_ Reference` / `Seller_ Reference`; document `Issuer Assigned_ Identification` / `Global_ Identification` / `URI_ Identification` / `Revision_ Identification`; `ReferenceTypeCode` 817 values; the RSM role-to-slot table as an explicit correlation artefact; TUCR/HUCR/MUCR (BSP BRS p.13). |

**S5 - fit to Pegasus data:**

| Area | pegII | Cloud | Note |
| --- | --- | --- | --- |
| A1 | partial | unknown | Quote/order/order-response documents map to our estimate/order-for-service paper; `Trade_ Workflow Object`'s status+previous-status is trivially suppliable from any CRUD system, which is precisely why it is weak evidence. |
| A2 | partial | unknown | Header/line/subordinate-line and the requested/agreed/despatched quantity family map onto services-ordered; the Delivery-vs-Consignment split does not exist in pegII. |
| A3 | no | unknown | SCRDM has nothing here. |
| A4 | partial | unknown | Our systems can supply planned and actual dates; **`Confirmed_`** (the promise) is the interesting question - does pegII distinguish a promised delivery date from a planned one? Needs checking against `src:pegii-order`. |
| A5 | no | unknown | No SIT target. |
| A6 | partial | unknown | Document type + issuer + revision map; we almost certainly do not keep `Previous Revision_ Identification` today. |
| A7 | partial | unknown | Rich enough to receive everything pegII has and more; the gap is ours, not SCRDM's. |
| A8 | partial | unknown | Commercial roles map better than MMT's transport roles do; agent chain still unrepresented. |
| A9 | yes | unknown | `Supply Chain_ Reference` will hold any identifier we have, typed. |

## Strengths worth adopting

1. **The qualifier x event-kind matrix.** `{Requested, Planned, Confirmed, Actual, Previous} x
   {Despatch, Pick-Up, Release, Delivery, Receipt, Loading, Unloading}`. Adopt the *qualifier
   set* verbatim as candidate vocabulary for A4/A5 - especially **`Confirmed_`**, which is the
   promise-to-the-customer as distinct from both the internal plan and the outcome. HHG lives on
   that distinction (the delivery spread we committed to vs the day we are actually planning vs
   the day it happened) and neither MMT nor a telematics feed offers it.
2. **`Previous_ Delivery. Supply Chain_ Event`** - keep the superseded fact as a first-class
   association rather than overwriting it. Cheap, and it is half of a correction story.
3. **Release as an event kind distinct from Despatch.** The authorisation to move is not the
   movement. In HHG this is the SIT release, the destination-agent release, the
   release-for-delivery after payment. Worth a first-class name.
4. **`Recorded Status` = condition + changer + changed-when, with changer defined as "the person
   or system".** Make this our standard status-change envelope. Note both the condition and the
   timestamp are mandatory in the CCL; only the changer is optional, which is the wrong
   optionality for us - require it.
5. **The agreement / delivery / settlement triad at header and line level.** Keeping "what we
   agreed", "what moved" and "what we bill" as three objects over the same line item, rather
   than one fat order row with a status column, is precisely the shape pegII's form-and-save
   CRUD lacks. This is the single most useful *architectural* idea in either package.
6. **The document revision chain**: `Version ID` + `Revision ID` + **`Previous Revision ID`** +
   `First Version Issue Date Time` + `Amendment Purpose Code` + `Cancellation Date Time` +
   `Rejection Response Date Time` + `Response Reason Code`. Estimates get revised, BOLs get
   amended, orders get cancelled and reinstated - we need all of this and SCRDM has it worked out.
7. **Adjustment as an entity** (`Delivery_ Adjustment`, `Financial_ Adjustment`: reason code +
   reason text + actual amount/quantity/date-time). A correction is a record with a reason, not
   a silent overwrite. Pairs with a 105-code `AdjustmentReasonDescriptionCode` list.
8. **Reference + reference type + reference *issuer* as three fields** (the creditor-reference
   pattern). Better than MMT's `<Party>AssignedID` for open-ended cases, because the issuer is
   data rather than schema.
9. **The RSM role-to-slot mapping table** (RSM pp.9-11) as a *deliverable format*: for each
   business role, list every place in the model that role can appear. We should produce exactly
   this table for booking / origin / hauling / destination agent, van line, RMC and driver. It
   is the artefact that stops "who is the shipper?" arguments.
10. **`Goods Ownership Change. Date Time`** separate from physical delivery - title transfer as
    its own fact. Relevant to our A6/A7 (when does the customer's liability window start?) and
    to claims.
11. **`AutomaticDataCaptureMethodCode`** - a vocabulary for *how* a fact was captured. Exactly
    the hook a telematics-fed model needs to distinguish a driver tap from a geofence crossing.
12. **Qualified code-list subsetting as a governed mechanism** (WhitePaper p.11 sec 3.6, worked
    in `EventTimeReferenceCodePaymentTermsEvent_D21B`: 5 of 65). This is how to publish "the
    eight reason codes that apply to a delivery exception" without forking the master list - a
    pattern our event catalog should copy.

## Weaknesses / traps

1. **No execution events.** SCRDM's event kinds stop at despatch/pick-up/delivery/receipt/
   loading/unloading. There is **no arrive, no depart, no in-transit, no ETA, no exception**.
   Do not source A4 from SCRDM alone - it will produce a model that knows the shipment left and
   arrived and nothing in between.
2. **"Delivery" means shipment here.** Importing SCRDM's noun into a moving-industry model would
   be actively harmful: in HHG "delivery" is an *event at the destination residence*, and a
   "delivery" that means "the whole shipment" will be misread by every operator who touches it.
   Take the structure, leave the word.
3. **The Trade-Item-split contradiction.** SCRDM: "A single Trade Item **can** be split across
   Deliveries/Shipments" (BRS p.16). MMT: "cannot" (MMT BRS p.15). BSP: "is related to one
   shipment" (BSP BRS p.15). Same download, three rules. Whichever we adopt, cite the document.
4. **`Valuation_ Breakdown Statement` is a name collision.** In HHG, "valuation" is cargo
   liability coverage. In SCRDM it is a priced bill of quantities built from `Grouped_ Work
   Item` / `Basic_ Work Item` / `Work Item_ Dimension`, used only in invoicing. Anyone grepping
   the CCL for "valuation" while working on A11 will find the wrong thing.
5. **Almost everything is `[0..1]` or `[0..*]`.** The RSM says so outright: "Most entities have
   an optional rather than mandatory relationship because entities in a reference data model can
   be optional in one or more derived data exchange structures" (RSM p.12). A reference model
   that mandates nothing cannot express an invariant. Our `model/invariants` has to come from
   somewhere else - and SCRDM's *own* answer is that constraints belong in the derived Business
   Data Exchange Structure, not in the RDM. That is an argument for our layering (core model
   pure, catalog constrained), and worth citing when we make it.
6. **`Trade Workflow Object` is not a lifecycle.** Status + previous status, with no transition
   set and no actor, is barely more than a status string with history. Do not mistake its
   presence for C3 evidence above 2.
7. **No time zone, again** - `Logistics_ Location` in SCRDM has the same gap as in MMT.
8. **Construction and manufacturing content is mixed in.** `Basic_/Grouped_ Work Item`,
   `Procuring_ Project`, `Goods_ Production`, `Supply Chain_ Supply Plan`, `Forecast_ Delivery
   Schedule`, `Supply Chain_ Inventory` are from the scheduling/tender lineage. They are not
   supply-chain-generic and will mislead if treated as core.
9. **SCRDM is not a transport model and does not pretend to be.** Its own scope statement puts
   logistics processes in MMT's court (BRS p.12 fns.7-9: "In scope of multi modal transport").
   Scoring it on A3/A4/A5 is scoring it on work it explicitly declined.

## Out-of-v1 material

- **A10 (survey, estimating & inventory):** `Supply Chain_ Inventory` (stock quantity, planned
  stock, min/max stock level, average demand, calculation date-time, location, disposition
  document) - warehouse stock, not a household inventory. `Trade_ Product` /
  `Trade_ Product Instance` / `Trade_ Product Group` / `Product_ Characteristic` /
  `Product Characteristic_ Condition` / `Trade Product_ Feature` / `Product_ Classification` /
  `Referenced_ Product` / `Product_ Security Tag` - a full product-master vocabulary that is the
  nearest structural analogue to an inventory item with condition codes, and worth revisiting
  when A10 is built. `Specification_ Query` / `Specification_ Response` are a request/response
  pair for product specs. Estimating: `Reference_ Price`, `Calculated_ Price`, `Trade_ Price`,
  and the whole `Valuation_ Breakdown Statement` / work-item tree (a priced BoQ with dimensions
  and quantity analysis) - structurally close to a moving estimate with line items, if one
  ignores the construction framing.
- **A11 (claims & valuation):** nothing. `Identified_ Fault` is in the MMT subset, not the
  SCRDM subset. `Delivery_ Adjustment` (reason + actual quantity/amount) is the closest thing to
  a shortage/overage record.
- **A12 (rating & tariffs):** `Trade_ Price` with `Reference_ Price` and `Calculated_ Price`,
  `PriceTypeCode`, `Logistics_ Service Charge` with `Tariff Class. Code` [UNCL 5243] and
  `Calculation Basis. Code` "such as by volume or per unit", `Trade_ Allowance Charge` +
  `Applied_ Allowance Charge`, `AllowanceChargeIdentificationCode` and
  `AllowanceChargeReasonCode` lists, `Header_ Trade Agreement. Price List. Referenced_ Document`.
  Enough to *reference* and *apply* a rate; nothing to *express* a tariff.
- **A13 (crew, driver & settlement):** nothing on crew or driver. The settlement machinery
  (`Trade Settlement_ Payment`, `Payment_ Balance Out`, `Advance_ Payment`, `Creditor`/`Debtor
  Financial Account`, `Branch_ Financial Institution`, remittance advice as a named process) is
  the generic AR/AP layer an agent-settlement model would sit on.
- **Governance (applies to our whole method, not to one area):** the RDM Guideline sec 8
  (pp.21-23) is an eight-step change process for a reference model - initiate/change request,
  analyse process, capture & define data, reconcile against the library, maintain the master
  structure, submit change request, update the library, update BRS/RSM. With the warning at step
  5: "Care must be taken because any change may have impact on existing data exchange
  structures" and the worked example of switching an ABIE off or making an optional BBIE
  mandatory for everything derived from the master. If we want a defensible governance process
  for `model/` -> `catalog/`, this is a free, UN-published template.

## Open questions

1. **Does pegII distinguish a *confirmed/promised* date from a *planned* one?** SCRDM's
   `Confirmed_` qualifier is the most valuable single idea here and it is worthless if neither
   system can source it. Check `src:pegii-order`, `src:pegii-longhaul`, `src:pegasus-cloud-prisma`.
2. **Qualifier-on-the-association (SCRDM) or qualifier-on-the-attribute (MMT)?** The two UN/CEFACT
   models disagree with each other about the *same* problem. For an append-only Cloud event
   catalog, SCRDM's shape (one event per flavour, superseded ones retained) is the better fit and
   MMT's is the worse - but MMT's is what a revisable pegII record actually looks like. This is a
   phase-3/phase-4 decision and both options should be written up explicitly in `model/`.
3. **Do we adopt the agreement / delivery / settlement triad?** It is the most structurally
   opinionated idea in either package. If we do, A1/A2/A7 all reorganise around it. If we do not,
   we should say why in `analysis/` rather than let it lapse.
4. **Where do invariants live in our layering?** SCRDM's answer - the reference model mandates
   nothing, the derived exchange structure mandates everything (RSM p.12) - is a real position
   with real consequences. Our README already splits `model/` from `catalog/`; whether that
   split carries the same meaning should be settled deliberately.
5. **Is there an HHG-specific reason-code vocabulary anywhere in our sources?** SCRDM shows the
   *mechanism* (qualified subsets of a master code list) but every actual list here is generic.
   The 105-code `AdjustmentReasonDescriptionCode` and 336-code Rec 24 lists are unreadable in
   this download - someone has to obtain the real tables before we can judge whether subsetting
   them beats writing our own.
6. **Does `Goods Ownership Change. Date Time` have an HHG analogue worth modelling?** Title does
   not transfer in a move, but custody does, repeatedly (origin agent -> hauler -> warehouse ->
   destination agent). A custody-change fact distinct from a movement event may be exactly what
   our A5/A8 needs, and SCRDM is the only source so far that separates the two.
