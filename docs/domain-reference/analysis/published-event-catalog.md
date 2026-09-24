# The published event catalog — what is published, how it is versioned, what may be filtered on

Cited elsewhere as **[catalog §x]**.

> **Status.** A decision document. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

---

## 0. Rules this document is written under

The three from [SD §0], unchanged, plus one this document needs.

1. **Scope.** The reference model is an ideal target built from **external sources only**. Our own
   systems are `role: mapping-only` in `sources/registry.yaml` and are never cited for what the
   domain is. Nothing here describes, constrains or assumes anything about what Pegasus II or
   Pegasus Cloud publish today; a consumer below is an abstract consumer.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** A gap is carried as a gap and names who owes it.
4. **This document decides three things and only three** — what the catalog publishes (§1), how it
   is versioned (§2), and what a consumer may filter on (§3). §4 records what is emitted from those
   decisions and §5 what is still owed. It mints no record type, no reason code and no authority
   row, because each of those has a home that already owes it.

**Why it exists.** The work that produced this model began from a narrower question: whether an
"order changed" event should carry a projection of the order plus per-property state changes, so
that an integration could filter on the fields it cares about. Answering it needed a model of what
the domain's events actually are. That model now exists; §3 is the return to the question.

---

## 1. What the catalog publishes

> **Decision. The published catalog is the record vocabulary, exactly — no more, no less. Its
> members are the 31 assertion types and the two meta-record types, and there is no coarser
> published layer over them.**

### 1.1 This is not a new decision; it is the recognition of one already made

[SD §1.3] settles it in the course of settling the classification axis:

> "**The vocabulary.** The catalog publishes **one** versioned record vocabulary. Its members are:
> one member per **fact class** … one member per **meta-record class** — `FactResolved` (§4.3) and
> `Correction` (§6)."

So "what does the catalog publish" and "what is in the record vocabulary" were never two questions.
`src/vocabulary.ts` is the answer to both, and [SD §4.7] is its complete declaration:

|                         | Count  | Where declared                             |
| ----------------------- | ------ | ------------------------------------------ |
| Act types               | 19     | [SD §4.7.1], `ACT_TYPES`                   |
| Non-act assertion types | 12     | [SD §4.7.1] / [SD §4.7.3], `NON_ACT_TYPES` |
| Meta-record types       | 2      | [SD §1.3] item 1, [SD §4.3], [SD §6]       |
| **Published members**   | **33** | `RECORD_TYPES`                             |

### 1.2 The coarser published layer, considered and refused

The argument for one was real: a published integration contract should be coarse enough to stay
stable, and [SD §4.7.1]'s rows are fine-grained by design — `membershipOffer`, `membershipResponse`
and `membershipRelease` are three members where a coarser contract would publish one.

It is refused, and the refusal is structural rather than a matter of taste. A coarse published type
over which the fine type still exists is **a second classification axis**, and [SD §1.1] forbids one
permanently:

> "**A second classification axis.** One record, one `type` (§1.3). A record that could be filed
> under two independent vocabularies cannot be the basis of ubiquitous language, and the two
> constraint rules (E-TYPE, E-CANON) would have nothing to agree about."

The stability the argument wanted is real and is already delivered three other ways, none of which
adds an axis:

1. **A-TYPE keeps the vocabulary from growing with outcomes.** [SD §2.5]: "A record `type` names the
   fact class … It MUST NOT encode the outcome. `Delivery.Completed` is not a legal type name." The
   arithmetic is [SD §2.4] rule 2's: "~20 reasons × 5 outcomes, not ~100 types." A vocabulary that
   encoded outcomes would be the thing that could not stay stable, and it is already excluded.
2. **Addition-only versioning.** [SD §1.2] states it for the `aggregate` enum — "a **versioned
   closed enum**, open to _addition_ in a later `specVersion`, never to reinterpretation" — and §2
   below generalises it to every closed enum the catalog publishes (**[SYNTHESIS]**, marked there).
   An existing member's meaning does not move, which is the property a consumer actually depends on.
3. **The derived groupings are filter axes.** A consumer that wants "any goods-side act about this
   shipment" filters on the canonical subject family or the fact-class family — both derived from
   the single axis, neither stored, neither a second vocabulary. §3.2 axis 4.

### 1.3 One granularity, and the corpus's own fork

`src:gs1-epcis-cbv`'s analysis poses this as an open question against the catalog, in these terms:

> "Is a rollup milestone plus its components acceptable in our catalog if we state exclusivity, or
> should the catalog only ever publish one granularity? EPCIS chose 'both, mutually exclusive'; DCSA
> chose 'one granularity, classified'."

**Answered: one granularity.** The decision was in fact already taken by [SD §1.1] — "both, mutually
exclusive" is the rollup-plus-components shape, and a rollup that is itself a publishable type is
the second axis. This document records the answer rather than making it, so that the open question
is closed where it was asked.

### 1.4 The two meta-records are members, and one of them has a longer published form

They are named as members by [SD §1.3] item 1, and a consumer needs both:

- **`FactResolved`** is what answers "our best current value" when two parties assert the same fact
  ([SD §4.3]). Without it a consumer receiving two contradictory arrivals has to re-implement
  [A8]'s authority skeleton to know which one we stand behind. [SD §5.2 M1] leans on exactly this —
  a plan that nothing contradicted "is published at `basis = PLANNED`, and `FactResolved` is what
  answers 'our best current value'".
- **`Correction`** is published because [SD §6.1] makes every attempt a record: "Every correction
  attempt is recorded. There is no refusal path." A consumer that saw only `APPLIED` corrections
  would see a system that never gets anything wrong. `INEFFECTIVE` and `UNAUTHORISED` are
  "Queryable as a class" ([SD §6.1]), which is a statement about the published contract.

**The published `Correction` is the recorded form**, `RecordedCorrection` — the record class from
`assertions.ts` plus the `authority` [SD §6.2] requires ("names an **instrument**, not just a
party") and the `obligations` [SD §6.5] says a correction emits. Publishing the bare structural
`Correction` would publish a correction that does not say what authorised it, and [SD §6.2] is the
reason that is not enough.

### 1.5 What the catalog is not

- **Not a state feed.** [SD §1.1] forbids "a mutable current-state field. The catalog publishes
  assertions; state is a projection." `custodyAt(goods, instant)` ([SD §4.8]) is the worked example:
  a projection, "never stored, never asserted, never corrected".
- **Not a change/diff stream.** This is the original question's other half and it is answered in
  §3.4.

---

## 2. Versioning

> **Decision. One catalog-wide `specVersion`. The vocabulary is closed, not open-by-namespace.
> Within a major version it grows by addition only and never by reinterpretation; a removal, a
> rename or a change of meaning is a new major. A record is validated against the `specVersion` it
> carries, never against a version the consumer pinned.**

### 2.1 Catalog-wide, not per type

[SD §1.1] already defines the field: `specVersion` is "the catalog vocabulary version this record
was minted under" — **MANDATORY**, one value, naming the vocabulary and not the type. Per-event-type
versioning would need a second version field on the envelope, and [SD §1.1]'s field list is closed
by the same decision that closed the subject and the axis. So it is refused, and the refusal costs
nothing a consumer can name: a consumer that wants to know whether a given type's shape changed
between two catalog versions reads the release, which §2.4 requires to say so field by field.

### 2.2 Closed, not open-by-namespace — the corpus's biggest C8 fork, decided

The corpus holds both answers in full, and `src:gs1-epcis-cbv`'s analysis names the choice as ours
to make: "Should our vocabulary fields be open (URI-or-enum, EPCIS style) or closed (enum-only, DCSA
style)? … **The biggest C8 decision in the catalog; make it once**."

**EPCIS — open by namespace.** "Every vocabulary field is `anyOf [ your-own-URI, CBV-enum ]`.
`vocab-other-uri` is defined as any URI that does **not** start with `urn:epcglobal:cbv` … So
`bizStep`, `disposition`, `bizTransaction-type`, `source-dest-type` and `error-reason` are all open:
mint `https://pegasus.example/cbv/bizstep/sit_in` and it validates. Extension is by _namespace_, not
by an `OTHER` escape hatch." Unknown event types validate via `Extended-Event`, and any namespaced
URI key is a legal extension field anywhere.

**DCSA — closed, with process.** "Every enum is closed. There is no namespaced-extension mechanism,
no `additionalProperties`, no vendor field. Adding a value means a new version of the shared domain
and a new release of every API that references it." Its analysis calls the discipline "the best I
have seen in a source of this kind, and it is _process_, not just syntax".

**Decided: closed.** Three reasons, each already binding:

1. **E-TYPE rejects at the boundary.** [SD §1.3]: "A record carrying no `type`, **a `type` outside
   the vocabulary for its `specVersion`**, or any second classification alongside it, is rejected at
   the boundary." A boundary that rejects an unknown type and a vocabulary any party may extend by
   minting a URI cannot both be true.
2. **E-CANON needs a declaration per type, in one place.** [SD §4.7] requires every type to declare
   its canonical subject family, its qualifier shape and its `context[]` there, and [SD §1.3] makes
   that declaration complete. A minted type has no row, and [SD §4.7.2e] is the record of what a
   type with no row costs: "a binding document … specifying a record that could not be published."
3. **The cost of openness is stated by the open source itself.** `src:gs1-epcis-cbv`'s analysis:
   "Anything can be a URI, so anything can be an opaque string. The typed-reference discipline is
   only as good as the namespace governance behind it. Adopting `vocab-other-uri`-style extension
   means owning a registry of our URIs."

The cost of closure is accepted with its name on it: as DCSA's changelogs show, "added new enum
values to `shipmentEventTypeCode` — `PENC`, `CANC`" is a versioned release event. It is the
trade this catalog makes.

**One open member survives, and it is not an extension point.** `OTHER` on a reason, with a
mandatory `remark` ([SD §2.4] rule 3, two independent sources). It carries a narrative, not a
vocabulary: it does not let a party mint a code, and nothing switches on it.

### 2.3 Additive, breaking, and what a consumer may rely on

**[SYNTHESIS]** — the classification is ours; every line is a consequence of a sourced rule, and the
rule is named.

**Additive** (a new `specVersion` within the same major):

| Change                                                                                    | Why additive                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new `type` row, with its [SD §4.7]-shaped declaration                                   | The declaration is complete for the new version; no existing row moves                                                                                                                                                                                                                                                                                                                        |
| A new `aggregate` kind                                                                    | [SD §1.2] states exactly this: "open to _addition_ in a later `specVersion`"                                                                                                                                                                                                                                                                                                                  |
| A new member of `CAPTURE_METHODS`, `BASES`, `OUTCOMES`, `REASON_SCOPES`, or a reason code | Same rule, generalised — **[SYNTHESIS]**                                                                                                                                                                                                                                                                                                                                                      |
| **The first publication of a vocabulary that shipped owed** — `publishedOwedVocabulary`   | Not an addition but a **narrowing**, `string` → enum. Additive because the owed marker was itself published: `x-owed` states on the wire that "the members are not", so no conforming producer could have relied on a code being accepted, and no existing member's meaning moves — see below. **[SYNTHESIS]**                                                                                |
| **The first publication of a value _shape_ that shipped owed** — `publishedOwedShape`     | The sibling of the row above, one level up the type: A5 replaced `Remedy`'s `Owed` branch with `OpensStay` ([A5 §3.2]). Additive on the same ground — the emitted union carried an `Owed.remedy` branch whose `owedTo` was a `const` naming A5, so the wire said the branch was a placeholder. It removes one `anyOf` branch and adds another rather than narrowing a string. **[SYNTHESIS]** |
| A new optional payload field                                                              | No record that validated stops validating                                                                                                                                                                                                                                                                                                                                                     |
| A new `context[]` member kind                                                             | `context[]` is non-authoritative ([SD §1.4]) and nothing keys on it                                                                                                                                                                                                                                                                                                                           |

**Breaking** (a new major):

| Change                                                   | Why breaking                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Removing or renaming a `type`                            | It is a fact key component ([SD §1.3] item 3)                                                                                        |
| Changing a type's canonical subject family               | E-CANON admits different records before and after                                                                                    |
| Changing a `qualifier` shape                             | It is a fact key component, so the contest repartitions                                                                              |
| Changing what an existing member **means**               | [SD §1.2]: "never to reinterpretation"                                                                                               |
| Moving a field between MANDATORY, OPTIONAL and FORBIDDEN | The envelope's obligations are the contract                                                                                          |
| Changing a role name's spelling                          | F5 in [`findings-from-alloy.md`](findings-from-alloy.md): role names are fact-key components after F1, "so spelling is load-bearing" |

**Both owed-publication classes carry a restriction, and it is recorded rather than absorbed.** The
narrowing is safe on the **queried** face — a consumer is served a narrower type — and is a genuine
restriction on the **captured** face: a producer sending an unrecognised code was valid and is now
rejected. It is classified additive on the strength of the published `x-owed` annotation, not on the
strength of nobody minding. A4 is the first use of the class ([A4 §7]); `roleClass`, `unitOfMeasure`
and `identityScheme` are the three vocabularies still owed, and the glossary's Owed section lists
them as such. A5 is the first use of `publishedOwedShape` ([A5 §3.2]), which removes one `anyOf`
branch rather than narrowing a string; the branch it removed was itself annotated as owed on the
wire, which is why the two classes share an argument.

**Deprecation is marked, never deleted.** Adopted from DCSA, whose fields "carry `deprecated: true`
with a note saying what supersedes them and why they are still required", and whose old versions
stay in the repository. **[SYNTHESIS]** in adopting it.

**What a consumer may rely on**, stated as the consumer's own rule:

- **Validate against the `specVersion` the record carries.** The emitted schemas are closed
  (`additionalProperties: false`), so a record minted under a later version will fail an earlier
  version's schema. That is intended: it is why the version rides on the record.
- **Treat an unfamiliar member of a closed enum as unhandled, not as invalid.** Closure is a promise
  about meaning, not a promise that the consumer has seen every member. This is the one obligation
  closure puts on the consumer rather than on the publisher, and it is **[ORIGINAL]**.
- **Do not infer anything from a type's absence in a feed.** Absence is an authority or capture
  question ([A8], [SD §5]), not a vocabulary one.

### 2.4 The version this catalog is published at

**Pre-1.0, deliberately, and the number itself is in the code** — `CATALOG_VERSION` in
`src/catalog.ts`, emitted as `x-spec-version` on both faces. **[ORIGINAL]**: [SD §0]'s disclosure
rule reaches the version string too, so a `1.0.0` would claim a settled contract and §5's inventory
is the evidence that it is not one. The owed inventory is published inside the catalog itself (§4.2)
so that a consumer reads it without reading this document, **and the counts are not restated here**:
an earlier revision of this section carried "19 of 31" beside a generated count of 14 and read as
current for a whole release ([A1 §9]).

The bumps, and what each was classified as under §2.3:

| From → To         | At                     | Change                                                                                                                                        | Class                     |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `0.1.0` → `0.2.0` | A4's reason vocabulary | The vocabulary shipped owed and was published — `string` → enum ([A4 §7])                                                                     | `publishedOwedVocabulary` |
| `0.2.0` → `0.3.0` | A8's rows 12-16        | Closing F3 added `keySideRole` to `AuthoritativeHolder`, which `ObligationRecipient` references                                               | `newClosedEnumMember`     |
| `0.3.0` → `0.4.0` | A1                     | `REASON_CODES` gains `DEADLINE_LAPSED` ([A1 §3.6]). A1's other deliverable, `orderStageAt`, is a **projection** and moves nothing on the wire | `newClosedEnumMember`     |
| `0.4.0` → `0.5.0` | A5                     | `Remedy`'s owed branch is replaced by `OpensStay` ([A5 §3.2]). A5's other deliverables mint no type, aggregate, field or qualifier            | `publishedOwedShape`      |
| `0.5.0` → `0.5.0` | A2                     | **No bump.** Both emitted schemas are byte-identical across A2; the only published change is one more member of the owed inventory            | none — see below          |
| `0.5.0` → `0.5.0` | A6                     | **No bump**, for the same reason and on stronger evidence — A6's central deliverable is a decision **not** to widen a published union         | none — see below          |

**A2 is the first area to change nothing on the wire, and the rule that says so is already here.**
[§5](#5-what-the-catalog-does-not-yet-publish) records of A8's round that a moving owed inventory
_"alone would not have moved `specVersion`"_, because §2.3 classifies changes to what is
**published** and an owed count is a change to what is admitted to be **missing**. A2's deliverables
are a rule (`shipmentContinuity`, [A2 §3.2]) whose vocabularies no record carries, one more absent
fact class (`shipmentCommitment`, [A2 §3.6]), and a set of refusals. `git diff` over
`captured.schema.json` and `queried.schema.json` is empty, which is the evidence rather than the
claim. **A version bumped for a release that changes no published byte would tell a consumer to
re-validate for nothing**, and [SD §0]'s disclosure rule reaches the version string (§2.4 above).

**A6 is the second, and the non-bump is the deliverable rather than a side effect.** [A6 §3.2]'s rule
**D-ID** files an assertion the published schema **already admits** — `record.identity` declares both
`subject` and `context[]` as `SubjectRef.family.anyAggregate`, which includes `document` and
`shipment` — and [A6 §3.5(c)]'s decision is explicitly a refusal to widen `EvidenceRef`, whose two
branches are published with `additionalProperties: false`. So where A2 changed no byte because its
output happened not to reach the wire, A6 changed none because **reaching the wire was the cost it
declined to pay**: ratifying an ingest-local widening costs nothing, and widening a published union
costs every consumer a re-validation. `absentFactClasses` moves 14 → 15 in `index.json` and both
schemas are byte-identical, which is again the evidence rather than the claim.

What caps the version is the authority rows, and no amount of vocabulary work moves that.

---

## 3. Subscription and filtering

> **Decision. The filter vocabulary is the envelope, plus the keys derived from it — and nothing
> else. `context[]` is never a default filter axis. One filter vocabulary serves both delivery
> modes.**

### 3.1 The shape, taken from two sources that agree

**A subscription is a saved filter plus a callback**, and the filter fields are the query fields.
`src:dcsa`: "All values in the subscription body except `callback`, `secret` and `subscriptionID`
will be used as filters. All filters specified **must** be fulfilled in order to match an Event. A
logical **AND** is used between filters [and] filters specified as `,` separated lists use logical
**OR** between list values." Its analysis draws the conclusion: "The same field names serve as query
parameters on the poll endpoint and as filter fields in the subscription body — one filter
vocabulary, two delivery modes. **That symmetry is worth copying.**" Adopted, with its AND/OR
semantics.

**Poll is mandatory; push is optional.** `src:dcsa`: "`GET /v3/events` … **This endPoint is
mandatory to implement.**" / "The push model is **optional** to implement", with a dedicated
`notImplemented` error schema and a `501` for unimplemented subscription endpoints. Adopted
(**[SYNTHESIS]**): it lets publishers of very different capability implement the same catalog, and
it means a consumer always has a way to recover from a missed delivery.

**A named filter is a first-class object.** `src:gs1-epcis-cbv` makes queries server-side resources
(`/queries/{queryName}`) that subscriptions attach to — "the filter is a first-class, named,
reusable object, not a subscription-time blob" — and offers `stream: true` or a cron `schedule`,
with `reportIfEmpty` controlling whether an empty scheduled run fires. Adopted as a shape
(**[SYNTHESIS]**); the two sources differ here and EPCIS is the richer of them.

### 3.2 The axes

Every axis is an envelope field or a key derived from envelope fields. There are no others, and that
is the whole rule.

| #   | Axis                | What it is                                                                 | Authority                                                                                                  |
| --- | ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | `type`              | The single classification axis                                             | [SD §1.1], [SD §1.3]; DCSA's `eventTypes` filter                                                           |
| 2   | `subject.aggregate` | Which kind of thing the record is about                                    | [SD §1.1]; EPCIS's `/eventTypes/{t}/events`-style resource collections                                     |
| 3   | `subject.id`        | Which thing                                                                | [SD §1.1]; EPCIS's `/epcs/{epc}/events`                                                                    |
| 4   | `subjectFamily`     | A **derived** grouping over 2 — `SUBJECT_FAMILIES`                         | [SD §4.7] note 2                                                                                           |
| 5   | `factClassFamily`   | A **derived** grouping over 1 — `FACT_CLASS_FAMILIES`                      | [SD §4.1]                                                                                                  |
| 6   | `factRef`           | The **derived** fact key `(subject, type, qualifier?)`                     | [SD §1.3] item 3                                                                                           |
| 7   | `basis`             | Tense — requested, committed, planned, estimated, actual                   | [SD §4.2]; the envelope forbids a tense qualifier, so this is where tense is filtered                      |
| 8   | `capturedBy`        | How the value was obtained                                                 | [SD §1.1], [SD §5.1]; and §3.3 below                                                                       |
| 9   | `outcome`           | The exception feed                                                         | [SD §2.2]; and §3.3 below                                                                                  |
| 10  | `assertedBy.role`   | Who said it, in what role                                                  | [SD §1.1] "Role rides on the assertion, not the party"; DCSA's JIT constrains its classifier by party role |
| 11  | `assertedAt`        | When the asserter said it — a range, with operators                        | [SD §1.1]; DCSA filters "both timestamps with operators"                                                   |
| 12  | `recordedAt`        | When we stored it — **queried face only**, since capture forbids the field | [SD §1.1]                                                                                                  |

The twelve are `FILTER_AXES` in `src/catalog.ts`, and each declares whether it is an envelope field,
a payload field or derived from them — a table `satisfies`-checked against the axis list, so an axis
with no declaration fails to compile.

**Refused, and why each:**

- **`context[]`, by default.** [SD §1.4] rule 1: "A consumer filtering by subject MUST NOT be served
  context matches by default. If it were, the shipment-rooted envelope would reappear as a query
  default." A consumer may ask for context matches **explicitly**, as a separately named opt-in —
  the rule is about the default, and the opt-in is what keeps "every record touching this shipment"
  answerable without making it the meaning of `subject`.
- **A mutable current-state field.** There is none ([SD §1.1]); a filter cannot name a field the
  envelope forbids.
- **A tense qualifier.** Refused at [SD §1.1] and served by axis 6 instead.
- **Free text.** `remark` ([SD §2.4] rule 3) exists and carries the narrative an `OTHER` code owes.
  A filter over it is not a contract: it has no vocabulary and no version. **[ORIGINAL]**.
- **A payload field that no type declares.** The payload is typed per `type` ([SD §1.1]), so there
  is no cross-type payload filter to offer.

### 3.3 The one consequence worth stating on its own

Axes 8 and 9 are not independent, and the dependency is a published guarantee rather than an
implementation detail.

[SD §5.2 M3]: "Every act record with `outcome ≠ COMPLETED`, and every `Reason`, requires
`capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`." The rule is Shippeo's,
measured: of the 38 rows of `event-list-order-level.md`, exactly seven are geofence-eligible, and
"not one of the geofence-marked rows is an exception row". Shippeo's analysis states the rule the
table encodes:

> "A machine may assert _where the vehicle is_ and _that an ETA changed_. It may never assert _why
> something went wrong_. Every exception requires a human declaration."

**Consequence: a subscription to exceptions and a subscription to machine-captured records are
disjoint by construction.** There are no machine-asserted exceptions to subscribe to, and a consumer
does not have to filter them out or trust that somebody did. **[SYNTHESIS]** — M3 is sourced, the
statement of what it means for a subscriber is ours.

This is also why `capturedBy` is a first-class axis rather than a provenance footnote. Shippeo makes
`trigger.type ∈ {manual, geofencing}` and `platform_type` **required** on every standard events-out
message, and its analysis gives the reason: "A consumer can therefore always tell a geofence
crossing from a person's assertion without consulting a side table." `capturedBy` is that field, and
[SD §5] cuts every capture rule on it.

### 3.4 The original question, answered

**A consumer cannot filter on "which properties changed", and does not need to.**

The catalog publishes assertions, not diffs. What a change looks like is two assertions that share a
fact key ([SD §1.3] item 3) and disagree; `FactResolved` says which one we stand behind and keeps the
losers in `considered[]` ([SD §4.3]). A consumer that cares about a particular fact subscribes to
that fact key — axis 5 — and receives every claim about it, with the resolution. It never asks "did
the weight change", because it is subscribed to the weight.

Two things in the corpus say why the diff shape is the worse one, and both are external:

- **A change stream is ambiguous unless it declares which kind of change it is.**
  `src:sirva-ade`'s analysis records the ambiguity as an unresolved question against a live partner
  contract: one page says "the scope of the shipment details will vary based on Event Type", another
  says "All the shipment elements are sent and will reflect null if change does not impact element"
  — "it decides whether an event is a delta or a snapshot", and the contract does not say.
- **The standard that does say, says it with a purpose code.** `src:stedi-x12-reference`: `B2A` plus
  element 353 distinguishes `04` Change, `05` Replace and `25` Incremental — "whole-document
  replacement, field-level change, and delta — and a message says which it is." A diff stream that
  does not carry that distinction has left it to the reader.

**[SYNTHESIS]:** the conclusion that a catalog of domain facts does not have to answer the
delta-or-snapshot question, because it never sends a document, is ours. Both premises are sourced.

**What is genuinely consumer-side, and stays there.** Whether a given delivery represents a change
_from what this particular consumer last saw_ depends on what that consumer was last delivered, and
no publisher knows that. The catalog gives it everything needed to decide — the fact key, the
assertion, the resolution and an append-only history ([SD §4.3] "the history of _which answer we
were giving when_ survives") — and does not take the comparison on. **[SYNTHESIS]**; nothing in the
corpus states this, and it is recorded as ours rather than dressed as a finding.

**And the fat-payload option is refused.** `src:dcsa`'s booking notifications come in "a
**lightweight** flavour (status + references only) and a **full state transfer** flavour (the entire
Booking document embedded), and the subscriber chooses — the thin-vs-fat event debate, resolved by
offering both and letting the subscriber pick." That resolution is not available here: the full
state transfer is a mutable current-state payload, which [SD §1.1] forbids permanently. Our records
are already the fact rather than a pointer at a document, so there is no fat flavour to offer.
**[ORIGINAL]** as the refusal.

---

## 4. What is emitted, and how it is kept honest

### 4.1 Two faces, because the envelope has two

[SD §1.1] makes `recordedAt` "**server-authored; FORBIDDEN on capture, MANDATORY on query**", which
`src/envelope.ts` already renders as two types rather than one optional field. The catalog therefore
publishes **two schema documents**, and both are external contracts — the captured face is what a
`PARTNER_ASSERTED` partner asserts against, and a partner is not us.

| Face         | Who it binds                                             | `recordedAt` |
| ------------ | -------------------------------------------------------- | ------------ |
| **captured** | Anything asserting into the catalog, ours or a partner's | FORBIDDEN    |
| **queried**  | Anything reading out of it — a subscriber, a poller      | MANDATORY    |

### 4.2 The artifacts

Under [`../catalog/`](../catalog/), all generated from `packages/domain-reference/src/` by
`packages/domain-reference/tools/generate-catalog.ts` and never hand-written:

- `captured.schema.json`, `queried.schema.json` — JSON Schema 2020-12, one `$defs` entry per
  published member and a top-level `oneOf` over all of them. JSON Schema because it is the format
  the corpus itself publishes: EPCIS ships `EPCIS-JSON-Schema.json` and DCSA ships OpenAPI schemas.
- `index.json` — the manifest: version, members with their declared family and qualifier, the filter
  axes and the refused ones, the compatibility classification from §2.3, and **the owed inventory**
  (§5), so a consumer sees the gaps without reading this file.
- `README.md` — generated, pointing at both.

**Closed schemas, and the forbidden fields made mechanical.** Every object is
`additionalProperties: false`, and each of [SD §1.1]'s permanently-forbidden envelope fields is
emitted as `"<field>": false` — a schema that refuses the field by name rather than by silence. The
list stops being prose a reader has to remember.

### 4.3 The gate

`tests/conformance/catalog-staleness.test.ts`, built exactly like the glossary's: regenerate in
memory, compare with what is committed, fail naming the first differing line and the command that
fixes it. The emitted bytes are a prettier fixed point, because the pre-commit hook rewrites JSON
and markdown and a generator that is not a fixed point turns its own gate into a false green.

---

## 5. What the catalog does not yet publish

Read the generated `Owed` section of [`../glossary.md`](../glossary.md) for the current list; it is
derived from the code and cannot go stale. As at this version it holds: **18 declared owed values**,
**3 closed vocabularies whose members are owed** (`roleClass`, `unitOfMeasure`, `identityScheme` —
the reason vocabulary was a fourth until A4), **14 of 31** record types whose authority row is owed
in whole or in part, **2** whose fact-class family is owed, and **15** fact classes named in the
corpus and absent from the vocabulary.

**Two of those five moved at A5, in opposite directions, and the pair is worth reading together.**
The declared count fell by one because [A5 §3.2] published the remedy shape A4 left owed; the absent
count rose by three because [A5 §3.6] found three storage fact classes the corpus names and no table
carried. A gap list that only ever shrinks is a gap list nobody is still reading the corpus against.

**The absent count rose again at A2, and this one is a different kind of entry.** A5's three were
facts about a stay that the corpus names and the table had not reached. [A2 §3.6]'s
`shipmentCommitment` is the act that **mints a shipment** — so unlike every other member of the list
it is not a fact the model has yet to get to, but the precondition of nineteen act rows that were
written on top of it. [A2 §1] is the finding: _the `shipment` aggregate has no record of its own
coming into existence_, which is why [`fork-order` §5.2]'s `B-STAGE` has been a projection with no
input records since it was written. **An owed inventory that surfaces a hole this old is doing the
job §2.4 keeps the version pre-1.0 for.**

**And once more at A6, where the entry is the cheapest one on the list rather than the deepest.**
[A6 §3.3] ran A2's check over the `document` aggregate and found the same shape — no row of
[SD §4.7.1] records a document being issued, signed, corrected or cancelled — so `documentIssuance`
joins the list. What makes it different from every entry above is that **its authority is already
answered**: [A8 §5] row 10's `boundBy = SCHEME` determines its holder, so a row in [SD §4.7.1] and a
row in [A8 §5] are all that is owed, with nothing owed underneath either. A5's three are blocked on a
party class, A2's and A1's three on a `boundBy` member, and this one on minting alone — **a third kind
of blocker, and the only one of the three that needs no prior decision.**

**These five numbers are the only counts this document may carry, and they are gated**:
`tests/conformance/catalog.test.ts` reads them out of this section and compares them with
`collectOwedInventory()`, so a stale one fails the build. The counts that went stale were the
**ungated** copies elsewhere — [§2.4](#24-the-version-this-catalog-is-published-at)'s, and the
generator's own hand-written note — and the fix for those was to delete them rather than to correct
them ([A1 §9]).

**The authority rows went from 19 to 14, and that alone would not have moved `specVersion` — but
something else did.** [A8 §5] rows 12-16 closed `handover`, `weight.gross`, `weight.tare`, `packing`
and `pieceCount`. A shrinking owed inventory is the gap list getting shorter, not a vocabulary
change: §2.3 classifies changes to what is **published**, and that is a change to what is admitted to
be **missing**. The new `boundBy` member `KEY` is likewise invisible on the wire — no record carries
`boundBy`, and it appears in `index.json` only inside the owed inventory's own rows.

**What did move it: `keySideRole`.** Closing F3 needed a new `AuthoritativeHolder` member, and
`AuthoritativeHolder` is referenced by `ObligationRecipient`, which the emitted schemas publish. So a
record's `obligations[].recipient` may now carry a `kind` the previous version's schema rejected —
`newClosedEnumMember`, additive, **`0.2.0` → `0.3.0`**.

That is recorded in this much detail because the reasoning nearly went the other way. `boundBy` is not
on a record and `KEY` is not on the wire, so the change _looked_ internal; it was the **schema diff**
that said otherwise. A compatibility classification argued from which fields feel published is a
classification waiting to be wrong — read the emitted `$defs`.

Three of those bear directly on this catalog and are named here so they are not read as oversights:

1. **The A4 reason vocabulary — landed, and this is what is left of it.**
   [`A4-execution-events.md`](A4-execution-events.md) published 23 members at `0.2.0`, from the
   evidence this section used to list as captured: Shippeo's two-axis grid, X12 element 1651's 86
   values organised by responsible party, UNECE Rec 24's status list — and, for the `SITE` and
   `ADMINISTRATIVE` members, `src:dp3-400ng` Items 125.1 and 33, which [A4 §4.4] found to be a
   regulation-grade cause list where [SD §2.4]'s examples had suggested nothing was available.

   Still owed, and the only two vocabulary gaps this contract now carries: the **`roleClass` enum**
   ([A8 §9 item 2]), which publishes as an `x-owed-vocabulary` string and to which A4 hands one
   concrete requirement — force majeure and an unknown cause both attribute to nobody, so the enum
   needs an explicit non-party member — and every **remedy shape beyond `newWindow`**, of which the
   one that matters opens a storage-in-transit stay and belongs to A5.

2. **F4 is the only open finding** in [`findings-from-alloy.md`](findings-from-alloy.md). **F3 and
   F5 are both resolved**, and F5's resolution is the one that touches this contract.

   Role names became fact-key components at F1, so their spelling is load-bearing, and [A8 §2]
   carried **two** spellings of one cast — A8-NAME-1's lower-camel rule (`originAgent`, `sitAgent`)
   and, in the same section, `src:sirva-ade`'s capitalised cast (`OriginAgent`, `SITAgent`, not even
   a pure case fold) — with nothing cross-checking them. `ROLE_NAMES` in `envelope.ts` pinned
   lower-camel, and **this catalog publishes that spelling on the wire** as a closed enum, with
   filter axis 10 filtering on it.

   **A8 has now settled it the way the pin guessed:** A8-NAME-1 wins because it is a _rule_ and the
   ADE cast is a _citation_, the ADE spellings stay as the **source** of the names rather than as a
   second set of them, and **a role name is case-significant on the wire**. So the
   `changedRoleNameSpelling` risk this item used to carry is **discharged, not merely survivable** —
   the published enum is now evidence the question was settled rather than evidence it was not.
   What [A8 §9 item 2] still owes is the _full_ vocabulary, including roles [A8 §2] names but does
   not define; a later **addition** to it is `newClosedEnumMember` and additive.

   **F4** — `ExternallyPerformedLeg.performedBy` has no consumer — does not touch the published
   contract: it is a question about the custody fold's inputs, not about what a record may carry.

3. **`charge`, `condition` and `notification` carry owed values.** They are published members with a
   declared subject family and no value shape, and the emitted schemas say so with the owed marker
   rather than with a permissive empty object.
4. **One shape in the emitted schemas spans two subject families**, and it is worth recording as a
   finding rather than leaving a reader to wonder. `Reason.appliesTo` is
   `SubjectRef<'portion' | 'item'>[]` ([SD §2.4], the field that carries [SD §3.4]'s "delivered, two
   items short"), and `{item, portion}` matches no declared family — so the generator publishes it
   as `SubjectRef.item+portion` rather than inventing one. That is correct and not a defect:
   E-CANON constrains a record's **subject**, and `appliesTo` is a payload field naming a scope, not
   a subject. [SD §5.4] keeps the two grains apart deliberately — "a value _per article_ is an
   `item`-subject fact; a scope of an act is a Portion" — so a family joining them would fuse
   exactly what that section separates. **[SYNTHESIS]**.

---

## 6. Confidence, and what would change this

| Decision                                         | Confidence                   | What would move it                                                                                                                                          |
| ------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Catalog = the record vocabulary, 33 members   | **High**                     | Only a change to [SD §1.1] or [SD §1.3], which are the two least revisable decisions in the model                                                           |
| §1.4 `Correction` publishes in its recorded form | **Medium**                   | A corrections-area document that separates the recorded form from the published one; [SD §6] does not                                                       |
| §2.2 Closed vocabulary                           | **High**                     | A named integration requirement for tenant-minted types. It would not be a small change: E-TYPE and E-CANON both assume closure                             |
| §2.3 The additive/breaking split                 | **Medium** — **[SYNTHESIS]** | A source that publishes its own compatibility classification. DCSA publishes the _practice_; neither source publishes the rule                              |
| §2.4 Version `0.1.0`                             | **High**                     | §5 emptying out                                                                                                                                             |
| §3.2 The twelve axes                             | **Medium-high**              | A consumer requirement that names an axis not derivable from the envelope. That would be evidence the envelope is missing a field, and belongs at [SD §1.1] |
| §3.3 Exceptions and machine capture are disjoint | **High**                     | M3 changing                                                                                                                                                 |
| §3.4 No diff stream                              | **High**                     | Nothing in the corpus supports the diff shape; both cited sources are evidence against it                                                                   |
