/**
 * Value rules — the resolutions that are settled by what the value *is* rather than by who said it.
 *
 * There is exactly one in the binding layer, and it is the acceptance test [SD §4.4] sets for the
 * whole `Assertion` shape: **duplicate reweighs**. Its importance is out of proportion to its size,
 * because it is the row that proves authority and value rules are **two mechanisms** — [A8 §5] row
 * 6 is `boundBy = NONE` precisely so that this rule can settle the value with no role winning.
 */

import type { Assertion, EvidenceRef, RuleRef } from '../assertions'
import { ruleRef } from '../assertions'
import type { EventId } from '../envelope'
import type { NonEmptyArray } from '../primitives'
import { assertNever } from '../primitives'

/**
 * **Rule `R-WEIGHT-LOWER`** — [SD §4.4]:
 *
 * > "Where two assertions of `type = weight.net` for one shipment are both `basis = ACTUAL` and
 * > were produced by **distinct weighings**, the resolved value is **the lower**."
 *
 * **Sourced, one cite per pairing** — and the pairings are kept apart here exactly as [SD §4.4]
 * keeps them apart, because the previous revision of that document "headed this rule with Item 4
 * Note 2 alone, which is the _duplicate-reweigh_ rule and does not reach the original-vs-reweigh
 * case the rule is most often used for":
 *
 * | pairing | cite | what it says |
 * | --- | --- | --- |
 * | reweigh vs reweigh | `src:dp3-400ng` **Item 4 Note 2** | the two agents coordinate and, "if duplicates occur, **DPS must be updated with the lower of the net reweigh weights**" |
 * | original vs reweigh | `src:dp3-400ng` **Item 4.11.d** | invoice on **the lesser weight** — the same item that forbids the reweigh being performed on the same scale as the original weighing |
 * | ticket vs constructive | `src:dp3-400ng` **Items 4.9.h-i** | pay "either valid weight tickets or a PPSO constructive weight of 7 lbs per cu ft, **whichever is less**" |
 *
 * **[ORIGINAL]:** stating the rule once over **any** two ACTUAL net weights from distinct
 * weighings, rather than three times per pairing. "The tariff never generalises it; we do, and the
 * generalisation is what `FactResolved.rule` makes safe — the rule is named, scoped and versioned,
 * so the scope of the authored step is on the record rather than in a reader's head."
 *
 * And the honest note [SD §4.4] attaches: **this is a DoD program rule, not a universal one.**
 * 400NG's own analysis warns against promoting program rules into the core model. The version in
 * this ref is what lets a commercial tariff carry a different rule over the same fact class without
 * the catalog changing shape.
 */
export const R_WEIGHT_LOWER: RuleRef = ruleRef('R-WEIGHT-LOWER', '1')

/**
 * The three pairings, named so a resolution can say which one it applied. Carried because
 * [SD §4.4] insists the citation is per pairing; a consumer that only ever sees `R-WEIGHT-LOWER`
 * cannot tell whether the authored generalisation was exercised or not.
 */
export const WEIGHT_PAIRINGS = [
  /** `src:dp3-400ng` Item 4 Note 2. */
  'REWEIGH_VS_REWEIGH',
  /** `src:dp3-400ng` Item 4.11.d. */
  'ORIGINAL_VS_REWEIGH',
  /** `src:dp3-400ng` Items 4.9.h-i. */
  'TICKET_VS_CONSTRUCTIVE',
  /** Any other pair of ACTUAL net weights from distinct weighings — **[ORIGINAL]**, the
   * generalisation itself. A resolution carrying this pairing is exercising the authored step and
   * says so. */
  'OTHER_PAIR_OF_ACTUAL_NET_WEIGHINGS',
] as const

export type WeightPairing = (typeof WEIGHT_PAIRINGS)[number]

/**
 * **A reweigh is NOT a correction** — [SD §4.4] note 2:
 *
 * > "The first weighing **occurred and was recorded correctly**. Both assertions stand; the
 * > resolution picks. Under `fork-time`'s preference order the reweigh would have been a
 * > 'compensate', leaving two authoritative weights and no winner — which is precisely the failure
 * > the critique identified."
 *
 * This is the rule most likely to be got wrong by a reader who knows [SD §6], so it is stated as a
 * type rather than a sentence: the inputs to this module are two `Assertion`s. There is no overload
 * taking a `Correction`, no `corrects` link is read, and neither input is retracted by the other —
 * `supersedes` would be wrong too, since [SD §4.1] restricts it to a **later assertion by the same
 * party** revising itself, and a reweigh is characteristically by the other side.
 */
export type NetWeightAssertion = Assertion<'weight.net'>

/**
 * Whether two net-weight assertions were "produced by **distinct weighings**" — [SD §4.4]'s own
 * condition, and the one part of the rule the binding layer does not define.
 *
 * Three-valued on purpose. `src:cfr-49-375` §375.517 and 400NG Item 4.11.d make distinctness real
 * and physical (a reweigh may not be performed on the same scale as the original weighing; the
 * weight ticket carries the scale's name and location under §375.519), and [SD §4.4] routes the
 * evidence for a weight through `capturedBy` + `evidence[]`. So: **disjoint non-empty evidence is
 * distinct**; **shared evidence is the same weighing keyed twice**; and where either side carries
 * no evidence at all the question is `UNDETERMINED` — not "distinct".
 *
 * DECISION, and it is the conservative one: an undetermined pair must not be resolved by
 * `R-WEIGHT-LOWER`. Treating "no evidence" as "distinct" would let one weighing re-keyed by two
 * parties be read as two weighings, and the lower of a value and itself is not a finding. Treating
 * it as "same" would silently drop a real reweigh. Reported rather than guessed either way.
 */
export const DISTINCTNESS = ['DISTINCT', 'SAME_WEIGHING', 'UNDETERMINED'] as const

export type Distinctness = (typeof DISTINCTNESS)[number]

function evidenceKeys(refs: readonly EvidenceRef[] | undefined): readonly string[] {
  return (refs ?? []).map((ref) => (ref.kind === 'document' ? `d:${ref.ref.id}` : `a:${ref.ref}`))
}

export function areDistinctWeighings(
  left: NetWeightAssertion,
  right: NetWeightAssertion,
): Distinctness {
  const leftKeys = evidenceKeys(left.evidence)
  const rightKeys = evidenceKeys(right.evidence)
  if (leftKeys.length === 0 || rightKeys.length === 0) return 'UNDETERMINED'
  return leftKeys.some((key) => rightKeys.includes(key)) ? 'SAME_WEIGHING' : 'DISTINCT'
}

export const WEIGHT_RULE_NOT_APPLICABLE = [
  /** [SD §4.4] binds the rule to `basis = ACTUAL` on **both** sides. An ESTIMATED weight is not a
   * weighing, and the two do not contest as equals — [A8 §4.1]'s standings, not this rule. */
  'NOT_BOTH_ACTUAL',
  /** The rule is stated over "one shipment". Two fact keys are two contests ([SD §1.3]). */
  'DIFFERENT_FACT_SUBJECTS',
  /** {@link areDistinctWeighings} returned `SAME_WEIGHING` — one weighing keyed twice is a
   * supersession or a duplicate, not a contest the lower-wins rule settles. */
  'SAME_WEIGHING',
  /** {@link areDistinctWeighings} returned `UNDETERMINED`. */
  'DISTINCTNESS_UNDETERMINED',
  /** The two amounts are in different units, and no unit vocabulary is published: `MeasureValue.unit`
   * is an `OwedCode<'unitOfMeasure'>` ([SD §4.1] fixes the shape `(kind, unit, value, source)` and
   * fixes no unit list). "Lower" across two unconvertible units is not a comparison. */
  'UNITS_DIFFER',
] as const

export type WeightRuleNotApplicable = (typeof WEIGHT_RULE_NOT_APPLICABLE)[number]

/**
 * The output is shaped as the inputs to a `FactResolved` ([SD §4.3]) rather than as a bare number,
 * because that is the whole point of the rule being named: `selected` and `considered[]` are what
 * the catalog publishes, and `rule` is what makes the authored generalisation inspectable.
 */
export type WeightResolution =
  | {
      readonly applied: true
      readonly selected: EventId
      readonly considered: NonEmptyArray<EventId>
      readonly rule: RuleRef
      readonly pairing: WeightPairing
    }
  | {
      readonly applied: false
      readonly because: WeightRuleNotApplicable
      /**
       * **A8-NAMED** ([A8 §4.4]) in its most tempting spot: where the rule does not apply there is
       * no answer, and the caller may **not** fall back to the most recent assertion. "`RECENCY` is
       * a legal `ruleId` only where the catalog has published it for that specific fact class",
       * and `authority.ts`'s `PUBLISHED_RECENCY_RULES` is empty.
       */
      readonly mayFallBackToRecency: false
    }

/**
 * `R-WEIGHT-LOWER`, applied. Takes both assertions and returns the resolution's inputs.
 *
 * Note which fields it does **not** read: `assertedBy` (no role wins this row — [A8 §5] row 6 is
 * `boundBy = NONE`), `assertedAt` and `recordedAt` (A8-INSTANT, and recency besides). The rule
 * reads the two values, their bases, their subjects and their evidence.
 */
export function resolveNetWeight(
  left: NetWeightAssertion,
  right: NetWeightAssertion,
  pairing: WeightPairing = 'OTHER_PAIR_OF_ACTUAL_NET_WEIGHINGS',
): WeightResolution {
  if (left.basis !== 'ACTUAL' || right.basis !== 'ACTUAL') {
    return { applied: false, because: 'NOT_BOTH_ACTUAL', mayFallBackToRecency: false }
  }
  if (left.subject.aggregate !== right.subject.aggregate || left.subject.id !== right.subject.id) {
    return { applied: false, because: 'DIFFERENT_FACT_SUBJECTS', mayFallBackToRecency: false }
  }

  const distinctness = areDistinctWeighings(left, right)
  switch (distinctness) {
    case 'SAME_WEIGHING':
      return { applied: false, because: 'SAME_WEIGHING', mayFallBackToRecency: false }
    case 'UNDETERMINED':
      return {
        applied: false,
        because: 'DISTINCTNESS_UNDETERMINED',
        mayFallBackToRecency: false,
      }
    case 'DISTINCT':
      break
    default:
      return assertNever(distinctness, 'distinctness')
  }

  if (left.value.unit !== right.value.unit) {
    return { applied: false, because: 'UNITS_DIFFER', mayFallBackToRecency: false }
  }

  // "the resolved value is **the lower**". Ties select the first argument; the rule is about the
  // VALUE, and two equal values make the choice immaterial to the answer it publishes.
  const lower = left.value.amount <= right.value.amount ? left : right
  return {
    applied: true,
    selected: lower.eventId,
    considered: [left.eventId, right.eventId],
    rule: R_WEIGHT_LOWER,
    pairing,
  }
}

/**
 * The same machinery handles the other published evidence hierarchies — [SD §4.4]'s closing
 * paragraph: 400NG Items 4.9.g-i enumerate the **sources** a weight may come from (certified-scale
 * ticket, Branham, NADA, "other appropriate reference sources", customer manufacturer documents,
 * constructive rate per cubic foot), "which in our shape is `capturedBy` + `evidence[]` on each
 * assertion, **with a named rule choosing between them**".
 *
 * TODO([SD §4.4] / A4): that named rule is not published. It is not this one — `R-WEIGHT-LOWER`
 * chooses by value, and a source hierarchy chooses by provenance — and minting it here would be
 * inventing a preference order the tariff states as a list of permitted sources rather than as a
 * ranking.
 */
export const WEIGHT_SOURCE_HIERARCHY_RULE_IS_OWED = true
