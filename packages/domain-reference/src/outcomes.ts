/**
 * `(outcome, reason)` on every act — [SD §2].
 *
 * > "Every record that asserts the performance of an act carries an `outcome` from a five-member
 * > enum and, unless the outcome is `COMPLETED`, at least one structured `reason`. The event
 * > `type` names the act and never the outcome." — [SD §2]
 *
 * [SD §2] is a **[SYNTHESIS]** of two grade-A sources (`src:shippeo`'s situation/justification
 * grid and `src:open-trip-model`'s result enum) and is written up as one. The parts this module
 * carries that are authored are marked where they occur.
 */

import type { SubjectRef } from './envelope'
import type { PartyId } from './ids'
import type { NonEmptyArray, Owed, OwedCode } from './primitives'
import { assertNever } from './primitives'

/**
 * [SD §2.2]. Five members rather than OTM's four "because `COMPLETED_WITH_EXCEPTION` and
 * `PARTIALLY_COMPLETED` differ in **scope of performance**, and that difference is a billing and
 * claims difference, not a shade of meaning."
 */
export const OUTCOMES = [
  /**
   * The act was performed in full, with nothing to report. [SD §2.3] invariant 2 **forbids**
   * `reasons[]` here, and only here: **[ORIGINAL]** in [SD §2.3], "collapsing `CFM` into
   * `COMPLETED` and forbidding a reason there" normalises Shippeo, which always pairs a situation
   * with a justification.
   */
  'COMPLETED',
  /** [SD §2.2] **[ORIGINAL]**: rendering Shippeo's `LIV/RCA` (delivered-with-damage-accepted, which
   * sits under the _completed_ situation) as its own outcome member rather than `COMPLETED` + a
   * reason. */
  'COMPLETED_WITH_EXCEPTION',
  /**
   * The act reached **part** of its scope. [SD §2.2] keeps it apart from
   * `COMPLETED_WITH_EXCEPTION` because the two "differ in **scope of performance**, and that
   * difference is a billing and claims difference, not a shade of meaning". The scope itself is a
   * Portion named in `reasons[].appliesTo` — [SD §3.4]'s required form for "delivered, two items
   * short".
   */
  'PARTIALLY_COMPLETED',
  /**
   * The act did not happen. [SD §2.5] and [SD §2.6]: an **attempted** delivery is `type = delivery`
   * at this outcome with at least one reason, which is why the vocabulary needs no `attempt` type
   * and may not have one (**A-TYPE**).
   */
  'NOT_COMPLETED',
  /**
   * The act was called off. Distinct from `NOT_COMPLETED`, which is a performance that failed.
   * [SD §2.2] takes the five-member enum from `src:open-trip-model`'s result enum plus Shippeo's
   * situation/justification grid.
   */
  'CANCELLED',
] as const

export type Outcome = (typeof OUTCOMES)[number]

/** Every outcome that is not `COMPLETED` — i.e. every outcome that requires a reason. */
export type ExceptionalOutcome = Exclude<Outcome, 'COMPLETED'>

/**
 * [SD §2.4] `Reason.scope` — **[ORIGINAL]**.
 *
 * "It exists so a consumer can separate 'something is wrong with the goods' from 'something is
 * wrong with the site' without reading a code list, and because HHG's authoring gap is
 * concentrated in `SITE` and `ADMINISTRATIVE` — shuttle required, long carry, elevator
 * unavailable, parking permit, COI not on file — none of which Shippeo has."
 */
export const REASON_SCOPES = [
  /**
   * Something is wrong with **the act itself** — its timing, its sequence, its performance.
   * **[ORIGINAL]**: [SD §2.4] marks the whole `scope` axis authored and gives its purpose and its
   * HHG examples; it defines no member individually, so the gloss is this model's.
   */
  'ACT',
  /**
   * Something is wrong with **the goods** — damage, shortage, an item refused. **[ORIGINAL]**, as
   * `ACT`: [SD §2.4] authors the axis and not the member.
   */
  'GOODS',
  /**
   * Something is wrong on **a party's** side — the customer absent, the counterparty unready.
   * **[ORIGINAL]**, as `ACT`. `src:stedi-x12-reference` element 1651's 86 values are organised by
   * responsible party, which is the _fact_ [SD §2.4] rule 6 sources; the attribution itself rides
   * `Reason.attribution` rather than this axis.
   */
  'PARTY',
  /**
   * Something is wrong with **the equipment or crew** — a breakdown, a missing shuttle vehicle.
   * **[ORIGINAL]**, as `ACT`: [SD §2.4] authors the axis and not the member.
   */
  'RESOURCE',
  /**
   * Something is wrong with **the site** — shuttle required, long carry, elevator unavailable,
   * parking permit. [SD §2.4] names these as half of the HHG authoring gap: "none of which Shippeo
   * has". **[ORIGINAL]**, as `ACT`.
   */
  'SITE',
  /**
   * Something is wrong on **paper** — COI not on file, an authorisation missing. The other half of
   * [SD §2.4]'s HHG authoring gap. **[ORIGINAL]**, as `ACT`.
   */
  'ADMINISTRATIVE',
] as const

export type ReasonScope = (typeof REASON_SCOPES)[number]

/**
 * A member of the published, versioned reason vocabulary.
 *
 * **Owed.** [SD §2.4] fixes the vocabulary's _shape_ and six rules it must satisfy; "the list
 * itself is A4's job" and [SD §10.4] lists "the reason vocabulary's content" under what is
 * explicitly not settled. Represented as an owed code rather than guessed.
 *
 * The one member the shape itself requires is {@link REASON_CODE_OTHER} — [SD §2.4] rule 3, "an
 * open member with a mandatory narrative", sourced twice (OTM 5.7's `other` + `remark`;
 * `src:dp3-400ng` Item 226A's mandatory detailed note).
 */
export type ReasonCode = OwedCode<'reasonCode'>

export const REASON_CODE_OTHER = 'OTHER' as const

export function reasonCode(code: string): ReasonCode {
  if (code === REASON_CODE_OTHER) {
    // `OTHER` is not a member of the owed list: it is the one code the shape itself declares, and
    // it carries an obligation the others do not ([SD §2.4] rule 3). Keeping it out of this
    // constructor is what lets the `Reason` union make `remark` mandatory for it alone.
    throw new RangeError('use REASON_CODE_OTHER; it is declared by [SD §2.4], not owed by A4')
  }
  if (code.length === 0) throw new RangeError('empty reason code')
  return code as ReasonCode
}

/**
 * The class of party a reason is attributed to.
 *
 * **Owed.** [SD §2.4] rule 6 makes attribution a structured field and sources the _fact_ that
 * reason vocabularies are organised by responsible party (`src:stedi-x12-reference` element
 * 1651's 86 values; Shippeo's `NJU` vs `DIV`), but no document publishes the class list.
 * [SD §2.6]'s worked example uses `customer`, `carrier` and `unknown`; three examples are not a
 * vocabulary, and [A8 §9 item 2] owes the role enum this would be cut from.
 */
export type RoleClass = OwedCode<'roleClass'>

export const roleClass = (code: string): RoleClass => code as RoleClass

/**
 * [SD §2.4] "Attribution is a structured field on the reason, not baked into the code and not on
 * the assertion."
 *
 * This **supersedes `fork-time` §(b)(7)** ("attribution belongs on the assertion"), which
 * [round-2-critique] "correctly identified as a placement rule no source states". `party` is
 * optional because the responsible party is often unknown at the time the reason is recorded;
 * `roleClass` is not, because a reason that attributes to nobody at all is the `DIV` overload
 * [SD §2.3] invariant 2 exists to remove.
 */
export interface Attribution {
  readonly party?: PartyId
  readonly roleClass: RoleClass
}

/**
 * [SD §2.4] "A reason may carry its own remedy, and for some codes must."
 *
 * **Owed**, and owed per code: Shippeo's `new_slot {start, end}` is _required_ on appointment
 * events, "a failed delivery that does not say when it will be retried is an incomplete record" —
 * but which codes require which remedy is part of the vocabulary A4 owes.
 */
export type Remedy = Owed<'remedy', 'A4 — the reason vocabulary [SD §2.4, §10.4]'>

interface ReasonCommon {
  readonly scope: ReasonScope
  readonly attribution: Attribution
  /**
   * [SD §2.4] "OPTIONAL — `SubjectRef[]` at portion or item grain".
   *
   * This is the field that carries [SD §3.4]'s required form for "delivered, two items short",
   * and the field OTM 5.8's nested sub-results become here: [SD §3.3] publishes them "as
   * `appliesTo` refs on the reasons of one act, because our envelope has no nesting and because
   * the shortfall is frequently learned after the act was published".
   *
   * It is not a second subject ([SD §1.1]): it is the _scope_ of one asserted value, and
   * [SD §1.3]'s fact key does not read it.
   */
  readonly appliesTo?: ReadonlyArray<SubjectRef<'portion' | 'item'>>
  readonly remedy?: Remedy
}

/**
 * [SD §2.4] `remark` is "MANDATORY when code = OTHER", and only then.
 *
 * Two members rather than one optional field: `OTHER` without a narrative is the record
 * `src:dp3-400ng` Item 226A and OTM 5.7 both forbid, so it must not compile.
 */
export type Reason =
  | (ReasonCommon & { readonly code: typeof REASON_CODE_OTHER; readonly remark: string })
  | (ReasonCommon & { readonly code: ReasonCode; readonly remark?: string })

/**
 * The outcome half of an act's `value` — [SD §2.3] invariant 2.
 *
 * "`reasons[]` has at least one member unless `outcome = COMPLETED`, where it is **forbidden**."
 * Both halves are in the type: `COMPLETED` cannot carry reasons, and nothing else can omit them.
 *
 * **[ORIGINAL]** in [SD §2.3]: "collapsing `CFM` into `COMPLETED` and forbidding a reason there"
 * is a normalisation of Shippeo, which always pairs a situation with a justification.
 */
export type ActOutcome =
  | { readonly outcome: 'COMPLETED'; readonly reasons?: never }
  | { readonly outcome: ExceptionalOutcome; readonly reasons: NonEmptyArray<Reason> }

/** [SD §2.3] invariant 2, as a predicate — for consumers holding a runtime value. */
export function reasonsAreRequired(outcome: Outcome): boolean {
  switch (outcome) {
    case 'COMPLETED':
      return false
    case 'COMPLETED_WITH_EXCEPTION':
    case 'PARTIALLY_COMPLETED':
    case 'NOT_COMPLETED':
    case 'CANCELLED':
      return true
    default:
      return assertNever(outcome, 'outcome')
  }
}

export function isWellFormedActOutcome(candidate: ActOutcome): boolean {
  const reasons = candidate.reasons ?? []
  return reasonsAreRequired(candidate.outcome) ? reasons.length > 0 : reasons.length === 0
}

/**
 * **Rule A-TYPE** — [SD §2.5]. "A record `type` names the fact class — which, for an act, is the
 * act itself (`delivery`, `loading`, `packing`, `storeIn`). It MUST NOT encode the outcome.
 * `Delivery.Completed` is not a legal type name."
 *
 * A type name containing an outcome word resolves to `never`, so a vocabulary carrying one cannot
 * satisfy the conformance check in `vocabulary.ts`. Directly sourced, and the source is a defect
 * report: Shippeo's `…OrderNotLoadedPartiallyMissing` schema declares
 * `event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — "concrete evidence for why the event name must be
 * an alias for the code pair and never the identity."
 *
 * This is also what makes the single classification axis survivable ([SD §2.5]): "an
 * outcome-bearing type name would force a second, outcome-free axis to exist beside it purely so
 * the domain could still be talked about."
 */
export type OutcomeFreeTypeName<T extends string> = T extends string
  ? Lowercase<T> extends `${string}${Lowercase<Outcome>}${string}`
    ? never
    : T
  : never
// The outer `T extends string` is not redundant. Without it the checked type is `Lowercase<T>`
// rather than a naked `T`, the conditional stops distributing, and a union containing one
// offending name is tested — and passed — as a whole. The check then holds for every vocabulary
// and catches nothing.
