/**
 * `custodyAt(goods, instant)` — the fold — [SD §4.8].
 *
 * > "**`Custody` is neither an aggregate kind nor a fact class. It is a projection — a named,
 * > versioned fold over the `handover` assertions selected by `FactResolved` ([SD §4.7]'s
 * > `handover` row) and over `ExternallyPerformedLeg.custodyBasis` ([SD §8.2]). It is never stored,
 * > never asserted and never corrected. `boundBy = CUSTODY` names **that fold**, and every input
 * > the fold reads is a published record in the envelope.**" — [SD §4.8]
 *
 * The decision is load-bearing twice over. It is what breaks the circularity [SD §4.8.2] names — "a
 * `custody` fact class would need an authority row, and that row's binding would be `CUSTODY`, so
 * **A8-MOVE would be defined in terms of the thing it defines**" — and it is what lets
 * [A8 §7.4(c)] answer "what happens to the previous holder's assertions" with *nothing is
 * rewritten*: re-resolve a `handover` contest and the fold returns a different answer over records
 * that did not change.
 *
 * **[ORIGINAL]** ([SD §4.8.2]): the fold, its `UNKNOWN` outcome, and the rule that it is never
 * stored. **Sourced:** the acts, the two bases, and the two-asserter shape of a handover.
 *
 * **Amended by the F1 decision** ([SD §4.7.2f], `docs/domain-reference/analysis/F1-handover-qualifier-decision.md`).
 * `handover` now declares the qualifier `{releasing, receiving, side, occurrence?}`, the two sides
 * of a transfer are **two facts**, the releasing and receiving parties ride on `value`, and the
 * fold gains rules **C5** (the timeline: a `RECEIPT` opens a span, the next `RELEASE` by that
 * holder closes it, the gap between is `UNKNOWN`) and **C6** (the tie: two selected facts at one
 * `occurredAt` that would open and close differently yield `UNKNOWN`, never an ordering the
 * documents do not publish). Two defects close with it — F1, which made `until` unreachable and a
 * normal van-line move unrepresentable, and F2, the receiving side the fold read off a
 * non-authoritative `context[]`. The structural checks are `alloy/custody.als`.
 */

import type { Assertion, FactResolved } from './assertions'
import { ruleRef, type RuleRef } from './assertions'
import type { EventId, SubjectRef } from './envelope'
import type { ExternallyPerformedLegId, PartyId } from './ids'
import type { Instant, NonEmptyArray, Owed } from './primitives'
import { assertNever } from './primitives'
import type { HandoverQualifier, HandoverSide } from './vocabulary'

/**
 * Rec 24 **41** `Handed_over_under_continued_responsibility` — "handed over **under responsibility
 * of the same transport operator**" (rev3 p.4).
 *
 * Custody moves and **authority does not** (**A8-MOVE**, [A8 §7.1]). The worked case is
 * `src:dp3-400ng` Item 125 **Shuttle Service**, a truck-to-truck transfer to the same agent's own
 * linehaul van — which is what makes A8-MOVE a distinction rather than a synonym for the fold.
 */
export const HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY = 41

/**
 * Rec 24 **349** `Handed_over` — "handed over **to another party**" (rev3 p.15).
 *
 * This is the boundary **A8-MOVE** moves authority at ([A8 §7.1]); the worked case is the interline
 * pair `J1` Delivered to Connecting Line / `R1` Received from Prior Carrier, which
 * `src:stedi-x12-reference` element 1650 publishes as **two codes asserted by two different
 * parties** — the observation [SD §4.7.2f] turns into `handover`'s `side` qualifier.
 */
export const HANDED_OVER = 349

/**
 * `src:uncefact-rec24`'s two codes — the one real distinction the source draws, and the hinge
 * [A8 §7.1] hangs **A8-MOVE** on:
 *
 * - **41** `Handed_over_under_continued_responsibility` — "handed over **under responsibility of
 *   the same transport operator**" (rev3 p.4);
 * - **349** `Handed_over` — "handed over **to another party**" (rev3 p.15).
 *
 * They ride on records the envelope already publishes — on the **`handover` act** ([A8 §7.1]:
 * "`custodyBasis` on the `handover` assertion"; [SD §4.7.1]'s handover row: "`custodyBasis` 41 vs
 * 349 decides whether authority moves at all") and on {@link ExternallyPerformedLeg.custodyBasis}
 * ([SD §8.2]). So the hinge needs no new field and no stored interval.
 *
 * Kept as the numeric code, not renamed: `A3` §5.2 records that Rec 24 "supplies it as two status
 * codes, **not as an entity**", and the code is the part that is sourced.
 *
 * The members are the two named constants above rather than bare literals written inside the array,
 * and that is not a style choice: prettier prints an array of numbers in **fill** mode, packing the
 * elements onto one line and carrying each member's own JSDoc along with them — so a per-member
 * definition written inside the array cannot survive a commit. Naming the members keeps each
 * definition attached to a declaration, which is where `tools/generate-glossary.ts` reads it from.
 */
export const CUSTODY_BASES = [HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY, HANDED_OVER] as const

export type CustodyBasis = (typeof CUSTODY_BASES)[number]

/**
 * [SD §8.2] `ExternallyPerformedLeg` — "an aggregate; a legal `subject`; canonical-subject family:
 * `stop`". Not a phantom trip: "we are not modelling a journey we cannot see. We are modelling **a
 * named party's undertaking to move goods between two places**."
 *
 * It is here rather than in a module of its own because the only thing this package does with a
 * leg is read the two fields the fold reads ([SD §4.8.3] rule 1: "that leg's declared
 * `custodyBasis` and `performedBy`") and the one [A8 §5] rows 1, 2 and 5 read
 * (`authoritativeAsserter`).
 */
export interface ExternallyPerformedLeg {
  readonly legId: ExternallyPerformedLegId
  /** [SD §8.2] "what moved" — MANDATORY. Family `goods`, as every goods-side row. */
  readonly moved: SubjectRef<'shipment' | 'portion'>
  /**
   * [SD §8.2] "the party, with an identifier ([SD §7])" — MANDATORY.
   *
   * Sourced hard: `src:dp3-tender-of-service` §B.3.f requires the legal name and US DOT number of
   * the provider **actually hauling**, and its analysis calls this "the only place in the corpus
   * where _the party actually performing_ must be named".
   */
  readonly performedBy: PartyId
  /** [SD §8.2] MANDATORY: 41 continued-responsibility | 349 handed-over. */
  readonly custodyBasis: CustodyBasis
  /** [SD §8.2] "the party whose assertions govern this leg" — MANDATORY. Read by [A8 §5] rows 1,
   * 2 and 5, where it stands in for the custody-holding role on a leg we do not drive. */
  readonly authoritativeAsserter: PartyId
  readonly from?: LegEndpoint
  readonly to?: LegEndpoint
}

/**
 * [SD §8.2] "`from` / `to` — place refs; **either MAY be a Stop of one of our trips**".
 *
 * The non-Stop half is **owed**: [SD §1.2]'s aggregate enum has no `place` kind, so a place ref has
 * no target schema. Represented as owed rather than typed as a string, because a bare string here
 * would read as a settled shape.
 *
 * TODO([SD §1.2] / A3): a place is either a fifteenth aggregate kind or an attribute of a Stop.
 * No document in the binding layer decides which.
 */
export type LegEndpoint =
  | { readonly kind: 'stop'; readonly stop: SubjectRef<'stop'> }
  | { readonly kind: 'place'; readonly place: Owed<'placeRef', '[SD §1.2] — no `place` aggregate'> }

/**
 * Who holds the goods.
 *
 * Two members because the two published inputs disagree about grain, and the disagreement is a
 * finding rather than something to smooth over: [SD §4.8.3] returns `holder` as a **`partyRole`**,
 * while [SD §8.2]'s `performedBy` — the fold's other input — is a **party**. [A8 §9 items 1 and 3]
 * owe the party entity and the person-vs-organisation grain, so nothing in the binding layer
 * reconciles them.
 *
 * TODO([A8 §9 items 1-3]): when the party model lands, decide whether a leg's `performedBy` is
 * resolvable to a `partyRole` on the leg, and collapse this union if it is.
 */
export type CustodyHolder =
  | { readonly kind: 'partyRole'; readonly partyRole: SubjectRef<'partyRole'> }
  | { readonly kind: 'party'; readonly party: PartyId }

/**
 * **Closed at [SD §4.7.2f] §0(4) — recorded as F2 in `findings-from-alloy.md`.**
 *
 * This module used to carry an owed `HANDOVER_RECEIVING_SIDE`, and the fold used to take the
 * receiving side as a named input (`CustodyEvidence.receivingSides`) with a
 * `RECEIVING_SIDE_NOT_PUBLISHED` reason when a caller could not supply it. The defect it named was
 * real: [SD §4.8.3] returned `holder` "from the selected handover's **receiving side**" while
 * [SD §4.7.1]'s handover row put "the releasing and receiving `partyRole`s" in **`context[]`**,
 * which [SD §1.4] rules 2 and 3 make valueless, non-authoritative and unlabelled — so nothing could
 * say *which* of two refs was the receiver, and the fold was reading an authoritative output off a
 * non-authoritative field.
 *
 * It is closed by moving both parties into `value` ({@link HandoverValuePart}), where they are
 * asserted, attributed, contestable and labelled, and by deleting `partyRole` from the row's
 * `context[]` column — two homes for one link being revision 3's defect **C** ([SD §1.1]). The fold
 * below therefore reads `value.receivingParty` of the selected **RECEIPT**, and the owed marker,
 * the named input and the reason are all **retired** rather than left as dead surface.
 */

/** A `handover` act, at whatever basis it was asserted. */
export type HandoverAssertion = Assertion<'handover'>

/** One `FactResolved`-selected handover, with the resolution that selected it. */
export interface SelectedHandover {
  readonly handover: HandoverAssertion
  /** The `FactResolved` — [SD §4.8.3]'s `evidencedBy` is "every handover assertion **and
   * FactResolved** the fold read". */
  readonly selectedBy: EventId
}

/**
 * Everything the fold is allowed to read — [SD §4.8.3] rule 1: "Its inputs are
 * `FactResolved`-selected `handover` assertions and nothing else — plus, where the movement is an
 * `ExternallyPerformedLeg`, that leg's declared `custodyBasis` and `performedBy`. Both are
 * published records. **The fold reads no field that is not one.**"
 *
 * Every member is now a published record: the named `receivingSides` input is gone, because
 * [SD §4.7.2f] §0(4) put the receiving party on the receipt's own `value`. So rule 1's "**The fold
 * reads no field that is not [a published record]**" holds without an exception for the first time.
 */
export interface CustodyEvidence {
  readonly handovers: readonly HandoverAssertion[]
  readonly resolutions: readonly FactResolved<'handover'>[]
  readonly legs: readonly ExternallyPerformedLeg[]
}

/**
 * Why the fold returned `UNKNOWN`.
 *
 * DECISION: diagnostic only. [SD §4.8.3] rule 3 makes `UNKNOWN` "a real outcome and **never filled
 * in**"; a reason explains the silence without breaking it, and naming the cases keeps the
 * difference between "nothing has been published yet" and "half a cross-dock has been published"
 * visible to a consumer. It is not a fall-through and carries no candidate holder.
 *
 * Three reasons, and the second and third are [SD §4.7.2f] §7.1's rules **C5** and **C6**. The
 * fourth, `RECEIVING_SIDE_NOT_PUBLISHED`, is **retired** with the receiving side's move into
 * `value` — see the note above {@link HandoverAssertion}.
 */
export const CUSTODY_UNKNOWN_REASONS = [
  /** "Before the first handover" — [SD §4.8.3] rule 3. */
  'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
  /**
   * **C5** — between a `RELEASE` and the next `RECEIPT`. [SD §4.8.3] rule 3's second named case,
   * "across a cross-dock dwell where only one of the two handovers has been published", and
   * [A3 §8]'s "thin part" — now **produced** by the fold rather than stipulated about it, which is
   * the strongest internal evidence for [SD §4.7.2f] §2's two-facts verdict.
   */
  'IN_TRANSFER_GAP',
  /**
   * **C6** — two selected facts at one `occurredAt` that would open and close differently. The fold
   * does not order them by key, by `assertedAt`, by `recordedAt` or by `occurrence`: this is
   * **A8-NAMED** ([A8 §4.4]) in its custody-side form and [SD §4.6.3] step 2's refusal to fall
   * through, applied to **ordering** instead of to selection.
   */
  'AMBIGUOUS_ORDER_AT_INSTANT',
] as const

export type CustodyUnknownReason = (typeof CUSTODY_UNKNOWN_REASONS)[number]

/**
 * [SD §4.8.3]'s five fields — "A3's five fields — party, from, until, basis, evidencing act — are
 * the five the fold returns. What changes is that they are **computed rather than written**, so
 * they cannot drift from the acts that produced them."
 */
export interface CustodyInterval {
  readonly custody: 'KNOWN'
  readonly holder: CustodyHolder
  readonly basis: CustodyBasis
  /** "that **receipt's** `occurredAt`" — [SD §4.8.3] as amended at [SD §4.7.2f] §7.1. */
  readonly since: Instant
  /**
   * "the `occurredAt` of the **next selected `RELEASE` by that holder**, where one exists" —
   * absent while none does.
   *
   * This field is one of F1's three failing predicates. Under the un-qualified handover row it was
   * **unreachable**: it read "the next selected handover's `occurredAt`", and a second selected
   * handover about one goods could not exist, because every handover keyed to `(shipment, handover)`
   * and [SD §4.3] selects one winner per key. The qualifier is what makes a second key — and
   * therefore a second span, and therefore an end to the first one.
   *
   * It names a **`RELEASE` by the holder** rather than "the next handover" because C5 is what
   * closes a span: a release by anyone else does not close this holder's custody, and the fold
   * never reconciles an inconsistent sequence.
   */
  readonly until?: Instant
  readonly evidencedBy: NonEmptyArray<EventId>
  /** [SD §4.8.3] rule 2: the answer names the rule that produced it. */
  readonly rule: RuleRef
}

export interface CustodyUnknown {
  readonly custody: 'UNKNOWN'
  readonly why: CustodyUnknownReason
  readonly rule: RuleRef
}

export type CustodyAt = CustodyInterval | CustodyUnknown

/**
 * [SD §4.8.3] rule 2: "It is a **named, versioned rule**, `{ruleId, ruleVersion}`, the same shape
 * as `FactResolved.rule` ([SD §4.3]) and `E-CANON-RESOLVE`'s subject-resolution rule ([SD §4.6.2]).
 * A consumer that asks 'who held the goods at 14:05 on 3 March' gets an answer that names the rule
 * that produced it."
 */
export const CUSTODY_AT_RULE: RuleRef = ruleRef('CUSTODY-AT', '1')

/**
 * Instants carry offsets ([SD §4.2]'s three clocks are wire instants), so ordering them is a parse
 * and not a string compare. `2026-03-01T09:00:00Z` and `2026-03-01T04:00:00-05:00` are the same
 * instant and do not compare equal as text.
 */
function compareInstants(left: Instant, right: Instant): number {
  return Date.parse(left) - Date.parse(right)
}

function isAboutTheseGoods(
  handover: HandoverAssertion,
  goods: SubjectRef<'shipment' | 'portion'>,
): boolean {
  // [SD §1.4] rule 1: subject matching never consults `context[]`.
  // TODO([SD §3] / A5): whether a shipment-subject handover also moves custody of a Portion of that
  // shipment is not settled anywhere in the binding layer. Matched exactly rather than inferred —
  // inferring it would make the fold answer a question no document has decided.
  return handover.subject.aggregate === goods.aggregate && handover.subject.id === goods.id
}

function legNamedBy(
  handover: HandoverAssertion,
  legs: readonly ExternallyPerformedLeg[],
): ExternallyPerformedLeg | undefined {
  // [SD §4.7.1]'s handover row: `context[]` carries "both `stop`s / `trip`s, **or the
  // `externallyPerformedLeg`**". Reading the leg *reference* out of `context[]` is not reading a
  // value out of it ([SD §1.4] rule 2) — the values come off the leg, which is a published record.
  for (const ref of handover.context ?? []) {
    if (ref.aggregate !== 'externallyPerformedLeg') continue
    const leg = legs.find((candidate) => candidate.legId === ref.id)
    if (leg !== undefined) return leg
  }
  return undefined
}

/**
 * The selection half of the fold's input — [SD §4.8.3] rule 1.
 *
 * A resolution whose `selected` is `null` contributes nothing, and that is not an oversight: a null
 * selection is [A8 §7.3] **A8-JOINT** declining to pick, so the catalog has published a contest and
 * no winner. Reading a loser out of it would be exactly the silent selection A8-JOINT forbids.
 */
export function selectedHandovers(evidence: CustodyEvidence): readonly SelectedHandover[] {
  const selected: SelectedHandover[] = []
  for (const resolution of evidence.resolutions) {
    if (resolution.factRef.type !== 'handover') continue
    const winner = resolution.selected
    if (winner === null) continue
    const handover = evidence.handovers.find((candidate) => candidate.eventId === winner)
    if (handover === undefined) continue
    selected.push({ handover, selectedBy: resolution.eventId })
  }
  return selected
}

/** Which side of a transfer a selected handover asserts — the qualifier's `side` ([SD §4.7.2f]). */
function sideOf(handover: HandoverAssertion): HandoverSide {
  return (handover as { qualifier: HandoverQualifier }).qualifier.side
}

/**
 * Holder identity, by value.
 *
 * Structural rather than referential because two records published by two parties carry two
 * objects, and C5 and C6 both turn on whether they name the same holder. The union's two arms are
 * compared on their own terms; there is no cross-arm equality, and inventing one would be deciding
 * [A8 §9 items 1-3]'s owed party grain by side effect.
 */
function sameHolder(left: CustodyHolder, right: CustodyHolder): boolean {
  if (left.kind === 'partyRole' && right.kind === 'partyRole') {
    return (
      left.partyRole.aggregate === right.partyRole.aggregate &&
      left.partyRole.id === right.partyRole.id
    )
  }
  if (left.kind === 'party' && right.kind === 'party') return left.party === right.party
  return false
}

/**
 * The selected, `ACTUAL`, about-these-goods handovers, in `occurredAt` order.
 *
 * DECISION (unchanged by F1): only `basis = ACTUAL` handovers are folded. [SD §4.8.3] does not say
 * so in as many words, but rule 3 reaches for **M1**'s record-versus-fabrication argument, and a
 * PLANNED handover is an intention ([SD §4.2]): folding one would have the projection report
 * custody that nobody has asserted happened. [SD §5] M2 is the other half — a handover is
 * possession-changing, so it can never be `ASSUMED_FROM_PLAN` at all.
 */
function foldInputs(
  goods: SubjectRef<'shipment' | 'portion'>,
  evidence: CustodyEvidence,
): readonly SelectedHandover[] {
  return selectedHandovers(evidence)
    .filter(
      (candidate) =>
        isAboutTheseGoods(candidate.handover, goods) && candidate.handover.basis === 'ACTUAL',
    )
    .slice()
    .sort((left, right) =>
      compareInstants(left.handover.value.occurredAt, right.handover.value.occurredAt),
    )
}

/**
 * **The fold.** `custodyAt(goods, instant)` — [SD §4.8.3], as amended by [SD §4.7.2f] §7.1.
 *
 * ```
 * custodyAt( goods : shipment | portion , instant )  →
 *     { holder      partyRole | party   the selected RECEIPT's value.receivingParty
 *       basis       41 | 349            that receipt's custodyBasis, or the leg's
 *       since       instant             that receipt's occurredAt
 *       until       instant?            the occurredAt of the next selected RELEASE by that holder,
 *                                       where one exists
 *       evidencedBy eventId[]           every handover assertion and FactResolved the fold read }
 *   | UNKNOWN( reason )
 * ```
 *
 * Never stored, never asserted, never corrected ([SD §4.8]): it is a function of published records,
 * recomputed on every call, which is what [A8 §7.4(c)] means by "it re-derives them… the fold
 * returns a different answer **without anything being rewritten**".
 *
 * Rule 3 is the one that takes discipline to keep: "**`UNKNOWN` is a real outcome and is never
 * filled in.** … It does not fall through to the last known holder, to the trip's current assignee,
 * or to the party that spoke most recently — that would be **A8-NAMED**'s implicit
 * last-writer-wins returning through the back door." Under the amendment both of its named
 * `UNKNOWN` cases are **derived** rather than stipulated: "before the first handover" is the empty
 * governing set, and the half-published cross-dock is **C5**.
 *
 * > **C5 [ORIGINAL] — the timeline.** "A goods' custody timeline is the time-ordered sequence of its
 * > selected `RECEIPT` and `RELEASE` facts at `basis = ACTUAL`. A `RECEIPT` opens a span; the next
 * > `RELEASE` by that holder closes it; **between a `RELEASE` and the next `RECEIPT` the fold
 * > returns `UNKNOWN`**. A `RELEASE` whose holder is not the open span's holder does not close it
 * > and yields `UNKNOWN`; the fold never reconciles an inconsistent sequence."
 *
 * > **C6 [ORIGINAL] — the tie.** "Where two selected handover facts about one goods carry the
 * > **same** `occurredAt` and would open and close differently, the fold returns `UNKNOWN`."
 *
 * C5 is why custody can never move on the releasing party's word alone ([SD §4.7.2f] foreclosure 2):
 * a partner that emits only `J1`, or only `R1`, leaves a permanent `UNKNOWN` span. That is a real
 * operational cost and it is the intended one.
 */
export function custodyAt(
  goods: SubjectRef<'shipment' | 'portion'>,
  instant: Instant,
  evidence: CustodyEvidence,
): CustodyAt {
  const ordered = foldInputs(goods, evidence)
  const atOrBefore = ordered.filter(
    (candidate) => compareInstants(candidate.handover.value.occurredAt, instant) <= 0,
  )
  const latest = atOrBefore[atOrBefore.length - 1]

  if (latest === undefined) {
    return {
      custody: 'UNKNOWN',
      why: 'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
      rule: CUSTODY_AT_RULE,
    }
  }

  // The governing facts are ALL of the latest ones, not the last one the sort happened to put
  // there. [SD §4.8.3] writes "the selected handover" in the singular and publishes no tie-break,
  // and C6 is the rule that says what happens instead of one — so a tie must stay visible here
  // rather than being silently broken by the sort's stability.
  const governingAt = latest.handover.value.occurredAt
  const governing = atOrBefore.filter(
    (candidate) => compareInstants(candidate.handover.value.occurredAt, governingAt) === 0,
  )

  // What each governing fact yields: a RECEIPT opens a span and yields its `value.receivingParty`;
  // a RELEASE yields nothing, because it closes one.
  const yields = governing.map((candidate) =>
    sideOf(candidate.handover) === 'RECEIPT' ? candidate.handover.value.receivingParty : undefined,
  )

  // **C6.** Two governing facts that would open and close differently — two different receivers, or
  // a receipt against a release — and the fold declines. It does NOT order them.
  const differs = yields.some((candidate, index) =>
    yields.some((other, otherIndex) => {
      if (index === otherIndex) return false
      if (candidate === undefined || other === undefined) return candidate !== other
      return !sameHolder(candidate, other)
    }),
  )
  if (differs) {
    return { custody: 'UNKNOWN', why: 'AMBIGUOUS_ORDER_AT_INSTANT', rule: CUSTODY_AT_RULE }
  }

  // **C5.** A RELEASE governs: the goods are between a release and the next receipt.
  const receipt = governing.find((candidate) => sideOf(candidate.handover) === 'RECEIPT')
  if (receipt === undefined) {
    return { custody: 'UNKNOWN', why: 'IN_TRANSFER_GAP', rule: CUSTODY_AT_RULE }
  }

  const holder = receipt.handover.value.receivingParty
  // [SD §4.8.3] rule 1: where the movement is a leg, the leg's **declared** basis is the input.
  // Note what is no longer read: the leg's `performedBy`. [SD §4.7.2f] §7.1 sources `holder` from
  // the receipt's `value.receivingParty`, full stop — so `performedBy` has no consumer here and
  // nothing published says the two must agree. Recorded as an open edge at that decision's §7.5
  // and as command C8 in `alloy/custody.als`; whether it becomes a cross-check, a fallback, or is
  // struck from rule 1 is [SD §4.8.3]'s to decide, and is not decided here.
  const leg = legNamedBy(receipt.handover, evidence.legs)
  const basis = leg !== undefined ? leg.custodyBasis : receipt.handover.value.custodyBasis

  // **C5's closing half.** The span ends at the next selected RELEASE *by this holder*; a release
  // by anyone else does not close it.
  const closing = ordered.find(
    (candidate) =>
      compareInstants(candidate.handover.value.occurredAt, governingAt) > 0 &&
      sideOf(candidate.handover) === 'RELEASE' &&
      sameHolder(candidate.handover.value.releasingParty, holder),
  )

  const evidencedBy: NonEmptyArray<EventId> = [
    receipt.handover.eventId,
    receipt.selectedBy,
    ...governing
      .filter((candidate) => candidate !== receipt)
      .flatMap((candidate) => [candidate.handover.eventId, candidate.selectedBy]),
    ...(closing === undefined ? [] : [closing.handover.eventId, closing.selectedBy]),
  ]

  const known = {
    custody: 'KNOWN',
    holder,
    basis,
    since: receipt.handover.value.occurredAt,
    evidencedBy,
    rule: CUSTODY_AT_RULE,
  } as const
  return closing === undefined ? known : { ...known, until: closing.handover.value.occurredAt }
}

/**
 * **A8-MOVE as amended** — [A8 §7.1] plus [SD §4.7.2f] §7.3:
 *
 * > "Authority over every `boundBy = CUSTODY` fact class moves at the selected **`RECEIPT`**'s
 * > `occurredAt`, on that receipt's `custodyBasis`: `349` moves it to the receiving role; `41`
 * > moves custody and not authority. Across a transfer gap (C5) the **releasing role remains
 * > authoritative** until the receipt, so the gap is a custody `UNKNOWN` and not an authority
 * > vacuum."
 *
 * A8-MOVE said "effective at the handoff instant". Under F1 there are two instants — the release
 * and the receipt — and the rule has to name one. It names the **receipt**, for the two reasons
 * that decided §2: moving authority at the release would grant it to a party that has not spoken
 * (**M1**'s record-versus-fabrication argument), and [A8 §7.4(b)] already holds that a former
 * holder "never stops being authoritative for facts before the handoff", so nothing is lost by
 * waiting.
 *
 * This is a **second function over the same inputs**, and deliberately not a field on
 * {@link CustodyAt}: the fold answers *who holds the goods* and is silent across a transfer gap,
 * while authority is **not** silent there. Fusing them would make the gap an authority vacuum,
 * which is the thing the amendment exists to prevent.
 *
 * Note the `41` skip. A `41` receipt is `src:dp3-400ng` Item 125 **Shuttle Service** — a
 * truck-to-truck transfer to the same agent's own linehaul van: custody moves, responsibility does
 * not, so authority does not either. Skipping it is what makes A8-MOVE a distinction rather than a
 * synonym for the fold.
 *
 * **[ORIGINAL]**, and marked **do not score** until A8 ratifies it ([SD §4.7] note 3,
 * [A8 §10]'s last row).
 */
export type CustodyAuthority =
  | {
      readonly authority: 'HELD'
      readonly holder: CustodyHolder
      /** The `occurredAt` of the `349` receipt that moved it. */
      readonly since: Instant
      readonly evidencedBy: NonEmptyArray<EventId>
      readonly rule: RuleRef
    }
  | {
      readonly authority: 'NONE'
      readonly why: CustodyAuthorityEmptyReason
      readonly rule: RuleRef
    }

export const CUSTODY_AUTHORITY_EMPTY_REASONS = [
  /** No `349` receipt at or before the instant — nothing has moved authority to anybody yet. This
   * is the case **A8-NAMED** ([A8 §4.4]) exists for: the gap is visible in the data. */
  'NO_SELECTED_RECEIPT_AT_OR_BEFORE_INSTANT',
  /** Two `349` receipts at one instant naming different parties. C6's reasoning, one function
   * over: the rule does not order them, so authority is plural and A8-NAMED obliges a named
   * tie-break rather than a pick. */
  'AMBIGUOUS_ORDER_AT_INSTANT',
] as const

export type CustodyAuthorityEmptyReason = (typeof CUSTODY_AUTHORITY_EMPTY_REASONS)[number]

/** [SD §4.7.2f] §7.3's A8-MOVE, as a named, versioned rule. Provisional — do not score. */
export const CUSTODY_AUTHORITY_AT_RULE: RuleRef = ruleRef('CUSTODY-AUTHORITY-AT', '1')

/** A8-MOVE as amended, evaluated at an instant. See {@link CustodyAuthority}. */
export function custodyAuthorityAt(
  goods: SubjectRef<'shipment' | 'portion'>,
  instant: Instant,
  evidence: CustodyEvidence,
): CustodyAuthority {
  const moving = foldInputs(goods, evidence).filter((candidate) => {
    if (sideOf(candidate.handover) !== 'RECEIPT') return false
    if (compareInstants(candidate.handover.value.occurredAt, instant) > 0) return false
    const leg = legNamedBy(candidate.handover, evidence.legs)
    const basis = leg !== undefined ? leg.custodyBasis : candidate.handover.value.custodyBasis
    return basis === HANDED_OVER
  })

  const latest = moving[moving.length - 1]
  if (latest === undefined) {
    return {
      authority: 'NONE',
      why: 'NO_SELECTED_RECEIPT_AT_OR_BEFORE_INSTANT',
      rule: CUSTODY_AUTHORITY_AT_RULE,
    }
  }

  const movedAt = latest.handover.value.occurredAt
  const governing = moving.filter(
    (candidate) => compareInstants(candidate.handover.value.occurredAt, movedAt) === 0,
  )
  const holder = latest.handover.value.receivingParty
  if (
    !governing.every((candidate) => sameHolder(candidate.handover.value.receivingParty, holder))
  ) {
    return { authority: 'NONE', why: 'AMBIGUOUS_ORDER_AT_INSTANT', rule: CUSTODY_AUTHORITY_AT_RULE }
  }

  return {
    authority: 'HELD',
    holder,
    since: movedAt,
    evidencedBy: [
      latest.handover.eventId,
      latest.selectedBy,
      ...governing
        .filter((candidate) => candidate !== latest)
        .flatMap((candidate) => [candidate.handover.eventId, candidate.selectedBy]),
    ],
    rule: CUSTODY_AUTHORITY_AT_RULE,
  }
}

/** The two bases, exhaustively — a third would be a new Rec 24 code and a decision, not a detail. */
export function describeCustodyBasis(basis: CustodyBasis): string {
  switch (basis) {
    case HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY:
      return 'handed over under responsibility of the same transport operator (Rec 24 code 41)'
    case HANDED_OVER:
      return 'handed over to another party (Rec 24 code 349)'
    default:
      return assertNever(basis, 'custody basis')
  }
}

/**
 * [SD §4.8] "It is **never stored, never asserted and never corrected**."
 *
 * Held three ways, none of them a comment: `custody` is not in the record vocabulary and not in the
 * aggregate enum (`vocabulary.ts` `CustodyIsNotAFactClass`), so it can be neither a `type` nor a
 * `subject`; and the fold's answer carries none of the envelope fields a published record must have
 * ([SD §1.1]), so it cannot be mistaken for one or round-tripped through the capture interface.
 */
type CustodyAnswerIsNotARecord =
  Extract<
    keyof CustodyInterval | keyof CustodyUnknown,
    'eventId' | 'type' | 'specVersion' | 'assertedBy' | 'assertedAt' | 'recordedAt' | 'capturedBy'
  > extends never
    ? true
    : never
const _custodyAnswerIsNotARecord: CustodyAnswerIsNotARecord = true
void _custodyAnswerIsNotARecord
