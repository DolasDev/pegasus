---
source: src:milmove-mymove
analyzed: 2026-09-17
evidence_grade: A
material: |
  All paths below are relative to sources/milmove-mymove/captured/.
  Read in full:
    pkg/services/event/event.go, notification.go, endpoint.go
    pkg/services/event/ghc_endpoint.go (const block only)
    pkg/models/mto_shipments.go, mto_service_items.go, re_service.go, reweigh.go,
      sit_duration_update.go, shipment_address_updates.go, mto_agents.go,
      payment_request.go, webhook_notification.go, webhook_subscription.go,
      audit_history.go, proof_of_service_doc.go, service_request_document.go,
      evaluation_report.go (lines 1-90)
    pkg/models/move.go (lines 1-400), order.go (lines 1-120), ppm_shipment.go (lines 1-90),
      weight_ticket.go (lines 1-70), pptas_report.go (lines 1-90)
    pkg/edi/invoice/generator.go (lines 1-120), pkg/edi/segment/n9.go, g62.go
    swagger-def/definitions/: MTOShipment.yaml, MTOShipmentType.yaml, MTOShipmentStatus.yaml,
      SITStatus.yaml, SITSummary.yaml, SITLocationType.yaml, StorageFacility.yaml,
      Reweigh.yaml, ShipmentAddressUpdate.yaml, ServiceItemParamName.yaml,
      ServiceItemParamOrigin.yaml, MTOServiceItem.yaml (head)
    swagger-def/definitions/prime/: MoveTaskOrder.yaml, PaymentRequest.yaml,
      MTOServiceItemModelType.yaml, MTOServiceItemDestSIT.yaml
    swagger/api.yaml
  Read in part (targeted sections / greps):
    swagger/prime.yaml (operation list + descriptions of listMoves, getMoveTaskOrder,
      createExcessWeightRecord, updateShipmentDestinationAddress, createMTOAgent,
      updateReweigh, createSITExtension, updateMTOShipmentStatus, createMTOServiceItem,
      updateMTOServiceItem)
    swagger-def/prime.yaml (payment-request param docs, lines 965-1000),
      swagger-def/prime_v3.yaml (lines 55-130)
    swagger/ghc.yaml (diversion + SIT-extension definitions, requestShipmentDiversion)
    pkg/models/: ghc_entitlements.go, pws_violation.go, gsr_appeals.go, re_*.go (type names only)
  Not read - see "What we could not read".
---

# MilMove (`transcom/mymove`) - analysis

## What it is

MilMove is the US government's replacement for DPS, the system that runs household-goods
moves for military service members under the **GHC** (Global Household Goods Contract).
Published by USTRANSCOM with TrussWorks; the captured artifact is a source snapshot
(commit `c4868770`, 2024-10-18) pulled from the Go module proxy - `LICENSE.txt` in the
capture is the MIT/public-domain grant. **S1 kind:** `internal-system` in origin but it
functions for us as a *reference-model* - it is a complete, open, running HHG data model
with a published partner API. **S2 adoption:** 3 within its niche (it is *the* system for
all US military domestic HHG moves and the contract obliges one very large mover to
integrate with it), 1 as an industry standard outside DoD. **S3 openness:** `public`.

Our reading covered the parts that carry domain meaning: the whole `pkg/services/event`
package (their event catalog and webhook machinery), ~25 of the 109 `pkg/models/*.go`
files chosen by domain relevance, the Prime-facing Swagger (`prime`, `prime_v2`,
`prime_v3`) plus the shared `swagger-def/definitions/` fragments, and the EDI 858
generator with two of its segments. Evidence grade **A**: this is the actual source and
the actual API contract, not documentation about them.

### What we could not read

- **`pkg/services/` other than `event/`** was not captured. This is where the state
  machines live (`mto_shipment/`, `move_task_order/`, `payment_request/`). So every
  claim below about *allowed transitions* rests on model-level validators, Swagger
  operation descriptions and status enums - **not** on a transition table we saw.
- **No DB migrations / schema** in the capture, so `CHECK` constraints, triggers (the
  `add_audit_history_table` triggers) and `move_history_fetcher.sql` are not visible.
- **`pkg/handlers/`** (which endpoint triggers which event) is absent; the endpoint-to-event
  binding is documented in milmove-docs, not visible in captured code.
- Frontend (`src/`) not captured - the office-user vocabulary shown to humans is inferred
  from API field names only.
- `ghc.yaml` (306 KB), `internal.yaml` (177 KB) and `admin.yaml` read by grep only, not
  end to end. `pkg/models/re_*.go` (the rate-engine tables) read as type names only.
- Sizeable parts of the *reasoning* live in Google Docs and Atlassian pages linked from
  the docs site and are gated (see src:milmove-docs).

## Model summary

The spine is four levels deep and, notably, **flat where our domain is not**:

```
Order            (the authority to move - a service member's PCS orders)
  |__ Move       (= "Move Task Order"/MTO; one table since ADR 0055)
        |__ MTOShipment        (typed: HHG, NTS, NTS-release, PPM, boat, mobile home, intl)
        |     |__ MTOAgent     (RELEASING_AGENT | RECEIVING_AGENT - people, not companies)
        |     |__ Reweigh      (0..1)
        |     |__ SITDurationUpdate  (0..n - "SIT extension" requests)
        |     |__ ShipmentAddressUpdate (0..1 - destination change request)
        |     |__ StorageFacility (0..1)
        |     |__ PPMShipment / BoatShipment / MobileHome  (child table per type, ADR 0067)
        |__ MTOServiceItem     (the unit of *ordered work*; may or may not name a shipment)
        |__ PaymentRequest
              |__ PaymentServiceItem -> PaymentServiceItemParam (priced inputs, each tagged
              |                                                  with its origin)
              |__ ProofOfServiceDoc -> PrimeUpload
```

Three concepts carry most of the model's weight:

1. **"Available to prime."** `Move.AvailableToPrimeAt` (`pkg/models/move.go:67`) is the
   single gate that turns an internal record into work a contractor may see and act on.
   Everything in the partner API is conditioned on it - `listMoves` returns "all moves
   that have been reviewed and approved by the TOO" (`swagger/prime.yaml:92-110`), and the
   notification handler drops any event whose move is not available to prime
   (`pkg/services/event/notification.go:64-78`).

2. **MTOServiceItem as the atom of billable work.** Nothing the mover does is billable
   unless a matching service item was created and approved. `MTOServiceItem` points at a
   `ReService` code out of a closed catalog of 49 codes (`pkg/models/re_service.go:19-124`)
   - `DLH` domestic linehaul, `DPK` packing, `DUPK` unpacking, `DCRT`/`DUCRT` crating and
   uncrating, `DOSHUT`/`DDSHUT` shuttle, `FSC` fuel surcharge, the 20-odd SIT codes, plus
   `MS` move management and `CS` counseling. Service items have their own three-state
   lifecycle (`SUBMITTED`/`APPROVED`/`REJECTED`, `mto_service_items.go:18-25`).

3. **The event/webhook catalog** (`pkg/services/event/event.go:37-121`) - 18 real event
   keys of the shape `Object.Action`, mapped to exactly five logical objects. See
   "Lifecycles & events".

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Order** (`orders`) | The service member's PCS orders - the external authority that entitles the move. Carries `issue_date`, `report_by_date`, `orders_number`, TAC/SAC, entitlement. Not a customer's order for service. | A1 | `pkg/models/order.go:65-104` |
| **Move / MoveTaskOrder (MTO)** | "An object representing a move task order which falls under an 'Order' assigned to a service member." One row; the two names are the same table since ADR 0055. | A1 | `pkg/models/move.go:53-104` |
| **Prime** | The single contractor who executes the move. `contractors` row with `type='Prime'`. Also the name of the partner API. | A8 | `pkg/models/move.go:277-280`, `pkg/services/event/endpoint.go:16` |
| **availableToPrimeAt** | Timestamp "that indicates when the move is available for the Prime to handle." Presence, not a status value, is the gate. | A1 | ADR 0055; `pkg/models/move.go:67` |
| **MTOShipment** | "An object representing data for a move task order shipment." One origin, one destination, one type. | A2 | `pkg/models/mto_shipments.go:102-172` |
| **shipmentType** | Closed enum: `HHG`, `HHG_INTO_NTS_DOMESTIC` (display "NTS"), `HHG_OUTOF_NTS_DOMESTIC` ("NTS Release"), `INTERNATIONAL_HHG`, `INTERNATIONAL_UB`, `PPM`, `BOAT_HAUL_AWAY`, `BOAT_TOW_AWAY`, `MOBILE_HOME`. | A2 | `swagger-def/definitions/MTOShipmentType.yaml` |
| **marketCode** | `d` domestic / `i` international - a one-character discriminator that steers pricing. | A2/A12 | `pkg/models/mto_shipments.go:29-32` |
| **MTOAgent** | A *person* at one end of the shipment: `RELEASING_AGENT` (hands goods over at origin) or `RECEIVING_AGENT` (accepts at destination). Name + at least one of email/phone. **Not** a van-line agent company. | A8 | `pkg/models/mto_agents.go:16-19`, `swagger/prime.yaml:551-600` |
| **MTOServiceItem** | A unit of ordered, approvable, billable work against a move (and usually a shipment). | A2/A7 | `pkg/models/mto_service_items.go:27-70` |
| **ReService / reServiceCode** | The catalog entry a service item instantiates; 49 codes. | A7/A12 | `pkg/models/re_service.go:19-124` |
| **Reweigh** | "A reweigh is the second recorded weight for a shipment, as validated by certified weight tickets. Applies to one shipment... A reweigh can be triggered automatically, or requested by the customer or transportation office. Not all shipments are reweighed." | A2/A6 | `swagger/prime.yaml:668-676`; `pkg/models/reweigh.go:35-47` |
| **requestedBy** (reweigh) | `CUSTOMER` / `PRIME` / `SYSTEM` / `TOO` - who caused the reweigh. | A4/A7 | `pkg/models/reweigh.go:17-26` |
| **verificationProvidedAt / verificationReason** | The mover's recorded justification for *not* producing a reweigh weight. | A6/A7 | `pkg/models/reweigh.go:42-43` |
| **Diversion** | A shipment rerouted mid-stream. Modelled as a *new shipment* linked by `divertedFromShipmentId` to its parent, forming a "diverted shipment chain"; "diverted shipments are all one single shipment, but going to different locations." | A3 | `swagger-def/prime.yaml:977-979`; `pkg/models/mto_shipments.go:147-149` |
| **SIT (storage in transit)** | Storage at origin or destination while the shipment is in the carrier's custody, paid per day against a day allowance. | A5 | `swagger/prime.yaml:722-735` |
| **sitDaysAllowance** | Total days of SIT the customer may use; "includes time spent in both origin and destination SIT." Default 90. | A5 | `swagger/prime.yaml:731-735`; `pkg/models/mto_shipments.go:58-61` |
| **SITDurationUpdate** (formerly *SITExtension*) | A mover request to increase the day allowance. `PENDING`/`APPROVED`/`DENIED`, with `requestedDays` vs `approvedDays`, `contractorRemarks` vs `officeRemarks`, `decisionDate`. | A5 | `pkg/models/sit_duration_update.go:32-64` |
| **SIT location** | `ORIGIN` or `DESTINATION`. | A5 | `swagger-def/definitions/SITLocationType.yaml` |
| **SITServiceItemGrouping / SITSummary** | A "sub-grouping" of the SIT service items for one *instance* of SIT - i.e. one stay - with `daysInSIT`, entry, departure and authorized-end dates. Groups "by the date they went into SIT". | A5 | `pkg/models/re_service.go:136-158`; `swagger-def/definitions/SITStatus.yaml` |
| **customerExpense / convertToCustomerExpense** | A SIT service item reclassified so the customer, not the government, pays it - with `customerExpenseReason`. | A5/A7 | `pkg/models/mto_service_items.go:64-65` |
| **StorageFacility** | Warehouse for an NTS/NTS-R shipment: `facilityName`, address, `lotNumber`, phone, email. | A5/A8 | `swagger-def/definitions/StorageFacility.yaml` |
| **ShipmentAddressUpdate** | A destination-address change *request* raised by the mover after the address was approved; auto-approved unless it crosses a pricing boundary (service area, mileage bracket, >50 mi, shorthaul/linehaul flip). | A2/A7 | `swagger/prime.yaml:477-520`; `pkg/models/shipment_address_updates.go:30-49` |
| **PaymentRequest** | The mover's claim for payment covering "a subset of MTO Service Items from a Move." `isFinal` closes the task order. | A7 | `pkg/models/payment_request.go:65-90` |
| **PaymentServiceItemParam / origin** | Each priced input on a service item, tagged `PRIME` / `SYSTEM` / `PRICER` / `PAYMENT_REQUEST` - i.e. *who asserted this number*. | A7 | `swagger-def/definitions/ServiceItemParamOrigin.yaml`, `ServiceItemParamName.yaml` |
| **ProofOfServiceDoc** | Document package backing a payment request; `isWeightTicket` flags the ones that are weight tickets. | A6 | `pkg/models/proof_of_service_doc.go:12-23` |
| **ServiceRequestDocument** | Document attached to a *service item* to justify it (e.g. why crating was needed). | A6 | `pkg/models/service_request_document.go:12-22` |
| **ExcessWeightRecord** | "a document that proves that the movers or contractors have counseled the customer about their excess weight... required for auditing reasons so that we have a record of when the Prime counseled the customer." | A6 | `swagger/prime.yaml:182-200` |
| **shipmentLocator** | Human-shareable shipment id, move locator + sequence: `1K43AR-01`. | A9 | `swagger-def/definitions/MTOShipment.yaml` (`shipmentLocator`) |
| **locator** | "a 6-digit alphanumeric value that is a sharable, human-readable identifier for a move". Letters drawn from a non-word alphabet. | A9 | `pkg/models/move.go:47-51`; ADR 0055 |
| **referenceId** | MTO identifier in `dddd-dddd` form; "serves currently as the prefix for payment request numbers". | A9 | `pkg/models/move.go:75`, `:352-370` |
| **serviceOrderNumber** | Free string on the shipment - the *mover's own* order number. | A9 | `pkg/models/mto_shipments.go:158` |
| **usesExternalVendor** | This shipment is handled by someone other than the Prime; suppresses notifications to the Prime. | A8 | `pkg/models/mto_shipments.go:155`; `notification.go:93-96` |
| **eTag** | Base64 of `updated_at`, sent as `If-Match`; mismatch -> `412 Precondition Failed`. | A9/C8 | `swagger/prime.yaml:497-503` |
| **TOO / TIO / SC / QAE / GSR** | Task Ordering Officer (orders shipments and service items), Transportation Invoicing Officer (reviews payment), Services Counselor, Quality Assurance Evaluator, Government Surveillance Representative. | A8 | `pkg/models/move.go:96-103`; `pkg/models/gsr_appeals.go` |

## Lifecycles & events

### Move

`DRAFT` -> `SUBMITTED` or `NEEDS SERVICE COUNSELING` -> `SERVICE COUNSELING COMPLETED` ->
`APPROVED` <-> `APPROVALS REQUESTED` -> (`CANCELED` at any point)
(`pkg/models/move.go:26-45`). Each state change has a matching *timestamp* column rather
than relying on the status alone: `submitted_at`, `service_counseling_completed_at`,
`prime_counseling_completed_at`, `approved_at`, `approvals_requested_at`,
`available_to_prime_at`, `billable_weights_reviewed_at`, `excess_weight_qualified_at`,
`excess_weight_acknowledged_at` (`move.go:59-89`). Note `APPROVALS REQUESTED` is a
*return* state: an approved move that has grown something needing a decision goes back to
the office queue without losing its approval.

### MTOShipment

`DRAFT` -> `SUBMITTED` -> `APPROVED` or `REJECTED` (with mandatory `rejectionReason`,
enforced in `mto_shipments.go:206-212`), plus two "the office has asked the mover to do
something" states: `DIVERSION_REQUESTED` and `CANCELLATION_REQUESTED`, and the terminal
`CANCELED`. Crucially the **request** and the **act** are different actors: the TOO sets
`CANCELLATION_REQUESTED`, and only the mover can then move it to `CANCELED` - "Currently,
the Prime cannot update the shipment to any other status"
(`swagger/prime.yaml:785-790`). Same split for diversion: `Ghc.RequestShipmentDiversion`
then `Ghc.ApproveShipmentDiversion` (`pkg/services/event/ghc_endpoint.go:46-50`).

### MTOServiceItem

`SUBMITTED` -> `APPROVED` or `REJECTED`, with `approvedAt` / `rejectedAt` and
`rejectionReason` (`mto_service_items.go:18-25`, `:61-63`). A rejected SIT service item
can be **resubmitted** - the mover PATCHes with `requestedApprovalsRequestedStatus: true`
and an `updateReason` that "must have a different value than the current `reason` value...
If this value is not updated, then an error will be sent back"
(`swagger/prime.yaml:1076-1128`). That is an explicit *correction* protocol with an
anti-no-op guard.

### SIT duration update

`PENDING` -> `APPROVED` or `DENIED`, `requestedDays` vs `approvedDays`, `decisionDate`
(`sit_duration_update.go:32-64`). Reason codes are a closed picklist of seven:
`SERIOUS_ILLNESS_MEMBER`, `SERIOUS_ILLNESS_DEPENDENT`, `IMPENDING_ASSIGNEMENT` [sic],
`DIRECTED_TEMPORARY_DUTY`, `NONAVAILABILITY_OF_CIVILIAN_HOUSING`,
`AWAITING_COMPLETION_OF_RESIDENCE`, `OTHER` (`sit_duration_update.go:15-30`).

### ShipmentAddressUpdate

`REQUESTED` -> `APPROVED` or `REJECTED`, `contractorRemarks` required on the request,
`officeRemarks` optional on the decision - "The TOO comment on approval or rejection"
(`swagger-def/definitions/ShipmentAddressUpdate.yaml`). The auto-approve rule is stated
as business logic in the endpoint description, not encoded in the model.

### PaymentRequest

`PENDING` -> `REVIEWED` or `REVIEWED_AND_ALL_SERVICE_ITEMS_REJECTED` -> `SENT_TO_GEX` ->
`TPPS_RECEIVED` -> `PAID`, with `EDI_ERROR` and `DEPRECATED` as off-ramps
(`pkg/models/payment_request.go:20-37`). Paired timestamps again: `requested_at`,
`reviewed_at`, `sent_to_gex_at`, `received_by_gex_at`, `paid_at`. Corrections are
**supersession, not edit**: `recalculation_of_payment_request_id` points a new request at
the one it replaces, and the replaced one goes `DEPRECATED` (`payment_request.go:81`,
`:36`).

### The event catalog (the part most relevant to us)

`pkg/services/event/event.go:37-121` defines 18 non-test keys, all `Object.Action`:

```
Order.Update
MoveTaskOrder.Create        MoveTaskOrder.Update
MTOShipment.Create          MTOShipment.Update
Shipment.Delete             Shipment.Approve            Shipment.Reject
Shipment.RequestDiversion   Shipment.ApproveDiversion
Shipment.RequestCancellation
Shipment.RequestReweigh
Shipment.ApproveSITExtension  Shipment.DenySITExtension
MTOServiceItem.Create       MTOServiceItem.Update
PaymentRequest.Create       PaymentRequest.Update
```

Design facts worth lifting verbatim:

- **The key names an aggregate, not a table.** Five "logical objects" only - Move, Orders,
  MTOShipment, MTOServiceItem, PaymentRequest - chosen because "we do not want to send the
  whole MTO on each event, nor do we want to send a single address record"; an address
  change under a shipment publishes `MTOShipment.Update` (milmove-docs
  `api/docs/push-notifications-to-prime.md:88-104`). The `UpdatedObjectID` on the event is
  the *aggregate root's* id, never the changed row's.
- **Key shape is validated**: `Subject.Action`, regex `\w+\.\w+`
  (`pkg/models/webhook_notification.go:68`), and unknown keys are rejected at trigger time
  (`event.go:180-184`).
- **Every event carries the causing endpoint** (`EndpointKey`, e.g.
  `Ghc.ApproveShipmentDiversion`) and a `TraceID` from the request (`event.go:28-35`).
- **Echo suppression is a first-class rule.** If the endpoint that caused the change
  belongs to the Prime API, no notification is generated - `isSourcePrime`
  (`notification.go:17-28`, `:236-240`). Two more suppressions: move not available to
  prime, and `shipment.UsesExternalVendor` (`notification.go:93-96`).
- **Store-then-send.** The handler writes a `webhook_notifications` row with the rendered
  payload and status `PENDING`; a separate `webhook-client` process delivers it
  (`notification.go:30-58`; docs `push-notifications-to-prime.md:131-138`). Notification
  status: `PENDING`/`SENT`/`SKIPPED`/`FAILING`/`FAILED` - with `FAILING` explicitly
  meaning "has failed at least once but we are still retrying"
  (`webhook_notification.go:19-31`).
- **Subscriptions are per subscriber x event key**, with `callback_url`, a `severity`
  ("Zero indicates no severity value, 1 is highest") and status
  `ACTIVE`/`DISABLED`/`FAILING` (`webhook_subscription.go:12-37`).
- **A trigger failure never fails the business action** - handlers log and continue
  (`event.go:199-212` collects errors per handler so "one registered handler failure" does
  not affect another).

### EDI as the downstream event stream

Payment leaves the system as an **EDI 858** shipment-information invoice
(`pkg/edi/invoice/generator.go:25-82`); acknowledgement comes back as **997** and errors
as **824** (`pkg/edi/edi997/`, `pkg/edi/edi824/`, and `EdiErrors` hanging off the payment
request, `payment_request.go:87`).

## Time, identity, evidence

### Time

The shipment carries **seven** date fields that are all different assertions about the
same two events (`pkg/models/mto_shipments.go:107-115`):

| Field | Meaning | Asserted by |
| --- | --- | --- |
| `requestedPickupDate` / `requestedDeliveryDate` | what the customer asked for | customer |
| `scheduledPickupDate` / `scheduledDeliveryDate` | what the mover committed to | mover |
| `actualPickupDate` / `actualDeliveryDate` | "The actual date that the shipment was delivered to the destination address by the Prime" | mover |
| `requiredDeliveryDate` | contractual deadline derived from transit times | system |
| `firstAvailableDeliveryDate` | earliest the mover can deliver | mover |
| `approvedDate` | when the office approved it | office |

**Date vs timestamp is a deliberate, documented distinction** (ADR 0043, analysed under
src:milmove-docs) and is visible in the schema: all six requested/scheduled/actual fields
are `format: date`, while `approvedDate`, `createdAt`, `updatedAt` are `format: date-time`
(`swagger-def/definitions/MTOShipment.yaml`). There is **no time zone** anywhere on a
shipment or a stop; ADR 0043 resolves date/timestamp comparisons by interpreting every
date in *Pacific* time. Sub-day precision does exist in exactly one place, and it is an
EDI-flavoured string: SIT contact attempts use `timeMilitary1`/`timeMilitary2` with
pattern `\d{4}Z`, e.g. `1400Z`
(`swagger-def/definitions/prime/MTOServiceItemDestSIT.yaml`).

Windows appear only in the QA model: `observedPickupSpreadStartDate` /
`observedPickupSpreadEndDate` (`pkg/models/evaluation_report.go:57-58`).

### Identity & cross-references

Six identifier kinds coexist, each with a stated audience:

- `id` - UUID, machine.
- `locator` - 6 chars from a deliberately non-word alphabet `346789BCDFGHJKMPQRTVWXY`, so
  generated codes cannot spell words; human/telephone (`move.go:47-51`). Safety moves get
  a reserved `SM%04d` prefix (`move.go:250-261`) - an id *class* encoded in the id.
- `referenceId` - `dddd-dddd`, uniqueness-checked on generation, retried up to 10x
  (`move.go:352-393`); prefix of payment-request numbers.
- `shipmentLocator` - `<locator>-NN`, derived, read-only.
- `paymentRequestNumber` - `1234-5678-1` = referenceId + `sequenceNumber`
  (`swagger-def/definitions/prime/PaymentRequest.yaml`, `payment_request.go:72-73`).
- `serviceOrderNumber` - the *counterparty's* identifier carried on our record
  (`mto_shipments.go:158`).

Cross-party references in EDI are explicit and typed: the `N9` segment's
`ReferenceIdentificationQualifier` is constrained to
`DY CN CT PQ OQ 1W ML 3L PO CMN 4A` (`pkg/edi/segment/n9.go:10-13`), and the 858 header
names which qualifier carries what - `PaymentRequestNumber`, `ContractCode`,
`ServiceMemberName`, `OrderPayGrade`, `ServiceMemberBranch`, `ServiceMemberID`, `MoveCode`
(`pkg/edi/invoice/generator.go:38-61`). Dates in EDI are likewise qualified rather than
named: `G62` carries a `DateQualifier` of `10`/`76`/`86` (requested / scheduled / actual
pickup) and an optional `TimeQualifier` of `5`/`8` (`pkg/edi/segment/g62.go:8-15`) -
**the same value shape reused with a qualifier saying which assertion it is.**

Carrier identity: `SCAC` exists but only at the edges - on the legacy `TSP` definition
(`swagger/api.yaml`, `format: '^[A-Z]{2,4}$'`) and on the PPTAS report
(`pkg/models/pptas_report.go:34`). It is *not* on a shipment, because there is only ever
one carrier.

### Evidence, provenance, corrections

Five distinct mechanisms, and they are worth separating because we will need all of them:

1. **Who asserted a number.** `PaymentServiceItemParam.origin` in
   `{PRIME, SYSTEM, PRICER, PAYMENT_REQUEST}` - per-field provenance on every pricing
   input (`swagger-def/definitions/ServiceItemParamOrigin.yaml`). `Reweigh.requestedBy` in
   `{CUSTOMER, PRIME, SYSTEM, TOO}` does the same for an action
   (`pkg/models/reweigh.go:17-26`).
2. **Claimed vs adjudicated value, kept side by side.** `WeightTicket` stores
   `SubmittedEmptyWeight` *and* `EmptyWeight`, `SubmittedFullWeight` *and* `FullWeight`,
   `SubmittedOwnsTrailer` *and* `OwnsTrailer`, plus `AdjustedNetWeight` with
   `NetWeightRemarks` (`pkg/models/weight_ticket.go:17-46`). The original assertion is
   never overwritten by the review.
3. **Absence of evidence is modelled.** `MissingEmptyWeightTicket` /
   `MissingFullWeightTicket` booleans; `Reweigh.verificationProvidedAt` +
   `verificationReason` records *why no weight exists*.
4. **Row-level audit trail with actor.** `audit_history` captures schema, table, object
   id, `action` (`I`/`D`/`U`/`T`), `event_name` = "API endpoint name that was called to
   make the change", `old_data` and `changed_data` as JSON, the session user's id, name,
   email and telephone, the transaction id and *three* timestamps - transaction start,
   statement start, and wall clock at trigger fire
   (`pkg/models/audit_history.go:16-54`). This is a second, finer stream than the webhook
   events, populated by DB triggers rather than by handlers.
5. **Independent observation.** `EvaluationReport` records what a *government inspector*
   saw: `inspectionType` in `{DATA_REVIEW, PHYSICAL, VIRTUAL}`, `location` in
   `{ORIGIN, DESTINATION, OTHER}`, and a parallel set of `observed*` dates -
   `observedPickupDate`, `observedDeliveryDate`,
   `observedShipmentPhysicalPickupDate`, `observedShipmentDeliveryDate`
   (`pkg/models/evaluation_report.go:19-62`), validated so the physical-observation dates
   are only allowed when `inspectionType = PHYSICAL` (`:80-88`). **A third assertion class
   for the same real-world event, distinguished by who was standing there.**

Corrections: payment requests are superseded (`recalculationOfPaymentRequestID` +
`DEPRECATED`); rejected SIT service items are resubmitted with a changed reason; deletes
are soft (`DeletedAt` on shipments, agents, weight tickets) - ADR 0038 says explicitly
that soft delete exists for audit retention and "should never be reversed."

## Scores

Weights are set in phase 3; these are raw per-criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 3 | 2 | 2 | 2 | 3 | 3 | 2 | 2 | States `move.go:26-45`, `order.go:27-38`; per-state timestamps `move.go:59-89`. C3 held at 2: states and legal values are enumerated in validators, but the transition table lives in uncaptured `pkg/services/`. C4 = 2 - the lifecycle is real but its front half (orders, counseling, entitlement) is military, not commercial. |
| A2 Shipment structure | 3 | 3 | 3 | 3 | 2 | 3 | 2 | 3 | Type enum `MTOShipmentType.yaml`; status + rejection invariant `mto_shipments.go:185-212`; five weight concepts (`primeEstimatedWeight`, `primeActualWeight`, `ntsRecordedWeight`, `billableWeightCap` + justification, `calculatedBillableWeight`) `MTOShipment.yaml`; child-table-per-type `ppm_shipment`/`boat_shipment`/`mobile_home` (`mto_shipments.go:161-170`, ADR 0067) is a genuine extension point -> C8 3. |
| A3 Trip, stop & assignment | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | **Near-absent.** No trip, vehicle, driver, crew, leg or stop-sequence entity anywhere (grep over `swagger/` and `pkg/models/` for trip/leg/vehicle/driver/crew returns only PPM `vehicleDescription` and `weight_ticket.go` "trip"). Multi-stop is approximated by `secondary`/`tertiary` pickup and delivery addresses with no ordering or timing (`MTOShipment.yaml`). The one real idea is the **diversion chain** - `diversion` bool + `divertedFromShipmentId`, "diverted shipments are all one single shipment, but going to different locations" (`swagger-def/prime.yaml:977-979`). Consolidation of several shipments onto one trip: not modelled at all. |
| A4 Execution events & tracking | 1 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | C1 = 1 deliberately: the event catalog (`event.go:37-121`) is **CRUD over aggregates**, not operations - there is no arrive, depart, pack, load, unload, deliver, ETA or delay event. Execution facts are *mutable date fields* on the shipment (`actualPickupDate`, `actualDeliveryDate`), so "delivered" is inferred from a field becoming non-null. Reason codes exist only for office decisions (rejection, diversion, SIT extension), not for field exceptions. C6 = 3 for `TraceID` + `EndpointKey` + aggregate id on every event. C2 = 2 for the requested/scheduled/actual distinction being named and consistent. |
| A5 Storage-in-transit | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 2 | The strongest area in the source. Origin vs destination (`SITLocationType.yaml`); 20 SIT service codes split into four valid sets (`re_service.go:160-192`); per-stay grouping `SITServiceItemGrouping`/`SITSummary` (`re_service.go:136-158`); allowance vs used vs remaining vs calculated (`SITStatus.yaml`); entry/departure/authorized-end/customer-contacted/requested-delivery dates; extension request lifecycle with seven reason codes (`sit_duration_update.go`); `SITDeliveryMiles` and the SIT-distance recomputation when the destination changes (`ShipmentAddressUpdate.yaml`); conversion to customer expense. Warehouse modelled as `StorageFacility` with `lotNumber` - a *facility*, not a stop. |
| A6 Documents & evidence | 2 | 2 | 2 | 2 | 1 | 2 | 3 | 1 | Documents are typed by *what they prove*: `ProofOfServiceDoc.isWeightTicket`, `ServiceRequestDocument` (justifies a service item), `ExcessWeightRecord` (proves counseling happened), `SignedCertification`, amended orders + `amendedOrdersAcknowledgedAt`. C7 = 3 for submitted-vs-adjusted and missing-ticket modelling (`weight_ticket.go:17-46`). C1 held at 2: no bill of lading, no inventory/condition, no per-item photos, no POD entity - delivery is a date, not a signed artifact. |
| A7 Charges & billing hooks | 3 | 3 | 3 | 3 | 2 | 3 | 3 | 2 | Six-state payment lifecycle with timestamps (`payment_request.go:20-90`); billable work gated on an approved service item; 70 named pricing params each tagged with origin (`ServiceItemParamName.yaml`, `ServiceItemParamOrigin.yaml`); `isFinal` closes the order; supersession via recalculation; EDI 858/997/824 round trip (`pkg/edi/`, `EdiErrors`). C4 = 3: linehaul vs shorthaul, accessorials, SIT day billing with non-overlap rules (`swagger-def/prime.yaml`, DOASIT `SITPaymentRequestStart`/`End` "must not overlap previously requested SIT dates") are all HHG-native. |
| A8 Parties & roles | 2 | 2 | 1 | 1 | n/a | 2 | 2 | 1 | Customer, Contractor/Prime, StorageFacility, TransportationOffice, five office roles, and `MTOAgent` (releasing/receiving *people*). **The commercial agent network is absent** - there is one carrier, so no booking/origin/hauling/destination agent, no van line, no driver or crew, no RMC/account. `usesExternalVendor` is a boolean, not a party. C3 = 1: roles are an RBAC concern (`x-permissions` on operations) rather than modelled participation with a lifecycle. |
| A9 Identity & cross-references | 3 | 3 | n/a | 2 | n/a | 3 | 2 | 2 | Six identifier kinds, each with an explicit audience and format (see "Identity"); derived composite ids (`shipmentLocator`, `paymentRequestNumber`); counterparty id carried inline (`serviceOrderNumber`); qualifier-typed references in EDI (`n9.go:10-13`); eTag as a version token. C4 = 2 - no SCAC/BOL/PRO on the shipment itself, because the model has no carrier plurality. |

**S5 - fit to Pegasus data** (`yes` / `partial` / `no` / `unknown`; pegII = legacy
form-and-save, Cloud = in development):

| Area | pegII | Cloud | Note |
| --- | --- | --- | --- |
| A1 | partial | unknown | We have an order/service lifecycle, but nothing corresponding to the `availableToPrimeAt` gate or to an "approvals requested" return state has been confirmed in pegII. |
| A2 | partial | unknown | Shipment typing and multiple weight classes are plausible in pegII; `billableWeightCap` + justification and the child-table-per-type pattern are not known to exist. |
| A3 | unknown | unknown | This is the area MilMove *cannot* help with; whether pegII carries trip/driver/crew is the open question for our own systems, not for this source. |
| A4 | no | unknown | MilMove supplies no operational event vocabulary to map to. Whatever pegII records as arrive/load/deliver has no counterpart here. |
| A5 | partial | unknown | SIT in/out dates are likely present; day allowance, extension-with-reason and per-stay grouping are the parts to check. |
| A6 | partial | unknown | Documents exist; document-as-evidence-for-a-specific-fact, and submitted-vs-adjusted retention, probably do not. |
| A7 | partial | unknown | Charges exist; per-param provenance and supersession-instead-of-edit almost certainly do not. |
| A8 | no | unknown | MilMove's party model is *narrower* than ours - it cannot supply the agent roles we need. |
| A9 | partial | unknown | We will have our own order numbers; the question MilMove poses is whether we record the *counterparty's* id the way `serviceOrderNumber` does. |

## Strengths worth adopting

1. **Publish events per aggregate, not per table, and say so out loud.** Five logical
   objects, `<Aggregate>.<Verb>`, `UpdatedObjectID` = the aggregate root. An address change
   under a shipment is an `MTOShipment.Update`. This is exactly the granularity decision we
   have to make and they made it explicitly, with the reasoning written down.
2. **Echo suppression as a modelled rule, not a client concern.** No notification is
   emitted when the actor that caused the change is the subscriber
   (`notification.go:17-28`). Any catalog we publish to Omnitracs/Samsara/a visibility
   platform needs this or we will loop. Generalise it: every event should carry *who
   caused it* so any subscriber can suppress its own echoes, not just the one we hardcoded.
3. **Carry the causing operation and a trace id on the event.** `EndpointKey` +
   `TraceID` (`event.go:28-35`). "What changed" plus "what action changed it" plus "which
   request" is a far better debugging and provenance surface than a payload diff.
4. **Store-then-send with an explicit notification lifecycle.** `PENDING`/`SENT`/
   `SKIPPED`/`FAILING`/`FAILED`, `first_attempted_at`, delivery by a separate process, and
   a subscription that can itself be `FAILING` without being `DISABLED`
   (`webhook_notification.go`, `webhook_subscription.go`). `SKIPPED` - "we decided you did
   not need this" - is a status worth keeping.
5. **Request and act are different states with different actors.** `CANCELLATION_REQUESTED`
   -> `CANCELED`, `DIVERSION_REQUESTED` -> approve-diversion. Never collapse "the office
   asked" into "it happened."
6. **Per-field provenance on money.** `ServiceItemParamOrigin` = who supplied each pricing
   input. Adopt this for anything that can be disputed.
7. **Keep the claimed value next to the adjudicated value.** `SubmittedFullWeight` vs
   `FullWeight`, `AdjustedNetWeight` + remarks. Never overwrite an assertion with its
   review.
8. **Model the absence of evidence.** `missingFullWeightTicket`,
   `verificationProvidedAt` + `verificationReason` for a reweigh that did not happen.
9. **Supersede, don't edit.** `recalculationOfPaymentRequestID` + `DEPRECATED`.
10. **Forbid no-op corrections.** Resubmitting a rejected SIT item requires an
    `updateReason` *different from* the current reason, or the API errors.
11. **A separate row-level audit stream with the actor on it.** Domain events for
    integration, `audit_history` for "who changed what, from what, to what, in which
    transaction." Two streams, two purposes, three timestamps on the audit row.
12. **Independent observation as its own assertion class.** `observed*` dates on an
    evaluation report sit alongside the mover's `actual*` dates without contradicting the
    schema. When a visibility platform later tells us a truck arrived at 14:02 and the
    driver says 13:45, we need somewhere for both.
13. **Identifier design on purpose.** A human-shareable code from a non-word alphabet, a
    derived child code (`1K43AR-01`), a derived payment number, and a slot for the
    *counterparty's* number. Each id says who it is for.
14. **Two levels of time resolution, chosen per field.** Scheduled/requested/actual dates
    are `date`; system-recorded facts are `date-time`. (The Pacific-time rule is the
    weakness - see traps.)
15. **Per-stay SIT grouping.** `SITServiceItemGrouping` groups service items "by the date
    they went into SIT" so a shipment can have several distinct SIT stays with their own
    entry/departure/authorized-end. This is the right shape for SIT and is usually got
    wrong.
16. **Class-table inheritance for shipment subtypes** (ADR 0067): a common shipment table
    plus one child table per type, rather than a widening column set.

## Weaknesses / traps

1. **There is no trip, and no driver, vehicle or crew.** The biggest single gap.
   MilMove's model stops at the shipment because its contract makes execution the
   contractor's private business. If we copy its shape we inherit that blind spot, and A3
   is precisely where Omnitracs/Samsara data will land. **Do not let MilMove set the
   ceiling for A3.** Its diversion chain is a workaround for not having legs, and the
   giveaway is in their own words: "diverted shipments are all one single shipment, but
   going to different locations" - i.e. they had to invent a rule to re-unify what the
   model split.
2. **The event catalog is CRUD, not operations.** `MTOShipment.Update` tells a subscriber
   "something changed, refetch." It is a cache-invalidation signal, not a domain event.
   For our catalog that is the *opposite* of the goal - we want `ShipmentLoaded`,
   `ShipmentDelivered`, `SITEntered`. Adopt MilMove's *plumbing* and reject its *vocabulary*.
   (Their own internal shipment-lifecycle keys - `Shipment.Approve`,
   `Shipment.RequestDiversion` - show they felt the pressure and only escaped CRUD for
   office decisions, never for field work.)
3. **Execution facts as mutable fields means no event history.** `actualPickupDate` can be
   set, changed and changed again; nothing in the domain model records the correction. The
   only record is the `audit_history` trigger. Our model should make the *assertion* the
   record.
4. **Time zone is absent and the fallback is wrong for us.** ADR 0043 interprets every
   bare date in **Pacific** time. For a mover running Illinois-origin shipments to any
   destination, "the time zone of the stop" is a real requirement (rubric C5). Take the
   date-vs-timestamp discipline, reject the single-zone shortcut.
5. **One carrier is baked in at the root.** `Contractor` is looked up as
   `WHERE type='Prime'` (`move.go:277-280`); `usesExternalVendor` is a boolean escape
   hatch that *suppresses* the model rather than extending it; `SCAC` never reaches a
   shipment. Any agent-network concept (booking / origin / hauling / destination agent,
   interstate van line, Allied/Atlas) has to come from elsewhere.
6. **"Agent" means the wrong thing.** `MTOAgent` is the person who hands over or receives
   the goods. In our domain "agent" is a *company* in a van line's network. If we borrow
   MilMove's vocabulary we will collide with the industry's on day one. Their concept maps
   to our "releasing/receiving party" or "contact at origin/destination."
7. **"Order" means the wrong thing too.** `Order` is the service member's PCS orders - the
   *authority* to move - not the customer's order for service. Our "order for service"
   maps closer to their `Move`/MTO. Two false friends in the same model.
8. **Military concepts to strip before adopting anything**: `Order`/`OrdersType`/
   `ordersNumber`/`issueDate`/`reportByDate`; `Entitlement` (authorized weight, pro-gear,
   gun safe, dependents - `ghc_entitlements.go:16-31`); `GBLOC` and
   `postal_code_to_gbloc` (a government routing region); `dutyLocation`; `TAC`/`SAC`/
   `LineOfAccounting`/`DepartmentIndicator` (appropriation accounting, not customer
   billing); service counseling and the TOO/TIO/SC/QAE/GSR office roles; `payGrade`;
   `DestinationType` (`HOME_OF_RECORD`, `PLACE_ENTERED_ACTIVE_DUTY`, ...); `PPM`/`PPTAS`;
   `TPPS`/`GEX`/Syncada as the payment rail; `safety move` locators. Each is either a
   government funding construct or a government workflow role. Two are *nearly* general and
   worth re-deriving rather than deleting: "counseling" ~ the pre-move briefing/survey
   conversation, and "entitlement" ~ the account/RMC-authorised allowance under a corporate
   relocation policy.
9. **Statuses are validated as string inclusion, not as transitions.** Every `Validate`
   method checks the value is in a list; nothing in the model prevents `CANCELED` ->
   `APPROVED`. The rigor lives in service code we did not capture. Do not assume a status
   enum is a state machine.
10. **Reweigh is `has_one`.** `Reweigh *Reweigh has_one:"reweighs"`
    (`mto_shipments.go:154`) - a shipment can be reweighed exactly once. That is a contract
    rule, not a domain truth.
11. **SIT day allowance is per shipment and pooled across origin and destination.** A
    sensible contract rule, but it is a *policy* value living on the shipment; in a
    commercial model the allowance comes from the tariff or the account contract.
12. **`sitDaysAllowance` default 90 is a magic constant in the model**
    (`mto_shipments.go:58-61`), with a code comment admitting "Other values will likely be
    added to this once we deal with different types of customers."
13. **Event payloads are snapshots, not deltas, and are rendered at trigger time**
    (`notification.go:83-128`). If delivery is delayed, the subscriber receives a stale
    snapshot presented as current. Decide deliberately whether our events carry state or
    only identity + "refetch."
14. **No sequence number or ordering guarantee on the notification stream** that we could
    see - `webhook_notifications` has `created_at` and a `trace_id`, but nothing that lets
    a subscriber detect a gap or reorder. If our partners will replay, we need one.
15. **A typo is in the published enum**: `IMPENDING_ASSIGNEMENT`
    (`sit_duration_update.go:21`). Cheap reminder that published vocabularies are
    permanent - get the spelling right before anyone subscribes.

## Out-of-v1 material

- **A10 survey / estimating.** No survey entity at all. The nearest things are
  `primeEstimatedWeight` with `primeEstimatedWeightRecordedDate` (an estimate *with the
  moment it was asserted*, `mto_shipments.go:139-140`), `MTOServiceItem.estimatedWeight`
  vs `actualWeight`, and `pricingEstimate`/`lockedPriceCents` on a service item
  (`mto_service_items.go:67-69`) - the latter being an estimate that has been *frozen*.
  No binding / non-binding / not-to-exceed distinction, because pricing is contractual.
  Inventory: **absent** - no item, no condition, no exception codes. `MTOServiceItemDimension`
  (`crate`/`item` dimensions for crating) is the only per-object data.
- **A11 claims & valuation.** No claims model, no released-value vs full-value-protection.
  The adjacent machinery is *quality assurance*, not claims: `EvaluationReport` ->
  `ReportViolation` -> `PWSViolation` (a catalog with `paragraphNumber`, `category`,
  `subCategory`, `requirementStatement`, `isKpi` - i.e. violations indexed to contract
  paragraphs, `pws_violation.go:13-23`), `seriousIncident` + description, and `GsrAppeal`
  with its own `AppealStatus` for appealing a violation finding
  (`gsr_appeals.go:30-43`). The *shape* - observed finding -> catalogued violation ->
  appeal - is a good skeleton for a claims lifecycle even though the content is not claims.
- **A12 rating & tariffs.** A full rate-engine schema is present as ~20 `re_*` tables:
  `ReContract` + `ReContractYear` (a versioned, escalating price book), `ReRateArea`,
  `ReDomesticServiceArea`, `ReDomesticLinehaulPrice`, `ReDomesticOtherPrice`,
  `ReDomesticAccessorialPrice`, `ReIntlPrice`, `ReIntlAccessorialPrice`,
  `ReShipmentTypePrice`, `ReTaskOrderFee`, `ReZip3s`, `ReZip5RateAreas`,
  `GHCDomesticTransitTimes`, `GHCDieselFuelPrice`/`FuelEIADieselPrice`. **Read as type
  names only** - not analysed. Two ideas visible from the param list are worth noting now:
  pricing inputs are *named and enumerated* (70 `ServiceItemParamName` values) and
  escalation is a first-class param (`EscalationCompounded`, `ContractYearName`,
  `IsPeak`). This is a contract rate table, not a 400N/400NG tariff, so it will not
  substitute for src:dp3-400ng.
- **A13 crew, driver & settlement.** Nothing. No driver, no crew, no revenue split, no
  settlement. `Contractor` has no sub-parties.
- **Adjacent, unclassified but useful:** `CustomerSupportRemark` (timestamped office notes
  against a move), `Move.financialReviewFlag` + `financialReviewRemarks` +
  `financialReviewFlagSetAt` (flag-for-review as a modelled state with its own timestamp),
  `Move.lockedByOfficeUserID` + `lockExpiresAt` (soft record locking for concurrent office
  users), `TPPSPaidInvoiceReport` (reconciliation of what was actually paid back against
  the payment request number).

## Open questions

1. **What is our equivalent of `availableToPrimeAt`?** MilMove's whole partner surface
   hangs off one timestamp meaning "this is now the mover's work." Does pegII have a
   single point where an order becomes actionable by an operating party, or is it implied
   by a status? This determines whether our catalog can have one clean "released" event.
2. **Aggregate granularity for our events.** MilMove chose five. What are ours? A
   candidate list (Order, Shipment, Trip/Stop, StorageStay, Charge/Invoice, Document) needs
   deciding *before* the catalog, because the choice is irreversible once published.
3. **State-carrying or identity-only events?** MilMove sends a full rendered snapshot.
   With Omnitracs/Samsara in the picture, high-frequency telemetry makes snapshot payloads
   expensive. Where does telemetry stop and a domain event begin (rubric A4)? MilMove has
   no answer because it has no telemetry.
4. **Do we need a diversion concept at shipment level at all,** or does a proper trip/leg
   model make it unnecessary? MilMove's chain exists only because it lacks legs. Worth
   deciding deliberately rather than inheriting.
5. **Who are our `MTOAgent` equivalents, and what do we call them?** We need a name for
   "the person at the residence" that does not collide with "van line agent." User /
   industry input needed.
6. **Reweigh cardinality.** One per shipment (MilMove) or many? Ask the tenants.
7. **SIT allowance source.** MilMove puts a day allowance on the shipment. In our world
   does it come from the tariff, the account contract, or the individual order?
8. **Ordering and replay on the notification stream.** If a partner is offline for a day,
   what do they get? MilMove's answer appears to be "retries plus `listMoves?since=`"
   (`swagger/prime.yaml:112-125`) - a polling fallback alongside the push. Do we want that
   belt-and-braces pair, and if so, what is the `since` contract?
9. **Where does an independent third party's assertion live?** MilMove has `observed*`
   dates on a QA report. When a visibility platform or the shipper's own portal asserts an
   arrival time that contradicts the crew's, which of ours is canonical and how is the
   other retained?
10. **Do we model "document proves fact X"?** MilMove types documents by what they prove
    (`isWeightTicket`, excess-weight counseling record, service-request justification) but
    never links a document to the specific *event* it evidences. Rubric A6 asks for
    "documents as evidence for events" - nobody read so far does this properly.
