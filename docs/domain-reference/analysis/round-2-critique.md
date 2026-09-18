# Round 2 critique — adversarial review of the three structural decisions

Workflow `wf_c75db6d1-789`, 2026-09-17. The three decision documents were written in PARALLEL and
reviewed by an adversary instructed to refute, to test nine real household-goods scenarios, and to
find invention presented as evidence. **All three came back `needs-revision`.** The parallel
authoring is itself the cause of most cross-document conflicts below.

## A3-trip-stop-assignment.md — **needs-revision**

### Claims not supported by the cited evidence

- §7 rates 'Shipment identity survives every split and every vehicle' HIGH on `src:cfr-49-375` §375.705. The cited analysis says only: "'transported on more than one vehicle' as a _charging_ rule (375.705)" — and in the same row scores CFR A3 at C1=1/C3=0 and instructs "Do not use this source for A3." A rating rule about charges says nothing about identity across custody changes or storage, and the other source cited in that row (`src:dtr-part-iv`) mints a NEW BL on reshipment of a terminated shipment. The claim is broader than any cite.

- §2.8 asserts Atlas's A3 "C2 is properly held at 2." The committed `atlas-world-group-api/analysis-supplement-vocabulary.md` corrects A3 C2 to **1**, records that the five operational stop-type axes (`stp_type`, `stp_type1`, `stp_reftype`, `awg_stp_triptype`, `stp_transfer_type`) have "no code list and no description anywhere in the catalog," and concludes the Atlas "A3 nomination weakens correspondingly." Every Atlas-sourced element of the shape — the manifest layer (§6.2), the accept/perform two-status lifecycle (§5.8), crew (§5.7), the four mileage accumulators (§4.5) — is column-name evidence, and the document does not say so.

- §7's confidence-raising plan — "both cheap: fetch the Atlas `/Types` reference-data endpoints (five of ~35 are reachable on the current QA key today)" — is refuted by material already in the corpus. The supplement records: **no `Ocp-Apim-Subscription-Key` exists anywhere in the repo**, the inventory is **63** endpoints not ~35, 47 _would_ be reachable _if_ a key existed, and decisively: "Even a complete, successful capture of all 47 reachable endpoints would not raise A4's semantic precision, and would raise A3's and A5's only partially" — because `mfh_number` and every operational stop axis carry no code-list binding. The stated remedy for the document's lowest-confidence claim (§6.2, the manifest layer, "the most expensive correction in §4") is both blocked and off-target.

- §5.4 claims the stop-purpose vocabulary is ORIGINAL because "`src:omnitracs-roadnet`'s nine-member union is a fleet's vocabulary; `src:macropoint` has two values." It omits the one van-line-native stop-type vocabulary in the corpus: Atlas's observed `/Estimating/Stop/Types` values — `Origin`, `Destination`, `Origin Extra Stop`, `Destination Extra Stop`, `Origin Airport Stop`, `Destination Airport Stop` — which the supplement flags as "**Stop types are directional pairs**… A real modeling idea, and one the ideal model should weigh." That directly contests the chosen DCSA `facilityTypeCode` design (a bare role the place plays in this visit, no direction). The same supplement records "**SIT is not a stop type**… Storage is modeled as a _service at_ an Origin or Destination stop, not as a _stop of its own_. That is a direct A5/A3 design question for the ideal model and it can be stated now, without the capture" — unengaged, while §3.3 and §5.1 make a warehouse **stop** the entire SIT seam.

- §3.4 criterion 4 ("five independent vocabularies name consolidation") counts `SMD Consolidated Shipment Manifest Data`. Per the 212 analysis, `SMD`'s three elements are "service level + method of payment + pick-up-or-delivery code" — only the segment's _name_ mentions consolidation. The criterion survives on `CN Consolidate`, `manifestId`, `HaulingSegmentType` and Rec 24 code 15; the fifth support is a segment title.

- §3.3's SIT row ends "This is only expressible because the shipment is not a child of the trip — see §4." §4 is the foreclosure section; the ORIGINAL-design disclaimer for this exact claim is at §5.1. In the one table a reader uses to check the model against reality, the most invented row points away from its own caveat.

### Scenarios the model cannot express

- **A car on a separate carrier, delivered a week apart** (and equally: SIT delivery-out by a different agent, and an interline handoff to another hauling agent). `Stop` = "a visit by one **identified vehicle** to one place, **on one trip**"; a shipment's origin and destination are "**derived** from its `StopAction`s and are never stored." A movement performed by a counterparty whose vehicle, trip and stop sequence we never see can produce no Stop — so the car's delivery is unrecordable, and until someone mints a phantom trip the car shipment has **no destination at all**. The parallel cardinality document makes this case half of its stated acceptance test and defers all routing here.

- **Delivery attempted twice: customer absent, then refused for damage, two items short.** `StopAction` names "exactly one shipment," carries "a quantity" and "a result" — with no result vocabulary and no item grain. The model cannot say _delivered, two items short_: that is neither a delivery nor a non-delivery. Two grade-A sources supply the missing shape and neither is cited for it: `src:open-trip-model` — from which this document takes the Action primitive — has `result.status ∈ succeeded|failed|partiallySucceeded|cancelled`, a 10-value `result.reason` catalogue in 5.7 (`damage`, `rejectedByReceiver`, `incomplete`, `receiverAbsent`…), and **5.8 sub-results**: "the unload action can be succeeded for certain goods and failed for others… the sub results would indicate which goods were unloaded successfully and which were not." `src:shippeo` publishes the grid outright: `LIV/MQP` delivered-but-short vs `REN/MQP` refused-for-short vs `REN/AVA` refused-for-damage vs `REN/DAF` consignee-absent — its analysis calls delivered-short "The most important single import" for HHG.

- **An order cancelled after packing but before loading, packing materials already charged.** §6.3 leaves open whether "a local-move day with a pack crew and no linehaul" is a Trip. If it is not, the pack generated no Stop; §Cross-area then binds accessorials to "the **stop** that caused them," so the packing charge has no anchor, and the shipment — having no `StopAction` — has no origin either. The scenario is not merely unhandled; it is blocked behind an admitted user question.

- **Goods into SIT, delivered from the warehouse six weeks later by a DIFFERENT agent.** Rated HIGH ("a shipment must be able to exist with no trip"), but the store-out half requires a warehouse-crew delivery day to be a Trip — the same open §6.3. A confidence-High discharge conditioned on an unresolved user decision.

- **A shipment transferred mid-journey from one hauling agent to another.** `transfer-out` and `transfer-in` must each sit at a stop on a trip. Goods dwelling on a cross-dock overnight between two trips have no trip (the shipment is between journeys) and no SIT record (A5 owns storage, not cross-dock dwell), so the interval is unmodelled — the SIT gap again, without A5's escape hatch. `agent-facility-transfer` is listed as a stop purpose; the dwell between the two stops is not modelled anywhere.

- **A van carrying five families' goods over four days** — expressible, but the definitions fight. Trip = "one vehicle journey performed by **one assigned resource set**," while `Assignment[]` carries an "effective interval" and §6.1 asks whether a driver change is a new trip. The prose answers §6.1 'new trip'; the structure answers 'new assignment interval'.

- **A partial load, one bill of lading** — expressible here as two `load` actions with quantities, but the parallel document expresses the identical physical fact as a `Portion` entity, and neither references the other (see crossDocumentConflicts).

### Original design presented as though a source supported it

- **The worst instance in the three documents.** §2.2 calls "Cargo (equipment) events reference the call; they never contain the journey" "DCSA's structural rule" and "the single most important sentence in the corpus for this decision"; §7 then rates the whole stop-ownership fork HIGH partly because "`src:dcsa` states the principle explicitly." In `dcsa/analysis.md` that sentence is the **analyst's** summarising clause — it opens "So the full hierarchy is:…" and, uniquely among DCSA quotations in that file, carries **no line citation** while every neighbouring DCSA quote carries an `L`-ref. It is an inference from schema shape, attributed to the publisher as an explicit principle. DCSA in fact ships the opposite affordance: `eventLocation` = "General purpose object to capture the location in the `EquipmentEvent` whenever it is **not** associated with a `TransportCall`."

- §3.2 defines **Stop** as "a visit by **one identified vehicle** to one place" and calls it "Directly `src:dcsa`'s `TransportCall`: 'one visit by one conveyance to one place.'" DCSA's call is by a _conveyance_ on a voyage, polymorphic across four modes, and its truck variant merely _may_ carry a `licencePlate`. Substituting "identified vehicle" silently imports a rule no source states — **a stop cannot be recorded unless the vehicle is known** — and that rule is what makes three of the nine test scenarios inexpressible (see failedScenarios).

- §3.4's closing paragraph adopts "plan/actual as parallel readings," "three-sourced ETA (`src:alvys-api`'s `Eta {Planned, Live, Manual}`)" and `DataSource` "wholesale and without argument," describing them as "settled cross-cutting decisions ([crosscheck §Recommended order item 6])". Crosscheck item 6 settles nothing — it names candidates and instructs that the decision be made once. The parallel fork document decides the opposite shape on the same day. One side of an open fork is presented as already-decided elsewhere.

- §5.9 and §Cross-area demand that "every event declares the aggregate it belongs to" and cite `src:omnitracs-roadnet`'s "region-filter table" as "exactly that statement." A filter table is a query facility; generalising it into a catalog-wide envelope rule is a design decision, presented as a source reading. (§5.9 is marked ORIGINAL for the trip-scoped event itself, which is correct; the envelope rule is not marked.)

## fork-order-shipment-cardinality.md — **needs-revision**

### Claims not supported by the cited evidence

- **Internal contradiction on the SIT remainder.** §3.2's acceptance table: "**still one shipment.** SIT never splits it. The split is a fact about the _stay_ and the _stops_, not about the shipment." §5.1 and the §3.1 diagram: a `Portion` is "minted **only at the moment of physical divergence** (overflow onto a second vehicle, **a SIT remainder**, a transfer)" and hangs **under Shipment**. The same fact is a stop fact in one section and a shipment sub-entity two sections later.

- §7 rates the diversion/reshipment test HIGH. The DTR analysis it rests on defines Diversion as "a change made in the route of a shipment while in transit — operationally, a new destination **more than 30 miles** from the original, **excluding shipments already in SIT at destination**" (#255; A-402 §E.1). The clean half of the test is therefore expressly inapplicable to the case the document's own acceptance test turns on (goods in destination SIT), where DTR's route is terminate-and-reship **on a new BL** — i.e. a new shipment, contradicting "SIT never splits it."

- §3.3's `Identifier` has `scheme`, `issuer`, `value`, `primary`, `assertedBy`, `assertedAt` — and **no validity interval, and no vocabulary scope**. The corpus says both are required: `src:x12-212-trailer-manifest`'s `BLR-02` is "an **effective date** for that attribution" at per-shipment carrier grain (the analysis's explicit point is that "two shipments on one trailer" may have different carriers, time-scoped); the Atlas supplement concludes "a partner code reference is a **triple** (code, vocabulary scope, effective date), not a string," because Atlas's code lists are a function of (tariff, effectiveDate). The parallel A3 document hands this document exactly that requirement ("a single `shipment.carrier` field cannot express interline") and the shape as published cannot hold it.

- §3.3: "Attached at **its own grain**: order-grain identifiers on the order, shipment-grain identifiers on the shipment." Two grains are defined; the document then relies on three more it never defines — equipment (`MS2` owner SCAC + owner-assigned number + check digit), **trip** (its own §2b cites SIRVA carrying `QPDTripNumber` _and_ `CamisTripNumber` for one trip), and **stay** (foreclosure #3 promises "we must supply a **stay** id").

- §3.5(b) rejects a relocation aggregate because Weichert "carries it as an _identifier with an undocumented suffix_, not as an entity with state." The Weichert analysis records the `-N` suffix as its own **open question 8** ("What does the `-N` suffix on `moveNumber` (`M-C-28608-6`) count?"). An unanswered question about a field's semantics is not evidence that the publisher has no aggregate behind it; §7 is honest about the thinness, §3.5(b) is not.

### Scenarios the model cannot express

- **Order cancelled after packing, before loading.** A shipment is "the set of goods moving under **one transport contract** — the bill of lading, or the counterparty's single equivalent." A move cancelled before loading normally has no BOL at all (`src:cfr-49-375` §375.505(c): the driver must hold the BOL before the vehicle leaves the residence of origin). The packed lot is therefore a §5.2 **provisional** shipment forever: §5.2 defines only provisional→confirmed, §5.3 covers only "an order with **zero** shipments," and nothing states what a shipment boundary that never acquires its defining document _is_, or whether it may be cancelled, invoiced against, or claimed on. The charged packing materials attach to an entity the definition does not admit exists.

- **Delivery refused for damage, two items short.** The only sub-shipment device is `Portion` — "a named, **weighed** sub-set… minted only at the moment of physical divergence," justified on the ground that "the crew often knows the [weight] and not the [contents]." Two refused articles are a divergence, so the rule mints a Portion; but the grain is wrong in both directions — far too heavy for two items, and too light for a claim, which must name articles and their condition. There is no item-grain concept and the document defers it to A2 without flagging that the refusal case needs it at delivery time.

- **A car on a separate carrier a week apart** — the document's own acceptance test. It passes on paper ("a second shipment under the same order") and fails in the pair: it defers _all_ routing to Fork 3 in the Dependency section, and Fork 3 cannot record a stop performed by a vehicle it cannot identify. The acceptance test stated in §1 is not satisfied by the two decisions taken together.

- **A shipment reweighed in transit.** `primary` is "at most one per (subject, scheme)" and there is no ordering rule for the non-primary values. The original weight ticket and the reweigh ticket — each of which must carry "the carrier's shipment registration or bill of lading number" (§375.519(a)(6)) — and an original vs a reissued BOL are indistinguishable except by `assertedAt`, which is the clock of the _telling_, not of the _issuing_. The shape has no `issuedAt` and no supersession link between values of one scheme.

### Original design presented as though a source supported it

- §3.2: "the test comes from `src:dtr-part-iv` rather than from us: **If a new bill of lading is issued, a new shipment exists. If not, it is the same shipment.**" DTR states two _named DoD operations_ (diversion keeps the BL; reshipment of a terminated shipment moves on a new BL). Promoting those into a universal boundary rule — applied in the same table to a commercial auto carrier and to permanent-storage conversion, and in §4 foreclosure #6 to a lane where the document concedes "Weichert holds **no** BOL, PRO, SCAC or registration number at all" — is this document's generalisation. §7's "assertions made here that no source supports" lists the asymmetry-of-regret criterion and the order/shipment-type criterion but **not** this generalisation, and then scores the test "**high**" as though DTR stated the rule.

- §3.3: "**The identity evidence independently confirms the cardinality decision** — which is the strongest single argument in this document, because it does not depend on anyone's modelling taste." It does. It reads Weichert's _document layout_ (a `shipments[]` array beneath `serviceOrderNumber`) as ontology, and the very same source's analysis records the opposite modelling choice on the case the document cares about: "Auto/Pet are separate _order types_, not shipment types — a modeling choice worth noting." The document then has to overrule Weichert with a criterion it admits is uncited (§3.5a, §5.5). An argument that needs an invented rule to survive its own source is taste.

- (Credit where due: §2c's reconciliation of the MMT/SCRDM contradiction _is_ flagged in §7 as "an argument made here," and the `Portion`, the provisional→confirmed boundary and the correlation state are all correctly marked ORIGINAL. This document's disclosure hygiene is the best of the three; the two items above are the leaks.)

## fork-time-provenance-corrections.md — **needs-revision**

### Claims not supported by the cited evidence

- §(a) decision 2: "The qualifier set is `src:uncefact-scrdm`'s, minus `Previous_`… and with `Confirmed_` renamed **`COMMITTED`**." SCRDM supplies `Planned_` / `Actual_` / `Confirmed_` / `Previous_`. **`REQUESTED` and `ESTIMATED` are DCSA's classifier codes (`REQ`/`EST`)**, from a different position in the same table. Half the enum's stated provenance is wrong.

- §7 rates "three clocks" **high** because "Shippeo, EPCIS, project44, Alvys and the 858 converge independently." The document's own clocks table says otherwise: EPCIS has **two** (`eventTime`/`recordTime`); project44 has **two** and the document itself notes "'received' and 'calculated' are fused"; Alvys has **two** (`RecordedAt`/`ReceivedAt`), **neither of which is an occurrence time**. Only Shippeo and the 858 carry three. Three of the five cited sources lack the thing they are cited as converging on.

- §(b) rule 5's binding is stated only over _a device_: "A device **may never** assert: loaded, unloaded, delivered… or **any exception whatsoever**." The capture method the rule exists for is `ASSUMED_FROM_PLAN` — "nobody asserted it; the plan stood unchallenged" — which is **not a device**. Nothing in the binding prevents publishing `Delivery.Completed` with `capturedBy = ASSUMED_FROM_PLAN`; §6.4 then asks the user whether such values may go to partners at all. The rule forbids the harmless case (a geofence marking arrival) and permits the one the document calls "the difference between a record and a fabrication."

- The same rule over-reads its source. Shippeo's published rule is a **geofence-eligibility** column over 41 order-level rows; the document generalises it to all machine assertion of exceptions, while its own evidence records `CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` as _derived by Shippeo from position_ — a machine asserting _why something is late_ — and `P44_DETECTED` exceptions are cited approvingly two pages earlier. The cite is narrower than the rule built on it.

- §(c) adopts two incompatible retraction semantics in one paragraph: `DID_NOT_OCCUR` "**SHALL NOT** name a replacement — EPCIS's rule, adopted verbatim" **and** "it **restores the prior assertion** of the same fact if one exists: `src:x12-858-implementation-guide`'s `01` semantics." Retract-to-previous _is_ a successor assignment; applied across parties it silently promotes some other company's assertion, which the retracting party may have no authority to affirm. The 858's `01` is defined over an ordered status history on one carrier's own message stream, not over multi-party assertions of arbitrary facts.

- §5.1: "a correction outside the window is **refused rather than recorded**." `src:cfr-49-375` §375.401(i) makes a post-loading amendment of the _estimate_ legally ineffective; it does not say a system may not record that someone tried. As written, the catalog is obliged to retain a fact it knows to be false with no channel to say so — precisely the do-nothing failure §(c) calls "unrecoverable." It also contradicts §5.4, which requires corrections to _emit obligations_: a refused correction emits nothing.

- "The Atlas `/Types` reference-data endpoints (~35, five reachable on the current key)" — and the falsification condition "If those endpoints show that `date_type`, `reason` and `delayclaimresponsibility` are free text, the `EXTDate` evidence weakens from 'a designed record' to 'a set of column names.'" The committed Atlas supplement already answers it: **no key exists in the repo**, the count is 63, and — running the code-list extraction over the operational specs — "it returns **nothing**… the operational vocabulary is **not merely unfetched but unpublished**," with Atlas's A4 C2 held at 1 and A3/A5/A9 C2 corrected down to 1. The document's own stated condition for weakening two of its five provenance rules is met.

### Scenarios the model cannot express

- **The same arrival asserted at different times by the driver's app and the destination agent** — the scenario the document names in its own opening and cannot express. `MilestoneTimeAssertion.basis` is "`REQUESTED | COMMITTED | PLANNED | ESTIMATED` (**never ACTUAL**)"; `OccurrenceEvent` carries "exactly one time and **no tense qualifier**," has **no `supersedes`**, no grouping key and no basis. So the second party's differing actual must be published as a **second `OccurrenceEvent`** — two arrivals for one arriving — and `MilestoneTimeSelected`, defined over _assertions_, has no defined domain over occurrence events. The headline capability of §(b) ("two parties may assert the same fact differently, and the catalog keeps both," with an auditable winner) is structurally homeless for the entire ACTUAL class.

- Worse, in combination with the A3 document: the driver's app asserts arrival at a **stop**; the destination agent asserts arrival of a **shipment**. A3 requires stop-scoped and shipment-scoped events to be distinct kinds that "must not be fused." A selection rule keyed on (subject, milestone) therefore never sees the two claims as competitors at all.

- **A shipment reweighed in transit at the shipper's request.** The resolution machinery is time-only: there is no `MeasurementAssertion`, and `Correction` handles wrongness, not two correct-but-different observations. `src:dp3-400ng` Item 4 Note 2 states the exact rule this model cannot hold: when duplicate reweighs occur, "DPS must be updated with the **lower** of the net reweigh weights" — a published, reasoned resolution over two competing non-time facts. The reweigh is also not a correction (the first weighing occurred and was recorded correctly), so under §(c)'s preference order it is a 'compensate' — an ordinary event that leaves two authoritative weights and no winner.

- **Delivery attempted twice, refused for damage, two items short.** §(b)(7) gives the exception fault attribution and §(b)(5) asserts "HHG conformity is never one bit anyway: it is per-item, against a signed inventory" — but no record shape carries an outcome or a per-item result. `OccurrenceEvent.type` is a milestone name (`Delivery.Completed`). The two sources that publish the missing vocabulary are cited in this document for other things only: Shippeo (cited for `trigger.type` and canonicalisation) publishes `LIV/MQP` delivered-but-short vs `REN/AVA` refused-for-damage vs `REN/DAF` consignee-absent; OTM (cited for `result`-only-on-actual) publishes `result.status` including `partiallySucceeded` and 5.8 sub-results. "Completed with exception" has no representation.

- **Goods into SIT, delivered out six weeks later.** §5.2 makes SIT start a _derived_ actual whose inputs must cascade on correction; §5.5 declares the warehouse/SIT agent the authoritative asserter for SIT facts; §(c) requires every correction to carry `declaredBy {partyRef, role}` and an `authority` — "each fact class declares **which role may correct it**." An automatic cascade is therefore a correction to a warehouse-authoritative, legally load-bearing date, declared by the platform, with no authority the model grants it. Three of the document's own rules collide on the one HHG case it singles out.

- **A mid-journey custody handoff.** §5.5 concedes that without the ORIGINAL authoritative-asserter rule, rule (b)(4)'s resolution "degenerates to recency." §7 scores (b) **high** and §5 "explicitly unsupported." A high-confidence decision that is inexpressible without an admittedly unsupported item is mis-scored; the confidence on (b) should be capped by the confidence on 5.5.

### Original design presented as though a source supported it

- `MilestoneTimeSelected` — an append-only resolution event naming "**the id of the rule** that chose it" — is presented inside the decision section as "`src:project44`'s `selected` flag with two upgrades that p44 lacks." The two upgrades are the invention. §5 opens "**Nothing in this section is supported by any source**," which by construction implies everything outside §5 is; this is outside §5, and it is absent from §7's confidence table.

- `COMMITTED` is carried by the criteria table as **decisive** ("Only SCRDM and Atlas distinguish them"). After the Atlas supplement, the Atlas half is one untyped, undescribed field pair (`agreedFromDate`/`agreedToDate`) in a spec with zero enum declarations and zero property descriptions — structural evidence that a distinction exists, not evidence that it is defined. A decisive criterion resting on one formal definition plus one column name should say so.

- The HHG role vocabulary for `assertedBy.role` ("booking agent, origin agent, hauling agent, destination agent, warehouse/SIT agent, van line, driver, crew, customer, account/RMC…") is introduced as "DCSA's shape, with an HHG role vocabulary rather than an ocean one." The shape is DCSA's; the vocabulary is `src:sirva-ade`'s cast, uncited at the point of use and unmarked as authored — while §7 concedes X12 element 98, "the one list that would let `assertedBy.role` be checked against an industry vocabulary," is still unread.

- §(b)(7) "**Attribution belongs on the assertion**, not in a downstream report" is a placement rule no source states: Atlas puts fault on an `EXTDate` _exception record_, X12 keys 1651 to a responsible party on a _status message_, DTR attributes at _segment_ grain. The generalisation to every assertion is ours.

## Cross-document conflicts

### 1.

**The envelope is incompatible — and all three documents call the envelope the irreversible part.** fork-time freezes `subject` as "shipment / stop / service / item **(addressable below the shipment)**" and reinforces it in §(c): "the `subject` on every event must therefore be a typed reference to the smallest thing, not always the shipment." A3 requires trip-scoped events with no shipment on them to be first-class (§5.9), plus a membership lifecycle (§5.8) and an assignment lifecycle (§3.2), and states "Stop-scoped, trip-scoped and shipment-scoped events are three kinds and must not be fused." fork-order requires an **order** with "its own award / accept / decline / cancel lifecycle." Two of the three aggregates the other documents require have no slot in the envelope the third froze.

### 2.

**Three incompatible representations of 'the truck got there'.** A3 gives `Stop` "a plan/actual pair kept as **parallel readings of the same record**" and adopts Alvys's `Eta {Planned, Live, Manual}` "wholesale and without argument"; fork-time rejects exactly these (position 1, named fields; position 3, lifecycle-on-the-record) and requires separate append-only `MilestoneTimeAssertion` records with a `basis` classifier. A3 further adopts "`ArrivalRecorded` (a fact was written) ≠ `StopStatusChanged` (state moved) ≠ `Loaded` (a milestone was reached) — Alvys's three-way split, adopted," where fork-time models the first as a **clock** (`assertedAt`/`recordedAt`) on one event and the second as forbidden mutable state ("a single mutable 'current state' as the catalog's product" is foreclosed). Publishing both models double-counts every arrival.

### 3.

**The sub-shipment grain has four answers and no cross-reference.** Partial load, split delivery, overflow, a SIT remainder and refused items are one phenomenon. A3: a **quantity on a `StopAction`**. fork-order: a **`Portion`** entity with a composition-known flag and a no-BOL invariant. fork-time: an **`item`** subject on an event. `src:open-trip-model`, which A3 reads at grade A and takes its Action primitive from, supplies a fourth — **sub-results on the action** (5.8: "succeeded for certain goods and failed for others"). Neither of the three documents cites either of the other two on this.

### 4.

**Shipment identity across storage is asserted by one document and denied by the other.** A3 §7: "Shipment identity survives every split and every vehicle… every custody change, every storage interval" — HIGH. fork-order §3.2: a **terminated** storage that moves onward is a reshipment "**on a new BL**" and therefore a new shipment; and the DTR diversion rule A3 itself quotes expressly **excludes shipments already in SIT at destination**. A3's `store-in` / `store-out` seam assumes both actions name the same shipment; under the other document's own boundary rule they may not, and nothing then says which shipment the `Custody` interval belongs to.

### 5.

**Identity: A3 states requirements the cardinality document's shape cannot hold.** A3's cross-area hand-off demands that carrier attribution be "at _shipment_ grain and **time-scoped** (`BLR` + `BLR-02` effective date) — a single `shipment.carrier` field cannot express interline," and that equipment identity be owner-scoped. fork-order's `Identifier` has `issuer` (good) but **no validity interval**, and only order and shipment grains. Separately, fork-order models identity as fields on an aggregate with a mutable `primary` flag and a mutable §5.4 correlation state (`asserted`/`confirmed`/`disputed`), while fork-time makes every fact an append-only assertion and forecloses mutable current state. Whether an identifier is a row in the stream or a field on an entity is unresolved between them.

### 6.

**Both A3 and fork-time prescribe the same blocked remedy.** Each names "fetch the Atlas `/Types` endpoints (five of ~35 reachable on the current key)" as the cheap way to raise its weakest claim — A3's manifest layer (§6.2/§7) and fork-time's two Atlas-sourced provenance rules (§7). The committed `atlas-world-group-api/analysis-supplement-vocabulary.md` records that **no key exists in the repo**, that the inventory is 63 endpoints, that Atlas A3/A5/A9 C2 are corrected to 1, and that a complete capture "would not raise A4's semantic precision, and would raise A3's and A5's only partially" because the operational vocabulary is unpublished. Two documents' confidence plans were already refuted by corpus material at the time of writing.

### 7.

**Custody authority has three homes and no owner.** fork-time §5.5 (ORIGINAL) says the authoritative asserter changes at a custody handoff and that rule (b)(4) is inexpressible without it; A3 models `Custody` as an interval orthogonal to the trip with a two-value basis and never carries the authority consequence; fork-order's foreclosure #2 disposes of re-award as "a role assignment (A8…), not a re-parenting." All three defer to A8, which does not exist yet, while two of them score the dependent decision high.

### 8.

**The acceptance tests are not mutually satisfiable.** fork-order's stated test ("household goods by van, a car on a vehicle carrier, part of the goods into SIT") is declared passed by deferring routing to A3; A3 cannot record a stop whose vehicle is not identified, and cannot place a shipment that has no trip anywhere in space (origin/destination are derived from `StopAction`s only). The pair passes each half of the test by pointing at the other.

## Must fix before modelling

### 1.

**Fix the event envelope first — it is the only genuinely unrecoverable item.** Define `subject` as a typed reference to _any_ aggregate (order, shipment, portion/stay, trip, stop, stop-action/membership, assignment, party-role, item, charge), not as a shipment-rooted path. Everything else in the three documents is patchable in a release; a shipment-rooted envelope makes trip-, assignment- and order-scoped events permanently unpublishable, which two of the three documents require.

### 2.

**Adopt an (outcome, reason) factorisation on every act before naming a single event type.** "Delivered, two items short" is currently inexpressible in all three documents, and two grade-A sources already read supply the shape: `src:shippeo`'s 41-row grid (`LIV/MQP` delivered-short, `REN/MQP` refused-short, `REN/AVA` refused-damage, `REN/DAF` consignee-absent; ~20 reasons × 5 outcomes, reasons reused across outcomes) and `src:open-trip-model`'s `result.status ∈ succeeded|failed|partiallySucceeded|cancelled` + 10-value `result.reason` (5.7) + per-goods sub-results (5.8). Make "completed with exception" a first-class outcome. This is a synthesis, not an original design, and must not be written up as one.

### 3.

**Pick one sub-shipment grain and make everything use it** — quantity-on-an-action vs `Portion` vs item-subject vs sub-results. Partial load, split delivery, overflow, SIT remainder, refused items and short deliveries are one phenomenon with four models across three documents today.

### 4.

**Extend provenance and resolution beyond time.** Publish a generic `Assertion` (subject, factRef, value, basis, assertedBy, capturedBy, asOf) with a resolution event over any fact class, or state explicitly that weights, piece counts, conditions and statuses have no competing-assertion story. Concrete acceptance test: `src:dp3-400ng` Item 4 Note 2 — on duplicate reweighs the record takes **the lower** of the two net weights.

### 5.

**Decide where a second party's ACTUAL lives.** Either allow `basis = ACTUAL` on an assertion and make `OccurrenceEvent` the _selected projection_ over assertions, or give `OccurrenceEvent` a `supersedes`/`competesWith` and define `MilestoneTimeSelected`'s domain over it. As written, the driver and the destination agent cannot disagree — and because A3 puts their claims on different subjects (stop vs shipment), a selection rule would not even pair them.

### 6.

**Re-cut the machine-assertion rule by capture method, not by 'device'.** Forbid `ASSUMED_FROM_PLAN` and unsanctioned `DERIVED_BY_RULE` on possession-changing milestones (loaded, delivered, released from SIT) and on every exception; permit `DEVICE_GEOFENCE` for arrive/depart. The sanctioned derivation case already exists and must be carved out: the 400NG/DTR **derived** SIT start ("the arrival date must NOT be entered as the SIT entry date"; effective "the date the shipment was offered for delivery").

### 7.

**Replace "a correction outside the amendment window is refused rather than recorded"** with: always recorded, flagged legally ineffective, never applied to the priced record, and emitting the §5.4 obligation. The current rule obliges the catalog to retain facts it knows to be false — the failure mode the whole document exists to prevent — and over-reads 49 CFR §375.401(i), which makes a late amendment _ineffective_, not unrecordable.

### 8.

**Model a movement performed by a party whose journey we cannot see** — the auto transporter, the interline hauler, the warehouse delivery-out crew, the third-party shuttle. Either drop "one **identified** vehicle" from the Stop definition, or add an explicitly externally-performed leg with its own asserter — before committing to "a shipment's origin and destination are derived from its `StopAction`s and never stored," which today leaves partner-performed shipments with no destination at all.

### 9.

**Settle whether a pack-only or delivery-out-only day is a Trip before A5 and A7 are written.** A3's SIT discharge, the delivery-out leg, and the anchoring of accessorials ("scope to the stop that caused them") all depend on it; it is currently an open user question that three high-confidence claims silently assume answered 'yes'.

### 10.

**Reconcile shipment identity across SIT termination and reshipment**, in writing, in both documents: does `store-out` after a terminated stay name the same shipment id as `store-in`, and if not, which entity owns the `Custody` interval and the stay id? Then state the SIT-as-a-stop question the Atlas supplement poses directly — "storage is modeled as a _service at_ an Origin or Destination stop, not as a _stop of its own_" — and answer it deliberately rather than by inheritance.

### 11.

**Add an effective interval and a vocabulary scope to `Identifier`, and extend its grains to equipment, trip and stay** (`BLR-02` effective-dated per-shipment SCAC; `MS2` owner-scoped equipment ids; SIRVA's two trip numbers; the Atlas supplement's "(code, vocabulary scope, effective date), not a string").

### 12.

**Re-cite every Atlas-derived claim in both documents after the vocabulary supplement** (A3 C2→1, A5 C2→1, A9 C2→1; the operational vocabulary "not merely unfetched but unpublished"; no key in the repo). The manifest layer, the accept-vs-perform two-status lifecycle, crew, the mileage accumulators, `EXTDate` and `CustomerETA` are all column-name evidence, and the capture that would fix them is blocked — so the confidence notes that promise cheap resolution must be rewritten, not merely footnoted.
