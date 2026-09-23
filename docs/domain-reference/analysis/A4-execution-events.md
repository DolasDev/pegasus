# A4 — execution events: the reason vocabulary

Cited elsewhere as **[A4 §x]**.

> **Status.** A decision document. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope, stated narrowly on purpose.** This document settles **one** thing: the content of the
> reason vocabulary [SD §2.4] fixed the shape of and left to A4 — "the list itself is A4's job". It
> is **not** the full A4 area comparison on the pattern of
> [`A3-trip-stop-assignment.md`](A3-trip-stop-assignment.md): the eight-criteria scoring of A4's
> execution-event and tracking model against the corpus is still owed, and [`../rubric.md`](../rubric.md)
> should be read as marking A4 "modeled in detail" only for the vocabulary. §7 lists what is left.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use. Every one of the 23
   members below carries its evidence in `data/reasons.json` and in its docstring in
   `src/outcomes.ts`; the three that are not sourced outright carry a marker in the table itself, so
   a consumer reading `catalog/index.json` sees them without reading this file.
3. **Owed means owed.** §5 carries what A4 does not settle, and names who owes it.

---

## 1. What was missing, and what this closes

[SD §2] settled the factorisation before a single event type was named: every record asserting the
performance of an act carries an `outcome` from a five-member enum and, unless the outcome is
`COMPLETED`, at least one structured `reason`. Half of that shipped. `data/reasons.json` carried the
reason's **shape** — six fields, six rules, six scopes, two forbidden fields — with `codes: []` and a
loader that refused a non-empty list while the status was `owed`.

[catalog §5] item 1 states the cost in one line: "a catalog that publishes outcomes without reasons
is half a contract". This document publishes the other half.

**It is a vocabulary, not a design.** Nothing about the record changes: no field is added, none is
removed, no obligation moves. The six rules are the ones [SD §2.4] already stated, and the work here
was to satisfy them against the corpus rather than to revisit them.

---

## 2. What the corpus supplies, and what it does not

Seven sources carry reason vocabularies. They are not equal, and the inequality is the argument for
several of the decisions in §4.

| Source                                                                                                        | What it supplies                                                                                                                                                                                                                                             | Grade                                |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `src:shippeo`                                                                                                 | The factorisation itself, and the only published exception vocabulary organised as `(situation, justification)`. 38 data rows from **18** justification codes across **10** situation codes, plus four HHG-relevant exceptions its own published table omits | B — vendor, and the richest we hold  |
| `src:uncefact-rec24`                                                                                          | A neutral-body list: 22 distinct `Delivery_refused_*` codes, the `Waiting_for_*` cause family, and two explicit ignorance values (125 `No_status`, 265 `Reason_unknown`)                                                                                     | A — UN/CEFACT                        |
| `src:stedi-x12-reference` element **1651**                                                                    | 86 reason codes **organised by responsible party** — the sourced half of [SD §2.4] rule 6 — with `NS Normal Status` / `NA Normal Appointment` / `BG Other`                                                                                                   | A/B — licensed list, cited by number |
| `src:dp3-400ng`                                                                                               | Household-goods **regulation** with priced causes: Item 125.1's enumerated shuttle causes, Item 33's impractical operations, Item 17-1's attempted delivery, Item 226A's mandatory note                                                                      | A — regulation-grade, and HHG-native |
| `src:dtr-part-iv`                                                                                             | Free waiting time (2 h domestic / 1 h international) and "two documented contact attempts 6 h apart" before a shipment may go to storage                                                                                                                     | A — regulation-grade                 |
| `src:macropoint`                                                                                              | An independently-derived `outcome × reason` matrix: the thousands digit is the outcome, the last three digits the reason, reused verbatim across three outcomes                                                                                              | B — and the strongest corroboration  |
| `src:cfr-49-375`, `src:smdg-delay-codes`, `src:atlas-world-group-api`, `src:open-trip-model`, `src:sirva-ade` | Accessorial conditions determined before the bill of lading; 49 delay reasons with per-code definitions and a per-group catch-all; named SIT causes and a delay-claim responsibility field; a 10-value `result.reason`; the `Overflow` event                 | mixed                                |

**Two things no source supplies, and one it half-supplies.**

- **No source publishes a household-goods reason vocabulary.** The closest is `src:dp3-400ng`, and it
  is a tariff: it names causes only where money attaches, which its own analysis records as
  "C1=1: events exist only where money attaches". That turns out to be _enough_ for the `SITE` and
  `ADMINISTRATIVE` members — see §4.4 — because money attaches to precisely the site conditions a
  crew discovers at the door.
- **No source models an exception that forks the shipment.** `src:shippeo`'s analysis calls this "the
  deepest structural gap": in freight an exception is something to resolve; in household goods
  "destination not ready" opens storage in transit, with its own duration, charges and a later
  delivery-out leg. `PARTY_NOT_READY` is the reason; the remedy that opens the stay is owed to A5
  (§5).
- **`src:sirva-ade` — a van line's own contract — has no reason codes at all.** "`Cancel`, `Break`,
  `Reinstate`, `DeleteSIT`, `ExtendADP` all carry none", and its analysis draws the conclusion for
  this document: "our A4 model must add reason codes rather than inherit their absence."

---

## 3. The decision

> **Decision. The published reason vocabulary is 23 members, listed in `REASON_CODES` in
> `src/outcomes.ts` and tabulated per code in `data/reasons.json`. `OTHER` is not one of them: it is
> declared by the shape ([SD §2.4] rule 3). Every member is orthogonal to the outcome (rule 1) and
> grain-independent (rule 4), and every member declares its default scope, whether
> `attribution.party` must name a party, and whether it requires a remedy.**

23 is [SD §2.4] rule 2's **magnitude** — "~20 reasons × 5 outcomes, not ~100 types" — and the
document is explicit that this "is a magnitude, not a quota. It bounds what a sane vocabulary looks
like; it does not tell A4 how many codes to mint."

| Code                            | Default scope    | Party | Remedy      | Principal evidence                                                                                                               |
| ------------------------------- | ---------------- | ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GOODS_DAMAGED`                 | `GOODS`          | —     | —           | `src:shippeo` `LIV/RCA` and `REN/AVA`; `src:macropoint` `x014`; `src:open-trip-model` 5.7 `damage`; `src:cfr-49-375` §375.503(d) |
| `GOODS_MISSING`                 | `GOODS`          | —     | —           | `src:shippeo` `MQP`+`MQT` **collapsed** (§4.1); `src:stedi-x12-reference` 1651 `S1`; `src:uncefact-rec24` 283/285/330            |
| `GOODS_NOT_READY`               | `GOODS`          | —     | —           | `src:shippeo` `ENE/MQP`; `src:macropoint` `x025`; `src:uncefact-rec24` 190                                                       |
| `GOODS_LOST_OR_STOLEN`          | `GOODS`          | —     | —           | `src:macropoint` `x015`; `src:uncefact-rec24` 329 beside 330                                                                     |
| `OVERFLOW`                      | `RESOURCE`       | —     | —           | `src:sirva-ade` `Overflow`; `src:macropoint` `x028`; `src:stedi-x12-reference` 1651 `BQ`/`AV` (§4.2)                             |
| `PARTY_ABSENT`                  | `PARTY`          | ✔     | `newWindow` | `src:shippeo` `REN/DAF`; `src:dp3-400ng` Item 17-1; `src:dtr-part-iv` §D.5.b(2); `src:uncefact-rec24` 269/317/243                |
| `PARTY_REFUSED`                 | `PARTY`          | ✔     | —           | `src:shippeo` `NJU` vs `DIV`; `src:uncefact-rec24`'s 22 `Delivery_refused_*`; `src:stedi-x12-reference` 1651 `BS`                |
| `PARTY_RESCHEDULED`             | `PARTY`          | ✔     | `newWindow` | `src:shippeo` `REN/NRV` + required `new_slot`; `src:macropoint` `x023`/`x024`; `src:dp3-400ng` Item 17-1.3.a                     |
| `PARTY_NOT_READY`               | `PARTY`          | ✔     | —           | `src:macropoint` `x021`; `src:dtr-part-iv` A-406 §A.8.a; `src:dp3-400ng` Item 17-1.4; `src:uncefact-rec24` `Waiting_for_*`       |
| `INSTRUCTED_CHANGE`             | `PARTY`          | ✔     | —           | `src:shippeo` `REN/LNA`; `src:dp3-400ng` Items 28.3 and 28.4; `src:uncefact-rec24` 333 (§4.6)                                    |
| `ADDRESS_INCORRECT`             | `ADMINISTRATIVE` | —     | —           | `src:shippeo` `REN/DEM`; `src:uncefact-rec24` 234/274/213; `src:stedi-x12-reference` 1651 `A2`/`A6`                              |
| `PAYMENT_NOT_RECEIVED`          | `ADMINISTRATIVE` | —     | —           | `src:shippeo` `…RECEIVER_CANT_PAY`; `src:uncefact-rec24` 291/292/250; `src:stedi-x12-reference` 1651 `B4`/`C2`                   |
| `AUTHORISATION_MISSING`         | `ADMINISTRATIVE` | —     | —           | `src:dp3-400ng` Items 125, 17-1, 29; `src:dtr-part-iv` §D.5.b(2); `src:atlas-world-group-api` `nO_Prior_OPS_Approval`            |
| `DOCUMENT_MISSING_OR_INCORRECT` | `ADMINISTRATIVE` | —     | —           | `src:uncefact-rec24` 343/359; `src:stedi-x12-reference` 1651 `BC`/`OO`; `src:open-trip-model` 5.7 `invalidShippingLabel`         |
| `SITE_INACCESSIBLE`             | `SITE`           | —     | —           | `src:dp3-400ng` Item **125.1** (enumerated) and Item **33**; `src:shippeo` `…NO_ACCESS_TO_SITE` (§4.4)                           |
| `SITE_HANDLING_EXCESS`          | `SITE`           | —     | —           | `src:cfr-49-375` §375.401(f); `src:dp3-400ng` Item 33 — **[SYNTHESIS]** (§4.4)                                                   |
| `SITE_ACCESS_RESTRICTED`        | `SITE`           | —     | —           | `src:shippeo` `REN/FCO`/`REN/FHB`, re-labelled on its own analysis's instruction; `src:uncefact-rec24` 186/317/211/352-354       |
| `RESOURCE_UNAVAILABLE`          | `RESOURCE`       | —     | —           | `src:stedi-x12-reference` 1651 `T1`-`T6`/`D2`/`P4`; `src:uncefact-rec24` 191-195                                                 |
| `RESOURCE_FAILURE`              | `RESOURCE`       | —     | —           | `src:stedi-x12-reference` 1651 `AI`; `src:shippeo` `…RESOURCE_INCIDENT`                                                          |
| `LATE_ARRIVAL`                  | `ACT`            | —     | —           | `src:shippeo` `TAR` under two situations; `src:macropoint` `x029`; `src:smdg-delay-codes` entire; `src:atlas-world-group-api`    |
| `FORCE_MAJEURE`                 | `ACT`            | —     | —           | `src:dp3-400ng` Item 33; `src:macropoint` `x026`; `src:smdg-delay-codes` group 4; `src:stedi-x12-reference` 1651 `AO`/`BE`/`AF`  |
| `OUT_OF_SEQUENCE`               | `ACT`            | —     | —           | **[ORIGINAL]**; needed by [SD §4.7.2e] item 3 (§4.3)                                                                             |
| `CAUSE_UNKNOWN`                 | `ACT`            | —     | —           | `src:uncefact-rec24` 265 `Reason_unknown` beside 125 `No_status` (§4.5)                                                          |

**Rule 1, demonstrated rather than asserted.** `GOODS_DAMAGED` is `src:shippeo`'s `LIV/RCA`
(delivered, damage accepted → `COMPLETED_WITH_EXCEPTION`) **and** its `REN/AVA` (refused for damage →
`NOT_COMPLETED`). One code, two outcomes, no combinatorial explosion. `LATE_ARRIVAL` is `TAR` under
both `AEC` (`UNLOADING_POSTPONED`, a carrier-initiated postponement) and `REN`
(`ORDER_DELIVERY_REFUSED_LATE`, a customer's refusal). `SITE_INACCESSIBLE` reaches further than any
source cell: at `NOT_COMPLETED` it is "we could not get there", at `COMPLETED_WITH_EXCEPTION` it is
"we performed it with a shuttle, and it costs more" — the charge-bearing execution variant
`src:shippeo`'s grid has no cell for at all.

**Rule 4 costs nothing to hold.** No member names a grain. `GOODS_MISSING` on a shipment subject and
`GOODS_MISSING` whose `appliesTo` names an enumerated Portion of two items are the same code, which
is `src:shippeo`'s own discipline — it republishes 19 of the same pairs at handling-unit grain and
`HANDLING_UNIT_NOT_DELIVERED_ABSENT` _is_ `REN/DAF`.

**Rule 1's mechanical half.** `ReasonCodesAreOutcomeFree` in `src/outcomes.ts` applies
`OutcomeFreeTypeName` — the type-level check **A-TYPE** runs over the record vocabulary — to
`ReasonCode`, so a member naming an outcome stops the package compiling. `outcomeWordIn` in
`src/data.ts` is the same check at run time over the table. Both are partial, by construction, and
§4.3 is what a reader caught that neither could.

**The two places, held to one.** `REASON_CODES` in `src/outcomes.ts` carries the names and the
evidence; `data/reasons.json` carries the per-code discipline. `loadReasonVocabulary` compares them as
a **set** and fails on a difference in either direction, which is the same treatment `REASON_SCOPES`
already had. Two homes for one vocabulary is only safe when something holds them together.

---

## 4. What was collapsed, renamed and refused

### 4.1 `MQP` and `MQT` collapse into `GOODS_MISSING` — **[SYNTHESIS]**

`src:shippeo` publishes "partially missing package" and "entirely missing package" as two
justification codes. This vocabulary has one.

The reason is that the distinction is already carried, twice, on axes that exist for it: the outcome
axis separates `PARTIALLY_COMPLETED` from `NOT_COMPLETED`, and `reasons[].appliesTo` names the extent
exactly, which is [SD §3.4]'s required form for "delivered, two items short". Keeping two codes would
put magnitude on the reason axis _as well_, and a producer choosing between `MQP` and `MQT` would be
answering a question the outcome already answered — the failure mode [SD §2.5]'s own defect report is
about, where Shippeo's `…OrderNotLoadedPartiallyMissing` schema declares the _entirely_-missing event
name while the code pair stays correct.

Both codes are Shippeo's; the collapse is ours.

### 4.2 `OVERFLOW` is scoped `RESOURCE`, not `GOODS` — **[ORIGINAL]** in the placement

The code is sourced three ways: `src:sirva-ade`'s `Overflow` event, cited at [SD §3.2] as carrying
"the weight of the overflow portion — and nothing else"; `src:macropoint` `x028` "Delivery vehicle
capacity limitation"; and `src:stedi-x12-reference` element 1651 `BQ Shipment Overweight` with
`AV Exceeds Service Limitations`.

Its scope is a judgement. `Reason.scope` exists "so a consumer can separate 'something is wrong with
the goods' from 'something is wrong with the site'" ([SD §2.4]), and on an overflow nothing is wrong
with the goods: the customer's belongings are exactly what they are, and the remediable side is the
equipment. Scoping it `GOODS` would tell a consumer that a defect had been found in the shipment.

`src:macropoint`'s analysis asks for `x028` to be "split three ways (won't fit the van; van can't
reach the residence; second trip required)". This is the first. The second is `SITE_INACCESSIBLE`.
The third is not a reason at all — it is a Portion ([SD §3]), which is the point of having one
sub-shipment grain.

### 4.3 Rule 1 needed a reader, twice — and got one

`data.ts` states the limit of its own check: `outcomeWordIn` "catches a code containing an outcome
member's own name (`CANCELLED_BY_SHIPPER`). It does **not** catch [SD §2.4] rule 1's own example —
`DELIVERED_SHORT` / `REFUSED_SHORT` — because those encode the outcome in a _verb_… this is a partial
check, and rule 1 still needs a reader." Two candidates got past it.

- **`PARTIAL_LOAD`**, a placeholder in the partial-load scenario, names a **scope of performance**,
  which is what `PARTIALLY_COMPLETED` carries. It is rule 1's defect with the outcome word removed.
  The real reason for a load split over two days is _why_ only part went, and `src:dp3-400ng` Item
  17.9 supplies the tariff's own word: a Split Shipment is one "where overflow property is delivered
  … on different dates". Replaced by `OVERFLOW`.
- **`ALREADY_PERFORMED`**, a placeholder in the cancellation scenario, puts a completion verb in a
  closed enum. What it was reaching for is real and [SD §4.7.2e] item 3 needs it — "a cancellation is
  an act with an outcome, and a refused cancellation needs no new mechanism" — but the thing that is
  wrong is the request's **place in the sequence**, not this record's outcome. Renamed
  `OUT_OF_SEQUENCE`, and marked **[ORIGINAL]**: no source in the corpus publishes it.

Two of [SD §2.6]'s three worked literals fail the same reading, and the third fails a different rule:

| [SD §2.6] literal  | Published member | Why it could not be published as written                                                                                                           |
| ------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONSIGNEE_ABSENT` | `PARTY_ABSENT`   | **Rule 6**: "attribution is a structured field on the reason, **not baked into the code**". `CONSIGNEE_ABSENT` bakes the role into the code.       |
| `REFUSED_DAMAGE`   | `GOODS_DAMAGED`  | **Rule 1**, in a verb. The outcome axis carries whether the damaged goods were accepted or refused — `LIV/RCA` vs `REN/AVA`, the rule's own proof. |
| `SHORT`            | `GOODS_MISSING`  | Reads as a magnitude, which §4.1 puts on the outcome axis.                                                                                         |

The loader independently forbids a published code that is also an illustrative one — "the two lists
must not merge" — so all three would have had to be renamed in any case. They are retained in
`illustrativeOnly`, now with a `supersededBy` mapping, so [SD §2.6]'s scenario stays readable.
**[SD §2.6] itself carries a footnote recording the mapping**, because leaving a superior document's
worked example naming three codes the model refuses would be the kind of drift
`tests/conformance/documents.test.ts` exists to catch.

### 4.4 The authoring gap is narrower than [SD §2.4]'s examples suggested

[SD §2.4] says `Reason.scope` exists partly "because HHG's authoring gap is concentrated in `SITE` and
`ADMINISTRATIVE` — shuttle required, long carry, elevator unavailable, parking permit, COI not on
file — **none of which Shippeo has**". That sentence is exactly true, and it is about Shippeo.

It has been read more widely than it says. The reading that those members had to be invented does not
survive contact with the household-goods regulation in the corpus:

- **Shuttle required is regulation-grade and comes with an enumerated cause list.**
  `src:dp3-400ng` Item 125 defines shuttle service as "a truck-to-truck transfer where linehaul
  equipment cannot access origin or destination" and enumerates the valid causes: building structure,
  inaccessibility by highway, inadequate or unsafe road, overhead obstructions, narrow gates, sharp
  turns, trees and shrubbery, roadway deterioration due to rain, flood or snow, and the nature of an
  article. Item 33 **Impractical Operations** adds road and approach conditions creating unreasonable
  risk, inadequate loading or unloading facilities, and legal restrictions on linehaul equipment.
  `SITE_INACCESSIBLE` carries no marker.
- **Long carry and elevator are sourced as conditions, and the on-site reading is ours.**
  `src:cfr-49-375` §375.401(f) names "elevators, long carries" as accessorial charges and requires
  them to be determined **before** preparing the bill of lading, on pain of the carrier having to
  deliver and bill after 30 days. So the conditions are named and priced; reading them as a reason
  _discovered during execution_ is **[SYNTHESIS]**, and it is the case §375.401(f) penalises, which is
  the argument for recording it on the act rather than only as a charge.
- **Authorisation missing is the best-sourced `ADMINISTRATIVE` member there is**, and it is HHG-native
  three times over: `src:dp3-400ng` gates shuttle (Item 125), attempted delivery (Item 17-1) and SIT
  entry (Item 29) on prior approval; `src:dtr-part-iv` §D.5.b(2) states the request-approve-control-number
  sequence; `src:atlas-world-group-api` carries `nO_Prior_OPS_Approval` and `long_Cartage_Denied` as
  named causes on its SIT record.
- **COI not on file is an instance, not a member.** A certificate of insurance is a document a site
  requires, and `DOCUMENT_MISSING_OR_INCORRECT` is where it lands. Minting `COI_NOT_ON_FILE` would put
  one document's name in a closed enum and need **[ORIGINAL]** to do it.
- **Parking permit is genuinely [ORIGINAL]**, and is marked as such within `SITE_HANDLING_EXCESS`. No
  source in the corpus names it.

So of the five examples [SD §2.4] lists, **three are sourced**, one is an instance of a sourced code
and one is authored. The gap was real and it was in `src:shippeo`; it is not a gap in the corpus.

### 4.5 `CAUSE_UNKNOWN` beside `OTHER`, and the tension in it

`src:uncefact-rec24` publishes 265 `Reason_unknown` beside 125 `No_status`, and its analysis singles
the pair out: "a vocabulary that lets a publisher say 'I have nothing' and 'something happened and I
don't know why' is honest about the real world and keeps those cases out of free text."

The tension is worth stating rather than hiding. `data/reasons.json` says "a reason that attributes to
nobody at all is the `DIV` overload invariant 2 exists to remove", and a `CAUSE_UNKNOWN` attributed to
an unknown role class is close to that record. It is admitted anyway, for a reason [SD §0] makes
decisive: the alternative is a producer fabricating a narrative to satisfy `OTHER`'s mandatory
`remark`, and an invented explanation is worse than an honest absence. The two are not the same value —
`OTHER` means _there is a reason and this list has no code for it_; `CAUSE_UNKNOWN` means _there is no
reason to give yet_ — and publishing both is what keeps them apart.

`src:stedi-x12-reference`'s `NS Normal Status` and `NA Normal Appointment` were considered for the
same family and **refused**: they exist because the 214 makes a reason syntactically mandatory on every
status, and [SD §2.3] invariant 2 already does that job structurally by forbidding reasons at
`COMPLETED`. Its `BG Other` is `OTHER`. Its `BF Carrier Keying Error` and `D1 Carrier Dispatch Error`
are **not reasons at all** in this model: they are `Correction.errorReason`, and `INCORRECT_DATA` is
already published.

### 4.6 `INSTRUCTED_CHANGE` names the instruction, not the tariff category

`src:dp3-400ng` gives two priced forms of "a party asked us to do it somewhere else", and the tariff
is explicit that they are **not** one category. Item 28.4 **Diversion** is "either a change (1) while
enroute to the destination of the shipment outside of the BPC of the original destination, or (2) in
the route at the request of the Government" — and it is _not_ a diversion "if the change arrives
before the shipment moves", which is Item 28.3's authorised **stop-off** instead.

Which of the two a given instruction becomes depends on whether the shipment has moved and on
mileage arithmetic over the BPC. A reason code recorded at the moment of the instruction cannot know
either, so a code named `DIVERSION_REQUESTED` would name a tariff outcome the record is not entitled
to assert. `INSTRUCTED_CHANGE` names what the asserter actually observed; the classification belongs
to A7, and the inputs for it are on the record.

It is the **place-or-pattern** half of a pair whose **time** half is `PARTY_RESCHEDULED`. The boundary
is that clean, and it is `src:shippeo`'s: `REN/LNA` "deliver to new address" is kept apart from
`REN/DEM` "consignee changed address" — and `REN/DEM` is `ADDRESS_INCORRECT`, because it is, in its
analysis's words, "a data defect, not a customer request. Different owner, different remedy, different
billing."

---

## 5. What A4 does not settle

1. **`attribution.roleClass` is still owed to [A8 §9 item 2].** A4 does not name a role class, and the
   per-code discipline is deliberately a boolean — `partyRequired` — rather than a default role class,
   so that nothing here guesses a member of an enum that does not exist. `partyRequired` is true for
   every `PARTY`-scope member and no other.

   **A4 hands A8 one concrete requirement**: the role enum needs an explicit **non-party** member.
   `FORCE_MAJEURE` attributes to nobody by definition and `CAUSE_UNKNOWN` attributes to nobody yet,
   and [SD §2.4] makes `roleClass` mandatory. Without such a member those two codes cannot be recorded
   at all. [SD §2.6]'s worked example uses `unknown` for this, and three examples are not a vocabulary.

2. **Remedy shapes beyond `newWindow`.** [SD §2.4] rule 5's one sourced shape is `src:shippeo`'s
   `new_slot {start, end}`, required on its appointment events. A4 types it as `NewWindow` — spelled
   after [SD §2.6]'s `newWindow` rather than after Shippeo's wire name, because [SD] outranks the
   citation — and makes it required on `PARTY_ABSENT` and `PARTY_RESCHEDULED`. Every other shape stays
   `Owed`.

   The one that is missed is **the remedy that opens a storage-in-transit stay**, which is what
   `PARTY_NOT_READY` wants and what `src:shippeo`'s analysis calls the deepest structural gap. It is
   owed to **A5**, and it is not A4's to invent: SIT has its own duration, approvals, charges and
   delivery-out leg, and a remedy shape minted here would prejudge all four.

3. **The A4 area comparison.** This document settles the vocabulary. The eight-criteria scoring of
   A4's execution-event and tracking model — the arrive/depart grain, the ETA model, the telemetry
   boundary, the transition graph — is not attempted here. [`../rubric.md`](../rubric.md) should read
   A4 as "modeled in detail" for the vocabulary only.

4. **The fact classes the corpus names and the vocabulary does not.** [SD §4.7.3] carries them, and
   two are A4-adjacent: `weighing` and `eta`. A reason vocabulary does not need them — `LATE_ARRIVAL`
   is a reason and an ETA is a fact — but `OVERFLOW`'s natural companion ("weight exceeds estimate,
   reweigh required") is a `weighing` fact that has no type to carry it. Recorded, not resolved.

---

## 6. Acceptance

### 6.1 Every phenomenon [SD §3] names has a `Portion.basis`

[SD §3.1] makes `basis` mandatory — "the reason code that caused this subset to exist" — and [SD §3]
opens by naming the phenomena that are one phenomenon. A vocabulary that could not name each of their
causes would leave a mandatory field unfillable.

| Phenomenon ([SD §3])                                           | `Portion.basis`                                           |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Partial load                                                   | `OVERFLOW`, or `INSTRUCTED_CHANGE` if requested           |
| Split delivery                                                 | `PARTY_RESCHEDULED` or `INSTRUCTED_CHANGE`                |
| Overflow                                                       | `OVERFLOW`                                                |
| SIT remainder                                                  | `PARTY_NOT_READY`                                         |
| Refused items                                                  | `PARTY_REFUSED`, or `GOODS_DAMAGED` if refused for damage |
| Short delivery                                                 | `GOODS_MISSING`                                           |
| Authorised stop-off / extra pickup (`src:dp3-400ng` Item 28.3) | `INSTRUCTED_CHANGE` (§4.6)                                |

### 6.2 The scenarios that exercise it

- **Scenario 3** — delivery attempted twice, absent then refused for damage, two items short. Three
  members, two acts, one fact key: `PARTY_ABSENT` with a typed `newWindow`, then `GOODS_DAMAGED` and
  `GOODS_MISSING` on one `PARTIALLY_COMPLETED` delivery, each scoped by an enumerated Portion.
- **Scenario 6** — cancelled after packing. The refused cancellation carries `OUT_OF_SEQUENCE`.
- **Scenario 9** — a partial load under one bill of lading. `OVERFLOW` on both the Portions and the
  `PARTIALLY_COMPLETED` loading act.

### 6.3 The gates

`loadReasonVocabulary` refuses: an owed vocabulary carrying codes; a published one with none; a set
that differs from `REASON_CODES` in **either** direction; a code named `OTHER`; a code containing an
outcome member's name; and a code that requires a remedy without naming its shape. Each is tamper-proved
in `tests/conformance/data-tables.test.ts` — a gate nobody has watched fail is a gate nobody knows is
live.

---

## 7. What this does to the published catalog

A new reason code is `newClosedEnumMember` under [catalog §2.3], which names "a reason code" outright.
**The first publication of the list is not that change**, and the difference is worth naming rather
than absorbing.

Before A4, `ReasonCode` was an owed code and the emitted schemas published it as
`{"type": "string", "x-owed-vocabulary": "reasonCode"}` — any string validated. After A4 it is a closed
enum. On the **queried** face that is a narrowing a consumer can only benefit from; on the **captured**
face it is a **restriction**: a producer sending an unrecognised code was valid and is now rejected.

[catalog §2.3] classifies neither, so A4 adds `publishedOwedVocabulary` to `ADDITIVE_CHANGES`, and the
argument for putting it there rather than among the breaking changes is that the owed marker was itself
published. `x-owed` said, on the wire, "the code list is owed; the shape is published and the members
are not" — so no conforming producer could have relied on any particular code being accepted, and no
existing member's meaning moves, which is the property [SD §1.2]'s "never to reinterpretation" protects.
The restriction is real and is recorded with the class rather than left for a consumer to discover.

`CATALOG_VERSION` goes to **`0.2.0`**. It stays pre-1.0 for the reason [catalog §2.4] gives: 19 of 31
authority rows are still owed, and that — not this — is what caps the contract.

---

## 8. Confidence

| Decision                                       | Confidence      | What would move it                                                                                                                               |
| ---------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The 23 members as a set                        | **Medium-high** | An HHG-native reason vocabulary from an external publisher. None exists in the corpus; `src:sirva-ade` is a van line's own contract and has none |
| §4.1 `MQP`/`MQT` collapsed                     | **High**        | A case where the outcome axis cannot carry the magnitude. [SD §3.4] is the argument it can                                                       |
| §4.4 The `SITE` members are sourced            | **High**        | Nothing short of Item 125.1 not saying what it says                                                                                              |
| §4.2 `OVERFLOW` scoped `RESOURCE`              | **Medium**      | A consumer that filters on scope and wants overflow under `GOODS`. The scope axis is **[ORIGINAL]** and its members are glossed, not defined     |
| §4.5 `CAUSE_UNKNOWN` published                 | **Medium**      | Evidence that producers use it to avoid recording a reason they know. That is a capture-rule question ([SD §5]), not a vocabulary one            |
| §4.6 `INSTRUCTED_CHANGE` over the tariff split | **Medium-high** | A7 deciding it needs the distinction at capture time rather than deriving it                                                                     |
| §5.1 `roleClass` left owed                     | **High**        | [A8 §9 item 2] landing                                                                                                                           |
| §7 `publishedOwedVocabulary` as additive       | **Medium**      | A real consumer broken by the narrowing on the captured face. Survivable at `0.2.0` either way                                                   |
