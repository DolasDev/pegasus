/**
 * The generic `Assertion`, and resolution — [SD §4].
 *
 * > "There is one published record class: the `Assertion`. Every fact the catalog carries — a
 * > time, a weight, a piece count, a condition, a status, an identifier, the performance of an act
 * > — is an assertion about one fact, by one party, at one basis. `basis = ACTUAL` is legal.
 * > `OccurrenceEvent` as a separate class is abolished. Competing assertions are resolved by a
 * > published, append-only `FactResolved` naming its rule." — [SD §4]
 *
 * The answer to [round-2-critique] must-fix #4 is therefore: "weights, piece counts, conditions
 * and statuses DO have a competing-assertion story, and it is the same one times have."
 */

import type { CapturedEnvelope, EventId, QueriedEnvelope, SubjectRef } from './envelope'
import type { PartyId } from './ids'
import type { CustodyBasis, CustodyHolder } from './custody'
import type { IdentityValue } from './identity'
import type { ActOutcome } from './outcomes'
import type {
  Brand,
  CalendarDate,
  Exact,
  Instant,
  NonEmptyArray,
  Owed,
  OwedCode,
} from './primitives'
import type {
  ActType,
  AssertionType,
  CanonicalSubjectKind,
  FactRef,
  HandoverQualifier,
  NonActType,
  QualifierByType,
  QualifierOf,
} from './vocabulary'
import { stableStringify } from './primitives'
import { HANDOVER_FIRST_OCCURRENCE, isActType } from './vocabulary'
import type { RoleName } from './envelope'

/**
 * [SD §4.2] `basis ∈ REQUESTED | COMMITTED | PLANNED | ESTIMATED | ACTUAL`.
 *
 * The provenance, re-cited honestly at [SD §4.2] after `fork-time` got half of it wrong:
 * `PLANNED` / `ACTUAL` / `COMMITTED` (from `Confirmed_`) are `src:uncefact-scrdm`'s;
 * `REQUESTED` and `ESTIMATED` are `src:dcsa`'s `eventClassifierCode`; `COMMITTED`'s real support
 * "is `src:sirva-ade`, grade A, a live partner contract" — the Agreed Load / Delivery Periods,
 * kept distinct from planned and from the trip-side dates, with `IntoWillAdvise` modelling the
 * **withdrawal** of a commitment as its own transition.
 *
 * This is the one cross-cutting decision of the three documents that survives unchanged
 * ([SD §1.1]): tense lives here, on the value, and never on the envelope.
 */
export const BASES = [
  /**
   * What somebody **asked for**. `src:dcsa`'s `eventClassifierCode` `REQ` ([SD §4.2]); the
   * attribution is DCSA's and was mis-cited to `src:uncefact-scrdm` before [SD §4.2] corrected it.
   */
  'REQUESTED',
  /**
   * What was **agreed** — a promise, not a plan. `src:uncefact-scrdm`'s `Confirmed_` renamed, and
   * its real support is `src:sirva-ade`, "grade A, a live partner contract": the Agreed Load and
   * Agreed Delivery Periods, kept distinct from the planned customer dates and distinct again from
   * the trip-side driver dates. ADE even models the **withdrawal** of a commitment as its own
   * transition (`IntoWillAdvise`). [SD §4.2].
   */
  'COMMITTED',
  /** What we **intend** — `src:uncefact-scrdm`'s `Planned_` ([SD §4.2]). */
  'PLANNED',
  /**
   * What we **expect**, as of an instant — `src:dcsa`'s `EST` ([SD §4.2]). `asOf` is MANDATORY at
   * this basis ([SD §4.1]), and this is the basis that replaces Alvys's `Eta {Planned, Live,
   * Manual}`: an ETA is an `arrival` at `basis = ESTIMATED` with a `capturedBy` ([SD §4.5]).
   */
  'ESTIMATED',
  /**
   * What **happened** — `src:uncefact-scrdm`'s `Actual_` ([SD §4.2]). It is where the capture rules
   * bite: an act's `(outcome, reasons[])` exists here and nowhere else ([SD §2.3] invariant 1), M1
   * forbids `ASSUMED_FROM_PLAN` here, and M2/M3/M5 are all written at this basis ([SD §5.2]).
   */
  'ACTUAL',
] as const

export type Basis = (typeof BASES)[number]

/** Every basis that is a plan rather than an observation. */
export type PlanBasis = Exclude<Basis, 'ACTUAL'>

/**
 * [SD §4.1] `evidence[]` — "refs to documents / other assertions".
 *
 * It is also where the link goes when "one record's relevance to another is evidentiary rather
 * than structural (the notification that carries an ETA; the weight ticket behind a weighing)" —
 * [SD §1.1], which is half the reason the generic `correlation` bag could be deleted.
 *
 * TODO([SD §4.6.2]): E-CANON-RESOLVE puts "the inbound message" in `evidence[]`. An inbound
 * message is not obviously a `document` aggregate, and no document says which it is. Left as the
 * two sourced members rather than widened on inference.
 */
export type EvidenceRef =
  | { readonly kind: 'document'; readonly ref: SubjectRef<'document'> }
  | { readonly kind: 'assertion'; readonly ref: EventId }

/**
 * [SD §4.3] `rule { ruleId, ruleVersion }` — mandatory on every resolution.
 *
 * "**[ORIGINAL]:** making the resolution append-only, requiring the rule id **and version**, and
 * generalising from times to any fact class." The version is what keeps an authored
 * generalisation like `R-WEIGHT-LOWER` honest: "the rule is named, scoped and versioned, so the
 * scope of the authored step is on the record rather than in a reader's head" ([SD §4.4]).
 *
 * Same shape for the subject-resolution rule of E-CANON-RESOLVE ([SD §4.6.2]).
 */
export interface RuleRef {
  readonly ruleId: Brand<string, 'ruleId'>
  readonly ruleVersion: Brand<string, 'ruleVersion'>
}

export function ruleRef(ruleId: string, ruleVersion: string): RuleRef {
  if (ruleId.length === 0 || ruleVersion.length === 0) {
    throw new RangeError('a rule reference needs both an id and a version [SD §4.3]')
  }
  return {
    ruleId: ruleId as RuleRef['ruleId'],
    ruleVersion: ruleVersion as RuleRef['ruleVersion'],
  }
}

/** A time fact's value. [SD §4.1]'s time family: arrival, departure, actual delivery date. */
export interface TimeValue {
  readonly at: Instant
}

/**
 * A measure. **Partly owed:** [SD §4.1] quotes `src:x12-212-trailer-manifest` element 187 — "a
 * weight is always typed — `G` gross, `N` actual net, `T` tare… A `Weight` value object is
 * `(kind, unit, value, source)`, never a number." Three of those four are already in the model
 * and are not repeated here: the **kind** is the `type` (`weight.net` / `.gross` / `.tare`), and
 * the **source** is `capturedBy` + `evidence[]` ([SD §4.4]). The unit vocabulary is fixed nowhere.
 */
export interface MeasureValue {
  readonly amount: number
  readonly unit: OwedCode<'unitOfMeasure'>
}

/** A count. The unitized/non-unitized split rides the `qualifier` ([SD §4.7.2a]), not the value. */
export interface CountValue {
  readonly count: number
}

/**
 * [SD §5.3] the SIT entry date — "a **date**: when storage starts counting", mandatorily
 * `DERIVED_BY_RULE` from the TSP's first available delivery date (M4), asserted by the platform.
 *
 * `derivedBy` and `inputs` are M4's own requirement: `DERIVED_BY_RULE` is permitted "**only** where
 * the catalog publishes the derivation as a named rule and the record carries
 * `{ruleId, ruleVersion}` **and the `eventId`s of its inputs**" ([SD §5.2] M4).
 */
export interface SitEntryDateValue {
  readonly date: CalendarDate
  readonly derivedBy: RuleRef
  readonly inputs: NonEmptyArray<EventId>
}

/**
 * [SD §4.7.3], [A8 §3(b)], [A8-HISTORY]: "who the origin agent is" is a dated, versioned
 * assertion, not a static field. Carries the effective interval of [SD §7.1] and is never
 * overwritten — "you cannot ask 'who was authoritative on 3 March' of a roster that has since
 * been rewritten" ([A8 §3(c)]).
 */
export interface PartyRoleValue {
  readonly party: PartyId
  readonly role: RoleName
  readonly effectiveFrom: Instant
  readonly effectiveTo?: Instant
}

/**
 * The `value` shape of every non-act fact class.
 *
 * Four are represented as **owed**. That is the disclosure rule applied to a value shape: the
 * documents fix the fact class, its subject and its qualifier, and fix nothing about what the
 * value looks like.
 */
export interface ValueByType {
  arrival: TimeValue
  departure: TimeValue
  'weight.net': MeasureValue
  'weight.gross': MeasureValue
  'weight.tare': MeasureValue
  pieceCount: CountValue
  sitEntryDate: SitEntryDateValue
  identity: IdentityValue
  partyRole: PartyRoleValue
  /** Owed: per-article condition at receipt and at forwarding (`src:dp3-400ng` Item 17.12.c,
   * `src:cfr-49-375` §375.503's itemized inventory) — the condition vocabulary is nobody's yet. */
  condition: Owed<'conditionValue', 'A4 / A10 — no document fixes the condition vocabulary'>
  /** Owed: [SD §4.7.2b] splits the fact into three aspects (propose / decide / rate) whose values
   * are an amount, an approval and a price. No document gives any of the three a shape. */
  charge: Owed<'chargeValue', 'A11 — charge facts [SD §4.7.3]'>
  /** Owed, and known to be incomplete: "**The recipient has no field.** [A8 §9 item 6] owes 'the
   * party as a notification target', and [SD §6.5]'s obligations cannot name a contactable party
   * until it lands." ([SD §4.7.3]) */
  notification: Owed<'notificationValue', 'A8 §9 item 6 — the party as a notification target'>
}

type ValueTableIsComplete = Exact<keyof ValueByType, NonActType>
const _valueTableIsComplete: ValueTableIsComplete = true
void _valueTableIsComplete

/**
 * The three `value` fields that ride on the **`handover` act** and on no other.
 *
 * **`custodyBasis`** — [A8 §7.1]: "Both codes already ride on records the envelope publishes:
 * `custodyBasis` on the **`handover`** assertion ([SD §4.7]'s `handover` row) and on
 * `ExternallyPerformedLeg.custodyBasis` ([SD §8.2])"; and [SD §4.7.1]'s handover row:
 * "`custodyBasis` 41 vs 349 decides whether authority moves at all."
 *
 * **`releasingParty` / `receivingParty`** — [SD §4.7.2f] §0(4), and they are the **second defect
 * F1's fix closes** (recorded as F2 in `findings-from-alloy.md`). They used to live in `context[]`,
 * where [SD §1.4] rules 2 and 3 make every entry valueless, non-authoritative and **unlabelled** —
 * so nothing could say *which* of two refs was the receiver, while [SD §4.8.3] read `holder` off
 * "the selected handover's receiving side". The fold was reading an authoritative output off a
 * non-authoritative field. In `value` they are asserted, attributed, contestable and labelled,
 * which is exactly what they must be, because the two sides can disagree about who took the goods —
 * and disagreeing about it is a contest on one key, not two keys (Q-KEY(iii), which is why the
 * *parties* are here and only the *roles* are in the qualifier).
 *
 * The precedent for a party ref in a `value` is settled text: `identity`'s `value` carries
 * `issuer`, "the PARTY that assigned this id under that scheme" ([SD §7.1]). It is not a second
 * subject; it is an asserted fact about the transfer.
 *
 * Both parties ride **both** records, which preserves `src:open-trip-model`'s `HandOver`
 * field-for-field (it "indicates transferring a consignment from one Actor to another" and carries
 * `from`/`to` actor refs). What is not preserved is the claim that one publisher's record settles
 * both sides.
 *
 * Grain is **owed** and is carried as the union rather than invented: [SD §4.8.3] returns `holder`
 * as a `partyRole` while [SD §8.2]'s `performedBy` is a party, and [A8 §9 items 1-3] owe the party
 * entity and the person-vs-organisation grain ({@link CustodyHolder}).
 *
 * All three are optional-`never` on every other act, so they cannot drift onto `loading` or
 * `delivery` — which matters because **A8-MOVE** is defined on `custodyBasis`, and a second place
 * to write it would be a second place for authority to move from.
 */
export type HandoverValuePart<T extends ActType> = T extends 'handover'
  ? {
      readonly custodyBasis: CustodyBasis
      readonly releasingParty: CustodyHolder
      readonly receivingParty: CustodyHolder
    }
  : {
      readonly custodyBasis?: never
      readonly releasingParty?: never
      readonly receivingParty?: never
    }

/**
 * [SD §4.1] "An **act record** is an Assertion whose `type` is the act and whose `value` is
 * `{occurredAt, outcome, reasons[]}` ([SD §2])."
 *
 * The outcome is present at `basis = ACTUAL` and impossible anywhere else — [SD §2.3] invariant 1,
 * "OTM's rule adopted verbatim (`result` only on `actual`/`realized`)". A plan cannot carry an
 * outcome, so a planned act must not even be able to spell one.
 */
export type ActValue<T extends ActType, B extends Basis> = HandoverValuePart<T> &
  (B extends 'ACTUAL'
    ? { readonly occurredAt: Instant; readonly quantity?: never } & ActOutcome
    : {
        readonly occurredAt: Instant
        readonly quantity?: never
        readonly outcome?: never
        readonly reasons?: never
      })

/**
 * `quantity` above is forbidden, permanently, at every basis — [SD §3.3]:
 *
 * > "**The `quantity` field is deleted.** A quantity floating on an act is a measure with no
 * > identity, so a second act cannot say 'the same part'."
 *
 * What it was expressing is a `Portion` ([SD §3]), named in `reasons[].appliesTo`.
 */
export type ValueOf<T extends AssertionType, B extends Basis> = T extends ActType
  ? ActValue<Extract<T, ActType>, B>
  : T extends NonActType
    ? ValueByType[T]
    : never

type QualifierPart<T extends AssertionType> = T extends keyof QualifierByType
  ? { readonly qualifier: QualifierOf<T> }
  : { readonly qualifier?: never }

/**
 * [SD §4.1] "`asOf` — instant — MANDATORY when basis = ESTIMATED".
 *
 * Two shapes rather than one optional field: an estimate that does not say what it was an
 * estimate *as of* is not answerable, and [SD §4.5] leans on this to replace Alvys's
 * `Eta {Planned, Live, Manual}` with `basis` + `capturedBy` and "no named fields are needed".
 */
type BasisPart<B extends Basis> = B extends 'ESTIMATED'
  ? { readonly basis: 'ESTIMATED'; readonly asOf: Instant }
  : { readonly basis: B; readonly asOf?: never }

/** The payload half of an Assertion — [SD §4.1], "(envelope §1.1, plus)". */
export type AssertionFields<T extends AssertionType, B extends Basis> = QualifierPart<T> &
  BasisPart<B> & {
    readonly value: ValueOf<T, B>
    readonly evidence?: ReadonlyArray<EvidenceRef>
    /**
     * [SD §4.1] "eventId of an earlier assertion **by the SAME party** with the **SAME fact key**".
     *
     * One of the four typed per-class links that replaced the generic `correlation` bag
     * ([SD §1.1] defect C): "each carries a per-class obligation a generic bag cannot state".
     * The two constraints are values, not types — {@link supersedesIsWellFormed} checks them.
     *
     * It is also how successive changes ride: [SD §4.7.2d] item 3, "a trip delayed twice, or a
     * membership re-offered after a break, is not two contested facts about one subject: it is one
     * party revising its own assertion" — which is why those types declare no `qualifier`.
     */
    readonly supersedes?: EventId
  }

/**
 * An Assertion on the capture interface — no `recordedAt` ([SD §1.1], [SD §4.2]).
 *
 * The subject kind is bound to the type's declared canonical subject family, so **E-CANON**
 * ([SD §4.3]) holds at compile time for any statically-known type: `Assertion<'arrival'>` cannot
 * be about a shipment, which is [SD §4.6.3]'s worked rejection, refused a step earlier.
 */
export type CapturedAssertion<T extends AssertionType = AssertionType> = T extends AssertionType
  ? {
      [B in Basis]: CapturedEnvelope<T, CanonicalSubjectKind<T>> & AssertionFields<T, B>
    }[Basis]
  : never

/** The same record as served by the query interface — `recordedAt` mandatory ([SD §1.1]). */
export type QueriedAssertion<T extends AssertionType = AssertionType> = T extends AssertionType
  ? {
      [B in Basis]: QueriedEnvelope<T, CanonicalSubjectKind<T>> & AssertionFields<T, B>
    }[Basis]
  : never

export type Assertion<T extends AssertionType = AssertionType> =
  CapturedAssertion<T> | QueriedAssertion<T>

/**
 * [SD §1.3] item 3: the fact key is **derived**, from fields the record already carries.
 *
 * "This is what resolves the second defect as well: the envelope `subject` and the old
 * `factRef.subject` were **always the same value**, so one of them is deleted, and it is the
 * nested one. Competing assertions pair on this key."
 *
 * Note what it does not read: `context[]` ([SD §1.4] rule 3), `assertedBy`, `basis`. Two parties
 * at two bases asserting the same fact key are in one contest, which is the point.
 */
export function factRefOf<T extends AssertionType>(assertion: Assertion<T>): FactRef<T> {
  const { subject, type, qualifier } = assertion as unknown as {
    subject: SubjectRef
    type: T
    qualifier?: unknown
  }
  return (qualifier === undefined ? { subject, type } : { subject, type, qualifier }) as FactRef<T>
}

/**
 * The qualifier **as the key sees it** — the one place a declared qualifier is normalised before
 * two records are compared.
 *
 * One type needs it. [SD §4.7.2f]'s **H-OCCUR** makes `handover`'s `occurrence` optional and says
 * "absent — meaning 1". Two spellings of one ordinal would otherwise be two keys: the driver
 * omitting `occurrence` and its own office writing `occurrence: 1` would never pair, which is
 * precisely the contest the fact key exists to hold ([SD §1.3] item 3). Normalising here rather
 * than at capture keeps the record as the party wrote it — [SD §1.1]'s discipline — while the
 * *key* is derived, which is what [SD §1.3] already says it is.
 *
 * Nothing else is normalised, and nothing may be: a qualifier component that needed coercion to
 * pair would be one the asserting parties cannot compute alike, which is Q-KEY(ii) failing.
 */
function keyQualifier(type: AssertionType, qualifier: unknown): unknown {
  if (type !== 'handover' || qualifier === undefined || qualifier === null) return qualifier
  const declared = qualifier as HandoverQualifier
  return { ...declared, occurrence: declared.occurrence ?? HANDOVER_FIRST_OCCURRENCE }
}

/** Fact-key equality, up to the qualifier each type declares ([SD §1.3] item 3). */
export function sameFactKey(left: FactRef, right: FactRef): boolean {
  if (left.type !== right.type) return false
  if (left.subject.aggregate !== right.subject.aggregate) return false
  if (left.subject.id !== right.subject.id) return false
  return (
    stableStringify(keyQualifier(left.type, left.qualifier) ?? null) ===
    stableStringify(keyQualifier(right.type, right.qualifier) ?? null)
  )
}

/**
 * [SD §4.1]'s two constraints on `supersedes`, which no generic link bag could have stated.
 *
 * A record that fails this is not a supersession; where the two assertions are by different
 * parties it is a **contest**, resolved by `FactResolved` ([SD §4.3]) — and where it is a claim
 * that an earlier record was wrong, it is a `Correction` ([SD §6]).
 */
export function supersedesIsWellFormed<T extends AssertionType>(
  earlier: Assertion<T>,
  later: Assertion<T>,
): boolean {
  const earlierEnvelope = earlier as unknown as { eventId: EventId; assertedBy: { party: PartyId } }
  const laterEnvelope = later as unknown as {
    supersedes?: EventId
    assertedBy: { party: PartyId }
  }
  if (laterEnvelope.supersedes !== earlierEnvelope.eventId) return false
  if (laterEnvelope.assertedBy.party !== earlierEnvelope.assertedBy.party) return false
  return sameFactKey(factRefOf(earlier), factRefOf(later))
}

/**
 * Resolution — [SD §4.3].
 *
 * ```
 * FactResolved (envelope, type = FactResolved; assertedBy = the platform,
 *               capturedBy = DERIVED_BY_RULE)
 * ```
 *
 * Append-only: "the history of _which answer we were giving when_ survives." Last-writer-wins is
 * rejected outright — `src:gtfs`'s `FULL_DATASET` "will overwrite all preceding realtime
 * information… defensible there only because GTFS has one publisher by construction" — and
 * [A8 §4.4] A8-NAMED closes the back door: "a resolution may never fall back to 'latest wins'
 * implicitly."
 *
 * The asserter and capture method are narrowed in the type rather than described, because
 * [SD §4.3] states them as part of the record class.
 */
export type FactResolved<T extends AssertionType = AssertionType> = T extends AssertionType
  ? (
      | CapturedEnvelope<'FactResolved', CanonicalSubjectKind<T>>
      | QueriedEnvelope<'FactResolved', CanonicalSubjectKind<T>>
    ) & {
      readonly assertedBy: { readonly party: PartyId; readonly role: 'platform' }
      readonly capturedBy: 'DERIVED_BY_RULE'
      /** "the contested fact key, whose subject MUST equal the envelope subject" — the equality
       * is a value check, {@link factResolvedSubjectMatches}. */
      readonly factRef: FactRef<T>
      /**
       * "eventId of the winning assertion — MANDATORY".
       *
       * `null` is the deliberate non-selection [A8 §7.3] **A8-JOINT** requires: for `condition`
       * (and the counts asserted with it) at a custody boundary, "on disagreement `FactResolved`
       * **MUST** publish both and **MUST NOT** select". A8-NAMED still requires a named rule, so
       * a null selection is never a silence.
       *
       * DECISION: the documents state `selected` as mandatory in one place and require it to be
       * empty in another. Explicit `null` is chosen over an absent field so that "we declined to
       * select" cannot be confused with "this resolution forgot to say".
       */
      readonly selected: EventId | null
      /** "eventId of every assertion **in the contest**" — and only those. [SD §4.6.3] step 4
       * turns on the difference: a claim rejected at the boundary "is **not** in `considered[]`,
       * because `considered[]` names every assertion in the contest and this one never entered
       * it. That absence is honest and is itself queryable via the obligation." */
      readonly considered: NonEmptyArray<EventId>
      readonly rule: RuleRef
    }
  : never

/** [SD §4.3] / [SD §1.3] item 4: the envelope subject MUST equal the fact key's subject. */
export function factResolvedSubjectMatches(resolved: FactResolved): boolean {
  return (
    resolved.subject.aggregate === resolved.factRef.subject.aggregate &&
    resolved.subject.id === resolved.factRef.subject.id
  )
}

/** [SD §4.3]: a selection that is not among the assertions considered is not a resolution. */
export function selectionIsAmongConsidered(resolved: FactResolved): boolean {
  return resolved.selected === null || resolved.considered.includes(resolved.selected)
}

/**
 * [SD §6.4] "a `DID_NOT_OCCUR` retraction names no replacement".
 *
 * EPCIS's rule is kept; `src:x12-858-implementation-guide`'s restore-to-previous "is kept as an
 * _intent_ and dropped as a _mechanism_", because applied across parties it "silently promotes
 * some other company's assertion, which the retracting party may have no authority to affirm".
 * A retraction removes the retracted assertion from the contest and `FactResolved` is
 * republished over what remains.
 */
export type CorrectionReason =
  | { readonly errorReason: 'DID_NOT_OCCUR'; readonly replacement?: never }
  | { readonly errorReason: 'INCORRECT_DATA'; readonly replacement?: EventId }

/**
 * [SD §6.1] three outcomes, all recorded. "There is no refusal path."
 *
 * `INEFFECTIVE` is the one that had to be decided: a correction outside its amendment window is
 * "**Recorded. Flagged legally ineffective. Never applied to the priced record.** Emits the
 * obligation. Queryable as a class." `src:cfr-49-375` §375.401(i) binds "the parties and the
 * price"; **[ORIGINAL]:** "that a records system may nonetheless _record_ the attempt and mark it
 * ineffective."
 */
export const CORRECTION_EFFECTS = ['APPLIED', 'INEFFECTIVE', 'UNAUTHORISED'] as const

export type CorrectionEffect = (typeof CORRECTION_EFFECTS)[number]

/**
 * The meta-record of [SD §6], in structure only.
 *
 * TODO(corrections area): [SD §6]'s semantics — the amendment window, `Correction.authority`
 * naming an **instrument** rather than a party ([SD §6.2], 400NG's SF1200), the priced-record
 * rule that financial facts are corrected only by an offsetting record ([SD §6.3]), and the
 * obligations a correction emits ([SD §6.5]) — belong to a corrections module. What is here is
 * what the envelope and the vocabulary need in order to be coherent: the record class exists, it
 * carries a typed `corrects` link, and its subject is the corrected fact's subject.
 */
export type Correction<T extends AssertionType = AssertionType> = T extends AssertionType
  ? (
      | CapturedEnvelope<'Correction', CanonicalSubjectKind<T>>
      | QueriedEnvelope<'Correction', CanonicalSubjectKind<T>>
    ) &
      CorrectionReason & {
        /** MANDATORY — [SD §1.1]: the obligation a generic link bag could not state. */
        readonly corrects: EventId
        readonly effect: CorrectionEffect
      }
  : never

/**
 * [SD §4.1]: an act record's `value` is `{occurredAt, outcome, reasons[]}`; every other fact
 * class's value is the fact. The act/non-act cut is the vocabulary's ({@link isActType}), and it
 * is why `arrival` and `departure` — time facts about a visit, not acts ([SD §4.7.1]) — carry no
 * outcome and may be asserted by a geofence under M5 while acts may not under M2/M3.
 */
export function valueIsAnActPerformance(type: AssertionType): boolean {
  return isActType(type)
}
