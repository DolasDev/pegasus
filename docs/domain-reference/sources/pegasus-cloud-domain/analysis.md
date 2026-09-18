---
source: src:pegasus-cloud-domain
analyzed: 2026-09-17
evidence_grade: A
material: |
  Read in full (repo root = ~/repos/pegasus-domain-reference):
  packages/domain/src/index.ts (195 L), shared/types.ts (153 L), dispatch/index.ts (125 L),
  quoting/index.ts (142 L), schedule/index.ts (76 L), billing/index.ts (101 L),
  inventory/index.ts (78 L), document/index.ts (76 L), customer/index.ts (92 L),
  messaging/index.ts (405 L), rating/index.ts (111 L).
  Read partially: rating/tariff400ng.ts (header + line-item codes; 320 L),
  rating/mileage.ts (header), rating/data/zip3-centroids.ts (header only - 914 L of data).
  Not read: packages/domain/src/**/__tests__, *.test.ts (behavioural, not vocabulary).
  Cross-checked against apps/api/src/handlers/rating.ts to confirm rating is stateless.
---

# Pegasus Cloud domain package (`@pegasus/domain`) - analysis

## What it is

The pure-TypeScript domain layer of Pegasus Cloud: ten "bounded context"
folders under `packages/domain/src/`, re-exported through one barrel
(`index.ts`). Publisher DolasDev (internal). S1 kind: `internal-system`.
S2 adoption: **0-1** - it is one product's early-stage code, not an industry
artifact; the contexts are 75-405 lines each and several are stubs.
S3 openness: `internal`. S4 evidence grade: **A** - every file listed above was
read as source, not summarised.

What this source can tell us is **what Cloud can express today**, and - far more
usefully for a reference model - **what it structurally cannot**. It is a
generic small-mover CRUD model (`Move`, `Quote`, `Invoice`, `Customer`,
`CrewMember`) with exactly two genuinely HHG-specific islands bolted on: the
**400NG tariff rater** (`rating/`) and **room-by-room inventory with
condition-at-pack vs condition-at-delivery** (`inventory/`). Everything an
HHG reference model needs in A2/A3/A4/A5/A8 - shipment, trip, agent role,
storage-in-transit, execution events - is absent, not merely thin.

The layer is deliberately I/O-free: "Pure domain - zero I/O"
(`messaging/index.ts:9`), and the document context explicitly refuses to hold
S3 coordinates (`document/index.ts:3-8`). So the types here are the *conceptual*
statement; `apps/api/prisma/schema.prisma` is what is actually persisted (see
`src:pegasus-cloud-prisma`) and `apps/api/src/handlers/longhaul-cloud/` is the
trip surface that lives outside this package entirely (see `src:pegii-longhaul`).

## Model summary

Ten contexts, related as follows (the source's own names, in its own casing):

```
Customer -+- Contact (isPrimary)        Schedule: CrewMember -- Availability -- DateRange
          +- Account                              Vehicle    --+
          +- LeadSource
                |
                v
Dispatch:   Move --< Stop (type, sequence, scheduledAt/arrivedAt/departedAt)
             |   +-- origin: Address, destination: Address   (convenience refs)
             |   +-- assignedCrewIds[], assignedVehicleIds[]
             +--< Quote --< QuoteLineItem       (Quoting; RateTable --< Rate)
             +--< Invoice --< Payment           (Billing)

Inventory:  InventoryRoom --< InventoryItem (conditionAtPack, conditionAtDelivery)
Document:   Document (entityType/entityId polymorphic) --< DocumentVariant
Rating:     RatingInput -> rate400ng() -> RatingResult { RatedLineItem[] }   (pure fn)
Messaging:  Message / NormalizedMessage (RingCentral SMS capture)
Shared:     Brand<T,B>, Address, Money, DateRange, Serialized<T>
```

Three structural facts matter more than the diagram:

1. **`Move` is the only operational aggregate.** There is no Shipment, no
   Order (the "orders" API is a renamed view of Move - see
   `apps/api/src/handlers/orders.ts:8-11,57-70`), no Trip, no Job. A Move
   carries exactly one origin address and one destination address
   (`dispatch/index.ts:88-91`), so **one Move = one shipment = one route**, and
   the three concepts are fused with no seam to pull them apart.
2. **`Stop` is a child of `Move`, not of a journey.** `Stop.moveId` is
   mandatory (`dispatch/index.ts:59`). A stop therefore cannot be shared by two
   shipments, which makes consolidation inexpressible.
3. **Nothing in this package knows a shipment has a weight.** `weightLbs`
   exists only as an *argument* to the rater (`rating/index.ts:45`), never as a
   property of `Move`. Confirmed: `grep -riE "shipment|trip|weight|agent|
   carrier|scac|bol|survey|valuation|claim"` over `packages/domain/src/` hits
   nothing but the rating module and two prose comments.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| `Move` | "the central operational entity. It is born as PENDING when a customer confirms their booking, progresses through scheduling and dispatch, and is closed as COMPLETED or CANCELLED" | A1, A2 | `dispatch/index.ts:70-98` |
| `MoveStatus` | `PENDING \| SCHEDULED \| IN_PROGRESS \| COMPLETED \| CANCELLED` | A1 | `dispatch/index.ts:34-42` |
| `canTransition(current, next)` | the allowed-transition graph as executable code | A1 | `dispatch/index.ts:105-114` |
| `canDispatch(move)` | "A Move cannot be dispatched without at least one crew member assigned" | A1, A3 | `dispatch/index.ts:116-124` |
| `Stop` | "A single location visit within a Move route" | A3 | `dispatch/index.ts:51-68` |
| `StopType` | "The role of a stop along the move route": `PICKUP \| DELIVERY \| STORAGE \| WAYPOINT` | A3, A5 | `dispatch/index.ts:44-45` |
| `sequence` | "1-based position in the route"; invariant "unique and sequential within its parent Move" | A3 | `dispatch/index.ts:55,62-63` |
| `origin` / `destination` | "Convenience reference to the first PICKUP stop address" / "the last DELIVERY stop address" | A2, A3 | `dispatch/index.ts:88-91` |
| `Quote` | "a formal price offer presented to the customer for a specific Move" | A1, A7 | `quoting/index.ts:86-107` |
| `QuoteStatus` | `DRAFT \| SENT \| ACCEPTED \| REJECTED \| EXPIRED`; "Once ACCEPTED the quote is immutable" | A1, A7 | `quoting/index.ts:34-39,95` |
| `RateTable` / `Rate` | "A versioned collection of Rates used to price moves"; a `Rate` is a `serviceCode` + `unitPrice` | A7, A12 | `quoting/index.ts:62-84` |
| `Invoice` | "generated from an accepted Quote once the Move is complete" | A7 | `billing/index.ts:56-77` |
| `InvoiceStatus` | `DRAFT \| ISSUED \| PARTIALLY_PAID \| PAID \| VOID` | A7 | `billing/index.ts:27-33` |
| `CrewRole` | "The role a crew member plays on a job": `DRIVER \| MOVER \| SUPERVISOR` | A8, A13 | `schedule/index.ts:43-44` |
| `Availability` | a `DateRange` window per crew member or vehicle; "Two windows for the same resource must not overlap" | A13 | `schedule/index.ts:62-75` |
| `DateRange` | "A half-open time interval [start, end)" | A5, A13 | `shared/types.ts:103-111` |
| `ItemCondition` | `EXCELLENT \| GOOD \| FAIR \| DAMAGED \| MISSING`; "DAMAGED and MISSING trigger the claims workflow" | A10, A11 | `inventory/index.ts:25-29` |
| `conditionAtPack` / `conditionAtDelivery` | "Condition is recorded twice: at packing and at delivery. A mismatch between the two initiates a damage claim." | A10, A11 | `inventory/index.ts:35-52` |
| `Document` | polymorphic attachment: `entityType` + `entityId` + free-form `documentType` | A6 | `document/index.ts:25-46` |
| `DocumentStatus` | `PENDING_UPLOAD -> ACTIVE -> ARCHIVED \| PENDING_DELETION` | A6 | `document/index.ts:17-23` |
| `Brand<T, B>` | "Nominal / branded type: prevents accidental substitution of e.g. MoveId for QuoteId" | A9 | `shared/types.ts:11` |
| `RatingInput` | `weightLbs`, `originZip`, `destZip`, `pickupDate`, `mileage`, `options{fullPack, fullUnpack}`, `linehaulDiscountPercent?` | A12 | `rating/index.ts:44-60` |
| `billedWeight` / `cwt` | 400NG billable weight (min 1,000 lb, Item 25) and hundredweight | A12 | `rating/tariff400ng.ts:24`, `rating/index.ts:122-133` |
| `BLHS` / `OLF` / `DLF` / `SH` / `InvdLHS` / `FRA` | base linehaul, origin/destination linehaul factor, shorthaul additive, inverse-discount multiplier, fuel surcharge | A12 | `rating/tariff400ng.ts:23-41` |
| `Service Schedule` / `Service Area` | "a Service Area is assigned exactly one Service Schedule"; pack/unpack rates key on the Schedule, not the Area | A12 | `rating/tariff400ng.ts:43-51` |
| `RatedLineItem.code` | `LINEHAUL`, `ORIGIN_SERVICE`, `DEST_SERVICE`, `FULL_PACK`, `FULL_UNPACK`, `FUEL_SURCHARGE` | A7, A12 | `rating/tariff400ng.ts:238,251,257,271,286,301` |
| `basis` | "Human-readable basis for the charge, e.g. `52.5 cwt @ $6.55/cwt`" | A7 | `rating/index.ts:72-73` |

## Lifecycles & events

**Four state machines exist. All four are about paperwork or plumbing; none is
about physical execution.**

1. **`MoveStatus`** - `dispatch/index.ts:27-42,105-114`:
   `PENDING -> SCHEDULED -> IN_PROGRESS -> COMPLETED`, plus "Any non-terminal
   state -> CANCELLED". `COMPLETED` and `CANCELLED` are terminal (empty arrays,
   lines 110-111). One guard: `canDispatch` requires >=1 crew member before
   `IN_PROGRESS` (lines 116-124). **No reason codes anywhere** - a cancel
   carries no cause, and there is no field to put one in. **No actor model**:
   the transition function takes only `(current, next)`, so "who may cause
   each transition" (rubric A1) is not expressible in this layer at all.
2. **`QuoteStatus`** - `quoting/index.ts:34-39`. Transitions are *described* in
   prose only; unlike `MoveStatus` there is **no `canTransitionQuote`**. The
   one executable rule is `canFinalizeQuote` (>=1 line item before DRAFT->SENT,
   lines 118-126). `isQuoteValid` folds status and expiry together:
   `status === 'SENT' && validUntil > at` (lines 113-116).
3. **`InvoiceStatus`** - `billing/index.ts:27-33`; `PARTIALLY_PAID`/`PAID` are
   defined as *derived* from balance, not set by command ("PARTIALLY_PAID is
   set when at least one payment exists but the balance > 0"). `canVoidInvoice`
   is the only guard (lines 93-100).
4. **`DocumentStatus`** / **`DocumentVariantStatus`** - `document/index.ts:17-23,55-56`.
   An upload state machine, plus `FAILED` as an explicit terminal.

A fifth, `ForwardStatus` in `messaging/index.ts:352-360`, is the **best-built
transition function in the package** and worth stealing the shape of even
though SMS is out of scope: it permits **idempotent self-transitions**
(`PENDING->PENDING`, `FAILED->FAILED`) so "an at-least-once forwarder
re-recording the same status on a retry is not rejected", makes `SENT`
terminal, and lets `DEAD` re-open only via an explicit manual redrive
(lines 344-351). `deriveMessageStatus` (lines 362-378) then *derives* one
status from another "so the fields cannot drift".

**Execution events: none.** There is no arrive/depart/pack/load/unload/deliver
vocabulary in this package. The entire physical record is three nullable
timestamps on `Stop` - `scheduledAt`, `arrivedAt`, `departedAt`
(`dispatch/index.ts:64-66`). Setting `arrivedAt` is a field write, not an
event; nothing records who asserted it, when it was asserted (as opposed to
when it happened), or how it would be corrected.

**Domain events are not modelled here at all** - no event type, no emitter, no
outbox in `packages/domain`. Emission lives entirely in
`apps/api/src/lib/domain-events.ts`; see `src:pegasus-cloud-prisma` for the
taxonomy and the command-site inventory.

## Time, identity, evidence

**Time.** The model is overwhelmingly single-timestamp.

- `Move.scheduledDate: Date` (`dispatch/index.ts:95`) is one instant for a
  whole move - no pack date, no load date, no delivery spread, no window.
- `Stop` is the one place with a **planned-vs-actual pair**: `scheduledAt`
  (planned) vs `arrivedAt`/`departedAt` (actual), `dispatch/index.ts:64-66`.
  There is **no estimated/ETA slot**, and no third "as-reported" time.
- **No time zone anywhere.** `Address` has no zone field (`shared/types.ts:35-43`);
  `Date` is a JS instant. A stop's local calendar day - which is what a spread
  date or a SIT day count is actually measured in - cannot be recovered.
- **No date-only type.** Everything is an instant, so a delivery *date* and a
  delivery *moment* are the same type.
- The one precise temporal value object is `DateRange`, explicitly half-open
  `[start, end)` with `end` strictly after `start` and a companion
  `dateRangesOverlap` (`shared/types.ts:103-116`). It is used only for crew and
  vehicle availability (`schedule/index.ts:70-71`), never for a move, a stop,
  or storage.

**Identity.** `Brand<T, B>` (`shared/types.ts:11`) gives every aggregate a
nominal id type (`MoveId`, `StopId`, `QuoteId`, `CustomerId`, `CrewMemberId`,
`TariffVersionId`, ...) with a `toXId(raw: string)` constructor per type, and a
`Serialized<T>` mapped type that strips the phantom brand for the wire
(`shared/types.ts:126-153`). This is genuinely good discipline, but it is
**one opaque UUID per aggregate and nothing else**: there is no van-line
registration number, no SCAC, no BOL/PRO, no service-order number, no
partner-assigned key, and no place to put one. The sole exception is the
messaging context, which carries a foreign key deliberately: `Message.externalId`
is "The RingCentral message id within its store", and `dedupeKey(source,
externalId)` builds a **store-scoped** composite "so the same RC id in
different stores never collides" (`messaging/index.ts:126-128,213-220`).
That `(system, theirId)` tuple is the only cross-party identity idea in the
package, and it is worth generalising.

**Evidence and provenance.** Essentially absent from the domain types.

- No aggregate records who asserted a fact. `Move.userId` is "Platform user who
  created the move record" (`dispatch/index.ts:86-87`) - a creator, not a
  source of truth for any later field. `Document.uploadedBy`
  (`document/index.ts:41`) is the only other actor field.
- No evidence type, no link from a fact to the document that proves it.
  `Document` points *at* an entity (`entityType`/`entityId`,
  `document/index.ts:34-35`) but never at a *fact* or a *status change*, and
  `documentType` is an unconstrained `string` - so "this is the signed BOL that
  evidences the load" is expressible only as a free-text convention.
- **No correction or reversal semantics anywhere.** Every aggregate is a
  mutable current-state record (`updatedAt`, `dispatch/index.ts:97`); there is
  no supersede, no amend, no void-and-reissue except `InvoiceStatus.VOID`
  (`billing/index.ts:33`) which is itself blocked once a payment exists.
- The one real provenance artefact in the package is prose, not data: the
  **`CALIBRATION STATUS` block** in `rating/tariff400ng.ts:14-70`, which records
  exactly which claims were verified against which published source (the 2026
  400NG tariff PDF Appendix A, the Baseline Rates spreadsheet tabs) and which
  earlier assumptions those sources *corrected* ("Minimum billing weight is
  1,000 lbs (Item 25), not 500"; the peak/non-peak split "has been removed
  rather than left as unused dead weight"). That is the evidence discipline the
  rest of the package lacks.
- `RatingResult.meta.warnings` - "Non-fatal issues, e.g. `FSC rate unavailable
  - omitted from total`" (`rating/index.ts:83-86`) - is the only *degraded
  result* channel: a computed answer that says what it could not account for.

## Scores

Weights are set per area in phase 3; these are the raw 0-3 criterion scores.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 1 | 1 | 2 | 0 | 1 | 1 | 0 | 0 | States + executable transition graph + one precondition (`dispatch/index.ts:34-42,105-124`) earn C3. But the *set* of states is a generic job tracker: no offer/award, no accept/decline, no estimate-submitted, no booked-vs-confirmed, no reason codes, no actor (`canTransition` takes no principal). Quote lifecycle is prose-only (`quoting/index.ts:34-39`). |
| A2 Shipment structure | 0 | 0 | 0 | 0 | n/a | 0 | 0 | 0 | **No shipment concept exists.** `Move` fuses order+shipment+route (`dispatch/index.ts:82-98`); no shipment type, no weight on any entity (weight is a rater argument only, `rating/index.ts:45`), no services-ordered list. Scored 0 deliberately: the finding is the absence. |
| A3 Trip, stop & assignment | 1 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | `Stop` with typed role + 1-based unique `sequence` invariant is real (`dispatch/index.ts:44-68`) and is the one ordered-stop idea Cloud owns. But `Stop.moveId` is mandatory (line 59) => no trip separate from the shipment, no consolidation, no leg. Assignment is an unqualified id array (`assignedCrewIds`, line 93) - no role-on-this-move, no assignment period, no equipment/trailer. |
| A4 Execution events & tracking | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | Only `arrivedAt`/`departedAt` on `Stop` (`dispatch/index.ts:65-66`). No pack/load/unload/deliver, no ETA, no exception or delay with a reason, no telemetry boundary. C5=1 for the planned-vs-actual pair only. |
| A5 Storage-in-transit | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | `StopType.STORAGE` exists as a name (`dispatch/index.ts:45`) and **nothing else in the package or the API reads it** (verified: `grep -rn "STORAGE" packages/domain/src apps/api/src` returns only that declaration). No SIT in/out, no duration, no warehouse party, no delivery-out leg, no permanent-storage boundary. C1=1 for the bare enum value. |
| A6 Documents & evidence | 1 | 1 | 2 | 0 | 1 | 1 | 1 | 1 | Upload state machine is well-formed incl. a terminal `FAILED` (`document/index.ts:17-23,55-56`) => C3. But `documentType` is `string` (line 37) - no BOL/POD/weight-ticket/inventory vocabulary - and a document attaches to an *entity*, never to a *fact* or *event*, so it is storage, not evidence. C7=1 for `uploadedBy` (line 41). |
| A7 Charges & billing hooks | 2 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | Quote->line items->invoice->payments->balance is complete and executable (`quoting/index.ts:118-141`, `billing/index.ts:83-100`). The linehaul-vs-accessorial split exists only in the rater's codes (`rating/tariff400ng.ts:238-301`), not in `QuoteLineItem`, whose `description` is free text (`quoting/index.ts:54`). C4=1: 400NG charges are HHG-native; the quote model is not. No charge *events* - money moves by field write. |
| A8 Parties & roles | 1 | 1 | 0 | 0 | n/a | 1 | 0 | 0 | Customer/Contact/Account/LeadSource + `CrewRole` (`customer/index.ts:36-85`, `schedule/index.ts:43-44`). **No shipper-vs-transferee distinction, no account/RMC, no van line, no booking/origin/hauling/destination agent, no carrier, no warehouse.** A `Move` has one optional `customerId` and one `userId` - two party slots total (`dispatch/index.ts:85-86`). C3=0: parties have no lifecycle. |
| A9 Identity & cross-references | 1 | 2 | n/a | 0 | n/a | 1 | 0 | 1 | `Brand<T,B>` nominal ids + per-type constructors + `Serialized<T>` (`shared/types.ts:11,126-153`) is precise => C2=2. But one opaque UUID per aggregate and **zero external identifiers** => C6=1. The `(source, externalId)` store-scoped dedupe key (`messaging/index.ts:126-128,213-220`) is the only cross-party correlation idea. |
| A10 Survey, estimating & inventory | 1 | 2 | 1 | 2 | 1 | 1 | 1 | 0 | Room->item->`ItemCondition`, `declaredValue`, and the **condition-at-pack vs condition-at-delivery pair with the "may only be set once" invariant** (`inventory/index.ts:25-52`) is genuinely HHG-native => C4=2, C2=2, C7=1 (a fact recorded at two named moments). But **no survey entity at all** (the word appears once, in a comment, `quoting/index.ts:3`), and **no estimate typing** - binding / non-binding / not-to-exceed is inexpressible. |
| A12 Rating & tariffs | 2 | 3 | 1 | 3 | 2 | 2 | 2 | 2 | `rating/tariff400ng.ts:1-70` defines 400NG terms with the distinctions that matter (BLHS *always* applies and SH is **additive, not alternative**, lines 23-28; the discount applies to linehaul+OLF+DLF+SH *and separately* to 135A/B and 105A, lines 29-37; pack is weight-banded but unpack is flat, lines 42-46; Service Area->Service Schedule is many-to-one, lines 46-51) => C2=3, C4=3. C7=2 for the calibration block recording source and corrections. C3=1: the module is a pure function; version status lives in the DB (see `src:pegasus-cloud-prisma`). C5=2: `rateCycleFor`, peak-season window May 15-Sep 30 (lines 60-66). |
| A13 Crew, driver & settlement | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 0 | `CrewMember` (role, `licenceClasses`, `isActive`), `Vehicle` (`capacityCubicFeet`, `lastInspectionDate` with a 12-month dispatch invariant), `Availability` over a half-open `DateRange` with a non-overlap rule (`schedule/index.ts:35-75`). C5=2 for the interval model. **No compensation, no revenue split, no settlement, no driver pay - the word does not occur.** |

Area **A11 (claims & valuation)** - one comment, no model - is recorded under
*Out-of-v1 material* rather than scored.

**S5 - fit to Pegasus data (can Cloud supply this concept today?)**

| Area | Fit | Note |
| --- | --- | --- |
| A1 | partial | 5 move states + 5 quote states + 5 invoice states, no reasons, no actors. |
| A2 | **no** | No shipment entity, no weight, no service list. Would need a new aggregate. |
| A3 | partial | Ordered typed stops exist; trip, consolidation, legs do not. Live trips are MSSQL-only (`src:pegii-longhaul`). |
| A4 | **no** | Two actual timestamps on a stop; no event vocabulary. |
| A5 | **no** | An unread enum value. |
| A6 | partial | Files attach to entities; document *types* and evidence links do not exist. |
| A7 | partial | Invoice/payment yes; charge-level linehaul-vs-accessorial only inside the 400NG rater. |
| A8 | **no** | Two party slots per move (customer, creating user). Agent roles absent. |
| A9 | partial | Strong internal ids, zero external references (see prisma source for `IntegrationCorrelation`). |
| A10 | partial | Inventory yes and good; survey and estimate type no. |
| A12 | yes (400NG only) | Van-line tariffs are proprietary and explicitly out of scope (`rating/index.ts:4-8`, `tariff400ng.ts:5-13`). |
| A13 | partial | Crew/vehicle/availability yes; settlement no. |

## Strengths worth adopting

1. **The `Brand<T, B>` nominal-id discipline** (`shared/types.ts:11,126-153`).
   The reference model should give every identifier a *type*, not a shape, so
   an order number can never be passed where a registration number belongs.
   The `Serialized<T>` companion (brand stripped at the wire boundary) is the
   right way to say "this typing is a modelling device, not a payload".
2. **`(source, externalId)` as a store-scoped correlation key**
   (`messaging/index.ts:213-220`, "so the same RC id in different stores never
   collides"). Generalise to `(party, idKind, value)` - an HHG shipment carries
   a van-line registration number, an agent order number, a BOL number and an
   RMC service-order number, and they collide freely across parties.
3. **Idempotent self-transitions in a transition function**
   (`messaging/index.ts:344-360`). An at-least-once event feed *will* re-assert
   "loaded" twice. A lifecycle that rejects a repeated assertion of the state it
   is already in is wrong for this domain, and this source states the rationale
   explicitly.
4. **Deriving one status from another rather than letting both be set**
   (`deriveMessageStatus`, `messaging/index.ts:362-378`: "Callers should use
   this rather than setting `status` independently, so the fields cannot
   drift"). Directly applicable to shipment status vs milestone facts.
5. **A fact recorded at two named moments, with the second gated on the first**
   (`conditionAtPack` / `conditionAtDelivery`, `inventory/index.ts:35-52`).
   This is a miniature evidence model and the right seed for "condition at
   origin vs at destination" and for exception detection by comparison.
6. **Half-open `DateRange` with an explicit overlap predicate**
   (`shared/types.ts:103-116`). Use it for SIT periods, spread windows and
   agent assignment periods - with the `[start, end)` convention stated, which
   is exactly the ambiguity that bites on a SIT day count.
7. **Strict parsing at the runtime boundary** (`toDirection`, `toRcDate`,
   `toPhoneNumber`, `messaging/index.ts:226-252`): an unmapped enum value
   *throws* rather than "silently defaulting to OUTBOUND, which would invert the
   from/to interpretation of the persisted record". The reference model should
   say the same about partner status codes - an unknown partner status is an
   unknown, not a default.
8. **A degraded-but-usable result channel** (`RatingResult.meta.warnings`,
   `rating/index.ts:83-86`) - the answer plus what it could not account for.
9. **`RatedLineItem.basis`** - "52.5 cwt @ $6.55/cwt" (`rating/index.ts:72-73`).
   Every charge should carry a human-auditable derivation string, not just an
   amount.
10. **The `CALIBRATION STATUS` convention** (`rating/tariff400ng.ts:14-70`):
    record what was verified, against which published artefact, and which prior
    assumption it corrected. This is the discipline the domain reference itself
    is trying to institutionalise, already practised in one file of this repo.

## Weaknesses / traps

1. **Do not inherit `Move`.** It fuses order, shipment and route into one
   aggregate with one origin and one destination (`dispatch/index.ts:82-98`).
   Adopting it forecloses consolidation, multi-shipment trips, split deliveries,
   partial loads, and SIT-then-deliver - every one of which is normal HHG.
2. **`MoveStatus` is a job tracker, not a shipment lifecycle.** `IN_PROGRESS`
   is undefined: it covers packing, loading, in-transit, at-SIT and unloading
   indistinguishably, and the distinctions between *loaded*, *departed origin*
   and *in transit* - precisely the ones rubric C2 asks about - are the ones it
   erases. `SCHEDULED` also conflates "we have a date" with "a resource is
   committed".
3. **`StopType.STORAGE` is a trap, not a head start.** Storage is modelled as a
   point you pass through, so it has no duration, no warehouse party, no in/out
   pair, and no distinction from permanent storage. Treating SIT as a stop type
   because Cloud already has the enum value would bake in the wrong shape; SIT
   is a *state with a duration* that a shipment is in, plus the delivery-out
   leg that follows.
4. **`origin` / `destination` as "convenience references" are a lie in the
   making.** The doc says they mirror "the first PICKUP stop" and "the last
   DELIVERY stop" (`dispatch/index.ts:88-91`), but they are independent
   mandatory fields with no invariant tying them to the stop list, and the write
   path never creates stops at all (see `src:pegasus-cloud-prisma`). Denormalised
   endpoints that nothing keeps in sync are a known data-quality failure mode.
5. **Assignment has no role, period, or type.** `assignedCrewIds: CrewMemberId[]`
   (`dispatch/index.ts:93`) cannot say *this driver, as hauler, from load to
   delivery* - and `CrewRole` is a property of the *person*, not of the
   assignment, so the same person cannot be a driver on one job and a supervisor
   on another.
6. **`Move.userId` is not provenance.** It is the record's creator
   (`dispatch/index.ts:86-87`). Nothing in the package records who asserted any
   *subsequent* fact. Do not read it as an authority or a source.
7. **`documentType: string`** (`document/index.ts:37`) - a free-form
   classification will not support "the BOL evidences the load event". The
   reference model needs a typed document vocabulary and a link from document
   to the fact it evidences.
8. **`Money` forbids negative amounts** (`createMoney` throws,
   `shared/types.ts:75-85`). Credits, adjustments, discounts and claim payouts
   are negative. Also, `Money` is a float `amount` (line 70) while the rater
   works in integer cents/millicents "specifically to avoid float drift"
   (`rating/index.ts:64-69`) - two incompatible money models in one package.
   Take the rater's.
9. **`calculateQuoteTotal` silently drops mixed currencies** ("Line items with
   differing currencies are excluded", `quoting/index.ts:128-141`). A total that
   quietly omits rows is worse than an error. Do not copy the pattern into
   charge aggregation.
10. **No time zone, and no date-only type.** Modelling every time as a JS
    instant with no stop-local zone makes spread dates, SIT day counts and
    "delivered on the 4th" irreproducible. Fix this in the reference model
    rather than inheriting it.
11. **Closed string-union vocabularies with no version marker** (every `*Status`
    type). Adding a status is a source change with no compatibility story. The
    catalogue will need explicit versioning; this source offers none.

## Out-of-v1 material

- **A11 claims & valuation.** The only trace in the whole package is two
  sentences: "DAMAGED and MISSING trigger the claims workflow"
  (`inventory/index.ts:27-28`) and "A mismatch between the two initiates a
  damage claim" (`inventory/index.ts:38-40`). `InventoryItem.declaredValue:
  Money` (line 49) is the sole valuation field - there is no released-value vs
  full-value-protection distinction, no valuation election, no claim entity,
  no deductible, no claim lifecycle. Worth recording that Cloud's *only*
  claims hook is a condition comparison, which is a defensible trigger but not
  a model.
- **A12 rating & tariffs** (scored above, but mostly out-of-v1 detail).
  `rating/tariff400ng.ts:66-70` enumerates what the tariff contains but the
  module does not: **"SIT (Storage-in-Transit) and its own discount (dSIT),
  crating/uncrating, Alaska/waterhaul shipments, accessorial services beyond
  full pack/unpack, and Volume Move / One-Time-Only bid rates."** That list is
  itself a useful inventory of 400NG accessorial concepts to chase in the
  tariff source. Also note `linehaulDiscountPercent` is "won through a separate
  bid/rate-filing process and NOT published in the tariff itself"
  (`rating/index.ts:52-60`) - a rate fact that lives outside every tariff
  document, which the model must have a home for.
  Van-line tariffs are explicitly unavailable: "Atlas gates its tariff behind an
  access request, United's UVL1 is review-only, Allied publishes only a rules
  PDF with no rate tables" (`rating/tariff400ng.ts:10-13`).
- **A13 crew & settlement.** `Vehicle.capacityCubicFeet` (`schedule/index.ts:56`)
  is the only capacity concept in Cloud; `lastInspectionDate` with the
  12-month dispatch invariant (lines 49-50,57) is the only compliance one.
  No settlement, no pay, no split.
- **Messaging (no rubric area).** `messaging/index.ts` is a complete RingCentral
  SMS capture model (thread store vs legacy v1 store, dedupe key, forward
  outbox to the on-prem system of record, 72h body purge / 30-day row delete).
  Not domain material, but its transition-function and dedupe patterns are the
  reusable parts, listed under *Strengths* above.
- **Tenancy.** Every context is implicitly single-tenant at this layer; the
  tenant is added only at persistence (see `src:pegasus-cloud-prisma`).

## Open questions

1. **What does `IN_PROGRESS` mean operationally today?** If Cloud users are
   already reading it as "on the truck", any reference-model split into
   packed/loaded/in-transit must publish a mapping, not just a new vocabulary.
   (User / product question.)
2. **Is `StopType.STORAGE` unused because it is unbuilt, or because SIT is
   deliberately owned by pegII?** Nothing reads it; the SIT logic that exists
   reads MSSQL activity codes `SITIN`/`SITOUT`
   (`apps/api/src/handlers/longhaul-cloud/shipments-list.ts:284-286`). Does the
   target architecture put SIT in Cloud's own model or leave it in pegII?
3. **Should `Move` be split, or superseded?** The reference model will almost
   certainly need Order / Shipment / Trip as three things. Whether Cloud's
   `Move` becomes one of them or is retired is a migration decision this source
   cannot answer.
4. **Which document types actually occur in `documentType`?** The field is
   free-form; the real distribution is in the `documents` table, not in code.
   Needed before a typed document vocabulary can claim coverage.
5. **Do quotes ever need to reference a rating result?** `rating` is deliberately
   standalone - "does not touch quotes.ts or any existing quote-creation path"
   (`apps/api/src/handlers/rating.ts:5-7`) - so a priced 400NG result is never
   persisted against a move. Is that a gap or a decision?
6. **Is `RateTable`/`Rate` (`quoting/index.ts:62-84`) in real use, given the
   separate 400NG tariff tables?** Two rate models coexist with no stated
   relationship.
7. **Where would an estimate type (binding / non-binding / not-to-exceed)
   attach** - to `Quote`, or to a new Estimate concept? Cloud has no slot and
   no opinion.
