# 00 — Shared decisions: the cross-cutting layer

**Status: binding. This document OUTRANKS `A3-trip-stop-assignment.md`,
`fork-order-shipment-cardinality.md` and `fork-time-provenance-corrections.md`.** Where any of
those three conflicts with this file, this file wins and that document is to be revised to
conform. Section 10 lists, per document, exactly what must change.

**Why it exists.** The three decision documents were written in parallel and each assumed a
different answer to the same cross-cutting mechanisms. [`round-2-critique.md`](round-2-critique.md)
found eight such conflicts and named the event envelope "the only genuinely unrecoverable item."
The items below are settled here, once, for everything.

**Revision 3** closes the internal-coherence defects found in _this_ file — defects in the shared
layer itself rather than conflicts between the other three. In order of how much they block:

|       | Was                                                                                                                                                                                         | Now                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | two classification axes (`type` constrained by E-TYPE, `factRef.factClass` by E-CANON, M7 declaring eligibility over their product) with neither defined for the other's half of the corpus | **one axis.** `factClass` subsumes `type`; the fact key is derived; E-TYPE, E-CANON and M7 restated against that one answer — **§1.3**                              |
| **B** | `subject` in two places, the envelope's and `factRef`'s, with no rule that they match                                                                                                       | **one `subject`**, the envelope's. `factRef.subject` deleted — **§1.3**                                                                                             |
| **C** | `supersedes` in two places, envelope `correlation` and a top-level Assertion field                                                                                                          | **the typed per-class field.** The `correlation` bag is deleted — **§1.1**                                                                                          |
| **D** | arity keyed on `(subject, scheme, scope)`, `primary` resolved on `(subject, scheme)`                                                                                                        | **I-KEY**: both on `(subject, scheme, vocabularyScope)`; the two `issuer` fields split into `issuer` and `vocabularyScope.authority` — **§7.1**                     |
| **E** | M2 required a human asserter for "placed in SIT"; M4 required the SIT entry date to be derived                                                                                              | **two fact classes**, `storeIn` and `sitEntryDate` — which is what the 400NG's "the arrival date must NOT be entered as the SIT entry date" is asserting — **§5.3** |
| **F** | "an `ENUMERATED` Portion of one item is legal" and "`item` remains a subject kind", with no test between them                                                                               | **one test**: value-per-article → `item`; scope-of-an-act → `Portion`, even of one — **§5.4**                                                                       |
| **G** | citation errors inherited by all four documents                                                                                                                                             | corrected at §2.1, §2.2, §2.4, §4.1, §4.4, §5.2 M3 and §8.4, with a common scenario-8 label at §10.5                                                                |

Nothing in revision 3 changes a decision. A–F remove a second way of saying something, and G
corrects arithmetic and attribution without disturbing a finding.

**Revision 4** closes the verifier's second blocker — _"the single highest-leverage unwritten thing
in the model"_ — by settling E-CANON's boundary behaviour and publishing the per-type declaration it
has always presupposed.

|       | Was                                                                                                                                                                                                                                                                       | Now                                                                                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H** | two published behaviours for a non-canonical subject — §4.3's prose and `A3` §3.2 said the destination agent's shipment-phrased arrival "resolves to that stop"; `fork-time` §8.7 said a non-canonical subject "is not silently re-keyed, it is rejected at the boundary" | **reject.** The boundary is structural and refuses; re-phrasing is an ingest-side act by a **named resolution rule that must return exactly one candidate**; a rejection emits an obligation. The hard case — a shipment-phrased arrival against a van with **two** candidate stops — is worked end to end — **§4.6** |
| **I** | E-CANON declared a canonical subject family per `type`, and no document published the declaration for any `type`; each of the four restated a few from memory, in three spellings                                                                                         | **the canonical-subject table** — every fact class named across the four documents, with its family, its `qualifier`, its `context[]`, its authoritative role from `A8` and its `boundBy` — **§4.7**                                                                                                                  |
| **J** | "only two families are non-singleton", followed by one family and "nothing else"                                                                                                                                                                                          | **three exceptions, named**: `stop = {stop, externallyPerformedLeg}`, `goods = {shipment, portion}`, and `identity` over the whole enum — **§1.3, §4.3, §4.7**                                                                                                                                                        |

H is a decision and is recorded as one; I and J are the declaration H needs in order to be checkable.
Two consequential corrections fall out of writing the table and are marked at **§4.7.2**: `pieceCount`
and `charge` each need a `qualifier`, and the second of those corrects [`A8` §5 row
11](A8-authority-skeleton.md).

**Revision 5** closes the two items the verifier found still open after revision 4, and completes the
conformance lists so the next agent can apply them mechanically.

|       | Was                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Now                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K** | §4.7 claimed to declare "every fact class named across the four documents", and §4.7.3 claimed to list what is deliberately absent — but neither covered the three aggregates §1 exists to make first-class: the trip-scoped class, the `stopAction` membership lifecycle, the `assignment` lifecycle. Under **E-CANON-STRICT** a record whose subject is not in a declared family is unpublishable, so the omission made `A3`'s own trip-scoped and membership records **impossible to publish** | **nine members added to §4.7.1 in three row-groups**, their subjects quoted from [`A3` §3.2](A3-trip-stop-assignment.md)'s table, their `qualifier` and `context[]` decided here, and their authority marked **owed** against [`A8` §9 item 8](A8-authority-skeleton.md) rather than invented — **§4.7.1, §4.7.2d** |
| **L** | `Custody` was an **entity** in `A3` §3.2/§5.2, a **fact class** in `fork-time` §8.8, and a **projection** in `A8` §4.2/§7.4 — three answers — while appearing in none of this document's structures (§1.2's enum, §1.3's vocabulary, §4.7, §4.7.3), even though `boundBy = CUSTODY` is what eight of `A8` §4.3's fact classes are bound by                                                                                                                                                        | **a projection**, folded from the `handover` assertions §4.7 already declares plus `ExternallyPerformedLeg.custodyBasis`. Not an aggregate, not a `type`. `boundBy = CUSTODY` now names a function over published records — **§4.8**                                                                                |

K adds no requirement: it publishes families for records three documents already specify. L is a
decision, and it is the one that makes `boundBy = CUSTODY` resolvable against the envelope.

**Two gaps revision 5 left in its own declaration, closed within the same revision and adding no
requirement to either.** (i) K published families for nine records but not for the **order**
lifecycle that §1's own opening paragraph and [`fork-order` §3.1](fork-order-shipment-cardinality.md)
require — K's defect, one aggregate to the left. Three members are minted at **§4.7.1** and argued at
**§4.7.2e**. (ii) §2.5's A-TYPE example named `weighing` as a legal act type, which §4.7.1 does not
declare; `weighing` and `unpacking` are recorded as **absent and owed** at **§4.7.3**, with the
argument for minting them stated there, and the example is corrected to name only declared members.
Neither item changes a decision; both make §4.7.1's "complete declaration" claim true.

---

## 0. Rules this document is written under

**Scope.** The model is an **ideal target** model of the household-goods moving & storage domain,
built from **external sources only** ([`README.md` § What this model is](../README.md),
[`rubric.md`](../rubric.md) S5 note). Our own systems — `packages/domain`, the Prisma schema, the
integration floors, the pegII order shape, the long-haul app, our integration configs — are
`role: mapping-only` in [`registry.yaml`](../sources/registry.yaml) and are **not evidence**.
Partner contracts (`src:weichert-supplier-api`, `src:sirva-ade`, `src:atlas-world-group-api`) **are**
external evidence: they describe how counterparties behave. **Rubric S5 is withdrawn.** Nothing
here is designed for migration from anything we own.

**Disclosure.** Every claim below either (a) cites a source that says **that** thing, or (b) is
marked **[ORIGINAL]** inline, at the point of use. A source that says something narrower than the
claim does not support the claim, and where a source supports only part of a rule, the supported
part and the authored part are separated in the text. Marking something ORIGINAL is not a defect.
Presenting an authored rule as sourced is the defect the critique found, and it is what this
discipline exists to stop.

**A third mark, `[SYNTHESIS]`,** is used where two or more sources each supply half of a shape and
the join is mechanical rather than inventive. A synthesis is not an original design and must not
be written up as one — but the join itself is still named, so a reader can check it.

**Atlas is blocked.** No `Ocp-Apim-Subscription-Key` exists anywhere in the repo; the QA key was
issued admin-side and deliberately never committed
([`analysis-supplement-vocabulary.md` §1](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md)).
Atlas's operational vocabulary is **not merely unfetched but unpublished** — running the
code-list extraction over `atlasorder-v1.json` and `shipment-management-v1.json`'s operational
schemas "returns nothing", and no event-code lookup path exists in any of the 24 documents (§2.2).
Atlas A3/A5/A9 C2 are corrected to **1**. **No claim in this document is scheduled for resolution
by fetching Atlas `/Types` endpoints, and none may be.** Section 9 re-cites every Atlas-derived
element used here.

---

## 1. The envelope, and `subject`

> **Decision. Every record the catalog publishes carries one envelope. `subject` is a single
> typed reference to any one aggregate — never a path, never shipment-rooted. Records that are
> _also_ about other aggregates say so in a separate, explicitly non-authoritative `context[]`.**

This is the item that cannot be fixed in a later release. `fork-time` froze `subject` as
"shipment / stop / service / item (addressable below the shipment)"; `A3` requires trip-scoped
events with no shipment on them (§5.9), a membership lifecycle (§5.8) and an assignment lifecycle
(§3.2); `fork-order` requires an order with its own award/accept/decline/cancel lifecycle. Two of
the three aggregates the other documents need have no slot in the envelope the third froze.

### 1.1 The envelope, field by field

| Field         | Type                                                        | Obligation                                                    | Notes                                                                                                                                            |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `eventId`     | our id, globally unique, never reused                       | **MANDATORY**                                                 | Distinct on a correction — see 6.4.                                                                                                              |
| `type`        | a member of the one published record vocabulary             | **MANDATORY**                                                 | The **single** classification axis. On an Assertion this value **is** the fact class. Names the act or fact, never the outcome. See 1.3 and 2.5. |
| `specVersion` | the catalog vocabulary version this record was minted under | **MANDATORY**                                                 |                                                                                                                                                  |
| `subject`     | `SubjectRef` — exactly one                                  | **MANDATORY**                                                 | The one aggregate this record asserts about, and — on an Assertion — the subject of the fact itself. There is no second subject. See 1.2–1.4.    |
| `assertedBy`  | `{partyRef, role}`                                          | **MANDATORY**                                                 | Role rides on the assertion, not the party.                                                                                                      |
| `assertedAt`  | instant                                                     | **MANDATORY**                                                 | The asserter's act of saying it.                                                                                                                 |
| `capturedBy`  | `CaptureMethod` (7 members, §5.1)                           | **MANDATORY**                                                 | How the value was obtained.                                                                                                                      |
| `recordedAt`  | instant                                                     | **server-authored; FORBIDDEN on capture, MANDATORY on query** |                                                                                                                                                  |
| `context[]`   | `SubjectRef[]`                                              | OPTIONAL                                                      | Other aggregates this record is also about. **Non-authoritative.** See 1.4.                                                                      |
| _payload_     | typed per `type`                                            | per type                                                      | Carries `basis`, `value`, `qualifier`, `outcome`, `reasons[]`, `supersedes` etc. as the record class requires.                                   |

**Forbidden on the envelope, permanently:**

- **A second `subject`.** One record, one subject — and on an Assertion the envelope `subject` _is_
  the subject of the fact being asserted (§1.3). Multi-subject records, and a second subject hidden
  inside the payload, both make the resolution rule (§4.3) undecidable.
- **A second classification axis.** One record, one `type` (§1.3). A record that could be filed
  under two independent vocabularies cannot be the basis of ubiquitous language, and the two
  constraint rules (E-TYPE, E-CANON) would have nothing to agree about.
- **A subject _path_** (`shipment/…/stop/…`). A path presumes a containment hierarchy, and the
  hierarchy is exactly what the three documents disagree about.
- **A tense qualifier.** Tense lives on the time _value_ as `basis` (§4.2). `fork-time`'s
  decision on this point is upheld and is the one cross-cutting decision of the three that
  survives unchanged.
- **A mutable current-state field.** The catalog publishes assertions; state is a projection.
- **A generic `correlation` link bag.** An earlier draft of this table carried
  `correlation {corrects?, supersedes?, resolves?, causedBy[]?}` alongside the same links as typed
  fields on the record classes that own them. Two homes for one link is the same defect as two
  homes for `subject`. **The typed per-class fields win and the bag is deleted:**
  `Assertion.supersedes` (§4.1), `Correction.corrects` (§6), `FactResolved.selected` /
  `considered[]` (§4.3). Reason: each carries a per-class obligation a generic bag cannot state —
  `corrects` is MANDATORY on a Correction, `supersedes` is constrained to the **same party** and the
  **same fact key** — and `causedBy` had no user anywhere in the corpus. Where one record's relevance
  to another is evidentiary rather than structural (the notification that carries an ETA; the weight
  ticket behind a weighing), the link is `evidence[]` (§4.1), which already exists and already
  carries the right meaning.

### 1.2 `SubjectRef`

```
SubjectRef { aggregate, id }
```

`aggregate` is a **versioned closed enum**, open to _addition_ in a later `specVersion`, never to
reinterpretation:

`order` · `shipment` · `portion` · `stay` · `trip` · `stop` · `stopAction` · `assignment` ·
`partyRole` · `item` · `charge` · `resource` · `document` · `externallyPerformedLeg`

Eleven of these are the set the critique requires (must-fix #1). Three are added here:

- **`resource`** — a vehicle, trailer, driver or crew member. Required because `A3`'s `Assignment`
  binds a resource to a trip and an equipment identifier must attach to the equipment
  (`src:x12-212-trailer-manifest` `MS2`: owner SCAC + **owner-assigned** equipment number + check
  digit, "equipment identity is owner-scoped"). Without it, §7's equipment grain has nothing to
  attach to.
- **`document`** — A6 is not written, but weight tickets, the BOL and the inventory are asserted
  about and evidenced against, and 400NG Item 4.10 makes a weight ticket a six-field record with
  its own retention rules. **[ORIGINAL]** as an envelope decision; A6 may narrow it, never remove it.
- **`externallyPerformedLeg`** — see §8.

**A shipment is not privileged.** It is one member of this enum. An order-scoped, trip-scoped,
assignment-scoped or charge-scoped record is a first-class record with no shipment on it at all.

**`custody` is deliberately not a member, and its absence is a decision rather than an omission.**
`A3` §3.2 models `Custody` as a stored interval hanging off the shipment. It is not an aggregate
here: it is a **projection** folded from the `handover` assertions the record vocabulary already
carries (§4.7) and from `ExternallyPerformedLeg.custodyBasis` (§8.2). **§4.8** is the decision, and
it is what `boundBy = CUSTODY` resolves against.

### 1.3 One classification axis: `type` **is** the fact class

> **Decision. `type` and `factClass` are not two axes. They are one, and `factClass` is the name
> for what it holds on an Assertion. `factClass` subsumes `type`: the published record vocabulary
> has one member per fact class plus one member per meta-record class, and a record's `type` is
> exactly one member of it. There is no `factRef.factClass` field and no `factRef.subject` field.**

The previous revision carried the two as independent axes: a mandatory envelope `type` constrained
by E-TYPE, a mandatory `factRef.factClass` constrained by E-CANON, and M7 declaring capture
eligibility per (`type` × `factClass`) — while §4.1 said that for an act the factClass simply **is**
the performance of the act, and left `type` undefined for weight, identity and condition facts. Two
axes where one was defined for half the corpus and the other for the other half. **Ubiquitous-language
work names record types; it cannot begin on two competing axes.** Settled as follows.

**1. The vocabulary.** The catalog publishes **one** versioned record vocabulary. Its members are:

- one member per **fact class** — `arrival`, `departure`, `delivery`, `loading`, `storeIn`,
  `sitEntryDate`, `weight.net`, `pieceCount`, `condition`, `identity`, `notification`,
  `partyRole`, the nine aggregate-lifecycle members added at §4.7.1 (`tripDelay`,
  `tripResequence`, `tripCancellation`; `membershipOffer`, `membershipResponse`,
  `membershipRelease`; `assignmentOffer`, `assignmentResponse`, `assignmentRelease`), and the
  three **order-lifecycle** members added at §4.7.1 (`orderAward`, `orderResponse`,
  `orderCancellation`), … (the families are enumerated at §4.1; **§4.7.1 is the complete
  declaration** and this list is an index into it);
- one member per **meta-record class** — `FactResolved` (§4.3) and `Correction` (§6).

**2. On an Assertion, `type` is the fact class.** The two names denote one value. An act record is
an Assertion whose `type` is the act (`delivery`), whose `value` carries `{occurredAt, outcome,
reasons[]}` (§2), and which therefore needs no separate act-vs-fact distinction anywhere in the
envelope. A weight assertion's `type` is `weight.net`; an identity assertion's `type` is `identity`.
The gap that left `type` undefined for weight, identity and condition is closed by naming those
classes in the same vocabulary as the acts, not by adding an axis. **Where the three decision
documents write `factClass`, read `type`.** The word `factClass` is retained only as prose for "the
value of `type` on an Assertion", because it reads better in rules about contested facts.

**3. The fact key is derived, not stored.** `factRef` is **not a field**. It is the key

```
factRef = ( subject , type , qualifier? )
```

computed from fields the record already carries — the envelope `subject` (§1.1), the envelope
`type`, and an optional payload `qualifier` whose shape each type declares (§4.1). This is what
resolves the second defect as well: the envelope `subject` and the old `factRef.subject` were
**always the same value**, so one of them is deleted, and it is the nested one. Competing assertions
pair on this key (§4.3).

`qualifier` exists for the types where one fact class legitimately covers several
independently-contested facts about one subject. The worked case is `identity`: its declared
qualifier is `{scheme, vocabularyScope}`, which is why identifier arity and `primary` both key on
`(subject, scheme, vocabularyScope)` (§7.1, §7.5) — that is not a special rule for identifiers, it is the
general key with `identity`'s declared qualifier substituted in. A type that declares no qualifier
has none, and its fact key is `(subject, type)`.

**4. On a meta-record, `type` names the record class and the fact key is carried explicitly.**
`FactResolved` carries `factRef` as an explicit tuple (the contested fact); `Correction` carries
`corrects`, an eventId. In both cases the envelope `subject` MUST equal the subject of the fact
being resolved or corrected, so the "one record, one subject" rule holds unchanged across all three
record classes.

**5. The two constraint rules, restated against this one answer.** They are now a division of
labour over one axis rather than two rules over two axes:

> **Rule E-TYPE (restated). Every record carries exactly one `type`, drawn from the one published
> record vocabulary. A record carrying no `type`, a `type` outside the vocabulary for its
> `specVersion`, or any second classification alongside it, is rejected at the boundary.**

> **Rule E-CANON (restated; full statement at §4.3, boundary behaviour at §4.6, the per-type
> declaration at §4.7). Every `type` declares exactly one canonical subject **family**, and a family
> is a named, closed set of `aggregate` kinds — usually a singleton. An Assertion whose `subject`
> kind is not in its type's declared family is **rejected at the boundary, not re-keyed** — and the
> boundary never substitutes a subject the record did not name (§4.6, E-CANON-STRICT).**

E-TYPE governs the vocabulary; E-CANON governs the subject. Nothing is declared twice. The
**family** is what lets E-CANON be "exactly one" and still admit the cases the model needs: the
`stop` family is `{stop, externallyPerformedLeg}` (§8.2 declares `ExternallyPerformedLeg` to be in
the stop family for exactly this reason), the `goods` family is `{shipment, portion}` (§3.3 licenses
a separately-timed act to name a Portion directly), `identity`'s family is the whole `aggregate` enum
(§7.1), and every other family is a singleton. **§4.7 is the complete, per-type declaration**; no
other document may declare a family. Under the previous wording E-TYPE licensed a _set_ of legal
subject kinds and E-CANON licensed _exactly one_; they could not both be true. They are now one
declaration with one arity.

**6. Consequence for M7.** M7's "per (`type` × `factClass`)" was a product of two axes and is
restated as **per `type`** at §5.2. No capture-eligibility declaration loses any expressiveness,
because the product had exactly one non-degenerate factor.

Precedent for the _shape_ of a per-type envelope constraint: `src:dcsa` constrains
`eventClassifierCode` per event type — "For `ShipmentEvents` the `eventClassifierCode` **must** be
`ACT`" (`event_domain` L776-781, L866-876, L956-966) — and JIT constrains the classifier by
**party role** as well (`jit/v2`, L3554-3568). **[ORIGINAL]:** applying that constraint mechanism to
the _subject_ field is our step, and so is the collapse to a single axis. DCSA constrains a
classifier, not a subject, and DCSA does carry event type and classifier as two axes — we do not.

### 1.4 `context[]` — the field that makes the conflict disappear

`context[]` carries the other aggregates a record is about: a delivery act's `subject` is the
shipment, its `context[]` names the stop and the trip; a trip-scoped delay's `subject` is the
trip, its `context[]` names every shipment on board.

Three rules make it safe:

1. **`context[]` is never the subject.** A consumer filtering by subject MUST NOT be served
   context matches by default. If it were, the shipment-rooted envelope would reappear as a query
   default.
2. **`context[]` never carries values.** No fact is asserted about a context member.
3. **`context[]` is not the resolution key.** Competing assertions pair on the fact key
   `(subject, type, qualifier?)` (§1.3, §4.3), never on a context member.

**[ORIGINAL]** in its generality. The precedent for _typed cross-references riding on an event_ is
`src:dcsa` — one event carries `transportCallReference`, an equipment reference, `references[]`
(counterparty ids echoed back) and `relatedDocumentReferences[]` (`dcsa_domain` L1534-1541;
analysis scores C6=3 on exactly this). But DCSA's are **fixed typed slots**, not a generic
polymorphic list, and DCSA does not state a non-authoritative rule. `src:open-trip-model`'s
`contextEvents` — "optional information about the events that can provide additional information
on the current state of this entity" (`otm-api-v5.6.yaml:7266-7290`) — is the nearest published
generic mechanism, but it references **events**, not aggregates. The generic aggregate-valued
context list and rules 1–3 are ours.

**What this settles.** The stop-scoped / trip-scoped / shipment-scoped distinction `A3` demands
("three kinds and must not be fused") is preserved exactly — they are three different `subject`
kinds — while the destination agent's shipment-level claim and the driver's stop-level claim can
still be paired, because pairing runs on the fact key (§1.3, §4.3), not on subject alone — and
because both the stop and an `externallyPerformedLeg` sit in one canonical subject family (E-CANON).

### 1.5 Correcting the A3 envelope citation

`A3` §5.9 and §Cross-area cite `src:omnitracs-roadnet`'s "region-filter table" as "exactly that
statement" of a catalog-wide rule that every event declares the aggregate it belongs to. A filter
table is a query facility. **[ORIGINAL]:** the envelope rule is ours, and is justified above on
its own terms. The Omnitracs cite is withdrawn.

---

## 2. `(outcome, reason)` on every act — before a single event type is named

> **Decision. Every record that asserts the performance of an act carries an `outcome` from a
> five-member enum and, unless the outcome is `COMPLETED`, at least one structured `reason`. The
> event `type` names the act and never the outcome.**

This is a **[SYNTHESIS]** of two grade-A sources and is written up as one. It is not an original
design.

### 2.1 The two sources, and what each supplies

**`src:shippeo` supplies the factorisation and the grid.** Every milestone _and_ every exception
is the same shape: a pair of codes. "The event (milestone) is indicated by a pair of event codes
i.e. the situation code and the justification code"
(`portal-pages/3._Send_a_standard_event…HU_level.md:23`; same sentence at
`events-in-road-order.home.md:9` and `events-out-road-order.home.md:13`). The situation says where
in the lifecycle you got to **and with what outcome**; the justification says why; the event name
(`ORDER_NOT_DELIVERED_ABSENT`) is a human-readable **alias for the pair, not a third axis**.

The published table is **38 rows built from 18 justification codes across 10 situation codes**
(counted from the committed `event-list-order-level.md`: 40 lines, one header, one separator; every
document's inherited "41 rows / ~20 across 9" is corrected here and at §5.2 M3), and
the load-bearing property is that **a reason is not welded to an outcome**: `MQP` "partially
missing package" appears under four situations — `ECH/MQP` (loaded anyway, short), `ENE/MQP` (not
loaded because short), `LIV/MQP` (**delivered** anyway, short), `REN/MQP` (**refused** because
short) (`event-list-order-level.md:10,15,22,29`). Four operationally different things, one reason
code, no combinatorial explosion. Shippeo's analysis calls `REN/MQP` vs `LIV/MQP` "**the most
important single import**" for HHG, and notes that Shippeo is the only source in the corpus that
models "completed with exception" as a first-class outcome (`LIV` carries `MQP`, `RCA`, `DIV`
alongside `CFM`).

**`src:open-trip-model` supplies the enum, the invariant and the sub-results.**
`result.status ∈ succeeded | failed | partiallySucceeded | cancelled`
(`otm-api-v5.6.yaml:18134-18138`); `result` "can only be present in the **actual or realized**
lifecycles" (`:18098-18145`); `result.reason` is a 10-value catalogue in 5.7 — `damage`,
`deliveredElsewhere`, `deliveredToWrongReceiver`, `inaccessibleAddress`, `incomplete`,
`invalidAddress`, `invalidShippingLabel`, `receiverAbsent`, `rejectedByReceiver`, `other`, where
`other` is "designed to capture edge cases… The specific reason is provided in the `remark`
property" (`otm-api-v5.7-rc.1.yaml:13327-13361`); and 5.8 adds **sub-results** — "the unload
action can be succeeded for certain goods and failed for others, in which case the overall result
would be partially succeeded and the sub results would indicate which goods were unloaded
successfully and which were not" (`otm5.8-docs-llm.md`, 5.8 changelog, change request 115).

### 2.2 The outcome enum

```
outcome ∈ COMPLETED | COMPLETED_WITH_EXCEPTION | PARTIALLY_COMPLETED | NOT_COMPLETED | CANCELLED
```

| Member                     | Means                                                                                           | Provenance                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETED`                | The act was performed over its whole intended scope and nothing is wrong.                       | OTM `succeeded`; Shippeo `LIV/CFM`, `ECH/CFM`.                                                                                                                                                                                                |
| `COMPLETED_WITH_EXCEPTION` | Whole scope performed; something about the goods or the circumstances is wrong and is recorded. | The **distinction** is Shippeo's — `LIV/RCA` delivered-with-damage-accepted (`event-list-order-level.md:23`) sits under the _completed_ situation. **[ORIGINAL]:** rendering it as its own outcome member rather than `COMPLETED` + a reason. |
| `PARTIALLY_COMPLETED`      | The act was performed over **less than** its intended scope.                                    | The distinction is Shippeo's — `LIV/MQP` delivered-but-short (`:22`) vs `LIV/RCA` (`:23`); OTM's `partiallySucceeded` names it directly.                                                                                                      |
| `NOT_COMPLETED`            | Attempted, not achieved.                                                                        | OTM `failed`; Shippeo `REN` (13 rows) and `ENE` (5).                                                                                                                                                                                          |
| `CANCELLED`                | Called off before attempt.                                                                      | OTM `cancelled`. Shippeo has no situation-axis analogue (`CANCEL_ORDER` is order-level).                                                                                                                                                      |

Five members rather than OTM's four because `COMPLETED_WITH_EXCEPTION` and `PARTIALLY_COMPLETED`
differ in **scope of performance**, and that difference is a billing and claims difference, not a
shade of meaning. The distinction is Shippeo's grid; the placement on the outcome axis is ours.

### 2.3 Invariants

1. **`outcome` is legal only where `basis = ACTUAL`.** A plan cannot carry an outcome. OTM's rule
   adopted verbatim (`result` only on `actual`/`realized`).
2. **`reasons[]` has at least one member unless `outcome = COMPLETED`, where it is forbidden.**
   Shippeo's invariant is that a situation code never travels without a justification, including
   the "conform" justification `CFM`. **[ORIGINAL]:** collapsing `CFM` into `COMPLETED` and
   forbidding a reason there. It is a normalisation, and it removes Shippeo's own `DIV` overload —
   glossed "Not justified by consignor" at `:14`, "Not conform (not justified)" at `:21` and "Not
   justified by consignee" at `:27`, three meanings for one code depending on situation.
3. **One act, one outcome, one occurrence time.** Where a single visit produced two different
   outcomes over two subsets of the goods, it is **one** act on the shipment with
   `outcome = PARTIALLY_COMPLETED` and the shortfall named by a `Portion` in `reasons[].appliesTo`
   (§3.4). Sibling acts on Portions are the required form only when the acts happened at different
   stops or different times.

### 2.4 The reason vocabulary's **shape** (the list itself is A4's job)

```
Reason {
  code          from the published, versioned reason vocabulary        MANDATORY
  scope         ACT | GOODS | PARTY | RESOURCE | SITE | ADMINISTRATIVE MANDATORY   [ORIGINAL]
  attribution   { party?, roleClass }                                  MANDATORY   [ORIGINAL] (see below)
  appliesTo[]   SubjectRef[] at portion or item grain                  OPTIONAL
  remedy        typed per code                                         per code
  remark        free text                                              MANDATORY when code = OTHER
}
```

Six rules the vocabulary must satisfy. Five are sourced; two elements of the record are authored.

1. **Reasons are orthogonal to outcomes and are reused across them.** The catalog MUST NOT mint
   `DELIVERED_SHORT` and `REFUSED_SHORT` as two codes. Source: Shippeo's `MQP` under four
   situations, above.
2. **~20 reasons × 5 outcomes, not ~100 types.** Source: Shippeo's 38 published rows from **18**
   justification codes; its analysis states the arithmetic explicitly ("Twenty-odd reasons × five
   outcomes covers what a flat list would need a hundred codes for"). The measured factor is 18, not
   "twenty-odd"; the argument is the same argument at 18.
3. **An open member with a mandatory narrative.** Two independent sources, one of them
   regulation-grade: OTM 5.7's `other` + `remark`; `src:dp3-400ng` Item 226 — 226A Miscellaneous
   for "any authorized charge… that does not have a designated service code", with a **mandatory**
   detailed note.
4. **The same vocabulary at every grain.** Source: Shippeo republishes 19 of the same (situation,
   justification) pairs at handling-unit grain under `HANDLING_UNIT_*` names —
   `HANDLING_UNIT_NOT_DELIVERED_ABSENT` _is_ `REN/DAF`, exactly as `ORDER_NOT_DELIVERED_ABSENT` is
   (`event-codes-handling-unit.md` vs `event-list-order-level.md`). **`Reason.code` does not change
   when the subject changes grain.**
5. **A reason may carry its own remedy, and for some codes must.** Source: Shippeo's `new_slot
{start, end}` is **required** on appointment events (`OrderAppointmentEvent`,
   `SharedTrackingSlot`) — a failed delivery that does not say when it will be retried is an
   incomplete record.
6. **Attribution is a structured field on the reason, not baked into the code and not on the
   assertion.** The _fact_ that reason vocabularies are organised by responsible party is sourced:
   `src:stedi-x12-reference` element 1651's 86 values are organised by responsible party
   (consignee-, driver-, shipper-, other-carrier-related, cartage agent) and include `BF Carrier
Keying Error`; Shippeo separates `NJU` "not justified by carrier" from `DIV` "by the
   counterparty" (`event-list-order-level.md:13,14,26,27`). **[ORIGINAL]:** lifting attribution out
   of the code into its own field. It removes the duplication both sources carry (Shippeo's
   `REFUSED_LOAD` / `LOADING_REFUSED_BY_SHIPPER_VARIOUS_REASON` are one reason with two
   attributions). This **supersedes `fork-time` §(b)(7)** ("attribution belongs on the assertion"),
   which the critique correctly identified as a placement rule no source states: Atlas puts fault
   on an `EXTDate` exception record, X12 keys 1651 to a responsible party on a status message, DTR
   attributes at segment grain. Attribution belongs to the **reason**, which is the thing all
   three sources actually attach it to.

`Reason.scope` is **[ORIGINAL]**. It exists so a consumer can separate "something is wrong with the
goods" from "something is wrong with the site" without reading a code list, and because HHG's
authoring gap is concentrated in `SITE` and `ADMINISTRATIVE` — shuttle required, long carry,
elevator unavailable, parking permit, COI not on file — none of which Shippeo has
(`shippeo/analysis.md` § "Named in the task, absent from Shippeo").

### 2.5 The event `type` names the act, never the outcome

> **Rule A-TYPE. A record `type` names the fact class — which, for an act, is the act itself
> (`delivery`, `loading`, `packing`, `storeIn`). It MUST NOT encode the outcome.
> `Delivery.Completed` is not a legal type name.**

_(The example named `weighing` until revision 5. **There is no such member**: §4.7.1 does not declare
one and §1.3 makes §4.7.1 the complete declaration, so the example was naming a type no record could
legally carry. `weighing` — and `unpacking` — are recorded as **absent and owed** at §4.7.3, with the
argument for minting them, and the reason the family question stops it, stated there. The four names
above are all §4.7.1 members.)_

A-TYPE constrains the _content_ of the one axis E-TYPE establishes (§1.3); it is not a second axis.
The outcome is `value.outcome` on the same record, and that is the whole of the reason the axis can
stay single: an outcome-bearing type name would force a second, outcome-free axis to exist beside it
purely so the domain could still be talked about.

Directly sourced, and the source is a defect report. In
`events-out-road-order.swagger.json`, Shippeo's
`SharedEventsOrderConformityOrderNotLoadedPartiallyMissing` declares
`event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — the _entirely_-missing name on the
_partially_-missing schema. Two distinct exceptions collapse to one string on the wire, **while the
code pair (`ENE/MQP` vs `ENE/MQT`) stays correct in both schemas**. Shippeo's analysis draws the
conclusion for us: "concrete evidence for why the event name must be an alias for the code pair and
never the identity."

This **supersedes `fork-time`'s `OccurrenceEvent.type`** (`Delivery.Completed`, `SIT.Entered`),
which bakes the outcome into the type and is why "delivered, two items short" was inexpressible
there.

### 2.6 The critique's scenario, expressed

_Delivery attempted twice: customer absent, then refused for damage, two items short._

```
Act  type=Delivery  subject=shipment:S  context=[stop:T1]  basis=ACTUAL
     outcome=NOT_COMPLETED
     reasons=[{ code=CONSIGNEE_ABSENT, scope=PARTY,
                attribution={roleClass: customer},
                remedy={newWindow: …} }]                    ← Shippeo REN/DAF + required new_slot

Act  type=Delivery  subject=shipment:S  context=[stop:T2]  basis=ACTUAL
     outcome=PARTIALLY_COMPLETED
     reasons=[{ code=REFUSED_DAMAGE, scope=GOODS,
                attribution={roleClass: carrier}, appliesTo=[portion:P1] },   ← Shippeo REN/AVA
              { code=SHORT,          scope=GOODS,
                attribution={roleClass: unknown},  appliesTo=[portion:P2] }]  ← Shippeo LIV/MQP
```

---

## 3. One sub-shipment grain: the **Portion**

> **Decision. There is exactly one sub-shipment grain: the `Portion` — a named subset of one
> shipment's goods, with its own identity, whose membership is stated either by enumeration over
> items or by measure, and which is minted by the first act that applies to less than the whole
> shipment. `item` remains a subject kind for facts genuinely about one article. There is no
> quantity field on any act.**

Partial load, split delivery, overflow, SIT remainder, refused items and short delivery are one
phenomenon. Today they have four models across three documents and no cross-reference.

### 3.1 The shape

```
Portion {
  portionId     ours, never reused                                           MANDATORY
  shipment      exactly one; a Portion never spans shipments                 MANDATORY
  membership    MEASURED | ENUMERATED | BOTH                                 MANDATORY
  measure       typed Weight / piece counts       when MEASURED or BOTH
  items[]       item refs, or a mark range        when ENUMERATED or BOTH
  basis         the reason code that caused this subset to exist             MANDATORY
}
```

A Portion is itself asserted (§4) — it is a claim about which goods form a subset, by a party, at
a time, and two parties can disagree about it.

### 3.2 Why both membership forms, and why one entity

The corpus publishes **both** forms for the same phenomenon, which is why neither can be the sole
grain:

- **Enumerated.** `src:dp3-400ng` Item 17.13: partial withdrawal from SIT is identified by
  **inventory item numbers**, only complete cartons or item numbers, cartons not opened, the
  customer or a Government representative may be present during sorting. `src:cfr-49-375` §375.503:
  itemized inventory with per-article ids and condition. `src:x12-212-trailer-manifest` `MAN`:
  marks qualified by _whose_ they are (element 88, incl. `S` Entire Shipment) and expressible as a
  **start–end range** (`MAN-02`/`MAN-03`) — the inventory-sticker series, without inventing
  anything.
- **Measured.** `src:dp3-400ng` Item 17.13 again, in the same rule: "the TSP must obtain the
  **actual weight** of the portion withdrawn", and storage continues to accrue on the remaining
  weight; Item 17.9 rates split-shipment portions separately but applies the 1,000-lb minimum to
  the combined weight. `src:sirva-ade`'s `Overflow` event carries `Weight` — the weight of the
  overflow portion — and nothing else (SOE p.19).

> **Rule P-MEMBER. A Portion may be minted `MEASURED` and later become `ENUMERATED` or `BOTH`
> without changing its `portionId`.** **[ORIGINAL]**, and it is the one genuinely useful idea in
> `fork-order` §5.1 — the crew often knows the weight and not the contents. The failure in
> `fork-order` was making the Portion _inherently_ weighed, which is why the critique found it "far
> too heavy for two items, and too light for a claim."

> **Rule P-CLAIM. A claim addresses items. A `MEASURED`-only Portion cannot support a claim, and
> the catalog says so rather than leaving a consumer to discover it.** **[ORIGINAL]** as a catalog
> rule; grounded in `src:dp3-400ng` Item 17.12.c (both TSP and warehouseman must hold "the condition
> of **each article** when received at and forwarded from the storage location") and
> `src:cfr-49-375` §375.503.

> **Rule P-OVERLAP. Portions may overlap and may nest.** "The twelve items that went into SIT" and
> "the three of those refused on delivery-out" are both Portions, and the second is a subset of the
> first. **[ORIGINAL]** — forbidding overlap would make the normal SIT case inexpressible.

> **Rule P-IDENTITY. A Portion never changes the shipment boundary.** Minting a Portion is not
> splitting a shipment. This settles `fork-order`'s internal contradiction (§3.2's acceptance table
> said the SIT remainder is "still one shipment"; §5.1 minted a `Portion` "at the moment of physical
> divergence — a SIT remainder" and hung it under Shipment as though that were a split). The SIT
> remainder is a Portion. The shipment is untouched. _(Whether a **terminated** stay that moves
> onward on a new BL is a new shipment is a separate A2/A5 question, not settled here — see §10.4.)_

### 3.3 What the other three models were expressing, and how the Portion expresses it

| Model                                                       | Document                  | What it was trying to express                                 | Expressed now as                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **quantity on a `StopAction`**                              | `A3` §3.2                 | "this load moved part of the goods"                           | The act's subject is the shipment and `reasons[].appliesTo` names a `MEASURED` Portion; or, for a separately-timed act, the act names the Portion directly. **The `quantity` field is deleted.** A quantity floating on an act is a measure with no identity, so a second act cannot say "the same part".                                                                                                                                           |
| **`Portion` minted at physical divergence, always weighed** | `fork-order` §5.1         | "the crew knows the weight, not the contents"                 | `membership = MEASURED`, enumerable later under P-MEMBER. The "only at physical divergence" restriction is **removed**: two refused articles mint a Portion.                                                                                                                                                                                                                                                                                        |
| **an `item` subject on an event**                           | `fork-time` §(c)          | "a correction or a refusal is addressable below the shipment" | Preserved twice over: `item` is a subject kind in the envelope (§1.2), and an `ENUMERATED` Portion of one item is legal. Nothing is lost.                                                                                                                                                                                                                                                                                                           |
| **sub-results on the action**                               | `src:open-trip-model` 5.8 | "succeeded for certain goods and failed for others"           | `outcome = PARTIALLY_COMPLETED` on one act, with `reasons[].appliesTo` naming the Portions. **[ORIGINAL]:** OTM nests sub-results inside one action record; we publish them as `appliesTo` refs on the reasons of one act, because our envelope has no nesting and because the shortfall is frequently learned after the act was published — a nested sub-result would require revising a published record, which an append-only catalog cannot do. |

### 3.4 The required form for "delivered, two items short"

One `Delivery` act, subject `shipment`, `outcome = PARTIALLY_COMPLETED`, one reason `SHORT` whose
`appliesTo` names an `ENUMERATED` Portion of two item refs. Not two acts (that double-counts the
visit and erases the fact that a delivery happened). Not a quantity (that has no identity to refer
back to when the two items surface in SIT a week later).

---

## 4. A generic `Assertion`, beyond time

> **Decision. There is one published record class: the `Assertion`. Every fact the catalog carries
> — a time, a weight, a piece count, a condition, a status, an identifier, the performance of an
> act — is an assertion about one fact, by one party, at one basis. `basis = ACTUAL` is legal.
> `OccurrenceEvent` as a separate class is abolished. Competing assertions are resolved by a
> published, append-only `FactResolved` naming its rule.**

The answer to must-fix #4 is therefore: **weights, piece counts, conditions and statuses DO have a
competing-assertion story, and it is the same one times have.**

### 4.1 The shape

```
Assertion (envelope §1.1, plus)
  qualifier    typed per `type`, where that type declares one           per type
  basis        REQUESTED | COMMITTED | PLANNED | ESTIMATED | ACTUAL     MANDATORY
  value        typed per `type`                                         MANDATORY
  asOf         instant                                                  MANDATORY when basis = ESTIMATED
  evidence[]   refs to documents / other assertions                      OPTIONAL
  supersedes   eventId of an earlier assertion by the SAME party
               with the SAME fact key                                    OPTIONAL
```

The fact class is the envelope `type`; the fact's subject is the envelope `subject`; the fact key
is the derived tuple `(subject, type, qualifier?)` (§1.3). No `factRef` object and no second
`subject` appear on the record.

An **act record** (§2) is an Assertion whose `type` is the act and whose `value` is
`{occurredAt, outcome, reasons[]}`.

Fact-class families — i.e. families of `type` values — each with published examples and a source
that treats the class as contested:

| Family              | Examples                                                 | Contest is real because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **time**            | arrival, departure, SIT entry date, actual delivery date | `src:dp3-400ng` names **five** distinct delivery-date roles (requested at award / first available / scheduled / actual / RDD) and different charges hang on different ones (Items 1.2.b-c, 17-1.3, 29.4, 50).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **measure**         | net / gross / tare weight, cube, piece count             | `src:x12-212-trailer-manifest` element 187: a weight is always typed — `G` gross, `N` actual net, `T` tare, `E` estimated net, `B` billed, `L` legal, and **`RG`/`RN`/`RT` reweigh** variants. "A `Weight` value object is `(kind, unit, value, source)`, never a number."                                                                                                                                                                                                                                                                                                                                                                                                           |
| **count**           | cartons, handling units                                  | `src:x12-212-trailer-manifest` `AT8-04` non-unitized vs `AT8-05` unitized handling units — two separate counts that sum to one total.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **condition**       | per-article condition at receipt and at forwarding       | `src:dp3-400ng` Item 17.12.c; `src:cfr-49-375` §375.503.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **state**           | a party's claim about a lifecycle state                  | `src:sirva-ade` vs `src:weichert-supplier-api`: one physical move carries SIRVA's dispatch lifecycle (`REGISTERED`/`PLANNED`/`ASSIGNED`/`LOADED`/`DELIVERED`/`CANCELLED`, GSD p.8) **and** Weichert's procurement lifecycle (`Requested`/`Awarded`/`Accepted`/`Submitted`/`In Progress`/`Delivered`/`Completed`), and they do not align — award and accept happen before an ADE registration exists. Two parties, two state assertions about one shipment, neither derived from the other. _(The non-alignment is an authored reading of the two contracts side by side, not a phrase either publisher uses; the quotation marks the previous revision put round it are withdrawn.)_ |
| **identity**        | BOL number, registration, SCAC, trip number              | §7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **party-role**      | who is the hauling agent                                 | `src:dp3-400ng` Item 7.1: the origin representative must be named in DPS at acceptance and **updated to the one who will actually service the shipment** before the pre-move survey — "who the origin agent is" is a dated, versioned assertion, not a static field.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **act performance** | §2                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 4.2 `basis` — and an honest re-citation

```
basis ∈ REQUESTED | COMMITTED | PLANNED | ESTIMATED | ACTUAL
```

`fork-time` stated the provenance as "`src:uncefact-scrdm`'s, minus `Previous_`, with `Confirmed_`
renamed `COMMITTED`." That is wrong for half the enum and thin for `COMMITTED`. Corrected:

- `PLANNED`, `ACTUAL`, and the `Confirmed_` → **`COMMITTED`** idea: `src:uncefact-scrdm`, which
  supplies `Planned_` / `Actual_` / `Confirmed_` / `Previous_` as association qualifiers.
  `Previous_` is dropped — an append-only catalog gets it free.
- `REQUESTED` and `ESTIMATED`: **`src:dcsa`**, `eventClassifierCode` ∈ `ACT | PLN | EST | REQ`
  (`event_domain` L2272-2285). These are DCSA's, from a different position in the table, and were
  mis-attributed.
- **`COMMITTED`'s real support is `src:sirva-ade`, grade A, a live partner contract** — not Atlas.
  ADE carries an **Agreed Load Period** and **Agreed Delivery Period** (From/To date **plus**
  From/To hour and minute, with the all-or-nothing rule that specifying one time part requires all
  four, SOE pp.4-5), kept distinct from `PlannedCustLoadDate`/`ActualCustLoadDate` (GSD p.7) and
  distinct again from the trip-side `LoadDate`/`UnloadDate` ("Van Line **Driver** Load Date").
  Four time families on one shipment, moving independently, with `LoadDateChanged` (the trip plan)
  a different event from `ALPChanged` (the customer promise). ADE goes further and models the
  **withdrawal** of a commitment as its own transition — `IntoWillAdvise` "the shipment is changed
  to **remove** agreed load and delivery periods" / `OutOfWillAdvise` (SOE p.18).
  Corroborated by `src:dp3-400ng`: the **scheduled delivery date** is "the date agreed between TSP
  and customer", with a two-hour DPS deadline and a financial consequence for missing it (Item
  17-1.3), and it is one of five separately load-bearing delivery-date roles.
- **Atlas's contribution to `COMMITTED` is one untyped, undescribed field pair**
  (`agreedFromDate`/`agreedToDate` beside `scheduledFromDate`/`scheduledToDate`) in a catalog with
  zero enum declarations and zero property descriptions in the operational specs. It is structural
  evidence that a distinction exists, not evidence that it is defined, and it is **not** decisive
  for anything. See §9.

**Three clocks, re-cited.** `fork-time` rated three clocks HIGH because "Shippeo, EPCIS,
project44, Alvys and the 858 converge." Three of those five carry two. Corrected:

- **Three clocks, carried:** `src:shippeo` — `situation.date` "the datetime at which the event
  **happened**", `situation.input_date` "the datetime at which the event was **recorded**" with the
  published worked example ("The driver recorded at 3.30pm that he delivered the goods at 3pm"),
  and `date_transmission`. And `src:x12-858-implementation-guide` — N904/N905 status **effective**
  date/time, `G62` arrival date/time, and the interchange time, with worked example 7 (p.38)
  showing a status effective **a day after** the arrival it describes.
- **Two clocks plus the governing rule:** `src:gs1-epcis-cbv` — `eventTime` vs `recordTime`, where
  `recordTime` "SHALL be ignored when an event is presented to the Capture Interface, and SHALL be
  present when retrieved through the Query Interfaces" (EPCIS 2.0 §7.4.1 pp.74-75; conformance
  §§14.3, 14.5). That rule is adopted verbatim for `recordedAt` and is the strongest single
  statement in the corpus even though EPCIS itself carries two clocks.
- **Two clocks, corroborating the split only:** `src:project44` (`dateTime` vs `receivedDateTime`,
  where "received or calculated" are fused) and `src:alvys-api` (`RecordedAt`/`ReceivedAt`, neither
  an occurrence time).

So: `occurredAt` / `assertedAt` / `recordedAt` stands, on two sources that carry three and one that
publishes the conformance rule for the third. `date_transmission` stays out of the domain model.

### 4.3 Resolution — `FactResolved`

```
FactResolved (envelope, type = FactResolved; assertedBy = the platform,
              capturedBy = DERIVED_BY_RULE)
  factRef       the contested fact key ( subject, type, qualifier? ),
                whose subject MUST equal the envelope subject     MANDATORY
  selected      eventId of the winning assertion                  MANDATORY
  considered[]  eventId of every assertion in the contest         MANDATORY
  rule          { ruleId, ruleVersion }                           MANDATORY
```

`factRef` is an explicit field **here and only here** (and on nothing else that is not a
meta-record), because a `FactResolved`'s own `type` names its record class rather than the fact it
is about; an Assertion needs no such field because its own key already is the fact key (§1.3).

Append-only: the history of _which answer we were giving when_ survives. Precedent for a selected
marker is `src:project44`'s `selected` flag, and the precedent for naming a derivation rule is p44's
own `ShipmentException.definitionId` — "a logic which determines how the exception would be
derived." **[ORIGINAL]:** making the resolution append-only, requiring the rule id **and version**,
and generalising from times to any fact class. `fork-time` presented two of these three as p44's
and they are not.

**Last-writer-wins is rejected.** `src:gtfs` is the explicit counter-example — `FULL_DATASET` "will
overwrite all preceding realtime information", no retraction, no supersedes link, no history — and
it is defensible there only because GTFS has one publisher by construction.

> **Rule E-CANON. Every `type` declares exactly one canonical subject _family_ — a named, closed
> set of `aggregate` kinds, usually a singleton. An Assertion whose `subject` kind is not in the
> declared family for its `type` is rejected at the boundary, not re-keyed silently.**
> **[ORIGINAL]**; the shape precedent is DCSA's per-type classifier constraint (§1.3).

E-CANON is the subject half of the one-axis decision (§1.3): E-TYPE says a record has exactly one
`type` from one vocabulary, E-CANON says that `type` fixes what the record may be about. **Two
families are non-singleton, one is the whole enum, and every other is a singleton** — the complete
declaration is the table at §4.7, and the two non-singletons are named there:
`stop = {stop, externallyPerformedLeg}` (§8.2), which is what lets an arrival be asserted about a
leg performed by someone whose journey we cannot see, and `goods = {shipment, portion}`, which is
what lets a separately-timed act name a Portion directly (§3.3). _(Revision 3 wrote "only two
families are non-singleton", then named one and said "nothing else." The second was already
licensed by §3.3 and had simply not been named; §4.7 names it.)_

E-CANON is what makes the driver and the destination agent actually disagree. "Arrival at the
destination residence" has canonical subject family = **stop**. The destination agent's claim that
"the shipment arrived" therefore **may not be published as an assertion about `shipment:S`** — it is
an assertion about that stop, with the shipment in `context[]`, or — where no stop of ours exists —
about an `externallyPerformedLeg` (§8), which is in the same family and therefore keys into the same
contest rather than starting a second one. The critique's objection ("a selection rule keyed on
(subject, milestone) never sees the two claims as competitors") is answered: the key is the fact key
`(subject, type, qualifier?)`, and the canonical subject family is declared, not inferred.

**Who does the re-phrasing, and what the boundary does when it cannot be done, is §4.6.** The
sentence above states an _obligation on the asserter_, not a licence for the boundary to re-key
a record it was handed. Revision 3 left that ambiguous and `fork-time` §8.7 read it the other way;
§4.6 settles it.

### 4.4 The acceptance test: duplicate reweighs

**Rule `R-WEIGHT-LOWER`.** Where two assertions of `type = weight.net` for one shipment are
both `basis = ACTUAL` and were produced by distinct weighings, the resolved value is **the lower**.

**Sources, one per pairing** — the previous revision headed this rule with Item 4 Note 2 alone,
which is the _duplicate-reweigh_ rule and does not reach the original-vs-reweigh case the rule is
most often used for:

| The two weighings being compared                                           | Cite                              | What it says                                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **reweigh vs reweigh** (origin agent and destination agent both reweighed) | `src:dp3-400ng` **Item 4 Note 2** | the two agents must coordinate and, "if duplicates occur, **DPS must be updated with the lower of the net reweigh weights**".         |
| **original vs reweigh**                                                    | `src:dp3-400ng` **Item 4.11.d**   | invoice on **the lesser weight** — the same item that forbids the reweigh being performed on the same scale as the original weighing. |
| **weight ticket vs constructive weight**                                   | `src:dp3-400ng` **Items 4.9.h-i** | the fallback pays "either valid weight tickets or a PPSO constructive weight of 7 lbs per cu ft, **whichever is less**".              |

Three statements of lower-wins, across three different pairs of weighings. **[ORIGINAL]:** stating
the rule once over _any_ two ACTUAL net weights from distinct weighings, rather than three times per
pairing. The tariff never generalises it; we do, and the generalisation is what `FactResolved.rule`
makes safe — the rule is named, scoped and versioned, so the scope of the authored step is on the
record rather than in a reader's head.

Two honest notes:

1. **This is a DoD program rule, not a universal one.** 400NG's own analysis warns against
   promoting its program rules into the core model (weakness #5, about the 90-day SIT cap). That is
   exactly why `FactResolved.rule` is mandatory: the rule is named and scoped, and a commercial
   tariff can carry a different one over the same fact class without the catalog changing shape.
2. **A reweigh is not a correction.** The first weighing occurred and was recorded correctly. Both
   assertions stand; the resolution picks. Under `fork-time`'s preference order the reweigh would
   have been a "compensate", leaving two authoritative weights and no winner — which is precisely
   the failure the critique identified.

The same machinery handles the other published evidence hierarchies: 400NG Items 4.9.g-i enumerate
the _sources_ a weight may come from — certified-scale ticket, Branham, NADA, "other appropriate
reference sources", customer manufacturer documents, constructive rate per cubic foot — which in
our shape is `capturedBy` + `evidence[]` on each assertion, with a named rule choosing between them.

### 4.5 Where a second party's ACTUAL lives

It lives in an ordinary Assertion with `basis = ACTUAL`. This is the critique's option (a) and it
is taken. Consequences, stated so they are not rediscovered:

- **`fork-time`'s rule "`basis` never ACTUAL" is reversed.**
- **`OccurrenceEvent` is abolished as a class.** What it was — one time, no tense — is an
  Assertion at `basis = ACTUAL`. The catalog's "what happened" view is the **selected projection**
  over ACTUAL assertions, published by `FactResolved`.
- **`A3`'s adoption of `src:alvys-api`'s three-way split — "`ArrivalRecorded` (a fact was written)
  ≠ `StopStatusChanged` (state moved) ≠ `Loaded` (a milestone was reached)" — is rejected.**
  `ArrivalRecorded` is `assertedAt` on the arrival assertion (a clock, not a record);
  `StopStatusChanged` is forbidden (state is a projection, never published as a mutable record);
  `Loaded` is an act record. Publishing all three double-counts every arrival — cross-document
  conflict #2, closed.
- **`A3`'s "plan/actual as parallel readings" and its wholesale adoption of `src:alvys-api`'s
  `Eta {Planned, Live, Manual}` are rejected**, because that triple fuses two orthogonal axes that
  this model already carries separately: _Planned_ is `basis = PLANNED`; _Live_ is
  `basis = ESTIMATED` with `capturedBy ∈ {DERIVED_BY_RULE, DEVICE_TELEMETRY}`; _Manual_ is
  `basis = ESTIMATED` with `capturedBy = KEYED_BY_PERSON`. No named fields are needed and none are
  added. `A3` §3.4 also described these as "settled cross-cutting decisions [crosscheck item 6]";
  crosscheck item 6 settles nothing — it names candidates and instructs that the decision be made
  once. **It is made here.**

---

### 4.6 E-CANON's boundary behaviour: **reject, never re-key**

> **Decision. The boundary is structural and it refuses. A record whose `subject` kind is not in the
> canonical subject family declared for its `type` is rejected — never filed under the subject it
> named, and never re-keyed by the boundary onto a subject it did not name. Re-phrasing a claim onto
> its canonical subject is an **ingest-side act**, performed before the boundary, by a **named,
> versioned subject-resolution rule** that must return **exactly one** candidate. A rejection is not
> a silence: the inbound message, the rule attempted, the candidate set and the refusal are retained,
> and an obligation is emitted to the asserting party.**

#### 4.6.1 Why this needed deciding

Two published statements said opposite things. §4.3's _rule text_ and §1.3's restatement both say
"rejected at the boundary, **not re-keyed silently**"; §4.3's surrounding _prose_ and
[`A3` §3.2](A3-trip-stop-assignment.md) both said the destination agent's shipment-phrased claim
"resolves to that stop (shipment in `context[]`)", and
[`fork-time` §8.7](fork-time-provenance-corrections.md) read the pair as one sentence — "accepted
with the shipment in `context[]`; it is not silently re-keyed, it is rejected at the boundary" —
which is the two behaviours in a single clause.

**Reject wins, and this is a correction of prose to rule rather than a reversal of a decision.** The
normative sentences already said reject in both places they appear. What was missing was an account
of _who_ re-phrases, _when_, and what happens when the re-phrasing is not determined — which is the
half the prose was standing in for. §4.6.2 supplies it.

§4.6.3 works the hard case — a shipment-phrased arrival against a van with **two** candidate stops
for that shipment. Three reasons decide the question first, and the third _is_ that case.

**(a) A re-key is a fact the boundary is not entitled to assert.** Choosing which of two stops a
shipment-phrased arrival belongs to decides _which visit the agent was talking about_. That is a
substantive operational claim, and under the envelope every claim has an `assertedBy`, an
`assertedAt` and a `capturedBy` (§1.1). A boundary re-key has none of the three. **M1 already
forbids this exact shape** — a value nobody asserted, published as though somebody had — and the
argument M1 rests on applies unchanged: "a planned value that nothing contradicted is
indistinguishable from an observation, which is the difference between a record and a fabrication."
A guessed subject is the same defect one field to the left.

**(b) A silent re-key is unfalsifiable.** Under re-keying, a wrong choice and a right one produce
byte-identical records: the stored assertion says `subject = stop:9` with nothing recording that the
asserter said `shipment:S`. Under reject-then-resolve, the resolution leaves `context[]` and
`evidence[]` behind, so it can be seen, disputed and superseded like any other claim. This is
`src:shippeo`'s **Smart Reference Matching** discipline applied one level up: §7.5 already adopts
"canonicalise to **match**, never to **store**", and "a canonical match is an Assertion with a
resolvable verdict, never a truth." A subject match is a match.

**(c) Re-key has no defined behaviour at cardinality ≠ 1, and cardinality ≠ 1 is the normal HHG
case.** Split delivery, overflow riding two trips (§3.3), origin-side **and** destination-side SIT on
one shipment — the corpus's own worked failure is `src:sirva-ade`'s `ChangeSIT`/`DeleteSIT`, which
"cannot say which one" of two SIT occupancies it means (§7.4). A rule defined only when the answer is
obvious is not a rule, and a model that adopts it inherits exactly the defect the `stay` grain was
introduced to prevent.

**[ORIGINAL]** as a decision. Reasons (a) and (c) are internal — M1 and §7.4 are this document's own
settled text — and (b) is `src:shippeo`'s published matching policy read one level up. No source in
the corpus states a subject-admission rule, because no source in the corpus carries a declared
canonical subject per record type.

#### 4.6.2 The three parts, stated so they are testable

> **Rule E-CANON-STRICT (the boundary).** The admission check is purely structural: is
> `subject.aggregate` a member of the family declared for `type` at this `specVersion` (§4.7)? If
> not, the record is **not admitted to the catalog**. It acquires no `eventId`, is filed under no
> fact key, and enters no contest. The boundary performs no substitution, no nearest-match and no
> best-guess.

> **Rule E-CANON-RESOLVE (before the boundary).** A claim arriving phrased on a non-canonical subject
> MAY be re-phrased onto its canonical subject before submission, and **only** by a published,
> versioned **subject-resolution rule** (`{ruleId, ruleVersion}`, the same shape as
> `FactResolved.rule`) that yields **exactly one** candidate subject. Where it yields zero or more
> than one, resolution **fails** and E-CANON-STRICT applies. The resulting Assertion is the
> asserter's, not ours: `assertedBy` and `assertedAt` remain the claiming party's, `subject` is the
> canonical subject, the subject the party actually named goes in `context[]`, the inbound message
> goes in `evidence[]`, and `capturedBy` is `PARTNER_ASSERTED` (or `KEYED_BY_PERSON` where a human
> operator supplied the missing subject). **The claim is theirs; the resolution is ours; both are
> visible on the record.**

> **Rule E-CANON-OBLIGATION (what a rejection leaves behind).** A rejected submission is retained
> outside the catalog — the inbound message verbatim, the `type` and `subject` it named, the
> resolution rule attempted, the candidate set it returned, and the refusal — and emits a
> **notification obligation** to the asserting party naming what it must supply. §6.5's obligation
> mechanism is extended to the boundary for exactly this; a rejected claim is never silently dropped.

**How this squares with §6.1's "there is no refusal path."** §6.1 governs _corrections_, and the
distinction is not a hedge: an `INEFFECTIVE` correction is **well-formed and answerable** — it names
a real fact key, so the catalog can file it, serve it and explain why the priced record differs from
what the customer believes. A record whose subject is outside its type's family is **unanswerable**:
there is no key under which to file it, and the catalog's entire query and resolution model is the
fact key (§1.3, §4.3). So the rule is: **the catalog records everything it can key, and refuses only
what it cannot key — and what it refuses is retained, attributed and acted on elsewhere.** Nothing is
lost; one thing is kept out of a store that could not answer questions about it.

#### 4.6.3 The hard case: a shipment-phrased arrival against a van with **two** candidate stops

_One trip. Shipment S is split-delivered: stop 4 takes the first portion, stop 9 the balance. The
destination agent keys "shipment S arrived" — `type = arrival`, `subject = shipment:S`, no stop
named. The driver's app has already asserted arrival at both stops by geofence (permitted by M5)._

**What happens, step by step.**

1. `arrival` declares family `stop = {stop, externallyPerformedLeg}` (§4.7). `shipment` is not a
   member. **The record as submitted is refused** — E-CANON-STRICT.
2. Ingest attempts the published subject-resolution rule for _a `DestinationAgent`'s shipment-phrased
   arrival_. It returns **two** candidates, stop 4 and stop 9. **Resolution fails at cardinality.**
   It does not fall through to recency, to the later stop, to the nearer geofence, or to the stop
   whose planned window contains the asserted time. There is no tie-break here and **A8-NAMED's
   prohibition on implicit last-writer-wins has a subject-side twin: there is no implicit
   nearest-subject-wins either.**
3. The submission is retained per E-CANON-OBLIGATION, with both candidates recorded, and an
   obligation is emitted to the destination agent to name the stop.
4. **The contest runs without it.** `FactResolved` over `(stop:4, arrival)` and `(stop:9, arrival)`
   considers the driver's two geofence assertions and selects under
   `AUTHORITATIVE-ROLE-AT-INSTANT` ([`A8` §5 row 1](A8-authority-skeleton.md)). The agent's claim is
   **not** in `considered[]`, because `considered[]` names every assertion **in the contest** (§4.3)
   and this one never entered it. That absence is honest and is itself queryable via the obligation.
5. When the stop is supplied — by the agent, or by a human operator resolving it — a **new**
   Assertion is minted: `subject = stop:9`, `context = [shipment:S]`, `assertedBy = {the destination
agent, DestinationAgent}`, `assertedAt` = when _they_ said it (not when we resolved it),
   `capturedBy = PARTNER_ASSERTED`, `evidence[] = [the inbound message]`. `FactResolved` for
   `(stop:9, arrival)` is **republished** over the enlarged `considered[]`. Append-only throughout:
   nothing is rewritten, and the history of which answer we were giving when survives (§4.3).

**The one-candidate case, for contrast.** Where the van has exactly one stop for shipment S, the same
resolution rule returns one candidate and step 2 succeeds. The record admitted is _identical in
shape_ to step 5's — same `context[]`, same `evidence[]`, same `capturedBy` — which is the point:
**the successful and the unsuccessful path produce the same kind of record, so the model has one
behaviour with a cardinality gate, not two behaviours.**

**The symmetric case, which is just as common and is settled the same way.** A driver's app naturally
phrases _delivery_ against the stop it is standing at: `type = delivery`, `subject = stop:T`.
`delivery`'s family is `goods = {shipment, portion}` (§4.7), so `stop` is not a member and the record
is refused exactly as the agent's was. The resolution rule here usually yields one candidate — the
one shipment that stop's `stopAction`s name — and where the stop serves several shipments it yields
several, and fails. **E-CANON is not a rule about partners being sloppy; both of our own first-party
producers hit it, in opposite directions.**

**This is the resolution story for scenario 7.** [`fork-time` §8.7](fork-time-provenance-corrections.md)
works the one-candidate case and is corrected to this wording; the two-candidate case above is what
it did not state and what the blocker required.

### 4.7 The canonical-subject table

> **Decision. Every `type` in the published record vocabulary declares, in one place, its canonical
> subject family, its `qualifier` shape, and what belongs in `context[]`. This table is that
> declaration for every fact class named across the four documents. It is the shared layer's, and it
> outranks any per-document restatement.**

Read with five notes.

1. **`context[]` is non-authoritative and is never the resolution key** (§1.4). Everything in the
   context column is a cross-reference; no fact is asserted about any of it.
2. **The families.** Every family is a singleton except three: `stop = {stop,
externallyPerformedLeg}` (§8.2), `goods = {shipment, portion}` (§3.3 — a separately-timed act may
   name a Portion directly), and `identity`, whose family is the **whole `aggregate` enum** (§7.1:
   "`subject` may be **any** aggregate kind"). The `goods` family and its name are **[ORIGINAL]**;
   both halves are settled text (§3.3 licenses a Portion-subject act, §1.2 makes `portion` an
   aggregate) and this table is where they are joined into a declaration.
3. **The authority column is [`A8`'s](A8-authority-skeleton.md), quoted, not re-derived.** Rows A8
   does not cover say **owed** and name [`A8` §9 item 8](A8-authority-skeleton.md); any provisional
   reading offered there is marked **[ORIGINAL]** and **may not be used to score a dependent decision
   above medium** (A8 §10's last row).
4. **`boundBy`** is A8 §4.3's: `CUSTODY` / `ASSIGNMENT` / `SCHEME` / `PRINCIPAL` / `NONE`.
5. **Type names are canonicalised here.** §1.3's vocabulary list uses bare, gerund-or-noun spellings
   (`arrival`, `loading`, `delivery`, `storeIn`, `weight.net`, `pieceCount`); the three documents also
   write `time.arrival`, `delivery-performance` and "load performance" in prose. **The spellings in
   the first column are the vocabulary; the rest are prose aliases and must not appear in a record.**
   `unloading` and `packing` are spelled to match `loading` — **[ORIGINAL]** as a spelling, forced by
   M2's own list ("packed, loaded, unloaded, delivered").

#### 4.7.1 The table

| `type` (prose alias)                                                                                                                                                                                                                                                                                      | Canonical subject **family**                                                                                                                                                      | `qualifier`                                                      | `context[]` carries                                                                                                                                                                                                                                   | Authoritative role · `boundBy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`arrival`** _(time.arrival)_                                                                                                                                                                                                                                                                            | **`stop`** = {stop, externallyPerformedLeg}                                                                                                                                       | —                                                                | `trip`; every `shipment` on board; `stopAction`                                                                                                                                                                                                       | The role holding custody at that stop — `Driver` on our trip, `Hauler` on the hauling agent's, the leg's `authoritativeAsserter` on an `ExternallyPerformedLeg`. `DestinationAgent` **competing** at destination. · `CUSTODY` · [A8 §5 r1]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **`departure`**                                                                                                                                                                                                                                                                                           | **`stop`**                                                                                                                                                                        | —                                                                | as `arrival`                                                                                                                                                                                                                                          | as `arrival` · `CUSTODY` · [A8 §5 r2]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`packing`** _(pack performance)_                                                                                                                                                                                                                                                                        | **`goods`** = {shipment, portion}                                                                                                                                                 | —                                                                | `stopAction`, `stop`, `trip`                                                                                                                                                                                                                          | **Owed — A8 §9 item 8 names packing performance as not covered.** **[ORIGINAL]** provisional: the mirror of `loading` (`OriginAgent`, or ADE's `Packer` where separately resourced, GSD pp.12-13), `customer` **competing** on scope. Do not score on this. · `CUSTODY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`loading`** _(load performance)_                                                                                                                                                                                                                                                                        | **`goods`**                                                                                                                                                                       | —                                                                | `stopAction`, `stop`, `trip`                                                                                                                                                                                                                          | `LoadAgent`; `OriginAgent` where no separate load agent is assigned. `Driver`, `customer` corroborating; `customer` **competing** on _scope_ (short/refused). · `CUSTODY` · [A8 §5 r3]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`unloading`** _(unload performance)_                                                                                                                                                                                                                                                                    | **`goods`**                                                                                                                                                                       | —                                                                | `stopAction`, `stop`, `trip`                                                                                                                                                                                                                          | `UnloadAgent`; `DestinationAgent` where none separately assigned. · `CUSTODY` · [A8 §5 r4]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **`delivery`** _(delivery performance)_                                                                                                                                                                                                                                                                   | **`goods`**                                                                                                                                                                       | —                                                                | `stop` **or** `externallyPerformedLeg`; `trip`                                                                                                                                                                                                        | `DestinationAgent`; the leg's `authoritativeAsserter` where externally performed; `RR19Agent` under a Reverse Rule 19. **`customer` competing** — three sources make the signature constitutive. · `CUSTODY` · [A8 §5 r5]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`handover`** _(custody handoff)_                                                                                                                                                                                                                                                                        | **`goods`**                                                                                                                                                                       | —                                                                | both `stop`s / `trip`s, or the `externallyPerformedLeg`; the releasing and receiving `partyRole`s                                                                                                                                                     | Both sides assert (the `J1`/`R1` pair); `custodyBasis` 41 vs 349 decides whether authority moves at all. · `CUSTODY` · [A8 §7.1 A8-MOVE, §7.6]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`weight.net`**                                                                                                                                                                                                                                                                                          | **`goods`**                                                                                                                                                                       | —                                                                | `document` (the weight ticket), `stop`, `stay`                                                                                                                                                                                                        | **No role is authoritative.** Settled by the value rule `R-WEIGHT-LOWER` (§4.4). `weighMaster` supplies evidence, not the assertion; the weighing side and the reweigh-demanding side are both **competing**. · **`NONE`** · [A8 §5 r6]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`weight.gross`**                                                                                                                                                                                                                                                                                        | **`goods`**                                                                                                                                                                       | —                                                                | `document`, `resource` (the vehicle weighed), `stop`                                                                                                                                                                                                  | **Owed — not in A8 §5.** **[ORIGINAL]** provisional: the weighing party (`Hauler`/`OriginAgent`), `weighMaster` as evidence. Do not score on this. · unassigned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **`weight.tare`**                                                                                                                                                                                                                                                                                         | **`goods`** — the **consignment's** handling units (`src:nmfta-ebol`: _"weight of the skids/pallets/slips used in the shipment"_). **Not** the equipment's own tare — see §4.7.2c | —                                                                | `document`, `stop`                                                                                                                                                                                                                                    | as `weight.gross` · unassigned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`pieceCount`**                                                                                                                                                                                                                                                                                          | **`goods`**                                                                                                                                                                       | **`{unitization}`** ∈ `UNITIZED` \| `NON_UNITIZED`               | `document` (the inventory), `stop`, `stay`                                                                                                                                                                                                            | **At a custody boundary: jointly held**, releasing **and** receiving role, `selected` may be empty — A8-JOINT covers "`condition` **and the counts asserted with it**". Away from a boundary: **owed**, A8 §9 item 8. · `CUSTODY` · [A8 §5 r9, §7.3]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`storeIn`** _(the act of placing goods into storage)_                                                                                                                                                                                                                                                   | **`stay`**                                                                                                                                                                        | —                                                                | `shipment`/`portion`, `stop`, `trip`                                                                                                                                                                                                                  | The warehouse agent or TSP crew who performed it; `SITAgent` (handling-in). M2: human or partner asserter, **never derived**. · `CUSTODY` · [A8 §5 r7 inputs; §5.3]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`sitEntryDate`** _(SIT entry date)_                                                                                                                                                                                                                                                                     | **`stay`**                                                                                                                                                                        | —                                                                | `shipment`, `stop`                                                                                                                                                                                                                                    | **Nobody.** Mandatorily `DERIVED_BY_RULE` (M4) from the TSP's **first available delivery date**. Authority applies only to that **input**, and is the `Hauler`/`DestinationAgent`'s (whichever holds the BL duty). · **`NONE`** · [A8 §5 r7]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`storeOut`** _(SIT release / handling-out)_                                                                                                                                                                                                                                                             | **`stay`**                                                                                                                                                                        | —                                                                | `shipment`/`portion`, `stop`, `trip`, the collecting carrier's `partyRole`                                                                                                                                                                            | `SITAgent` / the warehouseman holding the goods. `Hauler` collecting is **competing** — it is a handoff, so the exception-sheet rule applies. · `CUSTODY` · [A8 §5 r8]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`condition`**                                                                                                                                                                                                                                                                                           | **`item`** _(singleton — a value **per article**, §5.4)_                                                                                                                          | —                                                                | `shipment`/`portion`, `stop`, `stay`, `document` (the signed inventory)                                                                                                                                                                               | **Jointly held and deliberately plural**: the releasing role **and** the receiving role at each custody boundary. On disagreement `FactResolved` **MUST** publish both and **MUST NOT** select (A8-JOINT). · `CUSTODY` · [A8 §5 r9]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`identity`**                                                                                                                                                                                                                                                                                            | **every `aggregate` kind** (§7.1)                                                                                                                                                 | **`{scheme, vocabularyScope}`** — the I-KEY tuple (§7.1)         | `document` (the instrument the value appears on — the BL, the weight ticket); the `partyRole` of the counterparty echoing it back                                                                                                                     | The **`issuer`** of the scheme, and nobody else, for the value under that scheme. **Authority never moves.** · **`SCHEME`** · [A8 §5 r10]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`charge`**                                                                                                                                                                                                                                                                                              | **`charge`**                                                                                                                                                                      | **`{aspect}`** ∈ `PROPOSED` \| `DECIDED` \| `RATED` — see §4.7.2 | `shipment`/`portion`, `order`, `stopAction`/`stop`, `stay`                                                                                                                                                                                            | Two-sided, three ways: **propose** = the performing role; **decide** = the `accountParty`; **rate** = the tariff owner. `SettlingAgent`/`SetoffAgent` corroborate. · **`PRINCIPAL`** · [A8 §5 r11]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`tripDelay`** · **`tripResequence`** · **`tripCancellation`** _(the trip-scoped class: "the trip was delayed / resequenced / cancelled")_                                                                                                                                                               | **`trip`** _(singleton)_                                                                                                                                                          | —                                                                | every `shipment` **and** `portion` on board (§1.4's own worked example); the `stop`s whose position or timing the change moves; the `assignment`s in force                                                                                            | **Owed — [A8 §9 item 8].** A8 §5 has no trip row, and no source in the corpus binds a plan change to an asserting role. **[ORIGINAL]** provisional: the party dispatching the trip — the `Hauler` holding the trip, or the `Booker` where it dispatches. **Do not score on this.** · `boundBy` **owed** — _not_ `CUSTODY`: a plan change is not a fact about the goods, and §4.8's fold does not reach it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`membershipOffer`** · **`membershipResponse`** · **`membershipRelease`** _(A3 §5.8's shipment-on-trip membership lifecycle: offered / accepted-or-declined / broken)_                                                                                                                                   | **`stopAction`** _(singleton)_                                                                                                                                                    | —                                                                | `trip`, `stop`, the `shipment` or `portion` whose membership it is, and the offering and responding `partyRole`s                                                                                                                                      | **Owed — [A8 §9 item 8].** **[ORIGINAL]** provisional: two-sided — the offering party for `membershipOffer` and `membershipRelease`, the responding party for `membershipResponse`. **Do not score on this.** · `boundBy` **owed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`assignmentOffer`** · **`assignmentResponse`** · **`assignmentRelease`** _(the assignment lifecycle: a resource assigned / accepted-or-declined / released)_                                                                                                                                            | **`assignment`** _(singleton)_                                                                                                                                                    | —                                                                | `trip`, `resource`, the `partyRole` the resource is offered to                                                                                                                                                                                        | **Owed — [A8 §9 item 8].** **[ORIGINAL]** provisional: as the membership rows, two-sided. **Do not score on this.** Note this is **not** A8 §4.3's `ASSIGNMENT` binding, which governs facts _about_ a resource; these are facts about the **binding itself**. · `boundBy` **owed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`orderAward`** · **`orderResponse`** · **`orderCancellation`** _(the order lifecycle: awarded / accepted-or-declined / cancelled — §1's opening paragraph and [`fork-order` §3.1](fork-order-shipment-cardinality.md)'s "award / accept / decline / cancel lifecycle, carried by `subject = order:…`")_ | **`order`** _(singleton)_                                                                                                                                                         | —                                                                | the `shipment`s committed under the order, **where there are any** ([`fork-order` §5.3](fork-order-shipment-cardinality.md): an accepted order with zero shipments is a legal state on a live RMC wire); the awarding and the responding `partyRole`s | **Owed — [A8 §9 item 8].** A8 §5 has no order row. **[ORIGINAL]** provisional: two-sided, as the membership and assignment rows — the awarding party for `orderAward`, the offeree for `orderResponse`, and for `orderCancellation` whichever party ended it, which is the distinction `src:dcsa` spends three status values on. **Do not score on this.** · `boundBy` **owed** — _not_ `CUSTODY`: an order is a commitment, not a fact about the goods, and §4.8's fold does not reach it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **act performance** _(the family, not a `type`)_                                                                                                                                                                                                                                                          | —                                                                                                                                                                                 | —                                                                | —                                                                                                                                                                                                                                                     | **Not a record type.** §4.1 names it as a fact-class _family_. Every act is its own `type` — the seven goods-side act rows above (`packing`, `loading`, `unloading`, `delivery`, `handover`, `storeIn`, `storeOut`) and the twelve plan-, binding- and commitment-side act rows (`tripDelay`…, `membershipOffer`…, `assignmentOffer`…, `orderAward`…) — and an act record is an Assertion whose `value` is `{occurredAt, outcome, reasons[]}` (§2). **A record may never carry `type = actPerformance`**; a type that names a family rather than an act would be the outcome-free second axis A-TYPE exists to prevent, and `outcome` would have nothing to attach to. The family's general rule: **an act's canonical subject is the aggregate the act is performed _on_** — `goods` where the act is performed on the goods, the `trip` / `stopAction` / `assignment` / `order` where it is performed on the plan, on a binding or on the commitment — and the place and journey are `context[]`. `arrival` and `departure` are **not** in this family: they are time facts about a _visit_, which is why their family is `stop` and why M5 lets a geofence assert them while M2/M3 forbid a geofence asserting any act in this row. |

#### 4.7.2 Where the table itself forced a decision

_(a)–(c) are revision 4's, on `pieceCount`, `charge` and `weight.tare`; (d) is revision 5's, on the
nine aggregate-lifecycle members added to §4.7.1; (e) is revision 5's, on the three order-lifecycle
members added to §4.7.1._

**(a) `pieceCount` declares a qualifier.** `src:x12-212-trailer-manifest` `AT8-04` **non-unitized**
(cartons) and `AT8-05` **unitized** (pallets, slip sheets) are "two separate counts that sum to one
total" — §4.1's own count-family citation. Two independently contested numbers about one subject is
precisely the case §1.3 says a `qualifier` exists for. **Sourced:** that the two counts are separate
and additive. **[ORIGINAL]:** rendering them as one `type` with a qualifier rather than two `type`s.
The qualifier keeps the total derivable and keeps `Reason.code`-style grain-independence (§2.4 rule
4); two types would put the sum in a consumer's head.

**(b) `charge` declares a qualifier, and this corrects [`A8` §5 row 11](A8-authority-skeleton.md).**
A8 names three authorities — propose, decide, rate — over "one fact class". Under the derived fact
key `(subject, type, qualifier?)` that would put a _proposal_, an _approval_ and a _price_ into **one
contest**, where an approval would compete with an amount. They are three independently contested
facts about one `charge`, so they are three fact keys: `{aspect}` distinguishes them and each gets
its own authoritative role, exactly as A8 already assigns. **[ORIGINAL]** as the mechanism; A8's
three-way split is the finding, and `src:milmove-mymove`'s `PaymentServiceItemParam.origin ∈ PRIME |
SYSTEM | PRICER | PAYMENT_REQUEST` — "i.e. _who asserted this number_" — is the corpus's own
precedent for tagging which of several asserters a priced input came from. A8 row 11 must adopt the
qualifier; it does not otherwise change.

**(c) The equipment's tare is a different fact from the consignment's tare, and the table refuses to
fuse them.** `src:x12-212-trailer-manifest` carries both, in two different segments and at two
different grains: `AT9-06` is the _"tare weight of trailer or container"_ — a standing property of
the equipment — while `AT8`'s qualified weight is the shipment's, with element 187 typing it
`G`/`N`/`T`. `src:nmfta-ebol` defines the consignment's `tareWeight` as _"weight of the
skids/pallets/slips used in the shipment"_ and defines `grossWeight`/`netWeight` **against** it.
So `weight.tare` on the `goods` family is the consignment's. **The equipment's own tare is a
`resource`-subject fact and therefore a different `type`; naming it is owed and is not done here** —
listed with the absent classes at §4.7.3. Two things make this worth a paragraph rather than a
footnote: `src:cfr-49-375` §375.509(a)(1)-(2) computes a shipment's **net** from a _vehicle_
weighing pair (gross-after-loading minus tare-before-loading, same vehicle), so the two grains meet
inside a published derivation and a model that fused them would silently make the trailer's standing
tare a competitor of the shipment's; and the fact key `(subject, type, qualifier?)` gives no other
protection, because the two would key identically if they shared a family. **Sourced:** both
definitions, verbatim, from two sources. **[ORIGINAL]:** the rule that they are separate types.

**(d) The nine aggregate-lifecycle members: three things the rows forced, decided here.** Their
**subjects are not decided here** — they are quoted from [`A3` §3.2](A3-trip-stop-assignment.md)'s
"Where each kind of fact lives" table, which already says `trip` for the trip-scoped class,
`stopAction` for the membership and `assignment` for the resource binding, and which cites
`src:smdg-delay-codes` (`ADHO`/`OMIT`/`ROTC`/`BLNK` as journey-level plan changes) and
`src:sirva-ade`'s `TripResourceAssign` ("carries trip numbers and **no shipment** — this record kind
exists in a live partner contract"). What the table forced is three smaller answers.

1. **Nine members, not three.** E-TYPE gives one vocabulary member per fact class and A-TYPE
   forbids a type that names a family rather than an act, so "the trip-scoped class" cannot be one
   `type`: a delay, a resequence and a cancellation are three different acts on one trip plan, and a
   single type with a `{transition}` qualifier would be the second classification axis §1.1 forbids,
   smuggled one field to the right. **[ORIGINAL]** as a count; it is forced by two settled rules.
2. **`…Offer` / `…Response` / `…Release`, and why not `accept` / `decline`.** A3 writes the
   membership lifecycle as "offered / accepted / **broken**" and the assignment as "assigned /
   accepted / released"; `src:atlas-world-group-api` supplies the offer/accept **verbs**
   (`PUT /Tonnages/request` + `/accept`) as column-name evidence and nothing more. Accept and decline
   are **not two acts**: they are the two outcomes of one act — the offeree answering — which is
   exactly what §2's `outcome` + `reasons[]` exists to carry. So the response is one `type` whose
   `outcome` is `COMPLETED` (accepted) or `NOT_COMPLETED` with at least one reason (declined), and
   minting `membershipDecline` as its own member would bake an outcome into a type name, which A-TYPE
   forbids in as many words. **[ORIGINAL]** as a spelling and as the offer/response split; the three
   transitions are A3's.
3. **No `qualifier`, and successive changes ride `supersedes`.** A trip delayed twice, or a
   membership re-offered after a break, is not two contested facts about one subject: it is one
   party revising its own assertion, which §4.1's `supersedes` already carries under the constraint
   it already states ("the SAME party with the SAME fact key"). A qualifier naming _which_ delay —
   the stop it moves, say — would put a subject reference in the payload, which §1.1 forbids
   ("a second subject hidden inside the payload"). So the fact key stays `(subject, type)` and the
   discriminator stays the subject: two trips are two trips, two memberships are two `stopAction`s.
   **[ORIGINAL]** as a decision; every mechanism it uses is settled text.

**And the half of A3 §5.8 that is not a membership type.** A3 writes the lifecycle as
"Offered → accepted → **loaded → in-transit → unloaded**". Only the first two and the break are
`stopAction`-subject records. `loaded` and `unloaded` are the `loading` and `unloading` act rows
above, on the `goods` family — publishing them a second time as membership transitions is the
double-counting §4.5 already rejected in the Alvys three-way split. `in-transit` is **not a record at
all**: it is a projection, and §1.1 forbids a mutable current-state field on the envelope.

**(e) The order lifecycle: three members minted here, and why minted rather than deferred.**

**The defect, which is K's defect one aggregate to the left.** §1's opening paragraph records that
"`fork-order` requires an order with its own award/accept/decline/cancel lifecycle";
[`fork-order` §3.1](fork-order-shipment-cardinality.md) carries _"award / accept / decline / cancel
lifecycle, carried by `subject = order:…`"_ and §5.3 carries the states an order occupies before any
shipment exists. §1.3 says **§4.7.1 is the complete type declaration**, and §4.7.1 had no order row —
so under **E-TYPE** those records carry no legal `type` and under **E-CANON-STRICT** they name no
declared family, and a binding document was specifying a record that could not be published.

**Minted, not deferred to §4.7.3, and the two lists are not interchangeable.** §4.7.3's absent list
is for fact classes **no settled text requires a record of** — cube, ETA, seal integrity, tracer and
claim facts, the equipment's own tare. The order lifecycle is not one of those: it is required by §1
and by `fork-order`'s own shape, exactly as the nine aggregate-lifecycle members were, and the
remedy that fits a required-but-undeclared record is the one K already applied — publish the family,
mark the authority **owed**, invent nothing. Deferring instead would leave §1's own requirement
unpublishable while recording the fact in a list whose other entries are things nobody has asked to
publish.

Four things the rows forced, decided here. The **subject is not decided here** — `order` is already
a subject kind (§1.2) and `fork-order` §3.1 already carries the lifecycle on `subject = order:…`;
it is quoted, exactly as the nine were quoted from `A3` §3.2.

1. **Three members, not four**, by the same two settled rules as (d) items 1–2. Accept and decline
   are not two acts: they are the two outcomes of one act — the offeree answering — so
   `orderResponse` carries `outcome = COMPLETED` (accepted) or `NOT_COMPLETED` with at least one
   reason (declined), and minting `orderDecline` would bake an outcome into a type name, which
   **A-TYPE** forbids in as many words. **[ORIGINAL]** as a spelling and as the offer/response split;
   the four transitions are `fork-order` §3.1's.
2. **Who ended it, and when, is carried by the stage plus `reasons[].attribution` — not by a type
   name.** `src:dcsa`'s booking lifecycle is the finding: `REJECTED` _"Booking discontinued by
   **carrier before** it has been Confirmed"_, `DECLINED` _"…by **carrier after** it has been
   Confirmed"_, `CANCELLED` _"…by **shipper**"_ (`bkg/v2/BKG_v2.0.5.yaml` L2461-2477). The DCSA
   analysis draws the conclusion outright — _"three of the nine values exist purely to record **who**
   ended the booking and **when in the lifecycle**"_, and it is _"the single most transplantable idea
   in the DCSA corpus for A1 — our order lifecycle has the identical problem (agent declines an offer
   vs van line pulls an awarded order vs shipper cancels)"_. **Sourced:** that who-ended-it-and-when
   is load-bearing and belongs in the data rather than in prose. **[ORIGINAL]:** encoding it as the
   **stage** (`orderResponse` before acceptance; `orderCancellation` after) plus
   `reasons[].attribution`, rather than as three type names — because three type names are three
   outcomes in the vocabulary, and §2.4 rule 6 has already lifted attribution off the code onto its
   own field for precisely this reason.
3. **A cancellation is an act with an outcome, and a refused cancellation needs no new mechanism.**
   DCSA runs cancellation on a _third_ status track (`bookingCancellationStatus` ∈
   `CANCELLATION_RECEIVED` / `_DECLINED` / `_CONFIRMED`) _"because cancelling a confirmed booking is
   itself a request the carrier can refuse"_. Under §2.3 that is already expressible:
   `orderCancellation` carries `outcome` like every other act. **Sourced**; no rule is added.
   Related and also already carried: `src:stedi-x12-reference`'s element 353 purpose code
   **`17 Cancel, to be Reissued`**, which the stedi analysis singles out as distinguishing _"withdraw
   this and expect a replacement"_ from _"withdraw this"_ — a distinction _"HHG needs constantly"_ and
   that _"no vendor API in this cluster has"_. **[ORIGINAL]:** placing it as a `reason` on the
   cancellation rather than as a second type.
4. **No `qualifier`, and successive changes ride `supersedes`** — (d) item 3's argument verbatim: an
   order re-awarded after a decline is one party revising or a new offer on the same subject, not two
   contested facts about one subject, and a qualifier naming _which_ award would put a subject
   reference in the payload, which §1.1 forbids. The fact key stays `(subject, type)`.

**The response vocabulary is richer than accept/decline, and §2 already holds it.**
`src:stedi-x12-reference`'s 204 → 990 tender conversation is the corpus's one published offer/response
protocol: `B1-04` Reservation Action Code (element 558) is four-valued — `A` Reservation Accepted,
**`B` Conditional Acceptance**, **`C` Counter Proposal Made**, `D` Reservation Cancelled — and the
stedi analysis records that a _"1997-vintage standard models conditional acceptance and counter-offer
as first-class responses"_ where project44's `BOOKED | REJECTED` does not, and that _"tendering a
shipment to an agent who accepts **except** the delivery date is the normal case in HHG"_. The 990
also carries its own per-stop `S5` loop with times and charges, _"so the acceptance can be per-stop
and can attach its own times and charges, not merely a yes."_ **Sourced:** the four-valued response
and its HHG relevance. What follows for this table is only that `orderResponse` needs no second type
to hold them — §2.2's five-member `outcome` enum and §2.4's `reasons[].remedy` are where they land.
**Which member each of `B` and `C` takes is A1's to declare and is not decided here.**

**Two grade notes, stated so the row is not read as better-supported than it is.**
`src:weichert-supplier-api` supplies the HHG-native procurement lifecycle
(`Requested`/`Awarded`/`Accepted`/`Submitted`/`In Progress`/`Delivered`/`Completed`, §4.1's state
row) and the observed behaviour that **accept is expressed as an update carrying an empty
`shipments` array** ([`fork-order` §5.3](fork-order-shipment-cardinality.md), `odt:322`) — but that
document _"states no lifecycle, no transitions and no actor anywhere (its own A1 C3=1)"_. It is
**observed API behaviour, grade B**: evidence that award and accept are separate, addressable,
order-level events on a live RMC wire, and evidence of nothing else. `src:sirva-ade` is cited here
for one thing and it is a **warning, not a shape**: its `Cancel` _"carries nothing further — no
reason code"_ ([`fork-order` §2a](fork-order-shipment-cardinality.md) P3b, SOE p.15), which is
exactly the record §2.3 invariant 2 forbids — and it is **shipment**-scoped in that contract, not
order-scoped, so it supports nothing about the order's subject.

**`context[]`** carries the `shipment`s committed under the order **where there are any** — zero is
normal and is a legal state on a live wire (`fork-order` §5.3) — plus the awarding and the responding
`partyRole`s. That is §1.4's own worked pattern extended mechanically, as the nine rows' `context[]`
was; **[ORIGINAL]** to the same degree and no further.

#### 4.7.3 Named in the corpus, in the table only as far as the shared layer already fixes them

`notification` and `partyRole` are members of §1.3's vocabulary list but were not in the blocker's
set, and no source fixes a subject for either. Both rows are **provisional**.

| `type`         | Canonical subject family                                                                                                                                                                        | `context[]`                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification` | **`goods`** — **[ORIGINAL]**, on the ground that `src:dp3-tender-of-service` §C.3.c states the duty per shipment ("update DPS Shipment Management Remarks immediately after each notification") | the record that triggered the obligation (via `evidence[]`), `stop`, the parties | **The recipient has no field.** [`A8` §9 item 6](A8-authority-skeleton.md) owes "the party as a notification target", and §6.5's obligations cannot name a contactable party until it lands. Provisional.                                                                                                                                                                          |
| `partyRole`    | **`partyRole`** — the role-holding itself is an aggregate (§1.2)                                                                                                                                | the `shipment`/`order`/`trip` the role is held over; the party                   | **[SYNTHESIS]** of §1.2 (the aggregate exists) and [`A3` §3.2](A3-trip-stop-assignment.md)'s row for `stopAction` ("a fact about the _relation_, not about either end"). Carries `effectiveFrom`/`effectiveTo` per §7.1 and is never overwritten (A8-HISTORY). Provisional: [`A8` §9 items 1-2](A8-authority-skeleton.md) leave both the party entity and the role enum undefined. |

**Fact classes deliberately absent, so their absence is not read as an oversight:** cube, survey and
estimate facts, ETA, seal integrity, tracer results, claim facts, **the equipment's own tare weight**
(§4.7.2c — a `resource`-subject fact needing its own `type`), and every A10/A11 class.
[`A8` §9 item 8](A8-authority-skeleton.md) lists them; each needs a row here **and** an A8 row before
its area can score a dependent decision high.

**And two act types this document's own prose names that the vocabulary does not contain:
`weighing` and `unpacking`.** §2.5's A-TYPE example named **`weighing`** as a legal act type, and
[`A3` §3.2](A3-trip-stop-assignment.md)'s `StopAction` verb list names both `weigh` and `unpack`;
neither has a row in §4.7.1, and neither was in the paragraph above. **Both are recorded here as
absent and owed**, and §2.5's example is corrected to name only members the vocabulary actually
contains. Neither appears in [`A8` §9 item 8](A8-authority-skeleton.md)'s enumeration either, so each
needs a row here **and** an A8 row on the same terms as every entry above.

The argument for **minting** them instead is real, and is recorded rather than buried.
`src:cfr-49-375` §375.509 and `src:dp3-400ng` Item 4 make weighing and **reweighing** first-class
regulated acts with their own evidence — the weight ticket, which 400NG Item 4.10 makes a six-field
record with its own retention rules (§1.2) — 400NG Item 4 Note 2 and Item 4.11.d state duplicate- and
original-vs-reweigh rules over them (§4.4), and `src:x12-212-trailer-manifest` element 187 types the
reweigh values separately (`RG`/`RN`/`RT`, §4.1). `unpacking` is the exact mirror of `packing`, which
§4.7.1 does carry. Two things stop this table minting them anyway:

- **`weighing`'s canonical family cannot be read off the corpus, and choosing one here would decide
  §4.7.2c's open half by side effect.** The one published derivation in the corpus —
  `src:cfr-49-375` §375.509(a)(1)-(2) — computes a shipment's net from a **vehicle** weighing pair
  (gross-after-loading minus tare-before-loading, same vehicle). So the act is performed on a
  `resource` while the fact it yields is about the `goods`; §4.7.2c has already refused to fuse those
  two grains and has already left the `resource`-subject weight type **owed**. Under the act family's
  own general rule — _"an act's canonical subject is the aggregate the act is performed on"_ — the
  answer is `resource`; under every other act row in this table it is `goods`. **No source settles
  it**, and a declaration table does not settle it by preference.
- **§10.1 item 20 already directs `A3` to record `unpack`, `weigh` and `survey` against this list
  rather than mint one**, and that is binding text. Minting `unpacking` here while `A3` is told to
  record it as absent would put the two halves of one decision in contradiction. `unpacking` is
  deferred alongside `weighing` for that reason and for no evidentiary one — **its family is not in
  doubt**, and it is the cheapest of these rows to mint once A8 §9 item 8 lands.

**[ORIGINAL]** as a deferral. The regulatory standing of the acts is sourced and is not in dispute;
what is missing is a family for one of them and an authority row for both.

**And one that is absent because it is not a fact class at all: `custody`.** `fork-time` §8.8 asserts
"a `custody` fact over the interval with `subject = shipment:S`". There is no such `type` and there
will not be one. Custody is a **projection** over the `handover` row above; **§4.8** is the decision,
and it is the reason `custody` appears in neither this table, nor §4.7.3's provisional rows, nor
§1.2's aggregate enum.

### 4.8 What `Custody` is: a **projection**, folded from `handover`

> **Decision. `Custody` is neither an aggregate kind nor a fact class. It is a projection —
> a named, versioned fold over the `handover` assertions selected by `FactResolved` (§4.7's
> `handover` row) and over `ExternallyPerformedLeg.custodyBasis` (§8.2). It is never stored, never
> asserted and never corrected. `boundBy = CUSTODY` names **that fold**, and every input the fold
> reads is a published record in the envelope.**

#### 4.8.1 Why this needed deciding

`Custody` was three different things in three documents and was in none of this document's
structures. [`A3` §3.2](A3-trip-stop-assignment.md) stores it — its shape diagram carries
`Custody ──(interval)──▶ Shipment` in the stored spine and §5.2 item 2 claims it as
"**[ORIGINAL]** Custody as a first-class **interval**". [`fork-time` §8.8](fork-time-provenance-corrections.md)
publishes it as a **fact class** ("assert a `custody` fact over the interval with
`subject = shipment:S`"). [`A8` §4.2 and §7.4(c)](A8-authority-skeleton.md) read it as a
**projection** — "the custody history changes, the authority function over it changes, and a **new**
`FactResolved` is published". Meanwhile `boundBy = CUSTODY` is what [`A8` §4.3](A8-authority-skeleton.md)
binds **eight fact classes** to (arrival, departure, load, unload, delivery, condition, SIT entry
inputs, SIT release), and seven of A8 §5's eleven rows carry it. A binding whose target exists in
none of §1.2, §1.3, §4.7 or §4.7.3 is not checkable, and under **E-CANON-STRICT** the `fork-time`
reading is worse than unchecked: a record carrying `type = custody` names no declared family, so it
is rejected at the boundary and the fact is unpublishable.

#### 4.8.2 The decision, and the three candidates

**Projection wins. An aggregate kind and a fact class are both rejected**, for reasons that are
internal to settled text:

- **Not an aggregate.** §1.1 forbids a mutable current-state field and says so as a rule: _"The
  catalog publishes assertions; state is a projection."_ An interval whose `until` is unknown when
  it opens and is written when the next handover lands is that field, one table to the left. And
  `A3` states the disqualifying test itself, about its own `Leg`: legs are folds, and _"**storing them
  is how they come to disagree with the records.**"_ Custody is a fold over the same acts and inherits
  the same verdict; at revision 4 A3 applied the rule to one of its two derived things and not to the
  other — its `Leg` definition named `Custody` intervals among the things legs fold over, and revision
  5 restates that phrase as `custodyAt(goods, instant)` on both sides of this quotation.
- **Not a fact class.** The act is already in the vocabulary. §4.7's **`handover`** row declares
  family `goods`, the releasing and receiving `partyRole`s in `context[]`, and `custodyBasis` 41 vs
  349 as what decides whether authority moves. A second member asserting the same thing as an
  interval is two homes for one fact — defect **B** and defect **C** of revision 3, in a third
  place. It is also circular where it matters most: a `custody` fact class would need an authority
  row, and that row's binding would be `CUSTODY`, so **A8-MOVE would be defined in terms of the
  thing it defines.** The fold breaks the circle — `handover`'s authority is decided on its own row
  (both sides assert, the `J1`/`R1` pair), and custody is computed from the result.
- **Projection.** The fold reads records that already exist, adds no field, and inherits
  append-only history for free: when a `handover` contest is re-resolved, the custody function over
  it changes and nothing is rewritten — which is precisely the mechanism
  [`A8` §7.4(c)](A8-authority-skeleton.md) already relies on and §6.6 already uses for a corrected
  derivation input.

**What the corpus supplies, and what is ours.** Every source the corpus carries here publishes the
**acts** and none publishes the interval — which is the evidence for the fold and against the entity:

- `src:uncefact-rec24` **41** `Handed_over_under_continued_responsibility` vs **349** `Handed_over`
  are **two status codes on a handover**, and `A3` §5.2 says so in its own words: the source
  _"supplies it as two status codes, **not as an entity**."_
- `src:stedi-x12-reference` element 1650's **`J1`** Delivered to Connecting Line / **`R1`** Received
  from Prior Carrier are, in the stedi analysis's words, _"two complementary assertions by two
  different [parties]"_ — two acts, two asserters, no interval between them on the wire.
- `src:cfr-49-375` §375.205's **prime agent** acts for the carrier under a signed written agreement
  retained 24 months and is expressly not a broker or forwarder; the carrier's duties do not
  delegate. With **A8-LIABILITY** ("a custody handoff moves assertional authority and moves nothing
  else"), an entity called `Custody` sitting in the stored spine is the shape most likely to be read
  as owning responsibility it does not own. A derived index cannot be read that way.
- `src:dtr-part-iv`'s **named instruments** — SF 1200's Authority for Correction block, and A-413
  §H.2's authority created by thirty days of the issuing office's silence — grant authority with **no
  custody change at all**. So authority is not a property of a custody object; it is a function
  evaluated at an instant, over which an instrument can sit. `boundBy = CUSTODY` must therefore name
  a function, which is what §4.8.3 makes it name.

**[ORIGINAL]:** the fold, its `UNKNOWN` outcome, and the rule that it is never stored. **Sourced:**
the acts, the two bases, and the two-asserter shape of a handover.

#### 4.8.3 The fold, stated so it is testable

```
custodyAt( goods : shipment | portion , instant )  →
    { holder      partyRole      from the selected handover's receiving side
      basis       41 | 349       the selected handover's custodyBasis
      since       instant        that handover's occurredAt
      until       instant?       the next selected handover's occurredAt, where one exists
      evidencedBy eventId[]      every handover assertion and FactResolved the fold read }
  | UNKNOWN
```

Four rules make it usable:

1. **Its inputs are `FactResolved`-selected `handover` assertions and nothing else** — plus, where
   the movement is an `ExternallyPerformedLeg`, that leg's declared `custodyBasis` and `performedBy`
   (§8.2). Both are published records. The fold reads no field that is not one.
2. **It is a named, versioned rule**, `{ruleId, ruleVersion}`, the same shape as `FactResolved.rule`
   (§4.3) and `E-CANON-RESOLVE`'s subject-resolution rule (§4.6.2). A consumer that asks "who held
   the goods at 14:05 on 3 March" gets an answer that names the rule that produced it.
3. **`UNKNOWN` is a real outcome and is never filled in.** Before the first handover, and across a
   cross-dock dwell where only one of the two handovers has been published, the fold returns
   `UNKNOWN`. It does not fall through to the last known holder, to the trip's current assignee, or
   to the party that spoke most recently — that would be **A8-NAMED**'s implicit last-writer-wins
   returning through the back door, and **M1**'s record-versus-fabrication argument applies
   unchanged.
4. **Nothing `A3` modelled is lost; only its storage is.** A3's five fields — party, from, until,
   basis, evidencing act — are the five the fold returns. What changes is that they are computed
   rather than written, so they cannot drift from the acts that produced them.

**What this settles for `boundBy = CUSTODY`.** [`A8` §4.3](A8-authority-skeleton.md)'s `CUSTODY` row
currently reads "Authority follows the `Custody` interval (`A3` §5.2)" — a pointer to a stored entity
that does not exist in the envelope. It now reads: **authority follows `custodyAt(goods, instant)`,
this section's fold**, evaluated at the instant the fact is _about_ per **A8-INSTANT**, and moving at
a boundary per **A8-MOVE** on the selected handover's `custodyBasis`. A8's §7 is unaffected in
substance: 41 versus 349 still decides whether authority moves, and §7.6's scenario still resolves
the same way — because the two `Handover` acts it publishes are exactly the fold's inputs.

**What this does _not_ settle.** Whether the cross-dock dwell between two handovers is a `stay`, a
SIT occupancy or neither remains A5's (§10.4), and the fold is deliberately indifferent to it: it
answers who holds the goods over the dwell without naming what the dwell is.

---

## 5. The machine-assertion rule, cut by **capture method**

> **Decision. The rule binds on `capturedBy`, not on "a device". `ASSUMED_FROM_PLAN` may never
> carry `basis = ACTUAL`. Possession-changing facts and all exceptions require a human or partner
> asserter. Geofences may assert arrive and depart. One derivation is sanctioned and named.**

`fork-time` bound the rule to "a device", which forbade the harmless case (a geofence marking
arrival) and left the case the rule exists for — `ASSUMED_FROM_PLAN`, "nobody asserted it; the plan
stood unchallenged" — entirely unguarded.

### 5.1 `capturedBy` — retained, seven members

`OBSERVED_BY_PERSON` · `KEYED_BY_PERSON` · `DEVICE_GEOFENCE` · `DEVICE_TELEMETRY` ·
`PARTNER_ASSERTED` · `DERIVED_BY_RULE` · `ASSUMED_FROM_PLAN`

Each traceable to a source (Shippeo `manual`/`geofencing`; Omnitracs `DispatcherEntered`,
`GeoComputed`, `IgnitionComputed`/`OdometerComputed`, `Computed`, `AssumedFromProjection`; p44
`GEOFENCE`, `TELEMATICS`, `CARRIER`, `P44_DETECTED`+`definitionId`; DCSA `publisherRole`; Samsara
`driver`/`admin`). This part of `fork-time` §(b)(2) is sound and is carried forward unchanged.

### 5.2 The rules

**M1. `ASSUMED_FROM_PLAN` may never carry `basis = ACTUAL`.** A plan that nothing contradicted is
a plan. It is published at `basis = PLANNED`, and `FactResolved` is what answers "our best current
value" — so the operational need is met without fabricating an observation.
**[ORIGINAL], and it departs from a source:** `src:omnitracs-roadnet` carries
`AssumedFromProjection` as a `DataSource` value _on a measured actual_. We forbid that. The
argument is `fork-time`'s own and it is right: without the distinction, "a planned value that
nothing contradicted is indistinguishable from an observation, which is the difference between a
record and a fabrication."

**M2. Possession-changing facts may be asserted at `basis = ACTUAL` only with
`capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`** — never `DEVICE_*`, never
`ASSUMED_FROM_PLAN` (already excluded by M1), and `DERIVED_BY_RULE` only under M4. The catalog
publishes the possession-changing list: **packed, loaded, unloaded, delivered, stored in (`storeIn`),
released from storage (`storeOut`), custody handed over, item accepted, item refused.**
**[ORIGINAL]** as a list; the principle is Shippeo's (M3).

> **These are acts, and only acts.** The previous revision's list read "placed in SIT / released
> from SIT", which collided head-on with M4: M2 required a human or partner asserter for "placed in
> SIT" while M4 made the SIT entry date mandatorily `DERIVED_BY_RULE`. The collision was real and is
> resolved in the only way it can be — **the act and the date are two different fact classes**
> (§5.3). `storeIn` is the act: a crew put the goods into a facility, at a moment somebody witnessed.
> `sitEntryDate` is the tariff-effective date on which storage begins to accrue, which nobody
> witnesses and which is computed. M2 governs the first. M4 governs the second. Neither governs the
> other.

**M3. Every act record with `outcome ≠ COMPLETED`, and every `Reason`, requires
`capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`.**
_Sourced, and precisely:_ `src:shippeo`'s `event-list-order-level.md` carries a final column,
"Based on geofence?", and **exactly seven of its 38 rows are marked `Yes`** — `ARR_LOAD`,
`CON_LOAD`, `LEFT_LOADING_SITE`, `ARR_UNLOAD`, `CON_UNLOAD`, `DRIVER_LEFT_UNLOAD`, `ETA_EVENT`
(`:7, :8, :11, :19, :20, :24, :39`). **Not one of the geofence-marked rows is an exception row**:
25 of the 38 carry a justification other than `CFM` conform, `ARS` arrival or `DES` departure, and
every one of the 25 is blank in the geofence column.

> **Count correction, inherited by all four documents.** Every document said "41 rows" and "7 of
> 41". The committed file `sources/shippeo/local/event-list-order-level.md` is 40 lines: one header,
> one separator, **38 data rows**. It carries 18 distinct justification codes across 10 distinct
> situation codes (`EPC` 2, `COM` 3, `EML` 2, `ECH` 4, `ENE` 5, `MLV` 1, `AEC` 1, `LIV` 6, `REN` 13,
> `POD` 1), not "~20 across 9", and `REN` has 13 rows rather than 12. The "24 exception rows" figure
> is likewise an inherited approximation and is replaced by the measured 25 non-conform rows above.
> **The finding is unaffected in every document that uses it** — seven geofence-marked rows, none of
> them an exception — and only the arithmetic changes. It is corrected once, here, and in the three
> decision documents at the points they restate it.

**[ORIGINAL] where the rule goes beyond the cite:** Shippeo's published rule is about _geofence
eligibility_ over those 38 order-level rows. Extending it to all machine assertion of exceptions is
our step, and it makes our rule **stricter than the source** — Shippeo itself derives
`CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` from position, i.e. a machine asserting _why
something is late_. We forbid that; Shippeo does not.

**M4. The sanctioned derivation.** `DERIVED_BY_RULE` is permitted on a fact class the catalog has
declared derived **only** where the catalog publishes the derivation as a named rule and the record
carries `{ruleId, ruleVersion}` **and the `eventId`s of its inputs**. M4 does **not** reach into M2's
list: it licenses a _different_ fact class, never a derived substitute for an act somebody was
supposed to witness (§5.3).

One case exists today and it is mandatory, not merely permitted: **the SIT entry date
(`type = sitEntryDate`).**

- `src:dp3-400ng` Items 29.4, 29.6, 17.20: "SIT in date will be equal to the TSP's **first
  available delivery date**"; the SIT effective date is "always… the TSP's first available delivery
  date, not the date of notification"; and "**the arrival date must NOT be entered as the SIT entry
  date**" unless they coincide.
- `src:dtr-part-iv` §D.5.b(2) NOTE (p.18): SIT is effective "the date the shipment was **offered
  for delivery**, not the date it arrived."

Two independent regulatory sources, the same rule, from opposite directions. Consequence: **a keyed
arrival date published as the SIT entry date is a detectable defect**, and the catalog can detect it
because M4 requires the derivation to be declared.

**M5. What a geofence may assert.** `DEVICE_GEOFENCE` may carry `basis = ACTUAL` for **arrival at a
stop, departure from a stop, position, and ETA change**. _Sourced:_ five of Shippeo's seven
geofence-eligible rows are exactly these (`ARR_LOAD`, `LEFT_LOADING_SITE`, `ARR_UNLOAD`,
`DRIVER_LEFT_UNLOAD`, `ETA_EVENT`).

**M6. Shippeo's two defects here are named and rejected.**

- **(a) Geofence-derived conformity.** The remaining two of the seven are `CON_LOAD` and
  `CON_UNLOAD` — _conformity_ assertions, "goods were loaded conform", "goods delivered with no
  observations". A geofence can witness a departure; it cannot witness that nothing was missing.
  Shippeo's own analysis calls it "a convenience, and adopting it would silently manufacture
  evidence." Under M2 and M3 it is inexpressible here. (HHG conformity is not one bit anyway: it is
  per-item against a signed inventory — which is why it is a `condition` fact class at `item` grain,
  §4.1, not a flag on a delivery.)
- **(b) A two-valued trigger enum that cannot describe its own publisher.** `trigger.type ∈
{manual, geofencing}` is **required** on every outbound standard event
  (`OrderSituationJustificationTrigger`, `required: [actor, type]`), and Shippeo emits at least
  **four** kinds: declarative; geofence-derived; **schedule-derived** — `DRIVING_TO_LOAD` "can be
  declarative (by the carrier) **or Shippeo triggered 1 hour before the beginning of the pickup
  start slot**" (`event-list-order-level.md:6`, same for `DRIVING_TO_UNLOAD` at `:17`); and
  **computation-derived** — `CALCULATED_DELAY_DRIVING_TOWARD_SITE_*`. **Two of the four have to lie
  on the wire.** Our seven-member enum covers all four: schedule-derived is `ASSUMED_FROM_PLAN` (and
  therefore, under M1, may not be ACTUAL), computation-derived is `DERIVED_BY_RULE`.

**M7. `capturedBy` eligibility is declared per record `type` in the catalog and enforced on the
wire.** Shippeo publishes it as a table column and enforces only that `trigger.type` is present.
**[ORIGINAL]:** promoting the table to a wire-enforced per-type declaration. Shippeo's analysis
recommends the direction — "make it a property of the event type, not a runtime guess" — but the
enforcement is ours.

_Restated (§1.3)._ The previous wording was "per (`type` × `factClass`)", which presumed the two
axes this revision collapses. There is one axis, so the declaration is per `type` and nothing is
lost: the product's second factor was always degenerate. The declaration sits in the same per-type
vocabulary entry as E-CANON's canonical subject family, which is the point — **one entry per record
type, carrying everything the boundary must check about it**: its legal subject family, its
`qualifier` shape, its `value` shape, and its eligible capture methods. Where a rule needs to
distinguish two facts that one loose type name would fuse — the store-in act from the SIT entry date
(§5.3) — the answer is **two vocabulary entries**, not a second axis.

### 5.3 The store-in act and the SIT entry date are two fact classes

> **Decision. `storeIn` (the act of placing goods into a storage facility) and `sitEntryDate` (the
> date storage becomes effective for accrual and for the tariff clock) are two distinct members of
> the record vocabulary, with different subjects, different asserters and different capture rules.
> Neither is derivable from the other and neither may be published as the other.**

|                             | `storeIn`                                                              | `sitEntryDate`                                                                       |
| --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| What it is                  | an **act**: a crew put the goods into the facility                     | a **date**: when storage starts counting                                             |
| Canonical subject (E-CANON) | `stay`                                                                 | `stay`                                                                               |
| Value                       | `{occurredAt, outcome, reasons[]}` (§2)                                | a date                                                                               |
| `capturedBy`                | M2: `OBSERVED_BY_PERSON` / `KEYED_BY_PERSON` / `PARTNER_ASSERTED` only | M4: `DERIVED_BY_RULE`, **mandatorily**, from the TSP's first available delivery date |
| Who can say it              | the warehouse agent or the TSP crew who did it                         | the platform, by named rule, from inputs it names                                    |

**Why this is forced and not a convenience.** The two rules collided in the previous revision — M2
demanded a human for "placed in SIT" and M4 demanded a derivation for the SIT entry date — and a
single fact class cannot satisfy both. The regulations resolve it in our favour and say so in the
sharpest possible terms: 400NG Item 29.6 / 17.20 forbid entering the **arrival** date in the SIT
Entry Date field unless the two happen to coincide, and DTR §D.5.b(2) NOTE says SIT is effective on
the date the shipment was **offered for delivery**, not the date it arrived. A rule that has to
forbid entering one date into the other field is a rule asserting that the two are different facts.

**What is sourced and what is ours.** _Sourced:_ that the SIT entry date is computed from the first
available delivery date, and that a physically-observed date (arrival) must not be substituted for
it. **[ORIGINAL]:** stating the same separation over the **store-in act** specifically. The tariff
names _arrival_, which is the case it cares about because arrival is what DPS already holds; it does
not discuss the moment the crew put the goods on the warehouse floor. Extending "the observed
physical date is not the accrual date" from arrival to store-in is our step. It is a small step —
store-in is, if anything, further from the accrual date than arrival is, since the goods may sit on a
dock first — but it is a step, and it is the step the M2/M4 reconciliation actually rests on.

**Two consequences worth stating, so they are not rediscovered.**

1. **Origin-side SIT and destination-side SIT both get this treatment**, because both are `stay`
   subjects, and a shipment may carry one of each concurrently (`src:sirva-ade` cannot say which of
   the two a `ChangeSIT` refers to — §7.4 — which is exactly the defect the `stay` grain prevents).
2. **The derived date's inputs are assertions, so correcting one is not correcting the date.** If
   the first available delivery date is retracted, the platform publishes a _new_ derived
   `sitEntryDate` assertion and a new `FactResolved`; it never corrects the warehouse agent's
   `storeIn` act, which remains true whatever the tariff clock says (§6.6).

### 5.4 The item-vs-Portion grain, when a fact is about one article

> **Decision. If the fact has a value _per article_, its subject is the `item` and no Portion is
> minted. If the fact is an act on the shipment and the question is _which part of the shipment the
> act reached_, the answer is a `Portion` — even a Portion of one item — named in
> `reasons[].appliesTo`. The two are not alternatives and neither is a shorthand for the other.**

The test is one question: _does this fact have a different value for each article, or does it have
one value and a scope?_ Per-article condition at receipt and at forwarding (`src:dp3-400ng` Item
17.12.c, `src:cfr-49-375` §375.503's itemized inventory with per-article ids and condition), an
article's inventory number, an article's declared value: these have a value per article, they are
`item`-subject assertions, and wrapping one in a Portion would add an identity nobody needs and a
contest nobody is having. "Delivered, two items short" is the other shape: one `Delivery` act on the
shipment, one value, `outcome = PARTIALLY_COMPLETED`, and a scope — the two items that did not
arrive — which needs its own identity precisely because a later act will have to refer back to _the
same two_ when they surface in SIT a week later (§3.4). A one-item Portion is therefore legal and is
sometimes right: one refused article, named as the scope of a delivery act, is a Portion of one, not
an `item`-subject assertion, because the fact being asserted is about the delivery and not about the
article. **[ORIGINAL]** as a rule; both halves are the shared layer's own §1.2 and §3 read together,
and it is written down because the previous revision left "an `ENUMERATED` Portion of one item is
legal" (§3.3) sitting next to "`item` remains a subject kind" (§3) with nothing to choose between
them.

---

## 6. Corrections outside a legal amendment window

> **Decision. Every correction attempt is recorded. There is no refusal path. A correction outside
> its amendment window is recorded, flagged `INEFFECTIVE`, never applied to the priced record, and
> emits its notification obligation.**

`fork-time` §5.1 had "a correction outside the window is **refused rather than recorded**", which
obliges the catalog to retain a fact it knows to be false — the exact failure the document exists
to prevent — and contradicts its own §5.4, which requires corrections to emit obligations (a
refused correction emits nothing).

### 6.1 Three outcomes, all recorded

| Outcome        | Meaning                                                    | Effect                                                                                                                     |
| -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `APPLIED`      | Inside the window, by an authorised party.                 | Enters the contest; `FactResolved` republished.                                                                            |
| `INEFFECTIVE`  | Outside the window.                                        | **Recorded. Flagged legally ineffective. Never applied to the priced record.** Emits the obligation. Queryable as a class. |
| `UNAUTHORISED` | The declaring party has no authority over this fact class. | Recorded, not applied; emits an obligation to the party that does have authority.                                          |

### 6.2 What the sources say, and what is ours

- `src:cfr-49-375` **§375.401(i)**: an estimate may be amended by mutual agreement **only before
  loading** — "You may not amend the estimate after loading the shipment" (`cfr-49-375/analysis.md`
  line 141, xml:262). §375.403(a)(7): silence after loading constitutes reaffirmation. The
  regulation binds **the parties and the price**.
  **[ORIGINAL]:** that a records system may nonetheless _record_ the attempt and mark it
  ineffective. The regulation does not address recording either way, and this document's rule is
  our reading, not the regulation's text. It is the right reading — a catalog that cannot record an
  attempted late amendment cannot explain why the priced record differs from what the customer
  believes — but it is ours.
- `src:dp3-400ng` Introduction p.14 and Item 17.10: **authority is asymmetric and instrumented.**
  "The TSP/Agent will not redact, modify, or remove any information on the BL… The government is
  the only authorized agency who can redact, modify, or remove information on the BL **through an
  SF1200**", and destination changes come as a **correction notice** that "must be recorded on the
  BL." Sourced, and it is why `Correction.authority` names an _instrument_, not just a party.
- `src:dp3-400ng` Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c: refunds, reimbursements and re-bills are
  **additional coded transactions carrying a narrative note**, never edits to the original charge.
- `src:sirva-ade` ABS p.3: the financial correction triple — `AdjCode` blank Original / `ADJ`
  adjustment / `CAN` cancel — with the stated, testable invariant that a `CAN` "combined with the
  'Original' amounts will **zero out** the shipment", and `BatchNbr` distinguishing reruns.
- `src:gs1-epcis-cbv`: `errorDeclaration` — "indicates that this event serves to assert that the
  assertions made by a prior event are in error" (`Ontology/EPCIS.ttl` L451-456) — with
  `did_not_occur` vs `incorrect_data`, `correctiveEventIDs`, a separate declaration time, and
  **queryability as a class** (`EXISTS_errorDeclaration`, `EQ_errorReason`, `EQ_correctiveEventID`,
  `GE_/LT_errorDeclaration_Time`). Retained in full from `fork-time`.

### 6.3 The priced record

> **Operational facts are corrected by supersede/retract. Financial facts are corrected only by an
> offsetting record, never by retraction — and an `INEFFECTIVE` correction never reaches the priced
> record at all.**

Sourced by `src:sirva-ade`'s `AdjCode` invariant and `src:dp3-400ng`'s coded-refund practice above,
and independently by `src:uncefact-scrdm`, which models `Financial_Adjustment` as an entity separate
from `Delivery_Adjustment`.

### 6.4 The retraction semantics, fixed

`fork-time` §(c) adopted two incompatible rules in one paragraph: `DID_NOT_OCCUR` "**SHALL NOT**
name a replacement — EPCIS's rule, adopted verbatim" **and** "it **restores the prior assertion** of
the same fact": `src:x12-858-implementation-guide`'s `01` semantics. Retract-to-previous _is_ a
successor assignment.

> **Decision. EPCIS's rule is kept: a `DID_NOT_OCCUR` retraction names no replacement. The 858's
> restore-to-previous is kept as an _intent_ and dropped as a _mechanism_. A retraction removes the
> retracted assertion from the contest; the catalog then republishes `FactResolved` over what
> remains.**

Why: the 858's `01` is defined over an ordered status history on **one carrier's own message
stream** — "a purpose code (BX01) of '01' is used to specify that the previous status… is to be
cancelled" (p.7-8) — not over multi-party assertions of arbitrary facts. Applied across parties it
silently promotes some other company's assertion, which the retracting party may have no authority
to affirm. Republishing `FactResolved` achieves the 858's intent (the answer reverts to the best
remaining one) with the authority chain intact and the rule named.
**[ORIGINAL]:** the mechanism. **Sourced:** the intent, and the observation that the 858 is the only
source in the corpus that writes an answer down at all.

### 6.5 Corrections emit obligations

`fork-time` §5.4 — a fact carries the clocks that depend on it, and correcting such a fact emits a
notification event naming who must be told and by when — is **retained, correctly marked
[ORIGINAL]**, and is now **extended to `INEFFECTIVE` and `UNAUTHORISED` corrections**, which is what
resolves the §5.1/§5.4 contradiction. Why obligations exist at all is sourced:
`src:dp3-tender-of-service` §C.3.c makes delivery notification a duty with a deadline (at least 24
hours' notice), an escalation (two documented unsuccessful contact attempts six hours apart, the
final one telephonic), a required content list (§C.3.e-f) and a recording obligation ("update DPS
Shipment Management Remarks immediately after each notification"); `src:cfr-49-375` opens a
nine-month claims window.

### 6.6 One consequence for §5.2's cascade

`fork-time` §5.2 requires a correction to an input of a derived actual to cascade as an automatic
supersession. The critique found three of the document's own rules colliding on the SIT case: an
automatic cascade is a correction to a warehouse-authoritative, legally load-bearing date, declared
by the platform, with no authority the model grants it. Resolved by the shape here: **the cascade
is not a correction.** The derived value is an Assertion with `capturedBy = DERIVED_BY_RULE` (M4);
when an input is retracted, the platform publishes a **new** derived Assertion and a new
`FactResolved`. The platform asserts what it derived, which it plainly has authority to do; it never
corrects the warehouse agent's fact.

---

## 7. Identifier shape

> **Decision. An identifier is an Assertion of `type = identity`. It carries a vocabulary scope and
> an effective interval, it attaches at every aggregate grain, and `primary` is not a stored flag
> but the output of `FactResolved` — resolved per `(subject, scheme, vocabularyScope)`, which is
> the identity type's own fact key and nothing special.**

### 7.1 The shape

```
Identifier = Assertion { type = identity }

  qualifier                                    the type's declared qualifier (§1.3)   MANDATORY
    scheme           the naming system, which DEFINES who assigns and what it identifies
    vocabularyScope  { authority, tariff?, brand?, year?, programme? }

  value                                                                               MANDATORY
    id               verbatim as the counterparty gave it; never canonicalised in storage
    issuer           the PARTY that assigned this id under that scheme, in that scope
    effectiveFrom / effectiveTo   the interval over which this attribution holds
```

`subject` may be **any** aggregate kind (§1.2). `supersedes` links a reissued value to the one it
replaces.

> **Rule I-KEY. The identity fact key is `(subject, scheme, vocabularyScope)`. Arity is N per that
> tuple, and `primary` resolves per that tuple.** One key, stated once, used by both rules.

**What this fixes.** The previous revision keyed arity on `(subject, scheme, scope)` but resolved
`primary` "for one `(subject, scheme)`" — a real, load-bearing mismatch and not a typo. Under the
looser resolution key, an agent booking for two van lines holds two registration numbers under the
**one** scheme `vanline.registration` with **different brand scopes** (`AVL`, `NVL`), both
concurrently valid and both correct, and `FactResolved` was obliged to run a contest between them
and declare one the loser. There is no contest: they identify the same subject in two different
naming vocabularies. With the scope in the key there are two contests of one, two primaries, and
nothing to adjudicate. This is `src:sirva-ade`'s own arrangement read straight — the addressable key
is the triple `Brand + RegNumber + RegYear`, and `Brand` "scopes every id" (GSD p.15) — and it is
also what §7.4's two-ids-per-trip case needs (`QPDTripNumber` and `CamisTripNumber` are two
_schemes_, so they were already separate contests; the brand case is the one the old key broke).

**The two `issuer` fields are now one `issuer` and one `authority`.** The previous shape carried
`issuer` twice — once inside `vocabularyScope` and once beside it — with no stated difference. They
are two different things and are now named as two:

- **`vocabularyScope.authority`** — the body that **defines and maintains the naming vocabulary**
  this id is drawn from. Atlas's tariff is an authority in this sense: the same carton is `1.5 cf`
  under `ATVL1000TR` and `1.5cu` under a Canadian tariff (§7.3), which is a statement about the
  vocabulary, not about who filled in a field.
- **`issuer`** — the **party that assigned this particular id** to this particular subject. X12's
  `MS2` is the case that forces it to exist separately: equipment identity is the **owner's**
  SCAC plus the number _that owner_ assigned (§7.4). The vocabulary is "trailer numbers"; the issuer
  is the specific carrier whose numbering this `12345` belongs to.

A scheme may have an authority and no meaningful issuer distinction (a government-assigned GBLOC),
or an issuer under a vocabulary nobody owns. Both fields stay mandatory; where they coincide, they
coincide explicitly rather than by a reader's inference.

### 7.2 The effective interval — sourced twice

- `src:x12-212-trailer-manifest` **`BLR`** on loop 0200: a carrier SCAC **per shipment**, on a
  manifest whose header already names the delivering carrier — "the standard expects the shipments
  on one trailer to belong to _different_ carriers" — and **`BLR-02` is an effective date for that
  attribution, so the carrier-of-record for a shipment is time-scoped." The analysis draws the
  conclusion explicitly: "this is the interline/agent-handoff fact that a van-line model needs and
  that a single `shipment.carrier` field cannot express." This is the requirement `A3` handed to
  `fork-order`, and `fork-order`'s shape could not hold it.
- `src:dp3-400ng` **GBLOC** (Regionalization p.17): responsibility for a GBLOC "can be
  **reassigned mid-life**, with a transfer list and effective dates that TSPs must cross-reference
  for invoicing previous GBLOCs on shipment BLs." A second, independent, regulation-grade instance
  of a dated identifier attribution that moves.

### 7.3 The vocabulary scope — sourced, with the inference marked

- **Grade A, partner contract:** `src:sirva-ade`'s addressable key is not a value but the **triple**
  `Brand + RegNumber + RegYear` — "i.e. reg numbers recycle across years and brands" (GSD p.15).
  `Brand` (`AVL`/`NVL`) "scopes every id." This alone requires a scope field.
- **Measured, Atlas:** eleven of the 47 reachable reference endpoints take a **required** qualifier
  — `tariffName` on seven, `tariffName` + `effectiveDate` on `/Estimating/Tariffs/PricingMethods`,
  `tariffName` + `accountType`, `tariffName` + `postalCode`, `effectiveDate` on
  `/Estimating/AdvanceCharge/Types`; and Atlas's own worked examples show the **same** carton concept
  spelled `1.5 cf` under `ATVL1000TR` and `1.5cu` under a Canadian tariff, `Flat Screen TV` under one
  becoming `Flt Scrn TV < 46 in.` under another
  ([supplement §2.3](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md)).
  **That is the measured fact and it is grade-B structural evidence.** The formulation "a partner
  code reference is a **triple** (code, vocabulary scope, effective date), not a string" is the
  **supplement's own modelling recommendation**, not something Atlas states. It is cited here as a
  recommendation we agree with, not as a publisher's rule.

### 7.4 Grains — every aggregate kind, with the three the critique named

- **equipment / `resource`** — `src:x12-212-trailer-manifest` `MS2`: "to specify the **owner**, the
  identification number assigned by that owner, and the type of equipment", plus a check digit.
  "Trailer `12345` is only unique inside its owner's numbering." Owner-scoped, i.e. `issuer` is
  structural, not a convention.
- **trip** — `src:sirva-ade`: **two ids for the same trip**, `QPDTripNumber` (10 digits) and
  `CamisTripNumber` (5 digits), both carried on every trip-bearing event (SOE p.2). One trip, two
  schemes, both authoritative. This is why arity is N per the I-KEY tuple and why a bare map is
  rejected.
- **stay (a SIT occupancy)** — `fork-order`'s foreclosure #3 promised "we must supply a stay id."
  **We do not have to: the industry already publishes one.** `src:dtr-part-iv` A-406 §A.11 p.5 /
  A-402 §D.5.a(2): the **SIT control number** is 9 digits — `YY` + Julian day of entry + a 4-digit
  sequence within that day — and a **split shipment gets its own SIT control number per increment**
  (#662, each increment "identified and documented separately", each with its own weight ticket).
  A constructed, per-stay identifier with its own semantics. The counterpart failure is in a partner
  contract: `src:sirva-ade` has no SIT identifier at all, so on a shipment with origin **and**
  destination SIT, `ChangeSIT`/`DeleteSIT` "cannot say which one" — the exact defect the stay grain
  prevents.

### 7.5 `primary`, canonicalisation, and the mutable-state conflict

- **`primary` is not a stored flag.** It is the output of `FactResolved` over the identity
  assertions for one **`(subject, scheme, vocabularyScope)`** — the I-KEY tuple of §7.1, which is
  the same tuple arity is stated over — at an instant. `src:project44`'s `primaryForType` is the
  precedent for the _concept_; **[ORIGINAL]:** deriving it rather than storing it. (Revision 2 wrote
  `(subject, scheme)` here and `(subject, scheme, scope)` at §7.1; the scoped tuple wins, for the
  two-van-line reason given at §7.1.)
  **This closes cross-document conflict #5**: `fork-order` modelled identity as fields on an
  aggregate with a mutable `primary` and a mutable §5.4 correlation state, while `fork-time`
  forecloses mutable current state. An identifier is a row in the stream. So is a correlation
  verdict.
- **Canonicalise to match; never to store.** `src:shippeo`'s **Smart Reference Matching** —
  canonicalise both sides by "removing all special characters… and removing leading zeros" so
  `00AB C-D*E` matches `A-B-C-D-E` (`events-in-road-order.home.md:70-79`) — is adopted as a
  **published policy**, forbidden from mutating `value`. A canonical match is an Assertion with a
  resolvable verdict, never a truth. The failure mode is a false positive, which is worse than a
  miss.
- **Echo the counterparty's key back.** `src:dcsa` states the obligation: references are provided
  by the shipper at booking and "carriers share it back when providing track and trace event
  updates." `src:sirva-ade` does it (`ExternalReference` = "Agent's internal lead reference",
  LEP p.3). Retained from `fork-order` §3.3(4).
- **The reissued-BOL problem is solved by the interval, not by a new field.** The critique noted
  that an original BOL and a reissued one are indistinguishable except by `assertedAt`, "the clock
  of the _telling_, not of the _issuing_". The reissue is a new identity Assertion with its own
  `effectiveFrom` and a `supersedes` link. The original weight ticket and the reweigh ticket are
  two `document` subjects, each carrying the shipment's identifier and each `evidence[]` for a
  different `weight.net` assertion (§4.4). No `issuedAt` field is added.

---

## 8. A movement performed by a party whose journey we cannot see

> **Decision. Both halves. (a) "One identified vehicle" is struck from the `Stop` definition. (b) A
> first-class `ExternallyPerformedLeg` is added, with its own asserter. A shipment's origin and
> destination are derived from its acts over **stops and externally-performed legs alike**.**

Today, under `A3`, an auto transporter's delivery is unrecordable and the car shipment has **no
destination at all**, because a `Stop` requires an identified vehicle on one of our trips and
origin/destination are "derived from `StopAction`s and never stored." Meanwhile `fork-order` makes
the car half of its own acceptance test and defers all routing to `A3`. The pair passes each half of
the test by pointing at the other.

### 8.1 (a) The `Stop` definition, corrected — and the DCSA citation withdrawn

**New definition.** _A `Stop` is a visit to one place, at one position in one trip's sequence. The
vehicle and crew are `Assignment`s on the trip, not part of the stop's identity._

`A3` §3.2 defined a Stop as "a visit by **one identified vehicle** to one place" and called it
"directly `src:dcsa`'s `TransportCall`: 'one visit by one conveyance to one place.'" DCSA's call is
by a **conveyance on a voyage**, polymorphic across four modes (`vesselTransportCall`,
`bargeTransportCall`, `railTransportCall`, `truckTransportCall`), and its truck variant merely _may_
carry `licencePlate` — optional. `src:open-trip-model` states the same independently: a Trip "is
**optionally** coupled to a Vehicle that is/was driving this trip." **Neither source states the rule
`A3` imported**, and that rule is what made three of the critique's nine scenarios inexpressible.

Two further A3 citations are withdrawn here:

- **"Cargo (equipment) events reference the call; they never contain the journey" is not DCSA's
  structural rule.** In `dcsa/analysis.md` that sentence is the analyst's summarising clause — it
  opens "So the full hierarchy is:…" and, uniquely among DCSA quotations in that file, carries no
  line citation. DCSA in fact ships the **opposite affordance**: `eventLocation` is a "general
  purpose object to capture the location in the `EquipmentEvent` whenever it is **not** associated
  with a `TransportCall` (this could be stuffing and stripping)" (`event_domain` L1001-1023). **That
  affordance is the precedent for §8.2**, not an embarrassment: DCSA's own answer to "a cargo event
  at a place we have no call for" is to let the event carry the place.
- **`src:cfr-49-375` §375.705 does not support "shipment identity survives every split and every
  vehicle."** It is a _charging_ rule about property "transported on more than one vehicle", and the
  crosscheck scores CFR at A3 C1=1/C3=0 with the instruction "do not use this source for A3." The
  identity claim is `A3`'s own and must be marked **[ORIGINAL]** there, or dropped.

### 8.2 (b) `ExternallyPerformedLeg`

```
ExternallyPerformedLeg   (an aggregate; a legal `subject`; canonical-subject family: stop)
  legId
  shipment | portion     what moved                                       MANDATORY
  performedBy            the party, with an identifier (§7)               MANDATORY
  from / to              place refs; either MAY be a Stop of one of our trips
  custodyBasis           41 continued-responsibility | 349 handed-over    MANDATORY
  authoritativeAsserter  the party whose assertions govern this leg       MANDATORY
```

Acts are published against it exactly as against a stop: handover-out, handover-in, delivered,
placed in SIT. `capturedBy` will typically be `PARTNER_ASSERTED` or `KEYED_BY_PERSON`.

**Why it is not a phantom trip:** we are not modelling a journey we cannot see. We are modelling
**a named party's undertaking to move goods between two places**, which is the only part we can
witness and the only part anyone is accountable for.

### 8.3 The sources — this case is HHG-native and was uncited in all three documents

- **`src:sirva-ade` R19 / RR19 — grade A, live partner contract, the best source for this item and
  cited for it in none of the three documents.** Rule 19 pickup and Reverse Rule 19 delivery are "an
  **authorized substitute agent** performs the pickup/delivery", carrying **its own `R19AuthNumber`**,
  its own `R19Agent` / `RR19Agent` resource, **its own weight**, and its own charge codes (`R19`,
  `RR19`, `BR19` booker charge, `HR19` hauler charge) — SOE pp.16-17, ASC pp.2,5, with
  `R19`/`R19Cancel`/`RR19`/`RR19Cancel` as first-class events. A van line publishes an
  externally-performed pickup or delivery as a thing with its own authorisation number and its own
  party. And `TypeOfMove` (GSD p.26) names the substitute-agent endpoints as **move endpoints**:
  `R19 to Warehouse`, `Warehouse to RR19`, `R19 to Residence`, `Residence to RR19`.
- **`src:dp3-tender-of-service` §B.3.f** (p.19): the TSP must record **the legal name and US DOT
  number of the service provider actually hauling the shipment** against the shipment, in DPS General
  Remarks, **within 2 GBD of origin departure**; double brokering — "when a TSP assigns a shipment to
  a carrier who then brokers the shipment to another carrier" — is prohibited. Its analysis calls
  this "the only place in the corpus where _the party actually performing_ must be named." **So the
  performing party must be a named legal party with an identifier. "A truck we cannot see" is not
  acceptable; "a party we can name" is** — which is precisely what `performedBy` requires.
- **`src:stedi-x12-reference`** element 1650: the interline custody pair **`J1` Delivered to
  Connecting Line** / **`R1` Received from Prior Carrier**, plus `BA` Connecting Line or Cartage
  Pick-up.
- **`src:x12-212-trailer-manifest`** `BLR` at shipment grain with an effective date: two shipments
  on one trailer may belong to two carriers (§7.2).
- **`src:dp3-400ng`** Item 27.3: delivery to an NTS facility makes **the facility the final
  destination** under that BL, and further movement is "under separate BL/invoice". Item 125:
  **Shuttle Service** is a truck-to-truck transfer where linehaul equipment cannot access origin or
  destination, with an enumerated cause list (building structure, inaccessibility by highway,
  overhead obstructions, narrow gates, trees, roadway deterioration, the nature of an article).
- **`src:uncefact-rec24`** for `custodyBasis`: **41** `Handed_over_under_continued_responsibility`
  ("under responsibility of the **same** transport operator") vs **349** `Handed_over` ("handed over
  to **another** party") — both defined in the source, and the one real distinction Rec 24 draws in
  A8.
- **`src:open-trip-model`** `HandOver`: "indicates transferring a consignment from one Actor to
  another", carrying `from`/`to` actor refs, and distinct from `unload`. And `attributeRestriction`
  — naming a vehicle by `licensePlate` alone — is the published precedent for asserting about a
  resource whose id you have never learned.

**[ORIGINAL]:** the `ExternallyPerformedLeg` aggregate itself, and the rule that origin and
destination derive over legs as well as stops. Every constituent — a named substitute performer with
its own authorisation and weight, a custody basis, an interline handover pair, a shipment-grain
time-scoped carrier — is sourced. Nobody publishes them as one entity.

### 8.4 One dependent question, settled here because §8 requires it

`A3` §6.3 leaves open whether "a local-move day with a pack crew and no linehaul" is a Trip. It is
not a user question: three high-confidence claims silently assume the answer, and §8's warehouse
delivery-out crew needs it.

> **Decision: yes. A day of service performed at one place with no linehaul is a Trip with one
> Stop.**

**The citation, corrected.** The previous revision offered `src:dp3-400ng` Item 28.3 as a sourced
premise for this decision. It is not one. Item 28.3 defines a **stop-off**: "extra stops… made at
locations necessary to accomplish the extra pickup or extra delivery of portions of the shipment.
Extra stops are additional pickups made **after the first pickup** or additional deliveries made
**prior to the final delivery**." Every stop it describes sits on a linehaul route between a first
pickup and a final delivery, and the tariff rates BPC miles from block 19 to block 18 **via** them.
A day with no linehaul is precisely the case Item 28.3 does not reach. What it does support, and all
it supports, is the narrower premise that **a service act performed at a place is stop-shaped and is
rated as a stop** — which is worth having and is re-cited for that alone.

The load-bearing premise is `src:open-trip-model`, which supports the no-linehaul half directly: a
Stop "models visiting a certain location at a certain time and potentially doing several other
actions at that location" (`otm5.8-docs-llm.md:302`) — no movement is required of it — and a Trip
"is **optionally** coupled to a Vehicle that is/was driving this trip" (`:244`), so a trip with a
crew and no vehicle is the publisher's own shape, not our extension of it.

**[ORIGINAL]:** the conclusion, and it now rests on one source rather than two. It unblocks the pack-only
day (the packing charge now has a stop to anchor to — `A3` §Cross-area binds accessorials to "the
stop that caused them"), the SIT delivery-out leg, and the cancelled-after-packing scenario, in
which the shipment now has an origin.

---

## 9. Atlas — blanket re-citation

Every Atlas-derived element in the three documents is **column-name evidence**. The supplement
corrects **A3 C2 → 1, A5 C2 → 1, A9 C2 → 1**; Atlas's A4 disqualification is **permanent from this
source**, not pending a fetch, because "the operational vocabulary is **not merely unfetched but
unpublished**" — no lookup endpoint exists in any of the 24 documents and not one of the 17 status
axes (`ord_status`, `evt_eventcode`, `evt_status`, `stp_type`/`stp_type1`/`stp_reftype`,
`stp_departure_status`, `SIT.status`, `SIT.reason`, `lgh_instatus`/`lgh_outstatus`, the 14
`<service>_cmpid_status` variants, `stp_reasonlate`) carries a code-list reference.

| Claim, and where                                                     | Standing after the supplement                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The manifest layer (`A3` §6.2)                                       | Column names (`mfh_number`), no code list. `A3`'s "most expensive correction" has **no cheap remedy** and its confidence note must be rewritten, not footnoted.                                                                                                            |
| Accept-vs-perform two-status lifecycle (`A3` §5.8)                   | Column names. The _structural_ observation (two statuses per assigned service) stands; the semantics do not.                                                                                                                                                               |
| Crew (`A3` §5.7), the four mileage accumulators (`A3` §4.5)          | Column names.                                                                                                                                                                                                                                                              |
| `EXTDate` fault attribution, `CustomerETA` (`fork-time` §(b)(6),(7)) | Column names; `date_type`, `reason` and `delayclaimresponsibility` carry no code-list binding. `fork-time`'s own stated falsification condition for these two rules **is met**. §2.4 here re-sources attribution to X12 element 1651 and Shippeo, which do publish theirs. |
| `agreedFromDate`/`agreedToDate` for `COMMITTED` (`fork-time` §(a))   | One untyped, undescribed field pair. **Not decisive.** §4.2 re-sources `COMMITTED` to `src:uncefact-scrdm` (definition) + `src:sirva-ade` (grade A, ALP/ADP + Will-Advise) + `src:dp3-400ng` (scheduled vs requested vs first-available vs actual).                        |
| "(code, vocabulary scope, effective date), not a string" (§7.3)      | Cited **as the supplement's recommendation**, backed by the measured required-parameter counts and the `1.5 cf`/`1.5cu` drift, with `src:sirva-ade`'s `Brand+RegNumber+RegYear` as the grade-A support.                                                                    |

**Two Atlas observations that are usable and are used**, because both come from the _estimating_
API's declared enums and worked examples rather than from operational column names:

1. **Stop types are directional pairs.** The observed `/Estimating/Stop/Types` values are `Origin`,
   `Destination`, `Origin Extra Stop`, `Destination Extra Stop`, `Origin Airport Stop`,
   `Destination Airport Stop` — every type qualified by which end of the move it belongs to. The
   supplement calls this "a real modeling idea, and one the ideal model should weigh", and it
   **contests** `A3`'s chosen DCSA `facilityTypeCode` design (a bare role the place plays, no
   direction). **Not settled here** — it is an A3 stop-purpose question, and §10.1 requires `A3` to
   engage it rather than ignore it. Note the standing: six values observed in vendor worked
   examples, a lower bound, not a code list.
2. **SIT is not a stop type.** The observed stop-type values contain no storage or warehouse member;
   in `estimating-v2`, `StorageInTransitModel` hangs off `StopModel.storageInTransit`, so "storage
   is modeled as a _service at_ an Origin or Destination stop, not as a _stop of its own_", and a
   worked example shows origin-side and destination-side SIT coexisting on one order. **Also not
   settled here** (it is an A5/A3 question), but it is stateable now without any capture, and §10.1
   requires it to be answered deliberately rather than by inheritance, because `A3` §3.3 and §5.1
   make a warehouse **stop** the entire SIT seam.

---

## 10. What each document must now change

### 10.1 `A3-trip-stop-assignment.md`

1. **Envelope.** Adopt §1 wholesale. §5.9's trip-scoped event and §5.8's membership lifecycle are
   preserved by `subject`; the envelope rule attributed to `src:omnitracs-roadnet`'s region-filter
   table is withdrawn (§1.5).
2. **`Stop` definition.** Strike "one identified vehicle" (§8.1). Re-cite `TransportCall` honestly.
3. **Withdraw the DCSA "structural rule" claim** and the §7 HIGH rating that rests on it; re-cite
   `eventLocation` as the affordance it is (§8.1).
4. **Withdraw §7's `src:cfr-49-375` §375.705 support** for shipment identity across splits; mark the
   claim **[ORIGINAL]** or drop it (§8.1).
5. **Delete `quantity` from `StopAction`.** Use the Portion (§3.3).
6. **Add `result`/outcome properly:** `StopAction` carries `outcome` + `reasons[]` per §2; the type
   names the act only (§2.5).
7. **Reject the Alvys three-way split and `Eta {Planned, Live, Manual}`** (§4.5); delete the claim
   that these are "settled cross-cutting decisions [crosscheck item 6]" — they are settled here, and
   differently.
8. **Add `ExternallyPerformedLeg`** and change "origin and destination are derived from its
   `StopAction`s" to "derived from its acts over stops **and externally-performed legs**" (§8).
9. **Close §6.3**: a pack-only or delivery-out-only day is a Trip with one Stop (§8.4). Remove it
   from "what only the user can decide" and remove the conditional confidence on §3.3's SIT rows.
10. **Rewrite every Atlas confidence note** (§9); delete the "fetch the `/Types` endpoints" remedy
    from §7 entirely. **Engage the two usable Atlas observations**: directional stop-type pairs
    against the `facilityTypeCode` design, and SIT-as-a-service-at-a-stop against §3.3/§5.1's
    warehouse-stop SIT seam.
11. **§3.4 criterion 4:** drop `SMD Consolidated Shipment Manifest Data` as one of the five
    vocabularies — `SMD`'s three elements are service level + method of payment + pick-up-or-delivery
    code, and only the segment's _title_ mentions consolidation. The criterion survives on four.
12. **§3.3's SIT row** must point at §5.1's ORIGINAL-design caveat, not at §4.
13. **Resolve §6.1 internally**: the prose says a driver change is a new trip, the structure says a
    new `Assignment` interval. Pick the structure, and say so.
14. **One axis** (§1.3): where A3 writes `factClass` or `factRef`, read `type` and the derived fact
    key. A3's E-CANON restatement at §5.6 must say _subject family_, and must name
    `{stop, externallyPerformedLeg}` as the one non-singleton family — which is what its own §8
    scenario relies on.
15. **Re-cite §3.2's pack-only-day premise** (§8.4): Item 28.3 is a stop-off rule about extra stops
    on a linehaul route and does not support the no-linehaul day. `src:open-trip-model` does, and
    alone.
16. **Correct the Shippeo counts** at §5.x: 38 rows, 7 geofence-marked, 25 non-conform rows, none of
    them geofence-marked (§5.2 M3). The finding is unchanged.
17. **Scenario 8 label** (§10.5 below): use the common label.
18. **E-CANON is reject, not re-key** (§4.6). §3.2's "the destination agent's shipment-level phrasing
    **resolves to** that stop (shipment in `context[]`)" and §8 scenario 7's "resolves onto the stop
    … rather than becoming a second, unpairable fact" both read as boundary re-keying and must be
    restated: the canonical phrasing is an **obligation on the asserter**, the re-phrasing is an
    ingest-side act by a named subject-resolution rule, and where that rule returns anything but
    exactly one candidate the claim is **not admitted**. A3 §8 scenario 7 should also carry the
    two-candidate-stop case, since split delivery is A3's own worked shape (§3.3).
19. **Adopt §4.7 rather than restating families.** A3 §3.2's "Where each kind of fact lives" table is
    the ancestor of §4.7 and agrees with it everywhere; it must now **cite** §4.7 as the declaration
    rather than stand as a second one, and add the `goods = {shipment, portion}` family, which A3's
    own split-delivery and overflow rows rely on.
20. **Type names are §4.7's** (§4.7 note 5) — A3 has no item for this and `fork-time` §10.3 item 21
    does. **§3.2's `StopAction` verb list** (`load`, `unload`, `pack`, `unpack`, `weigh`, `store-in`,
    `store-out`, `transfer-out`, `transfer-in`, `attempt`, `survey`) is prose, not the vocabulary, and
    must be restated as such: `pack` → **`packing`**, `load` → **`loading`**, `unload` →
    **`unloading`**, `store-in` → **`storeIn`**, `store-out` → **`storeOut`**, and the pair
    `transfer-out` / `transfer-in` → **one `handover` type asserted once by each side** (the `J1`/`R1`
    shape, §4.7's `handover` row), not two types. **`attempt` is not a type at all**: an attempted
    delivery is `type = delivery` with `outcome = NOT_COMPLETED` and at least one reason — A-TYPE
    (§2.5) forbids a type that names the outcome, and §2.6 already works this exact scenario.
    `unpack`, `weigh` and `survey` have **no §4.7 member yet**; A3 must record that against §4.7.3's
    absent list and [`A8` §9 item 8](A8-authority-skeleton.md) rather than mint one.
21. **Adopt §4.7.1's three new row-groups** (§4.7.2d) for the records A3 §3.2's table already
    specifies. §3.2's rows "The trip was delayed, resequenced, cancelled", "The membership was
    offered / accepted / broken" and "A resource was assigned / accepted / released" must name the
    nine `type`s — `tripDelay` / `tripResequence` / `tripCancellation`, `membershipOffer` /
    `membershipResponse` / `membershipRelease`, `assignmentOffer` / `assignmentResponse` /
    `assignmentRelease` — and cite §4.7.1 as the declaration. **Their subjects do not change**; A3's
    are the ones §4.7.1 quotes. Their authority is **owed** and A3 must not fill it: §5.9's and
    §5.8's confidence notes must say so and point at [`A8` §9 item 8](A8-authority-skeleton.md).
22. **§5.8's lifecycle must be split three ways** (§4.7.2d, closing paragraph). "Offered → accepted →
    loaded → in-transit → unloaded" is three different things in one arrow chain: offer / response /
    release are `stopAction`-subject records; **`loaded` and `unloaded` are the `loading` and
    `unloading` act records on the `goods` family** and must not be republished as membership
    transitions (that is the double-counting §4.5 rejects in the Alvys three-way split); and
    **`in-transit` is not a record** — it is a projection, forbidden as a field by §1.1. Also drop
    "accept/**perform** split… onto the trip membership and onto the assignment": the perform half is
    the act rows, not a second lifecycle.
23. **`Custody` is a projection, not a stored entity** (§4.8). Three places change and the decision
    is one: **§3.1's shape diagram** must drop `Custody ──(interval, orthogonal to Trip)──▶ Shipment`
    from the stored spine — the spine is `Trip → Stop → StopAction` with `ExternallyPerformedLeg`
    beside it, and "Nothing else in A3 is stored" then becomes true; **§3.2's `Custody` definition**
    must read _a projection — the fold `custodyAt(goods, instant)` over the selected `handover`
    assertions and over `ExternallyPerformedLeg.custodyBasis`_ (§4.8.3), keeping the 41/349 basis
    exactly where it is, on the act; **§5.2 item 2** must restate its **[ORIGINAL]** claim from "Custody
    as a first-class **interval**" to "custody as a **fold**", which is what A3's own `Leg` rule
    already requires of it — _"Storing them is how they come to disagree with the records"_ — and
    which keeps A3's honest observation that `src:uncefact-rec24` supplies "two status codes, **not**
    an entity". A3 loses no field: the fold returns party, from, until, basis and evidencing act.
    Downstream, **§4 foreclosure 4** ("latest act, plus the current `Custody` interval") and **§3.3's
    agent-to-agent handoff row** must name the fold rather than an interval record, and **§8
    scenario 2's** "a `Custody` boundary with basis 349" becomes "a `handover` assertion with
    `custodyBasis = 349`".

### 10.2 `fork-order-shipment-cardinality.md`

1. **Envelope.** The order's award/accept/decline/cancel lifecycle is preserved by `subject`
   (§1.2).
2. **`Identifier`.** Replace §3.3's shape with §7: add `vocabularyScope` and the effective interval;
   extend grains to every aggregate kind; make `primary` derived, not stored; make the §5.4
   correlation state an Assertion + `FactResolved`, not a mutable field (§7.5). This closes the
   conflict with `fork-time` on mutable state.
3. **Foreclosure #3's "we must supply a stay id" is withdrawn** — `src:dtr-part-iv` publishes the
   **SIT control number** (§7.4).
4. **`Portion`.** Replace §5.1 with §3: not "minted only at physical divergence", not inherently
   weighed; `MEASURED` → `ENUMERATED` under one id; overlap and nesting permitted; P-CLAIM stated.
   This also resolves the §3.2 / §5.1 internal contradiction (§3.2's "still one shipment" is right,
   and a Portion is why).
5. **§3.2's boundary rule must be marked [ORIGINAL].** DTR states two _named DoD operations_
   (diversion keeps the BL; reshipment of a terminated shipment moves on a new BL). "If a new bill
   of lading is issued, a new shipment exists" is this document's **generalisation**, applied to a
   commercial auto carrier, to permanent-storage conversion, and to a Weichert lane where the
   document concedes there is no BOL, PRO, SCAC or registration number at all. §7's list of
   unsupported assertions must include it, and §7's "high" score must come down.
6. **§7's diversion/reshipment HIGH must come down**: DTR's diversion expressly **excludes shipments
   already in SIT at destination**, which is the case the acceptance test turns on.
7. **§3.3's "the identity evidence independently confirms the cardinality decision" must be
   softened.** It reads Weichert's document layout as ontology, while the same source's analysis
   records the opposite modelling choice ("Auto/Pet are separate _order types_, not shipment types").
   An argument that needs an uncited criterion (§3.5a, §5.5) to overrule its own source is taste,
   and should be presented as such.
8. **§3.5(b)'s Weichert `-N` suffix argument must be withdrawn or re-framed** — the Weichert analysis
   records the suffix as its own **open question 8**, and an unanswered question about a field's
   semantics is not evidence that the publisher has no aggregate behind it.
9. **Cancelled-after-packing** is now expressible: the pack day is a Trip with one Stop (§8.4), the
   pack act has an outcome (§2), and the shipment has an origin. §5.2's provisional boundary still
   needs to say what a boundary that never acquires its defining document _is_.
10. **One axis** (§1.3): `factClass = identity` becomes `type = identity` throughout §3.3, and the
    revision-1-vs-now table's envelope row drops `factClass`.
11. **Adopt I-KEY** (§7.1): §3.3's "N per (subject, scheme, scope)" and its derived-`primary` row
    must both name **`(subject, scheme, vocabularyScope)`** — the table currently says
    `(subject, scheme)` for `primary`, which is the mismatch this revision closes, and §3.3 item 2's
    own two-van-line example is the case that breaks under the looser key.
12. **Rename the duplicated `issuer`** (§7.1): `vocabularyScope {authority, tariff?, brand?, year?,
programme?}`; `issuer` survives only as the assigning party, which is what §3.3 item 2's
    argument against a bare map actually turns on.
13. **Re-cite §8.6's pack-only-day premise** (§8.4) — Item 28.3 does not support it.
14. **Scenario 8 label** in §8.10 (§10.5 below).
15. **E-CANON is reject, not re-key** (§4.6) — **this list omitted the fix and `fork-order` carries
    the same defective wording as A3 and `fork-time`.** §8.7 says _"the destination agent's
    shipment-level claim **resolves to that stop** (shipment in `context[]`), or, where no stop of
    ours exists, to an `ExternallyPerformedLeg`"_ — the boundary-re-keying reading §4.6 abolished, in
    the same words §10.1 item 18 corrects in A3 §3.2 and §10.3 item 20 corrects in `fork-time` §8.7.
    It must say instead: the record **as phrased is not admitted** — `shipment` is not in `arrival`'s
    declared family, so **E-CANON-STRICT** refuses it and it acquires no `eventId`; re-phrasing onto
    the canonical subject is an **ingest-side** act by a published, versioned subject-resolution rule
    that must return **exactly one** candidate (**E-CANON-RESOLVE**), with `assertedBy`/`assertedAt`
    remaining the agent's, the subject they named in `context[]` and the inbound message in
    `evidence[]`; and where the rule returns zero or more than one candidate the submission is
    retained outside the catalog with its candidate set, and an obligation is emitted to the agent
    (**E-CANON-OBLIGATION**). The `ExternallyPerformedLeg` half survives unchanged — it is a second
    member of the same family, so it is a _candidate_, never a fallback the boundary picks.
16. **Type names are §4.7's** (§4.7 note 5), wherever §3.3, §5.4 and §8 write a `type` in prose —
    the same item §10.3 item 21 carries for `fork-time` and §10.1 item 20 now carries for A3.
17. **`Custody` is a projection** (§4.8). §3.2's concession that "neither [document] owned the
    `Custody` interval" is now answered and must point at §4.8 rather than at A3 §5.2: **nobody owns
    an interval, because there is no interval** — there are `handover` assertions and a fold over
    them. §8.8's expression of scenario 8 needs no change in substance (`ExternallyPerformedLeg`
    with `custodyBasis` ∈ 41 | 349 is exactly one of the fold's two inputs), but must cite §4.8 for
    what the basis is read _by_.

### 10.3 `fork-time-provenance-corrections.md`

1. **`subject` is re-opened** to all aggregate kinds (§1). The frozen "shipment / stop / service /
   item" list is withdrawn.
2. **`OccurrenceEvent` is abolished**; `basis = ACTUAL` is legal on an Assertion; the resolution
   runs over any fact class (§4). §(b)(3)'s headline capability now has a home for the ACTUAL class.
3. **Re-cite the `basis` enum** (§4.2): `REQUESTED`/`ESTIMATED` are DCSA's, not SCRDM's;
   `COMMITTED`'s support is `src:sirva-ade` + `src:dp3-400ng`, not Atlas.
4. **Re-cite the three clocks** (§4.2): two sources carry three; EPCIS supplies the rule, not the
   count; p44 and Alvys corroborate the split only. §7's HIGH must be re-argued on that basis.
5. **`MilestoneTimeSelected` → `FactResolved`**, and the two "upgrades that p44 lacks" must be
   marked **[ORIGINAL]** and appear in §7's confidence table (§4.3).
6. **Re-cut rule (b)(5) by capture method** (§5): M1–M7 replace it. The over-read of Shippeo's
   geofence column must be marked — our rule is _stricter_ than the source, and the source itself
   derives delay reasons from position.
7. **Add `outcome` and `reasons[]`** (§2). `OccurrenceEvent.type` as a milestone name
   (`Delivery.Completed`) is forbidden by A-TYPE; the Shippeo schema defect is the evidence.
8. **Move attribution from the assertion to the reason** (§2.4 rule 6); §(b)(7)'s placement claim is
   withdrawn as unsourced.
9. **Replace §5.1** with §6: recorded, flagged `INEFFECTIVE`, never applied to the priced record,
   emits the obligation. Mark the recording rule **[ORIGINAL]** — §375.401(i) speaks to amendment,
   not to recording. This also resolves the §5.1/§5.4 contradiction.
10. **Fix §(c)'s two incompatible retraction semantics** (§6.4): keep EPCIS's no-replacement rule,
    drop the 858's restore-to-previous mechanism, republish `FactResolved`.
11. **§5.2's cascade is not a correction** (§6.6) — it is a new derived Assertion plus a new
    resolution, which the platform has authority to publish.
12. **§5.5's authoritative-asserter rule** is retained and now has a home: it is the rule named by
    `FactResolved.rule`, and on an `ExternallyPerformedLeg` it is the `authoritativeAsserter` field
    (§8.2). §7's HIGH on (b) must still be capped by §5.5's confidence, as the critique requires.
13. **The `assertedBy.role` HHG vocabulary is `src:sirva-ade`'s cast**, not DCSA's — cite it at the
    point of use (SIRVA `Resource.Type`: Booker, OriginAgent, DestinationAgent, LoadAgent,
    UnloadAgent, Hauler, R19Agent, RR19Agent, SITAgent, Driver, plus Packer / Port Handler /
    Settling Agent / Setoff Agent in the settlement view) — and record that X12 element 98, the one
    list that would let the role be checked against an industry vocabulary, is still unread.
14. **Rewrite the Atlas confidence plan** (§9); delete the `/Types` falsification condition, which
    is already answered.
15. **One axis** (§1.3). The `Assertion` shape block must lose `factRef {subject, factClass,
qualifier?}` and the second `subject` it contains; `type` carries the fact class, `qualifier` is
    a payload field, and the fact key is derived. `supersedes` stays where it is — the envelope's
    `correlation` bag is deleted, not this field.
16. **Restate E-CANON as a subject _family_** wherever it is quoted (§3.1, §4.3, §8.7), and M7 as
    per-`type` (§4.5).
17. **`storeIn` and `sitEntryDate` are two types** (§5.3). §(b)(2)'s M2/M4 pair is coherent only on
    that reading, and scenario 2's SIT narrative must use both names.
18. **Correct the Shippeo counts** (§4.5, §5 rule 5, §7's evidence table): 38 rows, 7 of 38, 25
    non-conform rows, "7 of 41" and "24 exception rows" withdrawn. The finding stands.
19. **Scenario 8 label** in §8.10's scoreboard (§10.5 below).
20. **E-CANON is reject, not re-key, and §8.7 must say only that** (§4.6). §8.7's sentence "The
    destination agent's shipment-level claim is **accepted** with the shipment in `context[]`; it is
    not silently re-keyed, it is **rejected** at the boundary" carries both behaviours in one clause.
    Keep the reject half, drop "accepted with", and say who does the re-phrasing. §8.7 must also work
    the **two-candidate-stop** case, which is the half the blocker names as missing.
21. **Type names are §4.7's** (§4.7 note 5): `time.arrival` → `arrival`. The dotted form survives only
    where the vocabulary declares a sub-kind (`weight.net`).
22. **There is no `custody` fact class** (§4.8, §4.7.3). §8.8's sentence _"this document can assert a
    `custody` fact over the interval with `subject = shipment:S` and the two legs in `context[]`"_ is
    **unpublishable as written** — `custody` is not a member of the record vocabulary, so E-TYPE
    rejects it, and §4.8 decides it never will be. It must read: the two **`handover`** assertions are
    what is published (`type = handover`, subject in the `goods` family, the two legs and the
    releasing/receiving `partyRole`s in `context[]`, `custodyBasis` ∈ 41 | 349); **who holds the goods
    across the dwell is the fold `custodyAt(goods, instant)` (§4.8.3), which is computed, not
    asserted, and therefore not attributed and not corrected.** The rest of §8.8 is unaffected: the
    dwell's _classification_ is still A5's, the honest gap is still honest, and `stay` still owns the
    interval's identity whatever A5 decides.
23. **§5.5's authoritative-asserter rule gains its missing target** (§4.8). §5.5 says "the catalog
    declares, per fact class, which role is the authoritative asserter **given the current custody
    state**" — "current custody state" had no referent in the envelope. It is `custodyAt(goods,
instant)`, evaluated at the instant the fact is _about_ (**A8-INSTANT**), not at the current
    instant; §5.5's own wording must lose the word "current", because keying on the present is the
    recency failure A8-INSTANT exists to prevent and which §5.5 is cited to close.

### 10.3a `A8-authority-skeleton.md`

A8 is subordinate to this document (its own header says so). Eight corrections. The header said "two"
and listed three; the count is fixed here and each item now names the section and the replacement text
so it can be applied without re-deriving it.

1. **§7.6's worked records use the deleted two-axis shape.** Four of them write
   `factRef={subject: …, factClass: …}` on an **Assertion**; §1.3 abolished `factRef` as a field and
   `factClass` as a second axis. Restate each as envelope `subject` + `type` (e.g.
   `Assertion type=condition subject=item:i7 basis=ACTUAL`), and spell `factRef` out **only** on the
   two `FactResolved` records, where §4.3 makes it an explicit field.
2. **The wildcard subject `item:*` is not a subject and must be removed** (§1.1, §1.2). §7.6's two
   condition assertions are written `factRef={subject: item:*, factClass: condition} … (per article)`.
   A `SubjectRef` is `{aggregate, id}` and `subject` is _"exactly one"_ typed reference; `*` is not an
   id, so under **E-CANON-STRICT** the record names no fact key, is admitted to no contest, and is
   rejected at the boundary. The parenthetical "(per article)" is the fix made explicit: restate as
   **one Assertion per article**, `subject = item:i7`, `item:i8`, …, by each of the releasing and the
   receiving party — which is what §5 row 9 and **A8-JOINT** already require (_"the condition of
   **each article**"_, `src:dp3-400ng` Item 17.12.c) and what §7.6's own `FactResolved` already does
   correctly when it names `factRef={item:i7, condition}`. **Wherever else A8 uses a wildcard or a
   plural subject in a worked record, the same restatement applies** — the envelope has no
   multi-subject record and no subject pattern, and §1.1 forbids both permanently.
3. **§7.6 puts `delivery-performance` on `subject = stop:Z`, contradicting A8's own §5 row 5** (and
   §4.7), which give `delivery` the `goods` family with the stop in `context[]`. §4.7 wins: subject
   is the shipment, `context = [stop:Z]`. Both the two Assertions and the `FactResolved` beneath them
   change subject; the type spelling is **`delivery`**, not `delivery-performance` (§4.7 note 5 —
   that is a prose alias and must not appear in a record). The scenario's conclusion is unaffected:
   both assertions still pair on one fact key, and A's still loses under A8-INSTANT.
4. **§5 row 11 takes the `{aspect}` qualifier** (§4.7.2b), so propose / decide / rate are three fact
   keys rather than three authorities contesting one. The row's three-way split is the finding and
   does not otherwise change.
5. **§5's caveat (i) must name §4.7 as the declaration, and every _(assumed)_ marker must go.**
   Caveat (i) reads "The canonical `subject` per fact class is declared by **E-CANON** and by A3/A4,
   **not here**… marked _(assumed)_ where it does not yet say." §4.7 now says, for every row: row 2
   `departure` → family **`stop`**; row 6 `weight.net` → family **`goods`**; row 8 SIT release →
   **`stay`** (type **`storeOut`**). Replace "A3/A4" with §4.7, delete all three _(assumed)_ markers,
   and restate rows 3, 4 and 5's "`shipment`, `context[]` = stop" as the **family** name `goods` =
   {shipment, portion} — the family is what E-CANON declares, and a bare `shipment` reads as
   forbidding the Portion-subject act §3.3 licenses.
6. **§9's explicit non-goal must drop "canonical subjects per fact class (E-CANON, A3/A4)"** from the
   list of what A8 does not settle. It is settled — at §4.7, not by A8 and not by A3/A4 — so the
   sentence is not wrong about A8's scope but is now wrong about where the answer lives.
7. **§4.3's `CUSTODY` row must point at something that exists in the envelope** (§4.8). It reads
   "Authority follows the `Custody` interval (`A3` §5.2)"; there is no such entity — §4.8 makes
   custody a **projection**. Restate as: _authority follows **`custodyAt(goods, instant)`** (shared
   §4.8.3) — the named, versioned fold over the `FactResolved`-selected `handover` assertions and
   over `ExternallyPerformedLeg.custodyBasis` — evaluated at the instant the fact is about
   (A8-INSTANT) and moving at a boundary per A8-MOVE on the selected handover's `custodyBasis`._
   The same substitution applies at **§4.2** ("custody history is append-only (`A3` §5.2: the
   `Custody` timeline is never overwritten)" → the fold is recomputed, and it is the underlying
   `handover` assertions that are append-only) and at **§7.4(c)**, which already describes the fold's
   behaviour correctly and need only name it. **A8's substance does not change:** A8-MOVE, A8-INSTANT,
   A8-AFTER and §7.6 all read the same inputs they read today.
8. **§7.6's two `Handover` acts take §4.7's spelling and family.** `type = Handover` →
   **`handover`**; `subject = shipment:S` is already in the `goods` family and is correct. These two
   records are the fold's inputs, and saying so at §7.6 is what makes item 7 checkable against a
   worked example.

### 10.4 Explicitly **not** settled here

- **Shipment identity across SIT termination and reshipment** (critique must-fix #10). §3's Portion
  settles that a SIT _remainder_ does not split a shipment; it does not settle whether `store-out`
  after a **terminated** stay names the same shipment id as `store-in`. That is an A2/A5 question.
  The shared-layer constraint that holds either way: **the `stay` is an aggregate with its own
  identity and its own subject kind**, so the stay id has an owner regardless of how the
  shipment-boundary question resolves — and _who held the goods_ is answered without an owner at
  all, because it is not a stored thing: it is the fold **`custodyAt(goods, instant)`** (§4.8.3)
  over the published `handover` assertions. There is no `Custody` interval to own.
- **SIT as a stop vs SIT as a service at a stop** (§9, item 2). A5/A3.
- **Directional stop-type pairs vs a bare `facilityTypeCode` role** (§9, item 1). A3.
- **The reason vocabulary's content.** §2.4 fixes its shape; the list is A4's.
- **Custody authority's owner** (conflict #7) — **partially closed, and the cap has moved rather
  than lifted.** _(What `Custody` **is** is no longer open: §4.8 settles it as a projection, and
  `boundBy = CUSTODY` now resolves against the envelope. What remains open is whose assertions win,
  which is the item below.)_ [`A8-authority-skeleton.md`](A8-authority-skeleton.md) now supplies the hinge
  (A8-MOVE on `custodyBasis` 41 vs 349), the instant rule (A8-INSTANT), and a per-fact-class role
  table for eleven classes, which §4.7's authority column quotes. §8.2's `authoritativeAsserter`
  still gives the externally-performed case its home. **What has not changed:** A8 §10's last row
  caps its own contribution at _medium_, and only for the classes in its §5 — so a document may now
  score a dependent decision **medium**, and still **may not score it high**, and gains nothing at
  all for a fact class §4.7 marks **owed**.

### 10.5 The scenario-8 label, fixed once

The three scoreboards **agree substantively and disagree only in wording**, which is worse than
disagreeing, because a reader comparing them concludes the documents have found different things.
A3 says "EXPRESSIBLE; one interval is deliberately thin" and counts it among "nine stated, nine
expressible"; `fork-order` says "**Partial** — dwell unmodelled; authority open pending A8";
`fork-time` says "**yes**, with the cross-dock dwell classification left to A5". All three mean: the
handoff is expressible today, the _classification_ of the cross-dock dwell is A5's, and _custody
authority_ is A8's.

> **Common label, to be used verbatim in all three scoreboards:**
> **Expressible — dwell classification deferred to A5, custody authority deferred to A8.**

"Partial" is withdrawn as the label: nothing about the scenario is inexpressible, and two named
deferrals to documents that do not yet exist are not a gap in this layer. Each document may keep its
own detail in the adjacent column; the status cell is the same eleven words in all three.

---

## 11. Confidence

| Decision                                                                                                                                                                                     | Confidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What would overturn it                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Envelope, `subject`, `context[]`                                                                                                                                                          | **High**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Nothing in the corpus; the risk is ours — if `context[]` leaks into subject-filtered reads by default, the shipment-rooted envelope returns through the query layer. That is an implementation discipline, not a model risk.                                                                       |
| §2 (outcome, reason)                                                                                                                                                                         | **High**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Two grade-A sources, one of which publishes the grid outright. The only authored parts are the five-member enum's shape and attribution's placement. Reading Shippeo's two master code spreadsheets (open question 1 in its analysis) would enlarge the reason list, not change the factorisation. |
| §3 Portion                                                                                                                                                                                   | **Medium-high**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The two membership forms are each sourced twice; the one-entity-two-forms join is ours. If A2 finds a published HHG model that keeps enumerated and measured subsets as **different** entities, revisit.                                                                                           |
| §4 Generic Assertion + `FactResolved`                                                                                                                                                        | **High** for the shape (the classes and the acceptance test are sourced); **medium** for E-CANON, which is authored and is the piece doing the most work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| §4.4 `R-WEIGHT-LOWER`                                                                                                                                                                        | **High** as a DoD rule (three statements in one tariff); **deliberately scoped**, not promoted to a universal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| §5 Capture-method rules                                                                                                                                                                      | **High** for M3/M5/M6 (Shippeo's own table and its own defects); **[ORIGINAL] and medium** for M1, which contradicts Omnitracs, and M2's list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| §6 Corrections                                                                                                                                                                               | **High** on the instruments and the financial regime (two regulations plus a partner contract); the recording-of-ineffective-attempts rule is **[ORIGINAL]** and is the one a lawyer should see.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| §7 Identifier                                                                                                                                                                                | **High**. Effective interval sourced twice, vocabulary scope sourced at grade A, every named grain sourced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| §8 Externally-performed leg                                                                                                                                                                  | **High** on the need (R19/RR19 is a live partner contract with its own authorisation number) and on the corrected `Stop` definition (two sources say the vehicle is optional); **[ORIGINAL]** on the aggregate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| §8.4 Pack-only day is a Trip                                                                                                                                                                 | **Medium**, down from medium-high. One of the two premises is withdrawn: 400NG Item 28.3 is about extra stops _on a linehaul route_ and does not reach the no-linehaul day. What remains is `src:open-trip-model` alone — a Stop that requires no movement and a Trip whose Vehicle is optional — which does support it, but singly. Conclusion still ours. Still cheap to reverse _before_ A5 and A7 are written and expensive after.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| §1.3 One axis: `type` **is** the fact class                                                                                                                                                  | **High** as a decision that had to be made and **medium** as the particular answer. Nothing in the corpus publishes two axes over one record _and_ defines both; DCSA carries type and classifier as two axes but its classifier is a four-member tense enum, which is our `basis`, not a second fact taxonomy. What would overturn it: a fact class that genuinely needs two independent subjects, or a capture rule that must vary within one type. Neither exists today; a second subject is what `context[]` exists to carry non-authoritatively.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| §1.3 / §4.1 One `subject`, fact key derived                                                                                                                                                  | **High**. The two were always the same value; nothing in any of the three documents ever set them differently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| §5.3 `storeIn` ≠ `sitEntryDate`                                                                                                                                                              | **High** on the separation (two regulations forbid substituting an observed date for the accrual date); **[ORIGINAL] and medium** on stating it over the store-in act rather than over arrival, which is the case the tariff actually names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| §5.4 item vs Portion                                                                                                                                                                         | **Medium-high**. The test is a restatement of §1.2 and §3 rather than a new commitment, but the rule itself is authored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| §7.1 I-KEY                                                                                                                                                                                   | **High**. The mismatch was internal and the scoped tuple is the one `src:sirva-ade` publishes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| §4.6 E-CANON-STRICT (reject, never re-key)                                                                                                                                                   | **High as a decision, [ORIGINAL] as a rule.** High because it is not a new commitment: both normative statements of E-CANON already said "rejected at the boundary, not re-keyed silently", and only the surrounding prose said otherwise — revision 4 conforms the prose. The supporting arguments are internal (M1's record-vs-fabrication argument; §7.4's `ChangeSIT` cannot-say-which-one defect) plus `src:shippeo`'s published "canonicalise to match, never to store". **What would overturn it:** a producer that genuinely cannot name a canonical subject _and_ for which no one-candidate resolution rule can exist — in which case the fix is a new aggregate in the family (which is what `ExternallyPerformedLeg` already is), never a boundary guess.                                                                                                                                                                                                                                                                                  |
| §4.6.2 E-CANON-RESOLVE / E-CANON-OBLIGATION                                                                                                                                                  | **Medium-high — [ORIGINAL]**. The cardinality gate and the "resolution is ours, the claim is theirs" record shape are authored. They reuse three settled mechanisms rather than adding any: `{ruleId, ruleVersion}` (§4.3), `context[]` + `evidence[]` (§1.1, §1.4), and §6.5's obligations. The risk is operational, not modelling: if the ingest ledger is treated as a dead-letter queue nobody reads, rejection becomes silent loss — which is precisely why the obligation is mandatory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| §4.7 The canonical-subject table, rows drawn from settled text                                                                                                                               | **High.** `arrival`/`departure` on `stop`, acts on `goods`, `condition` on `item`, `storeIn`/`sitEntryDate`/`storeOut` on `stay`, `identity` over every aggregate, `charge` on `charge` — each is already decided at §1.2, §3.3, §4.3, §5.3, §5.4 or §7.1, and A3 §3.2's own table agrees with every one. The table publishes them together; it does not decide them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| §4.7 The `goods = {shipment, portion}` family                                                                                                                                                | **Medium-high — [ORIGINAL]** as a naming. Both halves are settled (§3.3 licenses a Portion-subject act; §1.2 makes `portion` an aggregate), and revision 3's "two non-singleton families… and nothing else" was internally broken. What would overturn it: a decision that a Portion-subject act is never legal, which would contradict §3.3's split-delivery and overflow shapes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| §4.7.1 the nine aggregate-lifecycle members — subject and `context[]`                                                                                                                        | **High** for the subjects, which are quoted from [`A3` §3.2](A3-trip-stop-assignment.md)'s table and are not decided here, and whose one grade-A support is `src:sirva-ade`'s `TripResourceAssign` carrying trip numbers and no shipment — a trip-scoped record in a live partner contract. **Medium-high** for `context[]`, which is §1.4's own worked example ("a trip-scoped delay's `subject` is the trip, its `context[]` names every shipment on board") extended mechanically to the other two. What would overturn it: nothing in the corpus; the risk is that A3 later needs a fourth aggregate lifecycle, which this table takes by addition (§1.2's enum is open to addition, never to reinterpretation).                                                                                                                                                                                                                                                                                                                                   |
| §4.7.2d the nine-member count, the offer/response split, and no `qualifier`                                                                                                                  | **Medium-high — [ORIGINAL]**, and forced rather than chosen: the count by E-TYPE + A-TYPE, the offer/response split by A-TYPE (a decline is an outcome, not an act — §2.2), and the absence of a qualifier by §1.1's ban on a subject in the payload plus §4.1's existing `supersedes`. Every mechanism is settled text; the joins are ours. What would overturn it: a case where two delays on one trip are genuinely contested by two parties _as different facts_ rather than as one party revising — in which case the fix is a subject, never a qualifier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| §4.7.1 the nine members' **authority**                                                                                                                                                       | **Not scored — owed.** [`A8` §9 item 8](A8-authority-skeleton.md) owes all nine, and the provisional readings in the table are **[ORIGINAL]** and **barred from scoring a dependent decision at any level**, exactly as `packing` and `weight.gross` are. This is the table doing its job: the gap is in the data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| §4.8 `Custody` is a projection                                                                                                                                                               | **High as a decision, [ORIGINAL] as the fold.** High because it is the only one of the three candidates that does not break settled text: an aggregate is the mutable current-state field §1.1 forbids and the stored fold A3's own `Leg` rule forbids; a fact class is a second home for `handover` (defects B and C again) **and** is circular, because its authority row's binding would be `CUSTODY`. Every source in the corpus publishes the acts and none publishes the interval — Rec 24's 41/349 are "two status codes, not an entity" in A3's own words, and 1650's `J1`/`R1` are "two complementary assertions by two different parties". **What would overturn it:** a fact about custody that is not derivable from the handovers bounding it — a custody that begins without a handover. None exists in the corpus; if one appears, the fix is a `handover` at the boundary that opens it, not a stored interval. **What is genuinely ours:** the fold, its `UNKNOWN` outcome, and the rule that it is never stored.                     |
| §4.7.1 the three order-lifecycle members — subject, `context[]`, and §4.7.2e's joins                                                                                                         | **High** for the subject, which is not decided here: `order` is already a subject kind (§1.2) and [`fork-order` §3.1](fork-order-shipment-cardinality.md) already carries the lifecycle on `subject = order:…`. **Medium-high — [ORIGINAL]** for `context[]` (§1.4's pattern extended, as the nine were) and for the three joins: the three-member count and the offer/response split by **E-TYPE** + **A-TYPE** exactly as (d), and the stage-plus-`attribution` encoding of who-ended-it in place of `src:dcsa`'s three terminal codes. The underlying findings are grade A and quoted verbatim — DCSA's `REJECTED`/`DECLINED`/`CANCELLED` and its own "most transplantable idea" gloss; `src:stedi-x12-reference`'s four-valued `B1-04` with conditional acceptance and counter-proposal. **What would overturn it:** an order termination whose commercial consequence does not follow from stage + attribution, in which case the fix is a reason code, never a type name. **The authority is not scored — owed**, on the same terms as the nine. |
| §4.7.3 `weighing` and `unpacking` deferred rather than minted                                                                                                                                | **Medium — [ORIGINAL]** as a deferral. The acts' regulatory standing is sourced and undisputed (`src:cfr-49-375` §375.509; `src:dp3-400ng` Items 4, 4.10, 4.11.d; element 187's `RG`/`RN`/`RT`), which is an argument for minting and is recorded as one. What blocks it is narrow and named: `weighing`'s family is genuinely undecided, because §375.509(a)(1)-(2) performs the act on a **vehicle** to yield a fact about the **goods**, and §4.7.2c has already left that grain owed. **What would settle it:** a source that names the subject of a weighing, or A8 §9 item 8 landing — at which point `unpacking` mints on `packing`'s row and `weighing` waits for the family.                                                                                                                                                                                                                                                                                                                                                                  |
| §4.7 rows marked **owed** (`packing`, `weight.gross`, `weight.tare`, `pieceCount` away from a custody boundary, the nine aggregate-lifecycle members, and the three order-lifecycle members) | **Low, deliberately.** The subject and `context[]` for these are as sound as any other row; the **authority** is not, and the provisional readings are marked [ORIGINAL] and barred from scoring. `A8` §9 item 8 owes them. This is the table doing its job — making the gap visible in the data rather than inventing a winner (A8-NAMED's argument, applied to a missing row rather than an empty one).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| §4.7.2 `pieceCount` and `charge` qualifiers                                                                                                                                                  | **Medium-high.** The underlying facts are sourced — `AT8-04`/`AT8-05` as two additive counts; A8 row 11's three-way propose/decide/rate with `src:milmove-mymove`'s `PaymentServiceItemParam.origin` as the who-asserted-this-number precedent. **[ORIGINAL]:** rendering each as a `qualifier` rather than as several `type`s or as one contested key. The `charge` case is not cosmetic — without it the fact key would put an approval into contest with an amount.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| §4.7.3 `notification`, `partyRole`                                                                                                                                                           | **Low — provisional and labelled so.** No source fixes a subject for either, and both depend on A8 §9 items 1, 2 and 6, none of which has landed. They are in the table because §1.3's vocabulary names them, not because they are settled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
