# A2 — Shipment structure

Cited elsewhere as **[A2 §x]**.

> **Status.** A decision document and the area comparison for A2. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope.** A2 owns the **shipment**: what one is, when a second one exists, what may be said about
> its kind, and how its identity behaves when the movement is interrupted. It is **not** the
> order-to-shipment cardinality, which [`fork-order-shipment-cardinality.md`](fork-order-shipment-cardinality.md)
> decided and this document inherits rather than reopens; it is **not** the sub-shipment grain, which
> is [SD §3]'s Portion; it is **not** the journey, which is A3's; and it is **not** the price of
> anything, which is A7's.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged, plus one this area needs stated.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is. A2's
   trap is the widest in the corpus, because A2 is the area our own systems have the most to say
   about: `src:pegii-longhaul` publishes move types, haul modes and four typed weight slots;
   `src:pegasus-integration-floors` publishes an order-to-`shipments[]` containment. Both are ours.
   Neither is in §2, and the absence is deliberate.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** §6 carries what A2 does not settle and names who owes it.
4. **The undertaking is the thing, and the document is evidence of it.** A2's hardest question and
   its largest refusal both turn on one distinction: a shipment is constituted by a **commitment to
   move**, and the transport contract is the **record** a commitment leaves behind in the lanes that
   issue one. Where a source reasons from the document, §3 says which half it is being cited for.

---

## 1. The question, stated sharply

Five things are owed to this area by name. Every one is a sentence in a binding document, a
hand-off from a landed area, or the rubric's own row, that says A2 decides it.

| #   | Owed item                                                                                                                                                             | Owed by                                                                                   | Settled at |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| 1   | **Shipment identity across a terminated SIT stay and reshipment.** _"What A2 still owns is the **shipment** boundary"_                                                | [SD §10.4] bullet 1; [`fork-order` §4] #7, §6.7, §7; [A5 §Cross-area]; [A3 §3.2], [A3 §7] | §3.2       |
| 2   | **What a shipment's _kind_ is.** [`fork-order` §3.1] promises the shipment _"a type from a closed enum (P1)"_ and never publishes one                                 | [`fork-order` §3.1]; [`../rubric.md`](../rubric.md), the A2 row                           | §3.3       |
| 3   | **The zero-shipment order.** A1's `COMPLETE` fork _"needs a settled reading of the **zero-shipment** order"_                                                          | [A1 §Cross-area], [A1 §3.4], [A1 §6]; [`fork-order` §5.3]                                 | §3.4       |
| 4   | **Whether the Portion survives contact with A2.** _"If A2 finds a published HHG model that keeps enumerated and measured subsets as **different** entities, revisit"_ | [SD §11], the §3 Portion row                                                              | §3.5       |
| 5   | **Shipment vs order, shipment types, weights, services ordered** — record types, projections, or somebody else's                                                      | [`../rubric.md`](../rubric.md), the A2 row                                                | §3.6       |

### A2 is the first area with no owed value in the code at all

Every area written so far had at least one marker in `packages/domain-reference/src/` naming it:
A4 had the reason vocabulary typed as `OwedCode`, A5 had a `Remedy` branch constructed by
`owed(…, 'A5')`, A1 had the stage it went on to publish. A search of `src/`, `data/`, `tools/` and
`tests/` for A2 returns **two prose comments and nothing typed** — a parenthetical in
`portion.ts`'s `PortionCommon.shipment` JSDoc, and one test in
`tests/scenarios/storage-in-transit-delivered-by-another-agent.test.ts` whose title says A2 owns the
other half.

That is not an accident and it is the first finding of this document. **Everything the model owes A2
is documentary, because the shipment has almost nothing in the code to owe it with** — see the
structural fact below, which is what §3.2 and §3.3 both run into.

### What is already fixed above A2, and is quoted rather than re-derived

A2 inherits a **conformed** binding document, not a backlog — see the second finding below — and a
shared layer that has already spent most of A2's vocabulary.

- **Cardinality is decided.** One order carries one-or-more shipments; a shipment belongs to exactly
  one order; N may be 0 ([`fork-order` §3.1], scored **high**). A2 does not reopen it.
- **The definition is decided.** _"A shipment is the set of goods committed to move under one
  transport undertaking"_ ([`fork-order` §3.1], scored **medium-high**). §3.2 does not replace this
  sentence; it reads the word `undertaking` and finds that the sentence already answers owed item 1.
- **The boundary has two stages.** `committed` by an act, `evidenced` by a document, with
  `closed_uncontested` as a normal terminus — rule **B-STAGE**, [`fork-order` §3.2.3] and §5.2, both
  **[ORIGINAL]**.
- **The sub-shipment grain is decided and is not A2's to redefine.** [SD §3]'s **Portion**, with
  **P-IDENTITY** (_"minting a Portion is not splitting a shipment"_), **P-MEMBER**, **P-CLAIM** and
  **P-OVERLAP**.
- **Consolidation is the trip's**, not this boundary's ([`fork-order` §3.6] P11, [A3]).
- **Identity is [SD §7]'s**, with **I-KEY** over `(subject, scheme, vocabularyScope)`; A2 mints no
  identifier and no scheme.
- **The shipment is a subject kind** ([SD §1.2]) and a member of the `goods` family
  ([SD §4.7.1]) — which is the whole of what the record vocabulary says about it.
- **Three weight types already exist** — `weight.net`, `weight.gross`, `weight.tare` — all family
  `goods`, with `R-WEIGHT-LOWER` as the one published value rule ([SD §4.4]) and `pieceCount`
  carrying a `{unitization}` qualifier beside them ([SD §4.7.2a]).
- **A5 has answered the stay half of owed item 1**: termination leaves the stay's identity untouched,
  and _"the stay is not the thing that answers"_ the shipment's question ([A5 §3.4]).

### The structural fact this document keeps running into

> **The `shipment` aggregate has no record of its own coming into existence.**

[SD §4.7.1]'s act rows divide the way that section's own closing row divides them: some are performed
**on the goods** (`packing`, `loading`, `unloading`, `delivery`, `handover`, and `storeIn`/`storeOut`
on the stay beside them) and the rest on the **plan**, on a **binding** or on the **commitment**
(`tripDelay`…, `membershipOffer`…, `assignmentOffer`…, `orderAward`…). _(The counts are deliberately
not restated — [`A1` §9]'s rule, and `ACT_TYPES` is where they live.)_ Every goods-side row
presupposes a shipment that already exists. **Nothing mints one.** [`fork-order` §3.2.3]'s stage 1 — _"a shipment comes into
existence when a party commits goods to a named movement: the van line's `Register`, the RMC's award
of a service order, the mover's shipment submission"_ — names three real, grade-A acts, and none of
them has a `type`.

The consequence is exact and it shapes §3: **B-STAGE is a projection with no input records.** A
consumer cannot compute a shipment's boundary stage, because no assertion says the boundary was
committed. §3.2 answers owed item 1 in prose and can only report `undetermined` in code for the same
reason; §3.3 finds the same hole under the shipment's kind. §3.6 records it as absent and owed.

### Why getting this wrong is expensive

The two candidate errors are not symmetric.

- **Deciding identity by the document** is the cheap answer and it is already in the corpus twice
  over — `src:dtr-part-iv` gives a new bill of lading to the one case where the shipment genuinely
  changes, and [`fork-order` §3.2.2]'s **B-DOC** generalises it. It is cheap because a document is
  observable and a commitment is not. It is wrong in the lanes that issue no transport document at
  all, which [`fork-order` §3.2.3] already established are normal rather than exotic: the RMC lane
  has _"no BOL, PRO, SCAC or registration number"_, and a move cancelled before loading never gets
  one (`src:cfr-49-375` §375.505(c) dates the bill of lading to departure). A model that decides
  identity on a document silently has no answer for either.
- **Publishing a single closed shipment-type enum** is the other cheap answer, it is what
  [`fork-order` §3.1] promised, and §3.3 refuses it. The cost of refusing is an honest gap the
  glossary carries. The cost of publishing is a vocabulary that is a rating key wearing an ontology's
  clothes, which is what every published one in the corpus is — and [catalog §2.3] makes renaming a
  published member a **breaking change**, so the bill for getting it wrong arrives as a major version
  rather than as a patch.

### The second finding: [SD §10.2]'s backlog is already discharged

`plans/in-progress/domain-reference-areas-a2.md` §6 item 4 records
[`fork-order-shipment-cardinality.md`](fork-order-shipment-cardinality.md) as _"A2's inheritance,
and [SD §10.2] lists seventeen things it must change… the largest single backlog attached to any
unwritten area."_ **It is not a backlog. Every one of the seventeen is applied**, and each names the
item it answers:

| [SD §10.2] | Applied at [`fork-order` §9]                           | [SD §10.2] | Applied at [`fork-order` §9]         |
| ---------- | ------------------------------------------------------ | ---------- | ------------------------------------ |
| 1          | item 12 — envelope; the order's lifecycle on `subject` | 10         | item 18 — one axis, `type`           |
| 2          | item 6 — `Identifier` replaced by a conformance table  | 11         | item 19 — I-KEY                      |
| 3          | item 9 — foreclosure #3 withdrawn                      | 12         | item 20 — `authority` vs `issuer`    |
| 4          | item 5 — the Portion redirected to [SD §3]             | 13         | item 22 — Item 28.3 withdrawn        |
| 5          | item 1 — B-DOC marked [ORIGINAL], confidence lowered   | 14         | item 23 — the scenario-8 label       |
| 6          | item 2 — diversion/reshipment lowered                  | 15         | item 24 — E-CANON is reject          |
| 7          | item 7 — the grain argument softened                   | 16         | item 18 — the prose type names       |
| 8          | item 8 — the `-N` suffix argument withdrawn            | 17         | items 25(b), 26, 27 — the projection |
| 9          | item 4 — B-STAGE                                       |            |                                      |

What A2 inherits is therefore not repair work but **four open questions** the conformance left
standing: foreclosure #7 (owed item 1), §3.1's unpublished type enum (owed item 2), §5.3's
zero-shipment order (owed item 3), and §6's seven user questions. Two housekeeping defects come with
them and are fixed as revision 6 (§Cross-area): the frontmatter still reads `revision: 2` and
`revised: 2026-09-18` over a body carrying revisions 3, 4 and 5, and the revision-2 note still says
[SD §10.2] required _"nine"_ changes when it requires seventeen.

---

## 2. The positions in the external corpus

Every external source was scored for A2 in its own analysis; the scores quoted below are that
row's, in rubric order `C1/C2/C3/C4/C5/C6/C7/C8`. A2 is the widest-covered area in the corpus —
which is a problem rather than a luxury, and §2.12 says why.

### 2.1 "The shipment is typed by a closed enum, with a child table per type" — `src:milmove-mymove` (grade A, `3/3/3/3/2/3/2/3`)

The highest A2 score in the corpus, and the only source scoring 3 on C1, C2, C3, C4, C6 and C8 at
once. `MTOShipmentType` is a closed enum of nine: `HHG`, `HHG_INTO_NTS_DOMESTIC` (displayed "NTS"),
`HHG_OUTOF_NTS_DOMESTIC` ("NTS Release"), `INTERNATIONAL_HHG`, `INTERNATIONAL_UB`, `PPM`,
`BOAT_HAUL_AWAY`, `BOAT_TOW_AWAY`, `MOBILE_HOME`. Each variant type gets a **child table** —
`ppm_shipment`, `boat_shipment`, `mobile_home` — under ADR 0067, chosen over widening the parent
because _"the `mto_shipments` table has a growing number of fields and it's hard to know which fields
are applicable for a given shipment type"_, with the risk recorded in the same ADR.

Five weight concepts, not one: `primeEstimatedWeight` (with `primeEstimatedWeightRecordedDate` — an
estimate carrying the instant it was made), `primeActualWeight`, `ntsRecordedWeight`,
`billableWeightCap` with a **justification** field beside it, and `calculatedBillableWeight`. The
shipment has its own lifecycle, `DRAFT → SUBMITTED → APPROVED`, terminal at `CANCELED`, with a
two-actor protocol and a rejection invariant.

**What A2 takes:** the observation that the type axis needs an extension point, and the
`billableWeightCap`-plus-justification shape, which is the corpus's one published case of a weight
that is neither estimated nor actual but **decided**. **What A2 does not take:** the enum, §3.3.

### 2.2 "The shipment's kind is a code that fixes mode, containerisation and rate family" — `src:dtr-part-iv` (grade A, `2/2/1/3/n/a/2/1`)

Low on C1 and C2 for this area and decisive anyway, because it is the only source in the corpus that
states what happens to a shipment's identity when its movement is interrupted, and it states it three
times over. The **Code of Service** (Table A-402-3) is its type axis: `D` loose domestic, `2`
containerised domestic, `4`/`5`/`6`/`T` international household goods, `7`/`8`/`J` unaccompanied
baggage, `S` mobile home, two-letter `B*`/`H*` codes for the Direct Procurement Method. The
analysis's own gloss is the sentence §3.3 turns on: a code that _"fixes mode, containerization and
rate family"_.

The **bill of lading** is defined — _"a contract between the shipper and the TSP whereby the TSP
agrees to furnish transportation services subject to the conditions printed on the bill of lading"_
(`dtr_definitions.pdf` #81). It is a contract, not an order: DPS offers and the TSP has 24 hours to
accept (§C.4), and _"the BL cannot be printed until pre-move survey weight and agreed pack/pickup
dates are in DPS"_ (§F.1 NOTE). **Award, survey and document are three separate events in that
order.**

And the trichotomy the analysis calls _"worth adopting wholesale"_ (A-402 §E; #255, #596, #702):
**diversion** keeps the shipment's identity and its bill of lading, changing only the destination;
**termination** stops onward movement at a designated point; **reshipment** is a terminated shipment
moving onward **on a new bill of lading** (§E.4(4)(c)). A **split shipment** is _"a shipment separated
at a transshipment point into increments, each identified and documented separately"_ — each getting
its own weight ticket and its own SIT control number (#662; A-402 §D.5.b(4)). A **consolidated
shipment** is several customers' lots offered to one carrier for one movement, and _"a separate BL
will be issued for each customer's lot"_, cross-referenced in block 27.

### 2.3 "A split shipment is one shipment, and the tariff rates it as one" — `src:dp3-400ng` (grade A, `2/3/1/3/n/a/2/2/1`)

The definition A5 handed forward, and it is a shipment-structure definition sitting in a storage
tariff: a **Split Shipment** is _"a shipment where only a portion is stored in transit enroute, or
where overflow property is delivered to the storage location on different dates"_ (Item 17.9). The
grammatical subject is singular and stays singular through the rating rules: storage is rated
separately per portion and each segment is rated at the rates in effect on **its own** placement date
(Item 17.17), but the **1,000-lb minimum applies to the combined weight** of the separately-rated
portions (Item 17.9.b.2).

Codes of service `D`/`2`/`B`/`H`/`S` are a second type taxonomy at grade A, and the phrase _"shipment
or portion thereof"_ runs through the whole tariff. Net weight carries a 1,000-lb minimum (Items 25,
56.3); sub-weights are annotated separately for professional books, papers and equipment on the bill
of lading and for gun safes on the inventory (Item 4.9.h-i); container net weight is its own rule
(Item 4.9.e). **NTS and NTSR are a separate programme** whose delivery makes the facility the final
destination, with further movement _"under separate BL/invoice"_ (Item 27.3).

### 2.4 "The haul is decomposed into addressable segments, and the identifier encodes them" — `src:sirva-ade` (grade A, `3/3/2/3/1/3/1/1`)

The corpus's only published decomposition of a shipment's _execution_ into named parts:
`HaulingSegmentType` ∈ `MainLoad` | `Overflow` | `MassMove` | `Transfer`, each with its own sequence
number (GSD pp. 3, 5). `Overflow` is defined — _"the driver did not have sufficient space for the
entire shipment to be loaded on the trailer, so another driver, tractor and trailer need to address
transportation of the remaining items"_ (SOE p.19) — and carries `Weight` and nothing else.
`Transfer` is _"the shipment has been transferred to another vehicle prior to delivery"_ (SOE p.24).

`CamisRegNumber` is 12 digits: _"the first 6 positions is the shipment number, next 2 positions
reflect the OverFlow Sequence Number, last 2 positions reflect Transfer sequence number"_ (SOE p.2),
with `00` meaning the main load. Five weight and cube variants with a stated derivation rule for
`Weight` (GSD p.7). Shipment type is `Household` vs `OfficeIndustrial`; **shipper type** is
`PrivateTransferee` | `NationalAccount` | `Government` | `Military` (GSD p.24).

**This is the source that most nearly refutes §3.5, and does not** — see there. Its segments are
execution facts with weights, not membership entities.

### 2.5 "Loose load, containerised and unaccompanied baggage are operationally different shapes" — `src:dp3-tender-of-service` (grade A, `2/2/1/3/n/a/2/2/1`)

C4 of 3 on a source whose C1 is 2, which is the shape of a good HHG contribution. Loose load vs
containerised vs unaccompanied baggage are distinguished by having **different arrival procedures** —
a type distinction earning its keep operationally rather than taxonomically. Overflow and split carry
_"the established RDD applies to all parts"_ and a separate inventory. `CW` annotates partial
containerisation; door-to-door container service is its own shape; the NTS **lot** is a different
unit. Sub-quantities — M-PRO/S-PRO, consumables, gun safe — are each separately weighed and
annotated. **Still no part-whole composition model**, which is the same negative every HHG source in
this section returns.

### 2.6 "Shipments sit under an order, and Auto is an order type rather than a shipment type" — `src:weichert-supplier-api` (grade B, `2/2/1/3/n/a/2/0/1`)

The live RMC contract, and the source [`fork-order` §3.3.1] reads two ways at once. `shipments[]`
sits under a service order, each element carrying a **`Required`** `supplierShipmentId` — the
supplier's own id _"from their proprietary system"_ (odt:378, odt:1411) — while `serviceOrderNumber`
keys the enclosing record (odt:72). `shipmentType` is `Air` | `Land` | `Sea` | `LTS`; `routingType`
carries `Vanline` and `RO-RO` among others; net and gross are crossed with weight and volume; `ACW`,
`CWT` and a `containerType` including liftvan sizes are present and **no term is defined** — the
analysis records `ACW`, `DTD`, `LDN` and `CWT` as never expanded.

**Auto and Pet are separate _order types_, not shipment types**, which the analysis flags as _"a
modeling choice worth noting"_ and which [`fork-order` §3.5(a)]'s **A-AWARD** overrules with an
authored criterion. A2 does not reopen that; §3.3 notes only that `LTS` sitting inside `shipmentType`
is the same category error in the other direction, and one A5 has already ruled on.

### 2.7 "Shipment, Consignment, Consignment Item and Trade Item, each with numbered business rules" — `src:uncefact-mmt-rdm` and `src:uncefact-scrdm` (grade A, `3/3/1/0/1/3/1/3` and `3/3/2/0/2/3/2/3`)

The corpus's two formal reference models, and its highest C2 scores outside MilMove. MMT defines
Shipment / Consignment / Consignment Item / Trade Item with explicit numbered business rules (BRS
pp.14-16) and publishes the measure family — `GrossWeightMeasure`, `NetWeightMeasure`,
`ChargeableWeightMeasure`, `GrossVolumeMeasure`, `LoadingLengthMeasure` — plus `TransportService`
with category, requirement and condition codes, which is a **services-ordered** concept at grade A.
SCRDM adds the header / line / subordinate-line decomposition and an unusually rich quantity
vocabulary: `Requested`, `Agreed`, `Despatched`, `Remaining_Requested`, plus `Partial Delivery
Allowed`, `Over Delivery Allowed`, `Fully Delivered` and `Quantity Calculation Method. Code`.

**Both score C4 = 0**, and the contradiction between them over what a Consignment is was reconciled
at [`fork-order` §2c]. A2 cites them for the `ChargeableWeightMeasure` idea (§3.6) and for nothing
about household goods.

### 2.8 "The structure declares whether its own containment is known" — `src:nmfta-ebol` (grade A, `2/3/n/a/1/n/a/1/1/1`)

One idea, and [SD §3] already has it: `lineItemLayout` ∈ `Nested` | `Stacked`, where Nested means the
containment _"is known"_ and Stacked means it _"is not known"_ (`:361`). The C2 of 3 is earned on that
alone. Handling unit, line item and shipment totals sit at three grains each with its own unit;
`tareWeight` is defined against gross and net (`:566`–`:580`); `linearLength`, `cube`, `stackable`
and `palletized` are present; and `accessorials.codes[]` is literally _"the list of services requested
for the shipment"_ (`:636`) — the corpus's plainest statement that services-ordered is a shipment-level
concept, and one §3.6 has to set against a binding document that puts it on the order.

### 2.9 "Weight is qualified by how it was obtained, and reweigh is one of the qualifiers" — `src:x12-212-trailer-manifest` (grade A/B, `2/2/n/a/1/n/a/3/1/2`)

Element 187 types weights `G` Gross, `N` Actual Net, `T` Tare, `E` Estimated Net, `B` Billed and
`RG`/`RN`/`RT` Reweigh Gross/Net/Tare — **reweigh as a weight type rather than as an event**. `AT8-04`
non-unitised versus `AT8-05` unitised handling units are two separate counts summing to one total,
which [SD §4.7.2a] has already spent as `pieceCount`'s `{unitization}` qualifier. Element 88 qualifies
whose mark each identifier is, including `S Entire Shipment`.

### 2.10 "The kind of movement is a named consolidation mode" — `src:x12-858-implementation-guide` (grade B, `1/2/n/a/0/n/a/2/1/1`)

Thin, with one contribution: `BX02` **defines** multi-origin, multi-destination, single-trailer and
single-freight-bill combinations as named modes (p.8). It is the corpus's only attempt to type a
movement by its _structure_ rather than by its commodity or its mode of transport, and §3.3 records
it as a sixth incompatible facet rather than as a candidate.

### 2.11 "Storage is a job type, and the shipment is not an entity" — `src:smartmoving-api` (grade A on vocabulary, `2/2/1/3/1/1/2/3`)

The residential mover's own service list, and the clearest case of the category confusion §3.3
describes. `JobType` ∈ `Moving`, `Packing`, `LoadOnly`, `UnloadOnly`, `InnerHouse`,
`StorageInBound`/`StorageOutBound`, `JunkRemoval`, `LaborOnly`; `OpportunityType` ∈ `Local` |
`Intrastate` | `Interstate`. `VolumeWeightCalculationMode` ∈ `MoveSize` | `Inventory` | `Manual` is a
genuinely good idea that no other source has — the model states **how** the shipment quantity was
derived, with `densityFactor` recording how volume became weight. And **there is no shipment entity
at all**: no shipment id, no services-ordered list, and storage is a _job type_.

### 2.12 The sources that have plenty, and why their plenty proves the point

`src:atlas-world-group-api` scores `C1 = 3` and `C2 = 1` — four overlapping type axes
(`shipment_type`, `move_Type`, `logistics_Mode`, `orderKind`, `haulMode`, `householdGoodsType`,
`freight_class`, `containerized_Shipment`), seven weight fields, and **no definitions and no code
lists** for any of them; it is blocked at [SD §9] and is cited here as column-name evidence only.
`src:dcsa`, `src:open-trip-model`, `src:project44`, `src:shippeo`, `src:samsara`,
`src:omnitracs-roadnet`, `src:gs1-epcis-cbv`, `src:macropoint` and `src:gtfs` all score `C4 ∈ {0, 1}`.
`src:uncefact-rec24` expresses partiality as a status (88 `Split_consignment`, 15 `Consolidated`, 302
`Overcarried_consignment`) with no shipment entity behind it. `src:cfr-49-375` scores `C4 = 3` and has
**no shipment-type taxonomy at all** — no vehicle shipment, no self-move, no storage-only — while
binding the weight-ticket evidence chain at `C7 = 3`.

**The pattern is A2's central empirical finding.** Round 1 recorded A2 as _"well-covered"_, and by
count it is: more sources say something about shipment structure than about any other v1 area. But
the coverage does not converge. **Six sources publish a shipment-type enum and no two of them
decompose into the same facets** (§3.3's table), while **no source in the corpus publishes a
part-whole composition model for a shipment** — `src:dtr-part-iv`'s own analysis says a shipment _"has
no parts other than its inventory items and its weight"_, and `src:dp3-tender-of-service`'s says
_"still no part-whole composition model"_. A2 is over-covered where it needs agreement and uncovered
where it needs structure.

---

## 3. The decision

### 3.1 The shape, in one picture

```
Order  1 ── N  Shipment                       ← [fork-order §3.1]. NOT reopened.
                 · the set of goods committed to move under ONE transport
                   undertaking.  The undertaking is the thing; the transport
                   contract is the record it leaves where a lane issues one.
                 · minted by a commitment act that HAS NO RECORD TYPE   §3.6
                 · kind: NOT PUBLISHED. `shipmentType` is absent and owed §3.3
                 · identity across an interruption: rule B-ONWARD       §3.2
                 · weights: `weight.net` | `weight.gross` | `weight.tare`,
                   already published, [SD §4.7.1]. `cube` remains absent.
                 · services ordered: on the ORDER, [fork-order §3.1]     §3.6
                       │
                       └── Portion[]   [SD §3]. Unchanged by A2 — §3.5 is the
                                       check [SD §11] asked for, and it passes.
```

Four decisions, one check, and one triage. None of them mints a record type.

### 3.2 Identity across a terminated stay and reshipment — owed item 1

> **Decision — rule B-ONWARD. [SYNTHESIS] in DoD, [ORIGINAL] as a generalisation.**
>
> **Onward movement of the same goods after an interruption continues the same shipment unless a new
> _undertaking_ was made over them.** A new transport document is the **record** a new undertaking
> leaves in a lane that issues one; it is never the thing that makes the undertaking new. The
> discriminant is therefore the commitment, exactly as [`fork-order` §3.1]'s definition already
> says — and the reason this had looked open for three revisions is that the corpus's one decisive
> source states the discriminant's **evidence** rather than the discriminant.

**Why this is not a new commitment of A2's.** [`fork-order` §3.1] defines a shipment as _"the set of
goods committed to move under one transport undertaking"_. Read strictly, that sentence decides owed
item 1 on its own: the question _"is the onward movement the same shipment?"_ is the question _"is it
under the same undertaking?"_. What A2 supplies is the reading, the sourced answer for each named
operation, and the correction to B-DOC that follows.

**(a) The four named operations, decided.**

| Operation                              | Same undertaking?                                                                                                                                              | Verdict                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Diversion**                          | **Yes, and the source says so in the same breath** — the shipment _"keeps its identity **and its BL**"_; only the destination changes (`src:dtr-part-iv` #255) | **Same shipment**                 |
| **Split at a transshipment point**     | **Yes** — see (b)                                                                                                                                              | **Same shipment**, with Portions  |
| **Delivery out of storage-in-transit** | **Yes** — SIT is storage _"incident to a line-haul movement"_ and _"the BL is still alive and the TSP is still liable"_ (`src:dtr-part-iv` #676)               | **Same shipment**                 |
| **Reshipment after termination**       | **No** — see (c)                                                                                                                                               | **A second shipment**, correlated |
| _(Conversion to permanent storage)_    | Out of scope — a different bailment under a different contract, [A5 §3.4(c)]                                                                                   | **Leaves the model**              |

**(b) The split shipment is one shipment, and three independent things say so.** This is A5's
hand-off 2 and it resolves in the opposite direction to the way its name reads.

1. **Both definitions make the composite grammatically singular.** `src:dtr-part-iv` #662: _"a
   shipment separated at a transshipment point into increments"_. `src:dp3-400ng` Item 17.9: _"a
   shipment where only a portion is stored in transit enroute"_. Neither source says two shipments;
   both say one shipment with parts, and the second uses the word `portion` to say it.
2. **What the increments are "documented separately" by is not a transport contract.** DTR's
   increments each get _"its own weight ticket and its own SIT control number"_ (#662, A-402
   §D.5.b(4)). A weight ticket is a `document` ([SD §4.7.1] lists it in `weight.net`'s `context[]`)
   and a SIT control number is the **`stay`'s** identifier ([SD §7.4]). Neither is an undertaking,
   and **no new bill of lading is issued** — which the source would have had to say, because a new
   bill of lading is exactly what it says for reshipment two sections later.
3. **The tariff rates the composite as one shipment.** Storage is rated per portion at each
   portion's own placement date (Item 17.17), and the **1,000-lb minimum applies to the combined
   weight** (Item 17.9.b.2). A minimum applied across the parts is a statement that the parts are one
   rateable thing.

So: **a split shipment is one shipment, N Portions ([SD §3]) and N stays ([SD §1.2], one SIT control
number per increment).** `P-IDENTITY` is not merely consistent with the corpus's hardest split case;
that case is positive evidence for it, which [SD §11]'s Portion row did not have.

**(c) Reshipment is a second shipment, and the argument is the definition plus one citation.**
`src:dtr-part-iv` defines the bill of lading as _"a contract between the shipper and the TSP whereby
the TSP agrees to furnish transportation services"_ (#81), and §E.4(4)(c) says a terminated shipment
moves onward **on a new bill of lading**. A new such contract **is** a new agreement to furnish
transportation services over those goods — which is a new undertaking by the definition, with no
inference about documents required. **[SYNTHESIS]:** two sentences of one grade-A source, joined
mechanically.

Two supports, and one thing deliberately not claimed:

- **The termination side is consistent.** Termination makes the warehouse _"the final destination of
  the shipment"_ and ends the carrier's bill-of-lading liability (`src:dtr-part-iv` §D.5.c(2);
  `src:dp3-400ng` Item 17-2.2), and the original bill of lading _"cannot be revived or reinstated"_.
  A movement whose destination has been reached and whose contract cannot be revived is a movement
  that ended.
- **The exclusion points the same way.** DTR's diversion _expressly excludes shipments already in
  destination SIT_ (#255), corroborated at `src:dp3-400ng` Item 28.4.d — the route that preserves
  identity is unavailable in precisely this case, and the route that remains is terminate-and-reship.
  [`fork-order` §7] flagged this exclusion as the reason its diversion score came down; under
  B-ONWARD it stops being an embarrassment and becomes a second witness.
- **Not claimed: that a new order is awarded.** Whether DPS issues a fresh offer and award for the
  reshipment is **not in the corpus**. `src:dtr-part-iv`'s own analysis lists `reship` among the
  **order-lifecycle** transitions it scores under A1, which if anything reads the other way. B-ONWARD
  does not need it — the undertaking is the bill of lading's contract, not the award — and §3.2(e)
  records the consequence: the discriminant is not computable from the records the model publishes.

**(d) What this does to B-DOC, which is a sharpening and not a reversal.** [`fork-order` §3.2.2]
states **B-DOC**: _"where a transport contract exists, a new transport contract over the same goods
marks a new shipment; a change recorded on the existing contract does not"_, marked **[ORIGINAL]**
and scored **medium**. B-ONWARD says B-DOC is **right wherever a lane issues exactly one transport
contract per undertaking, and silent everywhere else** — which is why it holds throughout DoD and
fails in the RMC lane and the cancelled move, the two cases [`fork-order` §3.2.2] named when it
withdrew the claim that DTR had supplied the rule.

And A2 can add **a second reason B-DOC is [ORIGINAL]**, which [`fork-order` §3.2.2] does not carry:
**the system B-DOC was read off separates the commitment from the document itself.** DPS offers and
the TSP accepts within 24 hours (`src:dtr-part-iv` §C.4); the survey follows; and _"the BL cannot be
printed until pre-move survey weight and agreed pack/pickup dates are in DPS"_ (§F.1 NOTE). Award,
survey and bill of lading are three events in that order, so even inside DoD the document is
downstream evidence of a commitment made earlier. A rule that reads identity off the document is not
DoD's rule either; it is a rule that happens to give DoD's answers because DoD issues one document
per undertaking. That is exactly the sharpening [`fork-order` §3.2.3]'s own two-stage boundary was
reaching for, and it costs B-DOC nothing it had not already conceded.

**(e) The honest limit, and it is the structural fact from §1.** B-ONWARD is decidable in prose for
every operation the corpus names and **not computable from the published records for any of them**,
because the undertaking has no `type`. A consumer holding the whole catalog cannot tell a reshipment
from a delivery-out, because neither the termination nor the new undertaking is an assertion. §9's
`shipmentContinuity` therefore answers the five named causes from this section's table and returns
`COMMITMENT_NOT_PUBLISHED` for everything else, which is the model reporting its own hole at the one
place a consumer would meet it. §3.6 records `shipmentCommitment` as absent and owed.

**(f) One observation handed to [A5] rather than a correction made here.** [A5 §3.4(b)]'s table lists
_"leaves the customer entitled to delivery out of storage"_ under **termination**, citing
`src:dtr-part-iv` §D.5.c(1) NOTE. The sentence the source analysis quotes is conditioned differently
— _"**when converted to customer expense**, the customer is still entitled to delivery out of storage
paid for by the Government"_ — and conversion to customer expense is the thing [A5 §3.4(a)] is at
pains to keep **apart** from termination. Both readings are available from the secondary text and the
primary is not in the corpus, so this is recorded, not resolved. **It does not move §3.2:** nothing
above rests on an obligation surviving termination. The terminal act of a shipment whose warehouse
has become its final destination is **unrecorded** — there is no record type for it either — and §3.6
carries that rather than papering over it.

### 3.3 The shipment's kind — owed item 2

> **Decision.** **A2 publishes no shipment-type vocabulary, and withdraws the promise of one.**
> [`fork-order` §3.1]'s _"a type from a closed enum (P1)"_ is the only line of that document's shape
> diagram that names something the model does not have, and it is withdrawn rather than filled.
> `shipmentType` is recorded as **absent and owed** under [SD §4.7.3], with the facets a mint would
> have to settle named in its docstring.

**The finding, and it is A2's C2 contribution.** Six sources publish a closed shipment-type
vocabulary. Decomposed, **no two of them are enumerating the same thing**, and every one of them
mixes in at least one facet that belongs to a different aggregate:

| Source                          | Its enum                                                                                                                                                   | Facets it fuses                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src:milmove-mymove`            | `HHG`, `HHG_INTO_NTS_DOMESTIC`, `HHG_OUTOF_NTS_DOMESTIC`, `INTERNATIONAL_HHG`, `INTERNATIONAL_UB`, `PPM`, `BOAT_HAUL_AWAY`, `BOAT_TOW_AWAY`, `MOBILE_HOME` | commodity · geography · **programme** (NTS) · **direction** · **who performs** (PPM) · method (haul vs tow) |
| `src:dtr-part-iv`               | Code of Service `D`, `2`, `4`, `5`, `6`, `T`, `7`, `8`, `J`, `S`, `B*`/`H*`                                                                                | mode · containerisation · **rate family** · procurement method                                              |
| `src:dp3-400ng`                 | codes of service `D`, `2`, `B`, `H`, `S`                                                                                                                   | mode · containerisation · procurement method                                                                |
| `src:weichert-supplier-api`     | `shipmentType` `Air`/`Land`/`Sea`/`LTS`; `routingType` `Vanline`/`RO-RO`                                                                                   | mode, on **two axes at once** · **programme** (LTS)                                                         |
| `src:sirva-ade`                 | `Household` / `OfficeIndustrial`, beside `shipperType` `PrivateTransferee`/`NationalAccount`/`Government`/`Military`                                       | commodity · **who pays**                                                                                    |
| `src:smartmoving-api`           | `JobType` `Moving`/`Packing`/`LoadOnly`/`UnloadOnly`/`InnerHouse`/`StorageInBound`/`StorageOutBound`/`JunkRemoval`/`LaborOnly`                             | **services ordered** · programme                                                                            |
| _(`src:x12-858…`, `BX02`)_      | multi-origin / multi-destination / single-trailer / single-freight-bill                                                                                    | **movement structure**, a facet nobody else has                                                             |
| _(`src:atlas-world-group-api`)_ | four axes, undefined                                                                                                                                       | unknowable — `C2 = 1`, and the analysis records no code lists                                               |

**Three of the fused facets are other aggregates' facts, and one is another area's.**

- **`PPM` and `shipperType` are `partyRole` facts.** A self-move is a shipment whose performing party
  is the customer, and a `NationalAccount` shipper is a statement about who pays. Both already have a
  home: [SD §4.7.3] makes `partyRole` an **aggregate in its own right** — _"the role-holding itself is
  an aggregate"_ — whose records name _"the `shipment`/`order`/`trip` the role is held over"_ in
  `context[]`. Put either in a shipment-type enum and the same fact has two homes, which is defect B
  in [SD §4.7.2f]'s sense. **The row is marked provisional** and depends on [A8 §9 items 1-2], which
  is why §3.3 records the facets a mint would have to settle rather than asking A8 for this one
  first.
- **`NTS`, `NTSR` and `LTS` are A5's programme boundary**, and [A5 §3.4(c)] has already ruled that
  crossing it **leaves the model** rather than setting a flag inside it. A shipment type enum
  carrying `HHG_INTO_NTS_DOMESTIC` would put the far side of a boundary A5 closed back inside A2's
  vocabulary.
- **`JobType` is services ordered** (§3.6), and **rate family** is A12's.

**And the positive reason not to publish: every one of these enums is a rating or routing key.** The
DTR analysis says it outright — a Code of Service _"fixes mode, containerization and **rate family**"_
— and `src:dp3-400ng`'s codes of service live in a tariff's Definitions. `src:weichert-supplier-api`
carries two mode axes because its two axes serve two different downstream decisions and no term in
either is defined. **[ORIGINAL]:** the generalisation that these are keys rather than ontologies is
ours; what is sourced is that each is stated in a rating or routing context and that none of the
six defines its own members except MilMove.

A single closed enum over the union would be the cross-product of six facets, would carry two
aggregates' facts and one other area's, and would be wrong for the seventh publisher. Under
[catalog §2.3] a published member's spelling cannot be changed without a **major version**. The gap
is cheaper.

**What a mint would require**, recorded so the next attempt starts here rather than at the corpus:
a settled facet set (commodity, mode, containerisation, geography, movement structure), each facet
as its own closed vocabulary; `partyRole` carrying who performs and who pays, which needs
[A8 §9 items 1-2]; A12 owning the rate family; and an authority row — whose asserter is the party
that committed the goods, which is the same blocker §3.6 records under `shipmentCommitment` and the
same one [A1 §Cross-area] found under `orderResponse`.

**What A2 does keep from MilMove**, because it is a shape and not a vocabulary: **the type axis needs
an extension point**, and ADR 0067's child-table-per-type is the corpus's one worked argument for
one, with the cost recorded in the same ADR. [catalog §2.3]'s `newClosedEnumMember` is the model's
existing answer to the same pressure, so nothing is minted for it here.

### 3.4 The zero-shipment order — owed item 3

> **Decision.** **An order with zero shipments is an ordinary order, and every mechanism it needs
> already exists.** No shipment is required for an order to be awarded, accepted, cancelled or read:
> `orderStageAt` does not look at `context[]` and therefore cannot see how many shipments there are.
> A2 adds nothing and — this is the useful half — **A1's `COMPLETE` fork is not blocked by A2.**

[A1 §Cross-area] to A2 reads: _"§3.4's `COMPLETE` fork is A2's to close, together with A4: a
completion rule derived from the committed shipments' terminal acts needs a settled reading of the
**zero-shipment** order."_ The reading is short:

1. **Zero is a legal value of N and is sourced.** `src:weichert-supplier-api` expresses acceptance as
   an update carrying an **empty `shipments` array** (odt:322, and identically at six further
   offsets) — a live RMC wire on which an accepted order with no shipments is normal traffic.
   [`fork-order` §5.3] records it; A2 ratifies it.
2. **The mechanism is already built and already independent of N.** `orderStageAt` reads the
   `FactResolved`-selected `orderAward`, `orderResponse` and `orderCancellation` assertions and
   nothing else; its own docstring says the stage is independent of how many shipments are
   committed, _"including zero"_ ([A1 §3.3], [SD §1.4] rule 3). There is no zero-shipment special
   case because there is no shipment-counting anywhere in the fold.
3. **So the zero-shipment order is not what blocks `COMPLETE`.** A completion rule over _"the
   committed shipments' terminal acts"_ is blocked by two other things, and A2 can name both
   precisely. First, **which shipments were committed is not published** — §1's structural fact
   again: the commitment has no record, so the set the rule would quantify over cannot be read off
   the catalog even when it is non-empty. Second, **the goods-side terminal act is A4's**, unchanged.
   The zero case is the _easy_ one: a rule that quantifies over an empty set answers vacuously, and
   [A1 §3.4]'s fork is not turning on it.

> **A2's answer to [A1 §3.4], stated for A1 to use:** _the zero-shipment order needs no reading
> beyond [`fork-order` §5.3]'s, and the `COMPLETE` fork is blocked by `shipmentCommitment` ([A2
> §3.6]) and by A4, not by the cardinality._ **[ORIGINAL]** as a reframing; each of its two inputs is
> settled text.

**One thing A2 declines to do.** [`fork-order` §5.3] also names _"the states an order occupies before
any shipment exists (surveyed, estimated, awarded, accepted, cancelled-pre-commitment)"_ as
**[ORIGINAL]** and unresolved. That list is **A1's**, and A1 has answered it: [A1 §3.3] publishes
five stages and [A1 §3.4] declines to put the estimate on the order's stage, handing it to A10. A2
records that `fork-order` §5.3's open item is closed by A1 and is not A2's.

### 3.5 The Portion survives — owed item 4

[SD §11]'s confidence table makes one explicit, mandatory demand of this document, under the §3
Portion row: _"If A2 finds a published HHG model that keeps enumerated and measured subsets as
**different** entities, revisit."_ The check is run, and the answer is **no**.

**The two candidates, and why neither is one.**

- **`src:sirva-ade`'s hauling segments** are the nearest thing in the corpus to a sub-shipment entity
  that is measured and not enumerated: `Overflow` carries `Weight` **and nothing else** (SOE p.19)
  and `Transfer` carries nothing further (SOE p.24), each with its own sequence number encoded into
  `CamisRegNumber`. But they are not a second entity beside an enumerated one — **there is no
  enumerated sub-shipment in SIRVA at all**, so the source keeps one form and lacks the other rather
  than keeping two apart. It is evidence for **P-MEMBER** (the crew knew the weight and not the
  contents) and against nothing.
- **`src:dp3-400ng` Item 17.13's partial withdrawal** is the case that would break the rule if
  anything did, and it does the opposite: **one operation requires both forms of the same subset.**
  The withdrawal is identified by **inventory item numbers** _and_ requires _"the actual weight of
  the portion withdrawn"_, after which storage _"continues to accrue on the remaining weight"_. Two
  membership forms, one subset, one tariff item — which is exactly [SD §3.2]'s `BOTH` and exactly
  why [SD §3] refused to make either form the sole grain.

**And the split shipment is a third witness, discovered at §3.2(b).** `src:dp3-400ng` Item 17.9.b.2
rates the portions separately and applies the 1,000-lb minimum to their **combined** weight — one
rateable shipment with measured parts, under one identity. [SD §3]'s **P-IDENTITY** is not merely
untouched by the corpus's hardest split case; that case is positive evidence for it that [SD §11]'s
row did not have when it was written.

> **[SD §11]'s Portion row may be raised from medium-high on this check alone — but A2 does not raise
> it**, because the check tests one clause of the row and the row's other reservation (_"the
> one-entity-two-forms join is ours"_) is untouched. What A2 supplies is recorded at §Cross-area for
> [SD] to take or leave.

### 3.6 The rubric's row, triaged — owed item 5

The rubric gives A2 _"shipment vs order, shipment types (HHG, storage, vehicle, PPM/self-move…),
weights, services ordered"_. [A1 §3.4] set the discipline and [A5 §3.6] refined it: say of each
whether it is a record type, a projection, somebody else's, or absent and owed — and refuse to mint
where the mint would cost more than the gap.

| Rubric item           | Verdict                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shipment vs order** | **Already decided, and not A2's to reopen** — [`fork-order` §3.1], scored **high**. A2 ratifies and inherits                                                                                                               |
| **Shipment types**    | **Absent and owed** — `shipmentType`, §3.3                                                                                                                                                                                 |
| **Weights**           | **Record types, and they already exist** — `weight.net`, `weight.gross`, `weight.tare`, family `goods`, with `R-WEIGHT-LOWER` ([SD §4.4]) and `pieceCount`'s `{unitization}` qualifier beside them. Two gaps remain, below |
| **Services ordered**  | **Somebody else's** — the order's, by binding text. Below                                                                                                                                                                  |
| _(Composition)_       | **Not in the model, and no source has one** — the Portion is the only sub-shipment grain, §3.5                                                                                                                             |

**Weights: two gaps, and A2 mints neither.**

- **`cube` is already recorded absent** in [SD §4.7.3] and A2 leaves it there, with one addition to
  the record: it is named by more sources than any other absent class in the list —
  `src:sirva-ade`'s five weight/cube variants, `src:atlas-world-group-api`'s `ord_totalvolume` and
  `shipment_Density`, `src:nmfta-ebol`'s `cube`, `src:weichert-supplier-api`'s net-and-gross **volume**
  beside net-and-gross weight, `src:smartmoving-api`'s cubic feet with a `densityFactor`, and
  `src:uncefact-mmt-rdm`'s `GrossVolumeMeasure`. It is absent for the same reason `unitOfMeasure` is
  owed, not for want of evidence, and it should mint with a units module rather than before one.
- **A _decided_ weight has no basis.** [SD §4.2]'s tense enum is `ACTUAL` | `ESTIMATED` | `PLANNED` |
  `COMMITTED` | `REQUESTED`, and `src:milmove-mymove`'s `billableWeightCap` — _with a justification
  field beside it_ — is none of those: it is a number an authority **decided** to bill on, against an
  actual it does not claim to be. `src:uncefact-mmt-rdm`'s `ChargeableWeightMeasure` and
  `src:x12-212-trailer-manifest`'s element 187 `B` **Billed** are the same concept at grade A, twice
  more. **A2 does not add a basis member**, because a billable weight is a **charge** input and
  [SD §4.7.1]'s `charge` row already declares `{aspect}` ∈ `PROPOSED` | `DECIDED` | `RATED` — the
  exact distinction, one aggregate over, with an authority row closed at [A8 §5] row 11. Recorded at
  §Cross-area to [A7], which owns whether the cap is a `charge` at `aspect = DECIDED` or a fourth
  thing.

**Services ordered: a rubric-vs-binding-text conflict, surfaced rather than resolved by preference.**
The rubric puts services ordered in A2. The binding fork puts it on the **order** — [`fork-order`
§3.1] defines an order as _"one commitment, to one performing party, to perform **a named set of
services**"_ — and [SD §Precedence] makes that outrank the rubric. The corpus splits the same way:
`src:nmfta-ebol`'s `accessorials.codes[]` is _"the list of services requested for **the shipment**"_
(`:636`) and `src:uncefact-mmt-rdm`'s `TransportService` hangs off the consignment, while
`src:cfr-49-375` §375.301's five service options and `src:smartmoving-api`'s `JobType` are properties
of the engagement. **A2 does not create an owed class for something a binding document has already
placed**, and does not overrule the fork on the rubric's authority. What A2 records is that the
question _"which services were ordered for **this** shipment when an order carries two"_ has no answer
today and is A7's together with [`fork-order` §6]'s user question 2. **[ORIGINAL]** as a placement,
and it is a deferral rather than a decision.

**One fact class the corpus names and no table carries, recorded as absent under [SD §4.7.3].**

> **`shipmentCommitment`** — the act by which a party commits goods to a named movement, which is
> [`fork-order` §3.2.3]'s stage 1 and the thing that mints a shipment.

It is named as a real act, with a real asserter and a real wire representation, by three sources:
`src:sirva-ade`'s `Register`, which arrives as a **push** carrying the full element set and sets
`ShipmentStatus = REGISTERED` (SOE pp.10-13; GSD p.8) — a grade-A live partner contract with **no
bill of lading in it at all**; `src:milmove-mymove`'s `MTOShipment` `DRAFT → SUBMITTED → APPROVED`
with a two-actor protocol and a rejection invariant (`mto_shipments.go:185-212`); and
`src:cfr-49-375`, which names, enumerates and prices the lot before the contract document exists
(§375.403(c), §375.503(a), §375.401(f), against §375.505(c)).

**Absent rather than minted, on [A5 §3.6]'s discriminator and [A1 §Cross-area]'s refinement of it.**
A5's rule is that the physical acts on an aggregate have closeable authority rows and the
administrative acts do not, because only the physical ones have an asserter who was present.
Committing goods to a movement is administrative: nobody is in the room. But A2's case is **not**
A5's — the asserter here is not an undefined party class. It is the party that awarded or accepted
the order, which the corpus names on every order transition ([A1 §Cross-area]) and which
[A8 §4.3]'s six `boundBy` members cannot express, because none of them means _"resolved by the
order's own award"_. **`shipmentCommitment` is blocked by exactly the gap A1 found under
`orderResponse` and `orderCancellation`, and by nothing else.** It is the third row that a single
schema decision at A8 would unblock, and A2 adds its weight to that request rather than opening a new
one.

**What this costs, stated plainly.** Three things in this document are decidable in prose and not in
code because of it: B-ONWARD (§3.2(e)), B-STAGE's three stages ([`fork-order` §5.2], which has been a
projection with no inputs since it was written), and the shipment-set a `COMPLETE` rule would
quantify over (§3.4). That is the largest single consequence of any absent class in the model, and it
has been invisible until now because no area owned the shipment.

### 3.7 The criteria weighted, and why

The rubric requires the weights per area. A2 weights **C2 heaviest** — the first area to do so —
then C4, then C3; it discounts C1 **hard**, and treats C8 as a tie-breaker.

1. **C2 — semantic precision, weighted highest, because A2's problem is disagreement and not
   absence.** Every other area written so far weighted coverage or fidelity because the question was
   whether the corpus had the concept. Here it has the concept eight times over and the eight do not
   agree (§2.12, §3.3). The only tool that separates them is whether a source **defines** its members:
   `src:milmove-mymove` and the two UN/CEFACT models do (`C2 = 3`); `src:atlas-world-group-api`
   publishes four type axes and defines none (`C2 = 1`); `src:weichert-supplier-api` never expands
   `ACW`, `DTD`, `LDN` or `CWT` (`C2 = 2`). §3.3's refusal is a C2 judgement and nothing else would
   have produced it.
2. **C4 — HHG fidelity, second, and it is what keeps the two best-defined sources from winning.**
   `src:uncefact-mmt-rdm` and `src:uncefact-scrdm` score `C2 = 3` and `C4 = 0`. They supply mechanism
   — the measure family, the quantity vocabulary, the header/line decomposition — and cannot decide a
   single question this document was asked. The four sources that decide §3.2 all score `C4 = 3`.
3. **C3 — lifecycle rigor, third, and it is the criterion §3.2 actually ran on.** Owed item 1 is a
   question about what an operation does to an identity, which is a C3 question. `src:dtr-part-iv`
   scores `C3 = 1` **on A2** and decided the whole of §3.2 — because its A2 row scores the _shipment
   structure_ it does not have, while its `C3 = 3` on A1 is where the diversion / termination /
   reshipment trichotomy is scored. **That mismatch is a finding about the rubric, not about the
   source**: an operation on a shipment's identity is scored in one area and lives in another.
   Recorded at §Cross-area.
4. **C8 — extensibility, a tie-breaker.** `src:milmove-mymove` scores 3 and earns it with a written
   argument (ADR 0067) rather than with a custom-field bucket; `src:smartmoving-api` and
   `src:project44` score 3 and 2 on `Custom01…Custom50` and `CustomAttribute`, which are extension
   _points_ with no extension _discipline_. §3.3 keeps MilMove's shape and neither bucket.
5. **C1 — coverage, discounted harder than in any area so far.** In A2 coverage measures how many
   type axes and weight fields a source has, and the two highest `C1` scores in the area belong to a
   source with no definitions (`src:atlas-world-group-api`, `C1 = 3`, `C2 = 1`) and to a reference
   model with no household goods in it (`src:uncefact-mmt-rdm`, `C1 = 3`, `C4 = 0`). Rewarding size
   here would have produced exactly the union enum §3.3 refuses.
6. **C6 — identity, not weighted, because it is spent.** [SD §7] settled the shape and
   [`fork-order` §3.3] settled what this boundary contributes to it. A2 mints no identifier. The one
   A2-specific datum is `src:sirva-ade`'s `CamisRegNumber` packing overflow and transfer sequence
   numbers into the identifier, which [`fork-order` §3.6] already rejected as _the_ shape and which
   §3.5 re-reads as a membership observation.
7. **C5 and C7 — carried, not weighted.** A2's time model is [SD §4.2]'s. C7's one A2-specific
   contribution is `src:smartmoving-api`'s `VolumeWeightCalculationMode`, which records **how** a
   quantity was derived — [SD §5]'s `capturedBy` in a narrower domain, and already expressible.

**The best source per criterion:** `src:milmove-mymove` on C2, C8 and the weight concepts;
`src:dtr-part-iv` on the whole of §3.2 and on the type axis's honest description;
`src:dp3-400ng` on §3.2(b) and §3.5; `src:sirva-ade` on segments and on what a measured-only subset
looks like; `src:uncefact-mmt-rdm` on the measure family; `src:nmfta-ebol` on the
containment-is-known idea [SD §3] already took. **No single source wins A2**, and unlike A5 the
reason is not complementarity: it is that the six that could win publish six different things under
one word.

### 3.8 Explicitly rejected

| Rejected                                                          | Source                                                                        | Why                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A **single closed shipment-type enum**                            | `src:milmove-mymove`'s nine; promised by [`fork-order` §3.1]                  | §3.3. Six publishers, six facet sets, three of the facets other aggregates' facts. A union would be a cross-product and still wrong for the seventh                                                                      |
| **`PPM` / self-move as a shipment type**                          | `src:milmove-mymove`                                                          | §3.3. It states **who performs**, which is a fact about a `partyRole` naming the shipment in `context[]` ([SD §4.7.3], provisional). Two homes for one fact                                                              |
| **`shipperType` as a shipment property**                          | `src:sirva-ade` `PrivateTransferee`/`NationalAccount`/`Government`/`Military` | §3.3. It states **who pays**. A8's, via `accountParty`                                                                                                                                                                   |
| **`LTS` / `NTS` / `NTSR` as members of a shipment-type enum**     | `src:weichert-supplier-api`; `src:milmove-mymove`                             | §3.3. [A5 §3.4(c)] ruled the permanent-storage boundary is the edge of the model, not a flag inside it. An enum member would put the far side back in                                                                    |
| **`JobType` as the shipment-type vocabulary**                     | `src:smartmoving-api`                                                         | §3.3. It enumerates **services ordered**, and the same source has no shipment entity at all                                                                                                                              |
| A **new shipment per new transport document**                     | **B-DOC**, [`fork-order` §3.2.2]                                              | §3.2(d). Not rejected — **sharpened**. It is right where a lane issues one contract per undertaking and silent where a lane issues none, which is why it holds in DoD and fails in the RMC lane                          |
| A **new shipment per split increment**                            | the name "Split Shipment", `src:dp3-400ng` Item 17.9                          | §3.2(b). Both definitions are grammatically singular, the increments are documented by a weight ticket and a SIT control number rather than a bill of lading, and the 1,000-lb minimum is applied to the combined weight |
| **Two entities for the two membership forms**                     | `src:sirva-ade`'s measured-only segments                                      | §3.5. SIRVA lacks the enumerated form rather than keeping it separate; Item 17.13 requires **both** of one subset. [SD §3]'s `BOTH` stands                                                                               |
| A **`billableWeight` basis member**                               | `src:milmove-mymove` `billableWeightCap`; `src:x12-212…` element 187 `B`      | §3.6. A decided billing number is a `charge` at `aspect = DECIDED` ([SD §4.7.1]), one aggregate over, with a closed authority row. A2 does not widen [SD §4.2]'s tense enum for it                                       |
| **`MTOShipmentStatus` as the shipment's state**                   | `src:milmove-mymove` `DRAFT → SUBMITTED → APPROVED → CANCELED`                | [SD §1.1] forbids a mutable current-state field, permanently. The states are cited at §3.6 as evidence that the **minting act** exists, which is the half that is missing                                                |
| **The diverted-shipment chain**                                   | `src:milmove-mymove` `diversion` + `divertedFromShipmentId`                   | Already rejected at [A3 §3.3], whose gloss A2 ratifies from the other side: DTR's diversion keeps the identity **and the bill of lading**, so there is no second shipment for a back-reference to point at               |
| A **`shipmentType` row written now**, with a provisional asserter | available, and cheap                                                          | §3.6. [SD §4.7] note 3 bars a provisional authority reading from scoring, so the row would buy nothing and owe [A8 §9 item 8] on the day it was written                                                                  |

---

## 4. What this forecloses, and the cost if it is wrong

**Foreclosed by design:**

1. **A consumer cannot ask what kind of shipment this is.** §3.3 publishes no vocabulary, so the
   question has no answer in the catalog. **If this is wrong**, it is wrong in the direction of
   omission, and the repair is additive — `newClosedEnumMember` and a new row under [catalog §2.3].
   Publishing the wrong enum is the expensive direction: a member's spelling is **breaking**.
2. **A consumer cannot tell a reshipment from a delivery-out from the records.** §3.2(e). The prose
   rule is decidable and the records are not there to run it on. **If this is wrong** — if some
   consumer can in fact infer the commitment from something published — the cost is that the model
   under-reported a capability it had, which is the cheap direction. The repair is
   `shipmentCommitment`.
3. **Services ordered has no shipment-level home.** §3.6 defers to the order on binding text. **If
   this is wrong**, it is wrong for the order carrying two shipments with different service sets,
   which is a real case the corpus names on both sides. It is recoverable — a `service` fact class
   over the `goods` family is additive — and it is A7's to open.
4. **A2 mints no record type, no projection, no reason code and no vocabulary.** The second area in a
   row to mint nothing, and for a different reason from A5's: A5's central records already existed,
   while A2's central record **does not exist and cannot yet be written**.

**Not foreclosed, and worth saying so:** B-ONWARD does not foreclose a future computable form. It is
written over named causes rather than over a party's identity precisely so that the day
`shipmentCommitment` lands, the rule reads it instead of being replaced.

---

## 5. ORIGINAL design — what household-goods moving needs that no source supplied

Two things, and one of them is smaller than it looks.

1. **The undertaking-not-the-document reading of the shipment boundary (B-ONWARD, §3.2).** The
   _sentence_ is [`fork-order` §3.1]'s and is not new. What is new is the claim that the sentence
   already decides owed item 1, the demonstration on four named operations, and the diagnosis of why
   B-DOC looked like the rule: the corpus's decisive source states the discriminant's evidence rather
   than the discriminant, and states it in a programme that issues exactly one document per
   undertaking. **[SYNTHESIS]** where it is applied to DoD's four operations (every input is one
   source's sentence); **[ORIGINAL]** as a generalisation beyond DoD, on the same terms B-DOC is.
2. **The reading that a published shipment-type enum is a rating key rather than an ontology
   (§3.3).** That each of the six is stated in a rating or routing context is sourced; that this is
   _why_ they do not agree, and _why_ the model should not union them, is ours.

**And one thing that is emphatically not original, recorded because it is the document's largest
output.** `shipmentCommitment`'s absence is a **finding**, not a design: three grade-A sources publish
the act and [SD §4.7.1] has no row for it. Nobody invented the gap; it was simply nobody's until A2.

---

## 6. What only the user can decide, and what is owed elsewhere

### Owed, with an owner

| Owed                                                                      | Owner                            | What it needs                                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **`shipmentCommitment`** — a [SD §4.7.1] row and an [A8 §5] row           | [SD] + [A8 §9 items 3, 8]        | A `boundBy` member meaning _"resolved by the order's own award"_ — the same one [A1 §Cross-area] asks for. §3.6      |
| **`shipmentType`** — a facet set, then a row                              | A2, re-opened, after A8          | Facets settled; `partyRole` carrying who performs and who pays ([A8 §9 items 1-2]); A12 owning the rate family. §3.3 |
| **`cube`** — a row                                                        | [SD §4.7.3], with a units module | The `unitOfMeasure` vocabulary, which is one of the three owed closed vocabularies. §3.6                             |
| **Whether a billable-weight cap is a `charge` at `aspect = DECIDED`**     | A7                               | [A8 §5] row 11's `PRINCIPAL` binding, and whether a cap with a justification is a decision or a fourth aspect. §3.6  |
| **Services ordered at shipment grain**                                    | A7, with [`fork-order` §6] q2    | Whether an order's two shipments may carry different service sets. §3.6                                              |
| **The terminal act of a shipment whose warehouse became its destination** | A4                               | §3.2(f). There is no record type for it and A2 does not mint one                                                     |

### What only the user can decide

[`fork-order` §6]'s seven questions are inherited unchanged and are not restated. A2 adds none, and
**removes none** — but it can now say which of the seven its own decisions touch:

- **q1 (a relocation aggregate in v1)** is untouched. §3.2 adds no pressure either way.
- **q5 (do tenants re-issue a transport contract mid-move for administrative reasons?)** is
  **narrowed rather than answered.** It was asked because _"under B-DOC that would mint a new
  shipment"_. Under B-ONWARD an administrative re-issue over an unchanged undertaking mints
  **nothing**, so the question stops being a modelling risk and becomes what it should always have
  been: a question about how often the two come apart in a lane we can observe.
- **q7 (whose commitment mints the boundary when two parties commit differently)** is
  **sharpened and made more urgent.** §3.6 shows the commitment has no record at all, so q7 is not
  only unanswered but currently unaskable of the data. It should be read together with
  `shipmentCommitment` rather than separately.

---

## 7. Confidence

| Claim                                                                              | Confidence              | Why not higher                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Diversion, split and delivery-out keep the shipment** (§3.2a-b)                  | **high**                | Each is stated by `src:dtr-part-iv` directly, and the split case is corroborated twice by `src:dp3-400ng` including by a rating rule that treats the parts as one                                                                              |
| **Reshipment after termination is a second shipment** (§3.2c)                      | **medium-high**         | **[SYNTHESIS]** of #81 and §E.4(4)(c), both grade A, both one source. Held below high because whether a new **award** accompanies the new bill of lading is not in the corpus, and the same source scores `reship` as an A1 order transition   |
| **B-ONWARD as a generalisation beyond DoD** (§3.2d)                                | **medium — [ORIGINAL]** | Exactly B-DOC's standing, and deliberately: A2 does not claim a better warrant for the general rule than `fork-order` claimed. What A2 adds is _which_ half is general and a second reason the document-reading is not DoD's rule              |
| **No shipment-type vocabulary** (§3.3)                                             | **medium-high**         | The facet analysis is a reading of six published enums and is checkable against all six. **[ORIGINAL]** in the claim that they are rating keys, which is why it is not high                                                                    |
| **The zero-shipment order needs no new reading** (§3.4)                            | **high**                | Two settled texts and one docstring, none of them A2's. The reframing of what blocks `COMPLETE` is **[ORIGINAL]** and is scored with §3.6                                                                                                      |
| **The Portion survives the [SD §11] check** (§3.5)                                 | **high**                | Item 17.13 requires both membership forms of one subset in one operation. The check asked for a counter-example and the corpus supplies a confirming case instead                                                                              |
| **`shipmentCommitment` is absent and is blocked only by the `boundBy` gap** (§3.6) | **medium-high**         | The absence is verifiable against [SD §4.7.1] and the act is sourced three times. The claim that the `boundBy` gap is the **only** blocker rests on [A1 §Cross-area]'s reading of the corpus's order-side party naming, which is A1's not A2's |
| **Services ordered is the order's** (§3.6)                                         | **medium — a deferral** | Decided by [SD §Precedence] over the rubric, not by evidence: the corpus genuinely splits, and `src:nmfta-ebol` says "for the shipment" in terms                                                                                               |
| Shipment-vs-order cardinality                                                      | **not scored here**     | [`fork-order` §3.1], **high**, inherited unchanged                                                                                                                                                                                             |

### Assertions made here that no source supports

- **B-ONWARD as a universal** (§3.2d) — the same [ORIGINAL] standing as B-DOC, which it sharpens.
- **That the six published shipment-type enums are rating keys rather than ontologies** (§3.3) — each
  is stated in a rating or routing context, which is sourced; the inference is ours.
- **The facet decomposition itself** (§3.3's table) — no source decomposes its own enum.
- **That `COMPLETE` is blocked by `shipmentCommitment` and A4 rather than by the cardinality**
  (§3.4) — a reframing; both inputs settled.
- **The placement of services ordered on the order** (§3.6) — a reading of binding text against a
  rubric row, and the corpus does not settle it.

---

## 8. Acceptance — the nine scenarios, run explicitly

A2 is decisive in three, contributes a precondition to three, and is silent in three. Silence is
recorded as an answer, per [A1 §8] and [A5 §8].

### 1. Five families' goods on one van over four days — **A2 is decisive on one point and silent otherwise**

Five shipments, five orders, one trip. A2's contribution is the negative one it inherits and
ratifies: **consolidation is not a shipment-structure concept**, `src:dtr-part-iv`'s consolidated
shipment being _"a separate BL per customer's lot"_ cross-referenced in block 27 — a cross-reference
between shipments, not an entity above them ([`fork-order` §3.6] P11, [A3]). Each family's goods are
one shipment under one undertaking; the van is the trip's.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **A2 is decisive, and this is owed item 1's scenario**

The stay never terminates, so `storeOut` and the delivery out are **the same shipment** under the
same undertaking — §3.2(a), on `src:dtr-part-iv` #676's _"the BL is still alive"_. The different agent
is a `partyRole` and an `ExternallyPerformedLeg` question, not an identity question. **Had the stay
been terminated and the goods reshipped**, §3.2(c) gives a second shipment, correlated by `identity`
— and §3.2(e) records that a consumer cannot tell the two branches apart from published records.
This scenario's test is where A2's answer is asserted.

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **A2 contributes a precondition**

Two refused articles mint a Portion, not a shipment ([SD §3], **P-IDENTITY**), and §3.5 is the check
that the Portion is still the right grain for it. `round-2-critique`'s objection that the grain was
_"too heavy for two items and too light for a claim"_ was answered upstream by
`MEASURED` | `ENUMERATED` | `BOTH` and **P-CLAIM**; A2 confirms nothing in the corpus reopens it.

### 4. A reweigh in transit — **A2 is silent, with one note**

Two `weight.net` assertions and `R-WEIGHT-LOWER` ([SD §4.4]). The note is §3.6's: the corpus types
reweigh as a **weight qualifier** (`src:x12-212-trailer-manifest` element 187 `RG`/`RN`/`RT`), and
`weighing` remains absent and owed on a family question A2 does not touch.

### 5. A car on a separate carrier, delivered a week apart — **A2 is decisive, via rules it inherits**

Two shipments under one order by **A-AWARD** ([`fork-order` §3.5(a)]), which A2 does not reopen. A2's
own contribution is a refusal: §3.3 declines to publish a vocabulary in which the car's shipment
would have a _type_, so the model expresses that there are two shipments and **cannot say that one of
them is a vehicle shipment**. That is the sharpest single cost of §3.3 and this is where it lands.

### 6. Cancelled after packing, before loading, with materials charged — **A2 contributes a precondition, and it is a gap**

One shipment minted at stage 1 and terminal without any transport document —
[`fork-order` §5.2]'s `closed_uncontested`. A2's contribution: **the stage cannot be computed**,
because the minting act has no record (§1, §3.6). The pack act, the charge and the cancellation all
have subjects and anchors; what nothing publishes is that a boundary was ever committed. The scenario
passes on every mechanism and fails on the projection.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **A2 is silent**

E-CANON and A8. Nothing about shipment structure is engaged.

### 8. A mid-journey custody handoff — **A2 is silent**

`custodyAt` over `handover` ([SD §4.8]). The shipment's identity is untouched by a custody change,
which is [A3]'s and [SD §4.8]'s and needs nothing from A2.

### 9. A partial load under one bill of lading — **A2 contributes a precondition, and §3.5 is why**

One shipment, one undertaking, a Portion for the part loaded. The scenario's own `OWED` block records
that the Portion's membership has no record type carrying the assertion ([SD §4.7.1],
`portionMembership`), which A2 leaves owed. `src:sirva-ade`'s `Overflow` — a second driver and trailer
for the remainder, carrying `Weight` and nothing else — is the corpus's closest published case and
§3.5 reads it as a `MEASURED` Portion.

### Summary

| #   | Status                                                                                           |
| --- | ------------------------------------------------------------------------------------------------ |
| 1   | Expressible — consolidation is the trip's, ratified                                              |
| 2   | **Expressible and decided** — §3.2; the terminated branch is a second shipment                   |
| 3   | Expressible — the Portion grain, re-checked at §3.5                                              |
| 4   | Expressible — `R-WEIGHT-LOWER`; `weighing` absent and owed, unchanged                            |
| 5   | Expressible as two shipments; **the car's kind is inexpressible** — §3.3's cost                  |
| 6   | **Partially expressible — the boundary stage is not computable**, `shipmentCommitment` absent    |
| 7   | Expressible — A2 silent                                                                          |
| 8   | Expressible — dwell classification deferred to A5, custody authority deferred to A8 ([SD §10.5]) |
| 9   | Expressible — `portionMembership` owed, unchanged by A2                                          |

---

## Cross-area consequences to record

### To [SD] — one open item closed, one confidence row offered, one row corrected

1. **[SD §10.4] bullet 1 is closed.** A5 closed the stay half; §3.2 closes the shipment half.
   `storeOut` after a terminated stay names the same `stay` **and**, where the goods then move onward
   on a new bill of lading, a **second shipment**. The two halves do not conflict, and A5's constraint
   was the reason they do not: the stay is a bailment and the shipment is a movement.
2. **[SD §11]'s Portion row has its revisit check run, and it passes** (§3.5). The clause _"if A2
   finds a published HHG model that keeps enumerated and measured subsets as different entities"_ is
   discharged: the corpus's one operation that needs a subset both ways requires **both of the same
   subset**. A2 does not raise the row's **medium-high** itself, because the row's other reservation
   is untouched, but the check no longer stands open.
3. **[SD §4.7.3] gains one absent class** — `shipmentCommitment`, §3.6 — on the same terms as A5's
   three, with one difference stated at the point of use: its blocker is a **schema** gap
   ([A8 §4.3]'s `boundBy` enum) and not a missing party entity.

### To [A8] — a third row for the same schema decision, and it is not a request for a row

[A1 §Cross-area] found that `orderResponse` and `orderCancellation` are **not** corpus-blocked: the
corpus names a party on every order transition, and what blocks them is that [A8 §4.3]'s `boundBy`
enum has no member meaning _"resolved by the order's own award"_. **`shipmentCommitment` is a third
instance of exactly that**, one aggregate away: the party that commits goods to a movement is the
party that awarded or accepted the order, named on the wire by `src:sirva-ade`'s `Register` and
`src:milmove-mymove`'s two-actor submission protocol.

The ledger's shape is worth restating with this in it. [A5 §Cross-area] found three rows blocked on
[A8 §9 item 1] because their asserter is a party class that does not exist. A1 found three blocked on
a `boundBy` member that does not exist. **A2 finds a fourth of the second kind — and it is the one
that would unblock the most**, because three separate things in this document are decidable in prose
and not in code for want of it (§3.6). A8 is not asked for a row. It is asked for one enum member,
and the count of things waiting on that member is now four.

### To [A1] — the hand-off closes, and A1's fork is not blocked where it thought

§3.4 answers [A1 §Cross-area] and [A1 §3.4]'s `COMPLETE` fork: **the zero-shipment order needs no
reading beyond [`fork-order` §5.3]'s**, and `orderStageAt` is already independent of N including
zero. What blocks `COMPLETE` is `shipmentCommitment` (§3.6) and the goods-side terminal act (A4) —
not the cardinality. [A1 §6]'s _"a `COMPLETE` stage — A2 / A4, and §3.4's fork"_ row may be re-read
accordingly: A2's half is discharged, A4's is not, and a third blocker has been named that was not on
the row.

### To [`fork-order-shipment-cardinality.md`] — revision 6

1. **§3.2.4 row 4's "NOT SETTLED HERE" is superseded**, and §4 foreclosure #7 and §7's _"not
   claimed"_ row with it: [A2 §3.2] settles it. Foreclosure #7's cost line — _"a model that never
   decides it will discover the answer implicitly, in code"_ — is discharged rather than mitigated.
2. **§3.2.2 gains a second reason B-DOC is [ORIGINAL]** (§3.2d): DoD itself separates award, survey
   and document, so the document-reading is not DoD's rule either.
3. **§3.1's _"a type from a closed enum (P1)"_ is withdrawn** and repointed at [A2 §3.3].
4. **§6 q5 is narrowed and q7 is sharpened** (§6 above).
5. **Housekeeping, and it is [plan §4 item 10]'s rule:** the frontmatter reads `revision: 2` /
   `revised: 2026-09-18` over a body carrying revisions 3, 4 and 5; and the revision-2 note says
   [SD §10.2] required _"nine"_ changes when it requires seventeen, all of which are applied (§1).
   The count is **deleted** rather than corrected, because no gate reads it.

### To [A3]

[A3 §3.2]'s deferral _"whether the same identity survives a terminated stay and reshipment — A2/A5's
question"_ is answered, and answered in the direction A3's own rows anticipated: A3 §7's row already
declined to claim survival and cited §E.4(4)(c). A3 needs no change of substance; four rows may be
re-pointed at [A2 §3.2] rather than at an open question (§1207, §1289, §3.3's diversion row, §5.1's
note at :544).

### To [A4]

Two things. **The terminal act of a shipment whose warehouse has become its final destination has no
record type** (§3.2f) — the shipment did not arrive anywhere and was not delivered, and
`src:dtr-part-iv` §D.5.c(2) makes the warehouse the destination without any act saying so. And
**§3.4's `COMPLETE` fork now names A4 as one of two remaining blockers** rather than one of three
areas jointly owning it.

### To [A7]

Three, in the order A7 will meet them. **(a)** `src:milmove-mymove`'s `billableWeightCap` with its
**justification** field, `src:uncefact-mmt-rdm`'s `ChargeableWeightMeasure` and
`src:x12-212-trailer-manifest` element 187's `B` Billed are one concept at grade A three times over,
and §3.6 places it on the `charge` fact key at `aspect = DECIDED` rather than as a fourth weight
basis. A7 decides whether that holds. **(b) Services ordered is A7's**, with [`fork-order` §6]'s user
question 2 (§3.6). **(c)** `src:dp3-400ng` Item 17.9.b.2's **1,000-lb minimum on the combined weight
of separately-rated portions** is a rating rule that reads across Portions of one shipment; A5 handed
A7 the storage charges and this is the structural constraint on them.

### To [A6]

`src:dtr-part-iv`'s **SF 1200 Government Bill of Lading Correction Notice** is A2-adjacent and A6's:
Table A-402-4 enumerates _exactly which bill-of-lading fields are correctable_ — a closed whitelist
with a before-value / after-value / justification structure — and _"everything else on the BL is
immutable; to change it you cancel and reissue."_ That is a published correction regime over the
document §3.2 reads as a commitment's evidence, and it is the sharpest A6 material in the
shipment-structure corpus. Note the consequence for B-ONWARD: **a correction is not a reissue**, and
the source draws the line for us.

### To [A9]

`src:sirva-ade`'s `CamisRegNumber` — 6 digits of shipment, 2 of overflow sequence, 2 of transfer
sequence, `00` meaning the main load — is an identifier that **encodes structure**, and
[`fork-order` §3.6] already rejected it as _the_ shape. A9 inherits the worked cost: the same source
has no identifier for a stay, so `ChangeSIT` cannot say which of two stays it means ([SD §7.4]). A2
adds that the composite's two sequence positions are the only published _addressing_ of a
sub-shipment anywhere in the corpus, and that what they address is what [SD §3] calls a Portion.

### To [`../rubric.md`] — one observation about the rubric itself

§3.7 item 3 found that `src:dtr-part-iv` scores `C3 = 1` **on A2** and decided the whole of §3.2,
because the diversion / termination / reshipment trichotomy is scored under **A1** where the source's
`C3 = 3` lives. **An operation on a shipment's identity is scored in one area and lives in another.**
That is a property of per-area scoring and not a defect in either row, but a reader comparing area
scores to decide where the evidence is will be misled by it, and the rubric's note is the place to
say so.

---

## 9. What this puts in the executable specification, and how each part is held

A2 mints no record type, no projection, no reason code and no aggregate. What it puts in the code is
one rule, one absent class, and the rewrite of a test that had been carrying A2's question as a to-do.

| What                      | Where                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B-ONWARD**, §3.2        | `shipmentContinuity` in `packages/domain-reference/src/rules/shipment-continuity.ts`, over the closed `ONWARD_MOVEMENTS`                                                 |
| The undetermined cases    | `SHIPMENT_CONTINUITY_UNDETERMINED_REASONS` in the same file — `COMMITMENT_NOT_PUBLISHED` is §1's structural fact made diagnostic, and `LEAVES_THE_MODEL` is [A5 §3.4(c)] |
| The coverage gate         | The **mapped type** `VERDICT_BY_CAUSE` keyed on `OnwardMovement`, and deliberately no `Exact` beside it — see below                                                      |
| The absent class          | `shipmentCommitment` in `ABSENT_AND_OWED` (`src/vocabulary.ts`) and the matching prose in [SD §4.7.3], gated by `tests/conformance/documents.test.ts`                    |
| §3.2's answer, asserted   | `tests/scenarios/storage-in-transit-delivered-by-another-agent.test.ts` — the `A2 still owns the other half` test becomes A2's decision plus its honest limit            |
| §3.5's check, asserted    | `tests/scenarios/partial-load-one-bill-of-lading.test.ts`                                                                                                                |
| The version and its class | `CATALOG_VERSION`, classified against [catalog §2.3] from the emitted schema diff                                                                                        |
| Registration              | `A2` in `DOCUMENTS`, `ONWARD_MOVEMENTS` and `SHIPMENT_CONTINUITY_UNDETERMINED_REASONS` in `VOCABULARIES`, `B-ONWARD` in `RULES` — all in `tools/generate-glossary.ts`    |

**What is deliberately not in the code:** no `shipmentType` vocabulary, no facet enums, no
`billableWeight` basis member, no service class, no shipment state and no composition entity. §3.3,
§3.6 and §3.8 each say why, and the glossary's Owed section carries `shipmentCommitment` so the gap is
queryable rather than remembered.

### An `Exact<>` that is assigned can still be a tautology — the next case along from [A5 §9]

[A5 §9] found that `export type X = Exact<A, B>` is a comment until something is assigned to it,
because a bare alias evaluating to `never` reports nothing. A2's first draft followed that rule
faithfully — an `Exact` in both directions, assigned `true` on the next line — and the tamper found
that **the assignment does not repair this one, because the assertion cannot fail.**

`VERDICT_BY_CAUSE` is declared as a **mapped type** over `OnwardMovement`, so
`keyof typeof VERDICT_BY_CAUSE` **is** `OnwardMovement` by construction. No edit to either side can
make the two differ. The alias was `true` for the same reason `1 === 1` is.

The real gate was the mapped type all along, and both tampers confirm it bites:

| Tamper                                                          | `tsc`                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| A sixth member of `ONWARD_MOVEMENTS` with no verdict row        | `TS2741: Property 'TAMPERED_SIXTH_CAUSE' is missing`       |
| A verdict row for a member `ONWARD_MOVEMENTS` no longer carries | `TS2353: Object literal may only specify known properties` |

So the `Exact` is **deleted** rather than kept, and the reason is written where it was: a decorative
assertion beside a gate that already bites is worse than nothing, because it tells the next reader
the coverage is checked twice. **The generalisation, for whoever writes A6:** an `Exact` earns its
place only between two things that are declared **independently**. Between a mapped type and its own
key set there is nothing to drift.
