# A7 — Charges & billing hooks

Cited elsewhere as **[A7 §x]**.

> **Status.** A decision document and the area comparison for A7. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope.** A7 owns the **charge**: what the `charge` aggregate is a subject of, where a charge
> event stops and a rate computation starts, and what the model may say about billing and payment.
> It is **not** the rate structure, the item-code catalogue or the tariff, which are A12's and are
> context-map-only by design; it is **not** revenue allocation between agents, which
> [A8 §9 item 7] has already fenced off to A13; it is **not** the claim or the valuation regime,
> which is A11's; and it is **not** the estimate's _quantity_, which is A10's and is
> [SD §4.7.3]-absent.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged, plus one this area needs stated.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is.
   **A7's trap is the widest in the corpus, and the resumption plan states it one source too
   wide.** Five of our own systems publish a charge model and every one of them is `mapping-only`:
   `src:pegasus-cloud-domain` (quote → line items → invoice → payments → balance),
   `src:pegasus-cloud-prisma` (persisted, per-row currency, six timestamps),
   `src:pegasus-integration-floors` (a `financial_settlement` floor with typed `LineItems` and
   `Totals{Credit,Debit,Net}`), `src:pegii-order` (`Survey.CoreCost` plus six add-on components)
   and `src:pegii-longhaul` (`total_estimated_linehaul_usd` / `total_actual_linehaul_usd`). None is
   in §2, and the omission is deliberate: our own quote → invoice → payment chain is the
   best-modelled piece of our stack, and §3.3's refusal would have been the easiest in the corpus
   to lose by reading one of them first. **The plan's sixth entry is not a sixth system.**
   `src:sirva-ade` is `role: model-evidence` — _"external partner contract: how a counterparty
   behaves"_ — and its `areas:` list names A7. What the plan points at is the **S5 fit row inside**
   that source's analysis, which describes our own `financial_settlement` floor; the row is ours,
   the source is not. `src:sirva-ade` is cited freely below and is one of A7's strongest sources.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** §6 carries what A7 does not settle and names who owes it.
4. **Primary where we have it, and said so where we do not.** **A7 is not the one-primary-source
   area the plan predicts.** Of the sources that score 2 or better on A7, **five** have a
   `captured/` directory: `src:cfr-49-375`, `src:milmove-mymove`, `src:milmove-docs`,
   `src:atlas-world-group-api` and `src:x12-212-trailer-manifest`. Every quotation from
   `src:dp3-400ng`, `src:dp3-tender-of-service`, `src:alvys-api`, `src:smartmoving-api`,
   `src:sirva-ade`, `src:nmfta-ebol`, `src:stedi-x12-reference`, `src:uncefact-scrdm`,
   `src:uncefact-mmt-rdm`, `src:weichert-supplier-api` and `src:dtr-part-iv` is **secondary** — it
   is the source analysis's text, not the source's. §2 marks each. Where a decision rests on a
   quotation, §7 says whether the quotation is primary.

---

## 1. The question, stated sharply

Nine things are owed to this area by name. Every one is a sentence in a binding document, a live
marker in `packages/domain-reference/src/`, a hand-off from a landed area, or the rubric's own row,
that says A7 decides it.

| #   | Owed item                                                                                                                                                    | Owed by                                                                            | Settled at |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------- |
| 1   | **Whether the acts performed _on_ a charge have records** — the A2 check, pointed at A7, and the rubric's _"charge events, invoice issued/paid"_             | [A2 §3.6]'s instruction to A6, A7 and A9; [`../rubric.md`](../rubric.md)           | §3.2       |
| 2   | **Charge and invoice state.** Every publisher has one; no two agree, and they do not agree on the _grain_ either                                             | §2, and `src:dp3-400ng`'s own recorded limit                                       | §3.3       |
| 3   | **Line-haul vs accessorials** — the rubric's first clause, with _"detail of rating out of scope"_ beside it                                                  | [`../rubric.md`](../rubric.md), the A7 row; [A3 §Cross-area]                       | §3.4       |
| 4   | **Whether a billable-weight cap is a `charge` at `aspect = DECIDED` or a fourth thing**                                                                      | [A2 §Cross-area] (a); [A2 §3.6]                                                    | §3.5       |
| 5   | **Whether row 11's `PRINCIPAL` binding reaches a _pre-commitment_ proposal** — one made before any order exists to hold it                                   | [A1 §Cross-area]; [A1 §3.6] item 1                                                 | §3.6       |
| 6   | **§375.519(d)'s collection rule, and the (document kind, fact class) pair D-CITE leaves behind**                                                             | [A6 §Cross-area] to [A7]; [A6 §6]; `tests/scenarios/reweighed-in-transit-…test.ts` | §3.7       |
| 7   | **Whether [SD §6.3]'s offsetting-record door is wide enough** for the refunds, reimbursements and re-bills the corpus names                                  | [SD §6.3]; `src:dp3-400ng` Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c                  | §3.8       |
| 8   | **The tariff classification `INSTRUCTED_CHANGE` declines to make**, live in a published docstring and in `data/reasons.json`                                 | [A4 §4.6]; [A4 §5]'s confidence row; `src/outcomes.ts`'s `INSTRUCTED_CHANGE`       | §3.9       |
| 9   | **The whole of A5's charge surface**, and [SD §8.4]'s pack-only-day question, which is _"cheap to reverse before A5 and A7 are written and expensive after"_ | [A5 §Cross-area] to [A7]; [SD §8.4]'s confidence row                               | §3.10      |

### The first finding: two of the nine were discharged before A7 opened them, and one of them by [SD] itself

This is now a **four-round pattern** — [A4]'s blind owed ledger, [A2]'s already-applied
"seventeen-item backlog", [A6]'s owed item 6, and these. **Audit what a plan says is owed against
the code and the binding text, not against the plan.**

**Owed item 4 was answered by [SD §4.4] before [A2] asked it, and [SD §4.1] names the answer.**
[A2 §3.6] argues that `src:milmove-mymove`'s `billableWeightCap` is not a weight because [SD §4.2]'s
basis enum has no member for it, and concludes it must therefore be a `charge`. Both halves of that
are checkable against binding text that [A2] did not read against its own question, and the text
disagrees with the conclusion:

- **[SD §4.1]'s `measure` family row quotes element 187 with `B` billed among its kinds, beside
  `G`, `N` and `T`.** The row's "contest is real because" column reads, in full,
  _"`src:x12-212-trailer-manifest` element 187: a weight is always typed — `G` gross, `N` actual
  net, `T` tare, `E` estimated net, **`B` billed**, `L` legal, and `RG`/`RN`/`RT` reweigh
  variants."_ That is an argument column rather than the family's Examples column, so it does not by
  itself declare `B` a member — what it does is put `B` on the **same axis** as `G`, `N` and `T`,
  in the same sentence, in binding text, citing the same element [A2 §Cross-area] (a) calls _"one
  concept at grade A three times over"_. The model maps that axis to **`type`**.
- **[SD §4.4]'s `R-WEIGHT-LOWER` is sourced by a _billing_ rule.** Its three-row source table's
  middle row is `src:dp3-400ng` **Item 4.11.d — _"invoice on the lesser weight"_**. The shared layer
  adopted the tariff's invoicing rule as the resolution rule for `weight.net`, and
  `data/canonical-subjects.json` records the consequence: `weight.net`'s authority is
  `boundBy = NONE`, _"NO role is authoritative. Settled by the value rule R-WEIGHT-LOWER."_

§3.5 works through what that leaves, because it does not leave nothing.

**Owed item 5 is answered by [A8 §4.3]'s own definition of `PRINCIPAL`, not by row 11's summary.**
[A1 §Cross-area] asks whether row 11's `PRINCIPAL` binding _"may or may not reach"_ a proposal made
before any order exists. [A8 §4.3] defines `PRINCIPAL` as _"authority belongs to the party the
arrangement is **for**, and moves only when the principal changes."_ It resolves against a **party
and an arrangement**, and names no record — which is exactly what distinguishes it from `CUSTODY`
(resolved against `handover` assertions) and `ASSIGNMENT` (resolved against an assignment). §3.6
gives the argument and the corpus evidence that the roles exist pre-commitment.

### The second finding: the plan names four inbound hand-offs and there are eight

Four more are live, and two of them are in code rather than in prose:

- **[A3 §Cross-area]** binds accessorials to _"the stop that caused them"_ (`src:alvys-api`'s
  `StopId`). §3.4.
- **[A4 §4.6]'s confidence row** makes `INSTRUCTED_CHANGE`'s medium-high rating conditional on
  _"A7 deciding it needs the distinction at capture time rather than deriving it"_, and the
  deferral is **published**: `src/outcomes.ts`'s `INSTRUCTED_CHANGE` docstring and
  `data/reasons.json`'s matching citation both say the code _"names the instruction and leaves the
  classification to A7."_ §3.9.
- **[SD §8.4]'s confidence row** says the pack-only-day-is-a-Trip decision is _"still cheap to
  reverse **before A5 and A7 are written** and expensive after."_ A5 is written. **A7 is the last
  cheap moment**, and §3.10 takes it.
- **`tests/scenarios/reweighed-in-transit-at-the-shippers-request.test.ts`** carries, inside a
  passing [A6] assertion, the sentence _"§375.519(d) makes true copies of ALL the tickets a
  precondition of COLLECTING a weight-dependent charge, which [A6 §6] hands to A7."_ [A6 §7]'s own
  advice — _"an `OWED` label or a test title naming your own area is a to-do item in the test
  suite"_ — applies to a comment as well as to a title. §3.7.

### The third finding: A7 inherits more than the plan credits, and none of it needs a new mechanism

The plan describes A7 as inheriting _"a type with no family and no value"_. Two of those three are
right and the omission matters:

- **`charge`'s authority row is _not_ owed.** It is `assigned`, `boundBy = PRINCIPAL`, [A8 §5]
  row 11, two-sided across three fact keys. A7 is the first area since A4 whose subject arrives
  with its authority settled, and that is why §3.2's gap is somewhere else entirely.
- **`charge`'s `context[]` already carries every scoping the four plan-named hand-offs need.**
  `data/canonical-subjects.json` gives it six members — `shipment`, `portion`, `order`,
  `stopAction`, `stop`, `stay`. [A1]'s order-scoped proposal, [A2]'s portion-scoped storage
  minimum, [A3]'s stop-caused accessorial and [A5]'s whole storage surface are all already
  expressible. **No inbound hand-off needs a new mechanism**, and [A5 §Cross-area] said so about
  its own.
- **`charge`'s fact-class family _is_ owed** — `FACT_CLASS_FAMILY` has no row for it, because
  [SD §4.1]'s family table has none. And **`chargeValue` is owed**, to A11. §3.11 and §6 are about
  the second of those, which is owed to the wrong area.

### What is already fixed above A7, and is quoted rather than re-derived

- **The three aspects.** [SD §4.7.2b]: `charge` declares `qualifier` `{aspect}` ∈ `PROPOSED` |
  `DECIDED` | `RATED`, because otherwise the derived fact key _"would put a **proposal**, an
  **approval** and a **price** into **one** contest, where an approval would compete with an
  amount."_ Three fact keys, not one.
- **Their three authorities.** [A8 §5] row 11: propose = the performing role; decide = the
  `accountParty`; rate = the tariff owner. `SettlingAgent` and `SetoffAgent` corroborate.
- **The correction regime.** [SD §6.3]: _"Operational facts are corrected by supersede/retract.
  Financial facts are corrected only by an offsetting record, never by retraction — and an
  `INEFFECTIVE` correction never reaches the priced record at all."_ It is held **in the type**:
  `CorrectableType = Exclude<AssertionType, FinancialFactClass>` with
  `FINANCIAL_FACT_CLASSES = ['charge']`, and the refusal is already gated and tampered at
  `tests/conformance/authority-custody-corrections-refuses.ts`. **A7 does not reopen it** and does
  not need to add a gate for it; §3.8 measures the door rather than rehanging it.
- **Revenue allocation is A13's.** [A8 §9 item 7]: `src:sirva-ade`'s `TransRevenue` _"distributed
  according to allocation rules to Origin Agent, Hauler, Destination Agent, SIRVA"_ and
  `src:atlas-world-group-api`'s `AgentRole`/`AgentGroup`/`DistributionMethod` are _"A13's, and §5
  row 11 must not be read as settling it."_ **The data table already draws that line and nobody
  said so**: `charge`'s `context[]` has no `trip` member, so the cost side `src:alvys-api` puts on
  the trip — `Carrier.Rate`, `Carrier.TotalPayable`, `TripValue`, `Driver1.RatesV2[]` — has no home
  here. Recorded as a corroboration, not as a decision: A7 neither widens the list nor argues it
  should stay as it is.

### The structural fact this document keeps running into

**The corpus is richest exactly where A7 is forbidden to model, and thinnest exactly where the
rubric asks A7 to deliver.** Every source that scores 3 on C1 for A7 scores it on _rating_ —
`src:dp3-400ng`'s complete linehaul formula, `src:uncefact-scrdm`'s full settlement package,
`src:atlas-world-group-api`'s ~230 `ServiceName` values. A12 is context-map-only by design, so all
of it is out of scope. Meanwhile the rubric's second clause — _"invoice issued/paid"_ — is the one
thing the corpus cannot agree on at any grain (§3.3), and its first clause — _"line-haul vs
accessorials"_ — decomposes on at least three facets that no publisher separates (§3.4).

That asymmetry is not a reason to write less. It is the reason A7's honest output is two refusals,
one already-discharged hand-off, one rule generalised from [A6], and a gap named precisely enough
that whoever closes it knows what they are buying.

### Why getting this wrong is expensive

Because money is where a wrong model becomes a wrong invoice. [SD §6.3] exists because
`src:sirva-ade` publishes a **testable** invariant — a `CAN` _"combined with the 'Original' amounts
will **zero out** the shipment"_ — and an offsetting regime that cannot express one of the corpus's
four named money corrections produces a ledger that does not balance. And because a charge-state
enum, once published, is a fact-key-adjacent promise: [catalog §2.3] makes changing a qualifier
shape **breaking, a new major**. Publishing the wrong one of eleven disagreeing state vocabularies
would cost every consumer a re-validation to undo.

---

## 2. The positions in the external corpus

Fifteen sources say something about A7. Each heading gives the grade, whether we hold a capture, and
the source's own A7 score row `C1/C2/C3/C4/C5/C6/C7/C8`.

### 2.1 "Line-haul, accessorial, advanced, impracticable and valuation are five different things" — `src:cfr-49-375` (grade A, **primary**, `3/3/3/3/2/1/3/1`)

The one source A7 holds as primary text and reads end to end, and the only regulation in the set.
Its Appendix A Definitions list gives the charge taxonomy five names, each defined:

- **Line-Haul Charges** — _"the charges for the transportation portion of your move"_ (xml:651).
- **Accessorial (Additional) Services** — packing, unpacking, appliance servicing, piano carrying,
  _"requested or necessitated by landlord requirements or special circumstances"_ (xml:626).
- **Advanced Charges** — _"charges for services performed by a third party at the shipper's request;
  **the mover pays and adds them to the bill of lading**"_ (xml:627).
- **Impracticable Operations** — conditions making pickup or delivery physically impossible with
  normally assigned road-haul equipment, **defined in the carrier's tariff**, chargeable **even if
  not requested**, capped at 15% of all other charges due at delivery (xml:649; §375.703,
  §375.407(d)).
- **Valuation charge** — the charge for the liability level, which §375.709 singles out as the one
  charge a carrier may still collect on a total loss.

Its C3 = 3 is for arithmetic invariants, and they are the sharpest in the corpus: 100% of a binding
estimate / 110% of a non-binding one as the lawful maximum for relinquishing possession
(§375.407(a), §375.703(b)); impracticable operations ≤ 15% of all other charges due at delivery
(§375.407(d)); partial delivery **prorated by delivered weight over total weight**
(§375.403(a)(11)); **constructive weight** as the basis for apportioning charges on a partially lost
or destroyed shipment (§375.707(b)); total loss in transit ⇒ the carrier is **forbidden** to collect
any freight charges including accessorial and terminal charges, except a specific valuation charge
(§375.709); the invoice within 15 days of delivery excluding Saturdays, Sundays and Federal holidays
(§375.807(a)); and the credit ladder — 7 days including weekends → automatic extension to 30
calendar days → 1% service charge, $20 minimum, per 30-day extension → credit denied
(§375.807(b)-(c)).

Two of its rules are collection preconditions and are §3.7's spine. §375.519(d): true copies of all
weight tickets must accompany the freight bill _"in order to collect any shipment charges dependent
upon the weight transported."_ §375.401(f): accessorial charges such as elevators and long carries
must be determined **before preparing the bill of lading**, and if the carrier fails to ask, it must
deliver and bill **after 30 days**.

And one thing it does **not** have, which matters for §3.3: it publishes no invoice state at all.
Its lifecycle after delivery is a **credit** ladder, about the shipper's payment terms, not about
the invoice's condition.

### 2.2 "A payment request has six states and a supersession mechanism" — `src:milmove-mymove` (grade A, **primary**, `3/3/3/3/2/3/3/2`)

The richest charge _lifecycle_ in the corpus, and the only one held as source code.

`PaymentRequest`: `PENDING` → `REVIEWED` or `REVIEWED_AND_ALL_SERVICE_ITEMS_REJECTED` →
`SENT_TO_GEX` → `TPPS_RECEIVED` → `PAID`, with `EDI_ERROR` and `DEPRECATED` as off-ramps
(`pkg/models/payment_request.go:20-37`), each state carrying its own timestamp column. Corrections
are **supersession, not edit**: `recalculation_of_payment_request_id` points a new request at the
one it replaces and the replaced one goes `DEPRECATED`.

Three further contributions:

- **`MTOServiceItem` is the atom of billable work**, and nothing is billable unless a matching
  service item was created **and approved** — `SUBMITTED` → `APPROVED` | `REJECTED`, with
  `approvedAt`/`rejectedAt` and a mandatory `rejectionReason`. [A8 §5] row 11 already cites this as
  the propose/decide split's evidence.
- **`PaymentServiceItemParam.origin` ∈ `PRIME` | `SYSTEM` | `PRICER` | `PAYMENT_REQUEST`** —
  per-field provenance on every one of 70 named pricing inputs, _"i.e. who asserted this number"_.
  [SD §4.7.2b] already cites it.
- **Five weight concepts on one shipment**: `primeEstimatedWeight`, `primeActualWeight`,
  `ntsRecordedWeight`, **`billableWeightCap` with a justification field**, and
  `calculatedBillableWeight` — with `billable_weights_reviewed_at` on the `Move`. §3.5.

Its `ShipmentAddressUpdate` is auto-approved **unless it crosses a pricing boundary** — service
area, mileage bracket, more than 50 miles, or a **shorthaul/linehaul flip**. That is the corpus's
one published statement that the line-haul boundary is a rate-table boundary rather than a service
category, and §3.4 uses it.

### 2.3 "An invoicing walk with validation gates and two End branches" — `src:milmove-docs` (grade A, **primary**, `2/2/3/2/1/2/2/1`)

Its C3 = 3 is for `ghc-invoicing.md`'s actor-by-actor walk: the gates each actor applies, the two
terminal branches, and two rules stated as rules — **no double billing** and **no overlapping
request**. The second is the one worth keeping: `DOASIT`'s `SITPaymentRequestStart`/`End` _"must not
overlap previously requested SIT dates"_, which is a constraint between two charge assertions about
one stay rather than a constraint on either. C1 is held at 2 because rating is gated.

### 2.4 "Three untyped status fields for one question" — `src:atlas-world-group-api` (grade A, **primary**, `3/2/1/3/2/3/2/1`)

The richest van-line API we hold, and the clearest demonstration of §3.3's problem. Its C1 = 3 is
real: `ord_est_linehaul` / `ord_est_accessorial` / `ord_est_totalcharges` / `ord_max_charges` on the
order, an estimated-versus-billed ledger (`AuditorInformation`), per-stop third-party
`AdvancedCharge` with a vendor and `advchrgs_payvend`, `AgentBilled`, `LogisticsCharge`,
`InvoiceData` and `PayAuthorization`. `IRatingLineItem` separates gross, net, discount amount and
discount percentage, each described.

Its C3 = 1 is the finding: **`ivhInvoiceStatus`, `ord_invoicestatus` and `pyd_status` are all
untyped.** A grade-A partner contract with three status fields covering the invoice question and no
vocabulary for any of them. `ivhCreditMemo` is _"the one reversal mechanism"_.

### 2.5 "Element 187 types every weight, and `B` is one of the types" — `src:x12-212-trailer-manifest` (grade A, **primary**, A7 score `0`)

Scored **0** on A7 — the 212 carries no charges — and it is load-bearing anyway, because [SD §4.1]
and [SD §4.4] both rest on its element 187 and §3.5 turns on what that element says. Its A7 row
records, for the 215 rather than the 212, `SMD-02` Shipment Method of Payment (element 146, 28
codes), `MS5` Shipment Rates and Charges, **`ACS` Ancillary Charges at both shipment and carton
grain**, `CGS` Charge and `TXI` Tax Information.

### 2.6 "Linehaul times a discount, and fifty item codes with an escape hatch" — `src:dp3-400ng` (grade B, secondary, `3/3/2/3/2/2/2/2`)

The tariff, and the source A7 must read carefully and cite narrowly, because A12 is out of scope.
The _structure_ is what A7 takes:

`LHS = [BLHS + OLF + DLF + SH] × (1.00 − dLHS)`, with the TSP filing `dLHS` and `dSIT` **per
channel**, and non-linehaul items priced per CWT off a Geographical Schedule subject to one discount
or the other **depending on the item**. So the linehaul/non-linehaul split is not a label here: it
selects which of two filed discounts applies. A charge's category changes its price.

- **Pre-approval is a first-class billing precondition** — Items 105, 120, 125, 58, 210D/210E, and
  210A-C when delivery out of SIT exceeds 100 miles. Item 35.1: third-party charges require **paid
  original receipts and prior PPSO pre-approval, one reimbursement per receipt**.
- **226A Miscellaneous** — _"any authorized charge incurred by the TSP that does not have a
  designated service code… TSP must submit a detailed note with a description of the service
  provided."_ A documented open class with a **mandatory** narrative. [SD §2.4] rule 3 already cites
  it for the reason vocabulary.
- **Refunds, reimbursements and re-bills are additional coded transactions carrying a narrative
  note, never edits** — Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c. [SD §6.3]'s second source.
- **Invoicing sequencing gates.** Item 4.11.c: for direct delivery the TSP _"cannot invoice for any
  services until reweigh has been performed and DPS reweigh information updated"_; Item 4.12.b adds
  that reweigh tickets must reach the **origin** PPSO before destination invoicing.
- **The 1,000-lb minimum applies to the _combined_ weight of separately-rated portions**
  (Item 17.9.b.2); portions under 1,000 lb are billed at actual net weight under 226A
  (Items 17.9.c, 210.2.c.2). §3.5.
- **The rating addresses are frozen at award and are not the operational addresses** — _"block 19
  of the BL (requested pickup) and/or block 18 (requested delivery) at the time the shipment is
  offered and accepted"_, repeated verbatim in eight items, with _"charges will not be based on the
  actual storage location"_ (Item 210.1) beside it.

And its own A7 score row records the limit §3.3 rests on: **C3 = 2 _"because charge state (billed /
disputed / denied / re-billed / refunded) is referenced but never enumerated."_**

### 2.7 "The notification is the precondition of getting paid" — `src:dp3-tender-of-service` (grade A for the HHG tender, secondary, `2/2/2/2/2/1/3/0`)

Charge _events_ rather than rating, and its C7 = 3 is for a pattern no other source has.

- **§C.3.h**: _"If PPSO determines the TSP did not provide at least 24 hour notice to the customer
  before placing shipment in SIT, PPSO will **deny the SIT and delivery out charges**."_ The source
  analysis states the consequence in one line: _"The notification is not advisory; it is the
  precondition of getting paid for the storage."_
- **§C.12.a-b**: the full document set to the PPSO no later than 7 GBD after pickup — weighted BL,
  weight tickets, DD 619, inventories, third-party invoices. An invoicing precondition expressed as
  a document **set**.
- **§B.8.a(2)(c)-(d)**: a reweigh can only move the price one way, and if the shipment is already
  invoiced the TSP submits a **supplemental invoice refunding the difference**.
- **DD 619** as customer-signed billing evidence for accessorials, and **pre-approval of every
  accessorial in DPS before performance** (§B.12.c, §D.2.g).
- **Attempted pickup and attempted delivery are priced events** (NTS §5.9): attempted pickup pays
  drayage on a 500-lb minimum; attempted delivery requires the crew to **wait one hour** before
  returning the shipment to the warehouse, then pays drayage plus handling-out on actual weight.
- **Attribution and set-off on the ordering document** (NTS §5.8.2): when a line-haul carrier fails
  to collect a lot, the DD 1164 is amended to name that failure as the cause of the additional cost,
  and the PPSO **sets off against that carrier on its own BL**. Cause, cost and counterparty in one
  record — and the set-off lands on a different party's charge. §3.8.

### 2.8 "The split is structure, and a correction is a new record" — `src:alvys-api` (grade B, secondary, `3/3/2/0/2/3/3/2`)

C4 = 0 — zero HHG — and it is still the source that states A7's shape decision most clearly.

The linehaul-versus-accessorial split is **structural, not a code list**: `Linehaul`,
`FuelSurcharge`, `CustomerAccessorials` and `CustomerRate` are separate fields on the load.
`CustomerAccessorialsDetails[]` carries `Type`, `Rate`, `RateType` (`Flat`/`PerHour`/`PerMile`),
`Uom` (`Hour`/`Mile`/`Stop`), `Quantity`, `IsPaid` and **`StopId`** — accessorials scoped to the
stop that caused them.

Its money rules are published as rules:

- _"**A correction is a new record, not a retry** — give it a new key"_, with the failure it exists
  to prevent named: _"Sending it again without a key is how a single detention charge becomes two."_
- _"Moving money to a different parent is a delete and a create, not an edit"_, and **"an
  accessorial or credit cannot move to a different load, trip, stop, or accessorial type."**
- `409 Conflict` on an update means _"The record cannot be changed at all — money already settled.
  Do not retry. **Post a correction instead.**"_

Invoices are typed — `LoadInvoice` / `OrderInvoice` / `SummaryInvoice` / `StandaloneInvoice` — with
`Draft` / `AwaitingPayment` / `Paid`, `InvoicedDate` / `DueDate` / `PaidDate`, `RemainingBalance`,
`OverPaymentAmount` and `SupplementalInvoiceType`. And its own analysis records the trap §3.3 turns
on: the 16-value load ladder **fuses operational with financial state** (`In Transit` beside
`Financed`), and _"our A1 should keep those axes separate — a load that is `Delivered` and a load
that is `Paid` differ in which lifecycle moved."_

### 2.9 "Thirteen charge categories in a mover's terms, and no invoice lifecycle" — `src:smartmoving-api` (grade A on vocabulary, secondary, `3/2/1/3/1/2/3/2`)

The only C4 = 3 in the area. Thirteen `JobChargeCategory` values give the split **in a mover's
terms**: `Transportation` beside `TripAndTravel`, `FuelSurcharge`, `ShuttleFees`, `Valuation`,
`BulkyItem`, `StorageInTransit` and `CrewSkills`. `ChargeType` carries the **rating method**
(`PerItemCwt`, `MileageTable`, `ZoneRated`, `DistanceRate`, `PackingByCuFt`).

Its C7 = 3 is for provenance: `ActualJobChargeViewModel.estimatedJobChargeId` links each realised
charge to the **estimate line it came from**, and every payment that reverses another names it
(`refundsJobPaymentId`, `isRefund`, `amountRefunded`) with a `PaymentSource` and a `takenByUserId`.

Its C3 = 1 is the finding: **no invoice lifecycle at all** — only `isOutstanding` and `paidAtUtc`,
with `PaymentCategory` = `Deposit` | `BalanceDue` | `Other`.

### 2.10 "The best correction semantics in the corpus, and a billing flag instead of a state" — `src:sirva-ade` (grade A, secondary, `3/2/2/3/2/3/3/1`)

A live partner contract, `role: model-evidence`, and §0 rule 1 is about why the plan mislabels it.

C7 = 3 for `AdjCode` — blank Original / `ADJ` adjustment / `CAN` cancel — with the **stated,
testable invariant** that a `CAN` _"combined with the 'Original' amounts will zero out the
shipment"_, and `BatchNbr` distinguishing reruns from genuine second adjustments. [SD §6.3]'s first
source, and `OffsettingRecord`'s shape comes from it.

Its charge structure: `CHARGES[]` with `Service` / `Qualifier` / a `Location` segment /
`GrossChargeAmt` / `NetChargeAmt` / `DiscountPer`, plus `SvcQuantity[] {Quantity, UnitOfMeasure}`
and `SvcRates[] {RateName, Rate, RateUsed}`. `TRAN` TRANSPORTATION rated BASE + ADD'L on weight and
miles, against `LOAD` per CWT, `FSUR` per mile, `MVP` and `WHPD`.

Two limits its own analysis records, both used below. **`ChargeAmt` versus `GrossChargeAmt` versus
`NetChargeAmt` is _"genuinely ambiguous"_** — defined only as _"typically reflects 0.0"_ and
_"varies per service"_ (§3.11). And billing state is a **flag**, not a state:
`ThruAcctCompleted` + `ThruAcctDateOrig` + `ThruAcctDateLastAdj`, with rated → abstract → statement
_"stated prose, not a state machine."_

### 2.11 "Payment terms, a bill-to party, and an accessorial code that implies its own detail" — `src:nmfta-ebol` (grade A, secondary, C1–C8 = `2 · 2 · – · 1 · – · 1 · – · 1`)

Not rating, but every billing _hook_: `payment.terms` ∈ Prepaid / Collect / Third Party; a full
`billTo` party **with its own account number**; a 28-code accessorial list; COD with amount,
currency, terms, `customerCheckAcceptable` and a `remitTo` address; `declaredValue` with a currency;
and `quoteId` linking the document back to a rate quote. Its reusable idea, in its analysis's own
words: **the accessorial-code-implies-required-detail pattern** — `SRT` fires
`sortAndSegregateDetails`, `FVC` fires `fullValueCoverageDetails`, `MARK` fires `markDetails`, `COD`
fires `cod`.

The `billTo` party is the corpus's cleanest statement that **who is charged is not who is served**,
and `payment.terms` is its cleanest statement that **who pays is a fact with three published
values**. Both are A8's party entity, not A7's; §6 records them there.

### 2.12 "A per-stop loop on the invoice itself" — `src:stedi-x12-reference` (grade A, secondary, C1–C8 = `2 · 2 · 1 · 1 · – · 2 · 1 · 2`)

The 210 freight-invoice chain: `B3` invoice header → `L0` quantity and weight → `L1` rate and
charges → `L7` tariff reference per line item → `L9` Charge Detail → `L3` totals, with `ITD` terms
of sale, `C3` currency and `C2` bank id. And **a per-stop `S5` loop, so accessorials attach to the
stop that incurred them** — the second independent publisher of §3.4's scoping, arrived at from EDI
rather than from a TMS. `L9 Charge Detail` **also appears in the 990**, so a tender acceptance can
carry charges: a charge can exist on the acceptance of an offer, before anything has moved. §3.6.

### 2.13 "The complete settlement package, with nothing moving-specific in it" — `src:uncefact-scrdm` (grade A, secondary, `3/3/2/0/2/3/3/3`) and `src:uncefact-mmt-rdm` (grade A, secondary, `2/2/0/0/1/2/1/3`)

SCRDM is _"by a distance the best-covered area in the package"_ and its C4 is **0**. Header / Line /
Subordinate-Line `Trade Settlement`; `Trade_ Allowance Charge` and `Applied_ Allowance Charge`;
`Trade_ Payment Terms` / `Discount Terms` / `Penalty Terms`; `Advance_ Payment`; `Header_` and
`Payment_ Balance Out`; **five currency codes on one settlement**; and `Financial_ Adjustment` with
a reason code, modelled as an entity **separate from** `Delivery_Adjustment` — [SD §6.3]'s third,
structural source. Its invoice hooks are dates, not states: `Invoice. Date Time`,
`Next_ Invoice. Date Time`, `Scheduled_ Payment. Date Time`, `Closing Book_ Due. Date Time`.

MMT-RDM contributes one thing A7 uses and one it refuses. It uses `ChargeableWeightMeasure`
(§3.5) and the structural separation of `ApplicableLogisticsServiceCharge` from
**`EstimatedApplicableLogisticsServiceCharge`** as two associations on the consignment — estimated
versus applied charges, as structure. It refuses the rest: `LogisticsServiceCharge` with
`PaymentArrangementCode`, `TariffClassCode`, `ChargeCategoryCode`, `ServiceCategoryCode`,
`CalculationBasisCode` and `PayingPartyRoleCode` is a rating shape, and its own analysis records
**C3 = 0: _"No invoice-issued / invoice-paid lifecycle."_**

### 2.14 "Cost buckets with no billing at all" — `src:weichert-supplier-api` (grade B, secondary, `2/2/0/3/1/1/1/1`), and "pre-approval as a typed record" — `src:dtr-part-iv` (grade B, secondary, `2/2/1/2/1/2/2/1`)

Weichert has rich cost **buckets** — core moving, storage first-day / additional / delivery-out,
third-party crate-and-uncrate, insurance, warehouse handling, DTD — on a surveyed / allowance /
actual basis, and a four-way discount split (`supplier{HHG,SIT}Discount` against
`client{HHG,SIT}Discount`) that makes the RMC's own margin explicit. Its **C3 = 0** is stated
flatly: _"no invoice, no charge event, no payment, no billing lifecycle at all"_, with
`notIncludedComments` — _"not included or allowable for invoicing"_ — the only hint invoicing
happens elsewhere.

DTR Part IV contributes the propose/decide split's cleanest published form: **accessorial
pre-approval as a typed record** with states Pending → Approved / Denied, a 3-GBD PPSO SLA, and a
later reconciliation flagging each submitted service pre-approved or pre-denied (§C.8, §D.6). [A8 §5]
row 11 already cites it. It also names **DD 139 and DD 1131 as two collection instruments chosen by
pay status** — the corpus's only published statement that the instrument of collection varies.

### 2.15 The sources that have nothing, and what their absence proves

`src:shippeo`, `src:open-trip-model` (_"no money anywhere in the spec"_) and `src:macropoint` score
**0** on A7; `src:samsara` and `src:project44` score **1**. Every telematics and visibility source
has nothing, which is the exact mirror of their A4 strength.

That is not a gap in the corpus. It is evidence for where the boundary lies: **a charge is never
observed.** Every fact A4 models has a device that could assert it; no device asserts a charge. The
sources that publish charges are contracts, tariffs, regulations and accounting systems, and all of
them assert rather than observe. §3.2 uses this.

---

## 3. The decision

### 3.1 The shape, in one picture

```
                    a charge is ASSERTED, never observed (§2.15)
                                     |
   PROPOSED  ------------------  DECIDED  ------------------  RATED
   the performing role       the accountParty            the tariff owner
   [A8 §5] r11              [A8 §5] r11                 [A8 §5] r11
   (reaches pre-commitment,  (pre-approval IS this:      (the category, the
    §3.6)                     dtr A-402 §C.8, MilMove     discount, the minimum,
                              approved service item)      the proration — §3.4)
        \                          |                          /
         \_________________________|_________________________/
                                   |
                      three fact keys, one `charge` subject
                      context[]: shipment | portion | order
                                 stopAction | stop | stay      (§1, already declared)
                                   |
                  ================ | ================
                  THE LINE A7 CANNOT CROSS
                  ================ | ================
                                   |
              BILLED · COLLECTED · PAID · DISPUTED · DENIED · SET OFF
                                   |
              no record type, no aggregate, no aspect  (§3.2)
              state refused, and the projection refused harder  (§3.3)
              but the PRECONDITIONS are published at grade A  (§3.7)
```

**A7's single sentence: the model can say what a charge is, who may say it, and what it is scoped
to — and cannot say that it was billed, collected or paid. The missing piece is an aggregate, not a
field.**

### 3.2 Propose, decide and rate have records; bill, collect and pay do not — owed item 1

[A2 §3.6] instructed A6, A7 and A9 each to run the same check on its own aggregate: **does the
central act have a record?** A6 ran it over `document` and found a subject with no facts. A7 runs it
over `charge` and gets a **third** answer, different from both A2's and A6's.

**What exists.** `charge` is a declared `type` in the published record vocabulary, with a canonical
subject family (`charge` = {`charge`}), a declared qualifier (`{aspect}`), a six-member `context[]`,
and an **assigned** authority row. That is more than A2 had (no act, no record) and more than A6 had
(no act, an answerable authority). A7 is the first area since A4 whose subject arrives with its
authority settled.

**What does not exist, and it is the rubric's own second clause.** Nothing in [SD §4.7.1] records a
charge being **billed**, **invoiced**, **collected**, **paid**, **disputed**, **denied**,
**refunded** or **set off**. And the reason is one level above the record vocabulary: **[SD §1.2]'s
fourteen aggregate kinds contain no `invoice` and no `payment`.** So unlike A2's and A6's gaps,
A7's is not a missing fact class over an existing subject — **the subject is missing too.**

**Why that is not simply "nobody minted it", and the evidence is the disagreement itself.** An
invoice **groups** charges, and the corpus cannot agree on what it groups:

| Source                      | What one invoice-like object holds                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src:milmove-mymove`        | _"a subset of MTO Service Items from a Move"_ — a mover-chosen subset, with `isFinal` closing the task order |
| `src:alvys-api`             | four **types** of invoice: `LoadInvoice` / `OrderInvoice` / `SummaryInvoice` / `StandaloneInvoice`           |
| `src:sirva-ade`             | an **abstract** per shipment, aggregated into a **statement** per accounting half-month, keyed by `BatchNbr` |
| `src:dp3-400ng`             | the **BL** is the unit of account; delivery into NTS makes further movement _"under separate BL/invoice"_    |
| `src:stedi-x12-reference`   | one 210 with an `L9` chain, and the same `L9` appearing on a **990 tender acceptance**                       |
| `src:cfr-49-375`            | one invoice per delivery, within 15 days                                                                     |
| `src:smartmoving-api`       | no invoice object — `isOutstanding` and `paidAtUtc` on the charge                                            |
| `src:weichert-supplier-api` | nothing at all                                                                                               |

Seven publishers, seven groupings, and two of them (`SummaryInvoice`, the SIRVA statement) group
**across shipments**, which no aggregate in [SD §1.2] can be a subject of. **The grain disagreement
is the sourced reason there is no `invoice` aggregate**, and it is a stronger reason than absence
would have been. **[SYNTHESIS]** — each grouping is quoted; reading the seven as a grain
disagreement is ours.

**Payment is a different question, and it does not collapse into `DECIDED`.** The tempting shortcut
reads a payment as a fourth amount about the same charge, asserted by the payer — and
`aspect = DECIDED` is already the `accountParty`'s, which is usually the payer. Three things refute
it:

1. **A payment names a counterparty the charge does not.** `src:nmfta-ebol` carries a full `billTo`
   party **with its own account number** and `payment.terms` ∈ Prepaid / Collect / Third Party.
   Under Third Party, the payer is neither the shipper nor the carrier, and the `accountParty` of
   the charge is not the party that paid it.
2. **A payment names an instrument the charge does not.** `src:dtr-part-iv` chooses between
   **DD 139 and DD 1131 by pay status**; `src:cfr-49-375` §375.407 makes relinquishing possession
   conditional on a **tender of payment** of the lawful maximum, which is an act with its own
   moment and its own consequence.
3. **A payment can reverse another payment**, and the corpus models that separately from reversing
   a charge: `src:smartmoving-api`'s `refundsJobPaymentId` / `isRefund` / `amountRefunded` sit on
   the **payment**, beside `PaymentSource` and `takenByUserId`, while its charge-side link
   (`estimatedJobChargeId`) points the other way entirely.

A fourth `{aspect}` member would have to carry all three, and [SD §4.7.2b] fixes the three aspects'
values as _"an amount, an approval and a price"_. **A payment is none of those.** §9's gate holds
exactly this claim and nothing wider.

**Refused: minting the aggregates.** A7 does not add `invoice` or `payment` to [SD §1.2], although
[catalog §2.3] classes a new aggregate kind as **additive** and [SD §1.2] says the enum is _"open to
addition in a later `specVersion`"_ — so this is the cheapest mint available and it is still
refused. The reason is [A5 §3.6]'s discriminator, applied: **minting `invoice` alone produces
exactly A6's `document` — a subject with no facts.** Giving it facts means minting at least one fact
class, whose value is `chargeValue`, which is **owed** (§3.11). Minting all three trades one gap for
three. An aggregate whose only content is an owed value is a worse artefact than a recorded absence,
and [SD §0] forbids guessing the value to make the types tidy.

**Recorded absent and owed instead**, under [SD §4.7.3], one class:

> **`chargeCollection`** — the act by which a charge is **billed and collected**: the freight bill
> presented, the amount tendered, the possession relinquished. `src:cfr-49-375` §375.407, §375.801,
> §375.807; `src:milmove-mymove`'s `PaymentRequest`; `src:dtr-part-iv`'s DD 139 / DD 1131.
> **Blocked on a missing aggregate**, which is a kind of blocker [A8 §9 item 8] does not yet carry
> and which the model already has one instance of — `placeRef`, owed to [SD §1.2] because _"no
> `place` aggregate"_. [A7 §3.2].

**This is the third consecutive area to find its central act has no record**, and the three are not
the same shape. A2: the act is absent and its authority is blocked on a `boundBy` member. A6: the
act is absent and its authority is **already answered**. A7: the act is absent, its authority is not
reachable, **and so is its subject** — the question never gets as far as the authority ledger.

### 3.3 Charge and invoice state is refused, and the projection is refused harder — owed item 2

This is [A2 §3.3]'s facet refusal for the third time, and it is the best-evidenced of the three,
because here the publishers disagree about the **grain** as well as about the values.

| Publisher                   | Grain                        | The state vocabulary                                                                                                                        |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src:milmove-mymove`        | payment **request**          | `PENDING` → `REVIEWED` \| `REVIEWED_AND_ALL_SERVICE_ITEMS_REJECTED` → `SENT_TO_GEX` → `TPPS_RECEIVED` → `PAID`, + `EDI_ERROR`, `DEPRECATED` |
| `src:alvys-api`             | **invoice**                  | `Draft` / `AwaitingPayment` / `Paid`                                                                                                        |
| `src:alvys-api`             | **load**                     | five financial values fused into one 16-value operational ladder: `Invoiced`, `Financed`, `Paid`, `Released`, `Queued`                      |
| `src:sirva-ade`             | shipment **through-account** | not a state — a **flag**, `ThruAcctCompleted`, with two dates; rated → abstract → statement is _"stated prose, not a state machine"_        |
| `src:atlas-world-group-api` | three at once                | `ivhInvoiceStatus`, `ord_invoicestatus`, `pyd_status` — **all untyped**                                                                     |
| `src:dp3-400ng`             | charge                       | billed / disputed / denied / re-billed / refunded — _"referenced but never enumerated"_                                                     |
| `src:smartmoving-api`       | charge                       | no lifecycle: a boolean `isOutstanding` and a nullable `paidAtUtc`                                                                          |
| `src:cfr-49-375`            | the **credit period**        | not an invoice state at all: 15-day invoice → 7-day credit → 30-day extension → 1% / $20 → credit denied                                    |
| `src:uncefact-scrdm`        | settlement                   | no states — four **date** hooks (`Invoice`, `Next_ Invoice`, `Scheduled_ Payment`, `Closing Book_ Due`)                                     |
| `src:uncefact-mmt-rdm`      | —                            | _"No invoice-issued / invoice-paid lifecycle."_                                                                                             |
| `src:weichert-supplier-api` | —                            | _"no invoice, no charge event, no payment, no billing lifecycle at all."_                                                                   |

**Eleven positions and no two the same.** Three publishers have no lifecycle at all; one has a flag;
one has three untyped fields; one references five values and enumerates none; one publishes dates
instead of states; and the two that do publish state machines disagree about what the machine is
_about_ — a payment request is not an invoice.

**Decision: no charge-state or invoice-state vocabulary is published, and the absence is a
refusal.** This is [A2 §3.3]'s ground with more publishers, and [catalog §2.3] makes the cost of
guessing wrong explicit: a `{aspect}` qualifier is a fact-key component, so **changing its shape is
breaking — a new major.** Publishing one of eleven disagreeing vocabularies would cost every
consumer a re-validation to undo.

**And the projection is the worse temptation, not the safer one.** A `chargeStateAt(charge, t)` fold
looks free — it publishes no enum on the wire and derives from records that already exist. It is
not free, and it fails for the same reason twice over:

- **It has no inputs.** A projection folds assertions. §3.2 establishes that no assertion records a
  charge being billed, collected or paid, so the fold would quantify over the empty set. That is
  **B-STAGE a third time** — [`fork-order` §5.2]'s stage projection, which [A2 §3.6] found _"has
  been a projection with no inputs since it was written"_, and [A6 §3.4(a)]'s `documentStateAt`,
  which was refused on the same ground.
- **It would fuse two axes the corpus warns about by name.** `src:alvys-api`'s own analysis records
  the failure in its own product: the 16-value ladder puts `In Transit` beside `Financed`, and
  _"a load that is `Delivered` and a load that is `Paid` differ in which lifecycle moved."_ [A1]
  kept the axes apart without being asked — `ORDER_STAGES` is five members and not one of them is
  financial — and A7 ratifies that rather than undoing it.

Held as `CHARGE_STATE_IS_NOT_COMPUTABLE = true`, a plain constant and not a typed gate, and **§9
says why**: the claim is false only when a fact class is minted, and a mint already touches three
files and a test table. That is [A6 §9]'s distinction applied rather than copied.

**What is kept, and it is a shape rather than a vocabulary.** Two ideas survive the refusal and are
recorded for whoever mints `chargeCollection`:

1. **Supersession, not edit, at the request grain** — `src:milmove-mymove`'s
   `recalculationOfPaymentRequestID` + `DEPRECATED`. Note that this is **not** in tension with
   [SD §6.3]: what is superseded there is a _claim for payment_, not a priced record. §3.8.
2. **Accounting periods are first-class** — `src:sirva-ade`'s `StatementYear` / `Month` / `Half` /
   `IssuedDate` with `BatchNbr`, and `src:dp3-tender-of-service`'s NTS half-month storage arithmetic
   keyed to the 15th and 16th. A billing period is not a shipment's timeline and does not align
   with one.

### 3.4 Line-haul versus accessorials: a facet analysis, and what `context[]` does and does not carry — owed item 3

The rubric asks for _"line-haul vs accessorials"_ and writes _"detail of rating out of scope"_ in
the same row. A12 owns the accessorial catalogue and is context-map-only by design. So the question
A7 can answer is narrow and real: **is the line-haul/accessorial distinction a fact the model
carries, and if so, where?**

**(a) The taxonomy is not one axis, and the primary source is what shows it.** `src:cfr-49-375`
Appendix A gives five names, and they do not partition on one facet:

| Name                         | What the definition actually cuts on                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Line-haul**                | _what the service is_ — "the transportation portion"                                                           |
| **Accessorial (Additional)** | _what the service is_ — packing, unpacking, appliance servicing, piano carrying                                |
| **Advanced**                 | _who performed it and who paid_ — a third party performs, **the mover pays** and passes it through on the BL   |
| **Impracticable operations** | _whether it was requested_ — **chargeable even if not requested**, and tariff-defined                          |
| **Valuation**                | _what it is for_ — liability rather than transport, and the only charge collectable on a total loss (§375.709) |

An **advanced** charge for a third-party piano carry is an accessorial by service and an advanced
charge by payment path; an **impracticable-operations** shuttle is an accessorial by service and
impracticable by cause. The five names are not mutually exclusive and the regulation never says they
are. **A shipment can carry one charge that is three of the five at once.**

The other publishers cut differently again, and none of them the same way. `src:smartmoving-api`
puts `Transportation`, `TripAndTravel`, `FuelSurcharge`, `ShuttleFees`, `Valuation`, `BulkyItem`,
`StorageInTransit` and `CrewSkills` as **siblings in one 13-member enum** — service, surcharge,
liability and storage on one axis. `src:uncefact-mmt-rdm` uses **three separate codes**
(`ChargeCategoryCode`, `ServiceCategoryCode`, `CalculationBasisCode`) for what SmartMoving spends
one on. `src:alvys-api` makes it four fields. `src:dp3-400ng` makes it two filed discounts.
`src:nmfta-ebol` makes it a 28-code list where the code **implies a required detail object**.

**Decision: A7 publishes no charge-type vocabulary**, on [A2 §3.3]'s ground — no two publishers
decompose it into the same facets, and the catalogue is A12's by design.

**(b) What _is_ expressible, and it was already declared.** Three independent publishers scope an
accessorial to the stop that caused it: `src:alvys-api`'s `StopId` on
`CustomerAccessorialsDetails[]`, `src:stedi-x12-reference`'s per-stop `S5` loop **inside the 210
invoice**, and [A3 §Cross-area]'s reading of the same. `src:dp3-400ng` scopes storage charges to the
SIT segment and `src:milmove-docs` scopes SIT payment windows so they _"must not overlap previously
requested SIT dates"_. `src:dp3-400ng` and `src:cfr-49-375` scope line-haul to the whole shipment.

All of that is already carried: `charge`'s `context[]` is `shipment`, `portion`, `order`,
`stopAction`, `stop`, `stay`. **A7 adds nothing and needs nothing added.**

**(c) And the residue is the finding.** It would be neat to say that `context[]` _is_ the
line-haul/accessorial distinction — line-haul scoped to the shipment, accessorial scoped to the stop
— and it is **not true**. Running the five names against the six context members:

| Charge                            | Scoped to    | Reproduced by `context[]`?                                                                                                                                          |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line-haul                         | the shipment | yes                                                                                                                                                                 |
| Detention, shuttle, flight charge | the stop     | yes                                                                                                                                                                 |
| SIT first day / additional days   | the stay     | yes                                                                                                                                                                 |
| A pre-commitment price proposal   | the order    | yes                                                                                                                                                                 |
| **Fuel surcharge**                | the shipment | **indistinguishable from line-haul**                                                                                                                                |
| **Valuation charge**              | the shipment | **indistinguishable from line-haul**                                                                                                                                |
| **Advanced charge**               | either       | **cuts across** — `src:atlas-world-group-api` carries per-stop third-party `AdvancedCharge`, and `src:dp3-400ng` Item 35.1's third-party charges are shipment-level |

**Four of seven land cleanly and three do not.** The causal **scope** of a charge is expressible and
already published; the charge's **category** is not, and `context[]` is not a proxy for it. Saying
so is the point: a reader who took the scoping for the taxonomy would conclude the model can
separate a fuel surcharge from a line-haul charge, and it cannot. **[SYNTHESIS]** — every scoping is
sourced; running the corpus's five names against the declared `context[]` and recording the residue
is ours, on [A6 §3.6]'s pattern where the residue was the deliverable.

**(d) One boundary the corpus does publish, and it is a rate-table boundary.**
`src:milmove-mymove`'s `ShipmentAddressUpdate` is auto-approved **unless** it crosses a pricing
boundary — service area, mileage bracket, more than 50 miles, or a **shorthaul/linehaul flip** — and
`src:dp3-400ng`'s `SH` shorthaul factor applies only at ≤ 800 total miles and _"must be reimbursed
in full via EDI if the shipment turns out to have moved more than 800 miles."_ So the line-haul
boundary, where it is published at all, is **a distance threshold in a rate table**, not a property
of the service. That is a tariff fact, it belongs at `aspect = RATED` with the tariff owner, and it
is A12's. §3.9 uses it.

### 3.5 The billable weight: A2's hand-off, and [SD] answered it before A2 asked — owed item 4

[A2 §Cross-area] (a) hands A7 _"the sharpest inherited question in the pile"_ and [A2 §3.6] states
the argument: `src:milmove-mymove`'s `billableWeightCap` _with a justification field_,
`src:uncefact-mmt-rdm`'s `ChargeableWeightMeasure` and `src:x12-212-trailer-manifest` element 187's
`B` Billed are one concept at grade A three times over; [SD §4.2]'s basis enum has no member for it;
therefore it is a `charge` at `aspect = DECIDED`.

**The first half is right, the second half is right, and the conclusion does not follow — and the
text that shows it is [SD], which outranks [A2].**

**(a) [SD §4.1] puts the billed weight on the type axis, in the same sentence as gross, net and
tare.** The `measure` family row's "contest is real because" column cites the **same element** [A2]
cites and quotes its kinds: _"`G` gross, `N` actual net, `T` tare, `E` estimated net, **`B`
billed**, `L` legal, and `RG`/`RN`/`RT` reweigh variants."_ That is an argument column and not the
family's Examples column, so read narrowly it does not declare `B` a member — what it does is put
`B` beside `G`, `N` and `T`. The model maps that element across two axes: net/gross/tare become
three **types**, actual/estimated become **bases**. `B` sits on the first axis, not the second.
**[A2] ruled out a fourth _basis_, correctly, and never considered a fourth _type_**, which is where
the source it cites puts it. This half of the argument is a reading; (b) is the half that decides.

**(b) [SD §4.4] already resolves the central case, with a billing rule.** `R-WEIGHT-LOWER`'s
three-row source table has, as its middle row, `src:dp3-400ng` **Item 4.11.d — _"invoice on the
lesser weight"_**. The shared layer adopted the tariff's own invoicing rule as the resolution rule
for `weight.net`, which is why `weight.net`'s authority row reads `boundBy = NONE`, _"NO role is
authoritative. Settled by the value rule R-WEIGHT-LOWER."_

So in the corpus's central case — an original weighing and a reweigh, which is what every one of
[A2]'s three sources is about — **the billed weight is not a separate fact at all. It is
`weight.net` resolved.** Element 187 carries `B` as a transmitted kind because EDI has no resolution
rule; the model has one, and it is the same rule the tariff states.

**(c) What that leaves, which is not nothing, and it is three different things.** Running the corpus
for cases where the number that prices the move is **not** any asserted net weight:

1. **A tariff minimum.** `src:dp3-400ng` Item 17.9.b.2's 1,000-lb minimum on the **combined** weight
   of separately-rated portions; Items 25 and 56.3's minimum charge and minimum weight;
   `src:dp3-tender-of-service` NTS §5.9's 500-lb drayage minimum on an attempted pickup. A 300-lb
   portion is billed at 1,000 lb, and **no party asserts the goods weigh 1,000 lb.**
2. **A regulatory proration.** `src:cfr-49-375` §375.403(a)(11) prorates a partial delivery by
   delivered weight over total weight, and §375.707(b) makes **constructive weight** the basis for
   apportioning charges on a partially lost or destroyed shipment.
3. **An authority's cap, with a justification.** `src:milmove-mymove`'s `billableWeightCap` beside
   `calculatedBillableWeight`, with `billable_weights_reviewed_at` on the `Move`.

**(1) and (2) are arithmetic over an already-resolved weight, and they are A12's.** A minimum, a
proration and a per-cubic-foot constructive rate are rate rules; they take a weight and produce a
priced quantity. Rating detail is out of scope by the rubric's own row. Recording them as a fact
class would publish, as a measurement of the goods, a number produced by a tariff.

**(3) is genuinely a decision, and it is the only one of the three with a named asserter and a
justification — and its subject is wrong for a `charge`.** Under [SD §1.3] the fact key is
`(subject, type, qualifier?)`, and a `charge` record's subject is one **charge**. A billable-weight
cap is decided **once** and feeds every weight-based charge on the shipment — `src:dp3-400ng`'s
Geographical Schedule prices the linehaul factor, the origin and destination service charges and the
SIT first-day and additional-day items **all per CWT off the same weight**. Placing it on a `charge`
would either duplicate it across every weight-based charge or arbitrarily elect one as its canonical
home, and [SD §1.1] forbids a second subject hidden inside a payload. All three of [A2]'s own
sources put it at **shipment** grain: `billableWeightCap` is a column on `MTOShipment`, element 187's
`B` is on the AT8 **shipment** segment, and `ChargeableWeightMeasure` is on the **consignment**.

**Verdict: [A2 §3.6]'s placement is overturned, on binding text [A2] did not read against its own
question — and [A2] explicitly authorised A7 to do so.** What [A2] saw as one concept is three
wearing one name: a resolution already performed, a tariff arithmetic that is out of scope, and a
decision whose subject is a shipment rather than a charge. **[SYNTHESIS]** — each of the three is
sourced; separating them is ours.

**A7 mints nothing here, and the reason is its family.** A shipment-subject, authority-decided
quantity has no family in [SD §4.1]'s table: it is not a `measure` (nobody measured it), not a
`count`, not a `state`. That is **the same gap `charge` itself has** — `FACT_CLASS_FAMILY` declares
`charge`'s family `owed` for exactly this reason. Minting a second type with an owed family doubles
the model's one structural hole to buy a case the corpus names once. Recorded in §6 as owed to
[SD §4.1], not minted here.

### 3.6 The pre-commitment proposal: `PRINCIPAL` reaches it — owed item 5

[A1 §3.6] item 1 places a price counter-proposal on the `charge` fact key at `aspect = PROPOSED`
rather than on the reason axis, and the argument is sound: _"The reason on the declining response
names the act's own failure; the number lives on the charge."_ [A1 §Cross-area] then hands A7 the
doubt — row 11's `PRINCIPAL` binding is _"now being asked to carry a **pre-commitment** proposal —
one made before any order exists to hold it — which row 11's `PRINCIPAL` binding may or may not
reach."_

**It reaches it, and the reason is in `PRINCIPAL`'s own definition rather than in row 11's
summary.** [A8 §4.3] defines it: _"Authority belongs to the party the arrangement is **for**, and
moves only when the principal changes."_ Two things follow:

1. **`PRINCIPAL` resolves against a party and an arrangement, and names no record.** That is what
   separates it from its siblings: `CUSTODY` resolves against `handover` assertions ([SD §4.8]),
   `ASSIGNMENT` against an assignment, `SCHEME` against an issuer. A binding that named a record
   would fail pre-commitment; `PRINCIPAL` does not name one, so the absence of an `order` aggregate
   instance is not an obstacle to resolving it.
2. **The corpus names both roles before any commitment exists**, three ways.
   `src:cfr-49-375` §375.401 has the carrier prepare a written estimate signed and dated by **both
   parties** before the bill of lading exists, and §375.409 lets a **broker** estimate under a
   written agreement adopting the estimate as the carrier's own — the proposing role is named, and
   named twice. §375.403(a)(8) states the propose/decide pair in a regulation: the carrier proposes
   post-BOL additional services, **the shipper decides**, with at least one hour to do so.
   `src:alvys-api` fires `tender.bid.submitted` carrying a `bidAmount` on a tender that has not been
   accepted. And `src:stedi-x12-reference` puts `L9 Charge Detail` **in the 990** — a tender
   acceptance that carries charges, so a priced line exists on the answer to an offer.

**Decision: [A1 §3.6]'s placement holds unchanged, and row 11 needs no amendment.** A7 answers the
question rather than handing it to A8. What A7 adds is the reason it works, and the honest form of
it is a **split** rather than a superlative: of [A8 §4.3]'s five bindings, `PRINCIPAL`, `SCHEME` and
`NONE` resolve against a **party or against nothing**, while `CUSTODY` and `ASSIGNMENT` resolve
against **records** — `handover` assertions and an assignment respectively. Only the second group
fails pre-commitment, and `charge` is in the first. That is why `PRINCIPAL` is a sound binding for a
fact class whose first assertion may precede the arrangement it prices.

**And one collision checked, because it looks like one and is not.** [SD §4.7.3] records `estimate`
as absent and owed, grouped with _"cube, survey and estimate facts"_ and _"every A10/A11 class"_ —
and `src:cfr-49-375`'s estimate **is** a pre-commitment price proposal. If `estimate` were the
price, [A1 §3.6] and [SD §4.7.3] would disagree. They do not: §4.7.3's grouping is with **cube and
survey**, which are quantity facts, and A10's rubric row is _"survey types, estimate types,
inventory items"_. So the estimate's **quantity** is the absent class and is A10's; the estimate's
**price** is a `charge` at `PROPOSED`; and the estimate as an **artefact** is a document, which
[A6 §3.8] already triaged out of its own row. Three facts, three homes, no conflict. Recorded here
because the next reader will meet the same apparent collision.

### 3.7 Collection preconditions: D-CITE generalised past documents — owed item 6

[A6 §3.5]'s **D-CITE** decides that a citation in `evidence[]` claims nothing, and its third
supporting quotation is `src:cfr-49-375` §375.519(d) — _"true copies of all weight tickets must
accompany a freight bill **in order to collect** any shipment charges dependent upon the weight
transported"_ — read there as _"a named document kind is a precondition of a named consequence — by
a rule naming the pair, not by virtue of being cited."_ [A6 §Cross-area] then hands A7 the rule
itself: _"A7 inherits the pair and the rule."_

**The corpus publishes seven of these, and the publisher count is smaller than the row count makes
it look — which is stated here rather than left for a reader to work out.** Three sources carry
them, and **two of the three are the same programme**: `src:dp3-tender-of-service` and
`src:dp3-400ng` are both DP3, so the genuinely independent count is **two** — US federal
consumer-protection law, and the DoD household-goods programme. Three rows are **primary**
(`src:cfr-49-375` is the only one of the three with a capture); the other four are secondary.
Both counts are gated by `charges.test.ts` rather than left in prose ([A1 §9]).

| The precondition                                                                                                                  | Gating fact is about                                                                              | Source                                            |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| True copies of all weight tickets must accompany the freight bill to collect weight-dependent charges                             | a **document**                                                                                    | `src:cfr-49-375` §375.519(d) — **primary**        |
| On a total loss in transit the carrier may collect **no** freight charges, except a valuation charge                              | the **shipment**'s outcome                                                                        | `src:cfr-49-375` §375.709 — **primary**           |
| Accessorial charges must be determined before preparing the BOL; if the carrier fails to ask, it delivers and bills after 30 days | a **moment**                                                                                      | `src:cfr-49-375` §375.401(f) — **primary**        |
| The PPSO **denies** the SIT and delivery-out charges where the 24-hour notice was not given                                       | a **notification**, and so the **shipment** — [SD §4.7.3] gives `notification` the family `goods` | `src:dp3-tender-of-service` §C.3.h — secondary    |
| No invoicing until the reweigh is performed, DPS updated, and tickets received by the origin PPSO                                 | a **weight assertion**, and so the **shipment**                                                   | `src:dp3-400ng` Items 4.11.c, 4.12.b — secondary  |
| The document package to the PPSO no later than 7 GBD after pickup                                                                 | a **document set**                                                                                | `src:dp3-tender-of-service` §C.12.a-b — secondary |
| Third-party charges require paid original receipts and prior pre-approval, one reimbursement per receipt                          | a **document** + a **decision**                                                                   | `src:dp3-400ng` Item 35.1 — secondary             |

**Subtract what [A8 §5] row 11 already carries.** Pre-approval is not a new mechanism: row 11's
`aspect = DECIDED` **is** the pre-approval, and its evidence column already cites
`src:dtr-part-iv`'s pre-approval-as-a-typed-record and `src:milmove-mymove`'s _"nothing is billable
unless a matching service item was created and approved."_ So the last row's decision half is
carried, and `src:dp3-tender-of-service` §B.12.c and `src:dp3-400ng` Items 105/120/125 add weight to
row 11 rather than opening anything.

**The residue is the finding, and it has one shape.** What is left after that subtraction is six
preconditions that are **not decisions about the charge**. Each is a fact about a **different
aggregate** — a document, a notification, a weight assertion, the shipment's own outcome, a moment
— and in every case the charge is perfectly well-formed, properly authorised and correctly rated,
and still may not be collected.

**Decision (`A-COLLECT`): collectability is a rule over pairs, and it is not a fact about the
charge.** Stated to match D-CITE's form, one aggregate over:

> **A charge's collectability is determined by a rule naming a (charge, gating fact) pair. It is
> not a property of the charge assertion, it is not an `{aspect}` value, and it is not carried in
> `evidence[]`.**

Three consequences, and the third is why the rule is worth stating rather than assuming:

1. **It generalises D-CITE past documents.** [A6 §3.5] scopes evidentiary standing to a (document
   kind, fact class) pair. **Four of the seven rows gate on something that is not a document** — an
   outcome, a moment, a notification and the existence of a weight assertion. The pair is (charge,
   gating fact), and the gating fact's aggregate kind varies. **Two kinds, not three**, and the
   second one is doing unusual work: `shipment` covers four unlike facts because [SD]'s families
   put them there, not because they resemble each other. The table records the kind; the row's own
   text records what the fact actually is, and the two are not the same statement.
2. **It keeps §3.3's refusal honest.** The tempting way to model "denied for want of a notification"
   is a charge **state** — which §3.3 refuses, and which eleven publishers cannot agree on. Under
   `A-COLLECT` the denial is not a state the charge enters; it is the outcome of evaluating a rule
   whose other operand is elsewhere.
3. **It does not say what the rules are, and says so.** A7 records the seven the corpus publishes as
   a **data table** rather than as prose, because seven sourced rows with an aggregate kind each is
   data (§9). What A7 does **not** do is claim the list is complete or that it generalises beyond
   the programmes that publish it: **four of the seven are DoD programme rules**, and
   `src:dp3-400ng`'s own analysis warns against promoting programme rules into the core model. The
   **three** `src:cfr-49-375` rows are federal law and reach every US interstate consumer move. So
   the rule has one publisher whose rules generalise and one whose rules do not, which is a thinner
   base than seven rows suggests and is why §7 rates `A-COLLECT` **medium** rather than higher.

**Refused: a `collectable` flag, and an `evidence[]`-based reading.** A boolean on the charge would
be a mutable current-state field on the envelope, which [SD §1.1] forbids for the same reason it
forbids `in-transit`. And reading collectability off `evidence[]` is precisely what D-CITE refuses:
citing the weight ticket does not make the charge collectable, and **not** citing it does not make
the charge wrong — §375.519(d) gates the **freight bill**, which the model does not have (§3.2).
That last point is the sharpest thing in this section: **the rule A6 handed over names a document
on one side and an artefact the model cannot express on the other.**

### 3.8 The offsetting-record door, measured against the four things the corpus names — owed item 7

[SD §6.3] is binding and A7 does not reopen it. What A7 owes is the check the plan asks for:
**is the door wide enough?** `OffsettingRecord` is
`{ offsets: EventId, adjCode: 'ADJ' | 'CAN', batch?: string, narrative: string }`.

| What the corpus names                                                                                                                                                                              | Fits?                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refund** — `src:dp3-400ng` Item 17-2.7's refund of prepaid-but-unperformed services via 226A; `src:dp3-tender-of-service` §B.8.a(2)(c)-(d)'s supplemental invoice refunding a reweigh difference | **Yes.** One charge, one offset, a mandatory narrative — which is exactly 226A's mandatory detailed note                                                                                                                      |
| **Re-bill** — `src:dp3-400ng` Items 4.13.3.b, 27.4.b-c                                                                                                                                             | **Yes**, as two records: a `CAN` and a new charge. `BatchNbr` is what keeps a rerun apart from a genuine second adjustment                                                                                                    |
| **Reimbursement** — `src:dp3-400ng` Item 35.1's third-party charges, one reimbursement per paid original receipt                                                                                   | **Does not need the door.** A reimbursement offsets nothing: it is a **new charge** at `PROPOSED`, evidenced by a receipt, gated by §3.7's last row. Recorded because reading it as an offset would create a phantom original |
| **Set-off** — `src:dp3-tender-of-service` NTS §5.8.2: the DD 1164 is amended to name the line-haul carrier's failure as the cause, and the PPSO sets off against **that carrier on its own BL**    | **The narrow spot.** See below                                                                                                                                                                                                |

**The narrow spot, stated precisely.** `offsets: EventId` links to one charge assertion, and the
type says nothing about whether the two assertions share a subject. A set-off does not: the cost
arises on one shipment's charge and is recovered against a **different party's charge on a different
BL**. Three observations, and A7 changes nothing on the strength of them:

- **The link is structurally capable of it.** An `EventId` is an `EventId`; nothing forbids the
  cross-subject case today, so this is a **silence**, not a refusal.
- **`src:sirva-ade`'s zero-out invariant is stated per shipment** — a `CAN` _"combined with the
  'Original' amounts will zero out **the shipment**"_ — and `cancellationZeroesOut` already carries
  a TODO saying it _"should be evaluated per `{aspect}` fact key rather than per shipment"_. A
  cross-subject set-off would break the shipment reading of that invariant and not the fact-key one,
  which is an argument for the TODO's direction and is recorded as such.
- **A8 has already named the role.** Row 11's corroborating column carries `SettlingAgent` and
  **`SetoffAgent`**, so the party is not the blocker.

**Decision: the door is wide enough for three of the four, and the fourth is a silence A7 records
rather than closes.** Widening `OffsettingRecord` to declare the cross-subject case would be
[ORIGINAL] structure on one secondary source, and narrowing it to forbid the case would refuse
something a grade-A contract publishes. Both are worse than saying which it is. §6 carries it to
[SD §6.3] and [A8].

### 3.9 The tariff classification `INSTRUCTED_CHANGE` declines to make — owed item 8

`src/outcomes.ts`'s `INSTRUCTED_CHANGE` docstring is published and says, in as many words, that the
code _"names the instruction and leaves the classification to A7"_, because `src:dp3-400ng` gives
two **priced** forms of the same instruction and they are not one category: Item 28.4 **Diversion**
is _"a change while enroute… outside of the BPC of the original destination, or in the route at the
request of the Government"_, and is explicitly **not** a diversion if the change arrives before the
shipment moves — which is Item 28.3's authorised **stop-off** instead. [A4 §4.6]'s confidence row
makes `INSTRUCTED_CHANGE`'s medium-high rating conditional on _"A7 deciding it needs the distinction
at capture time rather than deriving it."_

**Decision: it does not need the distinction at capture time, and §3.4 is why.** The
diversion/stop-off split is a **tariff category**, decided by facts the asserting party does not
have when it records the instruction:

- Whether the shipment had **moved** when the instruction arrived (Item 28.4.d) — a fact about
  another aggregate's acts.
- Whether the new address is outside the **BPC of the original destination** (Item 28.4.a) — a fact
  about a geography table the model does not carry, keyed to the rating address frozen at award,
  which `src:dp3-400ng` states eight times as _"block 19… and/or block 18 at the time the shipment
  is offered and accepted."_
- Whether the shipment is already in **destination SIT**, which excludes it from diversion
  (Item 28.4.d), and `src:dtr-part-iv` §E.1 agrees.

Under §3.4 the category is a `RATED` fact and its authority is the **tariff owner's** ([A8 §5]
row 11). A capture-time classification would put a tariff owner's determination in a field asserted
by whoever recorded the instruction, and it would be wrong whenever the shipment's movement status
was misjudged. The published note is therefore correct as written, and this closes rather than
defers it: **[A4 §4.6]'s condition is discharged, and its confidence row can be settled rather than
left conditional.** §Cross-area carries the edit to [A4], because a consequence claimed here and not
written there is a disagreement rather than a refinement ([A2 §3.2]'s precedent).

One corroboration, from the same family of facts: `src:dp3-400ng` Item 28.4.f bills a diversion
_"under 28B with a note"_ rather than under its own code 28C, and reweigh fees are billed under 226A
rather than 4A/4B (Item 4.4). **The tariff's own item codes do not partition its own categories**,
which is the strongest available evidence that a category is not a capture-time fact.

### 3.10 The rubric's row and A5's surface, triaged — owed item 9

[A1 §3.4] set the discipline and [A5 §3.6] and [A6 §3.8] refined it: say of each item whether it is
a record type, a projection, somebody else's, or absent and owed, and refuse to mint where the mint
costs more than the gap. [A6 §3.8]'s warning applies here too — **the `Covers` column is a prompt,
not an inventory.**

The rubric's A7 row reads _"line-haul vs accessorials, charge events, invoice issued/paid (detail of
rating out of scope)"_.

| Rubric item                   | Verdict                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Line-haul vs accessorials** | **Refused as a vocabulary, and the scoping is already declared** — §3.4. The catalogue is A12's by the rubric's own parenthesis    |
| **Charge events**             | **Split.** Propose, decide and rate are records and already exist. Bill, collect and pay are **absent** — `chargeCollection`, §3.2 |
| **Invoice issued / paid**     | **Not expressible, and the blocker is an aggregate** — §3.2. The state vocabulary is refused separately — §3.3                     |
| _(detail of rating)_          | **Out of scope by the rubric's own text**, and §3.4(d), §3.5(c) and §3.9 each return a question to it                              |

**[A5 §Cross-area]'s whole storage-charge surface, item by item**, because [A5] handed it over as a
list and a list deserves an answer per row:

| A5's item                                                                                                                                                                                                      | Verdict                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-day / additional-days / delivery-out triple (Items 17.5, 210A-F; `src:weichert-supplier-api` odt:561-568; `src:sirva-ade` `SITCFD`/`SITCAD`; `src:atlas-world-group-api`'s three billing activity kinds) | **Rating detail, A12's.** Four publishers name the three buckets; all four price them. `charge` with `stay` in `context[]` carries each as a fact — §3.4(b)                            |
| Re-entry first-day rule (Item 17-1.1.b)                                                                                                                                                                        | **Rating arithmetic over a sequence of stays.** [A5 §3.4]'s stay boundary already supplies the sequence; the charge rule is A12's                                                      |
| Accrual-ceases rule (Item 17.7.a-b)                                                                                                                                                                            | **A12's**, and it is the sharpest illustration of §3.4(d): a charge stops accruing on the **5th GBD after the requested delivery date**, a date the goods' location does not determine |
| 25% discount after termination (Item 17-2)                                                                                                                                                                     | **A12's** — a filed discount                                                                                                                                                           |
| Item 17.9.b.2's 1,000-lb minimum on the **combined** weight of separately-rated portions                                                                                                                       | **Answered at §3.5(c)(1)** — a tariff minimum, not a weight and not a charge decision                                                                                                  |

**[SD §8.4], taken because this is the last cheap moment.** Its confidence row says the pack-only-day-is-a-Trip
decision is _"still cheap to reverse before A5 and A7 are written and expensive after"_, and records
that one of its two premises was withdrawn, leaving `src:open-trip-model` supporting it **singly**.

**A7 ratifies it, and supplies a second premise that is independent of the withdrawn one.** The
withdrawn premise was `src:dp3-400ng` Item 28.3, which is about extra stops **on a linehaul route**
and does not reach a day with no linehaul — so A7 does not re-use it, and §3.4(b)'s citation of
Item 28.3 is about stop-offs on a rated route and is not offered here. What is independent:
`src:alvys-api` puts `StopId` on a detention accessorial and `src:stedi-x12-reference` puts an `S5`
per-stop loop inside the 210 invoice, and **neither is conditioned on a linehaul having occurred**.
A detention charge attaches to the stop that caused it whether or not the vehicle then drove
anywhere. So a packing charge on a pack-only day needs a `stop` in its `context[]` on the same terms,
and reversing [SD §8.4] would leave it with nothing to anchor to.

**A7's stake therefore points the same way as [SD §8.4]'s conclusion, and the window closes here.**
§Cross-area carries the confidence-row edit; A7 does not claim the decision, which is [SD]'s.

### 3.11 The criteria weighted, and why

[A6 §3.9]'s form. A7 weights **C3** highest — **as [A1 §3.7] did**, and for a related but not
identical reason — and **C1** second.

- **C3 (invariants) highest.** [A1] weighted it heaviest because lifecycle rigor is what separates
  the corpus. A7 weights it heaviest because every decision above turns on whether a published rule
  is testable: §3.5 is settled by [SD §4.4]'s resolution rule, §3.3 is refused because eleven
  publishers' invariants do not agree, §3.7 exists because seven **published rules** state a
  precondition with a consequence, and §3.8 is a test of one type against four named cases. And the corpus
  obliges: `src:cfr-49-375` scores C3 = 3 on arithmetic invariants, and `src:milmove-mymove` and
  `src:milmove-docs` score 3 on lifecycle and invoicing gates. **Here the heaviest criterion and the
  best-evidenced one are the same criterion**, which is a comfortable position and not a common one
  — [A2] weighted C2 heaviest precisely because its best sources disagreed.
- **C1 (coverage) second**, because the split in §3.2 between what is covered and what is absent
  _is_ the deliverable, and only a wide survey establishes that nothing covers the second half.
- **C2 (precision) third and not first**, which is the opposite of [A2]'s weighting and is the
  reason §3.3 reads the way it does. A2 weighted C2 highest because its problem was disagreement
  among precise publishers. A7's problem is worse: several of its publishers are **imprecise about
  their own data** — `src:atlas-world-group-api`'s three untyped status fields,
  `src:sirva-ade`'s _"genuinely ambiguous"_ gross/net/`ChargeAmt` trio, `src:dp3-400ng`'s five
  never-enumerated charge states. Weighting C2 highest would have scored the area on a quality its
  best sources do not have.
- **C4 (HHG fidelity) fourth**, and the ranking carries a warning. The two sources with the highest
  C4 on A7 — `src:smartmoving-api` at 3 and `src:dp3-400ng` at 3 — are the two whose vocabularies
  §3.4 refuses. High HHG fidelity here means _a complete accessorial catalogue_, which is the thing
  A7 is forbidden to publish. **C4 and usefulness come apart in this area**, and they have not in
  any previous one.
- **C7 (provenance) fifth but load-bearing on one decision.** `src:milmove-mymove`'s per-param
  origin and `src:sirva-ade`'s `AdjCode` are already spent at [SD §4.7.2b] and [SD §6.3]; what A7
  adds from C7 is §3.8's measurement rather than a new mechanism.
- **C5, C6, C8** contribute nothing decisive. C6 is noted once, negatively: **no source ties a
  charge to the fact that caused it with a typed link**, `src:smartmoving-api`'s
  `estimatedJobChargeId` (charge → estimate line) being the closest and pointing the wrong way.

### 3.12 Explicitly rejected

Each of these was a live candidate, and each is rejected with its reason recorded rather than
omitted.

1. **A `chargeType` / `accessorialCode` vocabulary.** §3.4(a) — five names, three facets, no two
   publishers agreeing, and the catalogue is A12's by the rubric's own parenthesis.
2. **A fourth `{aspect}` member** (`INVOICED`, `COLLECTED` or `PAID`). §3.2 — a payment carries a
   counterparty, an instrument and a reversal link that [SD §4.7.2b]'s _"an amount, an approval and
   a price"_ does not admit. Held as a gate in §9, because this one has an edge the types can see.
3. **`invoice` and `payment` as aggregate kinds.** §3.2 — cheapest available mint, and still a
   three-gap trade for one.
4. **A `chargeStateAt` projection.** §3.3 — B-STAGE a third time, and it would fuse two axes that
   `src:alvys-api`'s own analysis warns about by name.
5. **A `collectable` boolean on the charge.** §3.7 — a mutable current-state field, which [SD §1.1]
   forbids on the same ground it forbids `in-transit`.
6. **Reading collectability off `evidence[]`.** §3.7 — it is precisely what [A6 §3.5]'s D-CITE
   refuses, and §375.519(d) gates an artefact the model does not have.
7. **A fourth weight basis, and a `weight.billed` type.** §3.5 — the first is [A2]'s own refusal and
   correct; the second is what [A2] should have considered and is unnecessary, because [SD §4.4]
   already resolves the case the sources are about.
8. **Widening `OffsettingRecord` for the cross-subject set-off.** §3.8 — [ORIGINAL] structure on one
   secondary source, where recording the silence is more honest and costs nothing.
9. **A capture-time diversion/stop-off classification.** §3.9 — it would put a tariff owner's
   determination in a field the recording party cannot evaluate.
10. **Taking the invoice lifecycle from `src:dp3-400ng`.** Its own analysis forbids it in as many
    words: TPPS/eBill offsets, pass-through obligations, PPSO dispute and DD 1164 local vouchers
    _"none of these generalize to commercial work, and the A7 model should not take its invoice
    lifecycle from them."_

---

## 4. What this forecloses, and the cost if it is wrong

| Decision                                | What it forecloses                                                                              | Cost if wrong                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.2 no `invoice` / `payment` aggregate | A consumer cannot ask "was this billed?" of the model at all                                    | **Low and recoverable.** [SD §1.2] is open to addition and [catalog §2.3] classes a new aggregate kind as **additive**. Adding it later costs a minor bump                   |
| §3.3 no charge-state vocabulary         | No enum to map a partner's `ivhInvoiceStatus` onto                                              | **Low now, high if reversed the other way.** Publishing one and changing it is **breaking, a new major** ([catalog §2.3]); publishing none and adding one later is additive  |
| §3.3 no `chargeStateAt` projection      | No derived billing status                                                                       | **None.** The fold has no inputs; a projection over the empty set is not a capability lost                                                                                   |
| §3.4 no charge-type vocabulary          | A fuel surcharge is not distinguishable from a line-haul charge by anything the model publishes | **Medium, and it is the one to watch.** If a consumer needs the split and A12 is never written, this is the gap they hit. §6 records it as the user's call                   |
| §3.5 overturning [A2 §3.6]              | A billable-weight cap has no home at all until [SD §4.1] gains a family                         | **Low.** The case [A2]'s three sources are about is already resolved by `R-WEIGHT-LOWER`; what is foreclosed is the one case (`billableWeightCap`) with a subject problem    |
| §3.6 ratifying [A1 §3.6]                | A pre-commitment counter-proposal is a `charge`, not a reason code                              | **Low.** Reversing it means minting a reason code, which [A1 §3.6] argues would carry one disagreement on two axes                                                           |
| §3.7 `A-COLLECT`                        | Collectability is never a field, always a rule evaluated elsewhere                              | **Medium, and asymmetric.** If it is wrong, the model has rules with nowhere to run. But the alternative is §3.3's refused state, and the seven rows are recorded either way |
| §3.8 leaving the set-off silence        | Nothing says whether an offset may cross subjects                                               | **Low.** A silence is cheaper to resolve than either a widening or a narrowing                                                                                               |

---

## 5. ORIGINAL design — what household-goods moving needs that no source supplied

Two things, and both are consequences of §2.15's observation rather than inventions on top of it.

1. **`A-COLLECT` as a named rule.** Seven published rules state collection preconditions; none states
   that collectability is therefore a rule over pairs rather than a property of the charge. The step
   from "these seven rules exist" to "so collectability is not a charge fact" is **[ORIGINAL]**, and
   it is the same step [A6 §3.5] took from "citation does not confer standing" to "citation claims
   nothing". §7 records it as an assertion no source supports.
2. **Reading the seven invoice groupings as a grain disagreement.** Each grouping is quoted; the
   reading that they constitute a sourced reason **not** to mint an aggregate — rather than seven
   candidate designs to choose among — is **[SYNTHESIS]**.

And one thing that looked ORIGINAL and is not, which is worth recording because the first draft of
§3.5 treated it as a contribution: **the billed weight's placement.** [SD §4.1] and [SD §4.4]
already decide it. A7's contribution there is an audit, not a design.

---

## 6. What only the user can decide, and what is owed elsewhere

### Owed, with an owner

| Owed                                                                             | Owner                 | Why A7 does not settle it                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`chargeValue`'s shape** — and it was **owed to the wrong area**                | **A7 / A12**, was A11 | The corpus publishes gross / net / discount in **field names** (`src:sirva-ade`, `src:atlas-world-group-api`, `src:uncefact-scrdm`) and **defines** them nowhere — `src:sirva-ade`'s own analysis calls its trio _"genuinely ambiguous"_. Blocked on the corpus |
| **`charge`'s fact-class family**                                                 | [SD §4.1]             | [SD §4.1]'s table has eight families and none of them is a money fact. A7 does not add one, because a family is a shared-layer declaration                                                                                                                      |
| **A shipment-subject, authority-decided quantity** (§3.5(c)(3))                  | [SD §4.1]             | Same gap, second instance                                                                                                                                                                                                                                       |
| **`chargeCollection`'s authority row**                                           | [A8 §9 item 8]        | Unreachable: the question does not arise until the subject exists (§3.2)                                                                                                                                                                                        |
| **Whether an `OffsettingRecord` may cross subjects** (§3.8)                      | [SD §6.3] with [A8]   | One secondary source publishes the case; declaring or forbidding it would be [ORIGINAL] on that evidence                                                                                                                                                        |
| **The `billTo` party and `payment.terms`** — who is charged is not who is served | [A8 §9 item 1]        | Both are properties of a party entity that does not exist                                                                                                                                                                                                       |
| **A typed link from a charge to the fact that caused it**                        | open                  | §3.11 — no source in the corpus has one                                                                                                                                                                                                                         |

**`chargeValue` is owed to A11 and A11 is the wrong area.** `src/assertions.ts` declares
`charge: Owed<'chargeValue', 'A11 — charge facts [SD §4.7.3]'>`, and
`src/rules/corrections.ts`'s `cancellationZeroesOut` carries a matching `TODO([SD §4.7.2b] / A11)`.
A11's rubric row is _"released vs full value protection, claims lifecycle"_ — a claims and
cargo-liability area. **The value of a charge is not a claim.** The likely cause of the
mis-assignment is visible in the primary text: `src:cfr-49-375` Appendix A defines a **valuation
charge** — a charge _for_ the liability level — which is genuinely A11-adjacent, and "the valuation
charge" and "the value of a charge" are one word apart.

**It re-points to `A7 / A12`, and the convention says so.** The house shape of an `owedTo` is
_owner — reason_, and `conditionValue`'s is **`'A4 / A10 — no document fixes the condition
vocabulary'`** — where A4 is written and **A10 is context-map-only**. So the convention names the
areas whose **subject** the owed thing is, not the area that will publish it next, and "A7 has just
declined to publish it" is no objection. A7 owns the charge; A12 owns the rating shape that
gross / net / discount belongs to. The reason half then does what [A8 §5]'s corpus-blocked rows do —
**say what the blocker is** — and the blocker is the corpus. [SD §4.7.3] gains the same sentence.

**And correcting it is a published change, which §9 found by reading the emitted diff rather than by
assuming.** `owedTo` is rendered as a `const` on **both** faces, so a producer that emitted the old
string is rejected by the new captured schema. That is the round's version story and it is recorded
at [catalog §2.3] as a new class — see §9.

### What only the user can decide

1. **Does any tenant need the line-haul / accessorial split as published data?** §3.4 refuses the
   vocabulary and A12 is context-map-only, so if the answer is yes, A12 stops being context-map-only
   and the refusal is the thing to revisit. A7 cannot answer it from external sources: the answer is
   about what our tenants sell.
2. **Is `src:dp3-400ng`'s program work in scope at all?** Five of §3.7's seven collection
   preconditions are DoD program rules. If DP3 work is out of scope, the table shrinks to the two
   `src:cfr-49-375` rows, and `A-COLLECT` keeps its argument and loses most of its instances.
3. **Which invoice grain do our tenants actually bill at?** §3.2's seven groupings include two that
   cross shipments. If a tenant bills per statement rather than per shipment, the missing aggregate
   is larger than "an invoice".

---

## 7. Confidence

| Decision                                            | Confidence      | What would change it                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §3.2 no act on a charge has a record                | **High**        | Reading [SD §4.7.1] and [SD §1.2]; both are complete declarations and neither has the row or the kind                                                                                                                                                                                      |
| §3.2 the grain disagreement is the reason           | **Medium-high** | A source that reconciled two of the seven groupings, or a user answer to §6's question 3                                                                                                                                                                                                   |
| §3.3 charge state refused                           | **High**        | It would take a publisher whose vocabulary another publisher adopted. Eleven positions, no two alike                                                                                                                                                                                       |
| §3.4 the taxonomy is not one axis                   | **High**        | The five definitions are primary text and they cut on different things in their own words                                                                                                                                                                                                  |
| §3.4(c) `context[]` does not reproduce the taxonomy | **High**        | Three of seven rows fail; one failure would suffice                                                                                                                                                                                                                                        |
| §3.5 overturning [A2 §3.6]                          | **High**        | [SD §4.1] and [SD §4.4] are binding text, and [A2] explicitly delegated the decision                                                                                                                                                                                                       |
| §3.6 `PRINCIPAL` reaches pre-commitment             | **Medium-high** | [A8 §4.3]'s definition is decisive on the mechanism; the corpus evidence for the roles is three sources, two of them secondary                                                                                                                                                             |
| §3.7 `A-COLLECT`                                    | **Medium**      | It is the round's one [ORIGINAL] step, and its base is thinner than seven rows suggests: **two** genuinely independent publishers, since two of the three sources are the same DP3 programme (§3.7). A source that said a charge carries its own collectability would refute it; none does |
| §3.8 three of four fit                              | **Medium-high** | The reimbursement row is a reading of Item 35.1 rather than a quotation of it                                                                                                                                                                                                              |
| §3.9 no capture-time classification                 | **High**        | Item 28.4's three exclusion conditions are each about facts the recording party does not hold                                                                                                                                                                                              |
| §3.10 ratifying [SD §8.4]                           | **Medium**      | A7's premise is real but is a stake rather than a source; [SD §8.4]'s own single premise is unchanged                                                                                                                                                                                      |

### Assertions made here that no source supports

1. **`A-COLLECT` itself** (§3.7). Seven sources state preconditions; none states the generalisation.
2. **That the seven invoice groupings constitute a reason not to mint** (§3.2), rather than a menu.
3. **That [A8 §4.3]'s five bindings split into those resolved against a party or nothing
   (`PRINCIPAL`, `SCHEME`, `NONE`) and those resolved against records (`CUSTODY`, `ASSIGNMENT`)**,
   and that only the second group fails pre-commitment (§3.6). Checked against all five, but the
   split is ours and [A8] does not draw it.
4. **That C4 and usefulness come apart in this area** (§3.11). A judgement about the corpus.

---

## 8. Acceptance — the nine scenarios, run explicitly

### 1. Five families' goods on one van over four days — **A7 is silent, with one note**

Nothing in A7 turns on consolidation. The note: each family's charges are scoped to **its own**
shipment, and `charge`'s `context[]` has no `trip` member (§1), so the van's cost side has no home
here and is A13's. That is a correct silence rather than a gap.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **A7 contributes a triage and a refusal**

Every storage charge is a `charge` with the `stay` in `context[]`, which [A5] already established
needs no new mechanism. §3.10 triages A5's five handed-over items: one was already answered (§3.5),
four are A12's rating arithmetic. What A7 adds is negative and useful: **the model cannot say the
delivery-out charge was billed**, and `src:dp3-tender-of-service` §C.3.h's denial-for-want-of-notice
is a §3.7 rule whose gating fact is a notification the model also cannot record (`notification`'s
recipient has no field — [SD §4.7.3]).

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **A7 is decisive on one point**

`src:dp3-tender-of-service` NTS §5.9 makes an **attempted delivery a priced event**: the crew waits
one hour, returns the goods, and drayage plus handling-out is billed on actual weight; and
`src:dp3-400ng` Item 17-1.1.b makes the return **restart a first-day storage charge**. Both are
charges scoped to a `stopAction` and a `stay`, and both are expressible. What is not: whether the
`src:dp3-400ng` Item 17-1.4 **pre-approval obtained while the crew is at the delivery point** was
given — that is a `charge` at `DECIDED` (§3.7's subtraction), and it is expressible; but whether the
resulting charge may be **collected** is `A-COLLECT`, and the rule has nowhere to run.

### 4. A reweigh in transit — **A7 is decisive, and this is §3.5's scenario**

The scenario's own test file carries the sentence that handed §3.7 to A7. A7 answers it twice over.
The **billed** weight is `weight.net` resolved by `R-WEIGHT-LOWER` — [SD §4.4]'s middle source row
is `src:dp3-400ng` Item 4.11.d, _"invoice on the lesser weight"_, which is this scenario exactly. And
§375.519(d)'s collection rule is `A-COLLECT`'s primary row: both tickets must accompany the freight
bill, the freight bill is not in the model (§3.2), and the pair is recorded rather than evaluated.

### 5. A car on a separate carrier, delivered a week apart — **A7 is silent**

Two shipments, two sets of charges. Nothing in A7 distinguishes them.

### 6. Cancelled after packing, before loading, with materials charged — **A7 is decisive, and it is the round's sharpest scenario**

This is where every A7 decision meets at once.

- The packing materials charge is a `charge` scoped to a `stopAction` — §3.4(b), and it depends on
  [SD §8.4]'s pack-only day having a stop to anchor to, which §3.10 ratifies.
- `src:cfr-49-375` §375.401(i) permits amending the estimate **only before loading**, and
  §375.403(a)(7) makes loading itself a **reaffirmation by silence**: _"Once you load a shipment,
  failure to execute a new binding estimate or a non-binding estimate signifies you have reaffirmed
  the original."_ Here loading never happened, so the window never closed — and A7 records that
  **the model has no way to express reaffirmation by an act either way**. This is the **second
  instance of [A6 §3.7]'s capture-method gap**: [A6] found condition asserted **by omission** and
  handed the gap to A4; here a price is reaffirmed by **not acting**, at a moment another
  aggregate's act defines. Same shape, different area, different source — which materially
  strengthens A4's owed item rather than repeating it. §Cross-area.
- Whether the materials charge survives the cancellation is a **rating** question
  (`src:dp3-400ng` Item 17-2.7's refund of prepaid-but-unperformed services via 226A), and the
  refund itself is an `OffsettingRecord` — §3.8's first row, which fits.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **A7 is silent, and the silence is §2.15's**

A charge is never observed, so a two-asserter contest over an observation has no A7 analogue. The
`charge` fact key's three-way `{aspect}` split means the three parties who **do** assert about money
are not in contest with each other at all — [SD §4.7.2b]'s whole point.

### 8. A mid-journey custody handoff — **A7 is silent**

`charge` is `boundBy = PRINCIPAL`, which by [A8 §4.3]'s definition _"moves only when the principal
changes"_ — and a custody handoff does not change the principal. That is a clean negative and it is
worth one line: **the charge's authority does not move when the goods do.**

### 9. A partial load under one bill of lading — **A7 is decisive on two points**

`src:cfr-49-375` §375.403(a)(11) prorates the charges by **delivered weight over total weight**, and
§375.707(b) makes constructive weight the basis where part is lost. Both are §3.5(c)(2) — rating
arithmetic over a resolved weight, A12's. And §375.709's total-loss rule is `A-COLLECT`'s second
primary row: on a **total** loss the carrier may collect nothing but the valuation charge, which is
a collection rule whose gating fact is about the **shipment**, not about the charge.

### Summary

A7 is decisive in four scenarios, contributes a triage in one, and is silent in four. The silences
are concentrated exactly where §2.15 predicts: nothing observed is a charge.

---

## Cross-area consequences to record

### To [SD] — one owed target corrected, one confidence row settled, one absent class added

1. **§4.7.3 gains `chargeCollection`** as an absent-and-owed fact class, on the same terms as every
   entry there, with §3.2's blocker named: the subject does not exist.
2. **§4.7.3's owed note for the charge value is amended** to say the blocker rather than an area.
   A11 is a claims area and the value of a charge is not a claim (§6); the shape is blocked on the
   corpus, which publishes gross / net / discount in field names and defines them nowhere.
3. **§8.4's confidence row is settled.** Its text says the decision is _"still cheap to reverse
   before A5 and A7 are written and expensive after."_ Both are now written. The row records that
   A7 ratified it on an independent premise (§3.10) and that the reversal window has closed.

### To [catalog] — one new change class, one bump, one count, and two gaps recorded

1. **§2.3 gains `repointedOwedOwner`**, the third use of the argument A4's `publishedOwedVocabulary`
   and A5's `publishedOwedShape` share, and the weakest of the three because it **resolves nothing**
   — A4 and A5 each closed a gap; A7 corrected a gap's label and left the gap open. Its restriction
   is recorded the way §2.3 records the other two: a producer or consumer that pinned the exact
   `owedTo` text is broken, and nothing else is.
2. **§2.4 gains the `0.5.0` → `0.6.0` row**, with the observation that it inverts A2's and A6's
   pattern: **none of A7's decisions moves a byte**, and the round's **audit** does.
3. **§5's absent count moves 15 → 16**, with a paragraph for `chargeCollection` on A2's and A6's
   pattern, and a second recording that A7 **corrected an owner in the inventory** rather than only
   adding to it — which no previous round has done.
4. **Two gaps recorded and not closed.** §2.3 has **no rule for a breaking change while the catalog
   is pre-1.0** — the Breaking column says _"a new major"_ and §2.4 forbids a `1.0.0` while §5's
   inventory stands. A7 classifies additive, so it does not need the rule and does not invent it.
   And **`owedTo` being emitted as a `const` makes every future owner-correction a version bump**,
   which is a property of the generator rather than of any area's decision.

### To [A2] — one hand-off answered, and answered against it

[A2 §Cross-area] (a) and [A2 §3.6]'s billable-weight placement are **overturned**, on [SD §4.1] and
[SD §4.4] (§3.5). [A2] delegated the decision in as many words — _"A7 decides whether that holds"_ —
so this is the delegation working rather than a disagreement. [A2]'s To-[A7] is marked answered with
a pointer, on [A5]'s precedent for a hand-off that turned out to be already discharged.

### To [A1] — one hand-off answered, and answered for it

[A1 §Cross-area]'s doubt about `PRINCIPAL` is resolved: it reaches the pre-commitment proposal, and
[A1 §3.6] item 1's placement stands unchanged (§3.6). Row 11 needs no amendment, so nothing is asked
of [A8].

### To [A4] — one conditional confidence row discharged, and one owed item strengthened

1. **[A4 §4.6]'s condition is met.** Its confidence row makes `INSTRUCTED_CHANGE`'s rating
   conditional on A7 deciding whether it needs the diversion/stop-off distinction at capture time.
   §3.9 decides it does not, and gives three reasons drawn from the tariff's own exclusion
   conditions. The row is settled rather than left conditional.
2. **[A6 §3.7]'s capture-method gap gains a second instance, from a different area and source.**
   `src:cfr-49-375` §375.403(a)(7) makes loading a **reaffirmation by silence** of a price
   proposal — the same "silence is a positive assertion" shape [A6] found in condition-by-omission,
   at a moment defined by another aggregate's act. A4 owns the capture vocabulary; this is evidence
   for the member it is owed, not a second request.

### To [A8] — nothing asked, and two things recorded **here** rather than written into [A8]

1. **Row 11 is confirmed against two questions and changed by neither** — §3.6's `PRINCIPAL` and
   §3.7's pre-approval, which row 11's `DECIDED` already carries.
2. **The set-off silence** (§3.8): `OffsettingRecord.offsets` says nothing about whether an offset
   may cross subjects, and `src:dp3-tender-of-service` NTS §5.8.2 publishes the cross-subject case.
   Row 11 already names `SetoffAgent`, so the party is not the blocker. Recorded for whoever
   evaluates `cancellationZeroesOut`'s existing TODO.

### To [A5] — its charge surface, triaged

§3.10's second table answers all five handed-over items. One was already answered elsewhere; four
are A12's rating arithmetic. None needs a mechanism, which is what [A5] predicted.

### To [A11] and [A12]

- **[A11]**: `chargeValue` is not yours, and §6 says why. What **is** A11-adjacent and is recorded
  here rather than claimed: `src:cfr-49-375`'s **valuation charge** is the one charge collectable on
  a total loss (§375.709), so the claims area and the charge area meet at exactly one row of
  `A-COLLECT`'s table.
- **[A12]**: three questions are returned to you rather than answered — the line-haul boundary as a
  distance threshold (§3.4(d)), the tariff minimum and the regulatory proration (§3.5(c)), and the
  diversion/stop-off category as a `RATED` fact (§3.9). All three are already in your scope; they
  are listed so that a later reader does not think A7 dropped them.

### To [`../rubric.md`]

The A7 row's `Covers` column reads as three deliverables and is one deliverable, one refusal and one
absence. A note is added beside [A6 §3.8]'s, recording that A7's row is the second whose column is a
prompt rather than an inventory, and that _"detail of rating out of scope"_ does more work in it than
any other parenthesis in the table — it removes the part of the area the corpus covers best.

---

## 9. What this puts in the executable specification, and how each part is held

| Part                       | Where                                                                                   | How it is held                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`A-COLLECT`**            | `COLLECTABILITY_IS_A_RULE_OVER_PAIRS` in `src/rules/charges.ts`                         | A named rule, registered in `RULES`; the seven rows are a data table, not prose                                             |
| The seven preconditions    | `data/collection-preconditions.json` + its loader                                       | A table with a gating aggregate kind per row, and a conformance test that **enumerates** the rows rather than counting them |
| The state refusal          | `CHARGE_STATE_IS_NOT_COMPUTABLE` in `src/rules/charges.ts`                              | A plain `= true`, and the docstring says why it is not a gate                                                               |
| **The aspect refusal**     | `ChargeAspectsAreTheThree` in `src/rules/charges.ts`                                    | **A gate.** §3.2's claim that a payment is not a fourth aspect is false the moment a fourth is minted                       |
| The billed-weight audit    | a docstring on `R-WEIGHT-LOWER`'s neighbourhood, and §3.5                               | Prose. Nothing is minted, so there is nothing to gate                                                                       |
| The owed-target correction | `src/assertions.ts`'s `Owed<'chargeValue', …>` and `src/rules/corrections.ts`'s TODO    | The glossary's Owed section reads the `Owed<>` string, so the correction is published                                       |
| The absent class           | `chargeCollection` in `ABSENT_AND_OWED` + [SD §4.7.3] prose + the `AS_WRITTEN` entry    | A **two-file** change plus a test-table entry, which `documents.test.ts` enforces                                           |
| Registration               | `A7` in `DOCUMENTS`; `A-COLLECT` in `RULES` — `tools/generate-glossary.ts`              | Neither is auto-discovered                                                                                                  |
| **Version**                | `CATALOG_VERSION` **`0.5.0` → `0.6.0`**; class at [catalog §2.3], row at [catalog §2.4] | `repointedOwedOwner`. **Not caused by any decision in this document** — see below                                           |

### The version moved, and no decision in this document moved it

A2 and A6 each made decisions and changed no published byte. A7 inverts that. Its decisions likewise
move nothing: §3.2 mints no aggregate, §3.3 and §3.4 publish no vocabulary, and `chargeCollection` is
one more member of the owed inventory, which [catalog §5] has already distinguished from a change to
what is published. **What moved the version is §1's audit** — §6's correction of `chargeValue`'s
owner — because `owedTo` is rendered as a **`const`** on both emitted faces. The diff is one line per
schema, and it is a line no decision here put there.

It was found the way [catalog §5] says to find it, and the reasoning had started the other way: an
owed marker's owner _feels_ internal, and the two non-bump precedents made "A7 changes nothing on the
wire" the expected answer. **The schema diff said otherwise**, which is the third time that sentence
has been operative — after `keySideRole` at A8, and after A2's and A6's empty diffs being the
evidence for their non-bumps rather than the claim.

Two consequences are recorded at [catalog §2.3] and neither is closed here: §2.3 has **no rule for a
breaking change while the catalog is pre-1.0** (not needed, since this classifies additive), and
**every future owner-correction will cost a bump** for the same reason this one did.

### Why the aspect refusal is a gate and the state refusal is not

[A5 §9]: a bare `Exact<>` alias is a comment until something is assigned to it. [A2 §9]: an assigned
one can still be a tautology, because `Exact<keyof typeof T, K>` over a mapped type can never fail —
_"an `Exact` earns its place only between two things declared independently."_ [A6 §9] shipped the
positive case and stated the generalisation: **gate a recorded gap when the gap has an edge the
types can see, and say why when it does not.**

§3.2's claim has an edge. _"A payment is not a fourth `{aspect}` value"_ is false the moment
`QualifierByType['charge']['aspect']` gains a member. So the three names are written out **in A7's
own module, from A7's own reading of [SD §4.7.2b]** — nothing generates them from `vocabulary.ts`
and nothing generates the qualifier from them. A fourth member makes the `Exact` `never`, the
assignment below it stops compiling, and whoever added it is sent to §3.2.

§3.3's claim does not. _"Charge state is not computable"_ is false only when a fact class is minted,
and a mint already touches three files and a test table. It is a plain `= true`, and the docstring
says so rather than leaving a reader to wonder why the two neighbours differ.

`A-COLLECT` is held a third way again, and deliberately: **seven sourced rows are data, not a
constant.** [A6 §3.6]'s `TABLE_A_402_4_LANDINGS` is the precedent, and [A1 §9]'s rule — prefer a
gate that enumerates over one that counts — is why the conformance test lists the rows by their
gating aggregate kind rather than asserting there are seven of them.
