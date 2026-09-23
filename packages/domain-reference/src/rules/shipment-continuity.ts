/**
 * `shipmentContinuity(cause)` — rule **B-ONWARD** — [A2 §3.2].
 *
 * > "**Onward movement of the same goods after an interruption continues the same shipment unless a
 * > new _undertaking_ was made over them.** A new transport document is the **record** a new
 * > undertaking leaves in a lane that issues one; it is never the thing that makes the undertaking
 * > new." — [A2 §3.2]
 *
 * This is **not** a projection and is deliberately not shaped like one. {@link custodyAt} and
 * {@link orderStageAt} fold over published assertions; this rule cannot, and the reason is
 * [A2 §1]'s structural finding: **the `shipment` aggregate has no record of its own coming into
 * existence.** [SD §4.7.1]'s act rows are performed on the goods, or on the plan, a binding or the
 * commitment, and every goods-side one presupposes a shipment that already exists. [`fork-order` §3.2.3]'s stage 1 names three real grade-A minting acts — `src:sirva-ade`'s
 * `Register`, `src:milmove-mymove`'s submission, the RMC's award of a service order — and none of
 * them has a `type`.
 *
 * So the rule takes the **cause** as an input rather than deriving it, and the honest consequence
 * is carried in the return type rather than in a comment: a cause the corpus does not name returns
 * `COMMITMENT_NOT_PUBLISHED`, which is the model reporting its own hole at the one place a consumer
 * would meet it. [A2 §3.6] records `shipmentCommitment` as absent and owed, and [A2 §Cross-area]
 * shows it is the fourth thing waiting on one [A8 §4.3] `boundBy` member.
 *
 * **Written over named causes rather than over a party's identity on purpose** ([A2 §4]): the day
 * `shipmentCommitment` lands, this rule reads it instead of being replaced.
 */

import { assertNever } from '../primitives'

/**
 * The interruptions the corpus names, and nothing else.
 *
 * Four of the five are `src:dtr-part-iv`'s — the trichotomy its own analysis calls "worth adopting
 * wholesale" (A-402 §E; `dtr_definitions.pdf` #255, #596, #702), plus the split at a transshipment
 * point (#662) — and the fifth is the boundary [A5 §3.4(c)] closed. The enum is closed because
 * [A2 §3.2] decides each member individually and by citation; a sixth cause is not a default, it is
 * a new decision, and {@link shipmentContinuity} says so by returning undetermined for it.
 */
export const ONWARD_MOVEMENTS = [
  /**
   * A change of destination while in transit. `src:dtr-part-iv` #255: the shipment "keeps its
   * identity **and its BL**"; only the destination changes, rates recompute as origin to Diversion
   * Point plus Diversion Point to the new destination, and a Diversion Certificate evidences it.
   *
   * The source states the verdict and the reason in one sentence, which is why [A2 §7] scores this
   * branch **high**. Note the limit `src:dtr-part-iv` #255 states and `src:dp3-400ng` Item 28.4.d
   * corroborates: diversion **excludes shipments already in destination SIT**, for which the route
   * is {@link ONWARD_MOVEMENTS} `RESHIPMENT_AFTER_TERMINATION`.
   */
  'DIVERSION',
  /**
   * A shipment separated at a transshipment point into increments — `src:dtr-part-iv` #662,
   * A-402 §D.5.b(4), "each identified and documented separately"; `src:dp3-400ng` Item 17.9's
   * **Split Shipment**, "a shipment where only a portion is stored in transit enroute, or where
   * overflow property is delivered to the storage location on different dates".
   *
   * One shipment, N Portions ([SD §3]) and N stays — one SIT control number per increment
   * ([SD §7.4]). [A2 §3.2] gives three independent reasons: both definitions are grammatically
   * singular; what the increments are documented separately **by** is a weight ticket and a SIT
   * control number rather than a bill of lading; and `src:dp3-400ng` Item 17.9.b.2 applies the
   * 1,000-lb minimum to the **combined** weight of the separately-rated portions.
   *
   * This is the corpus's hardest split case and it is positive evidence for [SD §3]'s
   * **P-IDENTITY** rather than a strain on it — which is also [A2 §3.5]'s answer to [SD §11].
   */
  'SPLIT_AT_TRANSSHIPMENT',
  /**
   * Goods leaving storage-in-transit and continuing to their destination.
   *
   * `src:dtr-part-iv` #676 defines SIT as storage "incident to a line-haul movement", "cumulative
   * and may accrue at origin, in transit, at destination, or any combination thereof" — and the
   * analysis's gloss is the operative half: "the BL is still alive and the TSP is still liable".
   * The undertaking never ended, so neither did the shipment. [A5 §3.4] settles the stay side of
   * the same event and [SD §8.4] / [SD §8.2] give the delivery-out day its home.
   */
  'DELIVERY_OUT_OF_STORAGE',
  /**
   * A terminated shipment moving onward — `src:dtr-part-iv` §E.4(4)(c), #596 — **on a new bill of
   * lading**.
   *
   * The one member that mints a second shipment, and the argument is a definition plus a citation
   * rather than a rule about documents. `src:dtr-part-iv` #81 defines a bill of lading as "a
   * contract between the shipper and the TSP whereby the TSP agrees to furnish transportation
   * services"; a new such contract over the same goods **is** a new agreement to furnish
   * transportation over them, which is a new undertaking by [`fork-order` §3.1]'s own definition.
   * **[SYNTHESIS]** — two sentences of one grade-A source, joined mechanically.
   *
   * Consistent on the termination side: §D.5.c(2) and `src:dp3-400ng` Item 17-2.2 make the
   * warehouse "the final destination of the shipment" and end the carrier's liability, and the
   * original bill of lading "cannot be revived or reinstated".
   *
   * **Not claimed:** that a new order is awarded. Whether DPS issues a fresh offer and award is not
   * in the corpus, and the same source scores `reship` among its **order-lifecycle** transitions.
   * [A2 §7] holds this branch at **medium-high** for that reason.
   */
  'RESHIPMENT_AFTER_TERMINATION',
  /**
   * Conversion to non-temporary or permanent storage. [A5 §3.4(c)] ruled that this is the edge of
   * the model rather than a flag inside it: `src:cfr-49-375` §375.609(b) makes it a dated event
   * that ends carrier liability and places the goods in the shipper's name, `src:dp3-400ng`
   * Item 27.3 makes NTS "a separate program" whose facility is the final destination with further
   * movement "under separate BL/invoice", and `src:weichert-supplier-api` makes LTS its own order
   * type. A bailment with a new bailor is a new bailment, and v1 does not carry it.
   */
  'CONVERSION_TO_PERMANENT_STORAGE',
] as const

export type OnwardMovement = (typeof ONWARD_MOVEMENTS)[number]

/**
 * Why the rule declined to answer.
 *
 * Diagnostic only, and on the same terms {@link OrderStageUnknownReason} is: naming the cases keeps
 * "the model has no answer" apart from "the answer is that nothing changed". Neither member carries
 * a candidate verdict, and [SD §0] forbids filling one in.
 */
export const SHIPMENT_CONTINUITY_UNDETERMINED_REASONS = [
  /**
   * The interruption is not one the corpus names, so whether a new undertaking was made cannot be
   * read off anything published.
   *
   * **This is [A2 §1]'s structural finding in its executable form.** The rule's discriminant is the
   * commitment, and the commitment has no `type` — so even for the members of
   * {@link ONWARD_MOVEMENTS} the verdict below is the corpus's answer for a **named** cause and not
   * a computation over records. A consumer holding the whole catalog cannot tell a reshipment from
   * a delivery-out, because neither the termination nor the new undertaking is an assertion.
   * [A2 §3.6] carries `shipmentCommitment` in `ABSENT_AND_OWED` so the gap is queryable.
   */
  'COMMITMENT_NOT_PUBLISHED',
  /**
   * The goods crossed into non-temporary or permanent storage, which [A5 §3.4(c)] ruled is a
   * different bailment under a different contract. There is no verdict because there is no
   * successor **in this model** to have one about — the question is well-formed and its answer is
   * out of scope, which is not the same as unknown.
   */
  'LEAVES_THE_MODEL',
] as const

export type ShipmentContinuityUndeterminedReason =
  (typeof SHIPMENT_CONTINUITY_UNDETERMINED_REASONS)[number]

/** The two determinate verdicts — [A2 §3.2]'s table. */
export const SHIPMENT_CONTINUITY_VERDICTS = [
  /**
   * The undertaking is unchanged, so the shipment is unchanged — [A2 §3.2(a)-(b)].
   *
   * Three of the five named causes land here and each is stated by `src:dtr-part-iv` directly: a
   * diversion "keeps its identity **and its BL**" (#255); goods in storage-in-transit are under
   * storage "incident to a line-haul movement" where "the BL is still alive" (#676); and a split at
   * a transshipment point is documented by a weight ticket and a SIT control number rather than by
   * a new bill of lading (#662). The split case is the one [SD §3]'s **P-IDENTITY** most needed and
   * least had: `src:dp3-400ng` Item 17.9.b.2 applies the 1,000-lb minimum to the **combined**
   * weight of the separately-rated portions, which is a rating rule treating the parts as one.
   */
  'SAME_SHIPMENT',
  /**
   * A new undertaking was made over the same goods, so a second shipment exists — [A2 §3.2(c)].
   *
   * One named cause reaches it. `src:dtr-part-iv` §E.4(4)(c) moves a terminated shipment onward
   * **on a new bill of lading**, and #81 defines a bill of lading as "a contract between the
   * shipper and the TSP whereby the TSP agrees to furnish transportation services" — so a new one
   * is a new agreement to furnish transportation over those goods, which is a new undertaking by
   * [`fork-order` §3.1]'s definition. **[SYNTHESIS]**, from two sentences of one grade-A source.
   *
   * This verdict **says** a second shipment exists; it does not mint one, name one or link the two.
   * Correlation between them is an `identity` assertion under [SD §7] and **I-KEY**, which is A9's.
   */
  'SECOND_SHIPMENT',
] as const

export type ShipmentContinuityVerdict = (typeof SHIPMENT_CONTINUITY_VERDICTS)[number]

/**
 * What {@link shipmentContinuity} answers.
 *
 * A `SECOND_SHIPMENT` verdict says a second shipment exists; it does **not** mint one, name one or
 * link the two. Correlation between them is an `identity` assertion under [SD §7] and **I-KEY**,
 * which is A9's mechanism and needs nothing from here.
 */
export type ShipmentContinuity =
  | { readonly kind: 'determined'; readonly verdict: ShipmentContinuityVerdict }
  | {
      readonly kind: 'undetermined'
      readonly reason: ShipmentContinuityUndeterminedReason
    }

/**
 * The verdict per named cause — [A2 §3.2]'s table, as data so that the table and the function
 * cannot disagree.
 *
 * `CONVERSION_TO_PERMANENT_STORAGE` maps to a reason rather than to a verdict, which is why this
 * table is keyed to the union of both and why {@link OnwardMovementVerdictsAreTotal} below is worth
 * having.
 */
const VERDICT_BY_CAUSE: {
  readonly [Cause in OnwardMovement]:
    ShipmentContinuityVerdict | ShipmentContinuityUndeterminedReason
} = {
  DIVERSION: 'SAME_SHIPMENT',
  SPLIT_AT_TRANSSHIPMENT: 'SAME_SHIPMENT',
  DELIVERY_OUT_OF_STORAGE: 'SAME_SHIPMENT',
  RESHIPMENT_AFTER_TERMINATION: 'SECOND_SHIPMENT',
  CONVERSION_TO_PERMANENT_STORAGE: 'LEAVES_THE_MODEL',
}

/**
 * **The gate is the mapped type above, and there is deliberately no `Exact` beside it.**
 *
 * [A5 §9] established that `export type X = Exact<A, B>` is a comment until something is assigned
 * to it, because a bare alias evaluating to `never` reports nothing. This module found the next
 * case along, and it is worth recording because the assignment does **not** repair it: an
 * `Exact<keyof typeof VERDICT_BY_CAUSE, OnwardMovement>` is a **tautology**. `VERDICT_BY_CAUSE` is
 * declared as a mapped type over `OnwardMovement`, so its `keyof` **is** `OnwardMovement` by
 * construction, and no edit to either can make the two differ. Assigned or not, it can never fail.
 *
 * Both tampers were run against the mapped type instead, and both were caught by `tsc`:
 *
 * - **a sixth member of {@link ONWARD_MOVEMENTS} with no row** — `TS2741: Property … is missing`;
 * - **a row for a member {@link ONWARD_MOVEMENTS} no longer carries** — `TS2353: Object literal may
 *   only specify known properties`.
 *
 * A decorative assertion beside a gate that already bites is worse than nothing: it invites the next
 * reader to believe the coverage is checked twice.
 */
function isUndeterminedReason(
  value: ShipmentContinuityVerdict | ShipmentContinuityUndeterminedReason,
): value is ShipmentContinuityUndeterminedReason {
  return (SHIPMENT_CONTINUITY_UNDETERMINED_REASONS as readonly string[]).includes(value)
}

/**
 * **B-ONWARD** — [A2 §3.2]. Does onward movement of the same goods continue the same shipment?
 *
 * Answers the causes `src:dtr-part-iv` and `src:dp3-400ng` name, and returns
 * `COMMITMENT_NOT_PUBLISHED` for everything else — including every commercial lane the corpus does
 * not reach, which is most of them. That is not a gap in the rule: [A2 §3.2(d)] holds B-DOC's
 * generalisation at **medium** and [ORIGINAL] for exactly the same reason, and answering a
 * commercial re-issue here by analogy would be the unlicensed step [`fork-order` §3.2.2] withdrew.
 */
export function shipmentContinuity(cause: OnwardMovement | (string & {})): ShipmentContinuity {
  if (!(ONWARD_MOVEMENTS as readonly string[]).includes(cause)) {
    return { kind: 'undetermined', reason: 'COMMITMENT_NOT_PUBLISHED' }
  }
  const outcome = VERDICT_BY_CAUSE[cause as OnwardMovement]
  if (isUndeterminedReason(outcome)) {
    return { kind: 'undetermined', reason: outcome }
  }
  switch (outcome) {
    case 'SAME_SHIPMENT':
    case 'SECOND_SHIPMENT':
      return { kind: 'determined', verdict: outcome }
    default:
      return assertNever(outcome, 'shipmentContinuity')
  }
}

/**
 * **B-STAGE has no inputs** — [`fork-order` §5.2], read by [A2 §1] and [A2 §3.6].
 *
 * `fork-order` publishes a three-stage shipment boundary (`committed` by the minting act,
 * `evidenced` by the transport contract, `closed_uncontested` where none ever issues) and the model
 * carries no record type for the minting act, so no consumer can compute which stage a shipment is
 * at. Declared here as a value rather than left as prose because [A2 §8] scenario 6 asserts it, and
 * a scenario that asserts a gap needs something to assert against.
 */
export const SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE = true
