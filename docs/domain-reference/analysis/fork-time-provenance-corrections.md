# Fork decision 3 — time, provenance and corrections

**Status:** decision proposed, one shape recommended. **Revision 2** (2026-09-18), answering
[`round-2-critique.md`](round-2-critique.md) and conformed to
[`00-shared-decisions.md`](00-shared-decisions.md).
**Date:** 2026-09-17, revised 2026-09-18

**Scope rule in force:** ideal-target model from **external sources only**. Our own systems
(`packages/domain`, the Prisma schema, the integration floors, the pegII order shape, the
long-haul app, our integration configs) are `role: mapping-only` and are **not cited below as
evidence for what the domain is**. Partner contracts (Weichert, SIRVA ADE, Atlas) are valid
external evidence. The rubric's **S5 is withdrawn**; round-1 S5 lines are ignored throughout.
**Nothing below is justified by "our system does X", and nothing is designed for migration.**

**Disclosure rule in force.** Every claim below either cites a source that says **that** thing,
or is marked **[ORIGINAL]** inline at the point of use. A source that says something narrower
than the claim does not support the claim. Where two sources each supply half of a shape and the
join is mechanical, the join is marked **[SYNTHESIS]**. Marking something ORIGINAL is not a
defect; presenting an authored rule as sourced is, and it is the defect the critique found in
revision 1.

**Atlas is blocked.** No `Ocp-Apim-Subscription-Key` exists anywhere in the repo, and Atlas's
operational vocabulary is **not merely unfetched but unpublished** — the code-list extraction over
the operational specs "returns nothing", and no event-code lookup path exists in any of the 24
documents ([`analysis-supplement-vocabulary.md`](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md)
§§1, 2.2). Atlas A3/A5/A9 C2 are corrected to **1**. **No claim in this document is scheduled for
resolution by fetching Atlas `/Types` endpoints, and none may be.** §7 re-cites every
Atlas-derived element used here; the revision-1 falsification condition built on those endpoints
is deleted, because it is already answered.

**Decides:** three cross-cutting mechanisms — (a) where the planned/estimated/actual qualifier
lives and which clocks exist, (b) provenance, (c) corrections — **once, for the whole catalog**.

**What outranks this document.** `00-shared-decisions.md` is binding and wins wherever it
disagrees. It reversed three things this document decided in revision 1 — the frozen
shipment-rooted `subject`, the `OccurrenceEvent`/assertion split, and the "`basis` is never
`ACTUAL`" rule — and supplied the `(outcome, reason)` factorisation and the `Portion` that
revision 1 lacked. Those reversals are carried into the body below rather than footnoted, because
half of the critique's "inexpressible" list was caused by them. §9 lists every move.

---

## 0. Why these three, and why together

These are not three questions. They are one question asked three ways: **what is the unit of
record in the catalog, and what may be said about it after it is published.**

- If tense is a property of the **record type** (`ARRIVAL_ESTIMATED` vs `ARRIVED`), then a
  provenance model that says _who asserted this_ has nothing to attach to for the estimate,
  because the estimate is not a fact about the world — it is a fact about a person's belief.
- If tense is a property of the **record** (OTM's five lifecycles), then a correction must say
  _which reading_ it corrects, and a retraction of the `planned` reading is a different
  operation from a retraction of the `actual` reading.
- If corrections are **mutations** (OTM's sparse-merge `UpdateEvent`, GTFS's snapshot
  overwrite), then provenance is destroyed on every edit and the asserter field is decorative.

Pick them in the wrong order and the later two are pre-decided badly by the first.

**Why it is irreversible or expensive to change later.** Three reasons, in increasing order of
cost:

1. **A published event cannot be unpublished.** This is the crosscheck's own framing of
   contradiction 8: "the one decision that has no migration path."
2. **The envelope is the part partners parse first and change last.** `src:dcsa` is the worked
   example of the cost when it is done late: `publisher` + `publisherRole` were made mandatory
   only in event domain **3.1.0**, and DCSA's own changelogs show what that costs — a versioned
   release of the shared domain _plus_ a release of every dependent API, for every consumer, at
   once. DCSA could afford that because it governs a standards body. A catalog published to
   van-line agents, an RMC and a shipper's visibility platform cannot recall the envelope.
3. **Tense and provenance are unreconstructable retroactively.** A correction mechanism can be
   added late and applied going forward. An asserter field added late is `null` for all history,
   and a `basis` qualifier added late means every historical time is of unknown tense —
   indistinguishable from a guess. `src:omnitracs-roadnet` names the exact failure: `DataSource:
AssumedFromProjection`, "a planned value masquerading as an actual because nothing
   contradicted it." Without the field, **every** historical actual is potentially that value
   and there is no way to tell.

**A fourth reason, learned from the critique.** Revision 1 froze `subject` as a shipment-rooted
list and made `basis = ACTUAL` illegal. Both were envelope decisions taken inside a document
about time, and both made things permanently unpublishable that other decisions required — a
trip-scoped ETA, an order's award lifecycle, and a second party's competing actual. The lesson is
not "we got it wrong"; it is that **envelope decisions must not be taken as a side effect of a
narrower decision**, which is exactly why they are now taken in the shared layer and merely
_used_ here.

---

## 1. The recommendation in one page

> **Publish one record class — the `Assertion` — plus two meta-records over it. Three clocks.
> Three correction operations. Tense lives on the _time value_ as a `basis` classifier, never on
> the record type and never on the whole record; `basis = ACTUAL` is legal and is how "it
> happened" is said. Every assertion names both _who_ asserted it and _how the value was
> obtained_. Competing assertions of the same fact — of any class, not only times — are kept, and
> the winner is published by an append-only, rule-naming resolution. Corrections are append-only,
> always recorded, and come in three named operations with a stated preference order.**

**The shape** (envelope fields per shared §1.1; only the parts this document decides are
expanded):

```
Assertion                                    ← the one record class
  eventId                 ours, unique, never reused
  type                    THE fact class — one classification axis, not two;
                          for an act, the act itself; never the outcome  (shared §1.3, A-TYPE)
  specVersion
  subject                 SubjectRef — exactly one, ANY aggregate kind           (shared §1.2)
                          and, on an Assertion, the subject OF THE FACT.
                          There is no second subject anywhere on the record.     (shared §1.3)
  context[]               SubjectRef[] — other aggregates this is also about,
                          explicitly NON-AUTHORITATIVE, never the resolution key (shared §1.4)
  qualifier               typed per `type`, where that type declares one         (shared §1.3)
  basis                   REQUESTED | COMMITTED | PLANNED | ESTIMATED | ACTUAL
  value                   typed per `type`; for an act record,
                          { occurredAt, outcome, reasons[] }                     (shared §2)

     the FACT KEY is derived, never carried:  ( subject , type , qualifier? )
     competing assertions pair on it; nothing else is a resolution key
  asOf                    instant — REQUIRED when basis = ESTIMATED
  assertedBy              { partyRef, role }      required
  assertedAt              instant                 required   ← clock 2
  capturedBy              CaptureMethod (7)       required
  recordedAt              instant, catalog-authored, FORBIDDEN on capture,
                          MANDATORY on query                                     ← clock 3
  evidence[]              refs to documents / other assertions
  supersedes              eventId? — an earlier assertion by the SAME party under the SAME fact key.
                          This is the ONE home for the link: the envelope's generic
                          `correlation` bag is deleted (shared §1.1).

FactResolved                                 ← "this is the value we are giving, and why"
  factRef                 the contested fact key ( subject, type, qualifier? ),
                          spelled out HERE because a meta-record's own `type`
                          names its record class rather than the fact
  selected                eventId of the winning assertion
  considered[]            eventId of every assertion in the contest
  rule                    { ruleId, ruleVersion }
  (assertedBy = the platform; capturedBy = DERIVED_BY_RULE)

Correction                                   ← "an earlier published assertion was wrong"
  corrects                eventId, required (an explicit back-pointer)
  reason                  DID_NOT_OCCUR | INCORRECT_DATA
  replacedBy              eventId?   (FORBIDDEN when reason = DID_NOT_OCCUR)
  before / after          the changed fields only, when reason = INCORRECT_DATA
  declaredAt              instant, distinct from the preserved occurredAt
  declaredBy              { partyRef, role }
  authority               the rule or instrument that permits this party to correct this fact
  outcome                 APPLIED | INEFFECTIVE | UNAUTHORISED     ← always recorded
```

`occurredAt` (clock 1) is not a separate envelope field: it is the `value` of an act assertion at
`basis = ACTUAL`. That is the consequence of abolishing `OccurrenceEvent` — see §(a) decision 1.

**TimeValue is typed, and the type is part of the contract:**
`LocalDate` · `LocalDateRange` (the delivery spread) · `ZonedInstant` (instant **plus the IANA
zone of the place the fact occurred**, not the publisher's). No bare ISO strings; no zoneless
instants.

**Three clocks, and only three:** `occurredAt` (the world) · `assertedAt` (the asserter's act of
saying it) · `recordedAt` (the catalog accepting it, server-authored).

**Three correction operations, in preference order:** _compensate_ (publish an ordinary
assertion — preferred) → _supersede_ (`INCORRECT_DATA`, names its replacement) → _retract_
(`DID_NOT_OCCUR`, forbidden to name a replacement).

**Financial facts are exempt from retraction**: money is corrected only by an offsetting record.

---

## (a) Where the planned / estimated / actual qualifier lives

### The question, sharply

A milestone — "delivery of shipment X at the destination residence" — is spoken about many
times before it happens and at least once after. **Where does the model record which of those
speakings you are looking at?** Seven mutually exclusive answers are in the corpus, and one
publisher contradicts itself inside a single download.

It is expensive to change later because it determines the **shape of every record type name in
the catalog**. If tense is in the code (`AG Estimated Delivery` vs `X1 Arrived`), then adding a
tense means adding codes multiplicatively and no consumer can ask "when was delivery expected?"
across the vocabulary. If tense is a classifier, the vocabulary stays small but every consumer
must learn the classifier. Either way, partners compile against it.

### The positions

| #   | Position                                | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | What it buys                                                                                                                                                           |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Named fields** on one record          | `src:project44` (`plannedDateTime` / `estimateDateTime` / `dateTime`, plus `initialPlanned` vs `latestPlanned` each split carrier-vs-customer, `:45515`); `src:atlas-world-group-api` (**five** kinds on one stop: `scheduledFrom/To`, `agreedFrom/To`, `stp_eta`/`stp_etd`, `actual_stop_date`, `stp_arr_confirmed` — **column names only, see §7**); `src:samsara` (scheduled / appointment window / eta / actual + on-time tolerance); `src:uncefact-mmt-rdm` (`Estimated`/`Actual`/`Scheduled`/`RequestedOccurrenceDateTime` on one event) | Immediately legible. A consumer reads one object and sees the whole promise-vs-outcome picture.                                                                        |
| 2   | **One field + a classifier**            | `src:dcsa`: one `eventDateTime` + `eventClassifierCode` ∈ `ACT\|PLN\|EST\|REQ` (`event_domain` L2272-2285), **constrained per event type** — "For `ShipmentEvents` the `eventClassifierCode` must be `ACT`" (L776-781). The same event type is republished as the answer firms up. JIT goes further: _who may say which classifier is constrained by role_ — `EST`/`PLN`/`ACT` only from the Service Provider, `REQ` only from the Consumer (`jit/v2` L3554-3568).                                                                             | Smallest vocabulary. Per-type constraints are machine-checkable. The role×classifier rule is the only place in the corpus where tense and authority are joined.        |
| 3   | **A lifecycle dimension on the record** | `src:open-trip-model`: the same stop published at `requested` / `planned` / `projected` / `actual` / `realized`, with `result` **legal only on actual/realized** (`otm-api-v5.6.yaml:18081-18099`, `:18098-18145`)                                                                                                                                                                                                                                                                                                                             | The differences between readings _are_ the plan-vs-execution record. The `result`-only-on-actual invariant is genuinely good and is adopted (shared §2.3 invariant 1). |
| 4   | **Deviation from a published plan**     | `src:gtfs`: `StopTimeUpdate` carries `delay` and/or `time` plus `uncertainty`, where **`uncertainty: 0` means observed**; `timepoint` marks confidence on the _plan_ itself                                                                                                                                                                                                                                                                                                                                                                    | Enormously compact. Confidence is a first-class number, on both the plan and the prediction.                                                                           |
| 5   | **In the status code**                  | `src:stedi-x12-reference`: `AG Estimated Delivery` and `X1 Arrived at Delivery Location` are two of 42 codes in one flat list (`/element/1650`). `src:uncefact-rec24` is the same idea at scale — 345 codes where tense is baked into the name: `209 Delivery_scheduled`, `361 Delivery_expected`, `113 Delivery_in_progress`, `21 Delivery_completed`, `23 Delivery_not_completed`, `210 Delivery_unsuccessful_attempt`                                                                                                                       | A new temporal reading is one code addition, no schema change. Maps straight onto EDI.                                                                                 |
| 6   | **On the association name**             | `src:uncefact-scrdm`: `Planned_Delivery.SupplyChainEvent` vs `Actual_Delivery.SupplyChainEvent` — two instances of a simple event class, with superseded values **retained as `Previous_Delivery`**, and a fifth qualifier `Confirmed_` distinct from both Planned and Actual                                                                                                                                                                                                                                                                  | The event object stays simple. **`Confirmed_` is the promise, as opposed to the plan or the outcome.**                                                                 |
| 7   | **On the time element, as a qualifier** | `src:x12-858-implementation-guide`: `G62 = {date-qualifier, date, time-qualifier, time}` (p.11); `src:stedi-x12-reference`'s `AT7-05/06/07` date→time→time-code chain with conditional syntax (`/segment/AT7`)                                                                                                                                                                                                                                                                                                                                 | Tense scales to a hundred meanings at zero structural cost, and the date/time/zone chain yields three legitimate precisions for free.                                  |

**The self-contradiction.** `src:uncefact-scrdm` (position 6) and `src:uncefact-mmt-rdm`
(position 1) ship in the **same 245 MB download** from the same publisher and give opposite
answers to the same problem — SCRDM: one event per flavour, superseded ones retained; MMT: one
event object carrying all four tenses, revised in place. Neither BRS acknowledges the other.
That is the strongest available evidence that this is a real fork and not a matter of taste.

### The clocks — re-cited honestly

The critique is right and the rating in revision 1 was wrong. Revision 1 said "Shippeo, EPCIS,
project44, Alvys and the 858 converge independently" on three clocks. **Three of those five carry
two.** Corrected, with the sources sorted by what they actually carry:

| Source                             | Clocks carried                                                                                                                                                                                                                                                                                                                       | What it actually supports                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src:shippeo`                      | **Three**, named and separately carried: `situation.date` "the datetime at which the event **happened**"; `situation.input_date` "the datetime at which the event was **recorded**", with the published worked example _"The driver recorded at 3.30pm (input_date) that he delivered the goods at 3pm (date)"_; `date_transmission` | **Carries the three-clock split.** The best worked statement in the corpus. The third clock is envelope plumbing and is rejected as a domain field.                                                                                 |
| `src:x12-858-implementation-guide` | **Three** in use: N904/N905 status **effective** date/time, `G62` arrival date/time, and the interchange time. Worked example 7 (p.38) has a status effective **a day after** the arrival it describes                                                                                                                               | **Carries the three-clock split**, and proves it is not theoretical: the two diverge routinely in production EDI.                                                                                                                   |
| `src:gs1-epcis-cbv` (ratified)     | **Two**: `eventTime` vs `recordTime` — but with conformance teeth: `recordTime` **"SHALL be ignored when an event is presented to the Capture Interface, and SHALL be present when retrieved through the Query Interfaces"** (EPCIS 2.0 §7.4.1, pp.74-75; conformance §§14.3, 14.5)                                                  | **Supplies the governing rule for the third clock, not the count.** The rule — the publisher may not author the catalog's own clock — is adopted verbatim. Citing EPCIS as convergence on _three_ clocks was the error.             |
| `src:project44`                    | **Two**: `dateTime` vs `receivedDateTime` = "the time when project44 **received or calculated** this event"                                                                                                                                                                                                                          | **Corroborates the split only.** "Received" and "calculated" are fused — a knowledge clock and a derivation act in one field. It is evidence that a second clock is needed, and evidence of what happens when you under-specify it. |
| `src:alvys-api`                    | **Two**: `RecordedAt` vs `ReceivedAt`, **neither of which is an occurrence time**, plus an explicit warning that the envelope timestamp is not the operational time                                                                                                                                                                  | **Corroborates the split only.** Revision 1's "confirms the three-clock split independently" was false and is withdrawn.                                                                                                            |
| `src:sirva-ade`                    | **One.** Event `DateTime` "indicates when event was **recorded**" (SOE p.2); `Load` is defined as _"the system is updated to reflect the driver has loaded"_                                                                                                                                                                         | The failure mode, from a live partner contract. There is no occurrence time anywhere, so "when was it loaded" is unanswerable and every downstream clock is wrong by the lag.                                                       |

**The re-argued claim.** Two sources carry all three clocks and one of them is EDI in production
use; one ratified standard publishes the conformance rule that governs the third; two vendor APIs
carry the occurrence/knowledge split but fuse or omit an axis; one live partner contract carries
one clock and demonstrably cannot answer "when was it loaded". That is enough for the decision
and **not** enough for a five-source convergence claim. The rating moves from **high** to
**medium-high** in §7, and the row is split, because `asOf`-on-estimates and typed time values are
separately and more strongly evidenced than the clock count.

### The decision

**Tense lives on the time value, expressed as a `basis` classifier on an `Assertion`. There is
one record class; there is no separate occurrence class.**

1. **`OccurrenceEvent` is abolished, and `basis = ACTUAL` is legal.** Revision 1 published a
   second record class carrying "exactly one time and no tense qualifier", and forbade `ACTUAL`
   on assertions. The critique's most damaging structural finding follows directly: the driver's
   app and the destination agent, asserting one arrival differently, had nowhere to disagree —
   `OccurrenceEvent` had no `supersedes`, no grouping key and no basis, so the second party's
   actual could only be published as a _second arrival_. **Reversed** (shared §4.5). "It happened
   at T" is an Assertion at `basis = ACTUAL`; "what happened" is the **selected projection** over
   ACTUAL assertions, published by `FactResolved`.
   The DCSA per-type constraint that motivated the split is kept in a better form: it becomes
   rule **E-CANON** (shared §1.3, §4.3; the per-`type` declaration is shared §4.7) — every record
   `type` declares one canonical `subject` **family**, a closed set of aggregate kinds that is a
   singleton except for `stop = {stop, externallyPerformedLeg}`, `goods = {shipment, portion}` and
   `identity` (the whole enum) — and the catalog declares per `type` which basis values
   are legal. That is DCSA's mechanism
   (`ShipmentEvents` must be `ACT`) used as a constraint rather than as a class boundary.

2. **`basis ∈ REQUESTED | COMMITTED | PLANNED | ESTIMATED | ACTUAL`, and the provenance is
   re-cited.** Revision 1 said "the qualifier set is `src:uncefact-scrdm`'s, minus `Previous_`,
   with `Confirmed_` renamed `COMMITTED`". **Half of that was wrong.** Corrected:

   - `PLANNED`, `ACTUAL`, and the `Confirmed_` → **`COMMITTED`** idea: `src:uncefact-scrdm`,
     which supplies `Planned_` / `Actual_` / `Confirmed_` / `Previous_` as association
     qualifiers. `Previous_` is dropped — an append-only catalog gets it free.
   - **`REQUESTED` and `ESTIMATED` are `src:dcsa`'s**, not SCRDM's: `eventClassifierCode` ∈
     `ACT | PLN | EST | REQ` (`event_domain` L2272-2285). They come from a different position in
     the same comparison table and were mis-attributed in revision 1.
   - **`COMMITTED`'s real support is `src:sirva-ade`, grade A, a live partner contract.** ADE
     carries an **Agreed Load Period** and **Agreed Delivery Period** (From/To date **plus**
     From/To hour and minute, with the all-or-nothing rule that specifying one time part requires
     all four — SOE pp.4-5), kept distinct from `PlannedCustLoadDate`/`ActualCustLoadDate` (GSD
     p.7) and distinct again from the trip-side `LoadDate`/`UnloadDate` ("Van Line **Driver** Load
     Date"). `LoadDateChanged` (the trip plan) is a different event from `ALPChanged` (the
     customer promise, SOE p.20), and ADE models the **withdrawal** of a commitment as its own
     transition: `IntoWillAdvise` "the shipment is changed to **remove** agreed load and delivery
     periods" / `OutOfWillAdvise` (SOE p.18).
     Corroborated at regulation grade by `src:dp3-400ng`, which names **five separately
     load-bearing delivery-date roles** — requested delivery date (block 18 at award), first
     available delivery date (which sets SIT start), scheduled delivery date ("the date agreed
     between TSP and customer", a two-hour DPS deadline and a financial consequence, Item
     17-1.3), actual delivery date, and RDD.
   - **Atlas contributes one untyped, undescribed field pair** (`agreedFromDate`/`agreedToDate`
     beside `scheduledFromDate`/`scheduledToDate`) in a catalog with zero enum declarations and
     zero property descriptions in the operational specs. Revision 1's criteria table called
     `COMMITTED` decisive because "**only SCRDM and Atlas** distinguish them". That is corrected
     in the criteria table below: Atlas is structural evidence that a distinction exists, not
     evidence that it is defined, and it is **not decisive for anything**. See §7.

3. **Three clocks: `occurredAt`, `assertedAt`, `recordedAt`** — on the evidence re-stated above.
   `assertedAt` is Shippeo's `input_date`. `recordedAt` is EPCIS's `recordTime` with EPCIS's rule
   adopted verbatim: **it SHALL be ignored on capture and SHALL be present on query.** Shippeo's
   `date_transmission` is rejected as a domain field — it belongs to the transport envelope, and
   Alvys names the confusion it causes.

4. **An estimate without an `asOf` is not an estimate.** `asOf` is required when `basis =
ESTIMATED`. `src:project44` enforces this in three independent places
   (`TimingEstimate.lastCalculatedDateTime`, `TruckloadArrivalEstimate.lastCalculatedDateTime`,
   `TrackedShipmentEvent.estimateLastCalculatedDateTime`); `src:samsara` carries `etaMs` **and**
   `etaUpdatedAtMs` on every `stopEtaUpdated`.

5. **Time values are typed.** `src:project44` is the only source that treats this as a typing
   problem rather than a formatting problem (`LocalDateTimeWindow` / `ZonedDateTimeWindow` /
   `OffsetDateTimeWindow` / `SplitOffsetDateTime`, with stop-relative times "always in the time
   zone of the stop"). The `AT7-05/06/07` chain gives the precision ladder and the conditional
   rule — a time may not appear without a date, a zone may not appear without a time. Adopt
   both: a delivery spread is a `LocalDateRange` at destination, an arrival is a `ZonedInstant`.

6. **The zone is the zone of the place the fact occurred, not the publisher's.** EPCIS's
   ratified text contradicts itself here — the normative field table (§7.4.1, p.75) says
   "occurred", the non-normative explanation one page later (§7.4.1.1, p.76) says "was
   captured". We choose **occurred**, explicitly, because an agent keying a milestone from an
   office two states away is the normal HHG case, not the exception.

7. **A time that has been superseded is never overwritten.** `supersedes` links a new assertion
   to an earlier one **by the same party under the same fact key**; both are queryable. This is
   SCRDM's `Previous_Delivery` retention, made free by append-only publication. Note the
   restriction: `supersedes` is _intra-party_. A different party's differing value is not a
   supersession — it is a competing assertion, and it is resolved, not replaced. That distinction
   is what revision 1 lacked.

8. **The record `type` **is** the fact class — which for an act is the act — and never the
   outcome** (shared rule A-TYPE, and shared §1.3 for why there is only one such axis).
   Revision 1's `OccurrenceEvent.type = Delivery.Completed` is **forbidden**. The evidence is a
   published defect: in `events-out-road-order.swagger.json`, Shippeo's
   `SharedEventsOrderConformityOrderNotLoadedPartiallyMissing` declares
   `event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — the _entirely_-missing name on the
   _partially_-missing schema — **while the code pair (`ENE/MQP` vs `ENE/MQT`) stays correct in
   both schemas**. Baking the outcome into the type name is how "delivered, two items short"
   became inexpressible in revision 1.

9. **Every act assertion carries `outcome` + `reasons[]`** (shared §2), and `outcome` is legal
   only where `basis = ACTUAL` — OTM's `result`-only-on-actual invariant adopted verbatim. This
   is the `[SYNTHESIS]` of `src:shippeo`'s (situation, justification) grid and
   `src:open-trip-model`'s `result.status` + `result.reason` + 5.8 sub-results, and it is
   **not** an original design; the shared layer writes it up in full.

### The criteria I weighted, and why

| Criterion                                                              | Weight   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Can a commitment be distinguished from a plan and from a forecast?** | Decisive | In HHG the delivery spread is a _contractual promise_ (`src:cfr-49-375` App. A defines it; `src:dtr-part-iv` separates Desired Delivery Date / RDD / Planned-Agreed Delivery Date / actual as four different facts; `src:dp3-400ng` names five distinct delivery-date roles). Positions 2, 3, 4 and 5 all collapse `COMMITTED` into `PLANNED`. **Corrected from revision 1:** the distinguishing sources are `src:uncefact-scrdm` (the formal definition) and **`src:sirva-ade`** (ALP/ADP kept separate from planned and actual, with Will-Advise as the withdrawal transition) — _not_ SCRDM and Atlas. Atlas's field pair is column-name corroboration and carries no weight here. |
| **Does the on-time verdict stay falsifiable?**                         | Decisive | `src:project44` fails here and documents its own failure: `timelinessCode` is computed "relative to the **user-defined** appointment window" and the update endpoint invites you to edit that window. Edit it and every EARLY/ON_TIME/LATE judgement silently re-bases. p44 patches this with a four-way planned tuple at the _milestone_ layer and does not patch it at the _stop_ layer. The agreed time must be a separate immutable record, which append-only assertions give and mutable named fields do not.                                                                                                                                                                    |
| **Does the vocabulary grow multiplicatively?**                         | High     | `src:uncefact-rec24` is the empirical proof of position 5's cost: six codes for the delivery milestone alone (`_scheduled`, `_expected`, `_in_progress`, `_completed`, `_not_completed`, `_unsuccessful_attempt`) — and the analysis records that the factoring is **asymmetric**, applied to some milestones and not others. Its own verdict: "Take the distinctions, not the factoring." The same argument, at the outcome axis, is why A-TYPE forbids `Delivery.Completed`.                                                                                                                                                                                                        |
| **Can a consumer ask a tense question across the whole catalog?**      | High     | "Show me every milestone whose commitment moved" is a one-line query against a `basis` field and an impossible query against 345 tense-baked codes or against event-type names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Does it survive an append-only wire?**                               | High     | Eliminates `src:uncefact-mmt-rdm` outright ("the event is not re-emitted per flavour; it is _revised_") and eliminates position 4, because GTFS's `delay` has no referent once the plan is republished and `FULL_DATASET` overwrites all preceding information.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Zone discipline**                                                    | High     | Five independent sources fail identically: OTM ("no time zone anywhere"), SCRDM, MMT, SIRVA (date-only fields, no zone), and `src:x12-858-implementation-guide` where the zone element `G6205` **exists in the standard and the partner switches it off**. Five failures of the same kind is evidence that a zone left optional will be omitted.                                                                                                                                                                                                                                                                                                                                      |
| Legibility to a human reading one payload                              | Low      | Position 1's only real advantage, and it is a documentation problem, not a model problem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### What it forecloses, and the cost if it is wrong

**Forecloses:**

- **Answering "what is the current expected delivery?" from a single row.** That is a projection
  over the assertion stream, which the catalog must publish as a derived read model or every
  consumer will build its own and they will disagree. `src:project44` already shows the right
  discipline: `selected` publishes the winner alongside the losers, and `FactResolved` is that,
  append-only and with its rule named.
- **A compact EDI mapping.** X12 carries tense in a qualifier on the date element; mapping a
  separate assertion record onto a `G62` qualifier is a flattening, and the reverse direction
  loses `asOf` and `assertedBy` — both of which EDI has no slot for.
- **A mutable "current state" field on any aggregate.** State is a projection; the catalog
  publishes assertions and resolutions.

**What it no longer forecloses.** Revision 1 listed "publishing an 'estimated arrival' as the
same record type as an arrival" as a foreclosure, on the strength of the occurrence/assertion
split. With that split abolished, an estimate and an actual **are** the same `type` with a
different `basis` — which is DCSA's own shape, and the integration cost revision 1 accepted (two
subscriptions at every onboarding) is no longer paid.

**Cost if wrong, in order:**

1. **If `basis` should have been on the record type after all**: the catalog carries a
   near-useless field and partners write per-type filters instead. Annoying, not fatal, and
   removable in a major version.
2. **If `COMMITTED` turns out to be indistinguishable from `PLANNED` in practice**: a wasted
   enum member. Trivial — though SIRVA's separate `ALPChanged` event and the Will-Advise
   transition make this unlikely.
3. **If tense had to be revisable in place** — i.e. if a consumer genuinely cannot tolerate
   an assertion stream — the whole recommendation fails and there is no cheap patch, because
   append-only is the load-bearing assumption under (c) as well. This is the one that would
   hurt, and it is the reason (c) is decided in the same document.

**Confidence for (a): medium.** The _rejections_ are firmly evidenced; the positive shape is a
synthesis no single source publishes. The clock count is re-rated separately in §7.

---

## (b) Provenance — who says so, and how they know

### The question, sharply

**May two parties assert the same fact differently; is the rule that picks a winner auditable;
and is "assumed" distinguishable from "observed"?**

This is not hypothetical. On one HHG shipment the driver's telematics feed, the hauling agent,
the destination agent and — later — a corporate shipper's visibility platform will all assert
the same arrival, sometimes inconsistently, sometimes days apart, and at least one of them is
a different company from the others. `src:dtr-part-iv` §A-L B.6-8 shows the commercial stakes:
an international transit time is split into **segments with different responsible parties**,
each with an independent evidence source and a proportional remedy. Who asserted what is how
money moves.

**And it is not only about time.** Revision 1 built all of this over time values alone. The
critique's must-fix #4 is correct: weights, piece counts, conditions, statuses and identifiers
are contested in exactly the same way, by the same parties, with published resolution rules in at
least one case. That generalisation is now taken (shared §4) and the fact-class families are
listed in §(b) rule 3 below.

### The positions

| Position                                                                      | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | What it buys                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every event names its publisher and the role that publisher played**        | `src:dcsa`: `publisher {partyName, carrierCode, carrierCodeListProvider}` + `publisherRole` ∈ `CA` carrier / `AG` carrier's local agent / `VSP` visibility service provider / `SVP` other, **mandatory** since event domain 3.1.0                                                                                                                                                                                                                                                        | The multi-party fix. Role, not just identity — the same company can be hauling agent on one shipment and destination agent on the next. **DCSA supplies the shape; it does not supply an HHG role vocabulary** — see rule 1.                                                                                |
| **Provenance is a value object on the measurement**                           | `src:omnitracs-roadnet`: `DataSource` ∈ `NotSet, Projected, **AssumedFromProjection**, DispatcherEntered, AutoCaptured, GeoComputed, Computed, OdometerComputed, IgnitionComputed`, applied via `DataSourcedTimestamp {value, dataSource}` (L61544, L61770). Plus `eventSource` ∈ `MobileDevice \| Dispatch \| Unknown` at event level                                                                                                                                                   | Nine ways of knowing, including the one nobody else names: **`AssumedFromProjection` — nobody observed it; we kept the plan and nothing contradicted it.** Its own analysis flags the trap: "consuming `arrivalTimestamp.value` without reading `.dataSource` will quietly" treat a guess as a measurement. |
| **Channel on every update**                                                   | `src:samsara`: `source` ∈ `automatic \| driver \| admin` on every route update, with `automatic` as an explicit **assertion** rather than an absence; plus a 15-value `assignmentType` recording how the driver–vehicle binding itself was asserted (`static`, `faceId`, `qrCode`, `RFID`, `driverApp`, `voiceSignIn`…)                                                                                                                                                                  | Confidence in "driver D was in vehicle V" differs enormously between `static` and `faceId`. The binding under the telemetry is itself an assertion with its own provenance.                                                                                                                                 |
| **A time value is an assertion, and the winner is published with the losers** | `src:project44`: `dateTimes[] = {type, source, sourceIdentifiers[], id-of-underlying-record, sequence, lastModifiedDateTime, **selected**}` (`:49524`), where `source` names `CARRIER/BROKER/USER/CONTRACT/GEOFENCE/FACILITY/P44/FFW/NVOCC` and `sourceIdentifiers` can name a **specific device, vehicle or carrier**. Plus `ShipmentException.namespace` ∈ `P44_DETECTED` vs `CARRIER_REPORTED`                                                                                        | The complete model for one time value, and the discipline that matters most: **never present your own inference as the counterparty's assertion.** `selected` makes the resolution rule visible instead of implicit — though it is a bare boolean, mutable, and scoped to times.                            |
| **Wire-enforced trigger, with a published eligibility rule**                  | `src:shippeo`: `trigger.type` ∈ `{manual, geofencing}` and `platform_type` ∈ `{web, mobile, telematics, email, tms}`, **both required** on every outbound standard event. And the published table: exactly **7 of its 38** order-level rows are geofence-eligible and **not one of them is an exception row** — 25 of the 38 carry a non-conform justification, all 25 blank in the geofence column (`event-list-order-level.md:7,8,11,19,20,24,39`; corrected count per shared §5.2 M3) | Published per event type, not guessed at runtime. The precise scope of this cite matters and is stated in rule 5.                                                                                                                                                                                           |
| **The richest single exception record**                                       | `src:atlas-world-group-api`: `EXTDate` (`atlasorder-v1.json:9964`) = reason + free explanation + shipment location at the time + who bears the delay-claim responsibility and why + who asserted + who approved + who was notified, by whom, when, and whether that notification was late. Plus `CustomerETA {date_from, date_to, eta_given_to, eta_given_by, date_given}`                                                                                                               | **Structural evidence only — column names with no code list** (§7). It shows that a publisher found these fields worth having; it does not define any of them. The _rules_ built on it in revision 1 are re-sourced in rules 6 and 7.                                                                       |
| **Changer, defined as person or system**                                      | `src:uncefact-scrdm`: `Recorded_Status` = `Condition.Code` [1..1] + `Changer Name.Text` "the person **or system** that changed this recorded status" + `Changed.DateTime` [1..1]. Also `AutomaticDataCaptureMethodCode` (10 codes) — the only capture-provenance vocabulary in either UN package                                                                                                                                                                                         | A UN reference model with "or system" written into the definition. The shape is right; the optionality is wrong (changer is `[0..1]`).                                                                                                                                                                      |
| **Per-batch only, lost on re-hosting**                                        | `src:gs1-epcis-cbv`: **no per-event publisher.** Sender/receiver live on the enclosing document, so provenance is per-batch and is destroyed the moment a repository re-hosts the events. Its own analysis calls this its biggest gap                                                                                                                                                                                                                                                    | The counter-example. EPCIS is the best source in the corpus on corrections and the worst on provenance, and the two are independent choices.                                                                                                                                                                |
| **Structurally unaskable**                                                    | `src:gtfs`: one publisher by construction, no actor on any `StopTimeUpdate`                                                                                                                                                                                                                                                                                                                                                                                                              | Honest about its scope. Useless to us.                                                                                                                                                                                                                                                                      |
| **Direction of transmission is the entire authority model**                   | `src:sirva-ade` (no element records who keyed anything; `WeightChange` is a correction channel "with no provenance"); `src:x12-858-implementation-guide` ("no actor on any fact"; `PER` names a plant contact to phone, not the source of the assertion)                                                                                                                                                                                                                                 | Two live partner contracts, both failing the same way. This is what we will receive inbound and must not reproduce outbound.                                                                                                                                                                                |

### The decision

**Five rules, all mandatory, all on every assertion.**

1. **`assertedBy = {party, roleInThisAssertion}`, required and non-nullable.**
   **The shape is `src:dcsa`'s** (`publisher` + `publisherRole`, mandatory since event domain
   3.1.0). **The HHG role vocabulary is `src:sirva-ade`'s cast**, cited here at the point of use
   rather than left unattributed as it was in revision 1: `Resource.Type` ∈ Booker, OriginAgent,
   DestinationAgent, LoadAgent, UnloadAgent, Hauler, R19Agent, RR19Agent, SITAgent, Driver
   (plus Tractor and Trailer, which are resources rather than roles) — GSD p.9, SOE p.6 — and, in
   the settlement view, `ServiceProviderFunction` adds Packer (07), Port Handler (14), Settling
   Agent (17), Setoff Agent (18) and Sirva Corporate (20), GSD p.26.
   **[ORIGINAL]:** `customer`, `account/RMC`, `visibility provider` and `platform` as roles.
   `visibility provider` has a near-cite (DCSA's `VSP`); the other three are ours — and
   `customer` is argued separately in §5.3.
   The role is carried **on the assertion**, not looked up from the party, because
   `src:sirva-ade` is explicit that role and ownership are **orthogonal axes** (`Type` × `Owner`
   ∈ Corporate/Agent/Vendor, GSD p.9) and its own worked sample proves one company holds two
   roles at once — `TIER ONE RELOCATION` is both `Booker` and `DestinationAgent` (GSD p.17).
   `src:open-trip-model` independently confirms the placement by putting `roles` on the
   _association_, not the actor.
   **Still unread, and it matters:** `src:stedi-x12-reference` element 98, the party-role code
   list. The stedi analysis scores A8 C2=1 / C4=0 on exactly this ground — "the role vocabulary
   itself is element 98's code list, **which we did not read**" — and flags it as an open
   question blocking A8. Until it is read, this vocabulary is one partner's cast plus four
   authored members, not an industry list.

2. **`capturedBy` — how the value was obtained — required and separate from who.** Omnitracs'
   `DataSource` generalised. Seven members, each traceable to a source:

   | Member               | Means                                               | From                                                              |
   | -------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
   | `OBSERVED_BY_PERSON` | a human who was there saw it                        | Shippeo `manual`, Samsara `driver`                                |
   | `KEYED_BY_PERSON`    | a human recorded it, not necessarily present        | Omnitracs `DispatcherEntered`, Samsara `admin`                    |
   | `DEVICE_GEOFENCE`    | a boundary crossing                                 | Shippeo `geofencing`, Omnitracs `GeoComputed`, p44 `GEOFENCE`     |
   | `DEVICE_TELEMETRY`   | a sensor inferred it                                | Omnitracs `IgnitionComputed`/`OdometerComputed`, p44 `TELEMATICS` |
   | `PARTNER_ASSERTED`   | it arrived from a counterparty feed                 | p44 `CARRIER`, DCSA `publisherRole`                               |
   | `DERIVED_BY_RULE`    | we computed it, and the rule is named               | p44 `P44_DETECTED` + `definitionId`; Omnitracs `Computed`         |
   | `ASSUMED_FROM_PLAN`  | **nobody asserted it; the plan stood unchallenged** | Omnitracs `AssumedFromProjection`                                 |

   Two values are load-bearing. **`KEYED_BY_PERSON`** must exist and be honestly used, because
   most HHG milestones reach any system through a person at a keyboard who was not at the
   residence. **`ASSUMED_FROM_PLAN`** is the one the whole rule exists for: without it, a
   planned value that nothing contradicted is indistinguishable from an observation, which is
   the difference between a record and a fabrication.

   **Reject a two-valued trigger enum.** Shippeo's own defect is decisive evidence: `trigger.type
∈ {manual, geofencing}` is required, and Shippeo itself emits at least four kinds — including
   schedule-derived (`DRIVING_TO_LOAD` "can be declarative (by the carrier) **or Shippeo
   triggered 1 hour before the beginning of the pickup start slot**",
   `event-list-order-level.md:6`) and computation-derived
   (`CALCULATED_DELAY_DRIVING_TOWARD_SITE_*`). **Two of the four have to lie on the wire.** A
   mandatory field whose enum cannot express the publisher's own behaviour is worse than no
   field. Our seven members cover all four: schedule-derived is `ASSUMED_FROM_PLAN`,
   computation-derived is `DERIVED_BY_RULE`.

3. **Two parties may assert the same fact differently, and the catalog keeps both — for any
   fact class, not only times.** This is a yes, and it is the whole reason (a) publishes
   assertions. No assertion is deleted to make room for a better one. The fact-class families,
   each with a source that treats the class as contested (shared §4.1):

   | Family              | Examples                                                 | Contest is real because                                                                                                                                                                                                                                                           |
   | ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **time**            | arrival, departure, SIT entry date, actual delivery date | `src:dp3-400ng` names **five** distinct delivery-date roles and different charges hang on different ones.                                                                                                                                                                         |
   | **measure**         | net / gross / tare weight, cube, piece count             | `src:x12-212-trailer-manifest` element 187: a weight is always typed — `G` gross, `N` actual net, `T` tare, `E` estimated net, `B` billed, and **`RG`/`RN`/`RT` reweigh** variants. A weight is `(kind, unit, value, source)`, never a number.                                    |
   | **count**           | cartons, handling units                                  | `src:x12-212-trailer-manifest` `AT8-04` non-unitized vs `AT8-05` unitized — two counts summing to one total.                                                                                                                                                                      |
   | **condition**       | per-article condition at receipt and at forwarding       | `src:dp3-400ng` Item 17.12.c; `src:cfr-49-375` §375.503.                                                                                                                                                                                                                          |
   | **state**           | a party's claim about a lifecycle state                  | `src:sirva-ade`'s dispatch lifecycle and `src:weichert-supplier-api`'s procurement lifecycle both describe one physical move and **do not align** — award and accept happen before an ADE registration exists. Two parties, two state assertions, neither derived from the other. |
   | **identity**        | BOL number, registration, SCAC, trip number              | Shared §7; `src:x12-212-trailer-manifest` `BLR-02` makes the carrier-of-record time-scoped.                                                                                                                                                                                       |
   | **party-role**      | who is the hauling agent                                 | `src:dp3-400ng` Item 7.1: the origin representative must be named in DPS at acceptance and **updated to the one who will actually service the shipment** before the pre-move survey.                                                                                              |
   | **act performance** | shared §2                                                |                                                                                                                                                                                                                                                                                   |

4. **The resolution is itself a published, reasoned record: `FactResolved`.** It names the
   contested fact key as an explicit `factRef`, the `selected` winning assertion, **`considered[]`**
   — every assertion in
   the contest — and **`rule {ruleId, ruleVersion}`**.
   _Sourced:_ `src:project44`'s `selected` flag is the precedent for publishing a winner beside
   the losers, and p44's own `ShipmentException.definitionId` — "a logic which determines how the
   exception would be derived" — is the precedent for naming a derivation rule.
   **[ORIGINAL]:** (i) making the resolution **append-only**, so the history of _which answer we
   were giving when_ survives; (ii) requiring the rule **id and version**; (iii) generalising from
   time values to **any** fact class. Revision 1 called (i) and (ii) "`src:project44`'s `selected`
   flag with two upgrades that p44 lacks" inside the decision section, outside the part of the
   document that disclaims originality. The critique is right that this is invention presented as
   a reading; it is marked here, and it now appears in §7's confidence table. The rename from
   `MilestoneTimeSelected` to `FactResolved` is not cosmetic — the old name asserted the
   time-only scope that must-fix #4 rejects.
   **Reject last-writer-wins.** `src:gtfs` is the explicit counter-example (`FULL_DATASET`
   "will overwrite all preceding realtime information", no retraction, no supersedes link, no
   history) and it is only defensible there because GTFS has one publisher by construction.
   **Rule E-CANON** (shared §1.3, §4.3, declared per `type` at shared §4.7) is what makes the
   contest actually pair: every `type` declares one canonical `subject` **family**, so the driver's
   stop-phrased claim and the destination agent's shipment-phrased claim end up on the same key —
   and where no stop of ours exists, so does a claim about an `externallyPerformedLeg`, that being
   the other member of the stop family. Without it, the critique's objection holds — a rule keyed on
   (subject, milestone) would never see them as competitors. **How the shipment-phrased claim gets
   onto that key is shared §4.6 and it is not by the boundary re-keying it:** the boundary refuses a
   non-canonical subject, and the re-phrasing is an ingest-side act by a named subject-resolution
   rule that must return exactly one candidate. See §8.7.

5. **Publish, per record `type`, which capture methods may assert it — cut by capture method, not
   by "a device".** _(Revision 2 wrote "per (`type` × `factClass`)", which presumed two
   classification axes; shared §1.3 collapses them and the product's second factor was always
   degenerate.)_

   **Where I disagree with the critique, and where I concede.** The critique says revision 1's
   rule "forbids the harmless case (a geofence marking arrival)". It does not: revision 1's first
   bullet was "A device **may** assert: arrival at a stop, departure from a stop, position, ETA
   change." That half was already right. **The substantive half of the objection is correct and
   is what matters**: the binding was written over "a device", and the case the rule exists for —
   `ASSUMED_FROM_PLAN`, which is not a device — was left entirely unguarded, so nothing prevented
   publishing an actual delivery with `capturedBy = ASSUMED_FROM_PLAN`. §6.4 then asked the user
   whether such values may go to partners at all, having already let them into the catalog as
   actuals. Re-cut per shared §5:

   - **M1. `ASSUMED_FROM_PLAN` may never carry `basis = ACTUAL`.** It is published at
     `basis = PLANNED`, and `FactResolved` answers "our best current value" — so the operational
     need is met without fabricating an observation. **[ORIGINAL], and it departs from its
     source:** `src:omnitracs-roadnet` carries `AssumedFromProjection` as a `DataSource` value
     _on a measured actual_. We forbid that.
   - **M2. Possession-changing facts may be asserted at `basis = ACTUAL` only with
     `capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`** — never `DEVICE_*`,
     never `ASSUMED_FROM_PLAN`, and `DERIVED_BY_RULE` only under M4. The published list:
     **packed, loaded, unloaded, delivered, stored in (`storeIn`), released from storage
     (`storeOut`), custody handed over, item accepted, item refused.** **[ORIGINAL]** as a list;
     the principle is Shippeo's. _These are **acts**. Revision 2 wrote "placed in SIT / released
     from SIT", which collided with M4's mandatory derivation of the SIT entry date; shared §5.3
     separates the `storeIn` act from the `sitEntryDate`, and M2 and M4 then govern two different
     record types instead of contradicting each other over one._
   - **M3. Every act assertion with `outcome ≠ COMPLETED`, and every `Reason`, requires
     `capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`.**
     _Sourced, and precisely:_ Shippeo's `event-list-order-level.md` carries a final column,
     "Based on geofence?", and **exactly seven of its 38 rows are marked `Yes`**; **not one of them
     is an exception row** — 25 of the 38 carry a justification other than `CFM`/`ARS`/`DES`, and
     every one of the 25 is blank in the geofence column. _(Corrected count, shared §5.2 M3: the
     committed file is 40 lines — one header, one separator, 38 data rows. "7 of 41" and "24
     exception rows" were inherited approximations and the finding is unchanged by the arithmetic.)_
     **[ORIGINAL] where the rule goes beyond the cite — and the direction matters.** Shippeo's
     published rule is geofence _eligibility_ over those 38 order-level rows. Extending it to all
     machine assertion of exceptions is our step. **Here I part company with the critique's
     wording**: it calls this an over-read, and an over-read is a claim of _more licence_ than the
     source grants. Ours is **stricter** than the source — Shippeo itself derives
     `CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` from position, i.e. a machine asserting
     _why_ something is late, and we forbid that. The disclosure defect the critique identifies is
     nonetheless real: revision 1 presented an authored tightening as the source's own rule, and
     cited `P44_DETECTED` approvingly two pages earlier without noticing that our rule bans it as
     an ACTUAL exception assertion. Both are fixed here: the extension is marked, and
     `P44_DETECTED`-shaped derivations are `DERIVED_BY_RULE` at `basis = ESTIMATED` or, for an
     exception, a **prompt** rather than an assertion.
   - **M4. The sanctioned derivation, carved out because it is mandatory rather than merely
     permitted: the SIT entry date.** `DERIVED_BY_RULE` is permitted on a possession-changing
     fact **only** where the catalog publishes the derivation as a named rule and the record
     carries `{ruleId, ruleVersion}` **and the `eventId`s of its inputs**. `src:dp3-400ng` Items
     29.4, 29.6, 17.20: "SIT in date will be equal to the TSP's **first available delivery
     date**"; the SIT effective date is "always… the TSP's first available delivery date, not the
     date of notification"; and "**the arrival date must NOT be entered as the SIT entry date**"
     unless they coincide. `src:dtr-part-iv` §D.5.b(2) NOTE (p.18): SIT is effective "the date the
     shipment was **offered for delivery**, not the date it arrived." Two independent regulatory
     sources, the same rule, from opposite directions. Consequence: **a keyed arrival date
     published as the SIT entry date is a detectable defect.**
   - **M5. What a geofence may assert.** `DEVICE_GEOFENCE` may carry `basis = ACTUAL` for
     **arrival at a stop, departure from a stop, position, and ETA change**. _Sourced:_ five of
     Shippeo's seven geofence-eligible rows are exactly these (`ARR_LOAD`, `LEFT_LOADING_SITE`,
     `ARR_UNLOAD`, `DRIVER_LEFT_UNLOAD`, `ETA_EVENT`).
   - **M6. Shippeo's own violation is rejected.** The remaining two of the seven are `CON_LOAD`
     and `CON_UNLOAD` — _conformity_ assertions, "goods were loaded conform". A geofence can
     witness a departure; it cannot witness that nothing was missing. Shippeo's own analysis calls
     it "a convenience, and adopting it would silently manufacture evidence." Under M2 and M3 it
     is inexpressible here. HHG conformity is not one bit anyway: it is per-item against a signed
     inventory, which in this model is a `condition` fact class at `item` grain, not a flag on a
     delivery.
   - **M7. Eligibility is declared per record `type` and enforced on the wire.**
     **[ORIGINAL]:** Shippeo publishes it as a table column and enforces only that `trigger.type`
     is present; its analysis recommends the direction ("make it a property of the event type, not
     a runtime guess") but the wire enforcement is ours.

**Two further rules, cheaper, and re-sourced after the Atlas supplement:**

6. **The communication of a time is a distinct fact from the time.** The **duty** is
   regulation-grade and is what carries this rule: `src:dp3-tender-of-service` §C.3.c makes
   delivery notification a duty with a deadline (**at least 24-hour notice**), an escalation
   (**two documented unsuccessful contact attempts six hours apart, the final one telephonic**),
   a required content list (FADD, contact numbers, e-mails, hours of operation, and the statement
   that the customer has 24 hours to respond, §C.3.e-f), and a recording obligation ("update DPS
   Shipment Management Remarks immediately after each notification"). A model that records the
   ETA and not the telling of it cannot answer the question a regulator or a claim will ask.
   Atlas's `CustomerETA` (`eta_given_by` / `eta_given_to` / `date_given`) and `EXTDate`'s
   late-notification flag are the only _structural_ instance in the corpus of a publisher
   carrying the telling as its own record — **column names with no code list**, so they
   corroborate the shape and define nothing. Revision 1 rested this rule on Atlas and mentioned
   the ToS as support; the weighting is reversed.
   In the shape: the telling is its own act assertion (`type = notification`, subject = the
   shipment or the stop, `assertedBy` = the notifying agent, `value` carrying who was told and by
   what channel), with the ETA assertion in `evidence[]`.

7. **An exception carries fault attribution — and the attribution rides on the `Reason`, not on
   the assertion.** Revision 1 said "**Attribution belongs on the assertion**, not in a
   downstream report." The critique is right that no source states that placement: Atlas puts
   fault on an `EXTDate` _exception record_, X12 keys element 1651 to a responsible party on a
   _status message_, DTR attributes at _segment_ grain. **The placement claim is withdrawn.**
   Shared §2.4 rule 6 settles it the other way and better: attribution is a structured field on
   the `Reason` — which is the thing all three sources actually attach it to — and lifting it out
   of the code removes the duplication both sources carry.
   _What remains sourced, and is retained:_ that reason vocabularies **are** organised by
   responsible party. `src:stedi-x12-reference` element 1651's 86 values are grouped
   consignee-/driver-/shipper-/other-carrier-related and cartage agent, and include `BF Carrier
Keying Error` — a reason code that admits the reporter got it wrong. `src:shippeo` separates
   `NJU` "not justified by carrier" from `DIV` "by the counterparty". `src:dtr-part-iv` shows why
   it is money: segmented transit times with party-owned SLA segments and proportional remedies.
   Atlas's `delayclaimresponsibility` / `delayclaimwhy` are column names and no longer carry this
   rule.

### What it forecloses, and the cost if it is wrong

**Forecloses:**

- **Any assertion with an anonymous author.** Cheap inbound bridges become impossible: a partner
  feed that carries no asserter (SIRVA ADE and the FCA 858 profile both do exactly this) must
  be attributed at the boundary — the ingesting integration asserts `PARTNER_ASSERTED` with the
  partner named as the party. That is correct and it is also work, on every inbound integration,
  forever.
- **Silent inference.** Anything the platform computes must be labelled `DERIVED_BY_RULE` and
  name its rule and inputs. This forces every derivation to have a stable, published id before it
  can emit.
- **Geofence-driven milestone automation beyond arrive/depart/position/ETA.** A tenant who wants
  "auto-mark delivered on exiting the destination geofence" cannot have it in the catalog. They
  can have it as a _prompt_ to a human, whose tap is then `OBSERVED_BY_PERSON`.
- **Machine-asserted exception reasons at `basis = ACTUAL`** — including the p44-shaped ones this
  document otherwise admires.

**Cost if wrong:**

- **If mandatory asserter is too strict**, some legacy inbound feeds get attributed to a
  synthetic "integration" party and the field is less informative than hoped. Degraded, not
  broken — and strictly better than the field being absent, which is unrecoverable.
- **If the capture-method enum is wrong**, it is the one thing here that is genuinely
  extensible: it is a code list, it is versioned, and Rec 24's governance model (dated change
  log, one-edition deprecation window, retired values never reissued) is a free template.
- **If M3 is too strict** — if forbidding machine-asserted exception reasons blocks a real,
  well-founded derivation — the remedy is M4: publish the derivation as a named rule and carve it
  out, exactly as the SIT entry date is carved out. The mechanism for relaxing the rule is
  already in the model, which is why erring strict is cheap here.
- **If we are wrong about two parties disagreeing** — if in practice one party always asserts
  each fact — we have paid for a competing-assertion model nobody uses, and a consumer reads the
  `FactResolved` projection and never looks below it. Wasted effort, no harm.
- **The expensive error is the opposite one**: shipping without `capturedBy`, discovering later
  that a material share of "actuals" were `ASSUMED_FROM_PLAN`, and being unable to tell which.
  Every on-time statistic, every claim defence and every partner SLA computed from that history
  is unverifiable, permanently.

**Confidence for (b): high on the components, capped at medium-high overall — see §7.** The
critique is right that (b)(4)'s resolution rule is inexpressible without §5.5's
authoritative-asserter rule, which is `[ORIGINAL]`, and that a decision cannot be scored above
the confidence of the item it depends on. The cap is applied.

---

## (c) Corrections — how a published fact is unsaid

### The question, sharply

A published event cannot be unpublished. **What are the named operations for saying an earlier
published assertion was wrong, what exactly does each do to a consumer's state, and who is
allowed to perform them?** The crosscheck is right that this has no migration path: if the
catalog ships without a correction channel, the only remedy is to assert a later contradicting
event and hope the consumer notices — which is precisely what `src:shippeo`, `src:macropoint` and
the X12 214 do, and all three of their analyses name it as disqualifying.

### The positions

| Position                                                           | Source                                                                                    | Precise semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Append-only, two distinct reasons, queryable as a class**        | `src:gs1-epcis-cbv` **ratified** (CBV 2.0 §7.5.3, p.55; EPCIS 2.0 §7.4.1.2, p.76; §8.2.7) | `errorDeclaration` carries `declarationTime` separate from the preserved `eventTime`, and a reason ∈ `did_not_occur` (a pure retraction — "SHALL NOT be used in an error declaration that contains one or more corrective event IDs") or `incorrect_data` (a supersession with the replacement explicitly linked). Queryable: `EXISTS_errorDeclaration`, `EQ_errorReason`, `EQ_correctiveEventID`, `GE_/LT_errorDeclarationTime`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| — **and its normative preference order**, which round 1 missed     | ratified supplement, finding 7                                                            | EPCIS 2.0 §7.4.1.2: "An `ErrorDeclaration` element **SHOULD NOT** be used if there is a way to model the real-world situation as an ordinary event." §7.4.1.2.1: "The **preferred** way… is to recognise that the discovery of an erroneous event and its remediation is itself a business process." Worked: an over-ship is remediated by a _new shipping event_, a short-ship by a _void event_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — **and its identity rule, which is a trap**                       | ratified supplement, findings 4 and 5                                                     | The error declaration "**SHALL be otherwise identical to a prior event**… includes the `eventID`… **This is the sole case where the same non-null `eventID` may appear in two events**." Consequence, stated: **a receiver that dedupes on `eventID` will silently discard every correction.** §7.4.1.2.2: "The **only** way to recognise that an event is the original event matching an error declaration is to confirm that all data elements in the events… match." There is no back-pointer. And the ratified artefacts contradict each other — the spec says ids are unique "other than error declarations", `openapi.json` says "must be unique across all events in the system."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Two named operations with defined effects on history**           | `src:x12-858-implementation-guide` p.7                                                    | `BX01 = 01`: "the previous status transmitted… should be **disregarded and the prior status should be considered the current status**" — retract-to-previous. `BX01 = 03`: "the previous trailer information… should be **removed from the carrier applications system**" — expunge. Worked example 4 (p.35) shows `01` carrying the **full original context** so the receiver can identify what is being undone. **Scope, which revision 1 ignored: this is an ordered status history on one carrier's own message stream.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| — **scoped below the message**                                     | same, worked example 8 (pp.41-43)                                                         | A multi-stop tender stays `00 Original` while a **second N9 with value `C`, with its own date and time, scoped to stop 1**, cancels one stop. One consignment cancels off a consolidated load; the trip proceeds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **An offsetting record that sums to zero**                         | `src:sirva-ade` ABS p.3                                                                   | `AdjCode` blank = Original, `ADJ` = adjustment (only the changes), `CAN` = "cancelation so the amounts combined with the 'Original' amounts will **zero out** the shipment", plus `BatchNbr` distinguishing reruns. A stated, testable invariant — the best correction semantics in that source, and it is on the financial side of a source that has none on the operational side.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Correction depends on the kind of fact**                         | `src:alvys-api`                                                                           | Operational: `DELETE /trips/{id}/stops/{id}/arrival` is a published un-do, "effectively marking the stop as not yet arrived." Money: `409 Conflict` = "The record cannot be changed at all — money already settled. **Do not retry. Post a correction instead.**"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Corrections as first-class operations with diffs**               | `src:samsara`                                                                             | `stop arrival time updated` and `stop completion time updated` are **distinct operation types** from `stop arrived`, delivered with a before/after diff on an immutable, append-only, cursor-paged feed, each carrying `source ∈ automatic\|driver\|admin`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **One blunt mechanism**                                            | `src:dcsa`                                                                                | `metadata.retractedEventID` names a prior event and the payload is omitted entirely. No reason. No corrective link. No separate declaration time. Its own analysis: strictly weaker, **"do not copy it."**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **The next snapshot is the correction**                            | `src:gtfs`                                                                                | `FULL_DATASET` "will **overwrite all preceding realtime information** for the feed"; `DIFFERENTIAL` exists in the enum but is "currently unsupported and behavior is unspecified." No retraction, no supersedes link, no history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Sparse-merge mutation**                                          | `src:open-trip-model`                                                                     | `UpdateEvent`: "the **fields** of the entity that need to be updated. All fields that are not present remain **unchanged**. If you want to unset a field explicitly use null." A correction is a recorded fact — but it _mutates the entity_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Adjustment as an entity with a reason**                          | `src:uncefact-scrdm`                                                                      | `Delivery_Adjustment` and `Financial_Adjustment`, both "a correction or modification to reflect actual conditions", each `{Reason.Code, Reason.Text, Actual.Amount, Actual.Quantity, Actual.DateTime}`, behind a 105-value `AdjustmentReasonDescriptionCode`. Plus the document revision chain with `Previous Revision_ Identification` and `Amendment_ Purpose.Code`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Append-only signed documents, and only a named party may amend** | `src:cfr-49-375`; `src:dp3-tender-of-service`; `src:dtr-part-iv`; `src:dp3-400ng`         | CFR: nothing is ever edited — a new signed estimate, a written attachment signed by the shipper for post-BOL services (§375.403(a)(8)-(9)), written notations added to the inventory at delivery with a copy to the shipper (§375.605(b)). And a **freeze point**: an estimate may be amended only _before loading_ (§375.401(i)), and silence after loading is reaffirmation (§375.403(a)(7)). DTR: **SF 1200** = _Bill of Lading Now Reads_ (block 11) / _Correct Bill of Lading to Read_ (12) / **Authority for Correction** (13) / Remarks (14), one BL per notice, signed by the initiating official **and** the TSP representative; **Table A-402-4 is a closed mutability whitelist**; cancellation after distribution requires a memorandum marked "canceled" to **every** original recipient (§E.3); and a silence rule — the consignee who believes a correction is needed notifies the issuing office, and "if a reply… is not received within 30 days, the consignee is permitted to make alterations." 400NG Introduction p.14 / Item 17.10: "The TSP/Agent will not redact, modify, or remove any information on the BL… The government is the only authorized agency who can redact, modify, or remove information on the BL **through an SF1200**." |
| **None at all**                                                    | `src:shippeo`, `src:macropoint`, `src:stedi-x12-reference` (the 214)                      | Shippeo: "no reversal, no correction, no purpose code… the only remedy is to assert a later event." The 214 has **no purpose code**, so a wrong status can only be superseded by one with a later timestamp — its own analysis calls this "the single biggest gap in the standard for a system of record."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### The decision

**Three operations, in a stated preference order, append-only, with an authority on each — and
every attempt recorded.**

**1. Compensate — preferred, and most often skipped.**
The world changed rather than the record being wrong: the goods came back off the van, the
delivery was re-attempted, the shipment was diverted. **Publish an ordinary assertion.**
Adopt EPCIS's normative ordering verbatim — a correction SHOULD NOT be used if the situation can
be modelled as an ordinary event, and the discovery-and-remediation is itself a business process
worth modelling. This is the rule that keeps the correction channel rare enough to be
trustworthy: a consumer that sees corrections constantly stops treating them as exceptional.

> **A boundary the critique exposed, and it is now explicit.** "Compensate" is _not_ the answer
> for two correct-but-different observations. A reweigh is not a correction — the first weighing
> occurred and was recorded correctly — and treating it as a compensate leaves two authoritative
> weights and no winner. **Competing assertions go to `FactResolved` (§(b)(4)), not to the
> correction channel.** The preference order applies only when something published was _wrong_.
> Revision 1 had no third path, which is why the reweigh fell through it.

**2. Supersede — `INCORRECT_DATA`.**
The assertion was made; a field was wrong. The correction **names its replacement explicitly**
(EPCIS's link) and **carries before-value and after-value for the changed fields only** — SF
1200 blocks 11 and 12, and Samsara's before/after diff, arriving at the same shape from a
regulation and a telematics vendor independently. Both records survive; neither is mutated.

**3. Retract — `DID_NOT_OCCUR`. One semantics, not two.**
The asserted fact did not happen. **It SHALL NOT name a replacement** — EPCIS's rule, adopted
verbatim, because "it didn't happen" and "it happened differently" are different claims and
fusing them is how a consumer ends up with both.

> **The 858's restore-to-previous is dropped as a mechanism and kept as an intent.** Revision 1
> adopted both EPCIS's no-replacement rule _and_ the 858's `01` "the prior status should be
> considered the current status" in one paragraph. The critique is right that these are
> incompatible: **retract-to-previous _is_ a successor assignment**, and applied across parties it
> **silently promotes some other company's assertion**, which the retracting party may have no
> authority to affirm. The 858's `01` is defined over an ordered status history on **one carrier's
> own message stream** (p.7-8), not over multi-party assertions of arbitrary facts.
> **Adopted instead:** a retraction removes the retracted assertion from the contest, and the
> catalog republishes `FactResolved` over what remains. That achieves the 858's _intent_ — the
> answer reverts to the best remaining one — with the authority chain intact and the rule named.
> **[ORIGINAL]:** the mechanism. **Sourced:** the intent, and the observation that the 858 is the
> only source in the corpus that writes an answer down at all.

**Five disciplines on top:**

- **A correction carries its own clock.** `declaredAt`, distinct from the preserved
  `occurredAt`. EPCIS has it; DCSA's omission is named by its own analysis as one of the four
  reasons `retractedEventID` is "strictly weaker."
- **A correction names its authority.** Not just who — _by what right_. SF 1200 block 13 is
  literally "Authority for Correction"; 400NG makes the Government the only party who may alter
  the BL and only through an SF1200. Generalised: **each fact class in the catalog declares which
  role may correct it**, and the correction cites the instrument. No vendor source has this; the
  regulatory sources require it; it is the difference between an audit trail and a comment
  thread.
- **Every correction attempt is recorded. There is no refusal path.** A correction carries
  `outcome ∈ APPLIED | INEFFECTIVE | UNAUTHORISED` — see §5.1, where the revision-1 rule that
  produced this is withdrawn and replaced.
- **Corrections are queryable as a class.** EPCIS §8.2.7's predicate set is the template
  (`EXISTS_errorDeclaration`, `EQ_errorReason`, `EQ_correctiveEventID`, `GE_/LT_declarationTime`).
  A consumer must be able to ask "what has been corrected since T" without replaying the stream.
  `INEFFECTIVE` and `UNAUTHORISED` are part of that class, not hidden from it.
- **A correction is addressable below the shipment — and above it.** The 858's example 8 is the
  proof of concept and the HHG cases are immediate: one shipment cancels off a consolidated load;
  one service cancels off a shipment; a `Portion` of two items is refused off a delivery.
  **Corrected from revision 1:** the rule was stated as "the `subject` on every event must be a
  typed reference to the smallest thing, not always the shipment." That is the shipment-rooted
  envelope in different words and it is withdrawn. `subject` is a typed reference to **exactly
  one aggregate of any kind** (shared §1.2) — which is smaller than a shipment when the fact is
  about a Portion or an item, and _larger_ when it is about a trip, an order or a charge.

**One boundary, and it is a hard one:**

> **Operational facts are corrected by supersede/retract. Financial facts are corrected only by
> an offsetting record, never by retraction — and an `INEFFECTIVE` correction never reaches the
> priced record at all.**

This is `src:alvys-api`'s insight ("a correction is a new record, not a retry"; a settled record
returns 409, "do not retry, post a correction instead") given a concrete mechanism by
`src:sirva-ade`'s `AdjCode` triple — Original / `ADJ` / `CAN`, with the stated and testable
invariant that cancel plus original **sums to zero**, and `BatchNbr` distinguishing reruns.
`src:dp3-400ng` Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c corroborate at regulation grade: refunds,
reimbursements and re-bills are **additional coded transactions carrying a narrative note**, never
edits to the original charge. `src:uncefact-scrdm` independently models `Financial_Adjustment` as
an entity separate from `Delivery_Adjustment`. The two regimes must be named in the catalog,
because a consumer that applies retraction semantics to a settled charge produces a balance that
does not reconcile.

### Rejected, explicitly

| Rejected                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EPCIS's full-replay identity rule** (the correction SHALL be byte-identical to the original including `eventID`) | Three reasons, all from the ratified supplement itself. (i) A receiver deduping on `eventID` **silently discards every correction** — the supplement says so. (ii) The ratified artefacts contradict each other on whether ids may repeat (spec §7.4.1 vs `openapi.json`). (iii) §7.4.1.2.2: there is **no back-pointer**, and the only way to match a correction to its original is to compare every field — "cheap for the consumer that only wants the latest truth and **expensive for the consumer that wants an audit trail**." An HHG claim file _is_ an audit trail. **Take the reason taxonomy, the separate `declarationTime`, the queryable-as-a-class predicates and the preference ordering. Reject the identity rule; use a distinct `eventId` and an explicit `corrects` pointer.** |
| **The 858's `01` retract-to-previous as a mechanism**                                                              | It is a successor assignment wearing a retraction's name, and across parties it promotes an assertion the retracting party may have no authority to affirm. Its intent is preserved by republishing `FactResolved`. (New in revision 2 — see decision 3.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **DCSA's bare `retractedEventID`**                                                                                 | No reason, no corrective link, no declaration time. Its own analysis: "do not copy it."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **GTFS's snapshot overwrite**                                                                                      | No history, no supersedes link, no retraction. Defensible only for a single-publisher feed with no audit obligation, which is the opposite of our case. And it interacts fatally with (a): once the plan is overwritten, `delay` has no referent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **OTM's sparse-merge `UpdateEvent`**                                                                               | It mutates the entity. An append-only catalog cannot, and the sparse-merge-with-explicit-null semantics are also a well-known source of accidental unsets. The _idea_ — a correction is a recorded fact, not a silent overwrite — is retained; the mechanism is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Alvys's `DELETE .../arrival` as a catalog operation**                                                            | A published un-do is the right _affordance_ for an operator; it is the wrong _wire format_, because the consumer is told the arrival is gone with no record that it was ever asserted. Implement it as a UI action that emits a `DID_NOT_OCCUR` retraction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **X12 `03` Delete / expunge**                                                                                      | Deliberately **not** adopted as a catalog operation. Erasure is a data-protection concern with a different authority chain and a different audit obligation, and conflating it with "this fact was wrong" means a correction can be indistinguishable from a deletion request. Keep erasure out of the event vocabulary entirely.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Assert-a-later-event-and-hope** (Shippeo, MacroPoint, the 214)                                                   | Named as disqualifying by all three analyses. Shippeo's own open question 3 concedes it does not even know whether a second event with the same code and an earlier date supersedes or duplicates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **A refusal path for out-of-window corrections**                                                                   | Withdrawn from revision 1. See §5.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### What it forecloses, and the cost if it is wrong

**Forecloses:**

- **Idempotency keyed on the event id alone** — deliberately. A consumer's dedupe key must be
  the event id, and corrections must carry _different_ ids, which is exactly the trap EPCIS
  documents and we are avoiding. Consumers must be told this in the conformance profile.
- **Rewriting history.** There is no operation that makes a published fact disappear. A
  regulator, a claim or a partner reconciliation can always reconstruct what we said and when.
  That is the point, and it is also a retention obligation with no expiry rule yet set (see §6).
- **A single mutable "current state" as the catalog's product.** Consumers who want one must
  read the derived projection, and the projection must be regenerable from the stream.
- **Cheap financial adjustments.** Money can never be quietly restated; every change is a new
  record that must sum correctly.

**Cost if wrong:**

- **If three operations are too many**: consumers implement `DID_NOT_OCCUR` and ignore the
  distinction. Mild — the extra fidelity sits unused in the record and can be exploited later.
- **If the compensate-first preference is not enforced**: the correction channel fills with what
  should have been ordinary assertions, consumers learn to ignore corrections, and the one case
  that matters gets missed. This is the realistic failure and it is a **governance** failure, not
  a schema one — mitigate by publishing worked examples of compensate-vs-resolve-vs-correct per
  fact class, as EPCIS does.
- **If recording ineffective corrections is wrong** (a lawyer's call, not a modeller's): the
  catalog holds a record of attempted amendments that have no legal effect, and a careless
  consumer might present one as effective. Mitigated by the flag being mandatory and queryable;
  the opposite error — being unable to explain why the priced record differs from what the
  customer believes — is worse and unrecoverable.
- **If we ship with no correction channel at all** (the do-nothing option): unrecoverable. Every
  wrong fact is permanent, every consumer builds a private heuristic, and the heuristics
  disagree. This is why the decision is here and not deferred.

**Confidence for (c): high.** EPCIS ratified, the 858, SIRVA, Samsara, Alvys, SCRDM, CFR 375,
DP3 ToS, 400NG and DTR Part IV all converge on append-only with a typed reason; the three sources
that disagree each state their own inadequacy in their own analyses. The two `[ORIGINAL]` pieces
— the recording of ineffective attempts and the republish-`FactResolved` retraction mechanism —
are scored separately in §7.

---

## 5. ORIGINAL DESIGN — what household-goods moving needs that no source supplied

Marked explicitly. **Nothing in this section is supported by any source in the corpus.** Each
is a modelling decision we are making, not a synthesis we are reporting.

**A note on the boundary this section used to imply.** The critique observed that "`§5` opens
'nothing in this section is supported by any source', which by construction implies everything
outside §5 is." That inference was doing real damage — `MilestoneTimeSelected`'s two upgrades,
the HHG role vocabulary and the attribution-placement rule all sat outside §5 and were all
authored. The fix is not to enlarge §5 but to **mark `[ORIGINAL]` at the point of use
everywhere**, which revision 2 does. §5 now means "items whose _entire_ substance is authored",
not "the only authored items".

### 5.1 Tense has an authority window — a time value can become unamendable _for pricing_

`src:cfr-49-375` §375.401(i): an estimate may be amended **only before loading** — "You may not
amend the estimate after loading the shipment." §375.403(a)(7): silence after loading constitutes
reaffirmation. So in HHG, **loading is a point at which certain time and money values stop being
amendable**, by anyone, as a matter of law.

No source in the corpus models "this value may no longer be amended after event E occurred."
The closest anything comes is `src:dtr-part-iv`'s Table A-402-4 — a _static_ whitelist of which
BL fields are correctable — which is a per-field rule, not a per-field-per-lifecycle-state rule.

**ORIGINAL DESIGN:** each correctable fact declares an _amendment window_ expressed as a
predicate over the event stream ("amendable until the `Loading` act for this shipment resolves at
`outcome = COMPLETED`").

**Revision 2 withdraws the second half of the revision-1 rule.** It said "a correction outside
the window is **refused rather than recorded**." The critique is right on both counts: it
over-reads §375.401(i), which makes a late amendment _legally ineffective between the parties_
and says nothing about whether a records system may record that someone tried; and it contradicts
§5.4, which requires corrections to emit obligations — a refused correction emits nothing.
Replaced, per shared §6:

| Correction `outcome` | Meaning                                                    | Effect                                                                                                                          |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `APPLIED`            | Inside the window, by an authorised party.                 | Enters the contest; `FactResolved` republished.                                                                                 |
| `INEFFECTIVE`        | Outside the window.                                        | **Recorded. Flagged legally ineffective. Never applied to the priced record.** Emits the §5.4 obligation. Queryable as a class. |
| `UNAUTHORISED`       | The declaring party has no authority over this fact class. | Recorded, not applied; emits an obligation to the party that does have authority.                                               |

**[ORIGINAL], marked precisely:** the _regulation_ is sourced and binds the parties and the
price; **that a records system may nonetheless record the attempt and mark it ineffective is
ours**, not the regulation's text. It is the right reading — a catalog that cannot record an
attempted late amendment cannot explain why the priced record differs from what the customer
believes, and the do-nothing alternative obliges the catalog to retain a fact it knows to be
false, which is the failure this whole document exists to prevent — but it is a reading, and it
is the one item here a lawyer should see.

The authority sourcing that _is_ solid and is retained: `src:dp3-400ng` Introduction p.14 and
Item 17.10 — "The TSP/Agent will not redact, modify, or remove any information on the BL… The
government is the only authorized agency who can redact, modify, or remove information on the BL
**through an SF1200**" — which is why `Correction.authority` names an **instrument**, not just a
party.

### 5.2 An ACTUAL may be _derived_ — and a cascade is a new derivation, not a correction

`src:dp3-400ng`: SIT start is a **derived** date — it equals the TSP's first available delivery
date, and "the arrival date must NOT be entered as the SIT entry date" (Items 29.4, 29.6, 17.20).
`src:dtr-part-iv` §D.5.b(2) NOTE confirms from the other direction: SIT is effective "the date the
shipment was **offered for delivery**, not the date it arrived." So a legally load-bearing
_actual_ is computed from other facts and never observed. This is M4's sanctioned derivation.

The corpus has the pieces and never joins them: `src:project44`'s `definitionId` points at "a
logic which determines how the exception would be derived" — but for exceptions, not times.
`src:omnitracs-roadnet` has `Computed` as a `DataSource` value — but no rule reference.

**ORIGINAL DESIGN:** `capturedBy = DERIVED_BY_RULE` requires naming the rule **and its input
event ids**.

**Revision 2 fixes the cascade.** Revision 1 said "a correction to any input must cascade as an
automatic supersession of the derived fact, published as its own correction event." The critique
found three of this document's own rules colliding on it: an automatic cascade is a _correction_
to a warehouse-authoritative, legally load-bearing date, _declared by the platform_, with no
authority §5.5 grants it. Correct. Resolved per shared §6.6: **the cascade is not a correction.**
When an input is retracted or superseded, the platform publishes a **new derived Assertion** (a
new value under the same fact key, `capturedBy = DERIVED_BY_RULE`, naming the new inputs) and a new
`FactResolved`. The platform asserts what it derived — which it plainly has authority to do — and
never corrects the warehouse agent's fact. Without this, a retracted arrival leaves a stale SIT
clock running; with revision 1's version, fixing it required an authority the model refused to
grant.

### 5.3 The customer is an asserter

Every provenance vocabulary in the corpus is carrier-side: carrier, broker, agent, dispatcher,
device, visibility provider. `src:sirva-ade`'s cast — the most complete in the corpus — has ten
role types and the customer is not one of them. `src:milmove-mymove` comes closest with three
assertion classes for one real event — the customer's _requested_ date, the mover's _actual_
date, and a government inspector's `observed*` dates — and it is a government program, not a
commercial model.

In HHG the customer asserts facts that bind: the signature on the inventory, the refusal of an
item, "not home", the C.O.D. payment, the notation of damage at delivery
(`src:cfr-49-375` §375.605(b)). `src:shippeo` has `DAF` "consignee closed or absent" as a
_justification the carrier supplies_ — the customer is never the asserter, only the subject.

**ORIGINAL DESIGN:** `customer` is a first-class value of `assertedBy.role`, and certain facts
(inventory acceptance, item refusal, damage notation at delivery, delivery receipt) may be
asserted _only_ by the customer or co-asserted. This changes the authority model, not just the
enum. It is also the member of the role vocabulary that element 98 is least likely to supply,
since X12's party codes are trading-partner codes.

### 5.4 A fact can be frozen by a downstream clock

`src:cfr-49-375` opens a **9-month** claims window; `src:dtr-part-iv` and
`src:dp3-tender-of-service` carry a dense ladder of notification deadlines, joint inspections and
SCRA certifications. Once a claim is open, correcting the delivery date or the inventory _changes
a legal position_ and other parties' clocks.

DP3 ToS is full of notification-with-deadline duties; **not one of them is triggered by a
correction.** No source in the corpus ties a correction to a downstream obligation.

**ORIGINAL DESIGN:** a fact carries the clocks that depend on it, and correcting such a fact
emits an obligation — a notification assertion naming who must be told and by when. Without this,
the correction channel can silently invalidate a claim defence. **Extended in revision 2** to
`INEFFECTIVE` and `UNAUTHORISED` corrections, which is what resolves the §5.1/§5.4 contradiction
the critique found: every correction outcome emits, because a recorded-but-ineffective amendment
attempt is precisely the thing the other side needs to be told about.

### 5.5 The authoritative asserter changes at a custody handoff

`src:open-trip-model`'s `HandOver` carries `from`/`to` actors; `src:stedi-x12-reference` has the
interline pair `J1 Delivered to Connecting Line` / `R1 Received from Prior Carrier`;
`src:project44` has `INTERLINE_INFO` / `INTERLINE_MISSED`; `src:uncefact-rec24` distinguishes
**41** `Handed_over_under_continued_responsibility` from **349** `Handed_over`. **None of them
says that the asserter-of-record for subsequent facts changes at the handoff.**

In HHG it plainly does: the origin agent asserts pack and load, the hauling agent asserts the
line-haul, the warehouse agent asserts SIT in and out, the destination agent asserts delivery —
and they are different companies, sometimes competitors, sometimes with conflicting commercial
interests in the same date.

**ORIGINAL DESIGN:** the catalog declares, per fact class, which role is the **authoritative**
asserter given the custody state **at the instant the fact is _about_**, so that another party's
assertion of the same fact is visibly _non-authoritative_ rather than merely _later_.

_(The word "current" is deliberately gone, and its removal is the point rather than a tidy-up.
Revision 2 wrote "given the **current** custody state", and "current custody state" had no referent
in the envelope at all. It has one now — the fold **`custodyAt(goods, instant)`**, shared §4.8.3 —
and the instant it is evaluated at is the one the fact is about, per **A8-INSTANT** (A8 §4.2), never
the present. Keying on the present is the recency failure this section exists to close; it would let
a party that no longer holds the goods lose authority over a fact from when it did. Shared §10.3
item 23.)_

**Where it now lives (revision 2).** It is not a free-floating principle: it is **the rule named
by `FactResolved.rule`**. A resolution that says "the destination agent's arrival wins over the
driver's app" is a rule with an id and a version, and this section is what licenses that class of
rule to exist. On an `ExternallyPerformedLeg` (shared §8.2) it is materialised as the
`authoritativeAsserter` field.

**And the confidence consequence — the cap has moved, not disappeared.** Rule (b)(4) is
inexpressible without this, or it degenerates to recency, and a decision cannot be scored above the
confidence of the item it depends on. Revision 3 rested that cap on A8's **nonexistence**, which
§8.7 of this same document no longer does: it cites [`A8` §5 row 1](A8-authority-skeleton.md) for the
authoritative role on `arrival`, A8 §4.1 for what `competing` licenses, **A8-NAMED** for the
prohibition on arranging a winner by picking a rule id, and A8 §10 for the standing of the table.
Made one reading:

- [`A8-authority-skeleton.md`](A8-authority-skeleton.md) **exists** and supplies exactly what this
  section asked for — the rule class `AUTHORITATIVE-ROLE-AT-INSTANT`, **A8-INSTANT** as the answer to
  "degenerates to recency", **A8-MOVE** on `custodyBasis` 41 vs 349 as the hinge, and a
  per-fact-class authoritative-role table for eleven classes.
- **A8 §10's last row caps its own contribution at _medium_, and only for the fact classes in its
  §5.** So the cap on (b) **moves to that medium** — a dependent decision may be scored
  **medium**, **may still not be scored high**, and gains **nothing at all** for a fact class shared
  §4.7 marks **owed**. **§7 caps (b) at medium-high accordingly**, which is the same number it
  carried, now resting on A8 §10 rather than on A8's absence.
- What shared §10.4 still leaves open is **whose assertions win** in the general case, not _what_
  custody is: shared §4.8 settles custody as a **projection**, and `boundBy = CUSTODY` now resolves
  against the envelope.

### 5.6 Adjacent, and assigned elsewhere

The crosscheck's A6 finding — **no source in the corpus links a document to the event it
evidences** (`src:milmove-mymove`'s own open question 10, agreed by omission in 25 others; the
nearest is EPCIS's `upevt`, citing another party's event id as evidence) — is provenance-shaped
and belongs to the same family. **Partially answered in revision 2**: `evidence[]` on an
Assertion is the slot, and `document` is a subject kind (shared §1.2), so a weight ticket is an
aggregate that can be asserted about and cited. What `evidence[]` _means_ — whether citing a
document is a claim about it, how a signature is modelled, retention — is A6's and is not decided
here. Flagged so it is not assumed settled.

---

## 6. What only the user can decide

Listed separately because each is a business, legal or commercial judgement, not a modelling one.
None can be inferred from the corpus.

1. **Is the catalog published to external partners in v1, and to whom?** This sets whether the
   envelope becomes irreversible now or in a later release. If the answer is "internal only for
   12 months", (a)'s medium-confidence leg can be revisited cheaply; if a partner is onboarded
   in v1, it cannot.

2. **May a tenant extend `capturedBy` or `assertedBy.role` without a platform release?** This is
   fork decision 9 (open vocabularies) intersecting this one. The corpus offers a better answer
   than the usual binary: `src:gs1-epcis-cbv`'s **two-tier conformance** (CBV-Compliant closes
   the vocabularies; CBV-Compatible opens them; one schema, two named levels) — a tenant
   publishes Compatible, a partner integration demands Compliant. Worth deciding once, together.

3. **Retention for superseded, retracted and `INEFFECTIVE` assertions.** `src:cfr-49-375` sets
   retention periods for _documents_; nothing in the corpus sets one for event assertions. This
   interacts with 5.4 and with the deliberate exclusion of an erasure operation from the
   vocabulary.

4. **May `ASSUMED_FROM_PLAN` values be published to external partners at all?** **Narrowed in
   revision 2**: M1 already forbids them from carrying `basis = ACTUAL`, so the dangerous version
   of this question — a partner reading an assumed actual as an observation — is closed by the
   model rather than left to risk appetite. What remains is the milder question of whether an
   `ASSUMED_FROM_PLAN` value at `basis = PLANNED` is published outbound or held internally. That
   is still a call for the user, and it is now a preference rather than a misrepresentation risk.

5. **Who is the authoritative asserter per fact class in the tenant's own agent network?**
   (5.5 defines the _slot_ and `FactResolved.rule` gives it a home; filling it is a business rule
   that differs per tenant and per van line, and may be contractual.)

6. **Do financial corrections live in the same catalog as operational ones, or a separate
   stream?** The two regimes are decided above; whether they share an envelope, a subscription
   and an access-control boundary is an operational and commercial question. `src:sirva-ade`
   separates them (a daily Abstract push, distinct from the operational event feed);
   `src:alvys-api` does not.

7. **Whether a human-facing "undo" is offered at all.** Alvys publishes one and it is popular
   with operators. Offering it changes training and expectations even though the wire format is
   a retraction either way.

8. **Whether an `INEFFECTIVE` amendment attempt may be shown to the customer, and how.** New in
   revision 2, and it is the legal-review question §5.1 raises: the record exists either way; who
   sees it, and with what wording, is not a modelling decision.

---

## 7. Confidence, and what would change my mind

| Part                                                                                        | Confidence                                                                  | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) tense on the time value, `basis` classifier, one record class                           | **medium**                                                                  | The rejections are firmly evidenced (five sources fail identically on zones; Rec 24 demonstrates the code-explosion cost empirically; project44 documents its own incoherence; MMT and SCRDM contradict each other in one download). The positive shape is a synthesis no single source publishes. Unchanged from revision 1 — but note that the _reason_ it is medium has shifted: the occurrence/assertion split that was the medium-confidence part is now abolished, and what remains medium is the classifier-on-the-value choice itself.                                                                                                                                                                                                                                                                                                                                                                                                     |
| (a) the `basis` enum's five members                                                         | **high for four, medium for `COMMITTED`**                                   | `PLANNED`/`ACTUAL` from SCRDM; `REQUESTED`/`ESTIMATED` from DCSA (**re-cited — revision 1 attributed these to SCRDM and was wrong**). `COMMITTED` is carried by `src:uncefact-scrdm`'s `Confirmed_` definition plus `src:sirva-ade`'s ALP/ADP + Will-Advise at grade A plus 400NG's five delivery-date roles. **Atlas's field pair is column-name corroboration and is not decisive** — revision 1's criteria table said "only SCRDM and Atlas distinguish them" and that framing is withdrawn.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| (a) three clocks                                                                            | **medium-high** (was high)                                                  | **Re-argued.** Two sources carry three clocks (`src:shippeo`, `src:x12-858-implementation-guide`); `src:gs1-epcis-cbv` carries two and supplies the **conformance rule** for the third; `src:project44` and `src:alvys-api` carry two and corroborate the _split_ only — p44 fuses received-and-calculated, Alvys has no occurrence time at all. `src:sirva-ade` is the worked counter-example from a live partner contract. Revision 1's "five sources converge independently" was false.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| (a) typed time values, `asOf` on estimates, zone-of-occurrence                              | **high**                                                                    | p44 enforces `asOf` in three independent places and Samsara in one; the `AT7` chain supplies the precision ladder; five independent sources fail identically on zones, which is evidence that an optional zone will be omitted. Separated from the clock-count row because the evidence is stronger and independent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| (b) provenance — the components                                                             | **high**                                                                    | Ten sources converge on who/how/competing-assertions; the two that omit it say so themselves; two regulatory sources make it a compliance matter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| (b) provenance — **overall, as a decision**                                                 | **medium-high (capped — the cap has _moved_, not lifted)**                  | **Conceded to the critique.** Rule (b)(4)'s resolution is inexpressible without §5.5's authoritative-asserter rule, which is `[ORIGINAL]`, and a decision may not be scored above the item it depends on. **Re-argued against [`A8`](A8-authority-skeleton.md) rather than against its absence.** Revision 3 capped this on "A8 is unwritten"; A8 now exists and supplies the rule class (`AUTHORITATIVE-ROLE-AT-INSTANT`), **A8-INSTANT**, **A8-MOVE**, and the eleven-class role table §8.7 already cites — A8 §5 row 1 for `arrival`, A8 §4.1 for `competing`, **A8-NAMED** against picking a rule id that sounds right. **But A8 §10's last row caps its own contribution at _medium_, and only for the classes in its §5**: medium is now available, **high is still barred**, and a fact class shared §4.7 marks **owed** gains nothing at all. Hence the same medium-high, now resting on A8 §10's medium rather than on A8's nonexistence. |
| (b)(4) `FactResolved` — append-only, rule id **and version**, generalised to any fact class | **[ORIGINAL], medium-high**                                                 | p44 supplies a `selected` marker and, separately, a `definitionId` for a derivation rule. **The append-only history, the versioned rule reference and the generalisation beyond time are ours** — revision 1 presented two of the three as p44's and they are not. Medium-high rather than medium because the acceptance test (shared §4.4, R-WEIGHT-LOWER) shows a published domain rule slotting into it unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| (b)(5) M1–M7, cut by capture method                                                         | **high for M3/M5/M6, medium for M1/M2/M7**                                  | M3/M5/M6 rest on Shippeo's own published table and its own two defects. M1 is `[ORIGINAL]` and **contradicts** `src:omnitracs-roadnet`, which carries `AssumedFromProjection` on a measured actual. M2's possession-changing list and M7's wire enforcement are `[ORIGINAL]`. Our extension of the geofence column to all machine-asserted exceptions is marked and is **stricter than the source**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| (b)(1) the HHG `assertedBy.role` vocabulary                                                 | **medium**                                                                  | The _shape_ is DCSA's (`publisher` + `publisherRole`, mandatory). The _cast_ is `src:sirva-ade`'s (`Resource.Type` + `ServiceProviderFunction`) — cited at the point of use in revision 2, unattributed in revision 1. `customer`, `account/RMC` and `platform` are `[ORIGINAL]`. **`src:stedi-x12-reference` element 98 is still unread**, and it is the one list that would let this be checked against an industry vocabulary; the stedi analysis scores A8 C2=1/C4=0 on exactly that ground.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| (b)(6) the telling of a time is a fact                                                      | **high on the duty, low on the shape**                                      | `src:dp3-tender-of-service` §C.3.c-f is regulation-grade and carries the rule. Atlas's `CustomerETA`/`EXTDate` late-notification flag is the only structural instance and is **column names with no code list**; revision 1 rested the rule on Atlas and that weighting is reversed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| (b)(7) attribution on exceptions                                                            | **high that reasons are party-organised; the placement claim is withdrawn** | X12 element 1651's 86 values organised by responsible party, Shippeo's `NJU`/`DIV`, DTR's segment-grain remedies — all sourced. "Attribution belongs on the assertion" is **withdrawn as unsourced**; shared §2.4 rule 6 puts it on the `Reason`, which is where all three sources attach it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| (c) corrections                                                                             | **high**                                                                    | EPCIS ratified + the 858 + SIRVA + Samsara + Alvys + SCRDM + CFR 375 + DP3 ToS + 400NG + DTR all converge on append-only with a typed reason; the three that disagree each state their own inadequacy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| (c) the retraction mechanism (republish `FactResolved` rather than restore-to-previous)     | **[ORIGINAL], medium-high**                                                 | The _intent_ is the 858's and is sourced; the mechanism is ours, adopted because the 858's is defined over one carrier's own ordered status stream and silently promotes another party's assertion when applied across parties.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| §5.1 recording an `INEFFECTIVE` correction                                                  | **[ORIGINAL], medium**                                                      | §375.401(i) speaks to amendment and to price, not to recording. This is our reading, it is the one a lawyer should see, and it is listed in §6 item 8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| §5 original design generally                                                                | **explicitly unsupported**                                                  | Marked item by item. These are the parts most likely to be wrong and the cheapest to revise, since each is additive rather than structural.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**What would change the recommendation:**

- **Resolving Shippeo's two master code spreadsheets** (`docs.google.com/spreadsheets/d/1MgnU_…`
  and `…/1EwuiPnjSb…`), which would label the six unlabelled situation codes (`PCH`, `EXP`,
  `SOL`, `DIF`, `EDI`, `GES`) and three unlabelled justifications (`CEX`, `MQD`, `RGT`). Those
  are plainly a second dimension of delivery outcome. Note the limit: per shared §11 this would
  _enlarge the reason list_, not change the factorisation, so it bears on A4's vocabulary more
  than on this document's shape.
- **X12 element 98 (party role codes)**, still unread and flagged by the stedi analysis's own
  open question 1 as blocking — it is the one list that would let `assertedBy.role` be checked
  against an industry vocabulary rather than authored from `src:sirva-ade`'s cast plus four
  members of our own. **This is now the single highest-value unread item for this document.**
- **A published HHG-native event standard**, if one exists. `src:iso-17451` (ISO 17451-1 /
  ISO/TS 17451-2) has never been obtained and is the only formal removals data standard in
  existence. It is scoped to inventory and condition rather than to time and provenance, so it
  is unlikely to overturn this — but it has never been checked.
- **A commercial (non-DoD) published resolution rule over a contested non-time fact**, which
  would corroborate or contradict `R-WEIGHT-LOWER`'s shape. 400NG's lower-of-two-reweighs rule is
  a DoD program rule and is deliberately scoped as one (shared §4.4); a tariff or a van-line
  contract carrying a different rule over the same fact class would confirm that `FactResolved`'s
  named, versioned rule is the right level of indirection. A source carrying **no** such rule
  anywhere would weaken it.

**What would NOT change it, and is deleted from revision 1's list.** Revision 1 named "the Atlas
`/Types` reference-data endpoints (~35, five reachable on the current key)" as a falsification
condition for the `EXTDate` and five-tense-stop claims: "if those endpoints show that `date_type`,
`reason` and `delayclaimresponsibility` are free text, the `EXTDate` evidence weakens from 'a
designed record' to 'a set of column names.'" **That condition is already met and the remedy is
blocked.** The committed supplement records that **no subscription key exists anywhere in the
repo**, that the inventory is **63** endpoints rather than ~35, and — decisively — that running
the code-list extraction over the operational specs "returns **nothing**… the operational
vocabulary is **not merely unfetched but unpublished**", with no event-code lookup path in any of
the 24 documents. Atlas A3/A5/A9 C2 are corrected to **1**. So: every Atlas-derived element in
this document — `EXTDate`, `CustomerETA`, the five-tense stop, `agreedFromDate`/`agreedToDate` —
**is** column-name evidence, permanently, from this source. The rules that rested on them are
re-sourced above ((b)(6) to DP3 ToS, (b)(7) to X12 1651 + Shippeo + DTR, `COMMITTED` to SCRDM +
SIRVA + 400NG). No claim here is scheduled for resolution by an Atlas fetch, and none may be.

---

## 8. Acceptance — the nine scenarios, run explicitly

Each scenario is run against **this document's decisions** (time, provenance, corrections) plus
the shared layer it now conforms to. Where the expression depends on a structural decision that
belongs to another document, that is said rather than glossed. **[R1: could not]** marks the four
that revision 1 could not express.

### 8.1 Five families' goods on one van over four days — **expressible**

Five shipments, one trip. Nothing in the time/provenance layer is shipment-rooted any more, so:

- each family's delivery spread is an Assertion, `subject = shipment:S₁…S₅`,
  `type = time.delivery`, `basis = COMMITTED`, `value` a `LocalDateRange` in the
  **destination's** zone — five separate promises that move independently, which is exactly what
  `src:sirva-ade`'s `ALPChanged`-per-shipment models;
- the van's ETA is one Assertion, `subject = trip:T`, `basis = ESTIMATED`, `asOf` required,
  `capturedBy = DERIVED_BY_RULE` or `DEVICE_TELEMETRY`. **[R1: could not]** — revision 1's frozen
  `subject` had no `trip` member, so a trip-scoped ETA was unpublishable;
- a driver change on day 3 is a new `Assignment` interval (A3's structure, per shared §10.1 item
  13), asserted with `subject = assignment:A₂`. Also unpublishable under revision 1's envelope.

Each load act names one shipment as `subject` with the stop and trip in `context[]`. Because
`context[]` is non-authoritative and is never the resolution key, the four days of loading do not
fuse five families' facts.

### 8.2 SIT, delivered six weeks later by a different agent — **expressible**

- **SIT entry date** is `capturedBy = DERIVED_BY_RULE` under **M4**, carrying `{ruleId,
ruleVersion}` and the `eventId`s of its inputs — the TSP's first-available-delivery-date
  assertion, not the arrival (400NG Items 29.4/29.6/17.20; DTR §D.5.b(2) NOTE). A keyed arrival
  date published as the SIT entry date is now a **detectable defect**.
- **Warehouse agent asserts** the `storeIn` **act** (M2 — a human or partner asserter, never a
  device, never the platform) and per-article condition (`type = condition`, `item` grain — 400NG
  Item 17.12.c requires the condition of _each article_ at receipt and at forwarding; and it is an
  `item` subject rather than a Portion because the fact has a value **per article**, shared §5.4).
  **The `storeIn` act and the `sitEntryDate` above are two record types, not one** (shared §5.3):
  M2 governs the act, M4 governs the date, and the two rules only stop contradicting each other on
  that reading. 400NG Item 29.6 / 17.20's "the arrival date must NOT be entered as the SIT entry
  date" is the tariff saying the same thing about the pairing it cares about.
- **Delivery-out by a different agent.** If that agent is on our network, the delivery-out day is
  a Trip with one Stop (shared §8.4) and the acts are ordinary assertions. If it is not — a
  substitute agent, SIRVA's RR19 — it is an `ExternallyPerformedLeg` with `performedBy` a named
  legal party and `authoritativeAsserter` set, and the acts are `capturedBy = PARTNER_ASSERTED`.
  The structural half is shared §8; the provenance half is this document's.
- **If the arrival is later retracted**, the SIT entry date does **not** get corrected by the
  platform. A new derived Assertion plus a new `FactResolved` is published (§5.2, shared §6.6).
  **[R1: could not]** — revision 1's cascade required the platform to correct a
  warehouse-authoritative date, which its own §5.5 and §(c) authority rule forbade.

### 8.3 Delivery attempted twice — absent, then refused for damage, two items short — **expressible**

**[R1: could not.]** Revision 1's `OccurrenceEvent.type = Delivery.Completed` baked the outcome
into the type and carried no per-item grain. Under A-TYPE and shared §2:

```
Assertion type=Delivery  subject=shipment:S  context=[stop:T1]  basis=ACTUAL
  capturedBy=KEYED_BY_PERSON   assertedBy={destinationAgent}     ← M3 forbids a device here
  value.outcome = NOT_COMPLETED
  value.reasons = [{ code=CONSIGNEE_ABSENT, scope=PARTY,
                     attribution={roleClass: customer},
                     remedy={ newWindow: … } }]                   ← Shippeo REN/DAF + required new_slot

Assertion type=Delivery  subject=shipment:S  context=[stop:T2]  basis=ACTUAL
  capturedBy=OBSERVED_BY_PERSON  assertedBy={driver}
  value.outcome = PARTIALLY_COMPLETED
  value.reasons = [{ code=REFUSED_DAMAGE, scope=GOODS, appliesTo=[portion:P1],
                     attribution={roleClass: carrier} },          ← Shippeo REN/AVA
                   { code=SHORT,          scope=GOODS, appliesTo=[portion:P2] }]  ← Shippeo LIV/MQP
```

`P2` is an **ENUMERATED** Portion of two item refs, so when the two items surface in SIT a week
later there is an identity to refer back to. The damage notation itself is a `condition` assertion
at `item` grain, and under §5.3 the customer is a legitimate `assertedBy.role` for it
(`src:cfr-49-375` §375.605(b)).

### 8.4 A reweigh in transit — **expressible, and it is the acceptance test for must-fix #4**

**[R1: could not.]** Revision 1's machinery was time-only; a reweigh is neither a correction (the
first weighing occurred and was recorded correctly) nor a compensate.

```
Assertion type=weight.net  subject=shipment:S  basis=ACTUAL  value={kind:N, lb, 8420}
  capturedBy=KEYED_BY_PERSON  assertedBy={originAgent}  evidence=[document:WT1]
Assertion type=weight.net  subject=shipment:S  basis=ACTUAL  value={kind:RN, lb, 8180}
  capturedBy=KEYED_BY_PERSON  assertedBy={destinationAgent} evidence=[document:WT2]

  → same derived fact key ( shipment:S , weight.net ), hence a contest

FactResolved factRef=( shipment:S , weight.net )  selected=WT2's assertion
  considered=[both]  rule={ruleId: R-WEIGHT-LOWER, ruleVersion: 1}
```

Sourced, **one cite per pairing of weighings** (shared §4.4; revision 2 headed the whole rule with
Item 4 Note 2, which is the duplicate-reweigh rule and does not reach the pairing this scenario
actually shows). This scenario is **original-vs-reweigh**, so its governing cite is **Item 4.11.d**,
"invoice on the lesser weight". The other two: **Item 4 Note 2** for reweigh-vs-reweigh (origin and
destination agents must coordinate and, "if duplicates occur, **DPS must be updated with the lower
of the net reweigh weights**") and **Items 4.9.h-i** for ticket-vs-constructive-weight ("whichever
is less"). Three statements of lower-wins over three different pairs; stating one rule over _any_
two ACTUAL net weights from distinct weighings is **[ORIGINAL]**. The weight kinds are `src:x12-212-trailer-manifest` element 187's
`N`/`RN`, which types a reweigh as a weight kind rather than a separate event. The rule is a
**DoD program rule**, scoped as one by `FactResolved.rule` (shared §4.4), not promoted to a
universal — a commercial tariff may carry a different rule over the same fact class without the
catalog changing shape.

### 8.5 A car on a separate carrier, delivered a week apart — **expressible at this layer**

The cardinality half (a second shipment under the same order) is `fork-order`'s; the routing half
is shared §8's `ExternallyPerformedLeg`. What **this** document supplies and what revision 1
lacked:

- the leg's delivery act is an assertion with `subject = externallyPerformedLeg:L`,
  `capturedBy = PARTNER_ASSERTED`, `assertedBy = {the auto transporter, role: hauler}` —
  **[R1: could not]**, because `externallyPerformedLeg` had no slot in the frozen subject list
  and `PARTNER_ASSERTED` had nothing to attach to;
- the performing party must be a **named legal party with an identifier**, not "a truck we cannot
  see" — `src:dp3-tender-of-service` §B.3.f requires the legal name and US DOT number of the
  service provider actually hauling to be recorded within 2 GBD of origin departure, and
  prohibits double brokering;
- §5.5 gives the leg an `authoritativeAsserter`, so the transporter's delivery date beats our
  planner's `ASSUMED_FROM_PLAN` value — which under **M1** could not have been an ACTUAL anyway.

### 8.6 Cancelled after packing, before loading, materials charged — **expressible at this layer**

- The pack day is a **Trip with one Stop** (shared §8.4), so the pack act has a stop to anchor to.
- `Assertion type=Packing subject=shipment:S basis=ACTUAL outcome=COMPLETED`.
- `Assertion type=Loading subject=shipment:S basis=ACTUAL outcome=CANCELLED` with a reason.
  `CANCELLED` is OTM's `cancelled` (shared §2.2). Revision 1 had no outcome axis at all.
- The materials charge is an assertion with `subject = charge:C` — a first-class aggregate kind,
  not a field under a shipment. **[R1: could not]**: no `charge` member existed in the frozen
  subject list.
- **A useful consequence of §5.1's window predicate:** loading never completed, so the
  §375.401(i) amendment window is still **open**. An amended estimate here is `APPLIED`, not
  `INEFFECTIVE`. The window is a predicate over the event stream precisely so that this case and
  the post-loading case are distinguished by facts rather than by elapsed time.

**What is still owed, and it is not ours.** `fork-order` §5.2 must still say what a shipment
boundary that never acquires its defining document (no BOL was ever issued) _is_. This document
can attach every time, provenance and correction fact to it; it cannot say whether it is a
shipment.

### 8.7 The same arrival asserted differently by the driver's app and the destination agent — **expressible**

**[R1: could not — this is the scenario revision 1 opened with and could not express.]** Under
revision 1, `basis` was "never ACTUAL" and `OccurrenceEvent` had no `supersedes`, no
`competesWith` and no grouping key, so the second party's actual could only be published as a
_second arrival_.

```
type = arrival ; canonical subject FAMILY = stop = {stop, externallyPerformedLeg}
                                            (E-CANON; shared §1.3, §4.3, declared at §4.7)

Assertion type=arrival subject=stop:T basis=ACTUAL value=14:02 ZonedInstant(America/Chicago)
  capturedBy=DEVICE_GEOFENCE     assertedBy={driver}            ← permitted by M5
  assertedAt=14:02  recordedAt=(server)
Assertion type=arrival subject=stop:T basis=ACTUAL value=14:35
  capturedBy=PARTNER_ASSERTED    assertedBy={destinationAgent}  ← still THEIR claim
  assertedAt=17:10  context=[shipment:S]     ← the subject THEY named, kept
                    evidence=[inbound msg]   ← their claim as phrased, kept
                                                (shared §4.6: ingest re-phrased it
                                                 onto stop:T; the boundary did not)
FactResolved factRef=( stop:T , arrival ) subject=stop:T selected=<the DRIVER's>
  considered=[both] rule={ruleId: AUTHORITATIVE-ROLE-AT-INSTANT, ruleVersion: 1}
                                                      ← A8 §5 row 1; A8 §4.2 A8-INSTANT
```

_(Type name per shared §4.7 note 5: the vocabulary member is `arrival`. `time.arrival` was this
document's own spelling and is withdrawn — the dotted form survives only where the vocabulary
declares a sub-kind, as in `weight.net`.)_

Three things make this work and each was missing in revision 1: `basis = ACTUAL` on an assertion
(§(a) decision 1); `FactResolved` over any fact class with `considered[]` retained (§(b)(4)); and
**E-CANON**, which is what answers the critique's sharper point — that A3 puts the two claims on
_different subjects_ (stop vs shipment) so a rule keyed on (subject, milestone) would never pair
them. The key is the derived fact key `(subject, type, qualifier?)`, and the canonical subject
**family** is **declared per `type`** — at shared §4.7 — **and enforced at the boundary**, not
inferred.

**How the agent's claim got onto `stop:T`, corrected** _(shared §4.6; this document's revision-3
wording said two opposite things in one clause and is withdrawn)_. The boundary does **not** re-key.
The destination agent submitted `subject = shipment:S`; that record is **refused**, because
`shipment` is not in `arrival`'s family. What is admitted is the record above, and it exists because
**ingest** re-phrased the claim onto the canonical subject **before** the boundary, under a
published, versioned subject-resolution rule that returned **exactly one** candidate stop. The
re-phrasing is ours and is visible — `context[]` keeps the subject they named, `evidence[]` keeps
their message, `capturedBy = PARTNER_ASSERTED` says whose claim it is — while `assertedBy` and
`assertedAt` stay the agent's. Revision 3 wrote that the claim "is **accepted** with the shipment in
`context[]`; it is not silently re-keyed, it is **rejected** at the boundary", which is both
behaviours in one sentence. **Reject is the behaviour; the acceptance is what ingest earns by
resolving the subject, and only when the resolution is unambiguous.**

**The two-candidate case, which this scenario previously did not state.** Split-deliver shipment S
across stop 4 and stop 9 on the same trip, and the agent's unqualified "shipment S arrived" resolves
to **two** candidates. Resolution then **fails on cardinality** — no recency fallback, no
nearest-geofence fallback, no planned-window fallback — the submission is retained with both
candidates and emits an obligation to the agent to name the stop, and the contests over
`(stop:4, arrival)` and `(stop:9, arrival)` run on the driver's assertions alone, with the agent's
claim **absent from `considered[]`** because it never entered a contest. When the stop is supplied,
a new Assertion is minted and `FactResolved` is republished over the enlarged `considered[]`.
Shared §4.6.3 works it step by step and gives the three reasons reject beats re-key. Note the
symmetry the same section draws: a driver's app phrasing `delivery` against `stop:T` is refused just
as firmly, because `delivery`'s family is `goods = {shipment, portion}`.

**Who wins, and why the answer changed.** Revision 3 selected the agent's time under a rule named
`AUTHORITATIVE-ASSERTER-AT-DESTINATION` that nothing defined; §5.5 conceded as much and capped its
own confidence. [`A8` §5 row 1](A8-authority-skeleton.md) now supplies the rule class and gives a
different answer: for `arrival`, the authoritative role is **the role holding custody at that stop**
— here the `Driver`, because the stop is on our trip — and the `DestinationAgent` is **`competing`**,
i.e. eligible to win only where a published value rule says so (A8 §4.1). **So the driver's 14:02 is
selected and the agent's 14:35 is not**, which is the opposite of what revision 3's example wanted
and is the point: the answer now comes from a table rather than from the example. If the catalog
wants the agent's keyed time to win — and there are real grounds, since a geofence witnesses a
vehicle and not a delivery — it must **publish a value rule for that fact class and name it**
(A8-NAMED); it may not be arranged by picking a rule id that sounds right. Per A8 §10 the table is
**medium**, so §7's cap on (b) moves and does not disappear.

The two clocks that make the disagreement legible rather than merely contradictory are
`assertedAt` (14:02 vs 17:10 — the agent keyed it three hours later) and `recordedAt`. That is
Shippeo's `date`/`input_date` pair doing exactly the job its worked example describes — and it is
also why A8-INSTANT keys authority to the instant the fact is _about_ and never to either of them.

### 8.8 A mid-journey custody handoff — **expressible, with one honest gap**

- The handover is a pair of act assertions — `src:stedi-x12-reference` element 1650's `J1`
  Delivered to Connecting Line / `R1` Received from Prior Carrier — each `capturedBy ∈
{KEYED_BY_PERSON, PARTNER_ASSERTED}` under **M2** (custody handed over is on the
  possession-changing list).
- `custodyBasis` is `src:uncefact-rec24`'s **41** `Handed_over_under_continued_responsibility` vs
  **349** `Handed_over` — the one real distinction Rec 24 draws here, and it decides whether the
  authoritative asserter actually moves.
- **The asserter-of-record changes** — §5.5, materialised as `FactResolved.rule` and, on an
  `ExternallyPerformedLeg`, as `authoritativeAsserter`.
- **What is published, and it is not a `custody` fact.** Revision 3 wrote that this document "can
  assert a `custody` fact over the interval with `subject = shipment:S` and the two legs in
  `context[]`". **There is no such `type` and there will not be one** (shared §4.7.3, §10.3 item 22):
  `custody` is not a member of the published record vocabulary, so **E-TYPE** rejects it. What is
  published is the pair of **`handover`** assertions already named above — `type = handover`, subject
  in the `goods` family, the two legs and the releasing/receiving `partyRole`s in `context[]`,
  `custodyBasis` ∈ 41 | 349 — and those are attributed and corrected like any other fact. **Who holds
  the goods across the dwell is the fold `custodyAt(goods, instant)`** (shared §4.8.3), which is
  **computed, not asserted**, and therefore not attributed and not corrected. Where only one of the
  two handovers has been published the fold returns **`UNKNOWN`** and does not fall through to the
  last known holder.
- **The gap, stated plainly, and it is unchanged.** **Whether that dwell is a `stay`, a SIT
  occupancy, or neither is A5's question and is not answered here or in the shared layer** (shared
  §10.4 lists it as not settled). What the shared layer guarantees is that `stay` is an aggregate
  with its own subject kind, so whatever A5 decides, the interval's identity has an owner — and the
  fold is deliberately indifferent to the answer: it says who holds the goods over the dwell without
  naming what the dwell is.
- **And the confidence consequence:** because this scenario runs on §5.5, which is `[ORIGINAL]`, and
  because [`A8`](A8-authority-skeleton.md) caps **its own** table at **medium** (A8 §10's last row,
  and only for the classes in its §5), (b) is capped at medium-high in §7. _Revision 3 rested this on
  "A8 is unwritten"; A8 exists, and the cap moved to A8 §10's medium rather than disappearing — §5.5
  and §7 row (b) now say the same thing._ The critique's mis-scoring charge is accepted in full.

### 8.9 A partial load under one bill of lading — **expressible**

One `Loading` act, `subject = shipment:S`, `outcome = PARTIALLY_COMPLETED`, one reason
`OVERFLOW` whose `appliesTo` names a **MEASURED** Portion — `src:sirva-ade`'s `Overflow` event
carries a `Weight` and nothing else (SOE p.19), which is exactly a measured subset. Under
**P-MEMBER** that Portion can later become `ENUMERATED` without changing its `portionId`, so when
the overflow is delivered separately the two acts name the same subset.

**There is no `quantity` field on any act** (shared §3.3): a quantity floating on an act is a
measure with no identity, so a second act could not say "the same part". This is the resolution of
cross-document conflict #3 — revision 1's contribution to that conflict was an `item` subject on
an event, which survives (an `item` subject kind exists, and an ENUMERATED Portion of one item is
legal) but is no longer the sub-shipment grain.

### 8.10 Scoreboard

| #   | Scenario                                             | Revision 1 | Revision 2                                                                              | What made the difference                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Five families, one van, four days                    | partial    | **yes**                                                                                 | `subject` re-opened to `trip` / `assignment`                                                                                                                                                                                                                               |
| 2   | SIT, delivered out six weeks later by another agent  | partial    | **yes**                                                                                 | M4 derived SIT date; cascade is a new derivation, not a correction; `ExternallyPerformedLeg`                                                                                                                                                                               |
| 3   | Two delivery attempts, refused-for-damage, two short | **no**     | **yes**                                                                                 | A-TYPE + `(outcome, reasons[])` + ENUMERATED Portion                                                                                                                                                                                                                       |
| 4   | Reweigh in transit                                   | **no**     | **yes**                                                                                 | Generic `Assertion` over any fact class + `FactResolved` + R-WEIGHT-LOWER                                                                                                                                                                                                  |
| 5   | Car on a separate carrier a week apart               | **no**     | **yes** (routing per shared §8)                                                         | `externallyPerformedLeg` as a subject; `PARTNER_ASSERTED`                                                                                                                                                                                                                  |
| 6   | Cancelled after packing, materials charged           | partial    | **yes** (boundary question is `fork-order`'s)                                           | `charge` subject kind; `CANCELLED` outcome; window predicate still open                                                                                                                                                                                                    |
| 7   | One arrival, two parties, two times                  | **no**     | **yes**, and the resolution story is now written both ways — one candidate stop and two | `basis = ACTUAL` legal; `FactResolved`; E-CANON **reject-not-re-key** + the ingest-side subject-resolution rule with its cardinality gate (`[SD §4.6]`); the winner comes from [`A8` §5 row 1](A8-authority-skeleton.md) rather than from a rule id this document invented |
| 8   | Mid-journey custody handoff                          | partial    | **Expressible — dwell classification deferred to A5, custody authority deferred to A8** | `custodyBasis`; §5.5 given a home; M2. Common label per shared §10.5 — A3, `fork-order` and this document were saying the same thing in three different words.                                                                                                             |
| 9   | Partial load, one BOL                                | partial    | **yes**                                                                                 | One sub-shipment grain (Portion), no `quantity`                                                                                                                                                                                                                            |

---

## 9. Changed in revision

Everything below moved because of [`round-2-critique.md`](round-2-critique.md) and
[`00-shared-decisions.md`](00-shared-decisions.md) §10.3. Items marked **(disagree)** are where
this document argues back while still making the change the shared layer requires.

**Structural reversals (the shared layer outranks this document):**

1. **`subject` re-opened to any aggregate kind.** Revision 1 froze it as "shipment / stop /
   service / item (addressable below the shipment)". That made trip-, assignment-, order- and
   charge-scoped facts permanently unpublishable — the critique's only "genuinely unrecoverable"
   item. §1, §(c)'s last discipline, and scenarios 8.1, 8.5, 8.6 all change.
2. **`OccurrenceEvent` abolished; `basis = ACTUAL` is legal.** One record class, the `Assertion`.
   The headline capability of §(b)(3) — two parties assert the same fact differently and the
   catalog keeps both — now has a home for the ACTUAL class, which it did not. Scenario 8.7.
3. **Provenance and resolution extended beyond time to any fact class** (must-fix #4): time,
   measure, count, condition, state, identity, party-role, act performance. Scenario 8.4 is the
   stated acceptance test and it passes.
4. **`outcome` + `reasons[]` on every act; `type` names the act only** (A-TYPE).
   `Delivery.Completed` is now an illegal type name. Scenario 8.3.
5. **One sub-shipment grain, the `Portion`.** Revision 1's `item`-subject survives as a subject
   kind but is no longer the grain. Scenario 8.9.

**Re-citations — claims the critique called unsupported:**

6. **The `basis` enum.** `REQUESTED` and `ESTIMATED` are **`src:dcsa`'s** `REQ`/`EST`, not
   SCRDM's. Revision 1 attributed the whole enum to SCRDM and half of it was wrong.
7. **`COMMITTED`.** Re-sourced to `src:uncefact-scrdm`'s definition + **`src:sirva-ade`'s** ALP/ADP
   and Will-Advise (grade A, live partner contract) + `src:dp3-400ng`'s five delivery-date roles.
   Revision 1's "only SCRDM and Atlas distinguish them" is withdrawn; Atlas's field pair is not
   decisive for anything.
8. **Three clocks.** Re-cited and **re-rated high → medium-high**. Only `src:shippeo` and the 858
   carry three; EPCIS supplies the conformance rule and carries two; p44 and Alvys corroborate the
   split only. The revision-1 claim that Alvys "confirms the three-clock split independently" is
   withdrawn.
9. **`MilestoneTimeSelected` → `FactResolved`**, and its "two upgrades p44 lacks" marked
   **[ORIGINAL]** at the point of use and entered in §7's table. The rename is substantive: the
   old name asserted a time-only scope.
10. **The `assertedBy.role` HHG vocabulary** re-cited to `src:sirva-ade`'s cast (`Resource.Type`
    GSD p.9 / SOE p.6; `ServiceProviderFunction` GSD p.26) at the point of use, with `customer`,
    `account/RMC` and `platform` marked **[ORIGINAL]**, and **X12 element 98 recorded as still
    unread** and promoted to the highest-value unread item in §7.
11. **§(b)(7)'s "attribution belongs on the assertion" withdrawn** as a placement rule no source
    states. Attribution moves to the `Reason` (shared §2.4 rule 6). What remains sourced — that
    reason vocabularies are party-organised — is retained with its cites.
12. **§(b)(6)'s weighting reversed**: the notification duty is `src:dp3-tender-of-service`'s and
    carries the rule; Atlas's `CustomerETA`/`EXTDate` is column-name corroboration.
13. **Every Atlas-derived element re-cited as column-name evidence** (§7), and the
    **`/Types` falsification condition deleted** — no key exists in the repo, the operational
    vocabulary is unpublished rather than unfetched, and A3/A5/A9 C2 are corrected to 1. No claim
    here is scheduled for resolution by an Atlas fetch.

**Rule fixes:**

14. **(b)(5) re-cut by capture method (M1–M7).** **(disagree)** — the critique says revision 1
    "forbids the harmless case (a geofence marking arrival)"; it did not, that was explicitly
    permitted. The substantive half is accepted: the rule was bound to "a device" while the case
    it exists for, `ASSUMED_FROM_PLAN`, is not a device and was unguarded. **M1** now forbids
    `ASSUMED_FROM_PLAN` at `basis = ACTUAL`.
15. **The Shippeo geofence cite scoped, and the direction stated.** **(disagree on the word)** —
    our rule is **stricter** than the source, not more permissive, so "over-read" mis-describes
    it; but the disclosure defect is real and is fixed: the extension is marked `[ORIGINAL]`, and
    the `P44_DETECTED` inconsistency the critique spotted is resolved (a derived exception is a
    prompt or an `ESTIMATED` assertion, never an ACTUAL exception).
16. **M4 added: the sanctioned derivation** (SIT entry date, 400NG + DTR), which revision 1's
    blanket rules had no carve-out for.
17. **§(c)'s two incompatible retraction semantics fixed.** EPCIS's no-replacement rule kept; the
    858's restore-to-previous dropped as a mechanism and kept as an intent, achieved by
    republishing `FactResolved`. The critique's point that retract-to-previous silently promotes
    another party's assertion is recorded in the text.
18. **§5.1 replaced.** "Refused rather than recorded" is withdrawn as an over-read of
    §375.401(i). Corrections now carry `outcome ∈ APPLIED | INEFFECTIVE | UNAUTHORISED`, always
    recorded, never applied to the priced record when ineffective, always emitting the §5.4
    obligation. The §5.1/§5.4 contradiction is resolved.
19. **§5.2's cascade is no longer a correction** — a new derived Assertion plus a new
    `FactResolved`, which the platform has authority to publish. The three-rule collision the
    critique found on the SIT case is dissolved.
20. **§5.5 given a home and a consequence**: it is the rule class named by `FactResolved.rule`,
    and the `authoritativeAsserter` on an `ExternallyPerformedLeg`. **§7's HIGH on (b) is capped
    at medium-high**, as the critique requires and shared §10.4 reinforces.
21. **A "compensate is not for competing observations" boundary added to §(c)**, which is the
    gap the reweigh fell through.
22. **§5's originality disclaimer re-framed** so it no longer implies that everything outside §5
    is sourced — the inference that let three authored rules pass unmarked.
23. **§6 item 4 narrowed** (M1 closes the dangerous half) and **item 8 added** (whether an
    `INEFFECTIVE` attempt is shown to the customer — the legal-review question §5.1 raises).

**Added:**

24. **§8, the nine scenarios, run explicitly**, with a scoreboard naming the four that revision 1
    could not express and what fixed each.
25. **§0's fourth irreversibility reason**, drawn from the critique's own diagnosis: envelope
    decisions must not be taken as a side effect of a narrower decision. That is why §1's
    envelope is now _used_ here and _decided_ in the shared layer.

**Revision 3 — shared-layer coherence fixes.** None of these changes a decision; each removes a
second way of saying something, or corrects a citation.

26. **One classification axis** (`[SD §1.3]`). The `Assertion` shape block loses
    `factRef {subject, factClass, qualifier?}` and the second `subject` it carried: `type` **is**
    the fact class, `qualifier` is a payload field, and the fact key `(subject, type, qualifier?)`
    is **derived**. Only `FactResolved` spells `factRef` out, because a meta-record's own `type`
    names its record class rather than the fact it is about. Rules (b)(4), (b)(7) and §8.4/§8.7's
    worked records are restated on that basis.
27. **E-CANON restated as a subject _family_** (rules 4 and (b)(4), §8.7): one family per `type`,
    a singleton everywhere except `stop = {stop, externallyPerformedLeg}`. Under revision 2's
    wording E-TYPE licensed a _set_ of legal subject kinds while E-CANON licensed _exactly one_;
    they could not both be true, and the family is what makes them one declaration.
28. **M7 is per `type`**, not per (`type` × `factClass`) — the product's second factor was the
    axis that no longer exists.
29. **M2's list says `storeIn` / `storeOut`, and §8.2 names both record types** (`[SD §5.3]`).
    Revision 2's "placed in SIT / released from SIT" collided head-on with M4's mandatory
    derivation of the SIT entry date. The act and the date are two fact classes — which is what
    400NG Item 29.6 / 17.20's "the arrival date must NOT be entered as the SIT entry date" is
    asserting — so M2 governs the act and M4 governs the date, and neither reaches the other.
30. **`supersedes` has one home** — the typed field on the Assertion. The envelope's generic
    `correlation {corrects?, supersedes?, resolves?, causedBy[]?}` bag is deleted (`[SD §1.1]`);
    it duplicated every per-class link, could not carry the per-class obligations, and `causedBy`
    had no user in the corpus. Evidentiary back-pointers are `evidence[]`, which already exists —
    §5.4's notification record already used it that way.
31. **Shippeo's counts corrected** (rule 5's evidence row, M3): **38 data rows**, 7 geofence-marked,
    25 non-conform rows and not one of them geofence-marked. "7 of 41" and "24 exception rows" were
    inherited approximations. **The finding is unchanged** — including this document's disagreement
    with the critique's word "over-read", which turns on the _direction_ of our extension and not
    on the row count.
32. **R-WEIGHT-LOWER re-cited per pairing** (§8.4): Item 4.11.d for original-vs-reweigh — which is
    the pairing §8.4 actually shows — Item 4 Note 2 for reweigh-vs-reweigh, Items 4.9.h-i for
    ticket-vs-constructive. Revision 2 headed the rule with Item 4 Note 2 alone.
33. **Scenario 8's scoreboard label aligned** with A3 and `fork-order` (`[SD §10.5]`).

**Revision 4 — E-CANON's boundary behaviour and the canonical-subject table** (`[SD §4.6]`,
`[SD §4.7]`, directed by `[SD §10.3]` items 20-21).

34. **E-CANON is reject, never re-key** (`[SD §4.6]`). Revision 3's §8.7 said the destination
    agent's shipment-level claim "is **accepted** with the shipment in `context[]`; it is not
    silently re-keyed, it is **rejected** at the boundary" — two opposite behaviours in one clause,
    and the half that said _accepted with_ matched shared §4.3's prose and `A3` §3.2 while the half
    that said _rejected_ matched shared §4.3's and §1.3's rule text. **Reject wins.** The boundary is
    structural and refuses; the re-phrasing onto the canonical subject is an **ingest-side** act by a
    named, versioned subject-resolution rule that must return **exactly one** candidate; the
    resulting record keeps the asserter's `assertedBy`/`assertedAt`, the subject they named in
    `context[]` and their message in `evidence[]`. §8.7 is rewritten to say only that.
35. **§8.7 now works the two-candidate case** — a shipment-phrased arrival against a van with two
    candidate stops for that shipment. Resolution **fails on cardinality**: no recency, nearest-
    geofence or planned-window fallback, the submission is retained and emits an obligation, and the
    contest runs without it, the claim absent from `considered[]` because it never entered one. This
    is the half the verifier recorded as missing.
36. **§8.7's winner changed, and not by preference.** Revision 3 selected the destination agent's
    time under `AUTHORITATIVE-ASSERTER-AT-DESTINATION`, a rule id nothing defined.
    [`A8` §5 row 1](A8-authority-skeleton.md) makes the custody-holding `Driver` authoritative for
    `arrival` and the `DestinationAgent` merely **`competing`**, so the driver's geofence time is
    selected under `AUTHORITATIVE-ROLE-AT-INSTANT` unless the catalog publishes and names a value
    rule that lets the competing role win (A8-NAMED).
37. **Type names are shared §4.7's**: `time.arrival` → `arrival` (§8.7). The dotted form survives
    only where the vocabulary declares a sub-kind, as in `weight.net`.
38. **The families are three, not one** (rule 1, rule 4): `stop = {stop, externallyPerformedLeg}`,
    `goods = {shipment, portion}` and `identity` over the whole `aggregate` enum. Shared §4.7 is the
    declaration and this document no longer keeps its own.

**Revision 5 — conformance to the binding layer.** Mechanical; no decision in this document moves.

39. **The A8 cap moved to A8 §10's medium and does not disappear** (`[SD §10.3]`, `[SD §10.4]`).
    §5.5 (_"the general owner of custody authority is A8's, which is not written, and no document may
    score a dependent decision high until it is"_) and §7's row (b) (_"A8 is unwritten"_) still capped
    against A8's **nonexistence**, while §8.7 of this same document already cited
    [`A8` §5 row 1](A8-authority-skeleton.md), A8 §4.1, **A8-NAMED** and A8 §10's medium. **Two
    readings made one:** A8 exists and supplies the rule class, A8-INSTANT, A8-MOVE and the
    eleven-class table; **A8 §10's last row caps A8's own contribution at _medium_, and only for the
    classes in its §5** — so medium is available, **high is still barred**, and a fact class
    `[SD §4.7]` marks **owed** gains nothing at all. (b) stays at **medium-high**, now resting on A8
    §10 rather than on an absence. §8.8's third instance of the same sentence is corrected with them.
40. **§5.5 loses the word "current"** (`[SD §10.3 item 23]`). "The authoritative asserter given the
    **current** custody state" had no referent in the envelope. It is now _the custody state **at the
    instant the fact is about**_, which is the fold `custodyAt(goods, instant)` (`[SD §4.8.3]`)
    evaluated per **A8-INSTANT**. Keying on the present is the recency failure §5.5 exists to close.
41. **There is no `custody` fact class** (`[SD §4.8]`, `[SD §4.7.3]`, `[SD §10.3 item 22]`). §8.8's
    _"this document can assert a `custody` fact over the interval with `subject = shipment:S`"_ was
    **unpublishable as written** — `custody` is not a member of the record vocabulary, so E-TYPE
    rejects it. What is published is the two **`handover`** assertions (`type = handover`, subject in
    the `goods` family, the legs and the releasing/receiving `partyRole`s in `context[]`,
    `custodyBasis` ∈ 41 | 349); **who holds the goods across the dwell is the fold
    `custodyAt(goods, instant)`, computed rather than asserted, and therefore neither attributed nor
    corrected**, returning `UNKNOWN` where only one handover has been published. The rest of §8.8 is
    unaffected: the dwell's _classification_ is still A5's, the honest gap is still honest, and
    `stay` still owns the interval's identity whatever A5 decides.

**Conformed to binding layer rev 5** (`00-shared-decisions.md`, revision 5).
