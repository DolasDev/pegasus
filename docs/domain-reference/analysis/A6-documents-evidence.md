# A6 — Documents & evidence

Cited elsewhere as **[A6 §x]**.

> **Status.** A decision document and the area comparison for A6. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope.** A6 owns the **document**: what the `document` aggregate is a subject of, what citing one
> in `evidence[]` means, and what may be said about a document's own identity, issuance and
> mutability. It is **not** the condition vocabulary, which is `conditionValue`, owed to A4 and A10;
> it is **not** the identifier scheme list, which is A9's; it is **not** the correction machinery over
> facts, which [SD §6] settled; and it is **not** the survey or the estimate, which are A10's and are
> [SD §4.7.3]-absent.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged, plus one this area needs stated.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is. A6's
   trap is the second widest after A2's, because four of our own systems publish a document model and
   three of them publish a document **state machine**: `src:pegasus-cloud-prisma` runs
   `PENDING_UPLOAD → ACTIVE → ARCHIVED | PENDING_DELETION`, `src:pegasus-cloud-domain` runs an upload
   machine with a terminal `FAILED`, `src:pegasus-integration-floors` publishes a ten-field
   `document_record`, and `src:pegii-order` has a positional `DocumentationDates` array. All four are
   ours. None is in §2, and the absence is deliberate — §3.4 refuses a document-state enum, and it
   would have been the easiest refusal in the corpus to lose by reading one of these first.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** §6 carries what A6 does not settle and names who owes it.
4. **Primary where we have it, and said so where we do not.** Of the ten sources that score 2 or
   better on A6, exactly one has a `captured/` directory: `src:cfr-49-375`. Every quotation from
   `src:dtr-part-iv`, `src:dp3-tender-of-service`, `src:dp3-400ng`, `src:samsara`, `src:nmfta-ebol`,
   `src:smartmoving-api`, `src:project44`, `src:open-trip-model` and `src:sirva-ade` is **secondary**
   — it is the source analysis's text, not the source's. §2 marks each. Where a decision rests on a
   quotation, §7 says whether the quotation is primary.

---

## 1. The question, stated sharply

Seven things are owed to this area by name. Every one is a sentence in a binding document, a live
marker in `packages/domain-reference/src/`, a hand-off from a landed area, or the rubric's own row,
that says A6 decides it.

| #   | Owed item                                                                                                                                                                                                                     | Owed by                                                                                                          | Settled at |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **Which subject an identifier on a document attaches to.** `identity`'s declared family is `anyAggregate`, which admits a `document` **subject**, and its `context[]` also carries `document`. Nothing says when to use which | [SD §7.1]; [SD §4.7.1]'s `identity` row; `data/canonical-subjects.json`                                          | §3.2       |
| 2   | **Whether the acts performed _on_ a document have records.** _"no record type has `document` as its canonical subject"_ — the A2 check, pointed at A6                                                                         | [A2 §Cross-area] to [A6]; [A2 §3.6]'s instruction to A6, A7 and A9                                               | §3.3       |
| 3   | **Document state.** `src:dtr-part-iv`'s own recorded limit: document state _"is described in prose, never enumerated"_. And [SD §1.2]: _"A6 may narrow it, never remove it"_                                                  | `sources/dtr-part-iv/analysis.md`, the A6 row; [SD §1.2]                                                         | §3.4       |
| 4   | **What `evidence[]` means.** _"What `evidence[]` **means** — whether citing a document is a claim about it, how a signature is modelled, retention — is A6's and is not decided here"_                                        | [`fork-time` §5.6]; `src/assertions.ts`'s `EvidenceRef` TODO; `src/rules/e-canon.ts`'s TODO; the `FINDING:` test | §3.5       |
| 5   | **The correction regime over a document.** SF 1200's before/after/authority structure and Table A-402-4's closed mutability whitelist — _"A6 owns that regime"_                                                               | [A2 §Cross-area] to [A6]; [`fork-order` §6] user question 5; `src/rules/authority.ts`'s `Instrument` TODO        | §3.6       |
| 6   | **Condition asserted at both ends of a stay**, from `src:dp3-400ng` Item 17.12 — _"applied at a boundary A6 has not yet looked at"_                                                                                           | [A5 §Cross-area] to [A6]                                                                                         | §3.7       |
| 7   | **Order for service, estimate, inventory, BOL, weight tickets, POD, photos; documents as evidence for events**                                                                                                                | [`../rubric.md`](../rubric.md), the A6 row                                                                       | §3.8       |

### The first finding: owed item 6 was discharged before A6 opened it

[A5 §Cross-area] hands A6 `src:dp3-400ng` Item 17.12 as _"the sharpest A6 material in the storage
corpus"_, and reads its consequence as _"a `condition` assertion per article at **both** ends of a
stay, which is [SD §5.4]'s item grain and [A8 §5] row 9's joint holding, applied at a boundary A6 has
not yet looked at."_

**[A8 §5] row 9 already cites that clause, by number, as its lead citation.** Row 9's evidence column
opens _"`src:dp3-400ng` Item 17.12.c — **both** TSP and warehouseman must hold 'the condition of
**each article** when received at and forwarded from the storage location'"_, and goes on to cite
`src:cfr-49-375` §375.503, `src:dp3-tender-of-service` NTS §1.6.2's condition-by-omission and
§C.9.a(22)'s "misc." waiver, and NTS §1.6.10 — which [A8 §7.3] quotes verbatim as **A8-JOINT**'s
source sentence. Row 9 is described there as _"the best-sourced row in the document"_, and A5's
hand-off names four of its five citations.

So A5 handed A6 a hand-off that A8 had already taken, and the boundary A5 said A6 had not looked at
is the boundary A8-JOINT was written for. **What survives is one sentence of it** — that the two ends
of a _stay_ are custody boundaries in A8-INSTANT's sense, so row 9's joint holding reaches them — and
[A5 §3.3]'s own decision that a stay is neither a stop nor a service at a stop already settles that a
`storeIn`/`storeOut` pair is where the goods change hands. §3.7 records what is left, which is not a
`condition` question at all.

This is the third consecutive round in which auditing the hand-off pile found an item already
discharged — [A2 §1] found [SD §10.2]'s "seventeen-item backlog" applied, and before it [A4] found the
owed ledger blind to a class of owed value. **Audit what a plan says is owed before designing around
it** is now a rule with three instances, and it is [A2 §1]'s rule.

### The second finding: the resumption plan's source list omits the only grade-A source

`plans/in-progress/domain-reference-areas-a6.md` §6 item 3 names `src:dtr-part-iv` as A6's best
source — _"scores `3/3/2/3/1/3/3/1` on A6… **C7 = 3**, its highest in any area"_ — and §6's closing
paragraph lists A6's _"own best sources, from the score rows"_ as `src:dtr-part-iv`, `src:dp3-400ng`
Items 4.10 and 17.12, `src:cfr-49-375`, `src:nmfta-ebol`, `src:gs1-epcis-cbv` and
`src:x12-212-trailer-manifest`.

`src:dp3-tender-of-service` is in neither list. It scores `3/3/2/3/2/3/3/1` on A6 — **the same or
better than `src:dtr-part-iv` on every criterion**, one higher on C5 — its own analysis calls A6 its
_"second-strongest area"_, and it is **evidence grade A**, read cover to cover, where
`src:dtr-part-iv` is **grade B** with every form figure unread. Three more omissions matter:
`src:samsara` scores `3/3/3/0/3/3/3/3` and is the strongest document _mechanism_ source in the
corpus; `src:smartmoving-api` is the only source that publishes HHG-native document **types** and the
only one that publishes **two orthogonal typing axes**; and `src:dcsa` publishes the one generic
document-state vocabulary applied across 23 document types, which is §3.4's central temptation.

Recorded because §3.4's refusal and §3.5's decision both rest on sources the plan did not name, and a
reader checking A6's reasoning against the plan's list would not find them.

### What is already fixed above A6, and is quoted rather than re-derived

- **`document` is an aggregate**, and the decision is [SD §1.2]'s: _"A6 is not written, but weight
  tickets, the BOL and the inventory are asserted about and evidenced against, and 400NG Item 4.10
  makes a weight ticket a six-field record with its own retention rules. **[ORIGINAL]** as an
  envelope decision; A6 may narrow it, never remove it."_ A6 narrows it in §3.2 and §3.3 and removes
  nothing.
- **`evidence[]` is the slot**, [SD §4.1]: _"refs to documents / other assertions"_. [SD §1.1] adds
  what it is for — _"one record's relevance to another is evidentiary rather than structural (the
  notification that carries an ETA; the weight ticket behind a weighing)"_ — and says this is _"half
  the reason the generic `correlation` bag could be deleted."_ **A6 does not move the slot.** It
  decides what a citation in it claims.
- **Corrections over facts are settled**, [SD §6]: three recorded outcomes (`APPLIED`,
  `INEFFECTIVE`, `UNAUTHORISED`), no refusal path, EPCIS's retraction rule, the priced record's
  offsetting-only rule, and `Correction.authority` naming an **instrument** rather than a party.
  §3.6 adds nothing to this machinery; it reads a published whitelist against it.
- **The instrument type is [A8 §8]'s**, with `INSTRUMENT_KINDS` already carrying
  `DISTRIBUTION_OBLIGATION` for `src:dtr-part-iv` §E.3's cancel-and-notify-everyone rule, and
  `Instrument.grants` already scoped by the fact classes an instrument may touch.
- **Joint holding at a custody boundary is [A8 §7.3]'s A8-JOINT**, and row 9 is its foundation. A6
  does not reopen it — see the first finding above.
- **Identity is [SD §7]'s**, with **I-KEY** over `(subject, scheme, vocabularyScope)` and
  `boundBy = SCHEME` meaning _"the ISSUER of the scheme, and nobody else, for the value under that
  scheme. Authority NEVER moves"_ ([A8 §5] row 10). §3.2 mints no scheme and no identifier; it
  decides which **subject** a value under a scheme attaches to.
- **The undertaking is the thing and the document is its record**, [A2 §3.2]'s **B-ONWARD**. §3.3
  sharpens one half of this and §3.4 depends on it.
- **The capture methods are [SD §5.1]'s seven**, and M1–M7 are [SD §5.2]'s. §3.7 finds one thing the
  set cannot express and hands it to A4 rather than adding a member.

### The structural fact this document keeps running into

> **The `document` aggregate is a subject with no facts and an object with no acts.**

`document` is a member of `AGGREGATE_KINDS` and has an `AggregateId.document` and a
`SubjectRef.document` in both published schemas. It appears in `context[]` on six rows of
[SD §4.7.1] — all three weights (`weight.net`, _"document is the weight ticket"_; `weight.gross`;
`weight.tare`), `pieceCount` (_"document is the inventory"_), `condition` (_"document is the signed
inventory"_) and `identity` (_"document is the instrument the value appears on"_). And **no row of
[SD §4.7.1] declares a `document` canonical subject family.**

The count is six and not five, and the correction is worth recording because it came from the gate
rather than from the reading: a first draft of this section wrote five, and
`tests/conformance/document-identity-and-evidence.test.ts` — which enumerates the rows rather than
counting them — named `weight.tare` as the sixth. That is [A1 §9]'s rule working in the direction it
was written for.

That is exactly [A2 §3.6]'s finding in a second area, and A2 told A6 to expect it: _"A6 should expect
to meet A2's structural finding in its own area: check first whether the act that issues, certifies or
corrects a document has a row, before designing on the assumption that it does."_ §3.3 ran the check.

The half A2 could not see is the other half, and it is §3.2's: **one declared type can already take a
`document` as its subject today.** `identity`'s canonical family is `anyAggregate`, quoted in the
data table from [SD §7.1] — _"subject may be ANY aggregate kind"_ — and `anyAggregate`'s member list
includes `document`. So the model already admits an assertion **about** a document; it has never said
which assertions those are.

### Why getting this wrong is expensive

1. **A document-state enum is a one-way door.** [catalog §2.3] makes a published member's spelling a
   **breaking change**, and a state enum is the largest vocabulary A6 could publish. Six publishers
   offer one; §3.4 shows no two decompose it the same way.
2. **A document-state _projection_ is worse than the enum.** It would look like `custodyAt` and
   `orderStageAt` and be **B-STAGE** again — [A2 §3.6]'s finding that `fork-order` §5.2 has been _"a
   projection with no input records since it was written."_ A fold needs records to fold.
3. **Getting `evidence[]` wrong silently converts a citation into a claim.** If citing a weight
   ticket asserts the ticket's contents, then a party who cites someone else's document has asserted
   a fact they have no authority over, and [SD §6.1]'s `UNAUTHORISED` row fires on a correct record.
4. **An identifier on the wrong subject breaks the contest.** [SD §1.3] pairs competing assertions on
   `(subject, type, qualifier?)`. A bill-of-lading number filed against the shipment and the same
   number filed against the document are two different fact keys, so the model would carry one value
   twice and never notice.

---

## 2. The positions in the external corpus

Twenty-two external sources score non-zero on A6 — more than on any area but A2 — and the area splits
cleanly in two. The **HHG regulatory and contract sources** say what documents _do_: who issues them,
who signs them, what their silence means, what may be corrected and by what instrument. The
**telematics, ocean and API sources** say what a document _is_ as a data object: a type, a state, a
version, a scope, a binary. Almost no source does both, and the one that comes closest to linking a
document to the event it evidences is the one with the least HHG content.

Scores are quoted as `C1/C2/C3/C4/C5/C6/C7/C8` from each source analysis's A6 row.

### 2.1 "A bill of lading is both the receipt and the contract" — `src:cfr-49-375` (grade A, **primary**, `3/3/2/3/2/2/3/1`)

The only A6 source whose primary text is in `captured/`, and the analysis calls it _"the best source
in this cluster for A6."_ §375.103 defines the instrument in one sentence:

> **"Bill of lading means both the receipt and the contract for the transportation of the individual
> shipper's household goods."**

That is the sentence this whole area turns on, and §3.3 reads it. Everything else here is primary too:

- **§375.505(a)** _"Before you receive a shipment of household goods you will transport for an
  individual shipper, you must prepare and issue a bill of lading."_ The **carrier** issues it.
- **§375.505(b)**, seventeen enumerated items, including **(b)(15)** _"Each attachment to the bill of
  lading. Each attachment is an integral part of the bill of lading contract"_, naming the estimate
  and the inventory, and **(b)(16)** _"Any identification or registration number you assign to the
  shipment"_ — a separate item from the bill-of-lading number itself.
- **§375.505(c)** a copy accompanies the shipment at all times, and _"Before the vehicle leaves the
  residence of origin, the bill of lading must be in the possession of the driver responsible for the
  shipment."_
- **§375.505(f)** _"You and the individual shipper must sign the bill of lading prior to the shipment
  being loaded. The bill of lading must be signed at both the origin and the destination."_
- **§375.505(g)** blank or incomplete documents **may** be provided; an **incomplete** one may be
  required to be signed _"provided it contains all relevant shipping information except the actual
  shipment weight and any other information necessary to determine the final charges for all services
  performed"_; and **(g)(3)** _"You may not require an individual shipper to sign a blank document."_
- **§375.505(h)** signed and dated _"at least 3 days before the shipment is scheduled to be loaded"_,
  with a **3-day rescission** right after signing, and an explicit non-restart rule: changes to the
  bill of lading flowing from a new estimate _"do not require a new 3-day period."_
- **§375.503** the itemised inventory: an identification number per article, prepared before or at
  loading, a copy **signed by both** parties furnished before or at loading, and at delivery the
  shipper's opportunity to verify _"that the same articles are being delivered and the condition of
  those articles"_ and to _"note in writing any missing articles"_ and receive a copy of the
  notations. Retained one year _"as an attachment to be made an integral part of the bill of lading
  contract."_
- **§375.519** _"The weigh master must sign each weight ticket"_; **a separate ticket per weighing**;
  six enumerated items ending at _"The carrier's shipment registration or bill of lading number"_;
  the **original** retained in the shipment file; and **(d)** _"All freight bills you present to an
  individual shipper must include true copies of all weight tickets obtained in the determination of
  the shipment weight in order to collect any shipment charges dependent upon the weight
  transported."_
- **§375.513 / §375.515** the shipper may observe **all** weighings; electing not to observe a
  weighing _"is presumed to have waived that right"_, but declining a **re**weighing _"must waive
  that right in writing."_
- **§375.701** the delivery receipt _"must not contain any language purporting to release or discharge
  you or your agents from liability"_, and **may** state the property was _"received in apparent good
  condition **except as noted** on the shipping documents."_
- **§375.609(f)-(g)** keep _"a record of notifications"_; failure to notify _"will automatically
  effect a continuance of your carrier liability"_ until the end of the day following actual notice.

C3 is held at 2 because the lifecycle is real but unnamed — issue, sign at origin _and_ destination,
three-day rescission, amend only by attachment, retain one year — and no state is enumerated.

### 2.2 "Every document has an issuer, a distribution list and a retention rule" — `src:dtr-part-iv` (grade B, secondary, `3/3/2/3/1/3/3/1`)

A document-centric regulation with fourteen named instruments — BL, SF 1200, DD 1299, DD 1797,
DD 1780, DD 1814, DD 1857, DD 1164, DD 619, DD 1840/1840R, DD 1384 TCMD, warehouse receipt, weight
tickets, Diversion Certificate. Four things here are used by §3, and all four are secondary because
`dtr-part-iv` has no capture and every form figure is a scanned image:

- **The BL number is accountable stock.** A-413 §C.2: numbers are serially pre-assigned; a
  laser-generated BL _"is only accountable when a number has been assigned to the form"_; lost,
  stolen and void numbers must be reported to DoW PPA; audits every 180 days. §3.2's discriminator.
- **SF 1200's structure.** Blocks 11 _Bill of Lading Now Reads_ / 12 _Correct Bill of Lading to Read_
  / 13 **Authority for Correction** / 14 Remarks — before-value, after-value, justification, narrative
  — one BL per notice, with the initiating official's and the TSP representative's signatures
  (A-413 §F.1.b).
- **Table A-402-4 is a closed mutability whitelist** (p. 47): agent code, Code of Service,
  pack/pickup/required-delivery dates, member identity and authorized weight, orders number and date,
  extra pickup and delivery addresses, TCN, consignee and delivery address, pickup address,
  accounting codes, remarks. _"Everything else on the BL is immutable; to change it you cancel and
  reissue."_ §3.6's table.
- **Who may correct, and the 30-day silence rule.** A-413 §H.2: a consignee who believes a correction
  is needed notifies the issuing office, and _"if a reply to this notification is not received within
  30 days, the consignee is permitted to make alterations or corrections"_ — unless the correction is
  obviously needed to _"reflect the exact facts relating to the shipment"_, in which case at once.
  [A8 §8]'s instruments are already evaluated at an instant for exactly this shape.

Two more are cited in §3 and §4: the **warehouse receipt** as _"a nonnegotiable document of title
whose original must exist exactly once — scan it and you must destroy the paper"_ (A-406 §B.2.d), and
the issuance precondition that _"the BL cannot be printed until pre-move survey weight and agreed
pack/pickup dates are in DPS"_ (A-402 §F.1 NOTE). The A6 row is **docked on C3** for the reason §3.4
generalises: document state _"is described in prose, never enumerated."_

### 2.3 "The inventory is the evidentiary artifact, and its silence is an assertion" — `src:dp3-tender-of-service` (grade A for the HHG tender, secondary, `3/3/2/3/2/3/3/1`)

The source the resumption plan omitted, and the one §3.4 and §3.5 lean on hardest. Its own analysis
calls A6 its second-strongest area. Secondary throughout — the tender has no capture, and its symbol
legend is an image its analysis flags as _"a real loss."_

- **E-signature that binds.** §C.9.a(4)-(11): the customer must be able to review every comment,
  condition and exception and annotate exceptions **per line item** before signing; the electronic
  signature is taken **separately on each individual page**; **the inventory must not be editable once
  signed**; the customer's copy must be received **before the property leaves the residence**; and a
  handwritten fallback must exist for equipment failure.
- **Condition by omission, with the burden assigned.** §C.9.a(14): _"the omission of these symbols
  will indicate good condition except for normal wear."_ The NTS tender turns it into a burden rule
  (§1.6.2): absent condition codes, items are assumed in good working condition and _"failure of
  electronic items will be assumed to be transit related"_, and the escape code "Mechanical Condition
  Unknown" is permitted only in documented instances and **still does not bar a claim**. §3.7.
- **Waiver by vagueness.** §C.9.a(22): describing carton contents as "misc." means the TSP _"agrees
  not to contest a claim for missing items related to the nature of such cartons."_
- **A negative that is explicitly not evidence.** §C.9.a(24): _"a signed bingo card or check-off sheet
  does not indicate proof of delivery and lost, missing or damaged items will still be indicated on
  the appropriate loss or damage forms."_ §3.5's decisive sentence.
- **Document packages by recipient and by moment.** §C.12.a-b: the full set to the PPSO no later than
  7 GBD — weighted BL, weight tickets, DD 619, inventories, third-party invoices.
- **Jointly-signed records at both ends**, §C.17.a and §B.10.e: the AT DELIVERY notice _"jointly
  signed by my representative and the customer"_, and the real-property walk-around performed
  **twice**, on arrival and before departure.
- **Notification with its own evidence.** NTS §5.11.1: e-mail preferred _"with Delivery and Read
  Receipt as proof of notification"_ — and, twice across the two tenders, the reversal that failing to
  provide the forms and proof thereof _"will eliminate any requirement for notification."_
- **Effectivity keyed to a business event.** §A.1.b(1): the tender binds _"for shipments with a pickup
  date of 15 May 2026 or later"_, with a published edition per window and a per-paragraph change log.
  The governing version of a document is chosen by the **pickup date**, not by the record's creation
  date. §4 records what that forecloses.

C3 is held at 2 for the same reason as everywhere else in this cluster: _"documents are dated but
their state machine is implicit."_

### 2.4 "A records-required clause makes both parties hold the same list" — `src:dp3-400ng` (grade A, secondary)

Item 17.12's records-required clause obliges both the TSP and the warehouseman to hold an itemised
property list carrying the BL number, origin and destination, **the condition of each article when
received at and forwarded from the storage location**, and the dates of all charges, payments and
movements. Item 4.10 makes a weight ticket a **six-field record with its own retention rules**. And
Item 17.10 with the Introduction p. 14 is the sentence [SD §6.2] already quotes for why
`Correction.authority` names an instrument: _"The TSP/Agent will not redact, modify, or remove any
information on the BL… The government is the only authorized agency who can redact, modify, or remove
information on the BL **through an SF1200**."_

All of 17.12 is **already spent at [A8 §5] row 9** — §1's first finding. What A6 takes from this
source is Item 17.10, and §3.6 takes it.

### 2.5 "One status vocabulary, twenty-three document types" — `src:dcsa` (grade A, **captured**, `3/2/3/1/2/3/1/3`)

The only source that publishes a document-state vocabulary as a vocabulary. `shipmentEventTypeCode`
is _"the status of the document in the process"_ with **17 values** — `RECE` Received, `DRFT`
Drafted, `PENA` Pending Approval, `PENU` Pending Update, `PENC` Pending Confirmation, `CONF`
Confirmed, `REJE` Rejected, `APPR` Approved, `ISSU` Issued, `SURR` Surrendered, `SUBM` Submitted,
`VOID` Void, `REQS` Requested, `CMPL` Completed, `HOLD` On Hold, `RELS` Released, `CANC` Cancelled —
applied uniformly across 23 `documentTypeCode` values, with `eventClassifierCode` **forced to `ACT`**:
there is no estimated bill-of-lading issuance.

Two things about it decide §3.4. The design move is genuinely good and its own analysis says so —
_"the document type is **data**, not part of the event name… a new document type is a data change
rather than a schema change"_ — and it is the model's own shape, since [SD §1.3] makes `type` the fact
class and a document kind would be data either way. And the analysis's C7 is **1**, with the reason
stated flatly: _"documents are referenced by id only. No content, no version, no hash, no signature,
no attachment. **A document status event is not evidence of anything.**"_ The source that publishes
the most complete document lifecycle in the corpus is the source that publishes the least document
evidence, and §3.4 reads that as a fact about the axis rather than about DCSA.

### 2.6 "A document is required, submitted, archived — and approval is a different axis" — `src:samsara` (grade A, secondary, `3/3/3/0/3/3/3/3`)

The strongest document _mechanism_ source in the corpus and the second source that publishes a state
machine — in fact **two**, which is why it appears in §3.4's table twice. The document machine is
`required → submitted → archived`, with the definitions quoted verbatim in its analysis's vocabulary:
`Required` documents _"are pre-populated documents for the Driver to fill out… and have not yet been
submitted"_, `Submitted` _"have been submitted by the driver"_, `Archived` _"have been archived by the
admin."_ The **form** machine beside it is
`notStarted/inProgress → completed → needsReview → changesRequested → approved/archived`. Also here:
`signedAtMs`, `submittedBy` polymorphic, DVIR first/second/third signatures, submission `location`
and `geofence`, barcode symbology carried with the value, and `isRequired` on a stop form meaning
_"the driver must complete the form before departing the stop."_ **C4 = 0** — no BOL, no weight
ticket, no inventory, no order for service.

### 2.7 "A document is versioned and scoped to an audience" — `src:project44` (grade A, secondary, `2/2/1/1/1/2/3/2`)

An 18-value `DocumentType` including `BILL_OF_LADING`, `PROOF_OF_DELIVERY`, `DELIVERY_RECEIPT`,
`WEIGHT_CERTIFICATE`, `INSPECTION_CERTIFICATE`, `LUMPER_CERTIFICATE`; `DocumentEventDetails` as
`{documentType, fileFormat, scope, url, version: integer}` with `scope ∈ SHIPPER | CARRIER | DRIVER`;
`DOCUMENT_ADD` and `DOCUMENT_REMOVE` events. **No state enum at all** — its C7 = 3 rests on _"a
document is evidence attached to an event, scoped and versioned"_, which is the closest any source
comes to the rubric's own requirement, and it gets there with a revision integer rather than a
lifecycle.

### 2.8 "The document key, and the acceptance identifier that is not it" — `src:nmfta-ebol` (grade A, secondary, `3/3/1/1/n\a/3/2/2`)

_"The area this source wins outright."_ A bill of lading modelled as a structured document with a
legal definition, a document key in the URL, **an acceptance identifier distinct from the document
identifier**, the rendered PDF and labels returned inline as base64 with a barcode check-digit rule,
`termsAndConditions` carried with it, and a three-value `messageStatus ∈ PASS | FAIL | WARNING` with
`resolution` and an itemised `information[]`. Its `bol.function` field — _"the intent for the
submitted request"_, the field whose whole purpose is to say what a submission is — is **required with
exactly one documented value, `Create`**. C7 is held at **2**, _"not 3 — no version history, no
amendment reason, no correction record."_

§3.5 uses the acceptance-identifier finding and its own analysis's sentence for it: _"the document
identifier and the acceptance identifier are different facts."_

### 2.9 "Type a file by its instrument and by its phase, on two axes" — `src:smartmoving-api` (grade A on vocabulary, secondary, `2/2/1/3/1/1/2/1`)

The only source with **C4 = 3** on A6: `DescriptiveInventory`, `WarehouseRelease`, `TripPlanning`,
`CarrierInvoice` and `Addendum` are HHG paperwork rather than generic attachments. And the structural
idea, which its analysis calls _"the right shape"_: **`FileCategory` types a file by phase**
(`Survey`, `PreMove`, `PostMove`, `Claims`, `DescriptiveInventory`) while **`DocumentType` types it
by instrument** — two independent axes over one artefact. `isComplete` is its only state. The trap its
analysis names is the one four sources share: _"documents attach to an entity, **never to an
event**."_

### 2.10 "A document is evidence of an action, and that link is first-class" — `src:open-trip-model` (grade A, secondary, `2/2/1/0/1/2/3/3`)

The one source that models the rubric's requirement directly. A `Document` entity with inline base64
**or** URL content, `creator` and `owner` actors, **attached to the evidenced action**. C7 = 3 for
exactly that. And the price it pays is C2: `documentType` is a free-text string _"such as a photo,
text document, PDF etc."_ — no catalogue, so no bill-of-lading, proof-of-delivery or weight-ticket
semantics. **The only source that links a document to the act it evidences is the source that cannot
say what kind of document it is.**

### 2.11 "A correction is declared on the event, not on the document" — `src:gs1-epcis-cbv` (grade A, **captured**)

`errorDeclaration` — _"indicates that this event serves to assert that the assertions made by a prior
event are in error"_ — with `did_not_occur` distinguished from `incorrect_data`,
`correctiveEventIDs`, a separate declaration time, and queryability as a class. Already spent:
[SD §6.2] and [SD §6.4] adopt it, and [SD §6.4] keeps EPCIS's retraction rule over the 858's. What
matters for A6 is **where** it is declared: on the **event**, never on the document. EPCIS's `upevt`
(cite another party's event id as your evidence) is the corpus's nearest approach to the rubric's
document-to-event link, and it cites an event, not a document. §3.5.

### 2.12 The document as the message, and the document as a binary

- **`src:x12-212-trailer-manifest`** and **`src:stedi-x12-reference`** (`1/1/n\a/1/n\a/2/2/2`): in
  EDI _"the document **is** the message"_, so the area is structurally thin. What survives is `POD
Proof of Delivery` as a segment at line-item and carton grain, `EFI`+`BIN` carrying binary inside a
  214, `MAN` marks and numbers, and `B10-07`'s EDI-versus-keyed distinction beside `BF Carrier Keying
Error`. §3.5 weighs the first phrase and declines to read a conclusion from it.
- **`src:sirva-ade`** (grade A, secondary): `GetImageList` document metadata, High Value Inventory,
  Weight Tickets, DD619, Gypsy Moth certificate — and **"Bill of Lading" and "Bill of Lading SIGNED"
  as two separate document types.** §3.4's decisive example.
- **`src:shippeo`** (`2/2/1/0/1/2/3/1`): POD in as file or URL, `POD_ADDED` as an event, role-typed
  photos including a dedicated non-conformity picture, eCMR with dual-site signature capture, and
  C7 = 3 for a **published data-source table for every eCMR field** — the source of each fact stated
  per field, including whether a time was geofenced or driver-declared.
- **`src:macropoint`** (`1/1/n\a/0/1/2/2/0`): `Form/Document Upload` carrying BOL, POD and delivery
  proof images as typed binary **bound to a stop and an event** — the binding is the good part — but
  the document role vocabulary is _"supplied by the MacroPoint team on a customer by customer
  basis"_, i.e. not published at all.
- **`src:omnitracs-roadnet`** (`2/2/1/0/2/3/2/2`): `FormResponse` with `FormControlResponse
{question, answeredTime, sequence, repetitionNumber, value}` and `responseType ∈ {Text, Binary,
Entity}` — an answer can **be a reference to another entity** — plus a base-64 `signature` with a
  `consignee` name on stop events. C6 = 3 for binding one piece of evidence six ways. C3 = 1: _"a form
  response either exists or does not."_
- **`src:alvys-api`** (`2/2/1/1/1/2/2/2`): per-entity **enumerated allowed-type lists** with size caps
  and MIME allow-lists, and a published reclassification path — _"change document type, for example
  filing a driver upload that arrived as **Unclassified**"_ — which is an implicit
  `Unclassified → typed` state. Its analysis names the decisive weakness for this whole cluster: _"a
  document attaches to an entity, never to an event or a fact — a POD is filed against a trip, not
  against the delivery it evidences."_
- **`src:milmove-mymove`** (grade A, **captured**, `2/2/2/2/1/2/3/1`): documents typed by **what they
  prove** — `ProofOfServiceDoc.isWeightTicket`, `ServiceRequestDocument`, `ExcessWeightRecord`,
  `SignedCertification`, amended orders with `amendedOrdersAcknowledgedAt`. C7 = 3 for
  submitted-versus-adjusted and missing-ticket modelling. And it is the source that states the
  corpus's own gap outright, in its open question 10: _"rubric A6 asks for documents as evidence for
  events; nobody read so far does this properly."_
- **`src:milmove-docs`** (`1/1/1/1/n\a/1/3/2`): C7 = 3 on provenance mechanics rather than on
  documents — a DB-trigger audit with session user identity, the null-user-for-system caveat, three
  timestamps, and soft delete for multi-year retention.

### 2.13 The sources that have nothing, and what their absence proves

`src:gtfs` scores **0** and says why in its own text: a `TranslatedImage` on an Alert is an
illustration, explicitly _"must not be the only location of essential information."_
`src:weichert-supplier-api` scores **no** — _"nothing to map; the source has no documents"_ — which is
notable because it is a live relocation-management-company contract: an RMC can run a whole
integration without a document model, because the documents live at the mover. `src:uncefact-mmt-rdm`
and `src:uncefact-scrdm` contribute a document type, an issuer, an attachment map and
`Previous Revision_ Identification`, and their own mapping rows say _"document-as-evidence-for-an-event
has no MMT target."_ `src:x12-858-implementation-guide` scores `1/1/n\a/0/n\a/1/1/n\a`: the 858's
stated purpose includes _"detailed bill-of-lading… information"_ and its user switches every lading
segment off.

**What the absences prove is the round-1 crosscheck's finding, and it holds after a full read:** _"not
one source in 26 links a document to the EVENT it evidences."_ Two sources approach it from opposite
ends and neither closes it — `src:open-trip-model` links a document to an action and cannot type the
document, `src:gs1-epcis-cbv` cites an event id as evidence and never cites a document. That is why
[SD §4.1]'s `evidence[]` is **[ORIGINAL]**, and why §3.5 is a decision rather than a comparison.

---

## 3. The decision

### 3.1 The shape, in one picture

```
                     ┌───────────────────────────────────────────────┐
  the document  ──▶  │  document (aggregate, [SD §1.2])              │
                     │                                              │
                     │  as a SUBJECT:  `identity`  ← D-ID decides    │  §3.2  DECIDED
                     │                   when                       │
                     │  as a CONTEXT:  weight.net, weight.gross,    │  already [SD §4.7.1]
                     │                 pieceCount, condition,        │
                     │                 identity                     │
                     │                                              │
                     │  as an OBJECT of an act:  nothing            │  §3.3  ABSENT + OWED
                     │       documentIssuance ──── boundBy = SCHEME  │        authority RESOLVED
                     │                             for the BL only   │        for one kind
                     │                                              │
                     │  its STATE:  refused, and not a projection   │  §3.4  REFUSED
                     │  its FIELD-LEVEL mutability:  A8's Instrument │  §3.6  MAPPED, with a residue
                     └───────────────────────────────────────────────┘
                                          ▲
                                          │ evidence[]  — a POINTER, never a claim
                                          │              ([SD §4.1], narrowed at §3.5)
                     ┌────────────────────┴──────────────────────────┐
                     │  every Assertion about anything else          │
                     └───────────────────────────────────────────────┘
```

Four decisions, one mapping and one refusal. Nothing is minted; one existing type gains a reading
rule, one absent class is recorded with its authority already resolved, and one published union is
deliberately **not** widened.

### 3.2 A document's own identity, and the identity it merely carries — owed item 1

> **Rule D-ID.** An identifier **assigned to the document as an accountable artefact** is an
> `identity` assertion whose **subject is the `document`**. An identifier the document merely
> **carries** is an `identity` assertion about that identifier's own subject, with the document in
> `context[]`. The discriminator is whether the scheme is one the document's issuer controls for the
> **form**, independently of any shipment.

The model already admits both shapes and has never chosen between them. `identity`'s canonical family
is `anyAggregate` — [SD §7.1]'s _"subject may be ANY aggregate kind"_ — whose member list includes
`document`; and `identity`'s `context[]` carries `document`, annotated _"the instrument the value
appears on (the BL, the weight ticket)."_ So a bill-of-lading number can be filed as a fact about the
shipment with the BL in context, or as a fact about the BL. [SD §1.3] pairs competing assertions on
`(subject, type, qualifier?)`, so the two are **different fact keys** and a model that files the same
number both ways carries one value twice and never notices the duplication.

**The discriminator is published, and it is primary on one side and secondary on the other.**

`src:cfr-49-375` §375.505(b) enumerates the BL's seventeen items and item **(16)** is _"Any
identification or registration number **you assign to the shipment**"_ — a required field of the bill
of lading, distinct from the bill of lading's own number, which is not one of the seventeen because it
identifies the instrument rather than appearing in it. §375.519(a)(6) then requires a weight ticket to
carry _"The carrier's shipment registration **or** bill of lading number"_ — **as alternatives**,
which is only coherent if they are two different identifiers of two different things. Primary, both.

`src:dtr-part-iv` A-413 §C.2 supplies the other side, secondary: BL numbers are **accountable stock**,
serially pre-assigned; a laser-generated BL _"is only accountable when a number has been assigned to
the form"_; lost, stolen and void numbers are reported to DoW PPA; and the stock is audited every 180
days. Every one of those facts is a fact **about the form**. A number that can be void before any
shipment exists, and that can be lost without anything happening to any goods, is not an identifier of
goods.

**[SYNTHESIS]**: the rule. Sourced: that the two identifiers are distinct (primary, twice), and that a
bill-of-lading number is assigned to and accounted for as a form (secondary). Ours: reading that
distinction as a choice of `subject` rather than as two fields.

#### (a) The discriminant is not ours to publish, so D-ID takes it as an input

Whether a given scheme is document-accountable is a property of the scheme, and the scheme list is
`identityScheme` — **an owed code, owed to A9** (`src/identity.ts`: _"the scheme list is A9's. Until
it lands, a scheme is an owed code"_). So `documentIdentitySubject` takes the discriminant as a
parameter and returns `undetermined` when it is unknown, which is exactly **B-ONWARD**'s shape
([A2 §3.2]) and for the same reason: the rule is decidable, its input is not published, and a default
would be a guess in the one place [SD §0] forbids one.

#### (b) Running it over every document kind in the corpus, `undetermined` is the normal case

| Document kind                   | Does it carry a scheme assigned to the form?                                                                                                                                                             | D-ID's verdict                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Bill of lading** (commercial) | **Yes.** §375.505(a) the carrier prepares and issues it; §375.519(a)(6) names "the carrier's… bill of lading number" as a scheme distinct from the shipment registration                                 | subject = `document`                                                                                                                  |
| **PPGBL / GBL**                 | **Yes.** A-413 §C.2's accountable stock; §375.103 defines a `Government bill of lading shipper` as one whose property moves under a GBL _"issued by any department or agency of the Federal government"_ | subject = `document`                                                                                                                  |
| **Weight ticket**               | **No.** §375.519(a)'s six items give it no number of its own: it is identified by scale name and location, date, and **the carrier's shipment registration or bill of lading number**                    | subject = the carried identifier's own subject; the ticket is `context[]` — which is what [SD §4.7.1]'s `weight.net` row already does |
| **Inventory**                   | **No.** §375.503(a) numbers **each article**, not the document; NTS §1.6.7's nine identity fields are the lot number, the service order number and **page N of M** — all borrowed or positional          | as above; and `condition`'s and `pieceCount`'s rows already carry it as `context[]`                                                   |
| **Warehouse receipt**           | Out of the model. A-406 §B.2.d's unique-original rule is real and NTS is [A5 §3.4(c)]'s excluded programme                                                                                               | not scored                                                                                                                            |
| **SF 1200**                     | **No.** A-413 §F.1.b is "one BL per notice"; the notice is addressed by the BL it corrects                                                                                                               | §3.6 reads it as an `Instrument`, not as a subject                                                                                    |

**Six kinds, one verdict of `document`, and it is the same kind twice.** Every other document in the
corpus is identified by reference to the bill of lading or to the goods. That is a real finding and it
cuts both ways: D-ID is decisive exactly where the corpus gives a document an accountable number, and
the corpus gives one to exactly one instrument. The rule is therefore **narrow and correct** rather
than broad and speculative, and its `undetermined` branch is the ordinary path rather than the edge.

#### (c) What this does not decide

D-ID says which **subject** a value attaches to. It does not say what schemes exist (A9), it does not
mint an identifier, and it does not touch **I-KEY** or `boundBy = SCHEME`. The boundary in one
sentence: **A6 owns the difference between a document's own fact and a fact it carries; A9 owns the
scheme list.**

#### (d) It costs no published byte

`record.identity` in both emitted schemas declares
`subject: SubjectRef.family.anyAggregate` and `context: { items: SubjectRef.family.anyAggregate }`.
The `context` whitelist in `data/canonical-subjects.json` is documentation of the row, not a published
constraint, and `anyAggregate` already includes both `document` and `shipment`. So a document-subject
`identity` with the shipment in `context[]` validates against the published schema **today**, and
D-ID changes nothing a consumer must re-validate. The `identity` row's `contextNote` is amended to say
which of the two shapes it is describing.

### 3.3 No act on a document has a record, and `documentIssuance` arrives with its authority resolved — owed item 2

[A2 §3.6] instructed A6 to run this check first. It was run, and the answer is the same as A2's with
one important difference.

**The check.** [SD §4.7.1] declares thirty-one record types. Thirteen are acts on the goods or the
plan, nine are lifecycle acts on an aggregate, the rest are measures and states. Not one has a
`document` canonical subject family, and `document` appears in the table only in six `context[]`
columns. So there is no record of a document being **issued**, **signed**, **corrected**,
**cancelled** or **distributed** — and §3.2's D-ID, which asserts an identity **about** a document, is
therefore a fact about an artefact whose coming-into-existence the model cannot record.

**The corpus names the act, four times over and in three different regimes.**

- `src:cfr-49-375` §375.505(a), **primary**: _"you must prepare and **issue** a bill of lading"_,
  before receiving the shipment.
- `src:dtr-part-iv` A-413 §C.2, secondary: a BL _"is only accountable when a number has been assigned
  to the form"_ — number assignment **is** issuance — with A-402 §F.1 NOTE's precondition that _"the
  BL cannot be printed until pre-move survey weight and agreed pack/pickup dates are in DPS"_ and
  `src:dp3-tender-of-service` §C.3.n's floor that the BL may not be printed earlier than 2 GBD before
  the first pack date. An act with a gate on both sides.
- `src:dcsa`, captured: `ISSU` is one of seventeen document-status values and
  `eventClassifierCode` is forced to `ACT` — _"there is no estimated B/L issuance."_
- `src:nmfta-ebol`, secondary: `bol.function` is a **required** field whose one documented value is
  `Create`, and the response carries **an acceptance identifier distinct from the document
  identifier** — the act of lodging the document is addressable separately from the document.

`documentIssuance` is therefore recorded in [SD §4.7.3] as **absent and owed**, on the same terms as
[A5 §3.6]'s three and [A2 §3.6]'s one. A6 does not mint it: [SD §4.7]'s prose is that minting a
vocabulary member is that section's to do, and no other document may.

#### (a) What is different: the authority row is not blocked

The resumption plan's §5 sorts the owed authority rows into two kinds of blocker — _blocked on a
missing party entity_ ([A8 §9 item 1]) and _blocked on a missing `boundBy` enum member_. **This one is
neither**, and that is the finding.

[A8 §5] row 10 binds `identity` with `boundBy = SCHEME`, meaning _"the ISSUER of the scheme, and
nobody else, for the value under that scheme. Authority NEVER moves."_ §3.2(b) establishes that for
the bill of lading — the one document kind with a scheme of its own — **the party that controls the
number scheme is the party that issues the instrument**, in both published regimes: the carrier under
§375.505(a) issuing under its own bill-of-lading numbering, and the Government under A-413 §C.2
issuing from accountable stock it audits. The two regimes name different issuers and that is **not a
conflict**: §375.103 defines a `Government bill of lading shipper` separately from a
`commercial shipper` precisely because the carrier's BL and the GBL are two instruments, each issued
by the party whose instrument it is. Which instrument is in play determines the issuer, and the
scheme is what says which instrument it is.

So `documentIssuance`'s authoritative role is **already determined by an existing `boundBy` member**,
for the one document kind that has a scheme — and it is `SCHEME`, the one member of the six for which
[A8 §5] says authority never moves. The class is blocked on **minting alone**: a row in [SD §4.7.1]
and a row in [A8 §5], with nothing owed underneath either. That is a **third kind of blocker** and it
belongs in the ledger beside the other two, because it is the cheapest of the three to close.

**[SYNTHESIS]**, and §7 holds it at **medium-high**: the two sourced halves are that issuance exists
as a regulated act (primary) and that `boundBy = SCHEME` already means "the scheme's issuer"
([A8 §5] row 10). What is ours is joining them.

#### (b) Signature is a second act, and it is not `handover`

The tempting shortcut is to read a signature as the model's existing `handover`: §375.505(f) has the
BL _"signed at both the origin and the destination"_, which is exactly where the two custody
boundaries are, and [A8 §5] row 9's joint holding already sits there. **The shortcut is wrong, and the
source refutes it in the same subsection.** §375.505(h) requires the BL to be _"provided to, signed,
and dated by the individual shipper **at least 3 days before** the shipment is scheduled to be
loaded"_ — a signature three days before any goods move, at no custody boundary at all. And
§375.505(g)(2) permits a party to be required to sign an **incomplete** document, which is a fact
about the document's content at the moment of signing and about nothing else.

A signature is therefore an act on the document, distinct from `handover`, and the model has no record
for it either. **A6 records it and declines to add it to [SD §4.7.3]**, for a reason that is not the
usual one: unlike issuance, nothing in the corpus tells us what a signature _asserts_. §375.505(f)
requires two signatures without saying what either party thereby claims; `src:dp3-tender-of-service`
§C.9.a(4)-(11) is the most rigorous e-signature specification in the corpus and specifies the
**procedure** — per line item, per page, immutable afterwards, copy before departure — and not the
proposition. `src:samsara` carries `signedAtMs` and DVIR first/second/third signatures as fields on a
submission. A fact class needs a value, and no source publishes one for a signature.

Recorded in §6 as owed **to the user and to A10**, not to A8: what a customer's signature on an
inventory asserts about the inventory is a legal question about the contract, and [A5 §3.4]'s
treatment of the same shape — a published consequence whose proposition is unstated — is the
precedent for declining rather than inventing.

#### (c) Two candidate classes refused, because the model already carries them

- **`documentCorrection` is refused.** [SD §6] already models a correction as an act on a **fact**,
  with `Correction.authority` naming an **instrument** ([A8 §8]), and `src:dp3-400ng` Item 17.10 — the
  sentence [SD §6.2] quotes — says the correction is made _"through an SF1200"_, i.e. the instrument
  is how a BL field is corrected. A `documentCorrection` class would be a second home for one
  decision, which is [SD §1.1]'s named defect. §3.6 maps the whitelist onto the machinery that
  exists.
- **`documentDistribution` is refused.** `src:dtr-part-iv` §E.3's rule that a cancellation after
  distribution requires a memorandum copy marked "canceled" sent to every original recipient is
  **already** in the model: `INSTRUMENT_KINDS` carries `DISTRIBUTION_OBLIGATION` for that exact
  sentence, and [SD §6.5] makes corrections emit notification obligations. The recipient still has no
  field — [A8 §9 item 6] owes "the party as a notification target" — so distribution is blocked on a
  gap that is already recorded, and recording it twice would inflate the owed count without adding
  information.

### 3.4 Document state is refused — owed item 3

> **No `documentState` vocabulary is published, and no `documentStateAt` projection is written. A
> document's state is not a fact the model carries.**

`src:dtr-part-iv`'s own A6 row records the limit that makes this the obvious gap to fill — it is
_"docked on C3 because document **state** (issued / corrected / cancelled / superseded) is described
in prose, never enumerated"_ — and two sources publish a state machine that would fill it. The
refusal is [A2 §3.3]'s argument in a second area: **the published vocabularies do not decompose into
the same facets, so a union would be a cross-product and still wrong for the next publisher.**

| Publisher                   | What it publishes                                                                                       | The facets it fuses                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src:dcsa`                  | 17 values over 23 document types, `ACT` forced                                                          | receipt · drafting · **approval** (5 of the 17) · issuance · **surrender of a negotiable instrument** · submission · voiding · cancellation · **hold/release** · request · completion |
| `src:samsara`               | `required → submitted → archived`, **plus a second machine** for forms                                  | assignment-to-a-person · submission · archival — and **approval on a separate axis**, which is DCSA's five values moved to a different object                                         |
| `src:project44`             | integer `version`, `scope ∈ SHIPPER \| CARRIER \| DRIVER`, `DOCUMENT_ADD`/`_REMOVE`; **no state enum**  | revision · audience                                                                                                                                                                   |
| `src:nmfta-ebol`            | `function` required with one value, `Create`; `messageStatus ∈ PASS \| FAIL \| WARNING`                 | **message processing**, not document state — and its own analysis says error and business-exception codes are conflated in the companion code list                                    |
| `src:alvys-api`             | implicit `Unclassified → typed` via "change document type"                                              | **classification**                                                                                                                                                                    |
| `src:smartmoving-api`       | `isComplete`                                                                                            | completeness                                                                                                                                                                          |
| `src:open-trip-model`       | free-text `documentType`, no state                                                                      | —                                                                                                                                                                                     |
| `src:uncefact-scrdm`        | `Previous Revision_ Identification`                                                                     | revision, as a link rather than a state                                                                                                                                               |
| `src:cfr-49-375`            | issue → sign at origin → sign at destination; 3-day rescission; amend only by attachment; retain 1 year | signature · **rescission** · amendment · retention                                                                                                                                    |
| `src:dtr-part-iv`           | prose only                                                                                              | issuance · correction · cancellation · supersession · **distribution** · **accountable-number assignment** · audit                                                                    |
| `src:dp3-tender-of-service` | one hard rule: signed ⇒ not editable                                                                    | signature                                                                                                                                                                             |

**Eleven publishers and no two agreeing decompositions.** At least twelve distinct facets appear:
draft, classify, assign, submit, approve, sign, issue, distribute, surrender, hold, revise, void. Two
publishers carry a facet the others put on a different object (`src:samsara`'s approval axis;
`src:project44`'s audience scope, which is an access-control fact). And one publisher demonstrates the
defect in the cleanest possible form: **`src:sirva-ade` publishes "Bill of Lading" and "Bill of Lading
SIGNED" as two separate document _types_** — folding a state facet into the type axis, in a live
grade-A partner contract. `src:smartmoving-api` shows what the alternative looks like when it is done
deliberately: two orthogonal axes, `FileCategory` by phase and `DocumentType` by instrument, which its
own analysis calls _"the right shape"_ — and which is two axes precisely because one will not hold
them.

#### (a) And the projection is the worse temptation, not the safer one

`documentStateAt(document, instant)` would look exactly like `custodyAt` ([SD §4.8]) and
`orderStageAt` ([A1 §3.3]): a named, versioned fold over published records, never stored, never
asserted, never corrected — which is the mechanism [SD §1.1] prescribes when something looks like
mutable state. A5 §3.8 and A2 §3.8 each refused a state enum once and each reached for this pattern.

**It cannot be written, and §3.3 is why.** A fold needs input records, and there are no records of a
document being issued, signed, corrected or cancelled. A `documentStateAt` would be
[A2 §3.6]'s **B-STAGE** a second time — _"a projection with no input records since it was written"_ —
and A2's whole point about B-STAGE is that shipping one is worse than shipping nothing, because a
consumer cannot tell a fold that returns "unknown" from a fold that has nothing to read.

So the refusal is recorded the way A2 recorded B-STAGE: as an **assertable constant a scenario can
test**, not as a projection and not as prose. `DOCUMENT_STATE_IS_NOT_COMPUTABLE` says the same thing
`SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE` says, for the same structural reason, and the two
together are the general form: **the model refuses to publish a fold whose inputs it has not
declared.**

#### (b) What is kept from DCSA, and it is a shape rather than a vocabulary

DCSA's design move survives the refusal of its values: **the document kind is data, not part of the
event name.** [SD §1.3] already requires this — `type` is the fact class, so a document kind could
never be part of an event name here — and DCSA is the corpus's independent confirmation that the
alternative (a per-document-type event catalog) is the wrong shape. Recorded in §5 as a decision A6
did not have to make, and as a reason `documentType` is **not** an owed vocabulary: a kind that rides
as data does not need a published enum before the acts that would carry it exist.

### 3.5 What `evidence[]` means — owed item 4

[`fork-time` §5.6] deferred this here in terms: _"What `evidence[]` **means** — whether citing a
document is a claim about it, how a signature is modelled, retention — is A6's and is not decided
here."_ It is also the one owed item with live markers in the code: `src/assertions.ts`'s
`EvidenceRef` TODO, `src/rules/e-canon.ts`'s restatement of it, and a scenario test whose name begins
`FINDING:`.

> **Rule D-CITE. A reference in `evidence[]` is a pointer and never a claim. Citing a document
> asserts nothing about the document, and asserts nothing about whether the document establishes the
> fact it is cited for. Evidentiary standing is a rule over the (document kind, fact class) pair, and
> the corpus publishes it per pair.**

#### (a) The corpus states the negative half explicitly, which is unusual

Most of the corpus is silent about what citing a document means. Two sentences in one grade-A tender
are not:

- `src:dp3-tender-of-service` §C.9.a(24): _"a signed bingo card or check-off sheet **does not indicate
  proof of delivery** and lost, missing or damaged items will still be indicated on the appropriate
  loss or damage forms."_ A signed document, produced at the delivery, by the party performing it —
  and the contract says it does not establish the delivery. **Signature plus relevance is not
  standing.**
- §C.9.a(22): describing carton contents as "misc." means the TSP _"agrees not to contest a claim for
  missing items related to the nature of such cartons."_ The **content quality** of a document
  changes what may be argued from it, with the same signature on the same instrument.

And the positive half is primary. `src:cfr-49-375` §375.519(d): _"All freight bills you present to an
individual shipper must include true copies of all weight tickets obtained in the determination of
the shipment weight **in order to collect** any shipment charges dependent upon the weight
transported."_ There, a specific document kind is a **precondition** of a specific consequence — not
by virtue of being cited, but by a rule naming the pair. §375.701's converse is the same shape from
the other side: a delivery receipt _"must not contain any language purporting to release or discharge"_
liability, so a rule can also say what a document kind may **not** establish however it is worded.

**[SYNTHESIS]**: D-CITE. Sourced: that standing is per (document kind, fact class) and is not conferred
by citation (three sentences, one primary). Ours: the generalisation to every fact class and every
document kind, and the decision to keep the pointer semantics deliberately thin.

#### (b) Three consequences that are not obvious

1. **A party may cite another party's document without asserting it.** [SD §6.1]'s `UNAUTHORISED` row
   fires when _"the declaring party has no authority over this fact class"_, and under any reading
   where a citation is a claim, a destination agent citing the origin agent's weight ticket would
   trip it. Under D-CITE it does not: the agent asserts a weight and points at a ticket.
2. **`evidence[]` is not where standing lives, so the standing rules are owed, per pair, and are not
   A6's to invent.** §375.519(d)'s rule is A7's (it governs collection); the loss-and-damage forms'
   standing is A11's. §6 names them.
3. **`capturedBy` is not weakened.** [SD §4.4] already says the source of a fact is
   `capturedBy` + `evidence[]` together, and [SD §5.2]'s M-rules already restrict what each capture
   method may assert. D-CITE says the document half of that pair carries no assertion of its own; it
   does not move the `capturedBy` half.

#### (c) The inbound message: `EvidenceRef` is deliberately not widened

[SD §4.6.2]'s **E-CANON-RESOLVE** says the inbound message _"goes in `evidence[]`"_, and
`EvidenceRef` is a `document` ref or an assertion `eventId`. `src/rules/e-canon.ts` already observed
that an unadmitted inbound message is neither — it has no `eventId` because [SD §4.6.2]'s
**E-CANON-STRICT** says a record that is not admitted _"acquires no `eventId`, is filed under no fact
key, and enters no contest"_ — and carried it as its own opaque `InboundMessageRef` inside a
`BoundaryEvidenceRef` local to ingest, rather than widening the published union on inference. A6
**ratifies that**, and closes the TODO with the reason rather than the workaround.

The one argument for widening is `src:stedi-x12-reference`'s observation that in EDI _"the document
**is** the message"_, and it does not survive contact with the source that models the same act
properly. `src:nmfta-ebol` lodges a bill of lading as a submission and returns **an acceptance
identifier distinct from the document identifier** — its own analysis states the finding: _"the
document identifier and the acceptance identifier are different facts."_ A publisher that models both
keeps them apart. And `src:stedi-x12-reference`'s sentence is an observation about a transport
encoding, not a claim that a transmission is an instrument; the same analysis scores the area `1` on
C1 and calls it _"structurally thin"_ for exactly this reason.

**What this costs, stated rather than implied.** `EvidenceRef` is published in both emitted schemas
with `additionalProperties: false` on both branches, so widening it would be a change a consumer must
re-validate against; ratifying costs no published byte. The price is that the link from an admitted
Assertion back to the message that carried it does **not** survive the boundary in `evidence[]`: it
lives on the ingest side, on `RetainedSubmission`, which [SD §4.6.2]'s **E-CANON-OBLIGATION** already
requires to retain the message verbatim. So [SD §4.6.2]'s sentence is true **on the boundary side**
and A6 narrows it there. The alternative — a `document` aggregate minted for every inbound payload —
would make every partner transmission an artefact of the domain, which §3.2's accountable-artefact
reading is precisely the argument against.

The scenario test's `FINDING:` becomes the decision it was recording.

### 3.6 The mutability whitelist, and where its fields land — owed item 5

[A2 §Cross-area] hands this over as _"a published correction regime over a document"_, and
[`fork-order` §6] user question 5 says _"A6 owns that regime."_ **The regime needs no new
mechanism**, and finding that is the work.

`src:dtr-part-iv` Table A-402-4 enumerates exactly which bill-of-lading fields are correctable, with
SF 1200's before-value / after-value / **Authority for Correction** / remarks structure, and the rule
that everything else is immutable — _"to change it you cancel and reissue."_ The model already has the
shape: [A8 §8]'s `Instrument` carries `kind`, the published `instance` (`SF1200`), `effectiveFrom` /
`effectiveTo`, and **`grants: readonly AssertionType[] | 'ALL'`** — _"the fact classes this instrument
reaches. Table A-402-4 is the published precedent for an instrument scoped by what it may touch."_
`instrumentReaches` is the gate and it already bites.

So A6 adds no rule beside it. What A6 supplies is the **mapping**, with its residue stated, which is
what `src/rules/authority.ts`'s own TODO asked for: _"Table A-402-4's granularity is **field-level
within one fact class**… The vocabulary has no sub-fact grain, so a whitelist is represented here at
fact-class grain and is coarser than its source."_

| Table A-402-4 field                                                             | The fact class it would land on                                  | Status                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pack date, pickup date, required delivery date                                  | `arrival`, `departure`, `delivery` at a plan basis ([SD §4.2])   | **Lands.** Three fact classes for three dates, at fact-class grain                                                                                                                        |
| Consignee and delivery address; pickup address; extra pickup/delivery addresses | a `stop`'s place                                                 | **Nowhere.** `placeRef` is **owed to [SD §1.2]** — there is no `place` aggregate                                                                                                          |
| Agent code                                                                      | the `partyRole` holding                                          | **Nowhere.** `partyRole`'s authority row is owed to [A8 §9 items 1-2]: both the party entity and the role enum are undefined                                                              |
| Code of Service                                                                 | a shipment's kind                                                | **Nowhere, and deliberately.** [A2 §3.3] withdrew `shipmentType` rather than filling it, because six publishers decompose it six ways                                                     |
| Authorized weight                                                               | `weight.net` / `.gross` / `.tare` at a plan basis                | **Lands**, at fact-class grain — and the whitelist's point is that the _authorized_ figure is correctable while the weighed one is not, a distinction `basis` carries and `grants` cannot |
| Member identity; orders number and date                                         | an `identity` on the customer's `partyRole`, and the entitlement | **Partly.** `identity` lands; the entitlement is out of the model — `src:dtr-part-iv`'s own trap note is that _"entitlement contaminates the shipment"_                                   |
| TCN                                                                             | an `identity` under a Government scheme                          | **Lands** as `identity`, and the scheme is **A9's**                                                                                                                                       |
| Accounting codes; remarks                                                       | —                                                                | **Nowhere.** Neither is a fact about the goods, the plan or a party                                                                                                                       |

**Eight rows, two that land cleanly, two that land partly, four with nowhere to go — and not one of
the four is A6's to fix.** Two are owed elsewhere (`placeRef`, `partyRole`), one was **refused** by a
landed area on evidence (`shipmentType`), and one is not a domain fact at all. That is the honest
answer to the TODO, and it changes its shape: the whitelist is not coarser than its source because the
vocabulary lacks a sub-fact grain — it is coarser because **half its fields are not facts this model
carries, at any grain.** Inventing a sub-fact grain would not move a single one of the four.
`authority.ts`'s TODO is **taken** and rewritten to say that.

Two further pieces of the regime are recorded rather than modelled:

- **A correction is not a reissue, and the source draws the line** ([A2 §Cross-area]). Under
  [A2 §3.2]'s **B-ONWARD** an administrative re-issue over an unchanged undertaking mints no shipment,
  so the line matters for the document and not for the goods. With no `documentIssuance` record
  (§3.3), the line is decidable in prose and not in code — the same sentence A2 wrote about B-ONWARD,
  now for a second reason.
- **`src:cfr-49-375` §375.505(h)'s non-restart clause.** Changes to a bill of lading flowing from a new
  estimate _"do not require a new 3-day period"_: an upstream amendment that is permitted does not
  reopen the downstream document's window. `src/rules/corrections.ts` carries
  `AMENDMENT_WINDOWS` as owed with the note that _"the corpus publishes exactly one amendment window
  (§375.401(i))"_. **That count is deleted rather than corrected** — [A1 §9]'s rule, because no gate
  reads it — and §375.505(h) is recorded beside it. Whether a three-day **rescission** right is an
  amendment window is genuinely arguable; what is not arguable is that a count in prose that a second
  primary sentence bears on must not stand unexamined. The window itself is keyed to a **document**
  and not to a fact class, so even read as an amendment window it has nowhere in that table to go.
  **Rescission of the bill of lading is the withdrawal of the undertaking**, which is [A1]'s
  `orderCancellation`, and §Cross-area hands it over.

### 3.7 The stay boundary, and one thing the capture vocabulary cannot say — owed item 6

§1's first finding is that [A5 §Cross-area]'s hand-off was discharged by [A8 §5] row 9 before A6
opened it. What survives is one sentence and one gap.

**The sentence.** Row 9's joint holding is keyed on _"each custody boundary"_, and **A8-INSTANT** is
what computes whether an instant is one. [A5 §3.3] settles that a stay is neither a stop nor a service
at a stop, and [SD §4.7.1] carries `storeIn` and `storeOut` as acts with the `stay` in play, so the
two ends of a stay are boundaries in A8-INSTANT's sense and row 9 reaches them with nothing added.
`src:dp3-400ng` Item 17.12.c's _"condition of each article when received at and forwarded from the
storage location"_ is row 9's lead citation and is satisfied by row 9. **A6 adds no rule here**, and
saying so is the deliverable.

**The gap, which is not a `condition` gap.** The published rule that makes Item 17.12 work in practice
is `src:dp3-tender-of-service` §C.9.a(14) and NTS §1.6.2: the **omission** of an exception symbol is
an affirmative assertion of good condition, with the burden assigned — _"failure of electronic items
will be assumed to be transit related"_ — and `src:cfr-49-375` gives the same shape twice in primary
text: §375.515(a)'s shipper who elects not to observe a weighing _"is presumed to have waived that
right"_, and §375.701(b)'s delivery receipt stating goods were received in apparent good condition
_"except as noted."_

> **The model cannot express this, and the reason is precise rather than general.**

[SD §5.1]'s `CAPTURE_METHODS` has seven members and none of them is "asserted by the absence of an
annotation on a signed record". The semantically closest is `ASSUMED_FROM_PLAN` — _"Nobody asserted it;
the plan stood unchallenged"_ — and **M1 forbids it at `basis = ACTUAL`**, which is the only basis a
condition-at-a-boundary can carry ([SD §2.3] invariant 1 puts an act's outcome there and nowhere
else). M1's stated reason is that _"a planned value that nothing contradicted is indistinguishable
from an observation, which is the difference between a record and a fabrication."_

**And the sources' rule is not M1's case.** What makes the omission answerable is not that nothing
contradicted it — it is that a party who was **physically present signed the page**, per line item
and per page, having been given the opportunity to annotate every exception
(`src:dp3-tender-of-service` §C.9.a(4)-(11)), and that the burden of rebutting the default is
**assigned** to a named party. That is the opposite of an unchallenged plan: it is a challengeable
assertion whose challenge window has been offered and declined. M1 is right and the vocabulary is
short one member.

**A6 does not add it.** `CAPTURE_METHODS` is published in both emitted schemas as a seven-member
`enum` on every record type, so an eighth member is a published change; the fact class it would serve
is `conditionValue`, **owed to A4 and A10**; and M1–M7 are [SD §5.2]'s. The gap is recorded as a
**gate rather than a comment**: `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE` is held by an exactness
assertion between A6's own enumeration of the seven members and `CaptureMethod` itself, so if anyone
adds an eighth the assertion stops compiling and whoever adds it is made to read this section. The two
sides are declared independently — which is [A2 §9]'s rule for when an `Exact` earns its place — and
§9 records the tamper that proves it.

Handed to A4 in §Cross-area, with the member's shape stated and its name left to A4.

### 3.8 The rubric's row, triaged — owed item 7

The rubric's A6 row is _"order for service, estimate, inventory, BOL, weight tickets, POD, photos;
documents as evidence for events."_ Eight things. Following [A5 §3.6]'s method, each is placed rather
than assumed to be A6's.

| Rubric item                          | Where it lands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Order for service**                | **Not A6's, and not in the model.** `src:cfr-49-375`'s own analysis records that _"'order for service' appears 0 times in the whole part"_ (case-insensitive over the capture). In DP3 it is DD Form 1164 and it is the **NTS** ordering document — [A5 §3.4(c)]'s excluded programme. The commercial analogue is the order itself, which is [A1]'s and [`fork-order`]'s. **No document class needed.**                                                                                                   |
| **Estimate**                         | **Absent and owed already**, [SD §4.7.3], and A10's. `src:cfr-49-375` §375.403(a)(3) makes a binding estimate _"an attachment to be made an integral part of the bill of lading contract"_ and §375.401(i) publishes its amendment window; `src:dp3-tender-of-service` §C.2.b adds an estimate with a **stated tolerance** (10% of actual net weight) and a penalty. A6 notes that the estimate is the corpus's clearest case of a document that is also a fact class, and does not mint either.          |
| **Inventory**                        | **Split, and the split is already made.** Its per-article condition is `condition`, [A8 §5] row 9. Its counts are `pieceCount`, row 16. Its per-article identifiers are `identity` under §3.2's carried-identifier branch. The **document** is `context[]` on all three, already. What is missing is the signature (§3.3(b)) and the condition vocabulary (A4/A10).                                                                                                                                       |
| **BOL**                              | **A6's, and §3.2, §3.3 and §3.6 are it.** The one document kind with a scheme of its own, an issuer the model can bind, and a published correction regime.                                                                                                                                                                                                                                                                                                                                                |
| **Weight tickets**                   | **Already carried as `context[]` on `weight.net`** — [SD §4.7.1]'s row says so in its own note. §3.2(b) adds that the ticket has no identity of its own, which is why it can only ever be context. `src:dp3-400ng` Item 4.10's six fields and `src:cfr-49-375` §375.519(a)'s six fields are the same record; the retention rules are §4's foreclosure.                                                                                                                                                    |
| **POD**                              | **Not a class, and the corpus says why.** `src:dp3-tender-of-service` §C.9.a(24) denies standing to the artefact most systems call a POD; `src:cfr-49-375` §375.701 constrains what a delivery receipt may say; `src:project44` and `src:shippeo` both carry `PROOF_OF_DELIVERY` as a `documentType` with no semantics attached. The **fact** is `delivery` with its `(outcome, reasons[])`, which [SD §4.7.1] carries and [A4 §3] gave a vocabulary. A POD is `evidence[]` on that, under §3.5's D-CITE. |
| **Photos**                           | **Not a class.** `src:dtr-part-iv` A-405 §C.2 puts photographs in the TSP performance file; `src:dtr-part-iv` A-406 §B.16.i(3) admits them as one of three ways to discharge a burden of proof; `src:shippeo` types a non-conformity picture. All three are evidence for a fact, which is `evidence[]`. Nothing in the corpus makes a photograph a subject of an assertion.                                                                                                                               |
| **Documents as evidence for events** | **§3.5, and it is [ORIGINAL] as the crosscheck declared.** The rubric's central A6 requirement is the one thing no source in the corpus does — `src:milmove-mymove`'s own open question 10 says so and twenty-five analyses agree by omission. D-CITE is the decision, and §5 holds it.                                                                                                                                                                                                                   |

**Two of the eight are A6's. Four are other areas' or are already carried. Two are `evidence[]`
itself.** That is the honest shape of the row, and it is why A6's output is four narrow decisions
rather than a document model.

### 3.9 The criteria weighted, and why

A6 is the first area to weight **C7** highest, which is the obvious call and is worth stating because
the second and third places are not obvious.

| Criterion                                 | Weight          | Why                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C7** Evidence, provenance & corrections | **highest**     | The area _is_ C7. Every decision above is a provenance decision: what a citation claims (§3.5), who may correct what by which instrument (§3.6), what a silence asserts (§3.7). The five sources scoring C7 = 3 on A6 — `cfr-49-375`, `dtr-part-iv`, `dp3-tender-of-service`, `samsara`, `project44`, `shippeo`, `open-trip-model` — are the five this document actually used |
| **C6** Identity & references              | **high**        | Second, and not obviously so. §3.2 is an identity decision, and it is decidable only because `src:dtr-part-iv` scores C6 = 3 on A6 for the BL's accountable-number machinery and `src:nmfta-ebol` scores C6 = 3 for separating the document key from the acceptance identifier. Without those two rows D-ID would be [ORIGINAL]                                               |
| **C2** Semantic precision                 | **high**        | §3.4's refusal is an argument about definitions: eleven publishers, twelve facets. It needs the sources to have _defined_ their states, and `src:samsara`'s C2 = 3 (definitions quoted verbatim) and `src:dcsa`'s C2 = 2 (_"codes and labels only"_, definitions in an uncaptured CSV) are the difference between an argument and an impression                               |
| **C3** Lifecycle rigor                    | **medium**      | The temptation rather than the evidence. The three sources scoring C3 = 3 on A6 (`samsara`, `dcsa`) or 2 (`cfr-49-375`, `dtr-part-iv`, `dp3-tender-of-service`) are exactly the sources §3.4 declines to follow. A high C3 weight would have made the refusal look like a gap                                                                                                 |
| **C4** HHG fidelity                       | **medium-high** | Necessary but not sufficient: `src:samsara` scores `3/3/3` on C1–C3 with **C4 = 0** and is still the best mechanism source, while `src:smartmoving-api` is the only C4 = 3 and contributes one structural idea. Weighted below C7 because the HHG-specific _documents_ turned out to be either already carried as context or other areas'                                     |
| **C1** Coverage                           | medium          | Six publishers cover the area broadly and none of the breadth decided anything. [`../rubric.md`]'s own rule — _"don't reward size"_                                                                                                                                                                                                                                           |
| **C8** Extensibility & versioning         | medium          | One finding: `src:dp3-tender-of-service`'s effectivity keyed to the **pickup date** rather than to a record's creation date, which §4 records as a foreclosure. Otherwise the area's extension point is [SD §1.3]'s `type`, not a document field                                                                                                                              |
| **C5** Time model                         | low             | Documents carry an issue date and, in `src:dtr-part-iv`'s own words, _"little else."_ `src:samsara`'s C5 = 3 is a submission-workflow clock (created/assigned/due/submitted, `durationMs`, `signedAtMs`) and A6 declines the workflow it measures                                                                                                                             |

### 3.10 Explicitly rejected

| Rejected                                                           | Why                                                                                                                                                                                                                                                                              | Would have come from                                                            |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A `documentState` vocabulary                                       | §3.4 — eleven publishers, twelve facets, no two decompositions agreeing; and one publisher folding a state into the type axis                                                                                                                                                    | `src:dcsa`'s 17 values, `src:samsara`'s two machines                            |
| A `documentStateAt` projection                                     | §3.4(a) — it would be **B-STAGE** again: a fold with no input records, which [A2 §3.6] found is worse than no fold                                                                                                                                                               | the [SD §1.1] mutable-state pattern, applied one step too early                 |
| A `documentType` vocabulary                                        | §3.4(b) — the kind rides as data under [SD §1.3], and no published enum is needed before the acts that would carry it exist. Six publishers, six type lists, one of them folding signature into the type                                                                         | `src:project44`'s 18, `src:dcsa`'s 23, `src:smartmoving-api`'s two axes         |
| `documentCorrection` as a fact class                               | §3.3(c) — [SD §6] plus [A8 §8]'s `Instrument` already carry it, and a second home for one decision is [SD §1.1]'s named defect                                                                                                                                                   | Table A-402-4 read as needing its own act                                       |
| `documentDistribution` as a fact class                             | §3.3(c) — already `INSTRUMENT_KINDS`' `DISTRIBUTION_OBLIGATION`, and blocked on [A8 §9 item 6]'s recipient, which is recorded once already                                                                                                                                       | `src:dtr-part-iv` §E.3                                                          |
| Widening `EvidenceRef` to carry an inbound message                 | §3.5(c) — a published-schema change on an inference the source that models the act properly contradicts                                                                                                                                                                          | `src:stedi-x12-reference`'s _"the document is the message"_                     |
| An eighth `CAPTURE_METHOD` for condition-by-omission               | §3.7 — a published change, on a fact class owed to A4/A10, in a vocabulary [SD §5.1] owns. **Recorded as a gate, handed over, not taken**                                                                                                                                        | `src:dp3-tender-of-service` §C.9.a(14), NTS §1.6.2                              |
| A `place` or address model for Table A-402-4's four address fields | §3.6 — `placeRef` is owed to [SD §1.2] and A6 minting one would decide A3's open question by side effect                                                                                                                                                                         | Table A-402-4's whitelist                                                       |
| **Not rejected — sharpened.** A signature as `handover`            | §3.3(b) — the shortcut is refuted by §375.505(h)'s signature three days before loading and §375.505(g)(2)'s incomplete document. The act is real, distinct, and recorded as owed **to the user and A10** rather than to A8, because no source publishes what a signature asserts | the coincidence of §375.505(f)'s two signatures with the two custody boundaries |

---

## 4. What this forecloses, and the cost if it is wrong

1. **Document retention is not modelled, and four sources publish a rule for it.**
   `src:cfr-49-375` §375.503(e), §375.505(d) and §375.519(c) each set one year; `src:dp3-400ng`
   Item 4.10 gives the weight ticket its own; `src:dtr-part-iv` audits BL stock every 180 days;
   `src:milmove-docs` uses soft delete _"for multi-year retention, one-way by policy."_ [SD §1.2]
   named retention as a reason `document` is an aggregate, and A6 leaves it unmodelled because a
   retention rule is a duty on a party, not a fact about goods — and [SD §6.5]'s obligations are the
   mechanism if it is ever needed. **Cost if wrong:** a compliance question the catalog cannot answer.
   **Reversible:** yes, and cheaply, once `documentIssuance` lands and has a date to count from.
2. **A document's own version is not modelled.** `src:project44` carries an integer `version`,
   `src:uncefact-scrdm` a `Previous Revision_ Identification`. [SD §4.1]'s `supersedes` is the model's
   one revision mechanism and it is per **Assertion**, not per document. **Cost if wrong:** a consumer
   cannot ask which revision of an inventory a condition was read from. **Reversible:** only through
   `documentIssuance`, so this is really a consequence of §3.3 rather than a separate foreclosure.
3. **A document's governing edition is chosen by a business event in one source and by nothing
   here.** `src:dp3-tender-of-service` §A.1.b(1) binds an edition _"for shipments with a pickup date
   of 15 May 2026 or later"_, with a published edition per effectivity window. [catalog §2] versions
   the **specification** by `specVersion`, not the documents a shipment is governed by. **Cost if
   wrong:** an adjudication against the wrong edition. **Not reversible cheaply**, and §6 hands it to
   the user, because which counterparty's edition governs is a contractual question.
4. **Attachment containment is not modelled, and it is legally load-bearing.**
   `src:cfr-49-375` §375.505(b)(15): _"Each attachment is an integral part of the bill of lading
   contract"_, naming the estimate and the inventory. So one document contains others and the
   containment has force. The model carries no document-to-document relation, and `evidence[]` is the
   wrong shape for it — a containment is structural, and [SD §1.1] says `evidence[]` is for links that
   are _"evidentiary rather than structural."_ **Cost if wrong:** the corpus's clearest statement that
   a document is a composite is unrepresented. **Reversible:** yes, once there is an act that issues
   one.
5. **D-CITE makes `evidence[]` deliberately thin, and standing rules are therefore scattered.**
   §375.519(d)'s standing rule is A7's, the loss-and-damage forms' are A11's. **Cost if wrong:** no
   single place answers "what may this document establish?" **Reversible:** yes — a standing table
   over (document kind, fact class) is additive, and §6 names its owners.
6. **§3.7's gate makes an eighth capture method a decision someone must read this section to take.**
   That is the intent. **Cost if wrong:** a legitimate eighth member costs one deliberate edit and a
   paragraph. Judged the right trade, because the alternative is a member added silently to serve a
   fact class that does not exist yet.

---

## 5. ORIGINAL design — what household-goods moving needs that no source supplied

1. **D-CITE — a citation is a pointer, never a claim** (§3.5). The rubric's central A6 requirement is
   the one thing the corpus does not do, and the round-1 crosscheck already declared it
   **[ORIGINAL]**: _"not one source in 26 links a document to the EVENT it evidences."_ What A6 adds
   to that declaration is the **negative** half, which is sourced three times: standing is a rule over
   a pair and is not conferred by the citation. So the original step is narrower than the crosscheck
   expected — the link is ours, but the semantics of the link are argued from published text.
2. **D-ID — the accountable-artefact discriminator** (§3.2). That a bill-of-lading number identifies
   the form and a shipment registration number identifies the shipment is sourced twice in primary
   text. That the difference is a choice of `subject` in one fact class, rather than two fields or two
   types, is ours.
3. **The third kind of blocker** (§3.3(a)). The owed-authority ledger had two shapes — no party
   entity, and no `boundBy` member. `documentIssuance` is the first absent class whose authority is
   **already determined** by an existing member, so it is blocked on minting alone. Recognising that
   as a distinct and cheaper category is [SYNTHESIS] over [A8 §5] row 10 and §3.2's mapping.
4. **A refusal recorded as an assertable rather than as prose** (§3.4(a), §3.7). A2 wrote
   `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE` because _"a scenario that asserts a gap needs something
   to assert against."_ A6 does it twice and, for the second, upgrades the pattern: the constant is
   held by a compile-time exactness assertion between two independently declared things, so it fails
   when the world changes rather than merely being read. **That is the generalisation worth keeping:
   a recorded gap should be a gate wherever the gap has an edge the types can see.**

Nothing else here is ours. §3.6 maps a published whitelist onto a mechanism A8 built; §3.7 hands a
sourced rule to A4; §3.8 mostly discovers that other areas already have the answer.

---

## 6. What only the user can decide, and what is owed elsewhere

### Owed, with an owner

| Owed                                                                                                                | Owner                                                                      | Why A6 does not settle it                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `documentIssuance` as a `type` in [SD §4.7.1] and a row in [A8 §5]                                                  | [SD §4.7] and [A8]                                                         | Minting is [SD §4.7]'s. Its authority is **not** owed: `boundBy = SCHEME`, §3.3(a)                                   |
| **What a signature asserts**                                                                                        | the user, and A10                                                          | §3.3(b). Four sources publish the procedure; none publishes the proposition. A fact class needs a value              |
| `conditionValue` — the condition vocabulary                                                                         | A4 / A10                                                                   | Already owed there, and §3.7 does not touch it                                                                       |
| **An eighth capture method for condition-by-omission**, or a rule that makes M1 admit it                            | A4, over [SD §5.1] / [SD §5.2]                                             | §3.7. Published vocabulary, and the fact class it serves is A4/A10's                                                 |
| `placeRef` — a `place` aggregate or a Stop attribute                                                                | [SD §1.2] / A3                                                             | §3.6's four unlandable address fields. Already owed                                                                  |
| `partyRole`'s authority row                                                                                         | [A8 §9 items 1-2]                                                          | §3.6's agent code. Already owed                                                                                      |
| `identityScheme` — the scheme list, including which schemes are document-accountable                                | A9                                                                         | §3.2(a). D-ID takes it as an input for exactly this reason                                                           |
| **Evidentiary standing per (document kind, fact class)** — §375.519(d)'s collection rule; the loss-and-damage forms | A7 (collection), A11 (claims)                                              | §3.5(b) consequence 2. D-CITE says standing is not in `evidence[]`; it does not say what the rules are               |
| **Rescission of the bill of lading** as a lifecycle act                                                             | [A1]                                                                       | §3.6. Rescinding the BL withdraws the undertaking, which is `orderCancellation`'s subject matter, not a document act |
| **Document retention, version and attachment containment**                                                          | deferred, and §4 items 1, 2 and 4 say why each waits on `documentIssuance` | Each needs an act with a date before it has anything to attach to                                                    |

### What only the user can decide

1. **Which edition of a counterparty's document governs a shipment, and how it is chosen.**
   `src:dp3-tender-of-service` keys it to the **pickup date** and publishes an edition per window;
   nothing else in the corpus keys it at all. Whether our tenants need edition effectivity, and
   whether it is keyed to pickup, award or signature, is a contractual question per lane. §4 item 3.
2. **Whether a customer's signature on an inventory is treated as an assertion of the inventory's
   contents.** §3.3(b). The corpus publishes the procedure and the consequences of skipping it and
   never states the proposition, and the answer determines whether a signature is a fact class or a
   field on one.
3. **Whether an inbound partner transmission is ever retained as a `document`.** §3.5(c) keeps it on
   the ingest side. If a tenant is contractually obliged to retain transmissions as records, that is
   a retention duty over an artefact, and the answer changes §3.5(c)'s cost calculation rather than
   its reasoning.

---

## 7. Confidence

| Decision                                       | Confidence                                         | Basis                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§3.5 D-CITE** — a citation is a pointer      | **High on the negative half, medium-high overall** | Three published sentences say standing is not conferred by citation, one of them **primary** (§375.519(d)) and two grade-A secondary (§C.9.a(22), (24)). The generalisation to every pair is [SYNTHESIS]. The crosscheck already declared the link itself [ORIGINAL]                      |
| **§3.5(c)** not widening `EvidenceRef`         | **High**                                           | Two independent grounds: a publisher that models both keeps the document identifier and the acceptance identifier apart (`src:nmfta-ebol`), and ratifying costs no published byte where widening costs a re-validation. The one argument for widening is an observation about an encoding |
| **§3.2 D-ID**                                  | **Medium-high**                                    | Both halves of the discriminator are sourced and one is primary twice (§375.505(b)(16), §375.519(a)(6)). The accountable-stock half is **secondary** (`dtr-part-iv` has no capture), which is the cap. Reading the distinction as a `subject` choice is ours                              |
| **§3.2(b)** the per-kind table                 | **High**                                           | It is six readings of enumerated field lists, five of them primary (§375.503(a), §375.505(a), §375.519(a))                                                                                                                                                                                |
| **§3.3** `documentIssuance` absent             | **High**                                           | A negative over a declaration table, checked against the table rather than the prose                                                                                                                                                                                                      |
| **§3.3(a)** its authority resolved as `SCHEME` | **Medium-high**                                    | [A8 §5] row 10's sentence plus §3.2's mapping. [SYNTHESIS], and it is the one place A6 asks A8 to accept a reading rather than a citation                                                                                                                                                 |
| **§3.3(b)** signature is not `handover`        | **High**                                           | Refuted from the same primary subsection that creates the temptation — §375.505(h) and (g)(2)                                                                                                                                                                                             |
| **§3.4** `documentState` refused               | **High**                                           | Eleven publishers tabulated, twelve facets, and one publisher (`src:sirva-ade`) demonstrating the fusion in a live contract. The same argument shape [A2 §3.3] used, with more publishers                                                                                                 |
| **§3.4(a)** no projection                      | **High**                                           | Structural: a fold needs inputs, and §3.3 shows there are none. [A2 §3.6] is the precedent and it is a finding, not a preference                                                                                                                                                          |
| **§3.6** the whitelist mapping                 | **High on the mapping, medium on the conclusion**  | The eight rows are readings of a published table against a published vocabulary. The conclusion — that a sub-fact grain would not help — depends on `shipmentType` staying refused ([A2 §3.3]) and on `placeRef` staying owed                                                             |
| **§3.7** condition-by-omission inexpressible   | **High**                                           | A negative over a seven-member published enum, plus M1's stated reason read against the sources' stated mechanism. Primary support for the _shape_ twice (§375.515(a), §375.701(b)), secondary for the HHG instance                                                                       |

### Assertions made here that no source supports

1. **That `evidence[]` carries no assertion at all** (§3.5). The sources deny that citation _confers_
   standing; none says a citation is semantically empty. The step from "citation does not confer
   standing" to "a citation claims nothing" is **[ORIGINAL]**, and it is the step that makes
   consequence 1 (a party may cite another party's document) work. If it is wrong, the fix is a
   standing field on `EvidenceRef`, which is additive.
2. **That `documentIssuance` and a signature are two classes rather than one** (§3.3). No source
   separates them; §375.505(a) and (f) are two paragraphs of one section, and DCSA collapses issuance
   and submission into one status vocabulary. The separation is ours, argued from §375.505(h)'s
   three-day gap between signature and loading.
3. **That a bill of lading's number is not also an identity of the shipment** (§3.2). §375.519(a)(6)
   offers the two as alternatives, which establishes that they are different identifiers, **not** that
   the BL number is never used to identify the shipment — and in practice it plainly is. D-ID says
   which subject the _assertion_ attaches to, and a consumer who wants "the shipment's BL number" gets
   it by traversal. Flagged because it is the one place a reader may find the rule
   counter-intuitive.
4. **That NTS's "identity follows the paper" is not evidence against D-ID** (§3.2(b)). `src:dtr-part-iv`
   A-406 §B.4.b makes a partial withdrawal **split the lot** and force a new warehouse receipt — a
   case where the document determines an aggregate's identity, which is the opposite of [A2 §3.2]'s
   B-ONWARD. A5 §3.4(c) excludes NTS from the model, so it is out of scope rather than refuted, and
   §Cross-area records it so that whoever reopens permanent storage meets it.

---

## 8. Acceptance — the nine scenarios, run explicitly

### 1. Five families' goods on one van over four days — **A6 is silent, with one note**

Nothing here is a document question. The note: `src:dtr-part-iv` §F.10.a(18) makes a consolidated
shipment _"a separate BL… issued for each customer's lot"_, cross-referenced in Block 27 — so under
§3.2 five `document` subjects each carry their own accountable number, and the cross-reference between
them is a document-to-document relation §4 item 4 does not model.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **A6 contributes a negative**

§3.7: the two ends of the stay are custody boundaries and [A8 §5] row 9 already reaches them. A6 adds
no rule, and §1's first finding is that A5's hand-off was already discharged.

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **A6 is decisive on one point**

The artefact a system would call a POD does not establish the delivery: §3.8's row, on
`src:dp3-tender-of-service` §C.9.a(24). The `delivery` act with its `(outcome, reasons[])` is the
fact; the signed sheet is `evidence[]` under D-CITE. And the two short items are `condition` and
`pieceCount` assertions under row 9's joint holding, with §375.503(d)'s written notations as their
evidence.

### 4. A reweigh in transit — **A6 is decisive, and this is D-CITE's scenario**

Two weight tickets, two weighings, one shipment. §375.519(a) makes each ticket a separate document
that must be signed by the weigh master; §3.2(b) shows neither ticket has an identity of its own, so
both ride in `context[]` — which is what [SD §4.7.1]'s `weight.net` row already does. D-CITE is what
lets the reweigh-demanding party cite the original weigher's ticket without asserting it, and
§375.519(d)'s collection rule is the standing rule A7 owes.

### 5. A car on a separate carrier, delivered a week apart — **A6 is silent**

### 6. Cancelled after packing, before loading, with materials charged — **A6 contributes a precondition, and it is a gap**

Cancellation before loading is inside §375.505(h)'s three-day rescission window if the signature is
recent, and inside §375.401(i)'s amendment window because loading has not begun. Neither is
computable: `AMENDMENT_WINDOWS` is owed, the rescission window is keyed to a **document** and the
table is keyed to fact classes (§3.6), and there is no record of the signature the window runs from
(§3.3(b)). The scenario's own to-do about a terminal stage with no transport document stands.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **A6 is decisive, and it closes the `FINDING:`**

This is the scenario that carries the `EvidenceRef` finding. §3.5(c) ratifies the ingest-side
widening: the inbound message rides in `BoundaryEvidenceRef` and does **not** survive into the minted
Assertion's published `evidence[]`; it is retained on `RetainedSubmission` under
**E-CANON-OBLIGATION**. The test's `FINDING:` becomes the decision.

### 8. A mid-journey custody handoff — **A6 contributes the distinction that keeps it clean**

§3.3(b): the signature at the boundary is not the `handover`. The exception sheet that
`src:dp3-tender-of-service` NTS §1.6.10 describes, with both parties' differing opinions _"separately
identified as to source"_, is already [A8 §7.3]'s A8-JOINT — two `condition` assertions, both
published, `selected[]` empty. A6's only addition is that the **sheet** is `evidence[]` on both of
them and not a third assertion.

### 9. A partial load under one bill of lading — **A6 is decisive on the document half**

One bill of lading, N Portions ([A2 §3.2]). Under §3.2 that is **one** `document` subject with one
accountable number, and the Portions are addressed by `identity` under the carried-identifier branch —
`src:dp3-400ng` Item 17.13's **inventory item numbers**, which are numbers on articles and not on the
document (§3.2(b)). So the scenario's own `Portion` grain and the document's identity do not compete,
which is what P-IDENTITY needs.

### Summary

**Decisive in 4 of 9** (3 partly, 4, 7, 9), **contributes a precondition or a negative in 3**
(2, 6, 8), **silent in 2** (1 with a note, 5). Compare A2's four decisive and A5's two: A6 is decisive
where a document's identity or a citation's meaning is in play, and silent everywhere the question is
about goods.

---

## Cross-area consequences to record

### To [SD] — one narrowing, one count deleted, one row annotated

1. **[SD §1.2]'s invitation is taken, and its bullet is edited.** _"A6 may narrow it, never remove
   it"_ — narrowed at §3.2 (which assertions may take a `document` subject) and §3.3 (what acts on a
   document the model does not carry). `document` stays an aggregate and gains no field. The bullet's
   opening clause, _"A6 is not written, but…"_, was stale binding text the moment this document
   landed, and is replaced with a pointer to §3.2 and §3.3 for the same reason as item 2: a
   subordinate document does not get to leave [SD] describing a state of the world that has changed.
2. **[SD §4.6.2]'s sentence is narrowed, not contradicted — and the narrowing is written into [SD],
   not asserted from below.** _"the inbound message goes in `evidence[]`"_ is true on the **boundary**
   side, where `BoundaryEvidenceRef` carries it; it is not true of a minted Assertion's published
   `evidence[]`. Because **[SD] outranks this document** (§0's status line), a narrowing that lived
   only here would be a disagreement with binding text rather than a refinement of it — which is
   [A2 §3.2]'s precedent, where closing `[SD §10.4]` bullet 1 meant **editing [SD §10.4]**. So a
   bracketed note now stands at **[SD §4.6.2]** beside E-CANON-RESOLVE's sentence, and a second at
   **[SD §4.6.3]**'s _"same `evidence[]`"_, where the narrowing turns out to **strengthen** the claim:
   both the admitted and the refused path produce the same published `evidence[]` and neither carries
   the message, so the paragraph's "one behaviour with a cardinality gate" is now held in the types
   rather than asserted.
3. **[SD §4.7.3] gains `documentIssuance`**, with its blocker recorded as the **third kind** — not a
   missing party entity ([A5]'s three), not a missing `boundBy` member ([A1]'s two and [A2]'s one),
   but minting alone, because `boundBy = SCHEME` already determines its holder (§3.3(a)).
4. **A count in prose is deleted.** `src/rules/corrections.ts`'s `AMENDMENT_WINDOWS` says _"the corpus
   publishes exactly one amendment window (§375.401(i))"_. `src:cfr-49-375` §375.505(h) publishes a
   second window over a document, and whether it is an _amendment_ window is arguable. Deleted rather
   than corrected, per [A1 §9]: no gate reads it.
5. **The `identity` row's `contextNote` is annotated** to say which of §3.2's two shapes it describes.
   The row itself is unchanged: `anyAggregate` already admits a `document` subject, which is why D-ID
   is a reading rule and not a schema change.

### To [A8] — one row offered with its authority already answered

A6 does **not** ask A8 for an authority row it must research. `documentIssuance`'s holder is
`boundBy = SCHEME` — [A8 §5] row 10's own phrase, _"the ISSUER of the scheme, and nobody else"_ —
because for the one document kind with a scheme of its own, the party controlling the number scheme is
the party issuing the instrument, in both published regimes (§3.3(a)). What A8 is asked for is to
**accept a reading** rather than to close a gap, and to record the third blocker kind in [A8 §9
item 8]'s ledger, which currently separates three reasons a row can be missing and now has a fourth
that is cheaper than all of them.

`src/rules/authority.ts`'s `Instrument.grants` TODO is **taken**, not sharpened: §3.6 shows the
whitelist is coarse because **half its fields are not facts this model carries at any grain**, so a
sub-fact grain would move none of them. The TODO is rewritten to say that, and it stops being an
invitation to add one.

### To [A1] — one act handed over

**Rescission of the bill of lading is A1's, not A6's.** `src:cfr-49-375` §375.505(h) gives the shipper
three days after signing to _"rescind the bill of lading without any penalty"_. Under [A2 §3.2] the
bill of lading is the record of the undertaking, so rescinding it withdraws the undertaking — which is
`orderCancellation`'s subject matter, one of the two classes [A1 §Cross-area] found blocked on the
`boundBy` gap. A1 should note two things: the window is keyed to the **document's signature**, which
the model does not record (§3.3(b)); and §375.505(h)'s non-restart clause means a permitted upstream
amendment does not reopen it.

### To [A4] — one capture method, with its shape stated and its name left to A4

§3.7. The published rule is that the **omission** of an exception symbol on a signed inventory is an
affirmative assertion of good condition with the burden assigned
(`src:dp3-tender-of-service` §C.9.a(14), NTS §1.6.2), and `src:cfr-49-375` gives the shape twice in
primary text (§375.515(a)'s presumed waiver, §375.701(b)'s _"except as noted"_). [SD §5.1]'s seven
capture methods cannot say it, and the semantically closest — `ASSUMED_FROM_PLAN` — is the one **M1
forbids at `basis = ACTUAL`**.

**M1 is right and should not be relaxed.** What the sources describe is not an unchallenged plan: it is
a challengeable assertion whose challenge window was **offered per line item and per page and
declined**, with the rebuttal burden assigned to a named party. An eighth member would need to carry
that — the signature is what makes the silence answerable — and A4 should mint it beside
`conditionValue` rather than before it, since a capture method with no fact class to attach to is the
mirror of A2's B-STAGE. `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE` is gated so that adding a member
without reading §3.7 does not compile.

Second, smaller: A6 declines to reach into A4's execution-event model and notes that
`src:dp3-tender-of-service`'s forty-three-row obligation catalogue — the source A4's own scope note
calls the material round 1 could not find — carries **the document each obligation is recorded in** as
a column. When A4 is written, that column is the evidence for `evidence[]`'s per-obligation use, and
§3.5's D-CITE is what stops it becoming a claim.

### To [A7]

1. **§375.519(d) is a collection rule and A7 owns it**: _"All freight bills… must include true copies
   of all weight tickets… **in order to collect** any shipment charges dependent upon the weight
   transported."_ Primary. Under §3.5's D-CITE, standing is a rule over a (document kind, fact class)
   pair, and this is the corpus's cleanest published instance — a charge that cannot be collected
   without a named document. A7 inherits the pair and the rule.
2. `src:dp3-tender-of-service` §C.12.a-b's **document package by recipient and by moment** (weighted
   BL, weight tickets, DD 619, inventories, third-party invoices to the PPSO within 7 GBD) is an
   invoicing precondition expressed as a document set. Beside it, §B.8.a(2)(c)-(d)'s **supplemental
   invoice refunding the reweigh difference**, which is [SD §6.3]'s offsetting record with a
   document attached.

### To [A9]

1. **D-ID needs one thing from A9 and takes it as an input:** whether a scheme is
   **document-accountable** — assigned to the form, independently of any shipment. §3.2(a). The
   boundary is that A6 owns the difference between a document's own fact and a fact it carries; A9
   owns the scheme list. When `identityScheme` is published, each member needs that bit.
2. **The evidence is already gathered.** `src:dtr-part-iv` A-413 §C.2's accountable stock (serial
   pre-assignment, void/lost/stolen reporting, 180-day audits) is the model case of a
   document-accountable scheme; `src:nmfta-ebol`'s **acceptance identifier distinct from the document
   identifier** is the model case of a scheme over the _lodging_ rather than over the document; and
   `src:cfr-49-375` §375.519(a)(5)'s _"last name of the individual shipper as it appears on the bill of
   lading"_ is the corpus's admission that a party can have no identifier at all — its own analysis
   calls it _"a weak natural key."_
3. **One caution.** `src:dtr-part-iv` uses **BL block numbers as stable field addresses across
   documents** — _"the destination city or installation shown in Block 18"_ governs SIT charges. That
   is positional addressing into a document, and it is not an identity scheme; A9 should not read it
   as one.

### To [A10] / [A11]

1. **What a signature asserts is A10's and the user's** (§3.3(b)), and the four sources that publish
   the procedure are all A10-adjacent: `src:dp3-tender-of-service` §C.9.a(4)-(11)'s per-page
   e-signature with post-signature immutability, `src:cfr-49-375` §375.503(c)'s inventory signed by
   both parties, §375.505(f)'s bill of lading signed at both ends, and `src:samsara`'s `signedAtMs`
   with DVIR first/second/third signatures.
2. **The estimate is the corpus's clearest case of a document that is also a fact class** (§3.8), and
   it is A10's: `src:cfr-49-375` §375.403(a)(3) makes a binding estimate an attachment _"integral to
   the bill of lading contract"_, §375.401(i) publishes its amendment window, and
   `src:dp3-tender-of-service` §C.2.b gives it a **stated tolerance** — 10% of actual net weight, with
   administrative action for breach. An estimate that carries its own accuracy commitment is a
   different object from an estimate.
3. **A11**: the standing of the loss-and-damage forms is A11's (§3.5(b)) — the jointly-signed AT
   DELIVERY notice, the AFTER DELIVERY notice at 180 days, and `src:dp3-tender-of-service` NTS
   §5.11.3's reversal that failing to provide the forms _"will eliminate any requirement for
   notification."_ And `src:dtr-part-iv` A-406 §B.16.i(3) admits photographs as one of three ways to
   discharge a burden of proof, which is a standing rule in A11's own area.

### To whoever reopens permanent storage — one counter-case, recorded

`src:dtr-part-iv` A-406 §B.4.b: a partial withdrawal from NTS **splits the lot** and forces a new
warehouse receipt for the remainder, and §B.2.d makes the receipt a nonnegotiable document of title
_"whose original must exist exactly once."_ There, **the document determines the aggregate's
identity** — the direct opposite of [A2 §3.2]'s B-ONWARD, where the undertaking is the discriminant
and the document is its record. [A5 §3.4(c)] excludes NTS from the model, so this is out of scope
rather than refuted. Recorded at §7's fourth item so that it is met rather than rediscovered.

### To [`../rubric.md`]

The A6 row's eight items resolve to **two that are A6's, four that are other areas' or already
carried, and two that are `evidence[]` itself** (§3.8). Recorded because the row reads as a list of
eight document classes to model, and a reader who took it that way would mint six things the model
does not need. The note beside A2's observation about per-area scoring, and for the same reason: a
column is a plan, not a state.

---

## 9. What this puts in the executable specification, and how each part is held

| What                      | Where                                                                                                                                         | How it is held                                                                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-ID**                  | `documentIdentitySubject` + `IDENTITY_SUBJECT_UNDETERMINED_REASONS` in `src/rules/documents.ts`                                               | A total function over an input discriminant with an `undetermined` branch, exhaustively switched — B-ONWARD's shape ([A2 §3.2])                                                                                                                                                                               |
| **D-CITE**                | `src/assertions.ts`'s `EvidenceRef` docstring, rewritten from a TODO into the decision; `CITATION_CLAIMS_NOTHING` in `src/rules/documents.ts` | The rule is a semantics decision, so what is _held_ is the **refusal to widen**, and it is held in `tests/conformance/document-evidence-refuses.ts` — two `@ts-expect-error` directives that go unused the moment `EvidenceRef` gains a branch. See the note below the table: the first draft did not do this |
| **`documentIssuance`**    | `ABSENT_AND_OWED` in `src/vocabulary.ts`, `[SD §4.7.3]`'s prose, and `AS_WRITTEN` in `tests/conformance/documents.test.ts`                    | The three-file gate every absent class passes: a member, a phrase in the shared document, and a test-table entry                                                                                                                                                                                              |
| **The state refusal**     | `DOCUMENT_STATE_IS_NOT_COMPUTABLE` in `src/rules/documents.ts`                                                                                | A constant a scenario asserts against, A2's pattern for `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE`                                                                                                                                                                                                           |
| **The capture gap**       | `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE` in `src/rules/documents.ts`, held by `Exact<CaptureMethod, …>`                                     | **A gate, not a comment.** The seven member names are re-declared here independently of `envelope.ts`, so an eighth member makes the assertion `never` and stops compiling                                                                                                                                    |
| **The whitelist mapping** | `TABLE_A_402_4_LANDINGS` in `src/rules/documents.ts`; `authority.ts`'s `Instrument.grants` TODO taken                                         | A table whose rows name either a real `AssertionType` or the owed thing they cannot reach, typed so a row cannot name a non-member                                                                                                                                                                            |
| **The deleted count**     | `src/rules/corrections.ts`                                                                                                                    | Deleted, with §375.505(h) recorded beside it, per [A1 §9]                                                                                                                                                                                                                                                     |
| Registration              | `A6` in `DOCUMENTS`; the new vocabularies in `VOCABULARIES`; `D-ID` and `D-CITE` in `RULES` — all in `tools/generate-glossary.ts`             | None is auto-discovered                                                                                                                                                                                                                                                                                       |
| Version                   | **Unchanged.** No emitted schema byte changes — see below                                                                                     | `[catalog §2.4]`'s non-bump row, precedent set by [A2]                                                                                                                                                                                                                                                        |

### The round's own lesson, applied to the round's own tests

**A6's first draft did not hold its central refusal, and the defect was the exact one this document
generalises.** Two tests were written for §3.5(c): one asserted
`expect(['document','assertion']).not.toContain('inboundMessage')` over a hand-written array that
reads `EvidenceRef` not at all, and one asserted `expect(fixture.evidence).toBeUndefined()` over a
fixture the test itself had written. **Neither could fail.** That is [A2 §9]'s tautology in a second
costume — a decorative assertion beside a gate that does not exist — committed inside the round whose
§9 states the rule against it.

The fix is the rule: **the gap has an edge the types can see, so it gets a gate.** Widening
`EvidenceRef` is that edge, and the house pattern for it is a `-refuses.ts` file, so
`tests/conformance/document-evidence-refuses.ts` now carries two `@ts-expect-error` directives — the
ingest-side type is not assignable to the published union, and neither is the message literal. The
tamper is §9's eighth: widening `EvidenceRef` reports **both** directives unused and the package stops
compiling. One runtime assertion that could not fail is deleted outright; the other is rewritten to
check what it can honestly check, with the reason stated where the next reader meets it.

There is a smaller finding inside the fix. `@ts-expect-error` suppresses the errors on **one** line,
and an inline `EvidenceRef` literal with the wrong `kind` reports on its **`ref`** property rather
than on its `kind` — so a directive written above the literal sits above the wrong line and the file
compiles with the directive silently unused-but-tolerated. Naming the value first and annotating the
**assignment** puts the one error on the one line the directive covers. Recorded because the first
attempt at the gate had this shape and `tsc` caught it.

Worth writing down because it happened in the round that named the rule: **a refusal is not held by
an assertion that the refused thing is absent from a list you wrote.** It is held by asking the
compiler to refuse it.

### Why there is no version bump, and it is the same reason A2 had

`git diff` over `captured.schema.json` and `queried.schema.json` is expected to be **empty**, and the
reason is worth writing down because it is what §3.2(d) and §3.5(c) have in common. D-ID files an
assertion the published schema **already admits** — `record.identity`'s `subject` and `context[]` are
both `SubjectRef.family.anyAggregate`, which includes `document` and `shipment` — and §3.5(c)'s whole
argument is a decision **not** to widen a published union. `absentFactClasses` moves 14 → 15 in
`index.json`, which [catalog §5] already recorded of A8's round _"alone would not have moved
`specVersion`"_, because [catalog §2.3] classifies changes to what is **published** and an owed count
is a change to what is admitted to be **missing**.

**An area whose central output is two refusals and a reading rule changes no published byte.** That is
not a disappointment; it is what a settled envelope looks like when a new area lands on it.

### Gates tampered and watched to fail

Eight, restored after each. Every one is a gate A6 added or a count A6 moved.

1. **An eighth `CAPTURE_METHODS` member** (`'ASSERTED_BY_OMISSION'`) → `src/rules/documents.ts`
   `TS2322: Type 'true' is not assignable to type 'never'`. This is the one that matters: it is the
   only compile-time gate in the round, and without the tamper there would be no evidence the
   exactness assertion is not another tautology.
2. **`documentIssuance` renamed throughout [SD §4.7.3]** → `documents.test.ts`:
   _"[SD §4.7.3] no longer names `` `documentIssuance` `` for ABSENT_AND_OWED member
   documentIssuance"_. Worth recording that renaming **one** of its two mentions in that section did
   **not** fire, because the gate is a substring search over the section rather than over a bullet —
   so the tamper had to remove both. A gate that passes on a half-tamper is still a gate; a reader
   assuming it checks the bullet specifically would be wrong.
3. **[catalog §5]'s absent count reverted to 14** → `catalog.test.ts`:
   _"expected … to contain `**15** fact classes named`"_. The gate that caught this count on the
   first run, before the tamper.
4. **A `document`-only subject family added to `SUBJECT_FAMILIES`** → §3.3's first assertion fails,
   naming the family. The check that would notice if a document-subject act row ever lands.
5. **`document` removed from `weight.tare`'s `context[]`** → §3.3's enumeration fails, naming
   `weight.tare`. This is the assertion that **corrected §3.3's own first draft** from five rows to
   six, so its tamper is the round's clearest case of a gate being worth more than a reading.
6. **A `TABLE_A_402_4_LANDINGS` row naming a non-member** (`'billOfLadingIssued'`) →
   `TS2322: Type '"billOfLadingIssued"' is not assignable to type 'AssertionType'`. The whitelist
   mapping cannot claim a fact class the vocabulary does not carry.
7. **The Code of Service row's reason changed from `VOCABULARY_REFUSED` to `AGGREGATE_OWED`** → two
   failures: the residue collapses to three kinds, and the refused-row assertion names the wrong
   field. §3.6's conclusion depends on the residue being four **kinds** rather than four instances of
   one, so this is the tamper that protects the argument rather than the data.
8. **`EvidenceRef` widened with an `inboundMessage` branch** → `document-evidence-refuses.ts` reports
   **both** `@ts-expect-error` directives unused (`TS2578`, twice). The gate behind §3.5(c), added
   after the first draft shipped two assertions that could not fail — see the note below.

### A recorded gap should be a gate wherever the gap has an edge — the next case along from [A2 §9]

[A5 §9] established that a bare `Exact<>` alias is a comment until something is assigned to it.
[A2 §9] sharpened it: an assigned one can still be a tautology, because
`Exact<keyof typeof T, K>` over a mapped type `T` can never fail — _"an `Exact` earns its place only
between two things declared **independently**."_

A6's `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE` is the positive case the two findings imply. The claim
it records — that no capture method can express condition-by-omission — has an edge the type system
can see: it is false the moment `CAPTURE_METHODS` gains a member. So the constant is held by an
exactness assertion between `CaptureMethod`, declared in `envelope.ts`, and the seven names written out
again **here**, in A6's own module, from A6's own reading. Nothing generates one from the other; an
eighth member makes the assertion `never` and the package stops compiling, and whoever added it is
sent to §3.7.

Compare A2's `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE`, which is a plain `= true` — correctly, because
its claim has no edge the types can see: it is false only when a fact class is minted, and a mint is a
deliberate act that touches three files and a test table already. **The rule is not "always gate a
recorded gap." It is: gate it when the gap has an edge the types can see, and say why when it does
not.** §9's two constants sit side by side as the two halves of that rule.
