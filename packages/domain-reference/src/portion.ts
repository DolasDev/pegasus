/**
 * One sub-shipment grain: the **Portion** — [SD §3].
 *
 * > "There is exactly one sub-shipment grain: the `Portion` — a named subset of one shipment's
 * > goods, with its own identity, whose membership is stated either by enumeration over items or
 * > by measure, and which is minted by the first act that applies to less than the whole shipment.
 * > `item` remains a subject kind for facts genuinely about one article. **There is no quantity
 * > field on any act.**" — [SD §3]
 *
 * "Partial load, split delivery, overflow, SIT remainder, refused items and short delivery are one
 * phenomenon. Today they have four models across three documents and no cross-reference."
 */

import type { SubjectRef } from './envelope'
import type { ItemId, PortionId } from './ids'
import type { ReasonCode } from './outcomes'
import { assertNever, owed } from './primitives'

/**
 * [SD §3.2] "The corpus publishes **both** forms for the same phenomenon, which is why neither can
 * be the sole grain."
 *
 * Enumerated: `src:dp3-400ng` Item 17.13 identifies a partial SIT withdrawal by **inventory item
 * numbers**; `src:x12-212-trailer-manifest` `MAN` expresses marks as a start–end range.
 * Measured: the same 400NG item requires "the **actual weight** of the portion withdrawn", and
 * `src:sirva-ade`'s `Overflow` event carries `Weight` and nothing else.
 */
export const MEMBERSHIP_FORMS = [
  /**
   * The subset is stated **by measure** — `src:dp3-400ng` Item 17.13's "actual weight of the
   * portion withdrawn"; `src:sirva-ade`'s `Overflow` event carries `Weight` and nothing else
   * ([SD §3.2]). A `MEASURED`-only Portion **cannot support a claim** (**P-CLAIM**), because a
   * claim addresses items.
   */
  'MEASURED',
  /**
   * The subset is stated **by enumeration** — item refs, or a mark range.
   * `src:dp3-400ng` Item 17.13 identifies a partial SIT withdrawal by inventory item numbers, and
   * `src:x12-212-trailer-manifest` `MAN` expresses marks as a start-end range ([SD §3.2]).
   */
  'ENUMERATED',
  /**
   * Both forms are known. [SD §3.2]: "The corpus publishes **both** forms for the same phenomenon,
   * which is why neither can be the sole grain." Under **P-MEMBER** this is the terminal form —
   * knowledge may be added to a Portion and never removed.
   */
  'BOTH',
] as const

export type MembershipForm = (typeof MEMBERSHIP_FORMS)[number]

/**
 * A measure of the subset. `src:dp3-400ng` Item 17.13's "actual weight of the portion withdrawn";
 * storage then "continues to accrue on the remaining weight".
 *
 * TODO(measures): this is the same owed unit vocabulary as `MeasureValue` in `assertions.ts`. If
 * a units module lands, both should read from it rather than each carrying a shape.
 */
export interface PortionMeasure {
  readonly weight?: { readonly amount: number; readonly unit: string }
  readonly pieceCount?: number
}

/**
 * `src:x12-212-trailer-manifest` `MAN-02`/`MAN-03`: marks "expressible as a **start–end range**"
 * — "the inventory-sticker series, without inventing anything" ([SD §3.2]).
 */
export interface MarkRange {
  readonly markFrom: string
  readonly markTo: string
}

/** [SD §3.1] "`items[]` — item refs, **or a mark range**". */
export type Enumeration = { readonly items: readonly ItemId[] } | { readonly marks: MarkRange }

interface PortionCommon {
  /** [SD §3.1] "ours, never reused". */
  readonly portionId: PortionId
  /**
   * [SD §3.1] "exactly one; **a Portion never spans shipments**", and **Rule P-IDENTITY**
   * ([SD §3.2]): "A Portion never changes the shipment boundary. Minting a Portion is not
   * splitting a shipment." The SIT remainder is a Portion; the shipment is untouched.
   *
   * Held in the type by there being one field and no operation that changes it.
   *
   * _(Whether a **terminated** stay that moves onward on a new BL is a new shipment was left open
   * at [SD §3.2] and [SD §10.4] and is now settled: [A5 §3.4] rules that the **stay** is untouched,
   * and [A2 §3.2]'s rule **B-ONWARD** rules that the onward movement is a **second shipment**,
   * because `src:dtr-part-iv` §E.4(4)(c)'s new bill of lading is a new contract "whereby the TSP
   * agrees to furnish transportation services" (#81) and therefore a new undertaking. Neither
   * touches this field: a Portion still never spans shipments, and [A2 §3.2(b)] adds that the
   * corpus's hardest split case — `src:dp3-400ng` Item 17.9's **Split Shipment** — is **one**
   * shipment with Portions, which is positive evidence for P-IDENTITY rather than a strain on it.)_
   */
  readonly shipment: SubjectRef<'shipment'>
  /**
   * [SD §3.1] "**`basis`** — the reason code that caused this subset to exist".
   *
   * NOTE: this is not `Assertion.basis` ([SD §4.2]'s tense enum). The two fields share a name in
   * the binding document and live on different records; the document's spelling is kept because
   * the code is normative for structure and the documents for rationale, and renaming it here
   * would make the two disagree.
   */
  readonly basis: ReasonCode
}

/**
 * [SD §3.1]'s shape, as three members rather than one with two optional halves: `measure` is
 * present "when MEASURED or BOTH" and `items[]` "when ENUMERATED or BOTH", which is a
 * discriminated union written out.
 */
export type Portion =
  | (PortionCommon & {
      readonly membership: 'MEASURED'
      readonly measure: PortionMeasure
      readonly enumeration?: never
    })
  | (PortionCommon & {
      readonly membership: 'ENUMERATED'
      readonly enumeration: Enumeration
      readonly measure?: never
    })
  | (PortionCommon & {
      readonly membership: 'BOTH'
      readonly measure: PortionMeasure
      readonly enumeration: Enumeration
    })

/**
 * **Rule P-MEMBER** — [SD §3.2]. "A Portion may be minted `MEASURED` and later become
 * `ENUMERATED` or `BOTH` **without changing its `portionId`**."
 *
 * **[ORIGINAL]**, and "the one genuinely useful idea in `fork-order` §5.1 — the crew often knows
 * the weight and not the contents. The failure in `fork-order` was making the Portion
 * _inherently_ weighed, which is why the critique found it 'far too heavy for two items, and too
 * light for a claim.'"
 *
 * DECISION: the rule names one direction (`MEASURED` → `ENUMERATED` | `BOTH`) and is silent on
 * the rest. Read here as a knowledge-monotonicity rule — a transition may add what is known about
 * the subset and may never remove it — so `ENUMERATED` → `BOTH` is legal (a later weighing) and
 * every narrowing transition is not. The narrowing half is the load-bearing one: it is what stops
 * a Portion that has supported a claim under P-CLAIM from quietly ceasing to.
 */
export function isLegalMembershipTransition(from: MembershipForm, to: MembershipForm): boolean {
  if (from === to) return true
  switch (from) {
    case 'MEASURED':
      return to === 'ENUMERATED' || to === 'BOTH'
    case 'ENUMERATED':
      return to === 'BOTH'
    case 'BOTH':
      return false
    default:
      return assertNever(from, 'membership form')
  }
}

/**
 * **Rule P-CLAIM** — [SD §3.2]. "A claim addresses items. A `MEASURED`-only Portion cannot support
 * a claim, and **the catalog says so** rather than leaving a consumer to discover it."
 *
 * **[ORIGINAL]** as a catalog rule; grounded in `src:dp3-400ng` Item 17.12.c (both TSP and
 * warehouseman must hold "the condition of **each article** when received at and forwarded from
 * the storage location") and `src:cfr-49-375` §375.503.
 */
export function canSupportClaim(portion: Portion): boolean {
  return portion.membership !== 'MEASURED'
}

/**
 * **Rule P-OVERLAP** — [SD §3.2]. "Portions may overlap and may nest."
 *
 * "'The twelve items that went into SIT' and 'the three of those refused on delivery-out' are both
 * Portions, and the second is a subset of the first. **[ORIGINAL]** — forbidding overlap would
 * make the normal SIT case inexpressible."
 *
 * The rule is the **absence** of a constraint, so nothing in the types enforces it; what is
 * offered instead is the relation it exists to permit. Enumerated-vs-enumerated only: a measured
 * subset has no members to compare, which is the same asymmetry P-CLAIM rests on.
 */
export function enumeratedSubsetOf(inner: Portion, outer: Portion): boolean {
  if (inner.shipment.id !== outer.shipment.id) return false
  const innerItems = itemsOf(inner)
  const outerItems = itemsOf(outer)
  if (innerItems === undefined || outerItems === undefined) return false
  return innerItems.every((item) => outerItems.includes(item))
}

/** The enumerated members, where the Portion has any that are stated as item refs. */
export function itemsOf(portion: Portion): readonly ItemId[] | undefined {
  const enumeration = portion.enumeration
  if (enumeration === undefined) return undefined
  return 'items' in enumeration ? enumeration.items : undefined
}

/**
 * [SD §5.4] the item-vs-Portion test, as one question.
 *
 * > "If the fact has a value _per article_, its subject is the `item` and no Portion is minted. If
 * > the fact is an act on the shipment and the question is _which part of the shipment the act
 * > reached_, the answer is a `Portion` — **even a Portion of one item** — named in
 * > `reasons[].appliesTo`. The two are not alternatives and neither is a shorthand for the other."
 *
 * The test: "does this fact have a different value for each article, or does it have one value and
 * a scope?" Per-article condition, an article's inventory number, an article's declared value are
 * `item`-subject assertions. "Delivered, two items short" is one value and a scope — and the
 * scope "needs its own identity precisely because a later act will have to refer back to _the same
 * two_ when they surface in SIT a week later."
 */
export type FactGrain = 'item' | 'portion'

export function grainFor(hasAValuePerArticle: boolean): FactGrain {
  return hasAValuePerArticle ? 'item' : 'portion'
}

/**
 * [SD §3.1] "A Portion is itself asserted ([SD §4]) — it is a claim about which goods form a
 * subset, by a party, at a time, and two parties can disagree about it."
 *
 * TODO([SD §4.7.1]): **no declared `type` carries a Portion's membership.** [SD §1.3] makes
 * [SD §4.7.1] the complete declaration and it has no membership fact class, so under
 * **E-TYPE** the assertion [SD §3.1] requires has no legal `type` — the same defect
 * [SD §4.7.2e] found for the order lifecycle and fixed by minting three members. Recorded here
 * rather than minted: minting a vocabulary member is [SD §4.7]'s to do, "and no other document
 * may declare a family."
 */
export const PORTION_MEMBERSHIP_FACT_CLASS = owed(
  'portionMembership',
  '[SD §4.7.1] — a Portion is asserted, and no declared type carries the assertion',
)
