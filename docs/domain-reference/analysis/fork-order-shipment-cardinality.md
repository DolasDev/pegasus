---
decision: fork-2-order-shipment-cardinality
areas: [A2, A9, A1]
status: recommended
written: 2026-09-17
revised: 2026-09-18
revision: 2 — answers round-2-critique.md; conforms to 00-shared-decisions.md
governed_by: 00-shared-decisions.md # OUTRANKS this document; where they differ, it wins
depends_on: fork-3-stop-ownership (consolidation is deferred to the trip; see Dependency)
scope: |
  Ideal target model, EXTERNAL evidence only. Our own systems (packages/domain, Prisma
  schema, integration floors, the pegII order shape, the long-haul app, our integration
  configs) are excluded as evidence and are not cited for what the domain IS. Partner
  contracts — Weichert, SIRVA ADE, Atlas — are external evidence: they describe how
  counterparties behave. Rubric attribute S5 is withdrawn; S5 lines in round-1 analyses
  are ignored here. Nothing here is designed for migration from anything we own.
disclosure: |
  Every claim either cites a source that says THAT thing, or is marked [ORIGINAL] inline
  at the point of use. A source that says something narrower than the claim does not
  support the claim. [SYNTHESIS] marks a mechanical join of two sources' halves, per
  00-shared-decisions.md §0. Marking something ORIGINAL is not a defect; presenting an
  authored rule as sourced is.
atlas: |
  BLOCKED. No subscription key exists in the repo; Atlas's operational vocabulary is
  unpublished, not merely unfetched. Atlas A3/A5/A9 C2 are corrected to 1. Nothing in
  this document is scheduled for resolution by fetching Atlas /Types endpoints, and the
  one Atlas-derived claim retained (P4) is re-cited as structural evidence only. See §2d.
---

# Fork 2 — order ↔ shipment cardinality, and what identifies each

> **Revision 2 note.** [`round-2-critique.md`](round-2-critique.md) returned this document
> `needs-revision` on five claims, four scenarios and two disclosure leaks.
> [`00-shared-decisions.md`](00-shared-decisions.md) then settled the cross-cutting layer and
> **outranks this file**. Every one of its nine required changes (§10.2 there) is applied
> below; every critique point is answered, including the two where this revision
> **disagrees and says so** (§3.3.1 and §3.2.4). §8 runs the nine scenarios explicitly.
> §9 lists what moved.

## 1. The question

Three questions that cannot be answered separately:

1. **Cardinality.** Can one booked order carry more than one shipment?
2. **Definition.** What _is_ a shipment — a separately-**routed** set of goods, a
   separately-**priced** service, or a separately-**identified** record?
3. **Identity (A9).** An HHG shipment simultaneously carries a van-line registration
   number, an RMC service-order number and a bill-of-lading number. What shape holds
   all three?

The acceptance test, stated once and used throughout: **one booked move where the
household goods travel by van, a car goes on a vehicle carrier, and part of the goods
enters storage-in-transit and is delivered weeks later.** Any answer that cannot
express that, unchanged, is wrong. The critique correctly observed that revision 1
"passed" this test only by pointing at `A3`, which could not record a stop performed by a
vehicle it cannot identify — so the pair passed each half by pointing at the other. That
hole is closed by `00-shared-decisions.md` §8 (`ExternallyPerformedLeg`, and the vehicle
struck from the `Stop` definition), not by anything this document could do alone. §8.5
below shows the discharge.

### Why this is irreversible or expensive to change later

Cardinality is not an internal schema choice. It is baked into **every identifier we
ever publish**.

- If a shipment id is minted as "the order id", then every event key, every document
  reference, every correlation row and every counterparty's stored key assumes 1:1.
  Going 1:1 → 1:N later means re-keying published events and asking every counterparty
  to re-parse. Going 1:N → 1:1 is not a migration at all; it is data loss.
- **The identity is not ours to renumber.** The carrier issues the BOL; the van line
  issues the registration; the RMC issues the service-order number. A shipment boundary
  that later has to split has to be re-agreed with counterparties who have already filed
  those numbers against their own records — and in the regulated cases, filed them on
  documents with a statutory retention period (`src:cfr-49-375` §375.505(d),(f) — bill of
  lading and attachments retained 1 year; §375.205(c) — agency agreements 24 months).
- **[ORIGINAL] — the asymmetry-of-regret criterion.** _Adding a parent above an aggregate
  later is cheap; splitting a child out of an aggregate later is not._ This is reasoning,
  not evidence. No source states it. It is used explicitly in §3 to be generous at the
  order→shipment boundary and stingy above it, and it is listed in §7's unsupported
  assertions.

## 2. The positions in the external corpus

Grouped by what they actually claim, not by publisher.

### 2a. Positions on cardinality

| #   | Position                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                                                                             | What it buys                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **Move → many typed shipments.** Closed `shipmentType` enum: `HHG`, `HHG_INTO_NTS_DOMESTIC`, `HHG_OUTOF_NTS_DOMESTIC`, `INTERNATIONAL_HHG`, `INTERNATIONAL_UB`, `PPM`, `BOAT_HAUL_AWAY`, `BOAT_TOW_AWAY`, `MOBILE_HOME`; class-table-inheritance per subtype (ADR 0067).                                                                                                                                                                                                                                                                                                                                                                                             | `src:milmove-mymove` (`swagger-def/definitions/MTOShipmentType.yaml`; `pkg/models/mto_shipments.go:161-170`)                                       | The vehicle/boat/mobile-home case is a _sibling_ of HHG under one move, with its own table rather than a widening column set. Directly answers half the acceptance test.                                                                                                                        |
| P1b | **A shipment has a lifecycle that completes without any transport document.** `MTOShipment`: `DRAFT → SUBMITTED → APPROVED \| REJECTED` (rejection reason mandatory, `mto_shipments.go:206-212`), plus `DIVERSION_REQUESTED`, `CANCELLATION_REQUESTED` and terminal `CANCELED` — where the request and the act have **different actors** ("Currently, the Prime cannot update the shipment to any other status", `swagger/prime.yaml:785-790`).                                                                                                                                                                                                                      | `src:milmove-mymove`                                                                                                                               | The shipment is an entity from the moment it is _asked for_, not from the moment a carrier papers it. This is the evidence revision 1 lacked for §5.2, and it is why the cancelled-after-packing scenario now has a subject.                                                                    |
| P2  | **Order → `shipments[]`, but a different _service kind_ is a different ORDER.** Domestic HHG, Domestic LTS, International HHG, International Bid, International LTS, **Auto Shipment** and **Pet Shipment** are parallel _top-level order types_, each with its own receive/accept/update triple and its own payload. Several service orders hang off one move: `M-C-28608-4`, `M-C-28608-6`, `M-C-28608-7` (`odt:270, 845, 2028`) — the `-N` suffix is **undocumented, and the source's analysis records it as its own open question 8**.                                                                                                                           | `src:weichert-supplier-api`                                                                                                                        | Three commercial levels in a live RMC contract: **move → service order → shipment**. And a direct contradiction of P1 on the car: Weichert makes it an _order_, MilMove makes it a _shipment type_.                                                                                             |
| P3  | **One registration IS the shipment; a split mints a new value of the same identifier.** `CamisRegNumber` = shipment(6) + overflowSeq(2) + transferSeq(2); `HaulingSegmentType` ∈ {MainLoad, Overflow, MassMove, Transfer}; segments independently addressable via `TransferNumber` / `OverflowNumber` / `MassMoveNumber`, where `00` means the main load and null means "give me all segments".                                                                                                                                                                                                                                                                      | `src:sirva-ade` (SOE p.2; GSD pp.3, 5)                                                                                                             | Overflow and transfer become addressable with **no new entity**, and the relationship is legible in the digits. There is no order level at all — the registration is the root.                                                                                                                  |
| P3b | **The shipment is minted by a registration act, carries a status of its own, and can die without ever being papered.** `Register` "a shipment has been registered" arrives with the **full** element set — parties, addresses, agreed periods (null at registration), weights, cubes, charge estimate, discount, miles, `ShipmentStatus = REGISTERED` (SOE pp.10-13). `ShipmentStatus` ∈ `REGISTERED / CANCELLED / PLANNED / ASSIGNED / LOADED / DELIVERED` (GSD p.8). `Cancel` "the shipment has been cancelled" carries **nothing further — no reason code** (SOE p.15). **No BOL, PRO, SCAC or GBL appears anywhere in the contract.**                            | `src:sirva-ade`                                                                                                                                    | Grade A, live partner contract: a shipment exists, is addressable, and reaches a terminal state with no transport document in sight. Together with P1b this is the empirical basis for §3.2's two-stage boundary.                                                                               |
| P4  | **Order and Shipment are the same row, rendered twice.** `atlasorder-v1.Order` and `shipment-management-v1.Shipment` share the key `ord_hdrnumber`; the difference is naming convention, collection wrappers and which child collections each surface exposes.                                                                                                                                                                                                                                                                                                                                                                                                       | `src:atlas-world-group-api` (`atlasorder-v1.json:11324`; `shipment-management-v1.json:2193`) — **structural (column-name) evidence only; see §2d** | The largest van line in the corpus fuses them — and therefore has to model a vehicle move as a _separate order_, arriving at the same physical answer as P2 one level down.                                                                                                                     |
| P5  | **The commercial unit and the execution unit are separate entities with a stated seam.** A Load cannot exist without a Trip (`GET /loads` → 404); a Load may have many Trips (`includeDeleted` returns "an original trip superseded by a load split"); the Load's origin and destination are **derived from the trip's stops, not stored**; revenue sits on the Load, cost on the Trip. A Trip carries exactly one `LoadNumber`.                                                                                                                                                                                                                                     | `src:alvys-api` (`loads_get-load.md`, `trips_get-trip.md`)                                                                                         | The cleanest published statement anywhere that _routing belongs to execution and pricing belongs to the commercial record_. It also proves the inverse: one-load-many-trips is easy, many-loads-one-trip is not expressible here.                                                               |
| P6  | **Booking ≠ Shipment ≠ Transport Document**, and the shipment has no lifecycle at all — only _documents_ have status (17 status values across 23 document types).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `src:dcsa` (bkg L2461-2496; event_domain L2523-2564, L2157-2211)                                                                                   | Separates "what was agreed" from "what is moving" from "what governs it", and refuses to give the physical thing a state.                                                                                                                                                                       |
| P7  | **The legal unit is the bill of lading, and consolidation is a cross-reference between BLs, not an entity.** One BL = one customer's property moving on one authority. A _consolidated shipment_ is several customers' lots offered to one carrier for one movement — but _"a separate BL will be issued for each customer's lot"_, cross-referenced in Block 27. A _split shipment_ is separated at a transshipment point into increments "each … identified and documented separately", each with its own weight ticket and its own SIT control number.                                                                                                            | `src:dtr-part-iv` (`dtr_definitions.pdf` #81, #662; A-402 §F.10.a(18) pp.33-34; §D.5.b(4) p.18)                                                    | The only source that states the rule for the hard cases directly, with the actor and the document on every transition.                                                                                                                                                                          |
| P8  | **The BOL is "both the receipt and the contract."** Item 16 of the required BOL content is _"any identification or registration number you assign to the shipment"_ — the regulation's own admission that **more than one id exists**; and every weight ticket must carry _"the carrier's shipment registration or bill of lading number"_.                                                                                                                                                                                                                                                                                                                          | `src:cfr-49-375` (375.103; 375.505(b)(16); 375.519(a)(6))                                                                                          | Binding on us, and it names the shipment's identity as the BOL-or-registration number rather than inventing one.                                                                                                                                                                                |
| P8b | **The BOL is dated to loading, and pre-load documents already name the lot.** The driver must hold the BOL _before the vehicle leaves the residence of origin_ (§375.505(c)). Before that: a **dated estimate signed by both parties**, retained "as an integral BOL attachment" (§375.403(c), §375.405(d)); an **itemized inventory** listing "every carton and every uncartoned item" with an identification number **placed physically on each article**, prepared _before or at loading_ (§375.503(a)); and accessorial charges that "must be determined **before** preparing the BOL" (§375.401(f)).                                                            | `src:cfr-49-375`                                                                                                                                   | The regulation itself places the lot's naming, pricing and enumeration _earlier_ than the contract document. This is what makes the two-stage boundary at §3.2 a reading of the regulation's sequence rather than an evasion of it.                                                             |
| P9  | **Shipment ≠ Consignment, at many-to-many arity.** A _Shipment_ is "an identifiable collection of one or more Trade Items … from the Seller … to the Buyer" and "may form part or all of a Consignment **or may be transported in different Consignments**". A _Consignment_ is "a separately identifiable collection of Consignment Items … from one Consignor to one Consignee via one or more modes of transport **as specified in one single transport service contractual document**".                                                                                                                                                                          | `src:uncefact-mmt-rdm` (BRS_T+L-MMT p.15), `src:uncefact-scrdm` (BRS p.16)                                                                         | The only formally-defined vocabulary for the distinction we need — and the two documents **agree** on this, which matters more than where they disagree (see §2c).                                                                                                                              |
| P10 | **Declare whether a containment is KNOWN.** `commodities.lineItemLayout`: `Nested` = "the Handling Unit/Line Item relationship **is known**"; `Stacked` = "…**is not known**". Separately, `manifestId` = "a manifest that includes **multiple shipments, possibly across multiple spotted trailers**".                                                                                                                                                                                                                                                                                                                                                              | `src:nmfta-ebol` (`:361`–`:375`, `:280`)                                                                                                           | A structure that admits when its own hierarchy is a display artefact rather than a fact. Nothing else in the corpus does this.                                                                                                                                                                  |
| P11 | **9 999 shipments under one piece of equipment, with load order and physical position — and no shipment-level state.** `TSD-01` = "the loading sequence and relative shipment position on the trailer"; `TSD-02` = "relative position of shipment in car, trailer, or container". Exactly one `AT7` status and one `MS1` location **for the whole trailer**; no shipment in a 212 has a status of its own. `BLR` carries a per-shipment SCAC for interline, and `BLR-02` is an **effective date** for that attribution. Consolidation is narrated as a **series of re-issued documents** (`B2A` Set Purpose: original / replace / cancel), not as a persistent trip. | `src:x12-212-trailer-manifest` (`/segment/TSD`, `/segment/MS1`, `/segment/BLR`, `/212`)                                                            | Proves consolidation is first-class and _load-plan-shaped_, and simultaneously proves it is **not** an order/shipment concern: the 212 has no order, no stop sequence, no legs and no driver. A load plan, not a trip. `BLR-02` is also the source that broke revision 1's `Identifier` (§3.3). |
| P12 | **Assembling vs transformation, stated as a modelling rule.** "In contrast to transformation, in the output of `assembling` the original objects are still identifiable"; aggregation membership is governed by `action` ∈ ADD / OBSERVE / DELETE.                                                                                                                                                                                                                                                                                                                                                                                                                   | `src:gs1-epcis-cbv` (CBV 2.0 §7.1.3; Ontology/EPCIS.ttl L68-99)                                                                                    | The generic test for whether an operation preserves identity or destroys it — which is exactly the question "does a split mint a new shipment?"                                                                                                                                                 |

### 2b. Positions on identity shape (A9)

These are retained as the **survey that fed the decision**. The decision itself is no longer
taken here: identity shape is settled by `00-shared-decisions.md` §7, and §3.3 below records
only what this fork contributes to it and what it must now conform to.

| Shape                                                                                                                                                                                                                                                                                                                                                   | Source                                                                             | What it buys                                                                                                                                                                | What it costs                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Three slots, with an echo obligation.** `documentReference` + `relatedDocumentReferences[]` (same 23-value type list) + `references[]` — "references provided by the **shipper or freight forwarder** at the time of booking… Carriers **share it back** when providing track and trace event updates", typed `FF`/`SI`/`PO`/`CR`/`AAO`/`CSI`/…       | `src:dcsa` (event_domain L794-796, L1758-1829, L2071-2089; dcsa_domain L1291-1330) | The cleanest separation of _subject_ from _cross-reference_, and the only source that states **echoing the counterparty's own key back** as an obligation on the publisher. | Under-specifies _who assigned_ a value; the slots are about a document event, not about a shipment.                                                                 |
| **A typed 70-value list whose type says who assigns.** `LogisticsIdentifierTypeEnum` is defined as _"the standard which defines **who assigns** the identifier and **what it identifies**"_; plus `primaryForType` and a per-identifier `source` ∈ `CUSTOMER` / `CAPACITY_PROVIDER`. Identifiers attach at three grains: shipment, route segment, load. | `src:project44` (`:35454`, `:36157`)                                               | The only source that makes "who issues this kind of number" a **property of the type**, and the only one that solves _two values of the same kind_.                         | The vocabulary is LTL/ocean-shaped: PRO, BOL, SCAC are present; registration number, service-order number and van-line order number are not (its own C4=1).         |
| **A key→value map, addressable in the path.** `externalIds` is an org-scoped map on every major object, addressable as `key:value` — "for example, `payrollId:ABFS18600`".                                                                                                                                                                              | `src:samsara`                                                                      | Path addressability without a lookup round-trip.                                                                                                                            | A bare map has **no issuer**. `{"registration": "123456"}` is ambiguous for a tenant that is an agent for two van lines. Mechanism without terms (its own A9 C4=0). |
| **Canonicalise, then match.** Smart Reference Matching removes all special characters and leading zeros before comparing, so `00AB C-D*E` matches `A-B-C-D-E`.                                                                                                                                                                                          | `src:shippeo` (`events-in-road-order.home.md:70-79`)                               | The published _rule_ for "two parties spelled the same number differently" — the actual failure mode in HHG.                                                                | Aggressive canonicalisation produces **false-positive matches**, which are worse than misses.                                                                       |

Two corroborating facts about arity, both external:

- **One thing routinely has two ids from the same party.** SIRVA carries **two ids for one
  trip** — `QPDTripNumber` (10 digits) and `CamisTripNumber` (5 digits) — on every
  trip-bearing event (SOE p.2). The addressable key for a shipment detail read is not one
  value but the **triple** `Brand + RegNumber + RegYear`, because reg numbers recycle across
  years and brands (GSD p.15).
- **Three parties keep three keys for one shipment.** In the Weichert contract,
  `supplierShipmentId` is _Required_ and is the supplier's own id "from their proprietary
  system", carried **on each element of `shipments[]`** (`odt:378`, `odt:1411`); Weichert keys
  the URL by its own `:orderId`; and `agentShipmentID` (`odt:1020`) implies the _agent's_ key
  as a third. Meanwhile the RMC holds **no SCAC, no carrier code, no BOL/PRO, no registration
  number, no driver id** — agents are identified by a 255-character free-text name
  (`odt:390-404`).

### 2c. Resolving the UN/CEFACT contradiction, explicitly

The task names it: MMT BRS p.15 says a single **Trade Item cannot** be split across Shipments;
SCRDM BRS p.16 says it **can**; the parent Buy-Ship-Pay BRS p.15 says it "is related to one
shipment". Three documents, one download, three rules.

**Resolution — [ORIGINAL] as a reconciliation. The _contradiction_ is documented by both
analyses; the argument that each rule is true from its own chair is made here, not cited.**

1. The disputed rule governs the **Trade Item** — "the lowest level of 'commercial'
   information in a Sales Order between the Buyer and the Seller" — not the Shipment. Both
   documents define _Shipment_ identically, and both state the same thing about it: a
   Shipment "may form part or all of a Consignment **or may be transported in different
   Consignments**." _(Sourced.)_
2. **[ORIGINAL]:** the two rules are written from different chairs and are each true of their
   own object. MMT is the transport-and-logistics view, where a Shipment is _assembled for
   transport_; SCRDM is the commerce view, where a Delivery is _what actually shipped this
   week_ against a line that may be partially fulfilled (hence its quantity vocabulary:
   `Requested` / `Agreed` / `Despatched` / `Remaining_Requested`, `Partial Delivery Allowed`,
   `Fully Delivered` — that vocabulary is sourced; the inference from it is not).
3. **For household goods the dispute is moot in the direction it matters. [ORIGINAL].** Our
   nearest analogue of a Trade Item is an inventory article, and an inventory article is
   physically indivisible — a sofa does not split across two vans. What splits is the **set**.
   Neither document addresses whether a _set_, once named, may be re-partitioned; that is the
   actual HHG question and no UN/CEFACT document answers it. The answer now lives in
   `00-shared-decisions.md` §3 (the Portion), not here.
4. **What we take from the pair is the agreement, not the disagreement**: the formal, cited
   definition of _"one single transport service contractual document"_ as the thing that bounds
   a consignment. That definition is load-bearing in §3.2 — and, as §3.2.2 now concedes, it
   bounds a _consignment_, not a _shipment_, which is precisely why the boundary rule needed
   re-grounding.

Where either rule is cited downstream, cite the document by name and page, as the SCRDM
analysis itself instructs.

### 2d. Atlas — re-cited (blocked source)

`src:atlas-world-group-api` is used in exactly one place in this document: **P4**, the
observation that `atlasorder-v1.Order` and `shipment-management-v1.Shipment` share the key
`ord_hdrnumber`.

- That is **column-name / structural evidence**, and it is all it can be. Per
  [`analysis-supplement-vocabulary.md`](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md),
  Atlas's operational vocabulary is **unpublished, not merely unfetched**: running the
  code-list extraction over the operational schemas "returns nothing", and **Atlas A3/A5/A9
  C2 are corrected to 1**.
- **No semantic claim in this document rests on Atlas**, and P4 is used only to show _that a
  publisher fuses the two rows_, which a shared primary key establishes without any vocabulary.
- **No claim here is scheduled for resolution by fetching Atlas `/Types` endpoints.** No
  subscription key exists in the repo; the QA key was issued admin-side and never committed.
  Revision 1 contained no such remedy and revision 2 adds none.
- Revision 1's §3.6 aside — "this source's entire operational vocabulary is untyped nullable
  strings with zero enum declarations, so it is evidence for _structure_ and not for
  _semantics_" — was right, and is promoted from an aside to this standing note.

## 3. The decision

### 3.1 Recommended shape — one shape, stated in full

```
Relocation                     ← NOT an aggregate. A typed external reference on the order.
 └── Order              1 ─── N ── Shipment
      · one commitment, to one              · the set of goods committed to move under
        performing party, to perform          ONE transport undertaking — minted by the
        a named set of services                commitment (registration / award / booking),
      · award / accept / decline /             evidenced by the transport contract (BOL or
        cancel lifecycle, carried by            the counterparty's single equivalent) when
        `subject = order:…` per                 one issues.  §3.2
        00-shared-decisions §1              · a type from a closed enum  (P1)
      · the commercial terms                · its own execution lifecycle, published as
      · N may be 1, and usually is            assertions, never as a mutable state field
      · N may be 0 (see 3.4)                  (00-shared-decisions §1.1, §4)
                                            · identity: Assertions, type = identity,
                                              per 00-shared-decisions §7  (see 3.3)
                                                  │
                                                  └── Portion[]
                                                       DEFINED IN 00-shared-decisions §3.
                                                       Not defined here. Not "only at
                                                       physical divergence", not inherently
                                                       weighed, overlap and nesting allowed.
                                (stops, legs, consolidation, externally-performed legs → Fork 3
                                 + 00-shared-decisions §8)
```

**Cardinality: one order carries one-or-more shipments. Decided: yes, N > 1 is legal.**

**Definition — and this is the load-bearing sentence:**

> **A shipment is the set of goods committed to move under one transport undertaking.**

Revision 1 said "moving under one transport **contract**", full stop. The critique showed
that a contract-rooted definition cannot name a packed lot that is cancelled before any
BOL exists — and it was right. The definition is now two-stage; §3.2 states the stages, what
is sourced in each, and what is authored.

Not "separately routed" — routing is the trip's business, and P5 proves the seam holds (the
Load's origin and destination are _derived from the trip's stops_). Not "separately priced" —
pricing follows the undertaking but accessorials scope to the **stop** that caused them
(`src:alvys-api`, `StopId` on a detention charge), so price is not the discriminant either.
Separately **undertaken** — which is _why_ it is separately identified, and why the identity
is issued by the carrier or the van line rather than by us.

**A shipment belongs to exactly one order.** Not many-to-many. No source in the corpus models
many orders : one shipment except by cross-reference, and the one that comes closest — DTR's
consolidated shipment — resolves it the other way: _"a separate BL will be issued for each
customer's lot."_ The many-shipments-to-one-vehicle case is real and normal, and it belongs
entirely to the **trip** (Fork 3).

**Three things this shape no longer owns**, having been settled above it:

| Was in revision 1                                                                | Now                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Identity[]` as fields on the shipment, with a mutable `primary`                 | Assertions of `type = identity`, `primary` **derived** by `FactResolved` per `(subject, scheme, vocabularyScope)` — rule **I-KEY** (`00-shared-decisions.md` §7.1). §3.3 below. |
| `Portion` defined at §5.1                                                        | Defined at `00-shared-decisions.md` §3. §5.1 below retains only what this fork contributed and cross-references the rest.                                                       |
| The order's award/accept/decline/cancel lifecycle as a property of the aggregate | Carried by `subject = order:…` on assertions (`00-shared-decisions.md` §1.2). The order is a first-class subject kind; no shipment appears on an order-scoped record.           |

### 3.2 The decision rule for the hard cases, and how it was derived

#### 3.2.1 What DTR actually says (sourced, and only this)

`src:dtr-part-iv` states **three named DoD operations**, crisply, and the analysis calls the
trichotomy "worth adopting wholesale" (A-402 §E pp.21-26; `dtr_definitions.pdf` #255, #596,
#702):

- **Diversion** — "a change made in the route of a shipment while in transit". The shipment
  **keeps its identity and its BL**; only the destination changes; rates recompute as
  origin→Diversion Point plus Diversion Point→new destination; evidenced by a **Diversion
  Certificate**. Operationally: a new destination **more than 30 miles** from the original,
  **excluding shipments already in SIT at destination** and OTO (#255; A-402 §E.1 p.21).
- **Termination** — onward movement stops at a designated point. Attributable: "for the
  convenience of the government or due to the fault of the carrier."
- **Reshipment** — a _terminated_ shipment moving onward, **on a new BL** (§E.4(4)(c), #596).

Corroboration for the exclusion, from a second independent regulatory source:
`src:dp3-400ng` Item 28.4.d — it is **not** a diversion "if the change arrives before the
shipment moves **or if the shipment is already in destination SIT**", and the analysis's own
warning is that "a generic `DESTINATION_CHANGED` event is not the same concept and should not
be named 'diversion' without this qualification."

#### 3.2.2 The generalisation — **[ORIGINAL]**, and the critique was right

> **[ORIGINAL] — Rule B-DOC. Where a transport contract exists, a _new_ transport contract
> over the same goods marks a _new_ shipment; a change recorded _on_ the existing contract
> does not.**

Revision 1 wrote this as "the test comes from `src:dtr-part-iv` rather than from us." **That
was a disclosure failure and it is withdrawn.** DTR states two named DoD operations inside one
government programme. It does not state a universal boundary rule, and revision 1 applied the
"rule" to a commercial auto carrier, to permanent-storage conversion, and to a Weichert lane
where this same document concedes there is no BOL, PRO, SCAC or registration number at all.
B-DOC is this document's generalisation. It appears in §7's unsupported list and §7's
confidence on it comes down from **high** to **medium**.

What _is_ sourced under B-DOC, and nothing more:

| Element of B-DOC                                                                                                      | Status                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diversion preserves identity and keeps the BL                                                                         | **Sourced** — `src:dtr-part-iv` #255, A-402 §E.3.c; `src:dp3-400ng` Item 28.4                                                                                            |
| Reshipment of a _terminated_ shipment moves on a new BL                                                               | **Sourced** — `src:dtr-part-iv` §E.4(4)(c), #596                                                                                                                         |
| Diversion **excludes** shipments already in destination SIT                                                           | **Sourced twice** — `src:dtr-part-iv` #255; `src:dp3-400ng` Item 28.4.d                                                                                                  |
| A terminated BL "cannot be revived or reinstated"                                                                     | **Sourced** — `src:dp3-400ng`; and termination makes the warehouse "the final destination of the shipment", ending BL liability — `src:dtr-part-iv` A-402 §D.5.c(2) p.19 |
| Delivery to an NTS facility makes the facility the final destination; further movement is "under separate BL/invoice" | **Sourced** — `src:dp3-400ng` Item 27.3                                                                                                                                  |
| The _generic_ rule "a new transport contract = a new shipment", applied outside DoD                                   | **[ORIGINAL]**                                                                                                                                                           |
| The identity/transformation analogy (`assembling` preserves identity, `transformation` does not)                      | **Sourced as a generic modelling rule** — `src:gs1-epcis-cbv` CBV 2.0 §7.1.3 — **[ORIGINAL]** in its application to a BOL reissue, which EPCIS does not discuss          |

#### 3.2.3 The two-stage boundary, which replaces the single test

B-DOC only decides cases where a transport contract exists. The critique's cancelled-move
scenario, and the entire RMC lane, are cases where one does not — and revision 1 had no answer
for either. The corrected rule:

> **Stage 1 — minting. [SYNTHESIS]** A shipment comes into existence when a party **commits
> goods to a named movement**: the van line's `Register`, the RMC's award of a service order,
> the mover's shipment submission. Its boundary at this stage is _the set the commitment
> named_.
>
> **Stage 2 — evidencing. [ORIGINAL]** When the transport contract issues, it **evidences**
> the boundary and may **narrow or widen** it. A narrowing or widening is recorded as a new
> assertion superseding the old one, never as an edit. A shipment that never acquires a
> transport contract is **not incomplete**; it is a shipment whose boundary was never
> contested.

The synthesis at stage 1 is mechanical and is named, per `00-shared-decisions.md` §0:

- `src:sirva-ade` (**grade A, live partner contract**): the shipment is minted by `Register`
  carrying the full element set and `ShipmentStatus = REGISTERED`, and `CANCELLED` is a value
  of that same status enum (SOE pp.10-13; GSD p.8). There is no BOL in the contract at all.
- `src:milmove-mymove`: `MTOShipment` runs `DRAFT → SUBMITTED → APPROVED` and terminates at
  `CANCELED` with a two-actor protocol — a complete shipment lifecycle with no transport
  document (`swagger/prime.yaml:785-790`).
- `src:cfr-49-375` supplies the _sequence_ (P8b): the BOL is dated to loading (§375.505(c)),
  while the dated bilateral estimate (§375.403(c), §375.405(d)), the itemized inventory with
  a per-article identification number physically on each article (§375.503(a)) and the
  accessorial determination (§375.401(f)) all precede it. **The regulation itself names and
  prices the lot before the contract document exists.**

**[ORIGINAL]:** the _two-stage rule itself_ — that minting is an act and evidencing is a
document, that stage 2 may narrow or widen stage 1, and that the narrowing is a supersession.
The three sources give states and a sequence; none states this rule. The supersession
mechanism underneath it is not original (`src:cfr-49-375`: corrections are never mutations —
a new signed estimate or a written attachment to the BOL; `src:gs1-epcis-cbv`:
`errorDeclaration` distinguishing retraction from supersession), and under
`00-shared-decisions.md` §4 it is simply an Assertion with `supersedes`.

#### 3.2.4 The acceptance table, re-run honestly

| Case                                                                                  | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Household goods travel by van                                                         | one commitment, one BOL, one carrier                                                                                                                                                                                                                                                                                                                                                                                                                                               | **one shipment**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A car goes on a vehicle carrier                                                       | a different carrier undertakes it and issues its own document; `src:milmove-mymove` gives the category a _type_ (`BOAT_HAUL_AWAY`, `MOBILE_HOME` are the published analogues); `src:weichert-supplier-api` gives it a whole _order type_ (Auto Shipment, with its own `orderStatus`)                                                                                                                                                                                               | **a second shipment** under the same order — **only under §3.5(a)'s [ORIGINAL] criterion**, which overrules one of the two sources. See §3.3.1 for the concession.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Part of the goods enters SIT and is delivered weeks later, the stay never terminating | SIT is storage _incident to a line-haul movement_: "the BL is still alive and the TSP is still liable" (`dtr_definitions.pdf` #676)                                                                                                                                                                                                                                                                                                                                                | **still one shipment.** SIT does not split it. The remainder is a **Portion** (`00-shared-decisions.md` §3, rule P-IDENTITY: _minting a Portion is not splitting a shipment_).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The SIT stay is **terminated** and the goods move onward                              | Termination makes the warehouse "the final destination of the shipment" and ends BL liability (`src:dtr-part-iv` A-402 §D.5.c(2)); reshipment moves "on a new BL" (§E.4(4)(c)); the original BL "cannot be revived or reinstated" (`src:dp3-400ng`)                                                                                                                                                                                                                                | **NOT SETTLED HERE.** `00-shared-decisions.md` §10.4 explicitly reserves shipment identity across SIT termination as an A2/A5 question. What _is_ settled either way: the `stay` is an aggregate with its own identity and its own subject kind, so **the SIT control number has an owner** regardless — and _who held the goods_ needs none, because it is not a stored thing but the fold **`custodyAt(goods, instant)`** `[SD §4.8.3]` over published `handover` assertions. **There is no custody interval to own**; the phrasing inherited from the earlier §10.4 wording is corrected here and at `[SD §10.4]` in the same revision. §6.7 records the open question. |
| Permanent-storage conversion                                                          | a different document (DD Form 1164 Service Order, not a BL), a different unit (**lot**: "those household goods placed in storage at government expense and covered by one service order", #425), a different counterparty; `src:cfr-49-375` makes it a dated event that shifts liability and places the goods **in the shipper's name**; `src:weichert-supplier-api` makes LTS a separate order type with `ltsRequestDetails.hhgRequestNumber` back to the HHG request (`odt:795`) | **a new unit entirely** — and it falls out of stage 1, because a _new commitment_ was made, not merely a new document issued                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A move cancelled after packing, before loading                                        | no BOL is ever issued (§375.505(c) dates it to departure); the commitment was made and the lot was packed and inventoried                                                                                                                                                                                                                                                                                                                                                          | **one shipment**, minted at stage 1, terminal at `cancelled`. §5.2 and §8.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Where this revision disagrees with the critique — cross-document conflict #4.** The critique
(and conflict #4) reads revision 1 as holding that a terminated storage that moves onward is a
new shipment, and sets that against `A3`'s "identity survives every storage interval". Both
sides overstated. DTR's own text supports only that **the BL does not survive termination** —
a statement about the _document_, from which revision 1 inferred a statement about the
_shipment_. That inference was B-DOC doing unlicensed work. This revision does not make the
claim in either direction and defers it, with `00-shared-decisions.md` §10.4, to A2/A5. The
critique's underlying point — that two documents asserted opposite answers and neither owned
the `Custody` interval — is accepted in full **as to the first half, and is now answered as to
the second** `[SD §4.8]`, `[SD §10.2 item 17]`: **nobody owns an interval, because there is no
interval.** What is published is `handover` assertions, and who held the goods is the named,
versioned fold **`custodyAt(goods, instant)`** `[SD §4.8.3]` over them plus
`ExternallyPerformedLeg.custodyBasis`. The ownership question the critique posed dissolves rather
than being assigned: a fold has inputs and a rule id, not an owner. What genuinely remains open is
**custody _authority_** — whose assertions win — which is [`A8`](A8-authority-skeleton.md)'s and is
capped at medium by A8 §10's last row (§8.8, §6.7).

### 3.3 Identity (A9) — what this fork contributes, and what now governs

**The shape is `00-shared-decisions.md` §7 and is not restated here.** Revision 1's §3.3
shape is **withdrawn**: it had no effective interval, no vocabulary scope, only two grains, a
**stored mutable `primary`**, and a mutable correlation state — five defects the critique named
and the shared layer fixes. In particular:

| Revision 1                                                                                        | Governing rule now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Identifier { scheme, issuer, value, primary, assertedBy, assertedAt }` as fields on an aggregate | An **Assertion** of `type = identity` (`00-shared-decisions.md` §7.1), inheriting the envelope: `assertedBy {partyRef, role}`, `assertedAt`, `capturedBy`, `recordedAt`, `supersedes`. `scheme` and `vocabularyScope` sit in the assertion's `qualifier`, which is what makes them part of the fact key rather than part of the value.                                                                                                                                                                                       |
| no validity interval                                                                              | `effectiveFrom` / `effectiveTo`. Sourced twice: `src:x12-212-trailer-manifest` `BLR-02`, an effective date on a **per-shipment** carrier SCAC — "the standard expects the shipments on one trailer to belong to _different_ carriers"; and `src:dp3-400ng` GBLOC reassignment mid-life with transfer lists and effective dates (Regionalization p.17).                                                                                                                                                                       |
| no vocabulary scope                                                                               | `vocabularyScope {authority, tariff?, brand?, year?, programme?}`. Grade-A support: `src:sirva-ade`'s addressable key is the **triple** `Brand + RegNumber + RegYear` — "reg numbers recycle across years and brands" (GSD p.15). _(The scope's member is `authority` — the body that defines the naming vocabulary — and not a second `issuer`; revision 2 carried `issuer` in both places with no stated difference, and shared §7.1 splits them: `authority` owns the vocabulary, `issuer` assigned this particular id.)_ |
| two grains (order, shipment)                                                                      | **every aggregate kind** (`00-shared-decisions.md` §1.2). The three the critique named are each sourced there: **equipment** (`MS2` owner SCAC + owner-assigned number + check digit), **trip** (SIRVA's `QPDTripNumber` _and_ `CamisTripNumber`, SOE p.2), **stay** (the DTR **SIT control number**, §3.3.2 below).                                                                                                                                                                                                         |
| stored `primary` flag                                                                             | **derived** — the output of `FactResolved` over the identity assertions for one **`(subject, scheme, vocabularyScope)`** at an instant, the same tuple arity is stated over (rule **I-KEY**). `src:project44`'s `primaryForType` is the precedent for the concept; deriving rather than storing is **[ORIGINAL]** and is the shared layer's, not ours.                                                                                                                                                                       |
| `assertedBy` / `assertedAt` as the only ordering                                                  | reissue is a new identity Assertion with its own `effectiveFrom` and a `supersedes` link — which is the answer to the critique's reweigh/reissued-BOL objection (§8.4). No `issuedAt` field is added.                                                                                                                                                                                                                                                                                                                        |

What this fork still contributes and stands by:

1. **`scheme` must carry the assigner, and the vocabulary must be ours.** `src:project44`'s own
   definition of its type enum — _"the standard which defines who assigns the identifier and
   what it identifies"_ — is the idea. **Reject the 70-value list as our vocabulary**: its own
   HHG fidelity is 1; PRO, BOL and SCAC are there, van-line registration number and RMC
   service-order number are not.
2. **`issuer` is mandatory, which is why a bare map is rejected.** `src:samsara`'s `externalIds`
   has no issuer; `{"registration": "123456"}` is ambiguous the moment a tenant is an agent for
   two van lines — the exact case `src:sirva-ade`'s `Brand` scoping exists to solve. Take
   samsara's **path addressability** (`vanline.registration:AVL:123456`); discard the flat
   namespace.
3. **N per `(subject, scheme, vocabularyScope)`, not one — and `primary` resolves per that same
   tuple.** `src:cfr-49-375` says so in the regulation: BOL item 16 is _"any identification or
   registration number **you** assign to the shipment"_ (§375.505(b)(16)) — the qualifier "you"
   presupposes others.

   _This is the one place revision 2 was internally inconsistent about identity, and the
   inconsistency had teeth._ Arity was stated over `(subject, scheme, scope)` while `primary` was
   resolved over `(subject, scheme)`. Read together, the two-van-line case immediately above —
   **one** scheme `vanline.registration`, **two** brand scopes `AVL` and `NVL`, both registration
   numbers concurrently valid and both correct — was forced into a single `primary` contest, and
   `FactResolved` had to declare one of two correct identifiers the loser. Shared §7.1's rule
   **I-KEY** puts the scope in both keys, so the agent holds two identifiers in two contests of one.
   It is also a corollary rather than a special case: `identity` declares `{scheme, vocabularyScope}`
   as its `qualifier`, and the general fact key is `(subject, type, qualifier?)` (`[SD §1.3]`).

4. **Echo the counterparty's key back, as an obligation.** `src:dcsa` states it; `src:sirva-ade`
   does it (`ExternalReference` = "Agent's internal lead reference", LEP p.3).
5. **Canonicalise to match; never to store.** `src:shippeo`'s Smart Reference Matching as a
   **published policy**, forbidden from mutating `value`. The failure mode is a false positive,
   worse than a miss — so a canonical match is an Assertion with a resolvable verdict, never a
   truth (§5.4).

#### 3.3.1 The grain argument — **softened, and a partial disagreement stated**

Revision 1 wrote: _"The identity evidence independently confirms the cardinality decision —
which is the strongest single argument in this document, because it does not depend on anyone's
modelling taste."_

**That sentence is withdrawn.** The critique is right that it overclaimed, on two counts:
the argument is not independent of taste (the car case needs §3.5(a)'s uncited criterion to
overrule Weichert), and reading a `shipments[]` array as ontology is reading a document layout.
Neither "independently confirms" nor "the strongest single argument" survives.

**Where this revision disagrees, and argues it.** The critique's framing — "it reads Weichert's
_document layout_ as ontology" — is too strong for the narrower claim, and the narrower claim is
the one worth keeping:

> **The three numbers the question names are not at one grain, and the evidence for that is a
> `Required` field, not a layout choice.** `supplierShipmentId` is _Required_ and is defined as
> the supplier's own id "from their proprietary system", carried **per element of `shipments[]`**
> (`odt:378`, `odt:1411`), while `serviceOrderNumber` is the key of the enclosing record
> (`odt:72`). A JSON nesting is a rendering decision; a **mandatory distinct key at the inner
> level** is a statement that the inner thing is separately identified by a party who is not the
> publisher. A publisher who thought order and shipment were one thing would have no reason to
> require the supplier to supply a second id for the inner one.

So: the grain observation stands as **corroboration**, at reduced weight. It does not
independently establish the cardinality decision, and the car case is decided by §3.5(a)'s
[ORIGINAL] criterion against one of its own sources. Both facts are now stated where the
argument is made, and §7's score moves accordingly.

**And the opposite reading, recorded because the source's own analysis records it:** Weichert
makes **Auto and Pet separate _order types_, not shipment types** — its analysis flags this as
"a modeling choice worth noting" (A2 row). On the single case this document's acceptance test
turns on, the live RMC contract disagrees with the recommendation. That is taste against taste,
resolved by an authored criterion, and §3.5(a) says so.

#### 3.3.2 Foreclosure #3's promise, withdrawn

Revision 1's foreclosure #3 said "we must supply a **stay** id and cannot hand a warehouse
system a shipment id." **Withdrawn — the industry already publishes one.** `src:dtr-part-iv`
A-406 §A.11 p.5 / A-402 §D.5.a(2) p.17: the **SIT control number** is 9 digits — `YY` + Julian
day of entry + a 4-digit sequence within that day — and a **split shipment gets its own SIT
control number per increment** (#662). A constructed, per-stay identifier with its own
semantics, issued by the programme. The counterpart failure is in a partner contract and is
the reason the stay grain matters: `src:sirva-ade` has **no SIT identifier at all**, so on a
shipment with origin _and_ destination SIT, `ChangeSIT` / `DeleteSIT` cannot say which one they
mean.

### 3.4 Criteria weighted, and why

| Criterion                                                                         | Weight      | Why                                                                                                                                                                                                                                                                                                              | How it decided                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Legal/regulatory bindingness**                                                  | highest     | `src:cfr-49-375` and `src:dtr-part-iv` bind us; vendor APIs do not. A model that disagrees with the BOL is wrong in a way no refactor fixes.                                                                                                                                                                     | Gave the _evidencing_ half of the definition and the three named DoD operations. It did **not** give B-DOC, which is ours (§3.2.2).                                                                                                                                                                                                          |
| **C4 — HHG fidelity**                                                             | high        | Rubric A2's own emphasis, and the round-1 finding that A2 is the one v1 area with an HHG-native source scoring 3/3.                                                                                                                                                                                              | Kept MilMove's typed-shipment shape and Weichert's three levels; discounted DCSA and UN/CEFACT to _mechanism_ contributions.                                                                                                                                                                                                                 |
| **Expressiveness against the acceptance test**                                    | high        | A cardinality answer that cannot carry a car and a SIT remainder is not an answer.                                                                                                                                                                                                                               | Eliminated P3 and P4 as _the_ shape (see 3.6). Note the honest qualifier: the test is discharged only together with `00-shared-decisions.md` §8 (§8.5).                                                                                                                                                                                      |
| **Asymmetry of regret** **[ORIGINAL]**                                            | high        | Adding a parent later is cheap; splitting a child later is not. **Reasoning, not evidence — no source states it.**                                                                                                                                                                                               | Generous at order→shipment (1:N now); stingy above it (relocation is a reference, not an aggregate).                                                                                                                                                                                                                                         |
| **ADR-0055 discipline: an aggregate whose arity is always 1 should be collapsed** | medium-high | `src:milmove-mymove` argued this in writing, recorded the pro it was giving up ("allows for the possibility of multiple MTOs for a single move") **and** the cost ("there is a risk we might not be representing an MTO accurately. An MTO is a legal construct with specific requirements"). Both halves apply. | Kept the order level (arity demonstrably >1 in Weichert's own examples, **and** it carries a lifecycle of its own); refused the relocation level — but see §3.5(b), which no longer claims Weichert as evidence _against_ a relocation aggregate.                                                                                            |
| **C2 — semantic precision of the definition**                                     | medium      | A definition that does not decide cases is decoration.                                                                                                                                                                                                                                                           | Chose "one transport undertaking" over "separately routed" / "separately priced". Revision 1 justified this by "only that one comes with a published test"; that justification is withdrawn with B-DOC's re-marking. The remaining justification is that it is the only one of the three whose boundary is drawn by a _party other than us_. |
| **C6 — identity & references**                                                    | medium      | A9, and a live constraint: three ids at (at least) two grains.                                                                                                                                                                                                                                                   | Contributed to `00-shared-decisions.md` §7; no longer decided here.                                                                                                                                                                                                                                                                          |

Two criteria deliberately **not** weighted: our own systems' ability to supply any of this
(S5 is withdrawn, and the model is an ideal target), and ease of migration (the scope rule
forbids designing for it).

### 3.5 Two sub-decisions that follow, stated so they are not re-litigated

**(a) The car is a shipment TYPE, not an order type. [ORIGINAL] criterion.** Weichert says
order (Auto Shipment is a parallel top-level order with its own `orderStatus`); MilMove says
type (`BOAT_HAUL_AWAY`, `MOBILE_HOME` in a closed enum on the shipment). **Neither source
explains why**, so the criterion is authored:

> **[ORIGINAL] — Rule A-AWARD. If it is awarded separately, it is a separate order. If it
> merely travels separately, it is a separate shipment under the same order.**

Applied: Weichert's Auto lane is a separate order because the RMC _awards_ it separately — it
has its own accept/decline handshake on its own endpoint, which is a fact in the contract. A
car moving under one booked engagement, awarded once, is a **second shipment**. Both sources
are then right about their own case, and the model needs only one rule.

**Stated plainly, because §3.3.1 concedes it:** this rule is the thing that lets the
recommendation overrule a live partner contract on the case the acceptance test turns on. It is
unsourced. §7 scores it **medium** and lists it under unsupported assertions.

**(b) A relocation container is a reference, not an aggregate — in v1.** Revision 1 argued this
partly on the ground that Weichert "carries it as an _identifier with an undocumented suffix_,
not as an entity with state." **That argument is withdrawn.** The Weichert analysis records the
`-N` suffix as its own **open question 8** — "several service orders share a move stem across
the examples (`odt:270, 845, 2028`), which looks like the RMC's own order-within-move sequence —
the nearest thing this source has to an order/shipment hierarchy above the service order." An
unanswered question about a field's semantics is not evidence that the publisher has no
aggregate behind it; if anything the analysis reads it the other way.

Re-framed, on what actually supports the decision:

- **What Weichert shows is that the level exists** — `moveNumber` on every lane, several
  service orders per move stem. It is evidence _for_ a relocation level, not against one, and
  this document now says so.
- **What is missing is a lifecycle for it.** No source in the corpus gives a relocation-level
  entity a state, a transition or an actor — not Weichert (which documents no lifecycle
  anywhere, its own A1 C3=1), not SIRVA, not Atlas, not CFR, not DTR. `src:milmove-mymove`'s
  `Order` is a false friend (the service member's PCS orders — the _authority_, not a
  container), and MilMove's actual container, `Move`, is one tenant's programme construct.
- **The decision therefore rests on the [ORIGINAL] asymmetry-of-regret criterion alone**:
  promote it later at no re-keying cost, because adding a parent is the cheap direction. In v1
  it is an `Identifier{scheme: rmc.move, issuer: <RMC>}` on the order, which
  `00-shared-decisions.md` §7 holds at order grain without difficulty.

§7's confidence on this sub-decision stays **medium-low** and user question #1 remains the way
to settle it.

### 3.6 Why each rejected position was rejected

- **P3 (SIRVA — identity-encoded splits).** Rejected as _the_ shape; kept as a warning. The
  model _is_ the identifier: 6+2+2 digits. A new kind of split needs new digit positions, and
  there is nowhere at all for a vehicle shipment. Its own analysis records the consequence
  downstream — a SIT occurrence has **no identifier**, so `ChangeSIT`/`DeleteSIT` cannot say
  which stay they mean. Composite identity that encodes structure buys addressability and pays
  for it in extensibility, and the bill comes due exactly where HHG is richest. _(Note what is
  kept from SIRVA and is load-bearing elsewhere: P3b's registration-minted shipment, §3.2.3.)_
- **P4 (Atlas — order and shipment fused).** Rejected. The fusion is what _forces_ Atlas to
  model a vehicle move as a separate order; the acceptance test is then answerable only by
  multiplying orders, which pushes the award lifecycle onto something that was never awarded.
  **Re-cited per §2d: structural evidence only. Atlas A9 C2 = 1; nothing semantic rests on it;
  no remedy by fetching `/Types` is proposed or possible.**
- **P6 (DCSA — no shipment lifecycle at all; replay the event stream).** Rejected as the shape;
  its _reference discipline_ is adopted upstream in `00-shared-decisions.md` §7. HHG has a
  physical thing with a state that humans ask about by phone, and `src:cfr-49-375` attaches
  statutory consequences to that state (tender, relinquishment on payment, delivery receipt —
  §§375.603, 375.407, 375.701). **One correction to revision 1's phrasing:** rejecting P6 does
  _not_ license a mutable status column. Under `00-shared-decisions.md` §1.1 a mutable
  current-state field is forbidden permanently; the shipment's "state" is a **projection** over
  assertions. What we reject in P6 is the claim that the physical thing has _no_ state to
  project, not the append-only discipline.
- **P11 (X12 212 — consolidation as a re-issued document).** Rejected as a _persistent_ model.
  The 212 has 9 999 shipments on one trailer but **no stops, no sequence, no legs and no
  driver**, one status for the whole trailer, and no per-shipment state. It is a load plan, not
  a trip. Its contribution here is negative and valuable: the many-shipments-on-one-vehicle fact
  does **not** belong to the order/shipment boundary. Three things _are_ lifted: `TSD`'s loading
  sequence + physical position and element 88's `S Entire Shipment` (→ Fork 3 and A9), and
  `BLR-02`'s effective-dated per-shipment carrier (→ `00-shared-decisions.md` §7.2, which is
  what broke revision 1's `Identifier`).
- **Bare `externalIds` map (samsara) as the identity model.** Rejected: no issuer. The
  path-addressability idea is adopted.
- **Canonicalising identifiers in storage (shippeo).** Rejected: irreversible, and
  false-positive matches are worse than misses. Adopted as a matching policy only.

### Dependency

This decision **assumes Fork 3 puts stops on the trip.** Consolidation, the SIT delivery-out
leg and interleaved pickups are all deferred there on the strength of `src:alvys-api`'s stated
seam (stops belong to the trip; the load's endpoints are derived) and `src:open-trip-model`'s
finding that consolidation then needs no concept at all. **If Fork 3 instead puts stops on the
shipment, consolidation has no home anywhere in the model and this decision fails with it.**
Record the two together or not at all.

**Revision 2 addition — the dependency was under-stated.** The critique showed the pair passed
the acceptance test by pointing at each other: this document deferred _all_ routing to `A3`,
and `A3` could not record a stop performed by a vehicle it cannot identify, leaving the car
shipment with no destination. That hole is now closed **above both documents**, by
`00-shared-decisions.md` §8: "one identified vehicle" is struck from the `Stop` definition, an
`ExternallyPerformedLeg` is added as a first-class subject with its own `authoritativeAsserter`,
and a shipment's origin and destination derive from its acts over **stops and legs alike**.
This document's acceptance test is discharged only with that in place; §8.5 shows the working.

## 4. What this forecloses, and the cost if it is wrong

| #   | Foreclosed                                                                           | Cost if wrong                                                                                                                                                                                                                               | Recoverability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A shipment cannot exist without an order.**                                        | An inbound partner event about a shipment we have no order for has nowhere to land — a real wire behaviour: `src:sirva-ade`'s `Register` arrives as a **push** carrying the full element set, and the agent may never have been told first. | **Mitigated, not eliminated:** mint a _provisional_ order on first sight of an orphan shipment. This must be an explicit modelled state, not an accident (§5.3).                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | **A shipment cannot belong to two orders.**                                          | Two cases press on it: (a) two RMCs co-funding one move; (b) a shipment re-awarded mid-move.                                                                                                                                                | (b) is **not** a counter-example: re-award changes _who performs_, which is a role assignment (A8, and `src:sirva-ade` models role as `Type` × `Owner`), not a re-parenting. Where an RMC genuinely cancels O-1 and issues O-2 for the same goods, a **new commitment** is made and by §3.2.3 stage 1 it is a new shipment, linked by identity — at the cost of a correlation the user must be able to see. (a) is unresolved and is a user question (§6.2). _(Revision 2: this row no longer leans on B-DOC's "a new BOL is issued"; it leans on stage 1, which is the sourced half.)_ |
| 3   | ~~**We must supply a stay id.**~~                                                    | —                                                                                                                                                                                                                                           | **WITHDRAWN.** `src:dtr-part-iv` publishes the SIT control number (§3.3.2). The residual foreclosure is only that a stay id is an identifier at a different grain — which `00-shared-decisions.md` §7 accommodates by construction.                                                                                                                                                                                                                                                                                                                                                     |
| 4   | **Consolidation is unrepresentable at this boundary** — deliberately.                | If Fork 3 goes the other way, the model cannot express the normal case for a van-line agent, permanently.                                                                                                                                   | **Not recoverable.** This is the dependency above and the single largest risk carried by this decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5   | **No relocation aggregate in v1.**                                                   | "Show me this family's whole move" becomes a query over an identifier rather than an aggregate traversal.                                                                                                                                   | Cheap and deliberate — adding a parent is the cheap direction ([ORIGINAL] criterion). Revisit with tenant volume data (§6.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | **A shipment's boundary is narrowed or widened by a document it may never receive.** | Revision 1 called this "the weakest point in the decision", because a contract-rooted definition left the RMC lane and the cancelled move with no subject.                                                                                  | **Materially improved, not eliminated.** §3.2.3's stage 1 gives every shipment a boundary from the moment of commitment, on grade-A partner evidence (P3b) plus MilMove (P1b) plus the regulation's own document sequence (P8b). What remains open is _whose_ commitment mints the boundary when two parties commit differently — an A8 authority question (§6.7).                                                                                                                                                                                                                      |
| 7   | **Shipment identity across a terminated SIT stay is NOT decided here.**              | A model that never decides it will discover the answer implicitly, in code.                                                                                                                                                                 | **Deliberate.** `00-shared-decisions.md` §10.4 assigns it to A2/A5 and guarantees the `stay` aggregate owns the control number and the custody interval either way. §6.7.                                                                                                                                                                                                                                                                                                                                                                                                               |

## 5. ORIGINAL DESIGN — what household-goods moving needs that no source supplied

Each of these is a gap in the corpus, not a gap in our reading. Where something comes
_close_, it is named. **Two items that were in this section in revision 1 have moved out of
it** because the shared layer now owns them; what remains here is this fork's contribution.

### 5.1 Partial-SIT composition — **now `00-shared-decisions.md` §3, not this section**

**The `Portion` is defined at `00-shared-decisions.md` §3 and is not defined here.** Revision 1
defined it as "a named, **weighed** sub-set … minted **only at the moment of physical
divergence** (overflow onto a second vehicle, **a SIT remainder**, a transfer)" and hung it under
Shipment. The critique found two faults and both are conceded:

1. **The internal contradiction is real.** §3.2's acceptance table said a SIT remainder is
   "still one shipment"; §5.1 minted a `Portion` for "a SIT remainder" and drew it as a
   sub-entity of Shipment, as though that were a split. **Resolved in favour of §3.2**, by
   `00-shared-decisions.md` §3.2 rule **P-IDENTITY**: _a Portion never changes the shipment
   boundary; minting a Portion is not splitting a shipment._ The SIT remainder is a Portion;
   the shipment is untouched; §3.1's diagram now says so.
2. **The grain was wrong in both directions** — "far too heavy for two items, and too light for
   a claim." Conceded. Fixed upstream: membership is `MEASURED | ENUMERATED | BOTH`; the
   "only at physical divergence" restriction is **removed** (two refused articles mint a
   Portion); **P-CLAIM** states that a `MEASURED`-only Portion cannot support a claim, grounded
   in `src:dp3-400ng` Item 17.12.c and `src:cfr-49-375` §375.503; **P-OVERLAP** permits overlap
   and nesting, which is what the normal SIT case needs.

**What this fork contributed and the shared layer kept** (recorded so the provenance is not
lost): the observation that _the crew often knows the weight and not the contents, and a model
that demands the contents will be lied to_ — carried forward as rule **P-MEMBER** (a Portion may
be minted `MEASURED` and later become `ENUMERATED` without changing its `portionId`), where the
shared layer calls it "the one genuinely useful idea in `fork-order` §5.1". The
composition-known idea itself is lifted from `src:nmfta-ebol`'s `lineItemLayout`
(`Nested` = the containment "is known"; `Stacked` = "is not known") and is **not** original;
what is [ORIGINAL] is applying it to a sub-shipment set and permitting the transition.

**What this fork's invariant becomes.** Revision 1 said "a Portion never gets its own BOL; the
moment it needs one, it is a new shipment." Under the shared layer that is redundant with
P-IDENTITY and is **restated, not repeated**: a Portion is a statement about _which goods_, never
about _which undertaking_. If a separate undertaking is made over a subset, §3.2.3 stage 1 mints
a shipment — and the Portion, if it still names the same goods, simply keeps naming them.
The two mechanisms are orthogonal, which is why they no longer contradict.

### 5.2 A boundary that never acquires its defining document — **[ORIGINAL], and rewritten**

The critique's objection, in full: "A move cancelled before loading normally has no BOL at all
(§375.505(c)). The packed lot is therefore a §5.2 **provisional** shipment forever: §5.2 defines
only provisional→confirmed, §5.3 covers only an order with **zero** shipments, and nothing states
what a shipment boundary that never acquires its defining document _is_, or whether it may be
cancelled, invoiced against, or claimed on."

Accepted in full. Revision 1's `provisional → confirmed` pair was a two-state machine with no
third state, and it made the normal case (a lot that is packed, priced, and cancelled) an
anomaly. Replaced:

> **[ORIGINAL] — Rule B-STAGE. A shipment's boundary has a _stage_, not a _provisionality_.**
>
> | Stage                | Reached by                                                                                                                   | What it means                                                                                                                                   |
> | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
> | `committed`          | the minting act — `Register`, an award, a submission (§3.2.3 stage 1)                                                        | The boundary is the set the commitment named. The shipment is fully real: it can carry acts, charges, portions, identifiers and a cancellation. |
> | `evidenced`          | the transport contract issues                                                                                                | The document evidences the boundary. If it narrows or widens it, that is a **new assertion superseding the old**, never an edit.                |
> | `closed_uncontested` | a terminal act (cancellation, or completion where no transport contract was ever issued) with no document ever having issued | **Not an incomplete `committed`.** The boundary was never contested and is final as the commitment named it.                                    |
>
> There is no failure state. A boundary that is never evidenced is not defective; it is
> unexamined.

**What is sourced, precisely:**

- That a shipment is minted by an act and can reach a terminal state without any transport
  document: `src:sirva-ade` (`Register` → `ShipmentStatus = REGISTERED`; `CANCELLED` in the
  same enum; `Cancel` carries **no reason code at all**, SOE p.15 — a defect worth noting, and
  the reason `00-shared-decisions.md` §2's `reasons[]` matters) and `src:milmove-mymove`
  (`DRAFT → SUBMITTED → APPROVED`, terminal `CANCELED`, two actors).
- That the lot is named, enumerated and priced _before_ the contract document exists:
  `src:cfr-49-375` §375.403(c)/§375.405(d) (dated bilateral estimate, retained as an integral
  BOL attachment), §375.503(a) (itemized inventory, per-article id, prepared _before or at_
  loading), §375.401(f) (accessorials determined _before_ preparing the BOL), against
  §375.505(c) (the BOL is in the driver's hand before the vehicle leaves origin).
- That corrections are supersessions rather than edits: `src:cfr-49-375` (a changed price is a
  _new signed estimate_ or a _written attachment_, never a mutation) and `src:gs1-epcis-cbv`
  (`errorDeclaration`, retraction vs supersession). Under `00-shared-decisions.md` §4 this is
  simply `supersedes` on an Assertion.

**What is [ORIGINAL]:** the three-stage rule itself; the naming of `closed_uncontested` as a
_normal_ terminus rather than an error; and the rule that stage 2 may narrow _or widen_. No
source states any of the three.

**Can it carry charges?** Yes, and the mechanism is not ours: under `00-shared-decisions.md`
§8.4 a pack-only day **is a Trip with one Stop**, so the pack act has a stop to anchor to and
the packing-materials charge has the stop that caused it. The act's `subject` is the shipment
(`00-shared-decisions.md` §1.2), so the charge reaches a real subject. Whether such a charge is
_collectable_ on a cancelled move is a tariff question and belongs to **A7**, not here.

### 5.3 The lifecycle of an order with zero shipments

_Partially_ original. There is one external datum: in `src:weichert-supplier-api`, **accept is
expressed as an update carrying an empty `shipments` array** (`odt:322`, and identically at 892,
1343, 2081, 2586, 2968, 3456). So "an accepted order with zero shipments" is a legal state on a
live RMC wire. But that is a protocol fact, not a model — the document states no lifecycle, no
transitions and no actor anywhere (its own A1 C3=1).

**[ORIGINAL]:** the _states_ an order occupies before any shipment exists (surveyed, estimated,
awarded, accepted, cancelled-pre-commitment) and which of them may be terminal. This belongs to
Fork/Area A1, but it is named here because the cardinality decision creates it: choosing 1:N
makes zero a legal value of N, and something must say what that means. It is now carried as
order-subject assertions under `00-shared-decisions.md` §1.2 — the order is a first-class
subject and its lifecycle needs no shipment on it.

### 5.4 Correlation needs a **resolvable verdict**, not a boolean and not a mutable field

`src:shippeo` canonicalises and matches. `src:dcsa` echoes the counterparty's reference back.
`src:project44` publishes `selected` alongside the losing candidates for a _time_ value.
**Nobody publishes the equivalent for an identity match** — nobody says "we believe these two
numbers denote the same shipment, on this evidence, and the counterparty has not confirmed it."

Revision 1 proposed a correlation with a mutable state (`asserted` / `confirmed` / `disputed`).
**That is withdrawn as a mutable field** — it collided with the append-only discipline
(cross-document conflict #5). Under `00-shared-decisions.md` §7.5 and §4:

- A canonical match is an **Assertion** (`type = identity`, `capturedBy = DERIVED_BY_RULE`,
  carrying `{ruleId, ruleVersion}` and the eventIds of its inputs under M4), not a truth.
- A counterparty **echoing the key back** (`src:dcsa`'s stated obligation) is a _second_
  assertion by a _different_ party under the same fact key `(subject, identity, {scheme, scope})`
  — which is what "confirmed" was
  reaching for, expressed as evidence rather than as a flag.
- A dispute is two competing assertions, resolved by a published **`FactResolved`** naming its
  rule; the history of which answer we were giving when survives.

**[ORIGINAL] content that survives:** the idea that identity correlation is _contested evidence_
rather than a boolean, and that the match method (exact value / canonical match under the
published rule / human) must be recorded. Borrowed in spirit from project44's "publish the
winner alongside the candidates so the resolution rule is auditable"; original in its
application to identity rather than to time. The _mechanism_ is now the shared layer's, not
ours.

### 5.5 The criterion separating a shipment type from an order type

Stated at §3.5(a) as rule **A-AWARD**. `src:milmove-mymove` and `src:weichert-supplier-api`
disagree on the car and **neither states a criterion**. "Awarded separately → order; travels
separately → shipment" is derived here, not cited. It is the rule that lets both sources be
right about their own case, and it is the piece of §3 that rests on no external text — and, per
§3.3.1, it is the rule that overrules a live partner contract on the acceptance test's own case.

## 6. What only the user can decide

Listed separately because none of these is answerable from the corpus.

1. **Is a relocation aggregate needed in v1?** Needs tenant volume: how often does one household
   generate more than one order (an HHG order plus an auto order plus a storage order)? If that
   is the majority case rather than the exception, §3.5(b) should be revisited before the catalog
   publishes. Weichert's `M-C-28608-{4,6,7}` examples show the level exists; they do not show how
   often it is >1 in real traffic.
2. **Can an order and its shipments be owned by different tenants?** Concretely: is a tenant ever
   the _booking_ agent on an order whose shipment another agent performs and records? This decides
   whether "a shipment belongs to exactly one order" is also "to exactly one tenant", and it
   changes the visibility model, not just the schema.
3. **The initial contents of the `scheme` registry.** Which counterparties' numbering systems get
   first-class scheme ids in v1 — Allied/`AVL`, northAmerican/`NVL`, Atlas, Weichert, and which of
   SCAC / PRO / BOL / GBL / registration / service-order / SIT control number. A commercial
   decision about which integrations are supported, not a modelling one.
4. **Are orphan inbound shipments rejected, or do they mint a provisional order?**
   (Foreclosure #1.) Rejecting is cleaner and will drop real events on the floor; minting is
   forgiving and will create ghost orders that someone must reconcile.
5. **Do tenants ever re-issue a transport contract mid-move for administrative reasons?** Under
   B-DOC that would mint a new shipment. If it happens routinely for reasons other than
   reshipment, B-DOC needs a qualifier and the user is the only source for how often it happens.
6. **Whether to buy `src:iso-17451`.** Out of scope for this fork, but the Portion's composition
   question sits squarely in the one formal removals inventory standard that exists and that we
   have never obtained. It has a purchase lead time.
7. **NEW — whose commitment mints the boundary when two parties commit differently?** The RMC
   awards one service order; the van line registers two registrations against it. Stage 1
   (§3.2.3) says the boundary is "the set the commitment named", and does not say whose
   commitment wins. This is an A8 authority question and the user is the source for which
   counterparty's commitment is treated as authoritative per lane. _(Not the same as the A2/A5
   question of identity across a terminated SIT stay, which is not a user question at all —
   see §4 foreclosure #7.)_

## 7. Confidence

Scores below are **revised downward in three places** per `00-shared-decisions.md` §10.2 items
5, 6 and 7.

| Claim                                                                              | Confidence                                                    | Why not higher                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One order may carry more than one shipment (N ≥ 1)                                 | **high**                                                      | Two independent sources state it structurally (MilMove's typed shipments under one Move with per-subtype tables; Weichert's `shipments[]` under a service order with a `Required` per-shipment supplier key). The only dissent (Atlas, structural evidence only) dissents by fusing, and then has to multiply orders to answer the same question. _Revision 2: the "third source", the §3.3 identity argument, is no longer counted as independent — see §3.3.1._ |
| A shipment is the set of goods committed to move under one transport undertaking   | **medium-high**                                               | Backed by one formal definition (UN/CEFACT Consignment, "one single transport service contractual document") plus two binding regulations for the _evidencing_ half and two partner contracts for the _minting_ half. Held below high because the formal definition bounds a **consignment**, not a shipment, and because stage 1's "whose commitment" question is open (§6.7).                                                                                   |
| §3.2.3's two-stage boundary (`committed` → `evidenced`, with `closed_uncontested`) | **medium**                                                    | The states are sourced twice at grade A (SIRVA `REGISTERED`/`CANCELLED`; MilMove `DRAFT…CANCELED`) and the document sequence once in regulation (P8b). **The rule joining them is [ORIGINAL]** and so is `closed_uncontested`. It is the piece most likely to need an A1 revision.                                                                                                                                                                                |
| **B-DOC** — a new transport contract marks a new shipment                          | **medium** _(was: high)_                                      | **Lowered per `00-shared-decisions.md` §10.2 item 5.** DTR states two _named DoD operations_, not a universal rule; revision 1 presented the generalisation as DTR's and it is ours. It is now listed under unsupported assertions.                                                                                                                                                                                                                               |
| The diversion / reshipment distinction **as DTR states it**                        | **medium-high** _(was: high)_                                 | **Lowered per §10.2 item 6.** Both halves are stated directly by `src:dtr-part-iv`, and the terminated-BL half is corroborated by `src:dp3-400ng`. But DTR's diversion **expressly excludes shipments already in SIT at destination** (#255; corroborated at `src:dp3-400ng` Item 28.4.d) — which is the case this document's own acceptance test turns on. The test is clean where it does not matter most.                                                      |
| Identity shape                                                                     | **not scored here**                                           | Decided by `00-shared-decisions.md` §7, which scores it **High** on its own evidence (effective interval sourced twice, vocabulary scope at grade A, every named grain sourced). Revision 1's shape is withdrawn; this document's contribution is the survey (§2b) and the five retained arguments (§3.3).                                                                                                                                                        |
| The grain observation as **corroboration** for cardinality                         | **medium** _(was: "the strongest single argument", unscored)_ | **Softened per §10.2 item 7.** `Required`-per-element beats layout (§3.3.1), but the same source makes Auto/Pet separate _order_ types, and the car case needs the [ORIGINAL] A-AWARD criterion to overrule it. Corroboration, not proof.                                                                                                                                                                                                                         |
| No relocation aggregate in v1                                                      | **medium-low**                                                | One source carries the level, and its own analysis flags the suffix as an open question — so the evidence is _for_ the level, not against it. The decision rests on the [ORIGINAL] asymmetry criterion. Flagged as user question #1.                                                                                                                                                                                                                              |
| The car is a shipment type, not an order type (**A-AWARD**)                        | **medium**                                                    | The criterion is derived, not cited. Two strong sources disagree on the instance, and this rule overrules the grade-A one.                                                                                                                                                                                                                                                                                                                                        |
| Consolidation belongs to the trip, not here                                        | **medium-high as a claim, load-bearing on Fork 3**            | Strongly supported (Alvys's stated seam; OTM's "no concept needed"; the 212's verdict that a manifest is a load plan, not a trip). Confidence in a _dependency_, not in this document — and now also dependent on `00-shared-decisions.md` §8, without which the acceptance test does not discharge.                                                                                                                                                              |
| Shipment identity across a **terminated** SIT stay                                 | **not claimed**                                               | Deferred to A2/A5 by `00-shared-decisions.md` §10.4. Revision 1 implied an answer via B-DOC and should not have.                                                                                                                                                                                                                                                                                                                                                  |

### Assertions made here that no source supports

Flagged so they are not read as evidence. **Three items are added in revision 2**; the list is
now the complete set of [ORIGINAL] marks in the document.

- The **asymmetry-of-regret criterion** (§1, §3.4) — adding a parent is cheap, splitting a child
  is not. Reasoning, not evidence.
- **[ADDED] Rule B-DOC** (§3.2.2) — "a new transport contract over the same goods marks a new
  shipment." DTR states two named DoD operations; the generalisation is ours. _Revision 1 omitted
  this from the list and then scored it high; that was the document's worst disclosure failure._
- **[ADDED] Rule B-STAGE** — the two-stage boundary and the `closed_uncontested` terminus
  (§3.2.3, §5.2). The states are sourced; the rule joining them is not.
- **Rule A-AWARD** — "awarded separately → order; travels separately → shipment" (§3.5a, §5.5).
- The **§2c reconciliation** of the MMT/SCRDM contradiction — the _contradiction_ is documented
  by both analyses; the argument that each rule is true from its own chair is made here.
- **[ADDED] The grain argument's narrow form** (§3.3.1) — "a mandatory distinct key at the inner
  level is a statement that the inner thing is separately identified." Weichert requires the
  field; the inference about what requiring it _means_ is ours.
- Correlation as **contested evidence** rather than a boolean (§5.4) — the mechanism is now the
  shared layer's; the framing is ours.

**Assertions inherited, marked, and owned elsewhere** (listed so a reader can follow them):
the `Portion` and all its rules (`00-shared-decisions.md` §3), the envelope and `subject`
(§1 there), `(outcome, reason)` (§2 there), the generic `Assertion` and `FactResolved` (§4
there), `Identifier`'s derived `primary`, effective interval and vocabulary scope (§7 there),
and `ExternallyPerformedLeg` (§8 there).

## 8. Acceptance — the nine scenarios, run explicitly

Each scenario states **how it is expressed**, or says plainly that it is not. Mechanisms owned
by `00-shared-decisions.md` are cited as `[SD §n]`.

### 8.1 Five families' goods on one van over four days

**Expressed — and entirely outside this document.** Five orders, five shipments (one each, by
§3.1's usual N = 1). One trip carries all five; the many-shipments-to-one-vehicle fact belongs
to the trip (§3.6 P11, and the Dependency). Nothing at the order↔shipment boundary changes as
the van fills.

- Four days with a driver change mid-way: an `Assignment` interval on the trip, not a new trip
  (`00-shared-decisions.md` §10.1 item 13 forces `A3` to resolve this in favour of the
  assignment-interval structure). No shipment is affected.
- Each family's goods remain one shipment throughout; per-shipment position on the vehicle is
  the 212's `TSD` (loading sequence + relative position), lifted to Fork 3.
- **What this document forecloses and is content to foreclose:** there is no aggregate for
  "the five together". A manifest is a load plan (§3.6 P11), not an entity here.

### 8.2 SIT, delivered six weeks later by a different agent

**Expressed, with one part deferred by name.**

- Goods into SIT under a live BL: **one shipment** (§3.2.4 row 3). The part in the warehouse is
  a **Portion** `[SD §3]`, and rule **P-IDENTITY** guarantees minting it does not split the
  shipment — which is the resolution of revision 1's internal contradiction.
- The **stay** is its own aggregate with its own subject kind `[SD §1.2]` and its own published
  identifier — the DTR **SIT control number**, 9 digits, one per increment on a split shipment
  (§3.3.2). Foreclosure #3 is withdrawn.
- The SIT entry date is **derived**, not keyed: `capturedBy = DERIVED_BY_RULE` with a named rule
  `[SD §5.2 M4]`, because two regulations state it from opposite directions (`src:dp3-400ng`
  Items 29.4/29.6/17.20: SIT in-date = the TSP's **first available delivery date**, and "the
  arrival date must NOT be entered as the SIT entry date"; `src:dtr-part-iv` §D.5.b(2) NOTE:
  effective "the date the shipment was **offered for delivery**, not the date it arrived").
- **Delivery out by a different agent**: an `ExternallyPerformedLeg` with `performedBy` = the
  named agent and its own `authoritativeAsserter` `[SD §8.2]`, or a Trip with one Stop if the
  delivery-out crew is ours `[SD §8.4]`. The shipment's destination derives over **legs and
  stops alike**, so the delivery lands. `src:sirva-ade`'s `RR19` (Reverse Rule 19: "an
  authorized substitute agent performs the delivery", with its own `RR19AuthNumber`, its own
  agent resource and its own weight, SOE p.17) is the grade-A precedent.
- **Deferred by name:** whether `store-out` after a **terminated** stay names the same shipment
  id as `store-in`. Not settled here; `[SD §10.4]` assigns it to A2/A5; §4 foreclosure #7 and
  §7 record it. The stay owns the control number either way, and who held the goods needs no owner:
  it is the fold `custodyAt(goods, instant)` (`[SD §4.8.3]`), not a stored interval.

### 8.3 Delivery attempted twice — absent, then refused for damage, two items short

**Expressed — by `00-shared-decisions.md` §2 and §3, which this document adopts wholesale.**
Revision 1 could not express it: its only sub-shipment device was a weighed Portion minted at
physical divergence, which the critique correctly called "far too heavy for two items, and too
light for a claim."

```
Act  type=Delivery  subject=shipment:S  context=[stop:T1]  basis=ACTUAL
     outcome=NOT_COMPLETED
     reasons=[{code=CONSIGNEE_ABSENT, scope=PARTY,
               attribution={roleClass: customer}, remedy={newWindow: …}}]

Act  type=Delivery  subject=shipment:S  context=[stop:T2]  basis=ACTUAL
     outcome=PARTIALLY_COMPLETED
     reasons=[{code=REFUSED_DAMAGE, scope=GOODS, appliesTo=[portion:P1]},
              {code=SHORT,          scope=GOODS, appliesTo=[portion:P2]}]
```

- One act per visit, not two per visit: `[SD §2.3]` invariant 3.
- `P1` and `P2` are `ENUMERATED` Portions of item refs — which is what makes a **claim**
  possible (`P-CLAIM`: a `MEASURED`-only Portion cannot support one, grounded in
  `src:dp3-400ng` Item 17.12.c and `src:cfr-49-375` §375.503).
- The type names the **act**, never the outcome (`A-TYPE`, `[SD §2.5]`) — evidenced by
  Shippeo's own schema defect.
- **This document's only contribution here** is that the acts' `subject` is a shipment that
  exists and is bounded (§3.1), and that `P1`/`P2` do not split it (`P-IDENTITY`).

### 8.4 A reweigh in transit

**Expressed.** Two `Assertion`s of `type = weight.net`, both `basis = ACTUAL`, by distinct
weighings `[SD §4.1]`. Resolution is **not** recency and **not** a correction:

- `R-WEIGHT-LOWER` `[SD §4.4]` — three statements of lower-wins in one tariff, **one per pairing
  of weighings**, which is how shared §4.4 now cites it: **Item 4 Note 2** for reweigh-vs-reweigh
  (origin and destination agents both reweighed — "DPS must be updated with the **lower** of the
  net reweigh weights"), **Item 4.11.d** for original-vs-reweigh ("invoice on the lesser weight"),
  **Items 4.9.h-i** for ticket-vs-constructive-weight ("whichever is less"). _This scenario is the
  original-vs-reweigh case, so its governing cite is **4.11.d**; revision 2 headed the whole rule
  with Item 4 Note 2, which is the duplicate-reweigh rule and does not reach this pairing._
  Stating one rule over any two ACTUAL net weights from distinct weighings is **[ORIGINAL]**, and
  the rule is **named and scoped in `FactResolved.rule`** as a DoD programme rule, so a commercial
  tariff can carry a different one without the catalog changing shape.
- **The critique's identity objection is answered by the shared `Identifier`, not by this
  document.** The original weight ticket and the reweigh ticket are two `document` subjects
  `[SD §1.2]`, each carrying the shipment's registration-or-BOL number as an identity
  assertion — which `src:cfr-49-375` §375.519(a)(6) **requires** of every weight ticket — and
  each appearing in `evidence[]` of a different `weight.net` assertion. Ordering between values
  of one scheme comes from `effectiveFrom` + `supersedes` `[SD §7.5]`, not from `assertedAt`.
  No `issuedAt` field is added, and revision 1's stored `primary` — which had no ordering rule
  for the non-primary values — is gone.
- The weight's _provenance_ hierarchy (certified-scale ticket, Branham, NADA, customer
  manufacturer documents, constructive rate per cubic foot — `src:dp3-400ng` Items 4.9.g-i) is
  `capturedBy` + `evidence[]` per assertion.

### 8.5 A car on a separate carrier, a week apart — the acceptance test's own case

**Expressed, and only with `00-shared-decisions.md` §8 in place. The critique's finding that
revision 1 did not discharge this is accepted.**

- The car is a **second shipment under the same order**, by rule **A-AWARD** (§3.5a) —
  [ORIGINAL], and it overrules `src:weichert-supplier-api`, which makes Auto a separate _order
  type_. Stated as taste, not as evidence (§3.3.1).
- Its type comes from a closed enum, the published analogues being
  `src:milmove-mymove`'s `BOAT_HAUL_AWAY` / `MOBILE_HOME` with per-subtype tables (ADR 0067).
- **The part revision 1 got wrong:** it deferred _all_ routing to `A3`, where a `Stop` required
  "one identified vehicle" and origin/destination were derived from `StopAction`s only — so the
  car had **no destination at all**. Under `[SD §8]` the vehicle is struck from the `Stop`
  definition, an `ExternallyPerformedLeg` carries `shipment | portion`, `performedBy`, `from`/`to`,
  `custodyBasis` and `authoritativeAsserter`, and origin/destination derive over **legs and
  stops alike**. The auto transporter is a named legal party — which `src:dp3-tender-of-service`
  §B.3.f **requires** ("the legal name and US DOT number of the service provider actually
  hauling the shipment", within 2 GBD of origin departure) — not a truck we cannot see.
- A week apart is nothing: the two shipments have independent execution and independent
  identity assertions; only the order is shared.

### 8.6 Cancellation after packing, before loading, with materials charged

**Expressed — this is the scenario revision 1 could not express, and the fix is §3.2.3 + §5.2
plus one shared decision.**

1. **A subject exists.** The shipment was minted at `committed` by the award/registration
   (§3.2.3 stage 1, on `src:sirva-ade` P3b + `src:milmove-mymove` P1b). No BOL is needed, which
   matters because `src:cfr-49-375` §375.505(c) dates the BOL to the vehicle's departure from
   origin — an event that never happens here.
2. **The lot is named.** The itemized inventory with a per-article identification number is
   prepared _before or at_ loading (§375.503(a)); the dated bilateral estimate is already a
   retained document (§375.403(c), §375.405(d)). The boundary is real and evidenced by documents
   that are not the transport contract.
3. **The pack has somewhere to happen.** A pack-only day **is a Trip with one Stop** `[SD §8.4]`
   — premise sourced to `src:open-trip-model` alone (a Stop "models visiting a certain location
   at a certain time and potentially doing several other actions at that location", requiring no
   movement; a Trip is "**optionally** coupled to a Vehicle"), conclusion marked [ORIGINAL] there.
   _Revision 2 also cited `src:dp3-400ng` Item 28.3 here; that citation is **withdrawn** in shared
   §8.4, because Item 28.3's extra stops are by its own definition pickups "after the first
   pickup" and deliveries "prior to the final delivery" — every one of them on a linehaul route,
   which is the one thing a pack-only day does not have._
4. **The charge has an anchor.** Accessorials scope to the stop that caused them; the pack act's
   `subject` is the shipment `[SD §1.2]`. The materials charge therefore attaches to a subject
   the definition admits exists — which was precisely the critique's objection.
5. **The cancellation is a first-class act** with `outcome = CANCELLED` and at least one
   structured `reason` `[SD §2.2, §2.3]`. Note the corpus defect this repairs:
   `src:sirva-ade`'s `Cancel` carries **no reason code at all** (SOE p.15), and its analysis
   lists that as one of its five worst gaps.
6. **The boundary's terminus is named, not left dangling:** `closed_uncontested` (§5.2, rule
   B-STAGE, [ORIGINAL]). It is not a `provisional` shipment forever.
7. **Deferred deliberately:** whether the packing charge is _collectable_ is a tariff question
   (A7), not a boundary question.

### 8.7 The same arrival asserted differently by the driver's app and the destination agent

**Expressed, entirely by `00-shared-decisions.md` §4 — this document owns none of it, and says
so rather than claiming credit.**

- Both claims are `Assertion`s at `basis = ACTUAL` (legal — `OccurrenceEvent` is abolished)
  `[SD §4, §4.5]`.
- They compete because pairing runs on the derived **fact key** `(subject, type, qualifier?)`, not
  on `subject` alone `[SD §1.3, §1.4, §4.3]`. Rule **E-CANON** declares the canonical subject
  _family_ for `arrival` — the **`stop`** family, `{stop, externallyPerformedLeg}` `[SD §4.7]`.
- **The destination agent's shipment-phrased claim is rejected, not re-keyed** `[SD §4.6]`,
  `[SD §10.2 item 15]`. Revision 3 said it "resolves to that stop (shipment in `context[]`)", which
  reads as the **boundary** filing a record under a subject the asserter never named. It does not:
  - **E-CANON-STRICT.** `shipment` is not in `arrival`'s declared family, so the record **as phrased
    is not admitted** — it acquires no `eventId`, is filed under no fact key and enters no contest.
    The boundary performs no substitution, no nearest-match and no best-guess.
  - **E-CANON-RESOLVE.** Re-phrasing onto the canonical subject is an **ingest-side** act, performed
    _before_ the boundary by a published, versioned **subject-resolution rule**
    (`{ruleId, ruleVersion}`) that must return **exactly one** candidate. The resulting Assertion is
    still the agent's: `assertedBy` and `assertedAt` remain theirs, the subject they named goes in
    `context[]`, their inbound message goes in `evidence[]`, and `capturedBy` is `PARTNER_ASSERTED`.
  - **E-CANON-OBLIGATION.** Where the rule returns zero or more than one candidate, resolution
    **fails** — no recency, nearest-geofence or planned-window tie-break — the submission is retained
    outside the catalog with the rule attempted and its candidate set, and an obligation is emitted
    to the agent naming what it must supply.
  - **The `ExternallyPerformedLeg` half survives unchanged** `[SD §8]`: where no stop of ours exists
    it is the other member of the same family, and so a legitimate **candidate** for the resolution
    rule that keys into the same contest — never a fallback the boundary picks.
- The winner is published by **`FactResolved`**, append-only, naming `{ruleId, ruleVersion}` and
  every assertion considered.
- `capturedBy` separates them: the driver's app is `KEYED_BY_PERSON` or `DEVICE_GEOFENCE`
  (permitted for arrive/depart, M5); the destination agent is `PARTNER_ASSERTED`.
- **This document's only stake** is that both assertions name the same shipment, which requires
  the identity correlation between the van line's registration and our shipment to be itself a
  resolvable assertion (§5.4) rather than a mutable flag.

### 8.8 A mid-journey custody handoff

**Expressible — dwell classification deferred to A5, custody authority deferred to A8.**

_(Common label, fixed at [`00-shared-decisions.md` §10.5](00-shared-decisions.md). Revision 2 said
"Partially expressed" here while A3 said "expressible" and `fork-time` said "yes, with a deferral" —
three wordings for one finding. Nothing in this scenario is inexpressible; two named deferrals to
documents that do not yet exist are not a gap in the shared layer.)_

- **What is expressed:** an `ExternallyPerformedLeg` with `custodyBasis` ∈
  `41 Handed_over_under_continued_responsibility` | `349 Handed_over` `[SD §8.2]` — both defined
  in `src:uncefact-rec24`; the interline pair `J1 Delivered to Connecting Line` /
  `R1 Received from Prior Carrier` (`src:stedi-x12-reference` element 1650); and, crucially, a
  **time-scoped carrier at shipment grain** — `src:x12-212-trailer-manifest` `BLR` + `BLR-02`,
  which is exactly the fact revision 1's `Identifier` could not hold and
  `00-shared-decisions.md` §7.2 now does.
- **What the `custodyBasis` is read _by_** `[SD §4.8]`, `[SD §10.2 item 17]`. It is not read by a
  stored `Custody` interval — there is none. Custody is a **projection**: the named, versioned fold
  **`custodyAt(goods, instant)`** `[SD §4.8.3]` over the `FactResolved`-selected `handover`
  assertions and over `ExternallyPerformedLeg.custodyBasis`. This scenario's leg is one of the fold's
  two inputs. Nothing in the substance above changes; the basis keeps its meaning and its place, on
  the record rather than in an entity.
- The handoff **does not** re-parent the shipment (foreclosure #2): it changes _who performs_,
  which is a role assignment — and `src:sirva-ade` models role as `Type` × `Owner`, with the
  same company legitimately holding two roles.
- **What is not expressed, and is not this document's to fix:** the dwell on a cross-dock
  between two trips (the critique's point — no trip, and A5 owns storage, not cross-dock dwell);
  and **who is authoritative after the handoff**.
- **The A8 deferral, refreshed — the cap has moved rather than lifted.**
  [`A8-authority-skeleton.md`](A8-authority-skeleton.md) **now exists**, and revision 3's "which does
  not exist" is withdrawn. It supplies the hinge (**A8-MOVE** on `custodyBasis` 41 vs 349), the
  instant rule (**A8-INSTANT**, which is what stops the resolution degenerating to recency), and a
  per-fact-class authoritative-role table for eleven classes, which `[SD §4.7]`'s authority column
  quotes. **But `[SD §10.4]`'s bar has moved, not lifted:** A8 §10's last row caps its own
  contribution at **medium**, and only for the fact classes in its §5 — so a dependent decision may
  now be scored **medium**, **may still not be scored high**, and gains **nothing at all** for a fact
  class `[SD §4.7]` marks **owed**. §6.7 is this document's share of the question that remains open,
  which is whose assertions win — _what_ custody is is no longer open `[SD §4.8]`.

### 8.9 A partial load under one bill of lading

**Expressed, and the four-way conflict the critique found is closed.**

- **One shipment**, one transport contract — B-DOC is not even engaged, because no second
  contract exists.
- The part that moved is a **Portion** `[SD §3]`. Revision 1 and `A3` expressed the identical
  physical fact two different ways (a `Portion` here, a `quantity` on a `StopAction` there) with
  no cross-reference; `[SD §3.3]` **deletes `quantity`** — "a quantity floating on an act is a
  measure with no identity, so a second act cannot say 'the same part'" — and makes the Portion
  the single grain.
- Membership may be `MEASURED` at load time and become `ENUMERATED` later under **P-MEMBER**,
  keeping one `portionId` — this fork's contribution (§5.1), sourced on both sides
  (`src:sirva-ade`'s `Overflow` event carries `Weight` **and nothing else**, SOE p.19;
  `src:dp3-400ng` Item 17.13 identifies a partial SIT withdrawal by **inventory item numbers**
  _and_ requires the "actual weight of the portion withdrawn" — the same tariff rule states both
  forms).
- Overlap is permitted (**P-OVERLAP**), so "the twelve items that went into SIT" and "the three
  of those refused on delivery-out" are both Portions, the second nested in the first.
- `src:dp3-400ng` Item 17.9 rates split-shipment portions separately but applies the 1,000-lb
  minimum to the **combined** weight — a published charging rule that needs exactly this shape:
  identified subsets that do not fragment the priced whole.

### 8.10 Summary

| #   | Scenario                                            | Status                                                                                  | Owned by                                                                        |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Five families, one van, four days                   | Expressed                                                                               | Fork 3 (trip); nothing here changes                                             |
| 2   | SIT, delivered six weeks later by a different agent | Expressed; **identity across a terminated stay deferred by name**                       | Here (Portion adoption, stay id) + `[SD §3, §8]`; deferral `[SD §10.4]` → A2/A5 |
| 3   | Delivery twice: absent, refused-damage, two short   | Expressed                                                                               | `[SD §2, §3]`                                                                   |
| 4   | Reweigh in transit                                  | Expressed                                                                               | `[SD §4.4, §7.5]`                                                               |
| 5   | Car on a separate carrier a week apart              | Expressed **only with** `[SD §8]`                                                       | Here (A-AWARD) + `[SD §8]`                                                      |
| 6   | Cancelled after packing, materials charged          | Expressed                                                                               | Here (§3.2.3, §5.2) + `[SD §8.4, §2]`                                           |
| 7   | Same arrival, two asserters                         | Expressed                                                                               | `[SD §4]`                                                                       |
| 8   | Mid-journey custody handoff                         | **Expressible — dwell classification deferred to A5, custody authority deferred to A8** | `[SD §8]`, `[SD §10.5]`; deferrals named at §8.8                                |
| 9   | Partial load, one BOL                               | Expressed                                                                               | `[SD §3]` + P-MEMBER from here                                                  |

## 9. Changed in revision

| #   | What moved                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **B-DOC marked [ORIGINAL]** (§3.2.2); added to §7's unsupported list; confidence **high → medium**. Revision 1's "the test comes from `src:dtr-part-iv` rather than from us" is withdrawn.                                                                                                                                                                            | Critique: DTR states two _named DoD operations_; the universal rule is this document's generalisation, applied to a commercial auto carrier, to storage conversion, and to a lane with no BOL at all. `[SD §10.2 item 5]`. |
| 2   | **Diversion/reshipment confidence high → medium-high**, with DTR's destination-SIT exclusion stated in the body (§3.2.1) and corroborated from `src:dp3-400ng` Item 28.4.d.                                                                                                                                                                                           | Critique: the clean half of the test is expressly inapplicable to the case the acceptance test turns on. `[SD §10.2 item 6]`.                                                                                              |
| 3   | **§3.2.3 — the two-stage boundary** (`committed` by an act, `evidenced` by a document) replaces the single contract-rooted test. New sourced positions **P1b** (MilMove shipment lifecycle to `CANCELED`), **P3b** (SIRVA `Register`/`CANCELLED`, no BOL in the contract) and **P8b** (CFR's pre-BOL estimate, inventory and accessorial determination) added to §2a. | Critique: a move cancelled before loading has no BOL, so a contract-rooted definition cannot name the packed lot.                                                                                                          |
| 4   | **§5.2 rewritten** — `provisional → confirmed` replaced by rule **B-STAGE** with a third, normal terminus `closed_uncontested`; charge anchoring spelled out via `[SD §8.4]`.                                                                                                                                                                                         | Critique: "nothing states what a shipment boundary that never acquires its defining document _is_." `[SD §10.2 item 9]`.                                                                                                   |
| 5   | **§5.1 gutted and redirected** to `00-shared-decisions.md` §3. The Portion is no longer defined here; P-IDENTITY resolves the §3.2/§5.1 contradiction in favour of §3.2; the diagram at §3.1 is corrected.                                                                                                                                                            | Critique: internal contradiction on the SIT remainder; the grain was "too heavy for two items and too light for a claim." `[SD §10.2 item 4]`.                                                                             |
| 6   | **§3.3 replaced by a conformance table** pointing at `00-shared-decisions.md` §7: effective interval, vocabulary scope, all aggregate grains, `primary` **derived** not stored. Revision 1's shape is withdrawn.                                                                                                                                                      | Critique + conflict #5: no validity interval, no vocabulary scope, two grains where five are used, and mutable state colliding with the append-only discipline. `[SD §10.2 item 2]`.                                       |
| 7   | **§3.3.1 — the "independently confirms" claim withdrawn**, replaced by a narrower argument (a `Required` per-element key ≠ a layout choice), scored **medium**, with Weichert's opposite Auto/Pet choice recorded at the point of use. A partial disagreement with the critique is stated and argued.                                                                 | Critique: it reads document layout as ontology and needs an uncited criterion to overrule its own source. `[SD §10.2 item 7]`.                                                                                             |
| 8   | **§3.5(b)'s `-N` suffix argument withdrawn** and re-framed: Weichert is evidence _for_ the relocation level; what is missing is a lifecycle; the decision now rests openly on the [ORIGINAL] asymmetry criterion.                                                                                                                                                     | Critique: the Weichert analysis records the suffix as its own open question 8. `[SD §10.2 item 8]`.                                                                                                                        |
| 9   | **Foreclosure #3 withdrawn** (§3.3.2, §4): DTR publishes the SIT control number (9 digits, one per split increment).                                                                                                                                                                                                                                                  | `[SD §7.4, §10.2 item 3]`.                                                                                                                                                                                                 |
| 10  | **§5.4 correlation state de-mutabilised** — a canonical match is a `DERIVED_BY_RULE` Assertion, an echo is a second party's assertion, a dispute is resolved by `FactResolved`.                                                                                                                                                                                       | Conflict #5; `[SD §7.5]`.                                                                                                                                                                                                  |
| 11  | **§2d added — Atlas blanket re-citation.** P4 is re-cited as structural evidence only; A9 C2 = 1 recorded; no `/Types` remedy proposed anywhere (revision 1 proposed none, and revision 2 adds none).                                                                                                                                                                 | Critique must-fix #12; `[SD §9]`.                                                                                                                                                                                          |
| 12  | **§3.1 updated** — the order's lifecycle is carried by `subject = order:…`; the shipment has no mutable state field; §3.6's P6 rejection re-phrased so it no longer reads as licensing one.                                                                                                                                                                           | `[SD §1, §10.2 item 1]`.                                                                                                                                                                                                   |
| 13  | **Foreclosure #7 added** and §3.2.4 row 4 rewritten: shipment identity across a **terminated** SIT stay is **not claimed in either direction** and is deferred to A2/A5.                                                                                                                                                                                              | Conflict #4; `[SD §10.4]`. Revision 1 implied an answer via B-DOC and scored it.                                                                                                                                           |
| 14  | **§6.7 added** — whose commitment mints the boundary when two parties commit differently (an A8 authority question).                                                                                                                                                                                                                                                  | Falls out of §3.2.3 stage 1, which the critique's cancelled-move scenario forced into existence.                                                                                                                           |
| 15  | **§8 added** — the nine scenarios run explicitly, each naming which document owns the mechanism, with §8.8 recording a residual gap rather than claiming a pass.                                                                                                                                                                                                      | Task requirement; and the critique's finding that the acceptance test was discharged by two documents pointing at each other.                                                                                              |
| 16  | **§7's unsupported list extended from 6 items to 7**, now covering B-DOC, B-STAGE and the narrow grain argument, plus a pointer list of assertions inherited from the shared layer.                                                                                                                                                                                   | Critique: "§7 lists the asymmetry criterion and the order/shipment-type criterion but **not** this generalisation, and then scores the test high."                                                                         |
| 17  | **Disclosure front-matter added**; §2c's reconciliation re-marked [ORIGINAL] at each authored step rather than only in §7.                                                                                                                                                                                                                                            | Disclosure rule; `[SD §0]`.                                                                                                                                                                                                |

**Revision 3** — shared-layer coherence fixes, none of which changes a decision here:

| #   | What moved                                                                                                                                                                                                                                                                                    | Why                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 18  | **`factClass` → `type` throughout**; the fact key is the derived tuple `(subject, type, qualifier?)`, and `scheme` + `vocabularyScope` sit in `identity`'s declared `qualifier`.                                                                                                              | One classification axis, not two. `[SD §1.3]`. |
| 19  | **I-KEY adopted** (§3.3, item 3): arity **and** `primary` both key on `(subject, scheme, vocabularyScope)`. Revision 2 had arity on the scoped tuple and `primary` on the unscoped one, which forced this document's own two-van-line example into a contest between two correct identifiers. | `[SD §7.1]`.                                   |
| 20  | **`vocabularyScope.issuer` → `vocabularyScope.authority`** (§3.3), leaving one `issuer`: the party that assigned the id. Revision 2 carried the name twice with no stated difference.                                                                                                         | `[SD §7.1]`.                                   |
| 21  | **R-WEIGHT-LOWER re-cited per pairing** (§8.4): Item 4.11.d governs this scenario's original-vs-reweigh case; Item 4 Note 2 is the duplicate-reweigh rule; the one-rule generalisation is marked [ORIGINAL].                                                                                  | `[SD §4.4]`.                                   |
| 22  | **Item 28.3 withdrawn** as a premise for the pack-only-day Trip (§8.6); `src:open-trip-model` carries it alone.                                                                                                                                                                               | `[SD §8.4]`.                                   |
| 23  | **Scenario 8's label aligned** (§8.8, §8.10) with A3 and `fork-time`: _Expressible — dwell classification deferred to A5, custody authority deferred to A8_. Three wordings for one finding.                                                                                                  | `[SD §10.5]`.                                  |

**Revision 4** — conformance to the binding layer. Both items are mechanical; no conclusion here moves:

| #   | What moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Why                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 24  | **§8.7: E-CANON is reject, not re-key.** Revision 3 said the destination agent's shipment-level claim "**resolves to that stop** (shipment in `context[]`), or, where no stop of ours exists, to an `ExternallyPerformedLeg`" — the boundary-re-keying reading `[SD §4.6]` abolished, in the same words A3 §3.2 and `fork-time` §8.7 carried. Now stated in three parts: **E-CANON-STRICT** refuses the record as phrased (no `eventId`, no fact key, no contest, no substitution); **E-CANON-RESOLVE** puts the re-phrasing **ingest-side**, in a published, versioned subject-resolution rule that must return **exactly one** candidate, keeping the agent's `assertedBy`/`assertedAt`, the subject they named in `context[]` and their message in `evidence[]`; **E-CANON-OBLIGATION** retains a failed submission with its candidate set and emits an obligation. The `ExternallyPerformedLeg` half is unchanged in substance — a second member of the same family is a **candidate**, never a fallback the boundary picks. | `[SD §4.6]`, `[SD §10.2 item 15]`.               |
| 25  | **§8.8's two stale references refreshed.** (a) "which all three documents defer to **A8, which does not exist**" — [`A8-authority-skeleton.md`](A8-authority-skeleton.md) now exists, supplying A8-MOVE, A8-INSTANT and an eleven-class role table; the quoted `[SD §10.4]` bar ("no document may score a dependent decision high until A8 is written") is replaced by what §10.4 now says: **the cap has moved rather than lifted** — medium is now available, high is still barred, and a fact class `[SD §4.7]` marks **owed** gains nothing at all. (b) The `custodyBasis` is read by the fold **`custodyAt(goods, instant)`**, not by a stored `Custody` interval, which `[SD §4.8]` abolished; this scenario's leg is one of the fold's two inputs and the scenario is otherwise unaffected.                                                                                                                                                                                                                               | `[SD §4.8]`, `[SD §10.2 item 17]`, `[SD §10.4]`. |

**Revision 5** — conformance to the binding layer. Both items are mechanical; no conclusion, no
confidence rating and no open question here moves:

| #   | What moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 26  | **§3.2.2's custody concession repointed at `[SD §4.8]`.** The critique's point — "two documents asserted opposite answers and **neither owned the `Custody` interval**" — is still accepted as to the first half, and is now _answered_ as to the second: **nobody owns an interval, because there is no interval.** There are `handover` assertions and the fold **`custodyAt(goods, instant)`** over them plus `ExternallyPerformedLeg.custodyBasis`. The ownership question dissolves rather than being assigned — a fold has inputs and a rule id, not an owner — and what remains open is **custody _authority_**, which is A8's and is capped at medium (§8.8, §6.7). Revision 4 item 25(b) had already applied this at §8.8; §3.2.2 was the place it was missed. | `[SD §4.8]`, `[SD §10.2 item 17]` (first half). |
| 27  | **§3.2.4's acceptance-table phrasing corrected.** The terminated-SIT row said "the SIT control number **and the custody interval** have an owner regardless" — wording inherited from the earlier `[SD §10.4]` sentence, which named an entity `[SD §4.8]` abolished. It now says the **SIT control number** has an owner and that who held the goods needs none, being the fold. `[SD §10.4]` itself is corrected in the same revision, so the two no longer diverge. The row's verdict — **NOT SETTLED HERE**, deferred to A2/A5 — is untouched.                                                                                                                                                                                                                      | `[SD §10.4]`, `[SD §4.8]`.                      |

**Conformed to binding layer rev 5** (`00-shared-decisions.md`, revision 5) — items 26-27 above are
the part of that claim this revision supplies.
