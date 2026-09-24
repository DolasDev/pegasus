/**
 * A6 — documents & evidence. Two rules, two recorded gaps and one mapping.
 *
 * The area's structural finding is [A6 §3.3], and it is [A2 §3.6]'s finding in a second aggregate:
 * **the `document` aggregate is a subject with no facts and an object with no acts.** [SD §4.7.1]
 * declares no `document` canonical subject family and carries `document` only in six `context[]`
 * columns, so there is no record of a document being issued, signed, corrected or cancelled.
 *
 * What A6 found that A2 could not see from the shipment side is the other half: **one declared type
 * can already take a `document` as its subject today.** `identity`'s canonical family is
 * `anyAggregate` — [SD §7.1]'s "subject may be ANY aggregate kind" — and `anyAggregate` includes
 * `document`. The model has always admitted an assertion _about_ a document and has never said
 * which assertions those are. {@link documentIdentitySubject} is that rule.
 *
 * Nothing here mints a vocabulary member. Two things are refused outright ([A6 §3.4]: a document
 * state enum, and a `documentStateAt` projection), one is recorded as absent and owed
 * (`documentIssuance`, in `vocabulary.ts`), and one published union is deliberately **not** widened
 * ([A6 §3.5(c)]: `EvidenceRef`).
 */

import type { CaptureMethod } from '../envelope'
import type { Exact } from '../primitives'
import { assertNever } from '../primitives'
import type { AssertionType } from '../vocabulary'

/* ------------------------------------------------------------------------------------------------
 * D-ID — a document's own identity, and the identity it merely carries
 * ---------------------------------------------------------------------------------------------- */

/**
 * Which subject an identifier found on a document attaches to — rule **D-ID**, [A6 §3.2].
 *
 * > "An identifier **assigned to the document as an accountable artefact** is an `identity`
 * > assertion whose **subject is the `document`**. An identifier the document merely **carries** is
 * > an `identity` assertion about that identifier's own subject, with the document in `context[]`."
 */
export const IDENTITY_SUBJECTS = [
  /**
   * The `document` itself. The scheme is one the issuer controls for the **form**, independently of
   * any shipment.
   *
   * `src:dtr-part-iv` A-413 §C.2 is the model case and it is **secondary** (`dtr-part-iv` has no
   * `captured/`): bill-of-lading numbers are serially pre-assigned accountable stock, a
   * laser-generated BL "is only accountable when a number has been assigned to the form",
   * lost/stolen/void numbers are reported to DoW PPA, and the stock is audited every 180 days.
   * Every one of those is a fact about the form — a number can be void before any shipment exists,
   * and can be lost without anything happening to any goods.
   */
  'DOCUMENT',
  /**
   * The subject the carried identifier is an identifier _of_; the document rides in `context[]`,
   * which is what [SD §4.7.1]'s `weight.net`, `pieceCount`, `condition` and `identity` rows already
   * do ("document is the weight ticket", "the inventory", "the signed inventory", "the instrument
   * the value appears on").
   *
   * Sourced in **primary** text twice. `src:cfr-49-375` §375.505(b)(16) makes "Any identification or
   * registration number **you assign to the shipment**" one of the bill of lading's seventeen
   * required items — a field _in_ the document, distinct from the document's own number, which is
   * not one of the seventeen. And §375.519(a)(6) requires a weight ticket to carry "The carrier's
   * shipment registration **or** bill of lading number", as alternatives, which is coherent only if
   * they identify two different things.
   */
  'CARRIED_SUBJECT',
] as const

export type IdentitySubject = (typeof IDENTITY_SUBJECTS)[number]

/**
 * Why D-ID cannot answer.
 *
 * One member, and it is the ordinary path rather than the edge — see {@link documentIdentitySubject}
 * and [A6 §3.2(b)]: of the six document kinds the corpus enumerates, exactly one has a scheme of its
 * own, and it is the bill of lading in its two regimes.
 */
export const IDENTITY_SUBJECT_UNDETERMINED_REASONS = [
  /**
   * The scheme is not known to be document-accountable, or is not known at all.
   *
   * `identityScheme` is an **owed code owed to A9** (`identity.ts`: "the scheme list is A9's. Until
   * it lands, a scheme is an owed code"), so whether a given scheme is assigned to the form is a
   * property A6 cannot look up. [A6 §3.2(a)] takes it as an input for that reason, which is
   * **B-ONWARD**'s shape ({@link shipmentContinuity}) and is there for the same reason: the rule is
   * decidable, its input is not published, and a default would be a guess in the one place [SD §0]
   * forbids one.
   */
  'SCHEME_ACCOUNTABILITY_NOT_PUBLISHED',
] as const

export type IdentitySubjectUndeterminedReason =
  (typeof IDENTITY_SUBJECT_UNDETERMINED_REASONS)[number]

/** What {@link documentIdentitySubject} answers. */
export type IdentitySubjectVerdict =
  | { readonly kind: 'determined'; readonly subject: IdentitySubject }
  | { readonly kind: 'undetermined'; readonly reason: IdentitySubjectUndeterminedReason }

/**
 * Whether the scheme an identifier is issued under is one assigned to the **form**.
 *
 * `undefined` is not "no" — it is "A9 has not said", and {@link documentIdentitySubject} returns
 * `SCHEME_ACCOUNTABILITY_NOT_PUBLISHED` for it rather than falling through to `CARRIED_SUBJECT`.
 * A three-valued input is the whole point: two of the three answers are honest and the third is the
 * one [SD §0] forbids inventing.
 */
export type SchemeAccountability = boolean | undefined

/**
 * **D-ID** — [A6 §3.2]. Which subject does an identifier on a document attach to?
 *
 * Why it matters rather than being bookkeeping: [SD §1.3] pairs competing assertions on the fact key
 * `(subject, type, qualifier?)`. A bill-of-lading number filed against the shipment and the same
 * number filed against the document are **two different fact keys**, so a model that files one value
 * both ways carries it twice and never notices the duplication.
 *
 * It costs no published byte ([A6 §3.2(d)]): `record.identity` declares both `subject` and
 * `context[]` as `SubjectRef.family.anyAggregate` in each emitted schema, and `anyAggregate` already
 * includes `document` and `shipment`. D-ID chooses between two shapes the schema already admits.
 */
export function documentIdentitySubject(
  schemeIsDocumentAccountable: SchemeAccountability,
): IdentitySubjectVerdict {
  if (schemeIsDocumentAccountable === undefined) {
    return { kind: 'undetermined', reason: 'SCHEME_ACCOUNTABILITY_NOT_PUBLISHED' }
  }
  return {
    kind: 'determined',
    subject: schemeIsDocumentAccountable ? 'DOCUMENT' : 'CARRIED_SUBJECT',
  }
}

/**
 * The six document kinds the corpus enumerates, with D-ID run over each — [A6 §3.2(b)]'s table as
 * data.
 *
 * Carried here rather than in prose because the count is the finding: **one verdict of `DOCUMENT`,
 * and it is the same kind in two regimes.** Every other document in the corpus is identified by
 * reference to the bill of lading or to the goods, which makes D-ID narrow and correct rather than
 * broad and speculative, and makes its `undetermined` branch the ordinary path.
 *
 * `null` marks a kind that is out of the model rather than one D-ID answers `undetermined` for —
 * [A5 §3.4(c)] excludes the permanent-storage programme, so the warehouse receipt is not scored.
 */
export const DOCUMENT_KIND_IDENTITY_SUBJECTS: readonly {
  readonly kind: string
  readonly accountableScheme: SchemeAccountability | null
  readonly citation: string
}[] = [
  {
    kind: 'bill of lading (commercial)',
    accountableScheme: true,
    citation:
      'src:cfr-49-375 §375.505(a) the carrier prepares and issues it; §375.519(a)(6) names "the ' +
      'carrier\'s … bill of lading number" as a scheme distinct from the shipment registration. Primary.',
  },
  {
    kind: 'PPGBL / government bill of lading',
    accountableScheme: true,
    citation:
      'src:dtr-part-iv A-413 §C.2 accountable stock, "only accountable when a number has been ' +
      'assigned to the form" (secondary); src:cfr-49-375 §375.103 defines a `Government bill of ' +
      'lading shipper` as one whose property moves under a GBL "issued by any department or agency ' +
      'of the Federal government" (primary).',
  },
  {
    kind: 'weight ticket',
    accountableScheme: false,
    citation:
      'src:cfr-49-375 §375.519(a) — the six items give it no number of its own: scale name and ' +
      "location, date, tare/gross/net identification, vehicle id, the shipper's last name as it " +
      "appears on the BL, and the carrier's shipment registration or bill of lading number. Primary.",
  },
  {
    kind: 'inventory',
    accountableScheme: false,
    citation:
      'src:cfr-49-375 §375.503(a) numbers **each article**, not the document (primary); ' +
      "src:dp3-tender-of-service NTS §1.6.7's nine identity fields are the lot number, the service " +
      'order number and page N of M — all borrowed or positional (secondary).',
  },
  {
    kind: 'SF 1200 correction notice',
    accountableScheme: false,
    citation:
      'src:dtr-part-iv A-413 §F.1.b — one BL per notice; the notice is addressed by the BL it ' +
      'corrects. [A6 §3.6] reads it as an [A8 §8] `Instrument`, not as a subject. Secondary.',
  },
  {
    kind: 'NTS warehouse receipt',
    accountableScheme: null,
    citation:
      'src:dtr-part-iv A-406 §B.2.d makes it "a nonnegotiable document of title whose original must ' +
      'exist exactly once". Real, and out of the model: [A5 §3.4(c)] excludes the permanent-storage ' +
      'programme. Not scored.',
  },
]

/* ------------------------------------------------------------------------------------------------
 * D-CITE — a citation is a pointer, never a claim
 * ---------------------------------------------------------------------------------------------- */

/**
 * **D-CITE** — [A6 §3.5].
 *
 * > "A reference in `evidence[]` is a pointer and never a claim. Citing a document asserts nothing
 * > about the document, and asserts nothing about whether the document establishes the fact it is
 * > cited for. Evidentiary standing is a rule over the (document kind, fact class) pair, and the
 * > corpus publishes it per pair."
 *
 * A semantics decision, so what is _held_ in the types is the refusal that follows from it:
 * {@link EvidenceRef}'s two branches are unchanged and `e-canon.ts`'s ingest-local widening is
 * ratified rather than promoted ([A6 §3.5(c)]). This constant exists so that [A6 §8] scenario 4 and
 * scenario 7 have something to assert against, which is [A2 §9]'s reason for
 * `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE` — and see {@link CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE}
 * for the case where a constant is not enough.
 *
 * The negative half is sourced three times, once in **primary** text:
 *
 * - `src:dp3-tender-of-service` §C.9.a(24), secondary: "a signed bingo card or check-off sheet
 *   **does not indicate proof of delivery**". A signed document, produced at the delivery, by the
 *   party performing it — and the contract says it does not establish the delivery. Signature plus
 *   relevance is not standing.
 * - §C.9.a(22), secondary: describing carton contents as "misc." means the TSP "agrees not to
 *   contest a claim for missing items related to the nature of such cartons" — the **content
 *   quality** of a document changes what may be argued from it, with the same signature on the same
 *   instrument.
 * - `src:cfr-49-375` §375.519(d), **primary**: true copies of all weight tickets must accompany a
 *   freight bill "**in order to collect** any shipment charges dependent upon the weight
 *   transported". A named document kind is a precondition of a named consequence — by a rule naming
 *   the pair, not by virtue of being cited.
 *
 * **The step the sources do not license** ([A6 §7]): they deny that citation _confers_ standing;
 * none says a citation is semantically empty. Going from "does not confer" to "claims nothing" is
 * **[ORIGINAL]**, and it is the step that lets a party cite another party's document without
 * tripping [SD §6.1]'s `UNAUTHORISED` row.
 */
export const CITATION_CLAIMS_NOTHING = true

/* ------------------------------------------------------------------------------------------------
 * The two recorded gaps
 * ---------------------------------------------------------------------------------------------- */

/**
 * **Document state is neither a vocabulary nor a projection** — [A6 §3.4].
 *
 * Eleven publishers offer a document state and no two decompose it the same way; at least twelve
 * facets appear across them (draft, classify, assign, submit, approve, sign, issue, distribute,
 * surrender, hold, revise, void), `src:samsara` puts approval on a **second** machine, and
 * `src:sirva-ade` demonstrates the fusion in a live grade-A contract by publishing "Bill of Lading"
 * and "Bill of Lading SIGNED" as two separate document **types**. That is [A2 §3.3]'s argument with
 * more publishers, and it reaches the same verdict: a union would be a cross-product and still wrong
 * for the next publisher, and [catalog §2.3] makes a published member's spelling breaking.
 *
 * The projection is the worse temptation, not the safer one. A `documentStateAt(document, instant)`
 * would look exactly like {@link custodyAt} and {@link orderStageAt} — the [SD §1.1] pattern for
 * anything resembling mutable state — and it would be [A2 §3.6]'s **B-STAGE** a second time: a fold
 * over records that do not exist, because [A6 §3.3] found no record of a document being issued,
 * signed, corrected or cancelled. A consumer cannot tell a fold that returns "unknown" from a fold
 * with nothing to read.
 *
 * Declared as a value rather than left as prose because [A6 §8] scenario 3 asserts it, and a
 * scenario that asserts a gap needs something to assert against ([A2 §9]).
 */
export const DOCUMENT_STATE_IS_NOT_COMPUTABLE = true

/**
 * **The capture vocabulary cannot say that a signed record's silence is an assertion** —
 * [A6 §3.7]. Handed to A4; **held as a gate rather than as a comment** — see
 * {@link CaptureMethodsAreTheSeven} immediately below.
 *
 * The published rule is that the **omission** of an exception symbol on a signed inventory is an
 * affirmative assertion of good condition with the rebuttal burden assigned:
 * `src:dp3-tender-of-service` §C.9.a(14) — "the omission of these symbols will indicate good
 * condition except for normal wear" — and NTS §1.6.2, which assigns the burden ("failure of
 * electronic items will be assumed to be transit related") and gives an escape code that still does
 * not bar a claim. `src:cfr-49-375` gives the same shape twice in **primary** text: §375.515(a)'s
 * shipper who elects not to observe a weighing "is presumed to have waived that right", and
 * §375.701(b)'s delivery receipt stating goods were received in apparent good condition "**except as
 * noted** on the shipping documents".
 *
 * [SD §5.1]'s `CAPTURE_METHODS` has seven members and none of them is *asserted by the absence of an
 * annotation on a signed record*. The semantically closest is `ASSUMED_FROM_PLAN` — "Nobody asserted
 * it; the plan stood unchallenged" — and **M1 forbids it at `basis = ACTUAL`** ([SD §5.2]), which is
 * the only basis a condition at a boundary can carry, since [SD §2.3] invariant 1 puts an act's
 * outcome there and nowhere else.
 *
 * **And the sources' rule is not M1's case, so M1 should not be relaxed.** What makes the omission
 * answerable is not that nothing contradicted it; it is that a party who was physically present
 * signed the page, **per line item and per page**, having been given the opportunity to annotate
 * every exception (`src:dp3-tender-of-service` §C.9.a(4)-(11)), and that the burden of rebutting the
 * default is assigned to a named party. That is the opposite of an unchallenged plan: it is a
 * challengeable assertion whose challenge window was offered and declined. M1's stated reason — "a
 * planned value that nothing contradicted is indistinguishable from an observation, which is the
 * difference between a record and a fabrication" — is untouched by it.
 *
 * A6 does not add the member: `CAPTURE_METHODS` is published as a seven-member `enum` on every
 * record type in both emitted schemas, the fact class it would serve is `conditionValue` (owed to A4
 * and A10), and M1-M7 are [SD §5.2]'s.
 */
export const CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE = true

/**
 * The gate behind {@link CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE}, and the next case along from
 * [A5 §9] and [A2 §9].
 *
 * [A5 §9]: a bare `Exact<>` alias is a comment until something is assigned to it. [A2 §9]: an
 * assigned one can still be a tautology, because `Exact<keyof typeof T, K>` over a mapped type `T`
 * can never fail — **"an `Exact` earns its place only between two things declared independently."**
 *
 * This is the positive case those two findings imply. The claim above has an edge the type system
 * can see: it is false the moment `CAPTURE_METHODS` gains a member. So the seven names are written
 * out **here**, in A6's own module, from A6's own reading of [SD §5.1] — nothing generates them from
 * `envelope.ts` and nothing generates `CaptureMethod` from them. An eighth member makes this `never`,
 * the assignment below stops compiling, and whoever added it is sent to [A6 §3.7].
 *
 * Contrast {@link DOCUMENT_STATE_IS_NOT_COMPUTABLE} and A2's
 * `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE`, which are plain `= true` — correctly, because their
 * claims have no edge the types can see: each is false only when a fact class is minted, and a mint
 * already touches three files and a test table. **The rule is not "always gate a recorded gap"; it
 * is "gate it when the gap has an edge the types can see, and say why when it does not."**
 */
export type CaptureMethodsAreTheSeven = Exact<
  CaptureMethod,
  | 'OBSERVED_BY_PERSON'
  | 'KEYED_BY_PERSON'
  | 'DEVICE_GEOFENCE'
  | 'DEVICE_TELEMETRY'
  | 'PARTNER_ASSERTED'
  | 'DERIVED_BY_RULE'
  | 'ASSUMED_FROM_PLAN'
>

/** The assignment that makes the alias above a gate rather than a comment — [A5 §9]. */
const _captureMethodsAreTheSeven: CaptureMethodsAreTheSeven = true
void _captureMethodsAreTheSeven

/* ------------------------------------------------------------------------------------------------
 * Table A-402-4 — the published mutability whitelist, and where its fields land
 * ---------------------------------------------------------------------------------------------- */

/**
 * Why a whitelist row may have nowhere to land — [A6 §3.6].
 *
 * The four members are not four flavours of the same problem: two are owed elsewhere, one was
 * **refused on evidence** by a landed area, and one is not a domain fact at all. That distinction is
 * the finding, because it is what shows a sub-fact grain would move none of them.
 */
export const WHITELIST_RESIDUE_REASONS = [
  /** The fact exists in no aggregate the model carries — `placeRef` is owed to [SD §1.2]. */
  'AGGREGATE_OWED',
  /** The fact class exists and its authority row is owed — `partyRole`, [A8 §9 items 1-2]. */
  'AUTHORITY_OWED',
  /** A landed area **refused** to publish the vocabulary the field would need — [A2 §3.3]. */
  'VOCABULARY_REFUSED',
  /**
   * Not a fact about the goods, the plan or a party, at any grain — Table A-402-4's accounting codes
   * and remarks. **[ORIGINAL]** as a classification: `src:dtr-part-iv` lists the fields without
   * saying what any of them is a fact _about_, and its own trap note is the nearest support — _"the
   * system is the model… large stretches describe what DPS does rather than what is true"_. [A6 §3.6].
   */
  'NOT_A_DOMAIN_FACT',
] as const

export type WhitelistResidueReason = (typeof WHITELIST_RESIDUE_REASONS)[number]

/**
 * `src:dtr-part-iv` Table A-402-4 mapped onto the fact classes the model carries — [A6 §3.6].
 *
 * The table enumerates exactly which bill-of-lading fields are correctable, with SF 1200's
 * before-value / after-value / **Authority for Correction** / remarks structure, and the rule that
 * everything else is immutable — "to change it you cancel and reissue". Secondary: `dtr-part-iv` has
 * no `captured/` and every form figure is a scanned image.
 *
 * **A6 adds no rule beside {@link instrumentReaches}.** [A8 §8]'s `Instrument.grants` is already the
 * gate and already cites this table as its precedent. What A6 supplies is the mapping, which is what
 * `authority.ts`'s own TODO asked for — and the mapping changes the TODO's shape. The whitelist is
 * not coarse because the vocabulary lacks a sub-fact grain; it is coarse because **half its fields
 * are not facts this model carries, at any grain**. Inventing a sub-fact grain would move none of
 * the four `lands: false` rows.
 *
 * `lands` rows name real {@link AssertionType} members, so a row cannot name a non-member.
 */
export type WhitelistLanding =
  | {
      readonly field: string
      readonly lands: true
      readonly types: readonly AssertionType[]
      readonly note: string
    }
  | {
      readonly field: string
      readonly lands: false
      readonly reason: WhitelistResidueReason
      readonly note: string
    }

export const TABLE_A_402_4_LANDINGS: readonly WhitelistLanding[] = [
  {
    field: 'pack date, pickup date, required delivery date',
    lands: true,
    types: ['arrival', 'departure', 'delivery'],
    note: 'Three fact classes for three dates, at a plan basis ([SD §4.2]).',
  },
  {
    field: 'authorized weight',
    lands: true,
    types: ['weight.net', 'weight.gross', 'weight.tare'],
    note:
      "At fact-class grain — and the whitelist's point is that the _authorized_ figure is " +
      'correctable while the weighed one is not, a distinction `basis` carries and `grants` cannot.',
  },
  {
    field: 'member identity; TCN',
    lands: true,
    types: ['identity'],
    note:
      "Both land as `identity`. The schemes are **A9's**, and the orders number and date that " +
      "accompany member identity are entitlement, which `src:dtr-part-iv`'s own trap note calls " +
      'out: "entitlement contaminates the shipment".',
  },
  {
    field: 'consignee and delivery address; pickup address; extra pickup/delivery addresses',
    lands: false,
    reason: 'AGGREGATE_OWED',
    note: "`placeRef` is owed to [SD §1.2] — there is no `place` aggregate, and A6 minting one would decide A3's open question by side effect.",
  },
  {
    field: 'agent code',
    lands: false,
    reason: 'AUTHORITY_OWED',
    note: "`partyRole`'s authority row is owed to [A8 §9 items 1-2]: both the party entity and the role enum are undefined.",
  },
  {
    field: 'Code of Service',
    lands: false,
    reason: 'VOCABULARY_REFUSED',
    note: '[A2 §3.3] **withdrew** `shipmentType` rather than filling it — six publishers decompose it six ways, and DTR\'s own COS "fixes mode, containerization and rate family".',
  },
  {
    field: 'accounting codes; remarks',
    lands: false,
    reason: 'NOT_A_DOMAIN_FACT',
    note: 'Neither is a fact about the goods, the plan or a party.',
  },
]

/**
 * The residue, computed rather than counted in prose — [A1 §9]'s rule, and [A6 §3.6]'s conclusion.
 *
 * Four rows with nowhere to go and not one of them A6's to fix. Exported as a function so that the
 * number in [A6 §3.6]'s prose is derivable from the table rather than asserted beside it.
 */
export function whitelistResidue(): readonly WhitelistLanding[] {
  return TABLE_A_402_4_LANDINGS.filter((row) => !row.lands)
}

/** Every reason the table actually uses, for the conformance test that holds the two in step. */
export function whitelistResidueReasons(): readonly WhitelistResidueReason[] {
  const seen = new Set<WhitelistResidueReason>()
  for (const row of TABLE_A_402_4_LANDINGS) {
    if (row.lands) continue
    switch (row.reason) {
      case 'AGGREGATE_OWED':
      case 'AUTHORITY_OWED':
      case 'VOCABULARY_REFUSED':
      case 'NOT_A_DOMAIN_FACT':
        seen.add(row.reason)
        break
      default:
        return assertNever(row.reason, 'whitelistResidueReasons')
    }
  }
  return [...seen]
}
