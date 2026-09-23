# A1 — Order & service lifecycle

Cited elsewhere as **[A1 §x]**.

> **Status.** A decision document and the area comparison for A1. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope.** A1 is the **commitment** side of the model: how an order comes to exist as an
> undertaking between two parties, how that undertaking is answered, revised and ended, and who may
> cause each of those transitions. It is **not** the execution side — the acts performed on the
> goods are A4's and A3's — and it is not the survey, the estimate or the rating, which are A10's
> and A12's. §3.4 states that boundary as a rule rather than as a preference, because the corpus
> does not draw it and three of its sources put a lead, an estimate and an order on one status
> ladder.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged, plus one this area needs stated.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is. This
   bites harder in A1 than anywhere else: `src:pegii-order`, `src:pegasus-cloud-prisma` and
   `src:pegasus-integration-floors` all carry an order status ladder, and
   `src:pegasus-integration-floors`' nine-value enum is **ours** — it is the shape we already built,
   not evidence about the domain.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** §6 carries what A1 does not settle and names who owes it. Where A1 found
   that a gap is the corpus's rather than an author's, it says which.
4. **Permission is not authority.** A1 answers **who may cause a transition**; [A8] answers **who
   wins when two parties assert incompatible facts**. The rubric gives the first to A1 (`C3`:
   "explicit states, allowed transitions, invariants, **who may cause them**") and [A8 §1] claims the
   second. §3.5 keeps them apart, and §Cross-area hands A8 what A1 found on its side of the line.

---

## 1. The question, stated sharply

Five things are owed to this area by name. Every one of them is a sentence in a binding document
that says, in as many words, that A1 decides it. They are the whole decision surface; everything
else in this file is scoring, or is a finding handed across an area boundary.

| #   | Owed item                                                                                                                                                                                   | Owed by                                                 | Settled at |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| 1   | Which `outcome` member `src:stedi-x12-reference` element 558's **`B` Conditional Acceptance** and **`C` Counter Proposal Made** take. "**A1's to declare and is not decided here.**"        | [SD §4.7.2e]; repeated in the generated glossary        | §3.2       |
| 2   | The **states an order occupies before any shipment exists**, and which of them may be terminal. "**This belongs to Fork/Area A1.**"                                                         | [`fork-order` §5.3](fork-order-shipment-cardinality.md) | §3.3       |
| 3   | Whether **book**, **estimate submitted** and **complete** — three acts the rubric puts in A1's scope — are record types, projections, or someone else's                                     | [`../rubric.md`](../rubric.md), the A1 row              | §3.4       |
| 4   | **Who may cause each transition** — the rubric's own C3                                                                                                                                     | [`../rubric.md`](../rubric.md), criterion C3            | §3.5       |
| 5   | Whether the published reason vocabulary reaches the **commitment** side. [SD §2.3] invariant 2 already requires a reason on every declined response, so this is due now, not hypothetically | [A4 §3] rule 4 ("the same vocabulary at every grain")   | §3.6       |

### What is already fixed above A1, and is quoted rather than re-derived

A1 inherits more settled structure than A3 did, and the settled parts are **not** reopened here.
Listing them is not throat-clearing: two of the five decisions below are forced by them, and a
reader who does not know they are fixed will read a forced choice as a free one.

- **The aggregate and the cardinality.** One order carries one-or-more shipments; a shipment belongs
  to exactly one order; `N` may be **0** ([`fork-order` §3.1](fork-order-shipment-cardinality.md),
  [`fork-order` §5.3](fork-order-shipment-cardinality.md)).
- **Three record types, and only three.** `orderAward`, `orderResponse`, `orderCancellation`
  ([SD §4.7.2e]). Accept and decline are **two outcomes of one act**, not two types — **A-TYPE**.
- **No qualifier on any of the three**, so each fact key is `(subject, type)` and successive changes
  ride `supersedes` ([SD §4.7.2e] item 4). This has a structural consequence §3.3 leans on: **at most
  one selected fact per type per order.**
- **Who ended it and when is carried by the stage plus `reasons[].attribution`**, never by a type
  name ([SD §4.7.2e] item 2).
- **A cancellation is an act with an outcome**, so a refused cancellation needs no new mechanism
  ([SD §4.7.2e] item 3).
- **State is never a field.** [SD §1.1] forbids a mutable current-state field on the envelope, and
  [A3 §3.4] records the rejection of `StopStatusChanged` for the same reason. An order's stage is
  therefore a **projection** or it is nothing — §3.3 does not choose this, it discharges it.
- **`estimate` is an absent fact class** ([SD §4.7.3]). It is named in the corpus and carried in no
  table, deliberately. §3.4 must not reintroduce it under another name.

### Why getting this wrong is expensive

The two candidate errors are not symmetric, which is the same asymmetry [A3 §1] found one aggregate
to the right.

- **Publishing a stage enum as a record** is cheap to write and expensive to withdraw: a `type` is a
  fact-key component ([SD §1.3] item 3), so removing one is **breaking, a new major**
  ([catalog §2.3]). A projection is repaired by re-publishing a fold over records that did not
  change — which is exactly the property [SD §4.8.2] bought when it made custody a projection.
- **Minting a type per transition** is the error the corpus most invites: `src:weichert-supplier-api`
  publishes eighteen Auto/Pet order statuses of which four name their own actor
  (`Cancelled by Supplier`, `Cancelled by Customer`, `Reschedule Requested by Customer`,
  `Reschedule Requested by Supplier`, odt:2984-2985), and `src:smartmoving-api`'s own analysis
  recommends to us that "our A1 reason codes should likewise be **per-terminal-state**". Both are
  rejected at §3.8, and both would have been breaking to undo.

---

## 2. The positions in the external corpus

Twenty-eight external sources were scored for A1 in their own analyses; the per-source scores and
their citations live there and are not restated. What follows is the **positions** — the distinct
answers the corpus gives to A1's five questions — with the grade of our reading of each.

A1 is, on the evidence, one of the best-supported detail areas in the corpus. Six sources score
`C1 = 3` and three score `C3 = 3`. That matters for §7: where A3 had to author a shape, A1 mostly has
to choose between published ones.

### 2.1 "Who ended it, and when, is worth three codes" — `src:dcsa` (grade A)

The strongest lifecycle material in the corpus. `bookingStatus` is nine values with a **verbatim
definition each** (`bkg/v2/BKG_v2.0.5.yaml` L2461-2477), and three of them differ only in who ended
the booking and at what stage: `REJECTED` — _"Booking discontinued by **carrier before** it has been
Confirmed"_; `DECLINED` — _"…by **carrier after** it has been Confirmed"_; `CANCELLED` — _"…by
**shipper**"_. The DCSA analysis draws the conclusion for us: _"three of the nine values exist purely
to record **who** ended the booking and **when in the lifecycle**"_, and it is _"the single most
transplantable idea in the DCSA corpus for A1"_.

Three further structural moves, each of which A1 uses:

- **Amendment runs on a parallel track.** `amendedBookingStatus` is _"only available after the
  provider has approved the `Booking`"_ (L1122); the amended and original booking **co-exist**
  (L573); and `bookingStatus` **stays** `CONFIRMED` while `amendedBookingStatus` moves (L599).
- **Cancellation runs on a third track**, `bookingCancellationStatus` ∈ `CANCELLATION_RECEIVED` /
  `_DECLINED` / `_CONFIRMED`, _"because cancelling a confirmed booking is itself a request the
  carrier can refuse"_.
- **Transitions are stated as preconditions on the endpoint**, not as a table — _"send an update to
  a newly created Booking (precondition: `bookingStatus='RECEIVED'`)"_ (L595-599).

And one DCSA fact from a different API that belongs in A1's evidence rather than A4's, because it is
the corpus's clearest statement that **an assertion class can be bound to a role**: JIT's
`classifierCode` is constrained by who is speaking — _"`EST`, `PLN` and `ACT` can **only** be used by
the **Service Provider** … `REQ` is **only** to be used by the **Service Consumer**"_
(`jit/v2/JIT_v2.0.0.yaml` L3554-3585). §Cross-area hands that to A8.

### 2.2 "The response is four-valued, and the lifecycle verb is a field" — `src:stedi-x12-reference` (grade A/B)

The corpus's one published **offer/response protocol**, and the source of owed item 1. The 990
Response to a Load Tender carries `B1-04` Reservation Action Code (element 558), which is
four-valued: **`A` Reservation Accepted**, **`B` Conditional Acceptance**, **`C` Counter Proposal
Made**, **`D` Reservation Cancelled** (plus the maintenance verbs `N`/`U`/`R`). The stedi analysis
states the significance plainly: a _"1997-vintage standard models conditional acceptance and
counter-offer as first-class responses"_ where project44's `BOOKED | REJECTED` does not, and
_"tendering a shipment to an agent who accepts **except** the delivery date is the normal case in
HHG"_.

Two more, both load-bearing here:

- **The lifecycle verb is a field on the message, not a different message.** Every 204 carries
  `B2A`, drawing on element 353's 65 purpose codes: `00` Original, `01` Cancellation, `04` Change,
  `05` Replace, `06` Confirmation, **`17` Cancel, to be Reissued**, `18` Reissue, `25` Incremental.
  The analysis singles out `17` as distinguishing _"withdraw this and expect a replacement"_ from
  _"withdraw this"_ — a distinction _"HHG needs constantly"_ and that _"no vendor API in this cluster
  has"_.
- **The acceptance can be per-stop.** The 990 carries a full `S5` stop loop with nested `N9`/`G62`/
  `K1` and an `L9` Charge Detail, _"so the acceptance can be per-stop and can attach its own times
  and charges, not merely a yes."_ §3.2 records what A1 can and cannot do with that.

`B1-03` is _"the **booking date accepted by the carrier**"_ — the one place in the corpus where the
acceptance carries its own date as a datum distinct from the award's.

### 2.3 "An actor on every transition, with a deadline" — `src:dtr-part-iv` (grade A)

The most complete order lifecycle in the corpus, and the only one that names a **party on every
edge**. Its analysis publishes the transition table outright (A-402 §C-§F); the A1-relevant rows:

| From → To              | Caused by                                                  | Gate                                                                                                                                            | Cite                |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| validated → offered    | **DPS**, by channel + COS + BVS + band                     | —                                                                                                                                               | §C.2, §C.3          |
| offered → accepted     | **TSP**                                                    | **24 h**, time-zone aware                                                                                                                       | §C.4.a p. 6         |
| offered → refused      | **TSP**                                                    | permitted **only** for short-fuse or shortened-transit; 30-day ineligibility                                                                    | §C.4.a, §F.2.a      |
| offered → non-response | **nobody** — the absence of an act is itself a typed event | DPS charges an allocation, e-mails a "Notice of Non-Response", offers the next TSP; the PPSO must **overtly** confirm it was not a system fault | §C.4.b p. 6, §F.1.b |
| any → cancelled        | **PPSO** "in the interest of the Government"               | TSP returned to the list **without** charge                                                                                                     | §C.5 p. 8           |
| any → pulled back      | **PPSO**                                                   | no charge for Government convenience; **charged** if caused by TSP action or inaction                                                           | §C.6.a-b p. 9       |
| any → turned back      | **TSP**                                                    | charged; may owe the difference if it forces an Actual Cost Reimbursement PPM                                                                   | §C.6.b, §C.6.d      |

Read for A1 rather than for DTR, four things follow. **(i)** The actor on each edge is **fixed by the
transition kind**, not read off the record — the TSP always accepts, refuses and turns back; the PPSO
always cancels and pulls back. **(ii)** Cancel / pull-back / turn-back are the same terminal outcome
distinguished by _who_ and _with what liability_ — DCSA's three-code finding, in a regulation.
**(iii)** A deadline elapsing is a **typed event with no actor**, which is the corpus's only
published statement of that shape. **(iv)** Permission is conditional on the offer's own properties:
refusal is legal **only** for a short-fuse or shortened-transit shipment.

The weight gate is quoted here because §3.4 uses it: until the TSP enters gross/tare/net in DPS the
system _refuses_ invoicing, ITV updates, arrival entry, SIT-at-destination requests and delivery
scheduling (§F.8.c(3), p. 30) — _"one fact blocks five downstream transitions"_.

### 2.4 "Hard ordering with a named actor, and no status codes at all" — `src:cfr-49-375` (grade A)

Part 375 publishes **no status codes and no reason codes**. What it publishes is a set of ordering
constraints and deadlines with an explicit actor for each, and the analysis tabulates them with a
"Who may cause it" column of its own. The A1-relevant rows:

- **BOL rescinded — _shipper_ — within 3 days of signing, without penalty**; and a same-day new
  estimate under §403(a)(6)(ii)/§405(b)(7)(ii) does **not** restart the 3-day period (§375.505(h)).
  A commitment with a statutory unwind window, and the one place the corpus states that a later act
  does not reset a running deadline.
- **Estimate amended — _carrier and shipper, mutually_ — only before loading**; _"You may not amend
  the estimate after loading the shipment"_ (§375.401(i)).
- **Estimate reaffirmed by silence — caused by _the act of loading_**: _"Once you load a shipment,
  failure to execute a new binding estimate or a non-binding estimate signifies you have reaffirmed
  the original"_ (§375.403(a)(7), §375.405(b)(8)). The corpus's only published transition whose
  cause is **another act** rather than a party.
- **Post-BOL additional services — _carrier proposes, shipper decides_**, and the shipper must be
  given **at least one hour** to decide; agreement becomes a signed written attachment to the BOL
  (§375.403(a)(8)).

This is a grade-A regulation with `C1 = 2` and `C2 = 3`: thin on _what states exist_, unmatched on
_what may legally follow what, and who says so_.

### 2.5 "The carrier-facing half, with a short fuse" — `src:dp3-tender-of-service` (grade A, `C4 = 3`)

Only one side of the conversation — award, routing, cancellation and pull-back live in the DTR — but
it is the side with the obligations. Acceptance is the **clock that starts everything**: confirm the
agreed pickup date in writing to the customer within **3 calendar days** (§C.3.m); origin servicing
agent in DPS within **15 calendar days of acceptance or NLT 7 days before pickup, whichever is
sooner** (§B.20.a); pre-move survey and weight estimate **5 GBD from acceptance but NLT 9 days before
first pack/pickup, whichever is later** (§C.2.b). **Short fuse** — "an award with a compressed lead
time; its own DPS queue; collapses several deadlines to 1 GBD" (HHG §B.18.a, §C.2.d) — is a named
property of the award that changes which deadlines apply and, per §2.3, whether refusal is permitted
at all.

**Turn-back has a 14-day rule** with downstream PPM liability, and refusal to accept property for
shipment is separately enumerated by article class. Its 43-row obligation catalogue is
_trigger → responsible party → deadline → system of record → consequence_, which is the shape §3.5's
permission table takes.

### 2.6 "The request and the act are different parties" — `src:milmove-mymove` (grade A)

A running federal system, read at source. Two contributions A1 uses directly.

**Cancellation is two acts by two parties.** `MTOShipment` carries `CANCELLATION_REQUESTED` and
`CANCELED` as separate states, and _"the **request** and the **act** are different actors: the TOO
sets `CANCELLATION_REQUESTED`, and only the mover can then move it to `CANCELED`"_ —
_"Currently, the Prime cannot update the shipment to any other status"_ (`swagger/prime.yaml`
L785-790). The same split is published for diversion as two endpoints,
`Ghc.RequestShipmentDiversion` then `Ghc.ApproveShipmentDiversion`.

**A rejection must carry a reason, enforced.** `REJECTED` requires `rejectionReason`
(`mto_shipments.go:206-212`); a rejected SIT service item may be **resubmitted** only with an
`updateReason` that _"must have a different value than the current `reason` value… If this value is
not updated, then an error will be sent back"_ (`swagger/prime.yaml` L1076-1128) — a correction
protocol with an explicit anti-no-op guard.

Also relevant and _not_ adopted: `Move` carries a matching **timestamp column per state**
(`move.go:59-89`) and an `APPROVALS REQUESTED` **return** state. §3.8 says why the timestamp columns
are not evidence for a field.

### 2.7 "The actor is captured on every transition; the vocabulary is invisible" — `src:atlas-world-group-api` (grade B)

The HHG-native shape, with `C1 = 3` and `C4 = 3` and `C2 = C3 = 1`: every A1 concept is present as a
**column name** and almost nothing is defined. `bookDate` / `bookedBy` / `booker`;
`POST /Estimating/CreateOrder`; `PUT /Tonnages/request` + `/accept`; `LoadBoard.accepted_by` /
`accepted_datetime`; `isAccepted` vs `hasBeenAccepted` (both undefined); `ord_completiondate`. Its
`ord_status` is `{"type":"string","nullable":true}` and the file contains **zero enums**.

The contribution that survives the grade is the **cancellation quintuple**: `cancelDate`,
`cancelReason`, `cancelCategory`, **`cancelRequestor`**, **`cancelledBy`**
(`atlasorder-v1.json:11324`). Atlas distinguishes who _asked_ for the cancellation from who
_performed_ it — MilMove's two-party split expressed as two fields on one record rather than as two
states — and it pairs a free `cancelReason` with a `cancelCategory`, which is the two-level shape
A4's `(scope, code)` already has.

### 2.8 "Eight values, three enums, no transitions, no actor" — `src:weichert-supplier-api` (grade B)

A live RMC partner contract, and the only one. Its HHG service status is printed as **three different
enums for the same field** depending on direction — inbound `Requested | Awarded | Cancelled`; accept
`Accepted | Submitted | Delivered`; update, the union of eight (odt:366-367 and six further places).
Read as a lifecycle the intent is legible, _"but the source never states a single transition,
ordering, or actor"_. `Authorized` appears in three of the vendor's own inbound **examples**
(odt:257, 1277, 2533) and in none of its enums.

Two things it does supply. **Accept is expressed as an update carrying an empty `shipments` array**
(odt:322 and identically at six further offsets) — the protocol fact behind
[`fork-order` §5.3](fork-order-shipment-cardinality.md)'s legal zero. And the Auto/Pet lane's
**eighteen-value** status list (odt:2984-2985) names the actor **inside the value**:
`Cancelled by Supplier`, `Cancelled by Customer`, `Reschedule Requested by Customer`,
`Reschedule Requested by Supplier`. That is the third independent source saying who-ended-it is
load-bearing, and the clearest example of the encoding §3.8 rejects.

### 2.9 "Cancel carries nothing, and reinstate exists" — `src:sirva-ade` (grade A)

A van line's own published event contract, `C1 = 3` and `C4 = 3`. It is cited here for two facts and
neither is a shape to copy.

`Cancel` — _"The shipment has been cancelled"_ — carries _"nothing further — **no reason code**"_
(SOE p.15), which [SD §2.3] invariant 2 forbids outright, and it is **shipment**-scoped in that
contract rather than order-scoped, so it supports nothing about the order's subject. Beside it sits
`Reinstate` — _"A previously canceled shipment has been restored to active status"_ — also carrying
nothing further. §3.3 decides what reinstatement is under this model, and the answer is not a type.

`QuoteBooked` and the lead `Disposition` / `Status` pair (LOD p.2) cover the pre-order phase, and
`SelfhaulIndicator` (GSD p.8) is the one published bit saying whether the booker will haul or
surrender — which §3.5 uses, because it decides which party the offer even goes to.

### 2.10 "Typed commercial refusal reasons" — `src:project44` (grade A, in one corner only)

`C1 = 1` overall and the whole A1 score is earned in the booking corner, but that corner holds
something no other source publishes: a **typed vocabulary for refusing a commercial offer**.
`BookingRejectionReason` is `COST_NOT_AGREED`, `SHORT_ON_STAFF`, `NOT_WITHIN_SCOPE`,
`TRANSIT_TIME_TOO_SHORT`, `REQUESTED_EQUIPMENT_NOT_AVAILABLE`, `OTHER`; the truckload tender push has
a second one — `DECLINED_CAPACITY_TYPE`, `DECLINED_CAPACITY_UNAVAILABLE`, `DECLINED_EQUIPMENT_TYPE`,
`DECLINED_EQUIPMENT_UNAVAILABLE`, `DECLINED_LENGTH_OF_HAUL`, `DECLINED_PERMITS`, `DECLINED_WEIGHT`
(`:50734`) — plus a free-text `declineReason`.

`BookingStatus` is _"the only place in the file with states, transitions **and** actor attribution"_
(`:28434`): _"Bookings start out in a `PROCESSING` state, only to be `BOOKED` or `REJECTED` by a
carrier… The state may shift to `CANCELLED` due to actions caused by **either party** in any state. A
booking is `EXPIRED` if it sits in the `PROCESSING` or `UNDER_REVIEW` status upon the time which it
is set to expire."_ **`EXPIRED` is the second source for a lapsed deadline as a first-class
terminal**, after DTR's non-response. And `CarrierResponseMethod ∈ API | EDI | EMAIL` treats EDI as
one transport among three for identical semantics, which is the posture [SD §5.1]'s `capturedBy`
already takes.

### 2.11 "The tender is an entity with an expiry, and a change is a proposal" — `src:alvys-api` (grade B)

`webhooks_tender-events` is the fullest lifecycle in the source: `tender.created` — _"A new inbound
tender is received, before anyone reviews or accepts it"_ — `tender.change.created`,
`tender.accepted`, `tender.rejected`, `tender.cancelled`, `tender.change.accepted`,
`tender.bid.submitted`, `tender.invoiced`. The `Tender` entity carries an **`ExpirationDate`**, which
is the third source for a lapsing offer.

The idea worth taking is `queuedForReview`: when a change tender arrives against a tender that
already has a linked load, _"the changes are queued and await acceptance"_ and the payload holds the
tender **before** the proposed changes; when false, _"its fields were replaced outright"_. A proposed
change and an applied change are different records — DCSA's parallel amendment track, in a vendor
API. Its `changeTypes` list is _"a stable contract"_ with the consumer instruction to _"treat any
value outside this list as unrecognized rather than failing on it"_, which is [catalog §2.3]'s own
closure obligation stated by a source.

The counter-position it also supplies is recorded at [A3 §2.7] and is not A1's: one trip = one load.

### 2.12 "Per-terminal reason catalogs" — `src:smartmoving-api` (grade B) — the position A1 rejects

Nine named states from lead to booked to completed/cancelled/lost/bad, with `C2 = 1` and `C3 = 1`:
_"states are explicit, **no transition is published and no operation sets status**"_, and
`Completed(10)` vs `Closed(11)` is undefined. What it does publish is **three distinct
tenant-configured reason catalogs, one per negative terminal** — `GET /api/cancellation-reasons`,
`/api/lost-reasons`, `/api/bad-lead-reasons` — surfaced back as **strings**, not ids.

Its analysis recommends this to us in as many words: _"our A1 reason codes should likewise be
per-terminal-state"_. §3.8 rejects it, and the rejection is not a matter of taste: [SD §2.4] rule 1
forbids exactly this, and it is what rule 2's arithmetic bounds.

### 2.13 Small but load-bearing contributions

| Source                                                                                                                | What it contributes to A1                                                                                                                                                                                                                                                                                                                                                                 | Grade |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src:uncefact-scrdm`                                                                                                  | `C2 = 3`. Quotation-request → quotation → order → **order-response** → contract as named document slots, and an `Exchanged_ Document` revision chain — `Previous Revision_ Identification`, `Amendment_ Purpose. Code`, `Cancellation. Date Time`, `Rejection_ Response. Date Time`, **`Response Reason. Code`** — explicit supersession plus a typed rejection reason, at document grain | A     |
| `src:uncefact-rec24`                                                                                                  | `6`/`7` `Booking_completed`/`cancelled`, `84` `Service_ordered`, `321`/`324` `Instruction_to_despatch_received`/`cancelled`, `77` `Refused_action`, `76` `Transport_re-arranged`. A status list, not a lifecycle — no offer, no award, no actor                                                                                                                                           | A     |
| `src:uncefact-mmt-rdm`                                                                                                | The **negative** citation that matters: quotation and order-confirmation are _"out of scope of MMT"_ (BRS p.11 sec 8.1.1). A reference model deliberately declining the area                                                                                                                                                                                                              | A     |
| `src:omnitracs-roadnet`                                                                                               | 43 typed `NotRoutedOrderReason`s and a 15-value `orderState` — but dispatch-side, about whether an order got onto a route, not about whether it was agreed                                                                                                                                                                                                                                | A     |
| `src:open-trip-model`                                                                                                 | `TransportOrder` is a grouping envelope; one shared six-value status enum, no transitions, no actor authority                                                                                                                                                                                                                                                                             | A     |
| `src:shippeo`                                                                                                         | `ORDER_CREATED`/`PENDING`/`CONFIRMED`/`IS_REFUSED`/`MODIFIED`/`IS_UNCHARTERED`/`UNFINISHED`/`CANCEL_ORDER` as codes, and nothing defining them                                                                                                                                                                                                                                            | B     |
| `src:x12-858-implementation-guide`                                                                                    | Tender-out only; `BX01` purpose codes given business meanings, including `01` _"the previous status… should be reverted"_ — a partner-level workaround for the 214's inability to retract                                                                                                                                                                                                 | B     |
| `src:milmove-docs`                                                                                                    | `C2 = 3` for one principle: **"every service must be ordered"** (`adrs/0055:133-140`), and ADR 0060's reasoning about an actionable-now marker                                                                                                                                                                                                                                            | A     |
| `src:nmfta-ebol`, `src:x12-212-trailer-manifest`, `src:macropoint`, `src:samsara`, `src:gtfs`, `src:smdg-delay-codes` | `n/a` or `C1 ≤ 1`. The document-lodging act, the manifest, the tracking session and the timetable have no order. Recorded so the absence is not read as an unread source                                                                                                                                                                                                                  | —     |

---

## 3. The decision

### 3.1 The shape, in one picture

```
Order                          subject = order:…   ([fork-order §3.1])
 │
 ├── orderAward          ─┐
 ├── orderResponse        ├─ three ACT records. Fact key (subject, type) — no qualifier.
 └── orderCancellation   ─┘  At most ONE selected fact per type per order, because
                             FactResolved picks one winner per key ([SD §4.3]) and
                             successive changes ride `supersedes` ([SD §4.7.2e] item 4).
                                        │
                                        ▼
                            orderStageAt(order, instant)   §3.3
                             a named, versioned FOLD — never stored,
                             never asserted, never corrected.
                             UNAWARDED · AWARDED · ACCEPTED · DECLINED · CANCELLED · UNKNOWN
```

Nothing is added to the record. **A1 mints no type, no aggregate, no field and no qualifier.** What
it adds is one projection, one reason code, and four declarations that were owed.

### 3.2 Element 558, mapped — owed item 1

> **Decision A1-RESPONSE. The four values of `src:stedi-x12-reference` element 558 map onto the
> published vocabulary as follows. The discriminator is a single question — _does a commitment
> stand after this record?_ — and it is answerable from the record without reading any other.**

| 558                            | What it says                                                                     | Record                                     | `outcome`                  | Reason obligation                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| **`A`** Reservation Accepted   | The offeree agrees, unconditionally                                              | `orderResponse`                            | `COMPLETED`                | `reasons[]` is **forbidden** — [SD §2.3] invariant 2                                 |
| **`B`** Conditional Acceptance | The offeree agrees **subject to a stated condition**; the commitment **stands**  | `orderResponse`                            | `COMPLETED_WITH_EXCEPTION` | ≥ 1 reason naming the condition; where the condition is a date, `remedy = newWindow` |
| **`C`** Counter Proposal Made  | The offeree does **not** agree to these terms and proposes others; no commitment | `orderResponse`                            | `NOT_COMPLETED`            | ≥ 1 reason; where the counter is a date, `remedy = newWindow`. Other counters — §3.6 |
| **`D`** Reservation Cancelled  | The reservation is ended after it stood                                          | `orderCancellation` — **a different type** | per §3.3                   | ≥ 1 reason                                                                           |

**Why `B` is `COMPLETED_WITH_EXCEPTION` and not `PARTIALLY_COMPLETED`.** [SD §2.2] keeps the two
apart because they "differ in **scope of performance**, and that difference is a billing and claims
difference, not a shade of meaning", and [SD §3.4] fixes the required form for a partial: the scope
is a **Portion** named in `reasons[].appliesTo`. A conditional acceptance is not partial — the
offeree answered **the whole offer** and attached a condition to the answer. The test is §3.3's
fold: `A` and `B` both leave the order **`ACCEPTED`**, and that is what "the commitment stands"
means operationally. If they mapped to different stages the mapping would be wrong.

**Where an acceptance genuinely is partial, and why A1 stops there.** The 990's `S5` stop loop lets
the acceptance be **per-stop** — _"so the acceptance can be per-stop and can attach its own times
and charges, not merely a yes"_. That is `PARTIALLY_COMPLETED`, and it **cannot be expressed**:
`Reason.appliesTo` is `SubjectRef<'portion' | 'item'>[]` ([SD §2.4], [catalog §5] item 4) and a stop
is neither. Widening it is refused here — [SD §5.4] keeps the two grains apart deliberately, and
none of §8's nine scenarios needs a per-stop acceptance. **Recorded owed** at §6, against
`appliesTo`, not patched.

**Why `D` is a different type rather than a fifth outcome.** [SD §4.7.2e] item 2 is binding: which
party ended it and at what stage is carried by **the stage plus `reasons[].attribution`**, and
`orderCancellation` is the stage-after-acceptance half of that split. `D` on the wire is a
cancellation; it is not a response, and reading it as one would put a termination into the same fact
key as an acceptance — one contest, two different questions.

**Two things this mapping is not.** It is **not** a wire format: element 558 is `src:stedi`'s code,
and nothing here says a producer sends `B`. And it does **not** re-read the outcome axis — [SD
§4.7.2e] item 1 already fixed `COMPLETED` = accepted and `NOT_COMPLETED` = declined, which is why
the outcome axis on `orderResponse` reads as the **content of the answer** rather than as the
performance of answering. A1 fills the two values that decision left blank and changes nothing else.
**[SYNTHESIS]**: the four codes and their glosses are `src:stedi`'s; the assignment to outcome
members is ours, forced by [SD §2.2]'s own distinction.

### 3.3 The order's stage is a projection — owed item 2

> **Decision A1-STAGE. An order's stage is not a field and not a record. It is
> `orderStageAt(order, instant)` — a named, versioned fold over the `FactResolved`-selected
> `orderAward`, `orderResponse` and `orderCancellation` assertions. It is never stored, never
> asserted and never corrected.**
>
> **Rule `ORDER-STAGE-AT`, version 1.**

This is not a free choice. [SD §1.1] forbids a mutable current-state field on the envelope; [A3 §3.4]
records `StopStatusChanged` rejected for the same reason; and [SD §4.8] already made exactly this
move for custody, for a reason that applies here verbatim — a stored stage would need an authority
row, and that row's binding would be the stage itself. What A1 decides is the **fold**, and
[`fork-order` §5.3](fork-order-shipment-cardinality.md) asked for precisely that: "the states an
order occupies before any shipment exists… and which of them may be terminal."

#### The stages

| Stage       | Meaning                                                                                    | Terminal?                                            |
| ----------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `UNAWARDED` | The order exists as a subject; no award stands. [`fork-order` §5.3]'s pre-commitment state | No                                                   |
| `AWARDED`   | An award stands and has not been answered                                                  | No                                                   |
| `ACCEPTED`  | A commitment stands — §3.2's `A` or `B`                                                    | No                                                   |
| `DECLINED`  | The offeree answered and the answer was no — §3.2's `C`                                    | **For this award.** A re-award supersedes; see below |
| `CANCELLED` | The commitment was ended after it stood                                                    | **For this award.** Same                             |
| `UNKNOWN`   | The published records do not settle it, with a named reason. Never filled in               | —                                                    |

Five stages and an `UNKNOWN`, against `src:weichert-supplier-api`'s eight,
`src:smartmoving-api`'s nine and `src:dcsa`'s nine. The difference is not economy: every value those
sources spend on **who** ended it, or on **what stage** of execution the goods have reached, is
carried here by `reasons[].attribution` ([SD §4.7.2e] item 2) or by a different area's records
entirely (§3.4).

**Terminal, and what "for this award" means.** `DECLINED` and `CANCELLED` do not destroy the order —
the aggregate survives and may be awarded again, which is one party revising its own assertion under
`supersedes` ([SD §4.1]: "an earlier assertion **by the SAME party** with the **SAME fact key**").
That is the whole mechanism, and it has a limit worth stating: **a re-award by a _different_ awarding
party is not a supersession but a competing assertion on the key `(order, orderAward)`**, which needs
the `orderAward` authority row to resolve — and that row is owed ([A8 §9 item 8]). §Cross-area hands
that to A8 as a consequence rather than as a request.

#### The fold

**Rule 1 — inputs.** Only `FactResolved`-selected assertions, exactly as [SD §4.8.3] rule 1 reads
custody. A resolution whose `selected` is `null` contributes nothing: a null selection is [A8 §7.3]
**A8-JOINT** declining to pick, and reading a loser out of it would be the silent selection A8-JOINT
forbids. Because none of the three types declares a qualifier, there are **at most three inputs**.

**Rule 2 — the outcome reading, per type.** The outcome axis does not read the same way on all three,
and that is [SD §4.7.2e] item 1's decision, not a liberty taken here: on `orderResponse` the outcome
is the **content of the answer**. A1 extends the same reading to the other two — **[ORIGINAL]** in
the extension, forced in the sense that a single reading cannot serve an offer, an answer and a
termination.

| Type                | `COMPLETED` | `COMPLETED_WITH_EXCEPTION` | `PARTIALLY_COMPLETED`                            | `NOT_COMPLETED`                      | `CANCELLED`                  |
| ------------------- | ----------- | -------------------------- | ------------------------------------------------ | ------------------------------------ | ---------------------------- |
| `orderAward`        | `AWARDED`   | `AWARDED`                  | `UNKNOWN` — `AWARD_SCOPE_NOT_EXPRESSIBLE`        | `UNAWARDED` — the award was not made | `UNKNOWN` — `ACT_CALLED_OFF` |
| `orderResponse`     | `ACCEPTED`  | `ACCEPTED`                 | `UNKNOWN` — `RESPONSE_SCOPE_NOT_EXPRESSIBLE`     | `DECLINED`                           | `UNKNOWN` — `ACT_CALLED_OFF` |
| `orderCancellation` | `CANCELLED` | `CANCELLED`                | `UNKNOWN` — `CANCELLATION_SCOPE_NOT_EXPRESSIBLE` | **does not govern** — see rule 3     | `UNKNOWN` — `ACT_CALLED_OFF` |

`ACT_CALLED_OFF` is the honest answer rather than a guess, and it names the mechanism that should
have been used instead: withdrawing an assertion is a **retraction** under [SD §6], not an outcome.
A commitment act published at `outcome = CANCELLED` is a record the type system admits and no
document reads, so the fold declines and says so. [SD §0] forbids guessing a value to make the
answer tidy.

**Rule 3 — a refused cancellation does not govern.** [SD §4.7.2e] item 3 settles the semantics —
"a cancellation is an act with an outcome, and a refused cancellation needs no new mechanism" — and
`src:dcsa` supplies the need, running cancellation on a third status track _"because cancelling a
confirmed booking is itself a request the carrier can refuse"_. In the fold this is one line: an
`orderCancellation` at `NOT_COMPLETED` is skipped, and the stage is whatever the next-latest
governing fact says. An order whose cancellation was refused is **still `ACCEPTED`**, and that is
§8's scenario 6.

**Rule 4 — the latest governing fact at or before the instant wins, and a tie is not broken.** Two
governing facts carrying the **same** `occurredAt` that would yield different stages return
`UNKNOWN` — `AMBIGUOUS_ORDER_AT_INSTANT`. This is [A8 §4.4] **A8-NAMED** in its commitment-side
form and it is [SD §4.8.3]'s **C6** applied to a second fold: the model publishes no tie-break here,
so the fold does not invent one by leaning on sort stability.

**Rule 5 — a response with no award behind it is `UNKNOWN`.** Where the governing fact is an
`orderResponse` and no selected `orderAward` stands at or before it, the fold returns `UNKNOWN` —
`RESPONSE_WITHOUT_AWARD`. **[ORIGINAL]**, and it is the commitment-side twin of [SD §4.8.3]'s C5: a
commitment whose offer was never published is one whose two parties cannot both be named, and
`src:dtr-part-iv` is explicit that the award is what selects the offeree (§C.2-§C.4). Answering
`ACCEPTED` there would let a commitment exist on one party's word alone — the foreclosure
[SD §4.7.2f] spent C5 to buy on the custody side.

**What the fold deliberately does not read.** `context[]` — [SD §1.4] rule 3. The shipments committed
under the order ride there, and the stage is therefore **independent of how many shipments exist**,
including zero. That is [`fork-order` §5.3](fork-order-shipment-cardinality.md)'s legal zero
surviving into the projection rather than being special-cased out of it, and it is why
`src:weichert-supplier-api`'s "accept is an update carrying an empty `shipments` array" needs no
rule of its own.

**Reinstatement is not a type.** `src:sirva-ade` publishes `Reinstate` — _"A previously canceled
shipment has been restored to active status"_ (SOE p.15) — and `src:stedi-x12-reference` element 353
distinguishes **`17` Cancel, to be Reissued** from `01` Cancellation and pairs it with `18` Reissue.
Under A1-STAGE both are already expressible and neither mints anything: a reissue is a **new
`orderAward` superseding the old one**, and `17`'s "expect a replacement" is a **reason on the
cancellation**, which is where [SD §4.7.2e] item 3 already placed it. What the corpus calls
reinstatement, this model calls the next award — and the difference is visible, because the reissued
award carries its own `occurredAt` and its own asserting party.

### 3.4 book, estimate submitted, complete — owed item 3

The rubric puts three more acts in A1's scope. None of them mints a type, and the reasons differ.

**Book — the same act as the award and the response, seen from one side.** `src:atlas-world-group-api`
carries `bookDate` / `bookedBy` / `booker` and `src:sirva-ade` publishes a `QuoteBooked` handoff;
[`fork-order` §3.1](fork-order-shipment-cardinality.md) already says a shipment is "minted by the
commitment (**registration / award / booking**)" — three words for one thing. Booking is what the
pair `orderAward` + `orderResponse` describes when the awarding party and the responding party are
**the same company**, which is [A8 §4.1]'s **A8-SELF** case and which `src:sirva-ade`'s
`SelfhaulIndicator` (GSD p.8) is the published bit for. A separate type would be one act with two
names depending on who held both roles. **No mint.**

**Estimate submitted — an absent fact class, and A1 must not reintroduce it.** [SD §4.7.3] lists
`estimate` and `survey` among the fact classes "named in the corpus and absent from the vocabulary…
so their absence is not read as an oversight", and [SD §6.2]'s one published amendment window
**governs `estimate`, which has no `type`**. `src:weichert-supplier-api`'s `Submitted`,
`src:atlas-world-group-api`'s `POST /Estimating/CreateOrder` and `src:smartmoving-api`'s lead ladder
all put the estimate on the order's own status ladder; A1 does not, because the estimate is A10's
fact class and putting it on the order's stage would make the stage answer a question about a
document. **No mint — and the residue is a real, named gap**: `src:cfr-49-375` §375.401(i) states an
invariant over a class that does not exist ("You may not amend the estimate after loading the
shipment"), which §6 records as owed against `estimate` rather than as an A1 rule with nothing to
constrain.

**Complete — a projection over a projection, and it is owed, for a reason worth keeping.** Every
source that has it derives it from execution rather than from agreement:
`src:atlas-world-group-api`'s `ord_completiondate`; `src:dtr-part-iv`'s **`Delivered Complete`**,
which the **TSP** enters and which unlocks destination invoicing, the Notice of Loss and Damage,
claim initiation and the satisfaction survey (§F.8.d(3) p. 31); `src:dcsa`'s `COMPLETED` —
_"The Transport Document this Booking is connected to has been **Surrendered for Delivery**"_.
In every case completion is read off the goods-side acts, which are A4's and A3's records, not A1's.

**And it collides with the legal zero, which is [ORIGINAL] and is the finding.** A completion rule
derived from the committed shipments' `delivery` acts is **undefined for an order with no
shipments** — and [`fork-order` §5.3](fork-order-shipment-cardinality.md) makes zero a legal value
of `N` on a live RMC wire. Either an accepted order with no shipments is vacuously complete the
instant it is accepted, or it can never be complete; no source in the corpus faces the question,
because no source in the corpus has a zero-shipment order. A1 therefore **declines to define a
`COMPLETE` stage** and records what would be needed: a settled reading of the empty case, plus the
goods-side terminal acts, which is A2's and A4's. The stage enum stops at the commitment, and that
boundary is now a stated rule rather than an omission.

### 3.5 Who may cause each transition — owed item 4

> **Decision A1-PERMISSION. A1 publishes which role may cause each transition, as a permission
> table. It does **not** publish who wins when two roles assert incompatible facts — that is [A8]'s,
> and A1 writes no authority row.**

The two are different questions and the corpus keeps them apart. [A8 §1] defines authority as the
resolution of a **contest**; permission is a property of a **single** record, and it is what
[A8 §8]'s `A8-UNAUTH` consumes. Stating the boundary is not pedantry: §Cross-area shows that
conflating them is what makes A8's own ledger read as more pessimistic than the corpus warrants.

The table is derived from the two regulation-grade sources that publish an actor per edge —
`src:dtr-part-iv` A-402 §C-§F and `src:cfr-49-375` — with `src:milmove-mymove` and
`src:atlas-world-group-api` corroborating the split it turns on.

| Transition                         | Record                                                     | Who may cause it                                                          | Condition on the permission                                                                                                                                     | Cite                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `UNAWARDED` → `AWARDED`            | `orderAward`, `COMPLETED`                                  | the **awarding** role                                                     | none stated                                                                                                                                                     | `src:dtr-part-iv` §C.2-§C.3; `src:atlas` `bookedBy`                                                               |
| `AWARDED` → `ACCEPTED`             | `orderResponse`, `COMPLETED` / `…_EXCEPTION`               | the **offeree**, and only the offeree                                     | a deadline runs — **24 h**, time-zone aware                                                                                                                     | `src:dtr-part-iv` §C.4.a p. 6                                                                                     |
| `AWARDED` → `DECLINED`             | `orderResponse`, `NOT_COMPLETED`                           | the **offeree**, and only the offeree                                     | **conditional**: permitted _only_ for a short-fuse or shortened-transit shipment; otherwise the refusal is itself a breach carrying 30-day market ineligibility | `src:dtr-part-iv` §C.4.a, §F.2.a; `src:dp3-tender-of-service` §B.18.a                                             |
| `AWARDED` → `CANCELLED`            | `orderCancellation`, `COMPLETED`, before any response      | the **awarding** role                                                     | DTR's **pull-back**: free for the awarder's own convenience, **charged** where the offeree caused it. It is a withdrawal act, not an award undone — see below   | `src:dtr-part-iv` §C.6.a-b p. 9                                                                                   |
| `AWARDED` → (deadline lapses)      | `orderResponse`, `NOT_COMPLETED`, reason `DEADLINE_LAPSED` | **nobody** — see below                                                    | the offer's own expiry                                                                                                                                          | `src:dtr-part-iv` §C.4.b; `src:project44` `EXPIRED`; `src:alvys-api` `ExpirationDate`                             |
| `ACCEPTED` → `CANCELLED`           | `orderCancellation`, `COMPLETED`                           | **either party** — the distinction is the attribution, not the permission | DTR: the awarder cancels "in the interest of the Government" without charge; the offeree turns back and is charged, with a 14-day rule                          | `src:dtr-part-iv` §C.5, §C.6.b-d; `src:project44` "caused by **either party**"; `src:dcsa` `CANCELLED`/`DECLINED` |
| a cancellation is **refused**      | `orderCancellation`, `NOT_COMPLETED`                       | the **counterparty** of whoever requested it                              | `src:dcsa`'s third track; `src:milmove-mymove`'s two-actor split                                                                                                | `src:dcsa` L1513-1520; `src:milmove-mymove` `swagger/prime.yaml` L785-790                                         |
| `DECLINED`/`CANCELLED` → `AWARDED` | `orderAward`, `COMPLETED`, superseding the earlier award   | the **awarding** role                                                     | the re-award case. **A re-award by a _different_ party is not this** — §3.3                                                                                     | [SD §4.1] `supersedes`                                                                                            |

**Two rows are worth reading against the fold, because a plausible mis-statement of each was in an
earlier draft of this table.**

- **A pull-back is not an award undone.** There is no `orderAward` outcome that removes a standing
  award: under §3.3 rule 2 an award at `NOT_COMPLETED` means the award was never made, which is
  DTR's blackout and not its pull-back. Withdrawing an award that **was** made is a withdrawal act
  — `orderCancellation` before any response, which is
  [`fork-order` §5.3](fork-order-shipment-cardinality.md)'s "cancelled-pre-commitment" state and
  which the fold answers **`CANCELLED`**.
- **A re-award yields `AWARDED`, not `UNAWARDED`.** The superseding record is an `orderAward` at
  `COMPLETED`, and §3.3 rule 2 reads that as `AWARDED` — which is precisely what makes the re-award
  argument work: a declined or cancelled order is terminal **for that award**, and the next award
  puts it back in play. A row saying the supersession returns the order to `UNAWARDED` would
  contradict the fold it is a table of.

Three rules govern reading it.

> **A1-PERM-1 — permission is a property of the record, not of the party.** The offeree may accept;
> nobody else may. `src:milmove-mymove` states the strongest form of this in a running system —
> _"the **request** and the **act** are different actors: the TOO sets `CANCELLATION_REQUESTED`, and
> only the mover can then move it to `CANCELED`"_, and _"the Prime cannot update the shipment to any
> other status"_. **Sourced.**

> **A1-PERM-2 — the requestor and the actor are two different fields, not two states.**
> `src:atlas-world-group-api` carries both on one record — **`cancelRequestor`** and
> **`cancelledBy`** (`atlasorder-v1.json:11324`) — where MilMove carries them as two states. A1 takes
> Atlas's shape and the model has the fields: the **actor** is `assertedBy` on the
> `orderCancellation`, and the **requestor** is `reasons[].attribution`. That is [SD §2.4] rule 6
> doing exactly the work it was lifted out of the code to do, and it is why no cancellation type
> needs to name a party. **[SYNTHESIS]** — the two-field shape is Atlas's, the placement is ours.

**And the placement has a hole, which was found in a test rather than in prose.** [SD §2.3]
invariant 2 **forbids** `reasons[]` at `outcome = COMPLETED` — so on a cancellation that
**succeeded**, which is the ordinary case and the one §8's scenario 6 runs, the field
[SD §4.7.2e] item 2 puts the requestor on **does not exist**.
`tests/scenarios/cancelled-after-packing-before-loading.test.ts` already asserts it as a finding:
the attribution is available on the **refused** branch and unavailable on the completed one, and
what remains is `assertedBy`, which is who _said_ it.

A1 does not patch this, and records the three things that are true instead:

1. **The requestor may ride `context[]`** — [SD §4.7.1]'s order row already carries "the awarding and
   the responding `partyRole`s" there, and naming a third is a cross-reference rather than a value,
   so [SD §1.4] rule 2 permits it. But `context[]` is **non-authoritative by construction** (rule 1),
   so a consumer that must bill the requestor — which is exactly what `src:dtr-part-iv` §C.6.a-b's
   charged pull-back requires — cannot rely on it.
2. **The gap is the shared layer's, not A1's.** Item 2's placement rule is [SD §4.7.2e]'s and
   invariant 2 is [SD §2.3]'s; the two meet on a record neither section considered. Closing it means
   either a new field on the act or an outcome reading that makes a requested-and-performed
   cancellation exceptional, and both are [SD]'s call. §6 records it owed.
3. **It does not reach `orderResponse`.** A declined response is `NOT_COMPLETED` by §3.2, so it
   always carries at least one reason and its attribution is always available. The hole is
   specifically the **completed cancellation**.

> **A1-PERM-3 — a permission may be conditional on the offer's own properties, and one is.**
> `src:dtr-part-iv` §C.4.a permits refusal **only** for a short-fuse or shortened-transit shipment.
> This is the cleanest published instance of [A8 §8]'s `A8-UNAUTH`: the same record by the same role
> is authorised or not depending on a property of the thing it is about. §Cross-area hands it to A8
> as a worked case, because A8 §8 asks for exactly this and cites two others.

**The edge with no actor, and why it needs a reason code.** `src:dtr-part-iv` §C.4.b publishes
non-response as a **typed event caused by nobody** — DPS charges an allocation, sends a "Notice of
Non-Response" and offers the next TSP, and the PPSO must **overtly** confirm it was not a system
fault before suspending. `src:project44`'s `EXPIRED` and `src:alvys-api`'s tender `ExpirationDate`
are the same shape in two vendor APIs. Under [SD §2.3] invariant 2 an `orderResponse` at
`NOT_COMPLETED` must carry at least one reason, and §3.6 shows that none of the 23 published members
can be that reason. This is the one gap A1 mints into.

### 3.6 The reason vocabulary at commitment grain — owed item 5

[A4 §3] rule 4 is binding: **the same vocabulary at every grain.** [SD §2.3] invariant 2 already
requires a reason on every declined `orderResponse` and on every **refused** cancellation — not on a
completed one, where it forbids them, which is A1-PERM-2's hole — so the question is due now. A1 read the corpus's two published commercial-refusal vocabularies —
`src:project44`'s `BookingRejectionReason` and its truckload tender-decline list — against the 23
members, which A4 cut from execution-event sources.

| Corpus code                                                                                                                                                                   | Verdict                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHORT_ON_STAFF`, `REQUESTED_EQUIPMENT_NOT_AVAILABLE`, `DECLINED_CAPACITY_UNAVAILABLE`, `DECLINED_EQUIPMENT_UNAVAILABLE`                                                      | **Covered** by `RESOURCE_UNAVAILABLE`, whose own citation already reaches driver-not-available and the per-resource waiting family                                                                    |
| `DECLINED_PERMITS`                                                                                                                                                            | **Covered** by `AUTHORISATION_MISSING`                                                                                                                                                                |
| `OTHER`, and `src:smartmoving-api`'s three tenant catalogs                                                                                                                    | **Covered** by the open member `OTHER` with its mandatory remark — [SD §2.4] rule 3. A tenant-configured catalog is evidence for an open member, never for members                                    |
| DTR's cancel / pull-back / turn-back liability split                                                                                                                          | **Not a code.** The distinction is _who_ and _with what liability_, which [SD §4.7.2e] item 2 already put on `reasons[].attribution`. Minting codes for it is the `src:weichert` eighteen-value error |
| `src:project44` `EXPIRED`; DTR non-response; `src:alvys-api` `ExpirationDate`                                                                                                 | **Not covered → minted.** `DEADLINE_LAPSED`, below                                                                                                                                                    |
| `COST_NOT_AGREED`; element 558 `C`                                                                                                                                            | **Not covered, and not A4's.** See below                                                                                                                                                              |
| `NOT_WITHIN_SCOPE`, `DECLINED_CAPACITY_TYPE`, `DECLINED_EQUIPMENT_TYPE`, `DECLINED_LENGTH_OF_HAUL`, `DECLINED_WEIGHT`; `src:dp3-tender-of-service`'s refusal-by-article-class | **Not covered, and not A4's.** See below                                                                                                                                                              |
| `TRANSIT_TIME_TOO_SHORT`; short fuse                                                                                                                                          | **Not covered, and not a reason.** See below                                                                                                                                                          |

#### The one mint: `DEADLINE_LAPSED`

> Scope `ACT` · `partyRequired: false` · no remedy · **[SYNTHESIS]**
>
> Three independent sources publish a lapsing offer as a first-class terminal —
> `src:dtr-part-iv` §C.4.b (non-response, "caused by nobody", with a named notice and an
> escalation), `src:project44` (`EXPIRED`, `:28434`) and `src:alvys-api` (the tender's
> `ExpirationDate`). The **collapse into one grain-independent code** is ours, which is why it
> carries a marker: the three publish it as a status, a field and a notice respectively.

It passes [SD §2.4]'s six rules. Rule 1 — it names no outcome and no completion verb; the outcome is
`NOT_COMPLETED` and the code says why, which is that time ran out. Rule 4 — it is grain-independent
and reaches an execution act directly: a delivery window that expires unattempted is the same fact.
Rule 6 — it is the **third** published code that attributes to **nobody**, after `FORCE_MAJEURE` and
`CAUSE_UNKNOWN`, and this one is regulation-grade about it. That strengthens rather than repeats
[A4 §5]'s hand-off: the owed `roleClass` enum needs an explicit non-party member, and it is now
required by three members of a published vocabulary.

#### The three that are not A4's, with the argument in each case

Each of these looks like a missing reason code and is not. Recording why is the more useful half of
this section, because the naive fix — mint four codes from `src:project44`'s list — would have put
the same fact on two axes three times.

1. **`COST_NOT_AGREED` and element 558's `C` are a `charge` fact, not a reason.** [A8 §5 row 11],
   as corrected by [SD §4.7.2b], gives `charge` the qualifier `{aspect}` with `PROPOSED`, `DECIDED`
   and `RATED` as three separate fact keys, each with its own authority — a **proposal** authority
   and a **decision** authority. A counter-proposal on price is a competing `charge` at `PROPOSED`,
   asserted by the offeree. Minting a reason code for it would carry the same disagreement on the
   reason axis and on the charge axis at once, which is the duplication [A4 §4.1] collapsed `MQP`
   and `MQT` to remove. `src:cfr-49-375` §375.403(a)(8) — _carrier proposes, shipper decides_, with
   a one-hour minimum — is the propose/decide pair stated in a regulation. **The reason on the
   declining response names the act's own failure; the number lives on the charge.**

2. **`NOT_WITHIN_SCOPE` and the four typed `DECLINED_*` refusals are a property of the party, and
   the party entity does not exist.** "This carrier does not handle this length of haul" is a
   standing fact about a party, not a fact about this act — it is true of every offer that party
   will ever receive. [A8 §9 item 1] owes the party entity ("there is none anywhere in the corpus")
   and [A8 §9 item 5] owes role cardinality and exclusivity; until they land, such a fact has no
   subject to be about. `src:dp3-tender-of-service`'s refusal-to-accept-property list is enumerated
   **by article class**, which is the same shape at the goods end and equally has nowhere to live.
   **Owed to [A8 §9 items 1 and 5]**, recorded at §6.

3. **`TRANSIT_TIME_TOO_SHORT` is a property of the award, and the award carries no such field.**
   `src:dp3-tender-of-service` names **short fuse** as a property of the award that changes which
   deadlines apply (HHG §B.18.a, §C.2.d), and `src:dtr-part-iv` §C.4.a makes it the **only legal
   ground for refusal** — so it is a precondition on a permission (A1-PERM-3), not an explanation
   after the fact. Carrying it as a reason on the response would put the offer's property on the
   answer's record. It is an **absent fact class** in [SD §4.7.3]'s sense: named in the corpus,
   carried by no type. Recorded at §6.

### 3.7 The criteria weighted, and why

The rubric requires the weights to be recorded per area. A1 weights **C3 heaviest**, then C7, then
C2; it discounts C1 and C5 and scores C4 as a gate rather than a weight.

1. **C3 — lifecycle rigor, weighted highest, and it is what separates the corpus.** Six sources
   score `C1 = 3` on A1 and only three score `C3 = 3`. Every question A1 was actually asked — which
   outcome, which stage, who may cause it, what a refused cancellation means — is a C3 question, and
   the sources that score high on C1 alone (`src:atlas-world-group-api`, `src:weichert-supplier-api`,
   `src:sirva-ade`) contributed **names and actors** while contributing no transition at all.
2. **C7 — evidence, provenance and corrections, second.** [SD §4.7.2e] item 2's decision is a C7
   decision: who ended it is provenance, and the sources that carry it (`src:dcsa`,
   `src:atlas-world-group-api`, `src:milmove-mymove`) are the ones that decided §3.5. `src:uncefact-scrdm`'s
   `Exchanged_ Document` revision chain is the corpus's only explicit supersession model and is what
   `supersedes` is being held against.
3. **C2 — semantic precision, third, and it is the reason `src:dcsa` wins where it is not HHG.**
   DCSA defines each of its nine statuses **verbatim**; Atlas defines none of its A1 fields and
   Weichert defines none of its eight values. A vocabulary that is not defined cannot be compared,
   which is why `src:atlas-world-group-api` is cited here for a **field shape** and never for a
   meaning.
4. **C1 — coverage, discounted deliberately.** The three sources with `C1 = 3` and HHG fidelity
   contributed the least structure. Coverage in A1 means "has an order object with a status column",
   which every TMS has.
5. **C5 — time, discounted.** A1's transitions carry deadlines, and the deadlines matter to §3.5's
   permissions — but the time model itself is settled at [SD §4.2] and [SD §4.5] and is not
   relitigated here. The one A1-specific datum is `src:stedi`'s `B1-03`, "the booking date accepted
   by the carrier", which §3.2 records and which the acceptance's own `occurredAt` already carries.
6. **C4 — HHG fidelity, a gate rather than a weight.** A shape that cannot express a van line
   awarding to its own agent (`A8-SELF`, `SelfhaulIndicator`) or an RMC accepting with zero
   shipments is rejected outright; among shapes that can, C4 does not discriminate, because the two
   sources with `C4 = 3` on A1 score `C3 = 1` and `C3 = 1`.

**The best source per criterion**, which is what phase 3 asks for: `src:dcsa` on C2 and C3;
`src:dtr-part-iv` on C3 and C4 jointly and on "who may cause it" outright; `src:cfr-49-375` on the
invariants; `src:stedi-x12-reference` on the response vocabulary; `src:project44` on refusal reasons;
`src:atlas-world-group-api` on the cancellation field shape. **No single source wins A1**, and the
decision above takes something from six of them.

### 3.8 Explicitly rejected

| Rejected                                                 | Source                                                                                                                        | Why                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A mutable `orderStatus` field                            | `src:weichert-supplier-api`, `src:atlas-world-group-api`, `src:shippeo`                                                       | [SD §1.1] forbids it on the envelope, and [SD §4.8] already answered the same question for custody. The stage is a fold                                                                                                                       |
| The actor encoded **inside a status value**              | `src:weichert-supplier-api`'s eighteen Auto/Pet values (`Cancelled by Supplier`, `Cancelled by Customer`, …)                  | [SD §4.7.2e] item 2: who ended it rides `reasons[].attribution`. Encoding it in the value multiplies the vocabulary by the party list and makes a new party a schema change                                                                   |
| **Per-terminal-state reason catalogs**                   | `src:smartmoving-api`, which recommends it to us explicitly                                                                   | [SD §2.4] rule 1 forbids it outright — reasons are orthogonal to outcomes and are reused across them. It is also what rule 2's arithmetic bounds: three catalogs is the start of the ~100-types explosion the factorisation exists to prevent |
| A reason surfaced as a **free string** rather than an id | `src:smartmoving-api` (`cancellationReason`, `lostReason` are strings); `src:atlas-world-group-api` (`cancelReason`)          | A vocabulary that is not published cannot be resolved by a consumer. The two-level shape Atlas reaches for with `cancelReason` + `cancelCategory` is already `(code, scope)`                                                                  |
| A cancellation carrying **no reason**                    | `src:sirva-ade` `Cancel` (SOE p.15)                                                                                           | [SD §2.3] invariant 2. The single clearest anti-pattern in the corpus, and [SD §4.7.2e] already cites it                                                                                                                                      |
| **Reinstate** as a record type                           | `src:sirva-ade` `Reinstate`                                                                                                   | §3.3: a reissue is the next `orderAward`, superseding. A type would let an order be un-cancelled without anyone re-offering it                                                                                                                |
| A **timestamp column per state** as the audit trail      | `src:milmove-mymove` `move.go:59-89`                                                                                          | It is a denormalisation of the records, not a source of them, and it cannot carry a second asserter or a correction. [SD §4] already holds the history                                                                                        |
| A **lead / estimate / order** single status ladder       | `src:smartmoving-api` (lead → booked → completed), `src:weichert-supplier-api` (`Submitted` between `Accepted` and `Awarded`) | §3.4: the estimate is A10's absent fact class and the lead is A10's entirely. A single ladder makes the order's stage answer a question about a document                                                                                      |
| A **generic status vocabulary keyed by document type**   | `src:dcsa`'s 17-value `shipmentEventTypeCode` × 23 `documentTypeCode`                                                         | Elegant and wrong here: its own analysis notes "a consumer cannot tell from the event name alone which lifecycle is being described", and [SD §1.3]'s **A-TYPE** makes `type` the fact class precisely to avoid a second axis                 |
| A **counter-proposal as a new award** by the offeree     | implied by element 558 `C` read naively                                                                                       | `orderAward` mints the principal relation ([A8 §4.3]); letting the offeree mint it would make the offeree its own principal. The counter rides the declining response's `remedy` and, for price, the `charge` at `PROPOSED`                   |
| `PARTY_REFUSED` as the reason on a declined response     | available, and tempting                                                                                                       | Legal and useless: `outcome = NOT_COMPLETED` on an `orderResponse` **already means** the party declined ([SD §4.7.2e] item 1), so the code would restate the outcome — rule 1's failure mode from the other direction                         |

---

## 4. What this forecloses, and the cost if it is wrong

**Foreclosed by design:**

1. **`order.status` as a read.** Every consumer that wants the stage calls the fold, or is served
   its output. There is no column to select and no field to patch, which is the point: the answer
   names the rule that produced it and the records it read.
2. **A fifth commitment act.** `book`, `submit`, `reinstate`, `reissue`, `expire`, `pull back`,
   `turn back` — every verb the corpus names is one of the three types plus an outcome, an
   attribution or a reason. Adding a fourth type is `newClosedEnumMember` and additive
   ([catalog §2.3]); it is cheap to do and was not needed.
3. **A stage that knows about the goods.** The fold does not read `context[]`, so the stage cannot
   depend on how many shipments exist or on what has happened to them. That is what makes the
   zero-shipment order ordinary rather than special, and it is why §3.4 could not define `COMPLETE`
   without reaching outside A1.
4. **Un-cancelling.** There is no act that reverses an `orderCancellation`. A reissue is the next
   award, and it carries its own asserter and its own time.

**The cost if each is wrong:**

- **If the stage should have been a record** — for instance if a partner genuinely asserts a stage
  rather than the acts under it — the repair is to mint a type, which is additive. The fold would
  then be one of two answers, and [A8 §4.4]'s A8-NAMED would demand a rule saying which wins. Cheap.
- **If `B` should have been `PARTIALLY_COMPLETED`** — that is, if conditional acceptance really is a
  scope reduction rather than a condition — the repair is a re-read of published records, because
  nothing about the record shape changes. Cheap, and §8's scenarios would catch it.
- **If `orderResponse` needed a qualifier** — the per-stop acceptance case, or an order awarded to
  two parties in parallel — the repair is **`changedQualifierShape`: breaking, a new major**
  ([catalog §2.3]). This is the expensive direction, and it is why §3.2 refused to widen
  `appliesTo` on the strength of a case no scenario needs.
- **If `COMPLETE` should have been a stage** — repair is additive: one more member of the projection's
  return type, computed from records that already exist. The reason A1 did not guess is that guessing
  wrong about the **empty** case would have shipped an answer that no source and no scenario tests.

---

## 5. ORIGINAL design — what household-goods moving needs that no source supplied

Four things, and each is marked where it is used.

**5.1 A commitment whose two parties can both be named, or no commitment.** Rule 5 of the fold —
`RESPONSE_WITHOUT_AWARD` — is **[ORIGINAL]**. No source in the corpus can produce the state: every
one of them models the offer and the answer inside one object with one identity, so an answer
without an offer is unrepresentable by construction rather than by rule. Under an append-only
envelope where two parties publish independently, it is not only representable but likely — a
partner that emits only its acceptance is exactly `src:sirva-ade`'s posture on the custody side,
where it emits only one half of a transfer. The rule is the commitment-side twin of
[SD §4.8.3]'s C5 and it is justified on the same ground: a commitment that exists on one party's
word alone is not one this model will name.

**5.2 A stage that is independent of the goods, so that zero shipments is ordinary.**
**[ORIGINAL]** as a rule, forced by a sourced fact. `src:weichert-supplier-api` expresses acceptance
as an update carrying an **empty `shipments` array** (odt:322), which
[`fork-order` §5.3](fork-order-shipment-cardinality.md) recorded as a protocol fact with no model
behind it. A1 gives it a model, and the model is a negative: the fold does not read `context[]`. Six
of the corpus's A1 sources carry a status that means "in progress" or "delivered" on the same ladder
as "accepted", and every one of them would have to special-case the empty order. This one does not
have the case.

**5.3 A completion rule that cannot be written, and the reason.** Recorded as **[ORIGINAL]**
analysis rather than as a decision. Every source derives completion from execution; none has a
zero-shipment order; therefore no source has had to say whether an accepted order with nothing
committed under it is vacuously complete or never complete. §3.4 states the fork and declines both
branches. This is worth keeping because it is the clearest instance in A1 of a gap that the corpus
cannot close **because of a decision we made** — the 1:N cardinality with a legal zero — rather than
because the corpus is thin.

**5.4 The requestor/actor split placed on two existing fields.** **[SYNTHESIS]**. That the two are
different parties is sourced three ways — `src:milmove-mymove` as two states with two permissions,
`src:atlas-world-group-api` as two fields on one record (`cancelRequestor`, `cancelledBy`),
`src:dcsa` as a third status track. Putting the actor on `assertedBy` and the requestor on
`reasons[].attribution` is ours, and it is what makes A1 mint no field: [SD §2.4] rule 6 lifted
attribution onto its own field for a reason that turns out to reach the commitment side unchanged.

---

## 6. What only the user can decide, and what is owed elsewhere

### Owed, with an owner

| Owed                                                                                                          | Owed to                              | Why it is not decided here                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Per-stop acceptance** — `orderResponse` at `PARTIALLY_COMPLETED`                                            | [SD §2.4] / [catalog §5] item 4      | `Reason.appliesTo` is `SubjectRef<'portion' \| 'item'>[]` and a stop is neither. Widening it fuses two grains [SD §5.4] separates deliberately                                                                                                                                                                                             |
| **A "this party does not handle this" fact** — `src:project44` `NOT_WITHIN_SCOPE` and the four typed refusals | [A8 §9 items 1 and 5]                | A standing property of a party, and the party entity does not exist                                                                                                                                                                                                                                                                        |
| **Short fuse / shortened transit as a property of the award**                                                 | [SD §4.7.3] — an absent fact class   | It is a precondition on a permission (A1-PERM-3), not a reason; no type carries it                                                                                                                                                                                                                                                         |
| **A `COMPLETE` stage**                                                                                        | **A4**, and §3.4's fork — A2 is done | [`A2` §3.4](A2-shipment-structure.md) discharges A2's half: the zero-shipment order needs no reading beyond [`fork-order` §5.3]'s, because `orderStageAt` never counts shipments. It also names a **third** blocker this row did not have — **which** shipments were committed is not published either (`shipmentCommitment`, [`A2` §3.6]) |
| **`estimate` as a fact class**, which `src:cfr-49-375` §375.401(i) states an invariant over                   | [SD §4.7.3] / A10                    | Already on [SD §4.7.3]'s absent list. A1 adds the invariant that is waiting for it, and mints nothing                                                                                                                                                                                                                                      |
| **A remedy shape for a counter-proposal that is not a date**                                                  | [A4 §5] item 2, and A7 for price     | [A4 §3] types `newWindow` and carries the rest as owed. §3.6 argues a price counter is a `charge` at `PROPOSED`, which is A7's; other counters are unenumerated                                                                                                                                                                            |
| **The three order authority rows**                                                                            | [A8 §9 item 8] — see §Cross-area     | A1 writes no row. What it hands A8 is a correction to the ledger's reasoning, not a row                                                                                                                                                                                                                                                    |
| **The requestor of a _completed_ cancellation** — A1-PERM-2's hole                                            | [SD §4.7.2e] item 2 / [SD §2.3]      | Invariant 2 forbids `reasons[]` at `COMPLETED`, so the field item 2 names does not exist there. A new field, or an outcome reading that makes it exceptional                                                                                                                                                                               |

### What only the user can decide

1. **Does an accepted order with no shipments ever complete?** §3.4 and §5.3. The corpus cannot
   answer it, because the case is ours. A rule either way is a business policy, and the model should
   be told rather than guess.
2. **Is the relocation level promoted to an aggregate?** This is
   [`fork-order` §3.5(b)](fork-order-shipment-cardinality.md)'s user question 1, restated here
   because A1 found a second thing that turns on it: the awarding role in a commercial move is
   determined by a relation that exists **before** the order — `src:dtr-part-iv`'s PPSO is fixed by
   the member's installation, not by this award — and there is nowhere above the order for such a
   relation to live. If the relocation level lands, the `orderAward` authority row becomes a
   different question.
3. **Is a re-award by a different awarding party a case the business has?** §3.3 shows it is not
   expressible as a supersession and needs the authority row. Whether it happens is not a question
   the corpus answers.

---

## 7. Confidence

| Item                                                        | Confidence                                                                  | What would overturn it                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§3.2 element 558 `A`/`D`**                                | **High**                                                                    | `A` is the definition of acceptance and `D` is a cancellation by [SD §4.7.2e] item 2's own reading. Neither is a judgement call                                                                                                                                                                                                                                     |
| **§3.2 `B` → `COMPLETED_WITH_EXCEPTION`**                   | **Medium-high — [SYNTHESIS]**                                               | The codes are `src:stedi`'s; the assignment is ours, made on [SD §2.2]'s own scope-of-performance distinction. A published model that reads conditional acceptance as a scope reduction would overturn it — none does, and the 990's per-stop loop is the **partial** case, which §3.2 keeps separate and leaves owed                                               |
| **§3.2 `C` → `NOT_COMPLETED`**                              | **Medium-high**                                                             | Rests on "does a commitment stand". If a counter-proposal in practice leaves the original offer alive pending the counter — which `src:dcsa`'s co-existing amendment track would suggest at the **amendment** stage — the right answer might be a parallel track rather than a declining response. That is the one place A1 declined to copy DCSA, and §4 prices it |
| **§3.3 the stage is a projection**                          | **High**                                                                    | Not A1's decision to make: [SD §1.1] forbids the field and [SD §4.8] set the precedent. It would be overturned only by reopening the shared layer                                                                                                                                                                                                                   |
| **§3.3 the five stages and their terminality**              | **Medium-high — [ORIGINAL] in the cut**                                     | Every stage is named by at least three sources. The **cut** — five rather than eight or nine — is ours, and it rests on [SD §4.7.2e] item 2 taking the who-ended-it values off the ladder. If attribution turns out not to be reliably present, the DCSA nine-value ladder is the fallback and it is a breaking change to adopt                                     |
| **§3.3 rule 3, the refused cancellation**                   | **High**                                                                    | [SD §4.7.2e] item 3 decides the semantics; the fold only implements them. `src:dcsa` and `src:milmove-mymove` both publish the refusal                                                                                                                                                                                                                              |
| **§3.3 rule 5, `RESPONSE_WITHOUT_AWARD`**                   | **Medium — [ORIGINAL]**                                                     | Unsourced, and argued from the custody side's C5 rather than from the corpus. A partner that legitimately publishes acceptances without awards — an RMC that treats its own request as the award — would make it a nuisance rather than a guard. It is cheap to relax: the branch is one condition                                                                  |
| **§3.4 book, estimate, complete**                           | **High on estimate, medium-high on the rest**                               | `estimate` is [SD §4.7.3]'s call, already made. `book` rests on [`fork-order` §3.1]'s own three-word gloss plus A8-SELF. `complete` is a refusal to decide and carries its reasoning                                                                                                                                                                                |
| **§3.5 the permission table**                               | **Medium-high**                                                             | Every row is cited, and the two regulation-grade sources agree wherever they overlap. What is authored is the **generalisation**: DTR's PPSO/TSP pair is a government programme, and reading it as "the awarding role" and "the offeree" is ours. A commercial van line where the hauling agent may cancel an accepted order would need a row this table forbids    |
| **§3.5 A1-PERM-2, the requestor/actor split**               | **High that the two are different parties; the PLACEMENT has a known hole** | Three independent sources, one a running system with the permission enforced, so the distinction is not in doubt. What is in doubt is where the requestor lives on a **completed** cancellation, where [SD §2.3] invariant 2 forbids the field [SD §4.7.2e] item 2 names. §3.5 carries the three readings and §6 carries it owed                                    |
| **§3.6 `DEADLINE_LAPSED`**                                  | **Medium-high — [SYNTHESIS]**                                               | Three sources, three different shapes. What would overturn it: a finding that a lapsed offer is better modelled as the **absence** of a response than as a response at `NOT_COMPLETED`. A1 chose the record because [SD §2.3] invariant 2 needs something to attach to and because DTR publishes a notice, which is an act by somebody                              |
| **§3.6's three refusals to mint**                           | **Medium-high**                                                             | Each is an argument from a settled decision elsewhere ([A8 §5 row 11]; [A8 §9 items 1, 5]; [SD §4.7.3]). If any of those moves, the argument moves with it                                                                                                                                                                                                          |
| **The document as an input to other documents' confidence** | **Medium**                                                                  | A1's own decisions rest on the shared layer, which is solid. What caps it is that the three order authority rows are **owed** — [SD §4.7] note 3 bars a provisional reading from scoring a dependent decision above medium, and every question of the form "whose stage is it when two parties disagree" lands there                                                |

### Assertions made here that no source supports

- Rule 5 of the fold (`RESPONSE_WITHOUT_AWARD`) — §5.1.
- The stage's independence from `context[]` as a **rule** rather than as an accident — §5.2.
- The five-stage cut.
- The extension of [SD §4.7.2e] item 1's per-type outcome reading to `orderAward` and
  `orderCancellation` — §3.3 rule 2.

---

## 8. Acceptance — the nine scenarios, run explicitly

The same nine the shared layer holds every area to ([A3 §8], [`fork-order` §8]). Most of them are
not A1's, and saying so precisely is the point of running them: an area document that reports nine
successes has usually answered questions it was not asked. **A1 is decisive in three, contributes a
precondition to four, and is silent in two.**

### 1. Five families' goods on one van over four days — **A1 is silent, and that is the answer**

Five orders, five commitments, one trip. A1 contributes nothing beyond the cardinality that
[`fork-order` §3.1](fork-order-shipment-cardinality.md) already fixed, and that is the test: **the
consolidation is entirely below the commitment.** If any A1 record had needed to know that four
other families were on the van, the order would be carrying a fact about a trip.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **A1 contributes a precondition**

The destination agent that delivers out is not the party that accepted the award. Under A1 that
needs no order-side record at all: the delivery-out agent holds a **role on the shipment**, which is
[A8 §3]'s axis, and the commitment is unchanged throughout. **Expressible**, and the thing worth
noticing is what did **not** happen — the order's stage does not move when the performing party
changes, because the stage is about the agreement and not about who is doing the work.

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **A1 is silent**

Entirely A4's and A3's. Recorded so the silence is deliberate: an attempted delivery is
`type = delivery` at `NOT_COMPLETED` with a reason ([SD §2.5]), and no order-side record is emitted
by any of it. A model in which a failed delivery moved the order's stage would be one in which the
stage had stopped meaning "is there an agreement".

### 4. A reweigh in transit — **A1 is silent**

[SD §4.4] and [A8 §5 row 6]. Named here only because `src:cfr-49-375` §375.517 makes the reweigh
demand the **shipper's** right and gates it on the carrier having disclosed billing weight — a
permission with an actor and a precondition, in A1's own shape, about a fact that is not A1's. It
belongs in [A8 §5], where it already is.

### 5. A car on a separate carrier, delivered a week apart — **A1 is decisive, via a rule it inherits**

[`fork-order` §3.5(a)]'s **A-AWARD** — _"if it is awarded separately, it is a separate order; if it
merely travels separately, it is a separate shipment under the same order"_ — is an **A1 rule stated
in a fork document**, and A1 is where it is testable: the discriminant is whether a second
`orderAward` and a second `orderResponse` exist with their own `occurredAt` and their own asserting
party. `src:weichert-supplier-api`'s Auto lane has its own accept/decline handshake on its own
endpoint, so it is a second order; a car moving under one booked engagement is a second shipment.
**Expressible, and A1 sharpens the rule from a criterion into a query**: count the awards.

### 6. Cancelled after packing, before loading, with materials charged — **A1 is decisive**

The scenario A1 exists for, and the one where the fold earns its keep.

`orderCancellation` at `outcome = CANCELLED`… is not what happens. The cancellation **act** is
performed — the order is cancelled — so it is `orderCancellation` at `COMPLETED` with at least one
reason ([SD §2.3] invariant 2), and the fold returns **`CANCELLED`**. The distinction matters and is
the first thing a reader gets wrong: `outcome` describes the performance of **the cancellation**,
not the fate of the order.

Four things follow, and none of them needs a new record:

- **The packing already happened and stays happened.** `type = packing` at `COMPLETED` is a fact
  about the goods, asserted before the cancellation, and nothing about the stage moving to
  `CANCELLED` reaches back to it. [SD §4] is append-only, and the existing scenario test asserts it.
- **The charge stays.** [SD §6.3] — financial facts are corrected **only** by an offsetting record,
  never by retraction — and [A8 §5 row 11] holds the authority. A cancelled order with a live
  materials charge is not an anomaly; it is the normal case, and both `src:dtr-part-iv` (pull-back
  "charged if caused by TSP action or inaction", §C.6.a-b) and `src:dp3-tender-of-service` (turn-back
  inside 14 days) publish the liability rule that makes it so.
- **Who cancelled it is on the record; who _requested_ it is not, and this is the scenario that
  shows it.** `assertedBy` is the actor. The requestor is `reasons[].attribution` (A1-PERM-2) — and
  a cancellation that **succeeded** is `COMPLETED`, where [SD §2.3] invariant 2 forbids `reasons[]`
  outright. DTR's cancel / pull-back / turn-back split turns on exactly that distinction, because it
  is what decides who is charged (§C.6.a-b), so the gap is not cosmetic. The existing scenario test
  asserts it as a finding; §3.5 and §6 carry it as owed to the shared layer.
- **If the cancellation is refused**, the fold returns **`ACCEPTED`**, not `CANCELLED`, and the
  packing and the charge are unaffected either way. That branch is `src:dcsa`'s third track and
  `src:milmove-mymove`'s two-actor split, and it is one line of the fold.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **A1 is silent, with one consequence**

[SD §4.3] and [A8 §5]. A1's only contribution is a negative worth recording: **the analogous
commitment-side case is not resolvable today.** Two parties asserting incompatible
`orderCancellation`s — one saying the order was cancelled, the other that it was not — pair on the
fact key `(order, orderCancellation)` and produce a contest with **no authority row**, so
`FactResolved` must name a tie-break rule under [A8 §4.4] A8-NAMED and there is none to name. The
fold then reads a `selected` of `null` and contributes nothing, which is A8-JOINT behaving
correctly. **Not expressible as a resolution**, expressible as an unresolved contest, and that is
the honest state.

### 8. A mid-journey custody handoff — **A1 contributes a precondition, and it is the one A8-PRINCIPAL case**

Custody moving is [SD §4.8]'s and [A8 §7]'s. A1's edge is [A8 §7.5]'s: **the principal changes**,
which A8 keeps apart from a custody handoff precisely because it looks like one. A principal change
is an order-side event — a new commitment, with a new awarding party — and under A1 it is a new
`orderAward` on the same order that cannot supersede the old one, because `supersedes` requires the
**same party** ([SD §4.1]). **Expressible only as a contest**, and it is the second instance of §3.3's
limit. §Cross-area hands both to A8 together, because they are one gap.

### 9. A partial load under one bill of lading — **A1 is silent**

[A3 §8.9] and [SD §3]. The Portion carries it. A1 notes only that a partial **load** and a partial
**acceptance** (§3.2) are different things at different grains, and that the first is expressible
while the second is not — because `appliesTo` reaches a Portion and not a stop.

### Summary

| Scenario                          | A1's part                                          | Verdict                                             |
| --------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| 1 consolidated van                | none — the test is that there is none              | **Expressible**                                     |
| 2 SIT, different delivering agent | the stage does not move when the performer changes | **Expressible**                                     |
| 3 delivery attempted twice        | none                                               | **Expressible** (A4's)                              |
| 4 reweigh                         | none                                               | **Expressible** (A8's)                              |
| 5 car on a separate carrier       | A-AWARD, sharpened into "count the awards"         | **Expressible**                                     |
| 6 cancelled after packing         | the whole scenario                                 | **Expressible**, including the refused cancellation |
| 7 two asserters                   | the commitment-side analogue                       | **Unresolved contest — the authority row is owed**  |
| 8 custody handoff                 | the principal change is a competing award          | **Unresolved contest — same gap**                   |
| 9 partial load                    | partial load ≠ partial acceptance                  | **Expressible**; partial acceptance is owed         |

Two of the nine land on the same gap, and it is the gap [A8 §9 item 8] holds.

---

## Cross-area consequences to record

### To [A8], and it is a correction to the ledger's reasoning, not a request for a row

[A8 §9 item 8(b)] lists the three order types among twelve rows "blocked on the corpus, not on this
document's effort", and gives as the reason: _"the lifecycle is [`fork-order` §3.1]'s; **no source in
the corpus attaches an authority to it**"_. A1 read the corpus for exactly this and found the
sentence is **too strong in one direction and not specific enough in the other**. Neither finding
closes a row, and A1 writes none — [SD §4.7] note 3 bars a provisional reading from scoring, and
A1's own confidence is capped at §7 accordingly.

**(a) The corpus does attach a party to every order transition; what it does not attach is an
_asserter_.** `src:dtr-part-iv` A-402 §C-§F names one on every edge (§2.3's table);
`src:atlas-world-group-api` captures `bookedBy`, `accepted_by`, `cancelledBy` **and**
`cancelRequestor` on the order record; `src:milmove-mymove` enforces in a running system which actor
may make which transition; `src:project44` says a booking may be cancelled _"due to actions caused
by **either party**"_. That is **permission**, not authority — §3.5's distinction — and it is
material of the same kind A8 used for seven of its own rows: [A8 §10] records that for rows 1-5, 8
and 11 "every row's **duty** is sourced… **converting a recording duty into assertional authority is
authored in every one of them**". The order rows are not short of that material. They are short of
the conversion, which is A8's to make or to refuse.

**(b) The `context[]` argument does not reach a fixed-role row, and that is the specific finding.**
[A8 §9 item 8(b)] rules `KEY` out for nine of the twelve because they "name their actor in
`context[]`" and [SD §1.4] rule 1 forbids resolution from keying on it. True, and A1 does not dispute
it. But **DTR's actors are fixed by the transition kind, not read off the record**: the TSP always
accepts, refuses and turns back; the PPSO always cancels and pulls back. A row that names a role
**literally** needs no `context[]` read at all, and [A8 §5 row 11] is the published precedent —
`DECIDED` names `accountParty` as a literal, with no fold and no key behind it.

**(c) So what actually blocks them is a `boundBy` gap, and it is different for each of the three.**
[A8 §4.3] publishes six members — `CUSTODY`, `ASSIGNMENT`, `SCHEME`, `PRINCIPAL`, `NONE`, `KEY` —
and none of them means _"a fixed role, resolved outside this fact"_.

- **`orderResponse`** and **`orderCancellation`**: the authoritative role is resolved by **the
  order's own award** — the offeree is whoever the award named. That is structurally the same
  binding as `ASSIGNMENT` ("authority follows an `Assignment`'s effective interval") one aggregate
  over, and A8 has no member for it.
- **`orderAward`**: blocked by **A8's own mint principle**, stated at [A8 §4.3] — "`orderAward`
  mints the principal relation, so it cannot be `PRINCIPAL`" — and `KEY` cannot rescue it because
  its actor is in `context[]` rather than in a qualifier, which is precisely what item 8(b) says.
  **For this one row, A8's stated reason is exactly right**, and it is the same shape `handover` was
  in before `KEY`: an act that mints the thing a binding would follow.

The useful form of the ledger entry is therefore three lines rather than one, and the question it
asks A8 is a **schema** question — does the table need a seventh `boundBy` member? — not a research
one. A1 does not answer it.

**(d) Two further gifts, both worked cases A8 §8 and §9 ask for by name.**

- **A1-PERM-3 is the cleanest published `A8-UNAUTH` case in the corpus.** `src:dtr-part-iv` §C.4.a
  permits refusal **only** for a short-fuse or shortened-transit shipment: the same record, by the
  same role, is authorised or not depending on a property of the thing it is about. [A8 §8] cites
  two worked cases including "one where the same act flips authorisation by elapsed silence" — DTR's
  non-response is that case, and this is its sibling.
- **`src:dcsa`'s JIT `classifierCode` is a source binding an assertion class to a role.** _"`EST`,
  `PLN` and `ACT` can **only** be used by the **Service Provider** … `REQ` is **only** to be used by
  the **Service Consumer**"_ (`jit/v2/JIT_v2.0.0.yaml` L3554-3585). [SD §4.7.1] states that "no
  source in the corpus binds a **plan change** to an asserting role", which is the stated blocker for
  `tripDelay` / `tripResequence` / `tripCancellation`. JIT is about a planned **time** rather than a
  plan change, so it does not overturn that sentence — but it is the nearest published thing to it,
  it was not cited when the sentence was written, and it is where A8 should look first.

**(e) One requirement, reinforced.** [A4 §5] hands A8 §9 item 2 the requirement that the owed
`roleClass` enum needs an explicit **non-party** member, because `FORCE_MAJEURE` and `CAUSE_UNKNOWN`
attribute to nobody. `DEADLINE_LAPSED` is a **third** such member, and the only one where a
regulation says it outright: `src:dtr-part-iv` §C.4.b's non-response is "caused by **nobody**".

### To [SD] — one hole where two of its own sections meet

[SD §4.7.2e] item 2 places "who ended it, and when" on **the stage plus `reasons[].attribution`**.
[SD §2.3] invariant 2 **forbids** `reasons[]` at `outcome = COMPLETED`. A cancellation that
succeeded is `COMPLETED`, so on the ordinary case the placement rule names a field that is not
there — and `src:dtr-part-iv` §C.6.a-b makes the requestor the thing that decides **who is charged**,
so it is not a cosmetic gap. It was already asserted as a finding in
`tests/scenarios/cancelled-after-packing-before-loading.test.ts` before A1 read it; A1's contribution
is to say which two sections produce it and what the two candidate fixes cost (§3.5). A1 writes
neither, because both change the shared layer.

### To [A5]

`src:dtr-part-iv` §D.5.c(2) states that on SIT termination "**the warehouse becomes the final
destination of the shipment**" and the TSP's BL liability ends — and yet §D.5.c(1) NOTE: "When
converted to customer expense, the customer is still entitled to delivery out of storage paid for by
the Government." **One obligation survives the death of the contract that created it.** That is an
A1-shaped fact about an A5 boundary, and A1 records it rather than modelling it: under A1-STAGE a
terminated-SIT order is still `ACCEPTED`, so the commitment does not end when liability does. If A5
needs the two to part company, A1's stage is not the mechanism.

### To [A2]

§3.4's `COMPLETE` fork is A2's to close, together with A4: a completion rule derived from the
committed shipments' terminal acts needs a settled reading of the **zero-shipment** order, which is
a consequence of [`fork-order` §3.1]'s cardinality and not of anything A2 has decided yet.

### To [A7]

§3.6 places a price counter-proposal on the `charge` fact key at `aspect = PROPOSED` rather than on
the reason axis. A7 should know that [A8 §5 row 11]'s proposal authority is now being asked to carry
a **pre-commitment** proposal — one made before any order exists to hold it — which row 11's
`PRINCIPAL` binding may or may not reach.

### To [A9]

`src:stedi-x12-reference`'s `B1-03` is _"the booking date accepted by the carrier"_ and
`src:atlas-world-group-api` carries `quoteNumber` and `ord_fromorder` alongside `ord_number`. A1
mints no identifier and notes only that the **award** and the **acceptance** are separately dated in
the corpus's one published protocol, which A9 should not collapse.

### To [A10]

§3.4 declines to put the estimate on the order's stage, and §6 records `src:cfr-49-375` §375.401(i)
— "You may not amend the estimate after loading the shipment" — as an invariant **waiting for a fact
class that does not exist**. A10 inherits both the class and the invariant.

---

## 9. What this puts in the executable specification, and how each part is held

Every decision above that can be executed is, and every gate below was **tampered with and watched
to fail** before being left green — a gate nobody has seen bite is a gate nobody knows is live.

| Decision                              | Where it lives                                                         | What holds it                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **A1-STAGE**, the fold                | `orderStageAt` in `src/rules/order-stage.ts`, rule `ORDER-STAGE-AT` v1 | `tests/conformance/order-stage.test.ts`, one describe block per rule                                          |
| §3.2's element 558 mapping            | the same fold's per-type outcome reading                               | A test that asserts `A` and `B` reach the **same stage** — the mapping's own discriminator, executed          |
| §3.3 rule 3, the refused cancellation | `Reading`'s `DOES_NOT_GOVERN` arm                                      | Tampered by making a refused cancellation govern: three tests flip, including one that was not about rule 3   |
| §3.3 rule 5, `RESPONSE_WITHOUT_AWARD` | the award-stands check                                                 | Tampered by deleting the branch: two tests flip from `UNKNOWN` to `ACCEPTED`                                  |
| §3.6's `DEADLINE_LAPSED`              | `REASON_CODES` in `src/outcomes.ts` and `data/reasons.json`            | The set check in `loadReasonVocabulary`, tampered by dropping the code from the table — ten tests fail        |
| The version bump                      | `CATALOG_VERSION = '0.4.0'`                                            | The catalog and glossary staleness gates, both of which failed for real before the artifacts were regenerated |

**The compatibility classification, read from the diff rather than argued from the shape.** The
emitted `captured.schema.json` and `queried.schema.json` each gain exactly one line —
`"DEADLINE_LAPSED"` in `Reason.code`'s `enum` — so the change is `newClosedEnumMember`, additive,
`0.3.0` → `0.4.0` ([catalog §2.3]). **`orderStageAt` moves nothing on the wire**, and that claim was
also checked against the diff rather than asserted: a projection is a fold over records that already
exist, §3.1 mints no type, aggregate, field or qualifier, and the schemas show it.

**One documentation defect found on the way, and what it turned out to be about.** The generated
owed inventory in `catalog/index.json` carried a hand-written note reading _"the authority rows, 19
of 31 of which are owed"_ beside a generated `counts.authorityRows` of **14** — the count A8's rows
12-16 left behind. [catalog §2.4] carried the same stale pair, plus a stale `0.2.0`, and
`docs/domain-reference/README.md` carried a third stale version.

The interesting part is **which** copies rotted. [catalog §5] carries the same five counts and they
were **correct**, because `tests/conformance/catalog.test.ts` reads them out of that section and
compares them with `collectOwedInventory()`. Three ungated copies drifted; one gated copy did not,
across two releases. So the fix is not "write the number once" — §5's copy earns its place — it is
**gate it or delete it**: the generator's note now points at the counts beside it, [catalog §2.4]
carries a bump table and no counts, the README stops restating the version, and §5 keeps its five
and says outright that they are the only ones the document may carry. That is the same lesson
[A8 §11] revision 7 recorded about a data table having three homes, with the mechanism named.

**What A1 did not put in the code, deliberately.** No authority row (§Cross-area), no `COMPLETE`
stage (§3.4), no widening of `Reason.appliesTo` (§3.2), and none of the three commercial-refusal
codes §3.6 argues belong to other areas. Each is in §6 with an owner.
