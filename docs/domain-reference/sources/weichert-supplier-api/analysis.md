---
source: src:weichert-supplier-api
analyzed: 2026-09-17
evidence_grade: A
material: |
  sources/weichert-supplier-api/local/weichert-api.odt — read in full (3,578 lines of
  extracted text, all 8 guide sections + Response Codes).
  Cross-read (our own implementation, not the source):
  pegasus-workflows:platform/integrations/weichert/{mapping.json,rules.json,corpus.json,meta.json,README.md}
  pegasus-workflows:platform/weichert-milestone-update/weichert_milestone_update/workflow.py
---

# Weichert supplier API (service order / shipment order updates) — analysis

> **Citation convention.** `odt:NNN` = line NNN of the text extracted from
> `local/weichert-api.odt` with
> `scratchpad/pdfenv/bin/python scratchpad/odt2txt.py …/weichert-api.odt`
> (deterministic for this file; section headings in the extract are the `#`-prefixed
> lines, so every cite below also names its section).

## What it is

Weichert Workforce Mobility's **Supplier API integration guide** — the document a
household-goods supplier is given so it can receive and update Weichert service
orders without logging into the Weichert Supplier Portal (`odt:59`, *Integration
Guides / Purpose*). **S1 kind:** `vendor-api`. **S3 openness:** `gated-partner`
(credentials are issued per engagement by Weichert IT, `odt:16`); registry records
it `partner-confidential`. **S2 adoption:** 1 — it is one RMC's private supplier
contract, not an industry standard; its weight comes from *who* speaks (the
relocation management company that awards the work), not from adoption.

**What our reading covered:** everything. All eight lanes — Connectivity/Auth
(`odt:1–44`), Process Overview (`odt:45–56`), Domestic HHG (`odt:60–684`), Domestic
LTS (`odt:685–1078`), International HHG (`odt:1079–1820`), International Bid
(`odt:1821–2373`), International LTS (`odt:2374–2772`), Auto Shipment
(`odt:2773–3288`), Pet Shipment (`odt:3289–3551`), Response Codes
(`odt:3552–3578`).

**What we could not see:** the document is a *field reference*, not a behavioral
spec. There is no state diagram, no transition table, no data dictionary defining
any term, no OpenAPI/RAML artifact, and no error-code catalog beyond five bare HTTP
statuses (`odt:3552–3578`). Notably it contains **none of the business rules our own
`rules.json` attributes to "Weichert API:"** — see *Traps / provenance of our
sourceRefs* below. Anything about who may move a status, or in what order, is
absent from the material we hold.

## Model summary

The source's own shape, in its own words:

```
Service Order  (serviceOrderNumber "O-66673", serviceStatus)
├─ placed by the Weichert service team in "the Weichert Go platform" (odt:47)
├─ awarded to one supplier (supplierName / supplierAccountId "A-01611"),
│  staffed by a supplier coordinator (supplierContactName/Email)
├─ hhgRequestDetails  (name "HHG-00053160")   ← the customer's HHG *request*
│   └─ move  (moveNumber "M-C-12345-1")       ← the relocation the request belongs to
│       └─ contact / account  (clientAccountID "A-010272")
└─ shipments[]  (supplierShipmentId — the SUPPLIER's own id, shipmentStatus)
    ├─ agents: origin / destination / hauling / storage / third-party / shipping line
    ├─ measures: netWeight, netVolume, grossWeight, grossVolume, acw, cwt, containerType
    ├─ dates:  surveyDate, packDate1..3, loadDate1..3,
    │          sitInDateOrigin / sitOutDateOrigin,
    │          sitInDateDestination / sitOutDateDestination,
    │          deliveryDate1..3          — each an {estimated, actual} pair
    └─ costs:  surveyed* buckets, dtdCost, storageSITCost
```

Parallel top-level order types, each with its **own** receive/accept/update triple and
its own payload: **Domestic HHG**, **Domestic LTS** (long-term storage,
`ltsRequestNumber "LTS-00053160"`), **International HHG**, **International Bid**
(`bidID "B-10825"`, its own `bidStatus`), **International LTS**, **Auto Shipment**
(vehicles One/Two, its own `orderStatus`), **Pet Shipment** (pets One/Two, its own
`orderStatus`).

**Flow** (*Supplier API Process Overview*, `odt:45–56`):
1. Weichert POSTs a **New Order JSON payload** to an endpoint the *supplier* hosts
   and protects (OAuth / Basic / header-based, `odt:64–68`).
2. The supplier registers it and answers with a response code.
3. On accepting, the supplier POSTs a **Service Order Update** back to Weichert;
   Weichert validates and returns a code plus a **Correlation ID**.

Two structural facts worth carrying forward:

- **Accept and Update are the same URL.** Both POST to
  `/v1/supplier/inbound/hhg/wmn/domestic/:orderId`; "Accept" is distinguished only by
  the instruction *"Supplier must send the JSON payload below with an empty shipments
  array object"* (`odt:322`, and identically at `odt:892, 1343, 2081, 2586, 2968,
  3456`). **The lifecycle transition rides in the payload, not in the route.**
- **The transport is a full-document overwrite.** Every update is a POST of the whole
  order-and-shipments document; there is no PATCH, no per-field update, no event
  message. "All operations are synchronous - when you POST an update the Weichert
  system will process it immediately" (`odt:3`).

## Vocabulary

Terms exactly as the source spells them (definitions are *quoted* where the source
gives one; most fields have only a gloss and an example).

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `serviceOrderNumber` / `serviceOrderName` | "Service order record identifier, for example O-66673." Both spellings occur: HHG uses `…Number` (`odt:72`), both LTS lanes use `…Name` (`odt:696`, `odt:2386`). | A9 | odt:72, 696, 2386 |
| `serviceStatus` | "The status of the order." Enum differs by direction; see *Lifecycles*. | A1 | odt:75, 338, 366 |
| `shipmentStatus` | "Current shipment status." Separate enum from `serviceStatus`. | A2/A4 | odt:429 |
| `bidStatus` | "The current status of the bid." Own enum, own record. | A1 | odt:1836 |
| `orderStatus` | Status of an **Auto** or **Pet** service order — a third, much larger enum. | A1 | odt:2984, 3472 |
| `hhgRequestDetails.name` | "Household Goods Request record identifier, for example HHG-00053160." The *request* is a record distinct from the service order. | A9 | odt:111 |
| `moveNumber` | "Related move record number, for example M-C-12345-1." | A9 | odt:114 |
| `ltsRequestNumber` | "LTS Request record identifier, for example LTS-00053160." Carries `hhgRequestNumber` as a back-reference. | A5/A9 | odt:777, 795 |
| `bidID` | "Bid order record identifier, for example B-10825." Carries `serviceOrder.serviceOrderNumber` "if a bid is awarded". | A1/A9 | odt:1833, 1857 |
| `needsAssessmentName` | "Needs Assessment Record Name, for example NA-27672." | A10 | odt:2911 |
| `supplierShipmentId` | "Assigned supplier's unique identifier for each shipment **from their proprietary system**." **Required.** | A9 | odt:378 |
| `agentShipmentID` | LTS field; description is copy-pasted wrong ("Address for the storage location"). Name implies the agent's own shipment id. | A9 | odt:1020 |
| `supplierAccountId` / `clientAccountID` | "record identification number, for example A-01611" / "A-010272" — supplier and corporate client share one `A-` account namespace. | A8/A9 | odt:87, 138 |
| `ownerName` | "Assigned Weichert move coordinator." The RMC-side owner. | A8 | odt:90 |
| `relocationCounselorName/Email/Phone` | The Weichert counselor — a role distinct from `ownerName`. | A8 | odt:144, 147, 236 |
| `supplierContactName` / `supplierContactEmail` | "Name of the supplier coordinator assigned to this shipment" / email "will be used to **match or update** the original assigned coordinator to an existing Weichert contact record." | A8 | odt:78, 81 |
| `wmnContractType` | "Client Weichert Move Network contract type. Possible options are **WMN Managed, Client Preferred or Client Directed**." | A8 | odt:141 |
| `quoteType` | "Type of quote for service order. Possible options are **Booked Move or Competitive Move**." | A1/A10 | odt:177 |
| `assignedOriginAgent` / `assignedDestinationAgent` / `assignedHaulingAgent` / `assignedStorageAgent` / `AssignedThirdPartyProvider` / `assignedShippingLineAirline` | Agent role slots, each a free-text **name** up to 255 chars. | A8 | odt:390–404, 1429 |
| `routingType` | "Method in which shipment will be routed. Possible options are **Air, Sea – FCL, Sea – FCL – Liftcased, Sea – LCL, Land – FTL, Land – LTL, Vanline, or RO-RO**." | A2/A3 | odt:420 |
| `shipmentType` | "Type of shipment. Possible options are **Air, Land, Sea or LTS**." (International only.) | A2 | odt:1414 |
| `directOrSIT` | "Indicates whether the delivery will be direct to the destination or require storage in transit. Possible options are **Direct or SIT**." | A5 | odt:426 |
| `sitInDateOrigin` / `sitOutDateOrigin` | "Estimated/Actual date for **delivery into** storage at origin (SIT)" / "**pickup out of** storage at origin (SIT)". | A5 | odt:495–511 |
| `sitInDateDestination` / `sitOutDateDestination` | Same pair at destination. | A5 | odt:513–529 |
| `ltsInDate` / `ltsOutDate` | "**Scheduled**/Actual delivery into (out of) long term storage (LTS)." Note `scheduled`, not `estimated`. | A5 | odt:933–949 |
| `physicalstorageLocation` / `storageFacilityName` | Storage address (free text) and facility name. Casing varies by lane (`physicalstoragelocation` in LTS). | A5/A8 | odt:417, 1014, 1017 |
| `packDate1/2/3`, `loadDate1/2/3`, `deliveryDate1/2/3` | "Initial / Second / Third pack (load, delivery) dates for a specific shipment order", each `{estimated, actual}`. | A4 | odt:441–556 |
| `originQAConductedBy` / `originQACompletedDate` (and destination) | "Employee name that conducted the origin QA" / "Date when the origin QA visit was completed." | A6 | odt:405–415 |
| `netWeight.{estimated,actual}` (domestic) | "Estimated/Actual net weight **per survey results**." | A2/A10 | odt:384–388 |
| `{net,gross}{Weight,Volume}.{surveyedAmount,allowanceAmount,actualAmount}` (international) | Same concept, a **three-valued** basis instead of two. | A2/A10 | odt:1570–1616 |
| `acw` (`lbs`/`kg`, surveyed/allowance/actual) | Undefined acronym (industry: *air chargeable weight*). | A2/A12 | odt:1618–1643 |
| `cwt` | Undefined acronym (industry: hundredweight). Also `monthlyStorageCWT`, `warehouseHandlingCWT`. | A12 | odt:1645, 1023 |
| `containerType.{surveyed,allowance,actual}` | Enum "LDN, 2 LDN, D, 2 D, 1 D plus 1 LDN, E, 20FT, 40FT, Two 40FT, 20FT plus 40FT, 40FT HC, 45FT HC, Truck, Air Other, Land Other, Sea Other, Automobile or Rail." (LDN/D/E are liftvan sizes; the doc never says so.) | A2 | odt:1558–1568 |
| `dtdCost` | Undefined acronym (industry: door-to-door). | A7 | odt:1657 |
| `allowanceOrSurveyedAmountsUsed` | "This field indicates whether the **surveyed or allowance** amounts were **approved**." | A7/A10 | odt:1271 |
| `surveyedCoreMovingServiceCosts` + five `surveyed*` buckets | Per-category surveyed cost on the shipment. | A7 | odt:558–578 |
| `notIncludedComments` | "Notes on costs that are **not included or allowable for invoicing**." | A7 | odt:579 |
| `supplierHHGDiscount` / `supplierSITDiscount` / `clientHHGDiscount` / `clientSITDiscount` | Four separate discount percentages — what the supplier gives Weichert vs what Weichert gives the client. | A7/A12 | odt:93–103 |
| `internationalHHGCommission` / `petCommission` | "commission percentage." | A7/A13 | odt:1112, 3340 |
| `insuranceType` | "Client insurance type for this service order, for example Self Insured." | A11 | odt:105 |
| `customerDeclaredValue` / `customerHighValuedInventoryAmount` | LTS money fields (descriptions copy-pasted as "Actual CWT"). | A11 | odt:1029–1033 |
| `transitTime` / `transitTimeDays` | "Total estimated days in transit, for example 45." | A3/A4 | odt:1420, 2177 |
| `actualDistanceMiles` | "Number of miles from pickup to delivery address for example 4209." | A3 | odt:423 |
| `correlationId` | Returned on **every** response, success and error alike. | A9 | odt:3554–3578 |
| `vehicleOneOversizeClass` | Enum "Class 1, Class 2a, Class 2b, Class 3 … Class 8". | A2 | odt:2881 |

## Lifecycles & events

### Service status (HHG + LTS, domestic and international) — the full enum, by direction

The source states **three different enums for the same field**, and the difference is
purely directional:

| Where | Enum as printed | Cite |
| --- | --- | --- |
| **Inbound** (Weichert → supplier, "Receive a Service Order") | `Requested`, `Awarded`, `Cancelled` | odt:75-76 (dom HHG), 699-700 (dom LTS), 1094-1095 (intl HHG), 2389-2390 (intl LTS) |
| **Accept** (supplier → Weichert, domestic HHG only) | `Accepted`, `Submitted`, `Delivered` | odt:338-339 |
| **Update** (supplier → Weichert, every lane) | `Requested`, `Accepted`, `Submitted`, `Awarded`, `In Progress`, `Delivered`, `Declined`, `Cancelled` | odt:366-367, 908-909, 930-931, 1359-1360, 1393-1394, 2602-2603, 2624-2625 |

The union is **eight** values. Read as a lifecycle the intent is legible —
`Requested` → (`Accepted` | `Declined`) → `Submitted` (estimate) → `Awarded` →
`In Progress` → `Delivered`, with `Cancelled` from anywhere — but **the source never
states a single transition, ordering, or actor.** It is a flat "possible options"
list in every one of the seven places it appears. The only ordering signal in the
entire document is the *directional split* above.

Three things are **not** in the enum and matter:

- **`Completed` is not a service status.** It exists only in the *shipment* status
  enum (`odt:430`). Our `delivered-requires-load-delivery-actuals` rule treats
  `Completed` as a `serviceStatus` value (`rules.json:118–124`) — see *Traps*.
- **`Authorized` is not in any documented enum**, yet it is the value in three of the
  vendor's **own inbound examples**: `"serviceStatus": "Authorized"` at `odt:257`
  (domestic HHG), `odt:1277` (international HHG), `odt:2533` (international LTS). The
  documented inbound enum at those same three places says `Requested | Awarded |
  Cancelled`. **The examples contradict the field reference**, which means live
  payloads carry at least one undocumented status.
- No `Booked`, no `Completed`, no `On Hold` on the HHG lanes.

### Shipment status (HHG domestic + international)

"Current shipment status. Possible options are **Under Review, In Process, In
Storage, Delivered, Completed or Cancelled**" (`odt:429–430`, repeated verbatim at
`odt:1438–1439`). No definitions, no transitions, no relation to `serviceStatus`
stated. `In Storage` is the only SIT-aware status. Note the international *example*
sends `"shipmentStatus": "In Progress"` (`odt:1710`) — **a value not in that enum**;
`In Process` is the documented spelling. A second example/reference contradiction.

### Bid status

"Requested, Awarded, Declined or Cancelled" inbound (`odt:1836–1837`); "Requested,
Accepted, Submitted, Awarded, Declined or Cancelled" on accept/update
(`odt:2097–2098`, `odt:2138–2139`). Same directional pattern; **no `In Progress` or
`Delivered`** — a bid is not executed, it is won or lost, and when won it carries
`serviceOrder.serviceOrderNumber` (`odt:1857–1861`) as the link to the order that
executes it.

### Auto / Pet order status — a different, much richer vocabulary

`odt:2984–2985` (Auto accept) lists **eighteen** values:

> Authorized, Scheduled, In Progress, On Hold, Closed – Service Delivered, Canceled,
> Quote Requested, Complete, Accepted By Supplier, Declined, Assigned, Cancelled by
> Supplier, Cancelled by Customer, Scheduled by Customer, Reschedule Requested by
> Customer, Reschedule Requested by Supplier, Incomplete, Complete – Service Delivered

The Auto **update** endpoint and both Pet endpoints cut the same field to six:
"Authorized, Scheduled, In Progress, On Hold, Closed – Service Delivered, and
Canceled" (`odt:3013`, `odt:3473`, `odt:3507`). Two spellings of cancel
(`Canceled` / `Cancelled by …`) and two of complete (`Complete` / `Complete – Service
Delivered` / `Closed – Service Delivered`) coexist.

**This enum is the closest thing in the whole document to reason codes**: it encodes
*who* caused the outcome (`Cancelled by Supplier` vs `Cancelled by Customer` vs
`Scheduled by Customer`) and *what kind* of pending state it is (`Reschedule
Requested by Customer` vs `… by Supplier`). The HHG lanes — the ones that matter most
to us — have **none** of that.

### Events

There is **no event vocabulary at all**. Execution is represented only as dated
milestone *slots* on the shipment: survey, pack 1/2/3, load 1/2/3, SIT in/out at
origin and destination, delivery 1/2/3, origin QA, destination QA
(`odt:432–556`, `odt:405–415`). No arrive, no depart, no ETA, no exception, no delay,
no reason code, no telemetry, and no event identity or ordering — a milestone is a
field on a document that gets overwritten, not something that happened.

### Vendor-stated rules — the complete list

These are *all* the behavioral rules the document states:

1. **Idempotency by order id.** "Weichert is expected to send only one JSON payload
   per `serviceOrderNumber`. If, for some reason, a second JSON payload with the same
   order number is received by the supplier, it should be ignored **if the first
   payload was processed successfully**." (`odt:69`, repeated at `odt:694, 1088, 2383,
   2782, 3298`; the bid lane keys it on `bidID`, `odt:1830`.) Note it binds the
   *supplier's* behavior, not Weichert's.
2. **Accept = update with an empty `shipments` array.** (`odt:322, 892, 1343, 2081,
   2586, 2968, 3456`.)
3. **Synchronous processing, no async callback.** (`odt:3`.)
4. **Supplier endpoint auth is the supplier's choice** of OAuth / Basic / header-based,
   provisioned by the supplier. (`odt:64–68`.)
5. **Weichert-side auth is `client_id` + `client_secret` request headers** under a
   Mulesoft policy, one credential pair per environment. (`odt:10–17`.)
6. **Required fields.** Only nine distinct fields are marked `Required` anywhere:
   `supplierContactName`, `supplierContactEmail`, `serviceStatus` (on every
   HHG/LTS accept + update: `odt:332, 335, 338, 360, 363, 366, 902, 905, 908, 924,
   927, 930, 1353, 1356, 1359, 1387, 1390, 1393, 2596, 2599, 2602, 2618, 2621, 2624`),
   `shipments.supplierShipmentId` (`odt:378, 1411`),
   `shipments.shipmentType` (international only, `odt:1414`),
   `bidDetails.supplierBidDetailId` (`odt:2156`), and `serviceStatus` on the
   international-LTS *inbound* payload (`odt:2389`). **Everything else in the entire
   document — every date, weight, cost, agent, status-on-Auto/Pet — is optional.**
   The Auto and Pet lanes mark **nothing** required, not even `orderStatus`.
7. **Response codes.** 202 Accepted, 400, 401, 404, 500 — each `{message,
   correlationId}` (`odt:3552–3578`). No validation-error detail structure is shown,
   although the overview promises "error information will be provided in the response"
   (`odt:56`).

**There are no others.** No rule about which status may follow which, who may set
what, or which dates a status requires.

## Time, identity, evidence

### Time

- **Every milestone is a two-valued pair**, and the vocabulary for the planned half is
  inconsistent across lanes: `{estimated, actual}` on HHG shipment dates
  (`odt:435–556`), `{scheduled, actual}` on LTS in/out (`odt:936–949`) and on all Auto
  vehicle dates (`odt:3069–3112`). Same concept, two words.
- **Three-valued on measures and money, two-valued on dates.** International weights,
  volumes, ACW, CWT, container type and costs are `{surveyed, allowance, actual}`
  (`odt:1561–1679`) — *allowance* being the client's policy entitlement, a third basis
  distinct from both estimate and outcome. Dates never get an `allowance`.
- **Date-only, always.** Every temporal field is `YYYY-MM-DD` (stated on each one,
  e.g. `odt:445`). **There is no time of day anywhere in the document, and no time
  zone.** A cross-continental move records only calendar days.
- **Windows exist only on Auto and Pet.** Auto uses paired fields for a range —
  `vehicleOnePickupDateOne.scheduled` "first day of pickup date range" and
  `vehicleOnePickupDateTwo.scheduled` "last day" (`odt:3066–3094`); `DateTwo` has a
  `scheduled` but **no `actual`** (the range collapses to a single actual). Pet uses
  an explicit `estimatedDeliveryDate.{Start,End}` object plus a scalar
  `actualDeliveryDate` (`odt:3518–3528`). **HHG has no spread/window at all** — only
  the order-level `expectedMoveOutDate` + `latestPossibleMoveOutDate` pair
  (`odt:165–169`), which is the customer's constraint, not a service window.
- **Multi-day activity is modeled as numbered slots**, not as repetition:
  `packDate1/2/3`, `loadDate1/2/3`, `deliveryDate1/2/3` (`odt:441–556`). Three is a
  hard ceiling; the doc never says what "Second" means (a second day? a second
  crew? a second address?). This is also the *only* trace of stop sequence in the
  entire source.
- **Contact timing is modeled twice**: `initialContactDate` "date of the **first
  attempt** to contact" vs `contactMadeDate` "date initial contact **has been made**"
  (`odt:1362–1366`). Attempt vs success is a real distinction, and it is the single
  most careful piece of temporal modeling in the document. Domestic HHG has only
  `contactMadeDate` (`odt:341`); international and bid have both. Auto/Pet rename the
  second one `actualContactDate` (`odt:2990`).

### Identity & cross-references

Strong, and the strongest part of this source. Every record type carries a
**typed, prefixed** identifier: `O-` service order, `HHG-` household-goods request,
`M-C-` move, `LTS-` LTS request, `B-` bid, `NA-` needs assessment, `A-` account
(both supplier and corporate client share this namespace). Cross-references are
explicit and directional:

- bid → order: `serviceOrder.serviceOrderNumber` "Information about the related
  service order **if a bid is awarded**" (`odt:1857–1861`).
- LTS request → HHG request: `ltsRequestDetails.hhgRequestNumber` (`odt:795`).
- order → move: `moveNumber` on every lane; the `M-C-28608-6` / `M-C-28608-4` /
  `M-C-28608-7` examples (`odt:270`, `odt:845`, `odt:2028`) show **several service
  orders hanging off one move**, the `-N` suffix distinguishing them. The doc never
  documents that suffix.
- **Both sides keep their own key.** `supplierShipmentId` is Required and is defined
  as the supplier's id "from their proprietary system" (`odt:378`); Weichert's own
  `:orderId` path parameter is theirs. A third, `agentShipmentID` (`odt:1020`),
  implies the *agent's* id as yet another party's key.
- `correlationId` on every response, success or failure (`odt:3552–3578`) — a
  per-request identifier, not a per-record one.

**What is missing is as telling as what is there:** no SCAC, no van-line or carrier
code, no BOL/PRO number, no registration number, no driver id, no unit/trailer
number. **Agents are identified by a 255-character free-text name** (`odt:390–404`) —
"assignedOriginAgent: 'Test'", "'Atlas Van Lines'", "'Armstrong'" in the vendor's own
examples (`odt:602–605`, `odt:1705–1707`). The RMC does not hold the industry's
identifiers for the parties actually doing the work.

### Evidence, provenance & corrections

Effectively **absent**, and this is the source's single largest gap.

- **No actor on any fact.** Nothing records who asserted a date, a weight, or a
  status. The only "who" fields in the document are `originQAConductedBy` /
  `destinationQAConductedBy` — "Employee name that conducted the origin QA"
  (`odt:405`) — a free-text name attached to a QA visit, and `ownerName`/
  `supplierContactName` as *assignment*, not attestation.
- **No evidence type.** No document, no attachment, no weight ticket, no signature,
  no photo, no BOL, no inventory, no proof of delivery. An RMC supplier API that
  never asks for a single document.
- **No correction semantics.** The only reversal in the model is `Cancelled`. Because
  every update POSTs the whole document, **a correction is indistinguishable from an
  update, and a late-arriving stale payload silently overwrites a newer one** — there
  is no version, no `If-Match`, no `updatedAt`, no sequence number anywhere in the
  document. Idempotency is asserted only for the *inbound* new-order payload
  (`odt:69`).
- The closest thing to provenance is `allowanceOrSurveyedAmountsUsed` — "whether the
  surveyed or allowance amounts were **approved**" (`odt:1271`) — which records the
  *basis* a number came from, and `supplierContactEmail`'s documented role as the
  **match key** onto an existing Weichert contact record (`odt:81–82`), which is
  identity-resolution semantics stated out loud.

## Scores

Scored per area against the rubric; `n/a` where a criterion does not apply to the
area. Evidence grade A (full source read), so C2/C3 are not capped.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A1** Order & service lifecycle | 2 | 1 | 1 | 3 | 2 | 2 | 0 | 1 | Eight-value enum covering request/accept/decline/submit/award/execute/deliver/cancel (odt:366-367) but **no definitions and no transitions** — a flat "possible options" list in all 7 places. C3 is 1 not 0 only because the inbound/accept/update enums differ, which implies direction (odt:75, 338, 366). C4: bid lane, quoteType Booked/Competitive (odt:177), wmnContractType (odt:141). C7=0: no actor on any transition. C8: `/v1/` path versioning only; enums closed. |
| **A2** Shipment structure | 2 | 2 | 1 | 3 | n/a | 2 | 0 | 1 | shipments[] under an order, shipmentType Air/Land/Sea/LTS (odt:1414), routingType incl. Vanline/RO-RO (odt:420), net vs gross × weight vs volume, ACW, CWT, containerType incl. liftvan sizes (odt:1562). C2=2: the net/gross and surveyed/allowance/actual distinctions are carried explicitly but **no term is defined** (ACW, DTD, LDN, CWT never expanded). C3: shipmentStatus enum only (odt:429). Auto/Pet are separate *order types*, not shipment types — a modeling choice worth noting. |
| **A3** Trip, stop & assignment | 1 | 1 | n/a | 1 | 2 | 0 | 0 | n/a | **Essentially absent.** No trip, no vehicle, no driver, no leg, no consolidation, no stop entity, no sequence. C1=1 solely because `packDate1/2/3`, `loadDate1/2/3`, `deliveryDate1/2/3` (odt:441-556) encode a *positional* sequence of up to three service days per milestone, and `transitTime` (odt:1420) + `actualDistanceMiles` (odt:423) + `routingType` describe the journey as three scalars on the shipment. C5=2 for the estimated/actual pairing on those ordinals. **The RMC sees a shipment, never a truck.** |
| **A4** Execution events & tracking | 1 | 2 | 1 | 3 | 2 | 1 | 0 | 1 | Milestones exist as dated slots (pack/load/SIT/delivery/survey/QA) — **no events, no arrive/depart, no ETA, no exception or delay, no reason code, no telemetry**. C2=2: pack, load and delivery are cleanly separated and separately dated, and SIT in/out is split origin vs destination. C5=2: universal {estimated, actual} pairing, but date-only, no time, no zone, no window (odt:445 and passim). C7=0 is the important one: a milestone is an overwritable field, so nothing records who said so or how it is corrected. |
| **A5** Storage-in-transit | 3 | 3 | 1 | 3 | 2 | 2 | 0 | 1 | **The best-covered area in this source.** `directOrSIT` as an explicit routing decision (odt:426); four SIT date pairs distinguishing in/out × origin/destination (odt:495-529); `assignedStorageAgent` + `physicalstorageLocation` (odt:396, 417); SIT cost split first-day / additional-days / **delivery-out** (odt:561-568). C2=3 because **the permanent-storage boundary is modeled as a separate product**: LTS is its own order, its own endpoints (`/v1/supplier/inbound/hhg/lts/`), its own dates (`ltsInDate`/`ltsOutDate`, odt:933-949), its own monthly-storage and warehouse-handling costs, and its own back-reference to the originating HHG request (odt:795). C3=1: `In Storage` is the only SIT-aware status. |
| **A6** Documents & evidence | 0 | n/a | n/a | n/a | n/a | n/a | 0 | n/a | **The area is absent.** No order for service, estimate document, inventory, BOL, weight ticket, POD, photo, signature, or attachment of any kind anywhere in 3,578 lines. The only artifacts of a *performed check* are `originQAConductedBy` / `originQACompletedDate` and the destination pair (odt:405-415), and several free-text comment fields (odt:579-586). |
| **A7** Charges & billing hooks | 2 | 2 | 0 | 3 | 1 | 1 | 1 | 1 | Rich cost *buckets* — core moving, storage (first day / additional / delivery-out), 3rd-party crate-and-uncrate, 3rd-party, other, insurance, warehouse handling, DTD, storage-SIT (odt:558-578, 969-1003, 1657-1679) — on a surveyed/allowance/actual basis. C2=2 for the four-way discount split `supplier{HHG,SIT}Discount` vs `client{HHG,SIT}Discount` (odt:93-103), which makes the RMC's own margin explicit. **C3=0: no invoice, no charge event, no payment, no billing lifecycle at all** — `notIncludedComments` "not included **or allowable for invoicing**" (odt:579) is the only hint invoicing exists elsewhere. C7=1 for `allowanceOrSurveyedAmountsUsed` (odt:1271) recording which basis was approved. |
| **A8** Parties & roles | 3 | 2 | 1 | 3 | n/a | 2 | 1 | 1 | Full RMC-view cast: corporate **client** account, **customer**, Weichert **owner/move coordinator** *and* **relocation counselor** as distinct roles, **supplier** company + supplier **coordinator**, and six agent role slots — origin, destination, **hauling**, storage, third-party provider, shipping line/airline (odt:390-404, 1429-1434). C4=3: `assignedHaulingAgent` is HHG-native vocabulary. **C6=2 not 3 because every agent is a free-text name with no id or SCAC** (odt:390). C7=1 for the documented contact-matching rule (odt:81). C3=1: the doc implies Weichert assigns the supplier and the supplier names the agents (odt:47-53), never states it. |
| **A9** Identity & cross-references | 3 | 2 | n/a | 2 | n/a | 3 | 1 | 1 | Typed prefixed ids for seven record types (O-, HHG-, M-C-, LTS-, B-, NA-, A-) with explicit bid→order and LTS→HHG links (odt:1857, 795). **C6=3: both sides keep their own key** — `supplierShipmentId` is Required and defined as the supplier's own system id (odt:378) while Weichert keys the URL by its own `:orderId`; `agentShipmentID` implies a third party's key. C4=2: **no SCAC, PRO, BOL, registration or driver id** — the van-line identifier set is entirely absent. C7=1 for `correlationId` on every response. |

**S5 — fit to Pegasus data** (judged from our own live mapping,
`pegasus-workflows:platform/integrations/weichert/mapping.json` and its README, which
records what was confirmed against prod order 490317):

| Area | Fit | Note |
| --- | --- | --- |
| A1 | **partial** | pegII supplies the order-level status as `Survey.SerivceStatus` (misspelled in pegII itself; mapping.json:12). The **shipment** status has no pegII source with a legend — `Survey.ShipmentStatus` is an Atlas code and maps to `null` until a code→enum translation exists (integrations/weichert/README.md:106-110). |
| A2 | **partial** | One pegII order produces exactly **one** shipment (`$each` over the order root, mapping.json:27-29). Weights map (`Financials.{Estimated,Actual}Weight`); volume, gross, ACW, CWT, containerType, routingType, shipmentType, directOrSIT have **no mapping at all** today. |
| A3 | **no** | Nothing in this source and nothing mapped. |
| A4 | **partial** | `KeyMoveDates.{Survey,Pack,Load,DelResidence}.{Planned,Actual}` covers date-slot **1** of each milestone (mapping.json:48-95). `packDate2/3`, `loadDate2/3`, `deliveryDate2/3` have **no pegII source** (README.md:82-84), so a three-day pack is unrepresentable on our side too. |
| A5 | **unknown** | **None of the four SIT date pairs, `directOrSIT`, `assignedStorageAgent` or `physicalstorageLocation` is mapped**, and the README does not say whether pegII has sources for them. Best-covered area in the source, least-exercised in our config. Worth resolving before A5 modeling. |
| A6 | **no** | Nothing to map; the source has no documents. |
| A7 | **partial** | `Survey.CoreCost` → order-level `estimatedTotalCost`, plus the six `surveyed*` add-on components from `Survey.*` (mapping.json:96-119, 141-144). Confirmed on prod order 490317: CoreCost 10,590.87 vs 970 across the six components (README.md:144-150). Discounts, commission, currency, DTD, allowance basis: unmapped. |
| A8 | **partial** | Coordinator name maps; **the email does not exist on a native pegII sale** and is grafted on by a workflow enrichment pass against the salesman endpoint (`workflow.py:239-281`). Agent role slots: unmapped. |
| A9 | **partial** | `serviceOrderNumber` comes from `InvolvedParties.ShipperEmployer.Identity.Description`, **not** pegII's `Id` — mapping it from `Id` produced a live `404` on 2026-08-12 (README.md:34-42). `supplierShipmentId` correctly stays pegII's `Id`. Move number, HHG request number, client account id: unmapped. |

## Strengths worth adopting

1. **Separate the planned half's vocabulary by intent, not by lane.** This source
   proves the cost of not doing so: the same concept is `estimated` on HHG dates,
   `scheduled` on LTS and Auto dates, and `surveyed` on measures — with `allowance`
   as a genuine *fourth* basis on international measures and money (`odt:1271`,
   `odt:1561-1679`). Our model should name these deliberately: **planned / scheduled
   (a commitment) vs estimated (a forecast) vs entitled-allowance (a policy cap) vs
   actual (an outcome)** — four ideas the industry really does hold, which this source
   has and confuses.
2. **Permanent storage as a different product, not a longer SIT.** LTS gets its own
   order, endpoints, date pair, cost structure (monthly storage, warehouse handling)
   and a back-reference to the HHG request it came from (`odt:795`). That is exactly
   the A5 "permanent storage boundary" the rubric asks about, and it is a cleaner
   answer than a duration threshold on SIT.
3. **SIT in/out split by end.** Four dates — in/out × origin/destination
   (`odt:495-529`) — plus a `directOrSIT` decision flag on the shipment, plus a
   `surveyedStorageCostDeliveryOut` recognizing **delivery-out as its own chargeable
   leg**. Adopt all three ideas.
4. **Both parties keep their own shipment key, and it is Required.**
   `supplierShipmentId` is defined as the supplier's id from *their* system
   (`odt:378`) and is one of only nine required fields in the document. The
   correlation is a first-class contract term, not an afterthought — the right
   instinct for A9.
5. **Attempt vs contact.** `initialContactDate` ("first **attempt**") vs
   `contactMadeDate` ("contact **has been made**") (`odt:1362-1366`). A tried-and-
   failed interaction is a real, separately dated fact. Generalize it: our model should
   be able to record an attempted event distinctly from an achieved one.
6. **Actor-bearing outcome codes.** The Auto/Pet enum's `Cancelled by Supplier` /
   `Cancelled by Customer` / `Reschedule Requested by Customer` / `… by Supplier`
   (`odt:2985`) is the one place the source encodes *who caused it*. **Take the idea
   and fix the shape**: make actor a dimension (`cancelled` + `causedBy: customer`),
   not a string multiplied out into the status enum.
7. **The transport lesson, stated negatively.** Accept and Update share a URL and are
   distinguished by an empty array (`odt:322`), every update overwrites the whole
   document, and there is no version token. Our catalog should publish **events with
   identity and ordering**, so a partner integration is a projection of an event
   stream rather than a last-write-wins document — and so a correction is a first-class
   thing rather than another POST.
8. **Roll-up sanity.** `notIncludedComments` — "costs **not included or allowable for
   invoicing**" (`odt:579`) — is a small idea worth keeping: a cost estimate needs a
   place to say what it excludes, or the exclusion is invisible.

## Weaknesses / traps

1. **Date-only, time-zone-free, everywhere.** Every timestamp in the document is
   `YYYY-MM-DD` with no time and no zone. Copying this into the core model would make
   "arrived 11pm Tuesday" and "arrived 1am Wednesday" the same fact and would make
   any ETA or dwell-time question unanswerable. It is also an active hazard on our
   side: the mapping must truncate wall-clock fields **without** converting zones, or
   a `Z`-suffixed evening timestamp rolls the day forward
   (`integrations/weichert/README.md:75-76`).
2. **Status strings with no transitions, so "status" silently means two different
   things.** Because the source defines no transitions, `serviceStatus` can be read as
   either *the order's current state* or *a transition the supplier is asserting*. We
   already paid for this ambiguity: an early rule enforcing "a supplier may not set
   Requested/Awarded/Cancelled/Declined" rejected orders that merely **sat** in one of
   those statuses, and was removed in GLOBAL v2 (`integrations/weichert/README.md:220-226`).
   The core model must separate **state** from **asserted transition** explicitly.
3. **Milestones are fields, not events.** Three numbered slots per milestone
   (`packDate1/2/3`) is a ceiling and a positional encoding with no stated meaning for
   slot 2 or 3. Do not model repetition as ordinals.
4. **No provenance and no correction path.** Nothing says who asserted a fact; a
   re-POST is indistinguishable from a correction; there is no version or sequence, so
   a stale payload overwrites a fresh one silently. Following this source on A4/A6/A7
   would bake in exactly the property that makes an event catalog worth building.
5. **Free-text parties.** 255-character agent *names* with no id (`odt:390-404`) —
   "Test", "Armstrong", "Atlas Van Lines" in the vendor's own examples. Never let a
   role assignment in our model be a display string.
6. **The document contradicts itself, so do not treat any enum here as closed.**
   `"serviceStatus": "Authorized"` in three inbound examples (`odt:257, 1277, 2533`)
   against an inbound enum of `Requested | Awarded | Cancelled`; `"shipmentStatus":
   "In Progress"` in an example (`odt:1710`) against an enum spelling it `In Process`
   (`odt:1439`); `orderStatus` documented with 18 values on one endpoint and 6 on the
   next (`odt:2985` vs `odt:3013`); LTS descriptions copy-pasted wrong
   (`agentShipmentID` "Address for the storage location", `odt:1020`;
   `customerDeclaredValue` "Actual CWT", `odt:1029`); `serviceOrderNumber` vs
   `serviceOrderName` for the same field across lanes (`odt:72` vs `odt:696`);
   `relocationCounselorPhone`/`Email` typed `date` (`odt:807-811`). **Treat this
   source as descriptive of live payload shapes, not as a normative contract.**
7. **Provenance of our own `sourceRef`s — a real integrity problem.** Six rules in
   `integrations/weichert/rules.json` carry `sourceRef` strings beginning **"Weichert
   API:"** and quoting sentences such as *"Supplier Contact, Contact Made Date, Survey
   Date (actual), and Estimated Total Cost are required to submit this estimate"*
   (`rules.json:21`) and *"Pack Date 1 Actual and Load Date 1 Actual are required on at
   least one related Shipment Order before Service Status can become In Progress"*
   (`rules.json:97`). **None of that text, and no rule of that kind, appears anywhere
   in `weichert-api.odt`.** Verified by grep across the full extraction: no occurrence
   of "required to submit", "Pack Date 1", "Estimated Total Cost", or any
   status-transition precondition. The three `pre-in-progress-forbids-*` rules
   correctly label themselves "Pegasus data-quality rule (not in weichert-api.odt)"
   (`rules.json:138`); the others do not. Those quotes most plausibly come from
   **Supplier Portal UI validation messages** (they read like on-screen errors), which
   is a legitimate source — but it is a *different* source from this document and must
   be registered and cited as one. Until then, six rules cite evidence we do not hold.
8. **`Completed` is not a Weichert service status.** `delivered-requires-load-delivery-actuals`
   matches `serviceStatus in ["Delivered", "Completed"]` (`rules.json:118-124`) and its
   message says "Delivered or Completed". `Completed` appears only in the **shipment**
   status enum (`odt:430`); the service-status enum never contains it
   (`odt:366-367` and the six parallel statements). Either the rule is guarding a
   value that can never arrive, or `serviceStatus` is being fed a shipment-level value
   somewhere. Worth settling before the A1 model reuses the pairing.

### The packed-but-not-loaded gap — verified

**The question:** do `pre-in-progress-forbids-pack-actual` (`rules.json:133-156`) and
`in-progress-requires-load-actual` (`rules.json:92-110`) together leave **no valid
service status** for a shipment that is packed but not yet loaded — the normal
two-day move?

**Answer: yes, they do.** Evaluated `rules.json` directly over the facts
`shipmentsWithPackActual=1, shipmentsWithLoadActual=0, shipmentsWithDeliveryActual=0,
shipmentsWithLoadDeliveryActual=0` with all submit-prerequisites satisfied
(supplier contact present, contact-made and survey dates present,
`estimatedTotalCost=5000`), across every status value the vendor document mentions:

| `serviceStatus` | Verdict |
| --- | --- |
| `Requested` | INVALID — `pre-in-progress-forbids-pack-actual` |
| `Accepted` | INVALID — `pre-in-progress-forbids-pack-actual` |
| `Submitted` | INVALID — `pre-in-progress-forbids-pack-actual` |
| `Awarded` | INVALID — `pre-in-progress-forbids-pack-actual` |
| `In Progress` | INVALID — `in-progress-requires-load-actual` |
| `Delivered` | INVALID — `delivered-requires-load-delivery-actuals` |
| `Completed` | INVALID — `delivered-requires-load-delivery-actuals` |
| `Declined` | valid |
| `Cancelled` | valid |
| `Authorized` | valid (undocumented status; see trap 6) |

Every status that describes **work in progress** is rejected. The only statuses that
pass are the two terminal negatives — `Declined` and `Cancelled` — plus `Authorized`,
which is not in the documented enum at all and therefore passes only because the
`pre-in-progress-forbids-*` rules enumerate four statuses by name
(`rules.json:143-148`) rather than defining "pre-execution". **For the duration
between the pack crew finishing and the load crew starting, a real two-day move has
no representable, valid state.** The corpus already pins both halves of the trap
independently — *"In Progress with Pack Date 1 Actual only (no load) is rejected"* and
*"Accepted with Pack Date 1 Actual is rejected"* (`corpus.json`) — without either case
noticing that together they close the set.

**Does the vendor model have a status that covers it?** **No.** The service-status
enum has no packing/partially-executed value — the `Requested → Accepted → Submitted
→ Awarded → In Progress → Delivered` sequence jumps straight from award to execution
with nothing between "not started" and "in progress" (`odt:366-367`). Nor is the gap
fixable one level down: the **shipment** status enum — `Under Review, In Process, In
Storage, Delivered, Completed, Cancelled` (`odt:429-430`) — has no packed state
either, and `shipmentStatus` is not what these rules test.

**The vendor document does not create this conflict; our rules do.** The vendor
states no precondition on `In Progress` whatsoever (see *Vendor-stated rules* — the
complete list is seven items and none is a transition rule). Read against the
document we actually hold, `serviceStatus: "In Progress"` with a pack actual and no
load actual is **a perfectly legal payload**; `in-progress-requires-load-actual` is a
Pegasus-side invariant whose `sourceRef` attributes it to Weichert (trap 7). So the
gap is ours to close, and the cheapest closure is to let `In Progress` mean *"work
has begun"* — satisfied by a pack **or** a load actual — rather than *"loading has
begun"*. That is also the reading the vendor's own vocabulary supports.

**For the reference model, the durable lesson is the one that outlives the fix:**
`packed` is a state a shipment genuinely occupies for a day or more, and an order
lifecycle that derives execution state from *loading* alone cannot express it. Our A1
lifecycle needs an execution phase that begins at the **first** performed service
(pack, or load on a shipper-packed move), and our A4 model needs pack-complete to be
an event in its own right rather than a precondition inferred from a date field.

## Out-of-v1 material

**A10 — Survey, estimating & inventory**
- Survey dates are modeled twice and inconsistently: an order-level `surveyDate`
  (scalar, "Scheduled survey date", `odt:344`) on domestic HHG; `surveyDateScheduled`
  + `surveyDateActual` as two scalars on international and bid (`odt:1368-1372`); and a
  `shipments.surveyDate.{estimated, actual}` object on domestic shipments
  (`odt:432-439`). Three shapes for one concept in one document.
- **`quoteType`: "Booked Move or Competitive Move"** (`odt:177`) — whether the supplier
  already holds the business or is bidding for it. Drives the whole bid lane.
- **The `allowance` basis** (`odt:1561-1679`, `odt:2189-2286`): the client's policy
  entitlement, carried alongside surveyed and actual on every international measure
  and cost, with `allowanceOrSurveyedAmountsUsed` (`odt:1271`) recording which one was
  approved. A corporate-relocation concept absent from carrier-side sources.
- The **International Bid** lane (`odt:1821-2373`) is a complete competitive-estimate
  model: `bidID`, its own status enum, `bidDetails[]` keyed by
  `supplierBidDetailId` (Required), per-bid routing, container, measures and costs on
  a surveyed/allowance basis, and `serviceOrder.serviceOrderNumber` appearing when the
  bid is won.
- **Inventory is entirely absent.** No item, no room, no condition, no high-value
  listing — only `customerHighValuedInventoryAmount`, a single money total
  (`odt:1032`).
- Needs-assessment fields double as a crude survey input: `homeType` (Apartment/House),
  `squareFootage`, `numberOfBedrooms` (1-5 as *strings* domestically, a number
  internationally — `odt:162-164` vs `odt:1172-1173`), `householdSize`
  (Single/Family), `totalFamilySize`, `domicileType` (Home Owner/Renter/Unknown),
  `maritalStatus` (whose enum lists "Single" **twice** — `odt:226`).

**A11 — Claims & valuation**
- `insuranceType` — "Client insurance type for this service order, for example Self
  Insured" (`odt:105`); live examples carry `"UNIRISC"` (`odt:267`), a third-party
  valuation administrator. Declared max length differs by lane (200 vs 30 chars,
  `odt:106` vs `odt:772`).
- `customerDeclaredValue` and `customerHighValuedInventoryAmount` on LTS
  (`odt:1029-1033`), plus `surveyedInsuranceCosts` / `actualInsuranceCosts`
  (`odt:999-1003`).
- **No claims lifecycle, no loss/damage record, no released-vs-full-value concept.**

**A12 — Rating & tariffs**
- **No tariff reference anywhere** — no 400N/400NG, no rate table, no accessorial
  catalog. Pricing enters as *discount percentages* off an unnamed basis:
  `supplierHHGDiscount`, `supplierSITDiscount`, `clientHHGDiscount`,
  `clientSITDiscount` (`odt:93-103`) — the classic van-line discount-off-tariff
  structure, with the tariff itself left implicit.
- `cwt` / `monthlyStorageCWT` / `warehouseHandlingCWT` (`odt:1023-1027`, `odt:1645`)
  — hundredweight rating units, never defined.
- `currencyIsoCode` "ISO 4217" (`odt:174`) with no FX rate or date, on a document
  whose money fields are all plain decimals.
- Auto pricing is fully itemized and is the one place a rate card shows through:
  base charge, oversize charge, surcharge, storage fee, inoperable fee, special
  request fee, delivery distance (`odt:3045-3063`), driven by
  `vehicleOneOversizeClass` Class 1 – Class 8 (`odt:2881`).

**A13 — Crew, driver & settlement**
- **No crew, no driver, no scheduling, no settlement.**
- The only revenue-split artifacts are `internationalHHGCommission` and
  `petCommission` — bare percentages (`odt:1112`, `odt:3340`) — and the
  supplier-vs-client discount pair, which together imply the RMC's margin without
  modeling it.

**Other (out of the rubric's areas)**
- **Auto Shipment** (`odt:2773-3288`) is a complete vehicle-transport model: per-vehicle
  year/make/model/type/color/VIN, inoperable flag, oversize class, its own pickup and
  delivery **date ranges**, and its own SIT in/out pair per vehicle. Capped at
  **two** vehicles by field naming (`vehicleOne*` / `vehicleTwo*`) — the same
  ordinal-instead-of-collection antipattern as `packDate1/2/3`.
- **Pet Shipment** (`odt:3289-3551`) likewise: per-pet name/breed/age/sex/weight/
  length/height with explicit unit selectors (`petWeightUnit` Lbs|Kg,
  `petLengthHeightUnit` Inches|Centimeters, `odt:3385-3389`) — **the only place in the
  document where any measure carries an explicit unit.** Capped at two pets.
- Both lanes attach a `needsAssessment` array (`odt:2908`, `odt:3343`) carrying
  origination/destination-residence/destination-**work** addresses — the only
  three-address structure in the source.

## Open questions

1. **Where did our six "Weichert API:" rule quotes actually come from?** They are not
   in `weichert-api.odt` (trap 7). If they are Supplier Portal UI validation messages,
   that portal needs a registry entry of its own — it is evidently a **stricter**
   contract than the API guide, and it is the one our rules encode. *(User / whoever
   authored GLOBAL v1.)*
2. **Is there a newer or fuller Weichert artifact?** The guide has no version number,
   no date, and no changelog. Examples are stamped 2024-2025 (`odt:35`, `odt:287`). Is
   there a RAML/OpenAPI from the Mulesoft layer, or a portal field guide? *(User.)*
3. **What is `In Progress` supposed to mean to Weichert** — work begun, or loading
   begun? The answer decides whether the packed-but-not-loaded gap is closed by
   relaxing `in-progress-requires-load-actual` or by narrowing the
   `pre-in-progress-forbids-*` status list to `Requested`/`Awarded` (the fallback the
   README already anticipates, `integrations/weichert/README.md:251-260`). *(User /
   Weichert.)*
4. **Is `Authorized` a real live `serviceStatus`?** It appears in three vendor inbound
   examples and no enum (`odt:257, 1277, 2533`). If real, our `pre-in-progress-forbids-*`
   status list has a hole. *(Check against captured live payloads.)*
5. **Does pegII hold SIT dates, `directOrSIT`, and a storage agent?** A5 is this
   source's strongest area and our mapping touches none of it. *(pegII schema /
   another source.)*
6. **What legend translates Atlas's `Survey.ShipmentStatus` code into Weichert's
   `Under Review | In Process | In Storage | Delivered | Completed | Cancelled`?**
   Currently unmapped (`integrations/weichert/README.md:106-110`), which means the
   shipment-level lifecycle is dark on both sides. *(Atlas / van-line source.)*
7. **What do `packDate2/3`, `loadDate2/3`, `deliveryDate2/3` mean** — a second service
   day, a second crew, or a second address? The answer determines whether they are
   evidence of multi-stop structure (A3) or of multi-day activity (A4). The document
   says only "Second"/"Third" (`odt:450-466`). *(Weichert / another RMC source.)*
8. **What does the `-N` suffix on `moveNumber` (`M-C-28608-6`) count?** Several service
   orders share a move stem across the examples (`odt:270, 845, 2028`), which looks
   like the RMC's own order-within-move sequence — the nearest thing this source has to
   an order/shipment hierarchy above the service order. *(Weichert.)*
9. **Are the Auto/Pet actor-bearing statuses** (`Cancelled by Supplier` vs
   `… by Customer`) **available on the HHG lanes in the portal**, or genuinely
   Auto/Pet-only? If a supplier can express *who cancelled* anywhere, that is a reason
   code we should model. *(Weichert / portal.)*
