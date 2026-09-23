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
 * too. A `1.0.0` would claim a settled contract, and the owed inventory — 19 of 31 authority rows,
 * three owed value shapes, three owed code vocabularies, F3/F4/F5 — is the evidence that it is not
 * one. This is the value an envelope's `specVersion` carries ([SD §1.1], "the catalog vocabulary version this
 * record was minted under").
 *
 * `0.2.0` at A4: the reason vocabulary was published, which is {@link ADDITIVE_CHANGES} member
 * `publishedOwedVocabulary` and therefore a minor rather than a major ([A4 §7]).
 */
export const CATALOG_VERSION = '0.2.0'

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
   * codes, and the one every remaining owed vocabulary — `roleClass`, `unitOfMeasure`,
   * `identityScheme` — will make.
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
   */
  'publishedOwedVocabulary',
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
 * Changes that are **breaking**: a new major version — [catalog §2.3]. **[SYNTHESIS]**, on the same
 * terms as {@link ADDITIVE_CHANGES}.
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
