/**
 * The published catalog — [catalog §1], [catalog §2], [catalog §3].
 *
 * > "The published catalog is the record vocabulary, exactly — no more, no less. Its members are
 * > the 31 assertion types and the two meta-record types, and there is no coarser published layer
 * > over them." — [catalog §1]
 *
 * That decision is why this module declares almost no new vocabulary: the catalog's membership is
 * {@link RECORD_TYPES}, which [SD §1.3] and [SD §4.7] already fix, and the type-level check below
 * is what stops the two drifting apart. What *is* new here is the contract *around* the
 * vocabulary — the version it is published at, the two faces the envelope's `recordedAt` rule
 * forces, what a consumer may filter on, and what counts as an additive rather than a breaking
 * change.
 *
 * Nothing here reads a file, and nothing here mints a record type, a reason code or an authority
 * row: each of those has a home that already owes it ([catalog §0] rule 4). The reason vocabulary's
 * home was A4 and it landed ([A4 §3]); this module's part in that was one new change class and a
 * version bump ([A4 §7]).
 */

import type { Exact } from './primitives'
import type { RecordType } from './vocabulary'
import { RECORD_TYPES } from './vocabulary'

/* ------------------------------------------------------------------------------------------------
 * Membership and version
 * ---------------------------------------------------------------------------------------------- */

/**
 * The published members of the catalog — **the record vocabulary, exactly**.
 *
 * [SD §1.3]: "The catalog publishes **one** versioned record vocabulary. Its members are: one
 * member per **fact class** … one member per **meta-record class** — `FactResolved` (§4.3) and
 * `Correction` (§6)." So there is no subsetting and no coarser layer: a published member is a
 * `RecordType` and a `RecordType` is a published member, which {@link CatalogIsTheVocabulary}
 * makes a compile error to violate.
 */
export const CATALOG_MEMBERS = RECORD_TYPES

/** A member of the published catalog. Identical to `RecordType` by [catalog §1.1]. */
export type CatalogMember = (typeof CATALOG_MEMBERS)[number]

/**
 * The proof that [catalog §1]'s decision holds in the code and not only in the prose: the catalog's
 * membership and the record vocabulary are the same set. A curated subset or a coarser published
 * layer would break this line rather than ship quietly — which is the defect [SD §4.7.2e] records
 * happening to the order lifecycle, "a binding document … specifying a record that could not be
 * published".
 */
export type CatalogIsTheVocabulary = Exact<CatalogMember, RecordType>
const _catalogIsTheVocabulary: CatalogIsTheVocabulary = true
void _catalogIsTheVocabulary

/**
 * The catalog vocabulary version these artifacts are published at — [catalog §2.4].
 *
 * **[ORIGINAL]**, and deliberately pre-1.0: [SD §0]'s disclosure rule reaches the version string
 * too. A `1.0.0` would claim a settled contract, and the owed inventory — the owed authority rows,
 * the owed value shapes, the owed code vocabularies and F4 — is the evidence that it is not one. The
 * counts are not repeated here: they are generated into `catalog/index.json` and the glossary's Owed
 * section from the code, and a count written twice is a count that rots. This is the value an
 * envelope's `specVersion` carries ([SD §1.1], "the catalog vocabulary version this record was
 * minted under").
 *
 * `0.2.0` at A4: the reason vocabulary was published, which is {@link ADDITIVE_CHANGES} member
 * `publishedOwedVocabulary` and therefore a minor rather than a major ([A4 §7]).
 *
 * `0.3.0` at A8's authority rows: closing **F3** added `keySideRole` to `AuthoritativeHolder`, which
 * `ObligationRecipient` references and the emitted schemas therefore publish — `newClosedEnumMember`,
 * additive. The bump is here because the **schema diff** said so: `boundBy` is not on any record and
 * `KEY` never reaches the wire, so the change looked internal until the emitted `$defs` were read
 * ([A8 §11] revision 7).
 *
 * `0.4.0` at A1: {@link REASON_CODES} gains `DEADLINE_LAPSED` ([A1 §3.6]), which the emitted schemas
 * publish as an `enum` member on `Reason.code` — `newClosedEnumMember`, additive. A1's other
 * deliverable, `orderStageAt`, moves nothing on the wire: a projection is a fold over records that
 * already exist, exactly as `custodyAt` is, and [A1 §3.1] mints no type, aggregate, field or
 * qualifier. The **schema diff** was read before this line was written ([catalog §5]).
 *
 * `0.5.0` at A5: `Remedy`'s owed branch is replaced by `OpensStay` ([A5 §3.2]) —
 * `publishedOwedShape`, additive, and a class this bump adds. The diff is two `$defs` (one gone,
 * one new) plus a swapped `anyOf` branch on `Remedy`. A5's other deliverables move nothing on the
 * wire: the three absent fact classes are a change to what the model admits is **missing**, which
 * [catalog §5] already distinguishes from a change to what is published, and [A5 §3.3]-[A5 §3.5]
 * mint no type, aggregate, field or qualifier at all.
 *
 * `0.5.0` at A2 and again at A6: **no bump**, both times because the emitted schemas were
 * byte-identical — see [catalog §2.4]'s two non-bump rows.
 *
 * `0.6.0` at A7: `repointedOwedOwner`, additive, and a class this bump adds. **A7's decisions move
 * nothing on the wire** — §3.2 mints no aggregate, §3.3 and §3.4 publish no vocabulary, and
 * `chargeCollection` is a change to what the model admits is **missing**. What moves it is the
 * round's **audit** finding: [A7 §6] corrected `chargeValue`'s owner from A11 to `A7 / A12`, and
 * `owedTo` is rendered as a **`const`** on both faces, so the diff is one line in each schema. The
 * schema diff was read before this line was written, which is [catalog §5]'s rule and the third
 * time it has changed an answer — after `keySideRole` at A8, and after A2's and A6's empty diffs
 * being the evidence for their non-bumps.
 *
 * `0.6.1` at the cleanup round: **the first PATCH-slot bump**, and the first bump under
 * [catalog §2.3.1], which assigns the patch slot to additive changes while the major is `0`. Three
 * changes, classified together because they are one subject — how the catalog represents its own
 * bookkeeping:
 *
 * - `newClosedEnumMember` — `repointedOwedOwner` joins {@link ADDITIVE_CHANGES}, which it was
 *   documented as a member of, and used by this table's `0.6.0` row as, for a whole release without
 *   ever being declared. One line in `index.json`'s `compatibility.additive`.
 * - `newAnnotation` ×2 — the class this bump adds. `x-owed` now reaches the `Owed` **value**
 *   branches ([catalog §2.3] item 3, A3), and the owed vocabularies carry `x-owed-state` and
 *   `x-owed-why` so a consumer can tell one that is merely unread from one [A9 §3.2] refuses to
 *   close (A4).
 *
 * The emitted diff was read before this line was written, which is [catalog §5]'s rule and the
 * fourth time it has mattered: it is annotation keywords only, so no record that validated stops
 * validating. The bare generic `Owed` is deliberately NOT annotated — its `owed` is a plain string,
 * so there is no owed value for a sentence to be about.
 *
 * `0.6.2` at the owed-closures round: **two additive classes for two independent deliverables, one
 * bump**, because a `specVersion` names a published state and not a piece of work.
 *
 * - `newRecordType` — `documentIssuance` ([A6 §3.3], [A8 §5] row 17). One new
 *   `record.documentIssuance` `$def` with its top-level `anyOf` branch, one `AssertionType` enum
 *   member, and new `anyOf` branches on `record.Correction` and `record.FactResolved`.
 * - `newClosedEnumMember` — `awardedRole` on {@link AuthoritativeHolder}, which `ObligationRecipient`
 *   references, from closing `orderResponse` at [A8 §5] row 18 on the new `AWARD` binding.
 *   **`AWARD` itself never reaches the wire**: `boundBy` is on no record, so the enum member is
 *   invisible and the holder is the whole of the diff — **exactly `keySideRole`'s shape at `0.3.0`,
 *   and the second time [catalog §5]'s rule located a change the decision did not predict.**
 *
 * Nothing is removed and nothing narrowed in either face, so every record that validated still
 * validates. The owed inventory moved three ways — `authorityRows` 14 → 13, `absentFactClasses`
 * 16 → 15, `declaredRecordTypes` 31 → 32 — and carries **no** class, on the rule [catalog §5] and
 * the `0.5.0` row already settle: [catalog §2.3] classifies changes to what is **published**, and an
 * owed count is a change to what is admitted to be **missing**.
 *
 * `0.6.3` at the `roleClass` round: **three additive classes, one bump**, and two of the three are
 * classes this round had to mint.
 *
 * - `refusedOwedVocabulary` — `roleClass` moves from `pending` to `refusedOnEvidence` on the
 *   evidence of `src:stedi-x12-reference` element 98 ([A8 §9 item 2]). Two annotation values on each
 *   face, `x-owed-state` and `x-owed-why`.
 * - `newShapeBranch` — {@link Attribution} gains the `ATTRIBUTION_NO_PARTY` branch, which the two
 *   published reason codes that attribute to nobody need and which the refused vocabulary must not
 *   contain. **Read the class's docstring before the next one of these:** the branch emits
 *   `"party": false` and its sibling still accepts what it forbids, so on the wire it discloses a
 *   constraint it cannot enforce until `roleClass` is published — **the third time [catalog §5]'s
 *   rule located something the decision did not predict**, after `keySideRole` at `0.3.0` and
 *   `awardedRole` at `0.6.2`.
 * - `newClosedEnumMember` — the two classes above join {@link ADDITIVE_CHANGES} itself, which is one
 *   line each in `index.json`'s `compatibility.additive`, exactly as `repointedOwedOwner` did at
 *   `0.6.1`.
 *
 * Nothing is removed and nothing narrowed in either face. The owed **vocabulary** count does not
 * move — `roleClass` is still owed, and what changed is the reason — which is the `0.5.0` row's rule
 * again from the other side.
 *
 * `0.6.4` at the party round: **two additive classes, one bump, and the first round since A5 that
 * mints neither of them.**
 *
 * - `newAggregateKind` — `party` joins [SD §1.2]'s enum ([A8 §9 item 1]). The enum states the
 *   permission outright, so this is the one row of [catalog §2.3] that needed no argument.
 * - `repointedOwedOwner` — A7's class, on its second use. `partyRole`'s authority row read
 *   _"[A8 §9 items 1-2] — both the party entity and the role enum are undefined"_; **one of those
 *   two blockers is discharged by this very round**, so the row is re-pointed to item 2 alone and
 *   the surviving blocker is a **refusal** rather than a pending list. One line in `index.json`.
 *   **It passes §3 item 16's test rather than being tidiness:** what the item is owed FOR changed.
 *
 * **And it was nearly missed, which is the part worth keeping.** The round swept the *phrase*
 * "an identifier with no aggregate behind it" and fixed every site. It had not swept the *item* —
 * `grep "A8 §9 item 1"` — and that turned up present-tense "until it lands" prose in
 * `vocabulary.ts` (the `partyRole` member, whose docstring **renders**), `rules/authority.ts`'s
 * third `TODO`, `data/authority-table.json`'s four `owedTo` reasons and this row. **Sweeping the
 * phrase you changed is not the same as sweeping the item you closed.**
 *
 * **The whole emitted change is three defs and one line**, and the one line is the deliverable:
 * `$defs/AggregateId.party` and `$defs/SubjectRef.party` appear, `SubjectRef`'s `anyOf` and
 * `SubjectRef.family.anyAggregate` gain a branch each, and in `index.json` `identity`'s subject
 * list gains `party` — which is [A9 §3.6]'s five party-grain schemes becoming assertable. The new
 * branch **discriminates** (`"aggregate": {"const": "party"}`), checked rather than assumed after
 * `0.6.3`'s did not.
 *
 * **No record type, no fact class and no subject family were added, and that is the finding rather
 * than the scope.** `identity`'s canonical family is the enum itself ([SD §7.1] "`subject` may be
 * **any** aggregate kind"), so the member alone is the mechanism. Every attribute [A8 §9 item 1]
 * named is either an `identity` assertion or was still owed to [A8 §9 item 3] — the name and the
 * branch grain, because `src:sirva-ade`'s `Resource.Name` names a company, a person or a tractor.
 *
 * > **Amended 2026-10-09 and the release is not re-cut.** [A8 §9 item 3] closed the **branch
 * > grain** with no emitted change at all — `gbloc` identifies an office and `agentCode` carries the
 * > branch, both already `identifies: party` in this release — so what that sentence leaves owed is
 * > the **name** alone, on two of its three blockers. The decision emits nothing, which is why
 * > `0.6.4` is still the version: see `AsserterGrainIsNotOnTheEnvelope`.
 *
 * **What this round deliberately did NOT do, measured rather than deferred by preference.**
 * {@link PartyId} stays branded `party` while the subject form is branded `id:party`, so two brands
 * for one concept reach the wire. Unifying them would **remove** the published `$defs/PartyId` that
 * six defs reference — `AssertedBy` among them, which is on every envelope — and no published rule
 * compares a party-as-subject with a party-as-reference: A8-SELF takes two references,
 * `FactResolved` contests run per `(subject, scheme, vocabularyScope)`, `authorityToDeclare`
 * compares role names. So the successor shape (`SubjectRef<'party'>`, the way every other aggregate
 * is referenced) is recorded as owed to [A8] and **no class was minted for it**, because a stranded
 * change class is worse than none. Closing it is breaking.
 */
/**
 * **`0.7.0` — the catalog's FIRST BREAKING release, at [A8 §9 item 2].** The minor slot, not the
 * major: [catalog §2.3.1] assigns breaking to the minor while the major is `0`, so a consumer's
 * `^0.6.0` refuses this release unaided, which is the whole point of that assignment.
 *
 * **The breaking change is one role name.** `customer` → **`goodsOwner`**
 * (`changedRoleNameSpelling`), because a role name is a fact-key component after F1 — two spellings
 * of one role are two fact keys that never pair and never contest. Two reasons, both written out on
 * the member itself in `envelope.ts`: **A8-NAME-2 fixed the name `goodsOwner`** and the enum never
 * carried it, which is F5's defect with a different word instead of a different case; and
 * **`customer` is the one word in this area `src:cfr-49-375` never uses for a party with a duty** —
 * six occurrences, four of them a heading or Appendix A's pamphlet, against 189 of the § 375.103
 * defined term `individual shipper`, whose axis is ownership **plus** payment.
 *
 * **Plus one additive member.** `visibilityProvider` (`newClosedEnumMember`), which resolves
 * [A8 §5] rows 1-2's advisory `unresolved` entries on `src:dcsa`'s `tntPublisherRole` — "the party
 * function code of the publisher", primary and captured. It is the only candidate in item 2's list
 * that passes [A8 §2]'s addition test on primary evidence.
 *
 * **What this release does NOT do, and the measurement is why.** Item 2 is **partially** closed.
 * Its prose list and the debt it is cited for overlap in **one** entry, and **seven of the ten**
 * `owedTo` entries naming it want a **complement** ("the non-inspecting parties", "everyone else")
 * or a **relation to the fact** ("the counterparty echoing the value back", "whichever role
 * performed the act the charge is for") — things no role enum can supply. Those are re-pointed, not
 * filled. `src:cfr-49-375` § 375.205's prime / emergency-or-temporary agent split is re-pointed to
 * [A8 §9 item 4], because it classifies by **on whose behalf** rather than by function and would
 * put two axes in one enum. `Trusted Agent` and `Claims Manager` **fail** §2's addition test and are
 * recorded as refusals rather than as backlog. The NTS warehouseman, the tariff owner and the
 * government-office unfold stay owed, each on `secondary` grade.
 *
 * **And a miscitation older than this round is corrected here.** [A8 §2] and the `customer`
 * docstring cited § 375.505(a) and § 375.701 for signatures neither requires — § 375.505(a) makes
 * the **carrier** issue the bill of lading and names this party as item (3); § 375.701 forbids
 * release-of-liability language and requires no signature at all. The real mutual signatures are
 * § 375.503(c) and **§ 375.401(h)**, the latter on a **money** document and cited nowhere in the
 * corpus before now. [A8 §5] row 5's `competing` standing survives on better citations than it had.
 */
export const CATALOG_VERSION = '0.7.0'

/* ------------------------------------------------------------------------------------------------
 * The two faces
 * ---------------------------------------------------------------------------------------------- */

/**
 * The two published faces of every record — [catalog §4.1].
 *
 * Forced by [SD §1.1]'s obligation on `recordedAt`: "server-authored; **FORBIDDEN on capture,
 * MANDATORY on query**". Two types, not one optional field — and therefore two schema documents.
 * Both are external contracts: the captured face is what a `PARTNER_ASSERTED` partner asserts
 * against ([SD §5.1]), and a partner is not us.
 */
export const CATALOG_FACES = [
  /** What anything asserting into the catalog must satisfy. `recordedAt` is FORBIDDEN. [SD §1.1] */
  'captured',
  /** What anything reading out of it is served. `recordedAt` is MANDATORY. [SD §1.1] */
  'queried',
] as const

/** One of the two faces. [catalog §4.1] */
export type CatalogFace = (typeof CATALOG_FACES)[number]

/* ------------------------------------------------------------------------------------------------
 * The filter vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a consumer may filter a subscription or a query on — [catalog §3.2].
 *
 * > "The filter vocabulary is the envelope, plus the keys derived from it — and nothing else."
 *
 * One vocabulary serves both delivery modes, which is `src:dcsa`'s shape: "the same field names
 * serve as query parameters on the poll endpoint and as filter fields in the subscription body …
 * That symmetry is worth copying." Its semantics are adopted with it — AND between filters, OR
 * within a comma-separated list.
 */
export const FILTER_AXES = [
  /**
   * The single classification axis — [SD §1.1], [SD §1.3]. `src:dcsa`'s `eventTypes` filter is the
   * same axis under another name.
   */
  'type',
  /**
   * Which kind of thing the record is about — [SD §1.1]. `src:gs1-epcis-cbv` makes every vocabulary
   * a browsable collection for exactly this (`/eventTypes/{t}/events`).
   */
  'subject.aggregate',
  /** Which thing — [SD §1.1]. `src:gs1-epcis-cbv`'s `/epcs/{epc}/events`. */
  'subject.id',
  /**
   * The canonical subject family the record's subject kind belongs to — **derived**; [SD §4.7]
   * note 2, "a family is a named, closed set of `aggregate` kinds". This is one of the two axes that
   * answer the coarseness argument [catalog §1.2] refuses to answer with a second vocabulary.
   */
  'subjectFamily',
  /** The fact-class family of the record's `type` — **derived**; [SD §4.1]'s family table. */
  'factClassFamily',
  /**
   * The fact key `(subject, type, qualifier?)` — **derived**; [SD §1.3] item 3, "computed from
   * fields the record already carries". Subscribing to a fact key is how a consumer follows one
   * contested fact and receives every claim about it, which is [catalog §3.4]'s answer to
   * per-property change filtering.
   */
  'factRef',
  /**
   * Tense — [SD §4.2]. The envelope forbids a tense qualifier ([SD §1.1]), so this is the only
   * place tense is filtered, and it is a payload field rather than an envelope one.
   */
  'basis',
  /**
   * How the value was obtained — [SD §1.1], [SD §5.1]. First-class because `src:shippeo` makes
   * `trigger.type` and `platform_type` required on every standard events-out message so that "a
   * consumer can always tell a geofence crossing from a person's assertion without consulting a
   * side table".
   */
  'capturedBy',
  /**
   * The exception feed — [SD §2.2]. Legal only at `basis = ACTUAL` ([SD §2.3] invariant 1), and
   * disjoint from machine capture by [SD §5.2 M3]; see [catalog §3.3].
   */
  'outcome',
  /**
   * Who said it, in what role — [SD §1.1], "Role rides on the assertion, not the party". `src:dcsa`
   * constrains its own classifier by party role in JIT, which is the same idea one field over.
   */
  'assertedBy.role',
  /**
   * When the asserter said it — [SD §1.1]. A range with operators, as `src:dcsa` filters "both
   * timestamps with operators".
   */
  'assertedAt',
  /**
   * When we stored it — [SD §1.1]. **Queried face only**, because capture forbids the field
   * outright; a captured-face filter on it would name something that cannot exist.
   */
  'recordedAt',
] as const

/** One published filter axis. [catalog §3.2] */
export type FilterAxis = (typeof FILTER_AXES)[number]

/**
 * Where each axis's value comes from — [catalog §3.2].
 *
 * The rule the table enforces is the whole of [catalog §3]'s decision: **every axis is an envelope
 * field, a payload field the vocabulary declares, or a key derived from those.** An axis that is
 * none of the three would be a filter over something the record does not carry, and there is no
 * fourth value to give it. `satisfies` makes an undeclared axis a compile error.
 */
export const FILTER_AXIS_SOURCE = {
  type: 'envelope',
  'subject.aggregate': 'envelope',
  'subject.id': 'envelope',
  subjectFamily: 'derived',
  factClassFamily: 'derived',
  factRef: 'derived',
  basis: 'payload',
  capturedBy: 'envelope',
  outcome: 'payload',
  'assertedBy.role': 'envelope',
  assertedAt: 'envelope',
  recordedAt: 'envelope',
} as const satisfies { readonly [A in FilterAxis]: 'envelope' | 'payload' | 'derived' }

/**
 * The faces on which each axis is offered — [catalog §3.2], [catalog §4.1].
 *
 * Every axis is available on both faces except `recordedAt`, which [SD §1.1] forbids on capture.
 */
export const FILTER_AXIS_FACES = {
  type: CATALOG_FACES,
  'subject.aggregate': CATALOG_FACES,
  'subject.id': CATALOG_FACES,
  subjectFamily: CATALOG_FACES,
  factClassFamily: CATALOG_FACES,
  factRef: CATALOG_FACES,
  basis: CATALOG_FACES,
  capturedBy: CATALOG_FACES,
  outcome: CATALOG_FACES,
  'assertedBy.role': CATALOG_FACES,
  assertedAt: CATALOG_FACES,
  recordedAt: ['queried'],
} as const satisfies { readonly [A in FilterAxis]: readonly CatalogFace[] }

/**
 * What a consumer may **not** filter on, each with the decision that refuses it — [catalog §3.2].
 *
 * Carried as a published list rather than as an absence, for the reason [SD §4.7.3] gives for its
 * own absent list: "so their absence is not read as an oversight".
 */
export const REFUSED_FILTER_AXES = [
  /**
   * `context[]`, **as a default**. [SD §1.4] rule 1: "A consumer filtering by subject MUST NOT be
   * served context matches by default. If it were, the shipment-rooted envelope would reappear as
   * a query default." An explicitly named opt-in is not refused; the default is.
   */
  'context',
  /**
   * A mutable current-state field. [SD §1.1] forbids one on the envelope — "The catalog publishes
   * assertions; state is a projection" — so there is nothing to filter.
   */
  'currentState',
  /**
   * A tense qualifier. Refused at [SD §1.1]; tense lives on the value as `basis` ([SD §4.2]), which
   * is filter axis `basis` instead.
   */
  'tense',
  /**
   * Free text. `remark` exists and carries the narrative an `OTHER` reason owes ([SD §2.4] rule 3),
   * but a filter over free text has no vocabulary and no version, so it is not a contract.
   * **[ORIGINAL]**.
   */
  'remarkText',
  /**
   * A payload field no `type` declares. The payload is "typed per `type`" ([SD §1.1]), so a
   * cross-type payload filter would be filtering on a field that only some records can have.
   * **[SYNTHESIS]** of [SD §1.1] and [SD §4.7]'s per-type declaration.
   */
  'undeclaredPayloadField',
] as const

/** One refused filter axis. [catalog §3.2] */
export type RefusedFilterAxis = (typeof REFUSED_FILTER_AXES)[number]

/* ------------------------------------------------------------------------------------------------
 * Compatibility — [catalog §2.3]
 * ---------------------------------------------------------------------------------------------- */

/**
 * Changes that are **additive**: legal in a new `specVersion` within the same major — [catalog
 * §2.3].
 *
 * **[SYNTHESIS]**. The classification is ours; each member is a consequence of a sourced rule, and
 * names it. `src:dcsa` publishes the *practice* — per-release changelogs down to "`eventType`
 * filter renamed to `eventTypes`" — but no source in the corpus publishes the rule, which is why
 * the marker is on the list and not only on individual members.
 */
export const ADDITIVE_CHANGES = [
  /**
   * A new `type`, with the canonical-subject declaration [SD §4.7] requires of every member. No
   * existing row moves, and the new row is complete for the new version.
   */
  'newRecordType',
  /**
   * A new `aggregate` kind. [SD §1.2] states this one outright: the enum is "open to _addition_ in
   * a later `specVersion`, never to reinterpretation".
   */
  'newAggregateKind',
  /**
   * A new member of a closed enum the catalog publishes — a capture method, a basis, an outcome, a
   * reason scope or a reason code. **[SYNTHESIS]**: [SD §1.2]'s rule for `aggregate`, generalised.
   */
  'newClosedEnumMember',
  /**
   * The **first** publication of a vocabulary that shipped as owed — the change A4 made to the reason
   * codes.
   *
   * **This docstring used to add "and the one every remaining owed vocabulary — `roleClass`,
   * `unitOfMeasure`, `identityScheme` — will make", and that was already false when it was written
   * and is doubly false now.** [A9 §3.2] refuses `identityScheme` and [A8 §9 item 2] now refuses
   * `roleClass`, so two of the three will make {@link ADDITIVE_CHANGES} member
   * `refusedOwedVocabulary` instead, and a round that closes either has to overturn an argument
   * first. `unitOfMeasure` is the one still on this path.
   *
   * Distinguished from {@link ADDITIVE_CHANGES} member `newClosedEnumMember` because it is not an
   * addition to a list: it **narrows a string to an enum**. An owed code publishes as
   * `{"type": "string", "x-owed-vocabulary": …}`, so on the **queried** face this is a narrowing a
   * consumer can only benefit from, and on the **captured** face it is a restriction — a producer
   * sending an unrecognised code was valid and is now rejected.
   *
   * Additive rather than breaking because **the owed marker was itself published**: `x-owed` states
   * on the wire that "the code list is owed; the shape is published and the members are not", so no
   * conforming producer could have relied on a particular code being accepted, and no existing
   * member's meaning moves — which is the property [SD §1.2]'s "never to reinterpretation" protects.
   * **[SYNTHESIS]**, and the restriction is recorded with the class rather than left to be
   * discovered ([A4 §7]).
   *
   * One emitted detail worth knowing before the next one of these: the owed code's `$defs` entry
   * **disappears**. `ReasonCode.reasonCode` was a named string schema; a closed union of string
   * literals inlines as an `enum` on the property, so a consumer pinning that `$ref` loses it. A4
   * also publishes the obligations no schema can carry — which codes require a remedy or a named
   * party — as data in `catalog/index.json`'s `reasons` block.
   */
  'publishedOwedVocabulary',
  /**
   * The **first** publication of a value **shape** that shipped as owed — the change A5 made to
   * {@link Remedy}, replacing `Owed<'remedy', 'A5 — …'>` with `OpensStay` ([A5 §3.2]).
   *
   * The sibling of {@link ADDITIVE_CHANGES} member `publishedOwedVocabulary` and additive for
   * exactly the same reason, one level up the type: **the owed marker was itself published**. The
   * emitted union carried an `Owed.remedy` branch whose `owedTo` was a `const` naming A5, so the
   * wire said in as many words that this branch was a placeholder — no conforming producer could
   * have relied on it being accepted for ever, and no existing member's meaning moves.
   *
   * Distinguished from `publishedOwedVocabulary` because it does **not** narrow a string to an
   * enum: it removes one branch of an `anyOf` and adds another. On the **queried** face a consumer
   * is served a branch it can act on in place of one it could only ignore; on the **captured** face
   * it is a restriction, and the restriction is recorded here rather than left to be discovered.
   *
   * One emitted detail, the twin of the one above: the owed branch's `$defs` entry **disappears**
   * (`Owed.remedy` is gone from both faces), so a consumer pinning that `$ref` loses it.
   */
  'publishedOwedShape',
  /**
   * Correcting the **owner** of a value that stays owed — A7's change to `chargeValue`'s `owedTo`,
   * re-pointed from A11 (a claims area) to `A7 / A12` ([A7 §6]).
   *
   * The third and **weakest** use of the argument the two members above rest on, and weakest
   * because it resolves nothing: those each closed a gap, while this corrects a gap's **label** and
   * leaves the gap open. `owedTo` is rendered as a `const` on both faces, so amending it changes a
   * published constraint — but the value it constrains carries **no domain content**. It is the
   * model's bookkeeping about its own incompleteness, and its sibling `provisional` is documented
   * "never normative".
   *
   * **This member was documented by [catalog §2.3] and used by [catalog §2.4]'s `0.6.0` row for a
   * whole release before it was declared here** — the array published seven classes while the
   * document documented eight, and the glossary, which reads this array, omitted it entirely. The
   * cleanup round found it while gating [catalog §2.3.1]. A conformance test now holds the two in
   * agreement in both directions, which is what nothing did before.
   */
  'repointedOwedOwner',
  /**
   * Moving an owed vocabulary from `pending` to **`refusedOnEvidence`** — the mirror image of
   * {@link ADDITIVE_CHANGES} member `publishedOwedVocabulary`, and the fourth member of the family
   * that names changes to the model's bookkeeping about its own incompleteness.
   *
   * [A8 §9 item 2]'s change to `roleClass` is the first use. `publishedOwedVocabulary` closes a gap;
   * this one argues that the gap **does not close by effort**, and the argument is what the
   * `Exact<…, OwedCode<'v'>>` gate `data/owed-vocabularies.json` then has to name makes
   * un-overturnable in silence. On the wire it is two annotation values: `x-owed-state` and
   * `x-owed-why`.
   *
   * **Additive on the weakest of the three arguments, and weaker than `repointedOwedOwner`'s.**
   * Those two each move a `const`; this moves an `x-` **annotation**, which a validator ignores
   * outright, so no record that validated stops validating and none that failed starts passing.
   * What changes is what the wire discloses, which is [SD §0]'s direction.
   *
   * **Its own class rather than `newAnnotation`, for that member's stated reason.** `newAnnotation`
   * is a **new** keyword on a shape that had none, and its docstring refuses to be stretched:
   * "stretching that member to cover both would have made it mean two things". And it is not
   * `repointedOwedOwner`, which corrects an owed value's **owner** and leaves its state alone.
   * **[SYNTHESIS]**.
   */
  'refusedOwedVocabulary',
  /**
   * A new `anyOf` **branch** on an already-published shape, with nothing removed and nothing
   * narrowed — the class [A8 §9 item 2] needed for {@link Attribution}'s no-party branch and no
   * existing member covered.
   *
   * Distinguished from {@link ADDITIVE_CHANGES} member `publishedOwedShape`, which **replaces** an
   * `Owed` branch with a real one and therefore removes a `$defs` entry a consumer may have pinned.
   * This adds a branch beside the existing ones and takes nothing away, so it is additive without
   * needing the owed-marker-was-published argument at all.
   *
   * **The emitted diff says something the decision did not predict, and it is the third time
   * [catalog §5]'s rule has done that.** The branch the generator writes is
   * `{"party": false, "roleClass": {"const": "NO_PARTY"}}` — JSON Schema's boolean-`false` schema, so
   * the prohibition on `party` is real — but its **sibling** branch still types `roleClass` as the
   * open `OwedCode` string, which accepts `"NO_PARTY"` beside a `party` and therefore accepts every
   * record the new branch forbids. So on the wire this branch **discloses** a constraint it cannot
   * yet enforce; the TypeScript type enforces it, because `OwedCode` is a brand and the literal is
   * not assignable to it.
   *
   * That is not a defect to paper over and it is not permanent: the branch starts biting the day
   * `roleClass` is published as a closed union, which is the edge `RoleClassStaysOwed` guards. The
   * refusal is the reason the gate cannot bite, which is worth stating plainly rather than leaving a
   * reader to infer that an `anyOf` must be discriminating. **[SYNTHESIS]**.
   */
  'newShapeBranch',
  /**
   * A new `x-` **annotation** on an already-published shape — the class A3 and A4 of the cleanup
   * round needed and no existing member covered.
   *
   * Additive because an annotation is not a constraint: JSON Schema validators ignore keywords they
   * do not know, so **no record that validated stops validating and none that failed starts
   * passing**. What changes is what the wire *discloses*, which is the direction [SD §0] pushes.
   *
   * Distinguished from {@link ADDITIVE_CHANGES} member `newOptionalPayloadField`, which is a change
   * to the data contract a record is written against; this is a change to what the contract says
   * about itself. Stretching that member to cover both would have made it mean two things.
   *
   * Its two uses so far are the two halves of one asymmetry [A7 §9] recorded: `x-owed` now reaches
   * the `Owed` **value** branches and not only the `OwedCode` **vocabularies**, and the owed
   * vocabularies carry `x-owed-state` and `x-owed-why`, so a consumer can tell a vocabulary that is
   * merely unread from one [A9 §3.2] refuses to close. **[SYNTHESIS]**.
   */
  'newAnnotation',
  /**
   * A new **optional** payload field. No record that validated stops validating, and [SD §1.1]'s
   * payload row — "typed per `type`", "per type" — already leaves the per-type shape to [SD §4.7]'s
   * declaration rather than to the envelope. **[SYNTHESIS]**.
   */
  'newOptionalPayloadField',
  /**
   * A new kind of `context[]` member. `context[]` is non-authoritative and is never the resolution
   * key ([SD §1.4] rules 2 and 3), so nothing downstream keys on its membership.
   */
  'newContextMemberKind',
] as const

/** One additive change class. [catalog §2.3] */
export type AdditiveChange = (typeof ADDITIVE_CHANGES)[number]

/**
 * Changes that are **breaking** — [catalog §2.3]. **[SYNTHESIS]**, on the same terms as
 * {@link ADDITIVE_CHANGES}.
 *
 * **While the major is `0`, a breaking change is a new MINOR and an additive change is a new
 * PATCH** ([catalog §2.3.1]); a new major only once [catalog §5]'s inventory is discharged and a
 * `1.0.0` exists. The assignment is mechanical: `^0.6.0` admits `0.6.1` and excludes `0.7.0`, so a
 * caret range takes the additive releases and refuses the breaking one without anyone reading the
 * document. This list is not emitted as a schema constraint — it is published in
 * `index.json`'s `compatibility.breaking` — so amending this docstring moves no byte.
 */
export const BREAKING_CHANGES = [
  /** Removing or renaming a `type`. It is a component of the fact key ([SD §1.3] item 3). */
  'removedOrRenamedRecordType',
  /**
   * Changing a `type`'s canonical subject family. E-CANON admits a different set of records before
   * and after, and it "rejects at the boundary, not re-keys" ([SD §4.6]), so the change is visible
   * as a refusal rather than as a migration.
   */
  'changedCanonicalSubjectFamily',
  /**
   * Changing a declared `qualifier`'s shape. The qualifier is a fact key component ([SD §1.3] item
   * 3), so the change repartitions every contest over that type — which is exactly the defect F1
   * found when `handover` declared none.
   */
  'changedQualifierShape',
  /** Changing what an existing member means. [SD §1.2]: "never to reinterpretation." */
  'reinterpretedMember',
  /**
   * Moving a field between MANDATORY, OPTIONAL and FORBIDDEN. [SD §1.1]'s obligation column is the
   * contract, and its forbidden list is "permanent".
   */
  'changedFieldObligation',
  /**
   * Changing how a role name is spelled. [findings-from-alloy] F5: role names are fact-key
   * components after F1, "so spelling is load-bearing, and [A8 §2] carries two spellings with
   * nothing cross-checking".
   */
  'changedRoleNameSpelling',
] as const

/** One breaking change class. [catalog §2.3] */
export type BreakingChange = (typeof BREAKING_CHANGES)[number]
