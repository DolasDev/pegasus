/**
 * `orderStageAt(order, instant)` — the commitment-side fold — [A1 §3.3].
 *
 * > "**An order's stage is not a field and not a record. It is `orderStageAt(order, instant)` — a
 * > named, versioned fold over the `FactResolved`-selected `orderAward`, `orderResponse` and
 * > `orderCancellation` assertions. It is never stored, never asserted and never corrected.**" —
 * > [A1 §3.3], decision **A1-STAGE**
 *
 * It is the second projection in this package and it is deliberately shaped like the first. [SD
 * §1.1] forbids a mutable current-state field on the envelope; [A3 §3.4] records
 * `StopStatusChanged` rejected on that ground; and [SD §4.8.2] made custody a projection because a
 * stored one would need an authority row whose binding was the thing it defined. The same argument
 * reaches an order's stage unchanged, so what [A1 §3.3] decided is the **fold**, not whether there
 * should be one.
 *
 * Three structural facts make this fold much smaller than {@link custodyAt}, and all three are
 * settled above it:
 *
 * 1. None of the three types declares a `qualifier` ([SD §4.7.2e] item 4), so each fact key is
 *    `(subject, type)` and [SD §4.3] selects **one** winner per key — at most **three** inputs.
 * 2. Successive changes ride `supersedes` ([SD §4.1]) rather than a qualifier ([SD §4.7.2e] item 4),
 *    so a re-award is one party revising its own assertion and not a second contested fact. What
 *    this fold relies on is only the first half of that: [SD §4.3] publishes **one winner per key**,
 *    and the fold reads winners. How a resolution treats a superseded record is the resolution's
 *    business and nothing here asserts it — the package implements no generic resolver.
 * 3. `context[]` is not read — [SD §1.4] rule 3 — which is what makes the stage independent of how
 *    many shipments are committed, **including zero** ([`fork-order` §5.3]'s legal zero, and
 *    [A1 §5.2]).
 */

import type { Assertion, FactResolved } from '../assertions'
import { ruleRef, type RuleRef } from '../assertions'
import type { EventId, SubjectRef } from '../envelope'
import type { Outcome } from '../outcomes'
import type { Instant } from '../primitives'
import { assertNever } from '../primitives'

/** The three commitment-side act types the fold reads — [SD §4.7.2e]. */
export const ORDER_LIFECYCLE_TYPES = ['orderAward', 'orderResponse', 'orderCancellation'] as const

export type OrderLifecycleType = (typeof ORDER_LIFECYCLE_TYPES)[number]

/**
 * The stages — [A1 §3.3]'s table.
 *
 * Five, against `src:weichert-supplier-api`'s eight, `src:smartmoving-api`'s nine and
 * `src:dcsa`'s nine. The difference is not economy: every value those sources spend on **who**
 * ended the order rides `reasons[].attribution` here ([SD §4.7.2e] item 2), and every value they
 * spend on what has happened to the goods belongs to another area's records ([A1 §3.4]).
 */
export const ORDER_STAGES = [
  /**
   * The order exists as a subject and no award stands — [`fork-order` §5.3]'s pre-commitment
   * state. It is a stage and not an `UNKNOWN`: [SD §1.2] makes `order` an aggregate kind, so the
   * order is nameable before anything has been committed about it.
   */
  'UNAWARDED',
  /** An award stands and has not been answered. */
  'AWARDED',
  /**
   * A commitment stands — [A1 §3.2]'s `A` Reservation Accepted and `B` Conditional Acceptance,
   * which map to different outcomes and to the **same** stage. That they do is the test of the
   * mapping, not a coincidence of it.
   */
  'ACCEPTED',
  /** The offeree answered and the answer was no — [A1 §3.2]'s `C` Counter Proposal Made. */
  'DECLINED',
  /** The commitment was ended after it stood. */
  'CANCELLED',
] as const

export type OrderStage = (typeof ORDER_STAGES)[number]

/**
 * Why the fold declined to answer.
 *
 * Diagnostic only, and on the same terms {@link CustodyUnknownReason} is: [SD §4.8.3] rule 3 makes
 * `UNKNOWN` "a real outcome and **never filled in**", and naming the cases keeps "nothing has been
 * published" apart from "something unreadable has been". None of these carries a candidate stage.
 */
export const ORDER_STAGE_UNKNOWN_REASONS = [
  /**
   * A commitment act published at `outcome = CANCELLED`. [SD §6] makes withdrawing an assertion a
   * **retraction**, not an outcome, so this is a record the type system admits and no document
   * reads. [A1 §3.3] rule 2 declines rather than guessing, and names the mechanism that should have
   * been used.
   */
  'ACT_CALLED_OFF',
  /**
   * An `orderAward` at `PARTIALLY_COMPLETED`. The scope of a partial award has nowhere to live:
   * `Reason.appliesTo` is `SubjectRef<'portion' | 'item'>[]` ([SD §2.4]) and an order's parts are
   * shipments.
   */
  'AWARD_SCOPE_NOT_EXPRESSIBLE',
  /**
   * An `orderResponse` at `PARTIALLY_COMPLETED` — the **per-stop acceptance** the 990's `S5` loop
   * carries. [A1 §3.2] records it owed rather than widening `appliesTo`, because [SD §5.4] keeps
   * the Portion and item grains apart deliberately and a stop is neither.
   */
  'RESPONSE_SCOPE_NOT_EXPRESSIBLE',
  /** An `orderCancellation` at `PARTIALLY_COMPLETED` — cancelling some of what was committed. */
  'CANCELLATION_SCOPE_NOT_EXPRESSIBLE',
  /**
   * Two governing facts at one `occurredAt` that would yield different stages. [A1 §3.3] rule 4:
   * this is [A8 §4.4] **A8-NAMED** in its commitment-side form and [SD §4.8.3]'s **C6** applied to
   * a second fold. The model publishes no tie-break here, so the fold does not invent one by
   * leaning on sort stability.
   */
  'AMBIGUOUS_ORDER_AT_INSTANT',
  /**
   * The governing fact is an `orderResponse` and no selected `orderAward` stands at or before it.
   * [A1 §3.3] rule 5, **[ORIGINAL]**, and the commitment-side twin of [SD §4.8.3]'s C5: a
   * commitment whose offer was never published is one whose two parties cannot both be named, and
   * answering `ACCEPTED` there would let a commitment exist on one party's word alone.
   */
  'RESPONSE_WITHOUT_AWARD',
] as const

export type OrderStageUnknownReason = (typeof ORDER_STAGE_UNKNOWN_REASONS)[number]

/** A stage the fold could compute, with the records that produced it. */
export interface OrderStageKnown {
  readonly stage: OrderStage
  /**
   * The `occurredAt` of the governing fact — **absent** in exactly one case, and it is a real one:
   * `UNAWARDED` with nothing published is a stage no record produced. [`fork-order` §5.3] makes the
   * order nameable before anything is committed about it, so the fold must be able to answer
   * without evidence, and the shape says so rather than fabricating an instant.
   */
  readonly since?: Instant
  /** Empty in the same one case, and only there. */
  readonly evidencedBy: readonly EventId[]
  /** [SD §4.8.3] rule 2: the answer names the rule that produced it. */
  readonly rule: RuleRef
}

export interface OrderStageUnknown {
  readonly stage: 'UNKNOWN'
  readonly why: OrderStageUnknownReason
  readonly rule: RuleRef
}

export type OrderStageAt = OrderStageKnown | OrderStageUnknown

/**
 * [SD §4.8.3] rule 2's shape, the same one `FactResolved.rule` and `CUSTODY-AT` carry. A consumer
 * that asks "was this order live on 3 March" gets an answer that names the rule that produced it.
 */
export const ORDER_STAGE_AT_RULE: RuleRef = ruleRef('ORDER-STAGE-AT', '1')

/** What the fold is handed: the published records, and the resolutions that picked among them. */
export interface OrderCommitmentEvidence {
  readonly acts: ReadonlyArray<Assertion<OrderLifecycleType>>
  readonly resolutions: ReadonlyArray<FactResolved>
}

interface SelectedAct {
  readonly act: Assertion<OrderLifecycleType>
  readonly selectedBy: EventId
}

function isOrderLifecycleType(type: string): type is OrderLifecycleType {
  return (ORDER_LIFECYCLE_TYPES as readonly string[]).includes(type)
}

/** Instants carry offsets, so ordering them is a parse and not a string compare ([SD §4.2]). */
function compareInstants(left: Instant, right: Instant): number {
  return Date.parse(left) - Date.parse(right)
}

/**
 * The selection half of the fold's input, on [SD §4.8.3] rule 1's terms.
 *
 * A resolution whose `selected` is `null` contributes nothing, and that is not an oversight: a null
 * selection is [A8 §7.3] **A8-JOINT** declining to pick, so the catalog has published a contest and
 * no winner. Reading a loser out of it would be exactly the silent selection A8-JOINT forbids —
 * which is the state [A1 §8] scenario 7 lands in, because the three order authority rows are owed.
 */
export function selectedOrderActs(evidence: OrderCommitmentEvidence): readonly SelectedAct[] {
  const selected: SelectedAct[] = []
  for (const resolution of evidence.resolutions) {
    if (!isOrderLifecycleType(resolution.factRef.type)) continue
    const winner = resolution.selected
    if (winner === null) continue
    const act = evidence.acts.find((candidate) => candidate.eventId === winner)
    if (act === undefined) continue
    selected.push({ act, selectedBy: resolution.eventId })
  }
  return selected
}

/** What a single governing fact yields — a stage, an `UNKNOWN` reason, or nothing at all. */
type Reading =
  | { readonly kind: 'STAGE'; readonly stage: OrderStage }
  | { readonly kind: 'UNKNOWN'; readonly why: OrderStageUnknownReason }
  /**
   * [A1 §3.3] rule 3, and [SD §4.7.2e] item 3: "a cancellation is an act with an outcome, and a
   * refused cancellation needs no new mechanism". A refused cancellation is skipped, and the stage
   * is whatever the next-latest governing fact says — so an order whose cancellation was refused is
   * still `ACCEPTED`.
   */
  | { readonly kind: 'DOES_NOT_GOVERN' }

/**
 * [A1 §3.3] rule 2 — the outcome reading, per type.
 *
 * The outcome axis does not read the same way on all three types, and that is [SD §4.7.2e] item 1's
 * decision rather than a liberty taken here: on `orderResponse` the outcome is the **content of the
 * answer** — `COMPLETED` accepted, `NOT_COMPLETED` declined — not the performance of answering.
 * Extending the same reading to the other two is **[ORIGINAL]** ([A1 §7]), and it is forced in the
 * sense that one reading cannot serve an offer, an answer and a termination.
 */
function read(type: OrderLifecycleType, outcome: Outcome): Reading {
  switch (outcome) {
    case 'COMPLETED':
    case 'COMPLETED_WITH_EXCEPTION':
      // `B` Conditional Acceptance lands here with `A`, and on the same stage — [A1 §3.2].
      switch (type) {
        case 'orderAward':
          return { kind: 'STAGE', stage: 'AWARDED' }
        case 'orderResponse':
          return { kind: 'STAGE', stage: 'ACCEPTED' }
        case 'orderCancellation':
          return { kind: 'STAGE', stage: 'CANCELLED' }
        default:
          return assertNever(type, 'unreachable order lifecycle type')
      }
    case 'PARTIALLY_COMPLETED':
      switch (type) {
        case 'orderAward':
          return { kind: 'UNKNOWN', why: 'AWARD_SCOPE_NOT_EXPRESSIBLE' }
        case 'orderResponse':
          return { kind: 'UNKNOWN', why: 'RESPONSE_SCOPE_NOT_EXPRESSIBLE' }
        case 'orderCancellation':
          return { kind: 'UNKNOWN', why: 'CANCELLATION_SCOPE_NOT_EXPRESSIBLE' }
        default:
          return assertNever(type, 'unreachable order lifecycle type')
      }
    case 'NOT_COMPLETED':
      switch (type) {
        // The award was attempted and not made. `src:dtr-part-iv`'s blackout and the case where no
        // eligible offeree exists both land here, and the order is back where it started.
        case 'orderAward':
          return { kind: 'STAGE', stage: 'UNAWARDED' }
        case 'orderResponse':
          return { kind: 'STAGE', stage: 'DECLINED' }
        case 'orderCancellation':
          return { kind: 'DOES_NOT_GOVERN' }
        default:
          return assertNever(type, 'unreachable order lifecycle type')
      }
    case 'CANCELLED':
      return { kind: 'UNKNOWN', why: 'ACT_CALLED_OFF' }
    default:
      return assertNever(outcome, 'unreachable outcome')
  }
}

/**
 * An act's outcome, where it has one. [SD §2.3] invariant 1 admits `outcome` only at
 * `basis = ACTUAL`, so a planned or estimated commitment act carries none and cannot move a stage:
 * a plan is not a commitment.
 */
function outcomeOf(act: Assertion<OrderLifecycleType>): Outcome | undefined {
  return (act as { value: { outcome?: Outcome } }).value.outcome
}

function occurredAtOf(act: Assertion<OrderLifecycleType>): Instant {
  return (act as { value: { occurredAt: Instant } }).value.occurredAt
}

function isAboutThisOrder(act: Assertion<OrderLifecycleType>, order: SubjectRef<'order'>): boolean {
  // [SD §1.4] rule 1: subject matching never consults `context[]`.
  return act.subject.aggregate === order.aggregate && act.subject.id === order.id
}

/**
 * The fold — [A1 §3.3], rule `ORDER-STAGE-AT` version 1.
 *
 * Reads the selected commitment acts about one order, orders them by `occurredAt`, and answers with
 * the **latest governing** one at or before the instant. Five rules govern it and each is cited at
 * the line that implements it; the two that are not mechanical are rule 3 (a refused cancellation
 * does not govern) and rule 5 (a response with no award behind it is `UNKNOWN`).
 */
export function orderStageAt(
  order: SubjectRef<'order'>,
  instant: Instant,
  evidence: OrderCommitmentEvidence,
): OrderStageAt {
  const mine = selectedOrderActs(evidence).filter((candidate) =>
    isAboutThisOrder(candidate.act, order),
  )

  // Rule 2, first half: an act with no outcome is at a plan basis and asserts no performance.
  const performed = mine.filter((candidate) => outcomeOf(candidate.act) !== undefined)

  const atOrBefore = performed
    .filter((candidate) => compareInstants(occurredAtOf(candidate.act), instant) <= 0)
    .slice()
    .sort((left, right) => compareInstants(occurredAtOf(left.act), occurredAtOf(right.act)))

  // Walk back from the latest, skipping the facts that do not govern (rule 3), and stop at the
  // first instant that does. The GOVERNING fact is all of the facts at that instant, not the last
  // one the sort happened to put there — rule 4 needs the tie to stay visible.
  let index = atOrBefore.length - 1
  while (index >= 0) {
    const candidate = atOrBefore[index]
    if (candidate === undefined) break
    const governingAt = occurredAtOf(candidate.act)
    const governing = atOrBefore.filter(
      (other) => compareInstants(occurredAtOf(other.act), governingAt) === 0,
    )
    const readings = governing.map((other) => {
      const outcome = outcomeOf(other.act)
      // Narrowed by the `performed` filter above; the fallback keeps the function total.
      if (outcome === undefined) return { kind: 'DOES_NOT_GOVERN' } as Reading
      return read(other.act.type, outcome)
    })

    const effective = readings.filter((reading) => reading.kind !== 'DOES_NOT_GOVERN')
    if (effective.length === 0) {
      // Every fact at this instant was a refused cancellation. Rule 3: look further back.
      index -= governing.length
      continue
    }

    // **Rule 4.** Two governing facts at one instant that would answer differently, and the fold
    // declines. It does NOT order them by key, by `assertedAt`, by `recordedAt` or by type.
    const first = effective[0]
    if (first === undefined) break
    const answerOf = (reading: Reading): string =>
      reading.kind === 'STAGE'
        ? `STAGE:${reading.stage}`
        : reading.kind === 'UNKNOWN'
          ? `UNKNOWN:${reading.why}`
          : 'DOES_NOT_GOVERN'
    const differs = effective.some((reading) => answerOf(reading) !== answerOf(first))
    if (differs) {
      return { stage: 'UNKNOWN', why: 'AMBIGUOUS_ORDER_AT_INSTANT', rule: ORDER_STAGE_AT_RULE }
    }

    if (first.kind === 'UNKNOWN') {
      return { stage: 'UNKNOWN', why: first.why, rule: ORDER_STAGE_AT_RULE }
    }

    // **Rule 5.** A response governs only where an award stands at or before it. [A1 §3.3] rule 5,
    // **[ORIGINAL]** — the commitment-side twin of [SD §4.8.3]'s C5.
    const governedByAResponse = governing.some((other) => other.act.type === 'orderResponse')
    if (governedByAResponse) {
      const awardStands = atOrBefore.some(
        (other) =>
          other.act.type === 'orderAward' &&
          compareInstants(occurredAtOf(other.act), governingAt) <= 0 &&
          outcomeOf(other.act) !== 'NOT_COMPLETED',
      )
      if (!awardStands) {
        return { stage: 'UNKNOWN', why: 'RESPONSE_WITHOUT_AWARD', rule: ORDER_STAGE_AT_RULE }
      }
    }

    return {
      stage: first.stage,
      since: governingAt,
      evidencedBy: governing.map((other) => other.act.eventId),
      rule: ORDER_STAGE_AT_RULE,
    }
  }

  // Nothing governs. [`fork-order` §5.3]: the order exists and nothing has been committed about it.
  return { stage: 'UNAWARDED', evidencedBy: [], rule: ORDER_STAGE_AT_RULE }
}
