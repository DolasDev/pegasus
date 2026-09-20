/**
 * The one published record vocabulary, and the canonical-subject table — [SD §1.3], [SD §4.7].
 *
 * > "`type` and `factClass` are not two axes. They are one, and `factClass` is the name for what
 * > it holds on an Assertion. `factClass` subsumes `type`… There is no `factRef.factClass` field
 * > and no `factRef.subject` field." — [SD §1.3]
 *
 * > "Every `type` in the published record vocabulary declares, in one place, its canonical subject
 * > family, its `qualifier` shape, and what belongs in `context[]`. This table is that
 * > declaration… It is the shared layer's, and it outranks any per-document restatement."
 * > — [SD §4.7]
 *
 * [SD §1.3] makes [SD §4.7.1] the **complete** declaration, which is why the table below is
 * `satisfies`-checked against the vocabulary: a type with no row, or a row with no type, is a
 * compile error rather than a record nobody can publish ([SD §4.7.2e] records exactly that defect
 * happening to the order lifecycle).
 */

import type { RoleName, SubjectRef } from './envelope'
import type { AggregateKind } from './ids'
import { AGGREGATE_KINDS } from './ids'
import type { IdentityQualifier } from './identity'
import type { Exact } from './primitives'
import type { OutcomeFreeTypeName } from './outcomes'

/**
 * The **act** types — [SD §4.7.1]'s last row: "Every act is its own `type` — the seven goods-side
 * act rows above (`packing`, `loading`, `unloading`, `delivery`, `handover`, `storeIn`,
 * `storeOut`) and the twelve plan-, binding- and commitment-side act rows".
 *
 * `arrival` and `departure` are deliberately absent: "they are time facts about a _visit_, which
 * is why their family is `stop` and why M5 lets a geofence assert them while M2/M3 forbid a
 * geofence asserting any act in this row."
 */
export const ACT_TYPES = [
  // Goods-side (seven) — [SD §4.7.1].
  /**
   * The act of packing the goods — [SD §4.7.1], prose alias _pack performance_, family `goods`.
   * Possession-changing under [SD §5.2] M2, so it needs a human or partner asserter. Its authority
   * row is **owed** ([A8 §9 item 8] names packing performance among the uncovered classes).
   */
  'packing',
  /**
   * The act of loading the goods onto the vehicle — [SD §4.7.1], prose alias _load performance_,
   * family `goods`. Possession-changing under [SD §5.2] M2; [A8 §5] row 3 makes the `loadAgent`
   * authoritative, or the `originAgent` where no separate load agent is assigned.
   */
  'loading',
  /**
   * The act of unloading the goods — [SD §4.7.1], prose alias _unload performance_, family `goods`.
   * Possession-changing under [SD §5.2] M2; [A8 §5] row 4 mirrors row 3 onto the `unloadAgent`, and
   * [A8 §5] marks the mirroring itself **[ORIGINAL]**.
   */
  'unloading',
  /**
   * The act of delivering the goods — [SD §4.7.1], prose alias _delivery performance_, family
   * `goods`. An **attempted** delivery is not a type of its own: it is `delivery` with
   * `outcome = NOT_COMPLETED` and at least one reason ([A3 §3.2], [SD §2.5] A-TYPE, worked at
   * [SD §2.6]). "Delivered, two items short" is one `delivery` at `PARTIALLY_COMPLETED` with a
   * Portion in `reasons[].appliesTo` ([SD §3.4]).
   */
  'delivery',
  /**
   * The act of handing the goods over — [SD §4.7.1], prose alias _custody handoff_, family `goods`.
   *
   * [A3 §3.2] rules `transfer-out` and `transfer-in` "**one `handover` type, asserted once by each
   * side** … not two types" — the `J1` / `R1` shape of `src:stedi-x12-reference` element 1650 — and
   * [SD §4.7.2f] gives it the qualifier `{releasing, receiving, side, occurrence?}`, so the two
   * sides of one transfer are two facts on two keys. It is the only act carrying `custodyBasis`,
   * and therefore the only act **A8-MOVE** can move authority at.
   */
  'handover',
  /**
   * _The act of placing goods into storage_ — [SD §4.7.1], family `stay`. Distinct from
   * `sitEntryDate`, and the separation is forced rather than convenient: [SD §5.3] shows M2
   * demanding a human for the act while M4 demands a derivation for the date, "and a single fact
   * class cannot satisfy both".
   */
  'storeIn',
  /**
   * _SIT release / handling-out_ — [SD §4.7.1], family `stay`. Possession-changing under
   * [SD §5.2] M2; [A8 §5] row 8 makes the `sitAgent` authoritative, because the warehouse is the
   * party of record for what happened inside it.
   */
  'storeOut',
  // The trip-scoped class — [SD §4.7.1], subjects quoted from [A3 §3.2].
  /**
   * _"The trip was delayed"_ — [SD §4.7.1]'s trip-scoped class, family `trip` (singleton), subject
   * quoted from [A3 §3.2]. It declares no qualifier: a trip delayed twice "is one party revising
   * its own assertion", so successive changes ride `supersedes` ([SD §4.7.2d] item 3).
   */
  'tripDelay',
  /**
   * _"The trip was resequenced"_ — [SD §4.7.1], family `trip`. A3 makes resequencing its own record
   * type rather than a renumbering, so a stop's identity is never its sequence number ([A3 §3.2]).
   */
  'tripResequence',
  /**
   * _"The trip was cancelled"_ — [SD §4.7.1], family `trip`. Note **A-TYPE** ([SD §2.5]): the type
   * names the act of cancelling a trip; it does not encode the `CANCELLED` outcome of some other
   * act.
   */
  'tripCancellation',
  // A3 §5.8's shipment-on-trip membership lifecycle.
  /**
   * A shipment is **offered** a place on a trip — [A3 §5.8]'s shipment-on-trip membership
   * lifecycle as carried by [SD §4.7.1], family `stopAction` (singleton). The membership is an
   * entity with its own identity, so two memberships are two `stopAction`s rather than one
   * contested fact ([SD §4.7.2d] item 3).
   */
  'membershipOffer',
  /**
   * The offer is **accepted or declined** — [A3 §5.8] via [SD §4.7.1], family `stopAction`. The
   * outcome rides `(outcome, reason)` on the act ([SD §2]); the type names neither answer.
   */
  'membershipResponse',
  /**
   * The membership is **broken** — [A3 §5.8] via [SD §4.7.1], family `stopAction`.
   */
  'membershipRelease',
  // The resource-assignment lifecycle.
  /**
   * A resource is **offered** an assignment — [SD §4.7.1]'s assignment lifecycle, family
   * `assignment` (singleton).
   *
   * Note what this is **not**: [A8 §4.3]'s `ASSIGNMENT` binding, which governs facts _about_ a
   * resource. These three are facts about the **binding itself** ([SD §4.7.1]'s own warning).
   */
  'assignmentOffer',
  /**
   * The assignment is **accepted or declined** — [SD §4.7.1], family `assignment`. The two-status
   * shape is `src:atlas-world-group-api`'s structural observation (accepted vs performed), taken as
   * structure only ([A3 §3.2], C2=1).
   */
  'assignmentResponse',
  /**
   * The resource is **released** from the assignment — [SD §4.7.1], family `assignment`. An
   * `Assignment` has an effective interval, so a driver change is expressed here and not by
   * rewriting a field ([A3 §3.2], [A3 §6.1]).
   */
  'assignmentRelease',
  // The order lifecycle — [SD §4.7.2e], required by [SD §1] and [fork-order §3.1].
  /**
   * The order is **awarded** — [SD §4.7.1], family `order` (singleton). Minted at [SD §4.7.2e]
   * because [SD §1] and [fork-order §3.1] require the lifecycle and the table had declared no
   * member for it: "a binding document… specifying a record that could not be published".
   */
  'orderAward',
  /**
   * The award is **accepted or declined** — [SD §4.7.1], family `order`, minted at [SD §4.7.2e].
   */
  'orderResponse',
  /**
   * The order is **cancelled** — [SD §4.7.1], family `order`, minted at [SD §4.7.2e]. Which party
   * ended it is "the distinction `src:dcsa` spends three status values on", and the authority row
   * for it is owed.
   */
  'orderCancellation',
] as const

export type ActType = (typeof ACT_TYPES)[number]

/**
 * Every fact class that is not an act — [SD §1.3] item 1's list, minus the acts.
 *
 * [SD §1.3] closes the gap "that left `type` undefined for weight, identity and condition… by
 * naming those classes in the same vocabulary as the acts, not by adding an axis."
 */
export const NON_ACT_TYPES = [
  /**
   * When the vehicle **arrived** — a time fact about a _visit_, not an act. [SD §4.7.1]: "they are
   * time facts about a visit, which is why their family is `stop` and why M5 lets a geofence assert
   * them while M2/M3 forbid a geofence asserting any act in this row." Prose alias _time.arrival_;
   * family `stop` = {stop, externallyPerformedLeg}. An ETA is this type at `basis = ESTIMATED`
   * ([SD §4.5]).
   */
  'arrival',
  /**
   * When the vehicle **departed** — as `arrival` ([SD §4.7.1]), family `stop`. [A8 §5] row 2's note
   * records the precondition that makes the row computable: `src:dp3-tender-of-service` §B.3.f
   * requires the provider actually hauling to be named within 2 GBD of origin departure.
   */
  'departure',
  /**
   * The consignment's **net** weight — `src:x12-212-trailer-manifest` element 187's `N`, "actual
   * net" ([SD §4.1]), family `goods`. The one fact class the binding layer settles by a **value
   * rule** rather than by a role: [A8 §5] row 6 is `boundBy = NONE` and `R-WEIGHT-LOWER`
   * ([SD §4.4]) picks the lower of two ACTUAL weights from distinct weighings.
   */
  'weight.net',
  /**
   * The consignment's **gross** weight — element 187's `G` ([SD §4.1]), family `goods`. Its
   * authority row is **owed**, and [SD §4.7.1] marks its `boundBy` _unassigned_ rather than owed:
   * `R-WEIGHT-LOWER` is scoped to `weight.net` and does not reach here ([SD §4.4]).
   */
  'weight.gross',
  /**
   * The **tare** weight — element 187's `T` ([SD §4.1]) — and it is **the consignment's**, never
   * the equipment's: `src:nmfta-ebol`'s "weight of the skids/pallets/slips used in the shipment"
   * ([SD §4.7.2c]). Family `goods`. The equipment's own tare is a `resource`-subject fact, a
   * different type, left absent and owed at [SD §4.7.3].
   */
  'weight.tare',
  /**
   * How many pieces — family `goods`, with the qualifier `{unitization}` ([SD §4.7.2a]):
   * `src:x12-212-trailer-manifest` `AT8-04` non-unitized and `AT8-05` unitized are "two separate
   * counts that sum to one total". **Sourced:** that they are separate and additive.
   * **[ORIGINAL]:** one type with a qualifier rather than two types.
   *
   * Its authority is **borrowed and only half of it**: at a custody boundary **A8-JOINT** reaches
   * "`condition` and the counts asserted with it" ([A8 §7.3]); away from one it is owed.
   */
  'pieceCount',
  /**
   * _A **date**: when storage starts counting_ — [SD §5.3], family `stay`. Never the `storeIn` act
   * and never the arrival date: 400NG Item 29.6 / 17.20 forbid substituting one for the other.
   * Mandatorily `DERIVED_BY_RULE` under [SD §5.2] M4 from the TSP's first available delivery date,
   * carrying `{ruleId, ruleVersion}` and the `eventId`s of its inputs. [A8 §5] row 7 is the row
   * where the authoritative role is genuinely **nobody**.
   */
  'sitEntryDate',
  /**
   * A party's assertion about the condition of one article — family `item`, because [SD §5.4] makes
   * a value _per article_ an `item`-subject fact. The best-sourced row in [A8 §5] (row 9) and the
   * foundation of **A8-JOINT**: at a custody boundary both the releasing and the receiving role are
   * authoritative, and on disagreement `FactResolved` publishes both and selects neither.
   */
  'condition',
  /**
   * An identifier, asserted — [SD §7]. Its subject may be **any** aggregate kind ([SD §7.1]), and
   * its qualifier is `{scheme, vocabularyScope}`, which is **I-KEY**. `primary` is not a stored
   * flag but the output of `FactResolved` over that key ([SD §7.5]). [A8 §5] row 10 binds authority
   * to the scheme's **issuer**, where it never moves.
   */
  'identity',
  /**
   * A money fact about one charge — family `charge`, with the qualifier `{aspect}` ∈ `PROPOSED` |
   * `DECIDED` | `RATED` ([SD §4.7.2b]), which **corrects [A8 §5] row 11**: without it the fact key
   * "would put a _proposal_, an _approval_ and a _price_ into **one** contest, where an approval
   * would compete with an amount". Its `value` shape is owed to A11 ([SD §4.7.3]), and financial
   * facts are corrected only by an offsetting record ([SD §6.3]).
   */
  'charge',
  /**
   * A notification, asserted. **Provisional throughout** ([SD §4.7.3]): "no source fixes a subject
   * for either" of `notification` and `partyRole`. The family `goods` is **[ORIGINAL]**, on the
   * ground that `src:dp3-tender-of-service` §C.3.c states the notification duty per shipment.
   *
   * And it is known to be incomplete: **the recipient has no field.** [A8 §9 item 6] owes "the
   * party as a notification target", and [SD §6.5]'s obligations cannot name a contactable party
   * until it lands.
   */
  'notification',
  /**
   * Who holds a role, over what interval — family `partyRole`, "the role-holding itself is an
   * aggregate" ([SD §4.7.3]). It is a dated, versioned assertion rather than a static field
   * ([A8 §3(b)], **A8-HISTORY**): "you cannot ask 'who was authoritative on 3 March' of a roster
   * that has since been rewritten."
   *
   * **Provisional** ([SD §4.7.3]), and its own row records a defect: §4.7.3 says the `context[]`
   * carries "the party", and a party is deliberately not an aggregate kind, so it cannot be a
   * `SubjectRef` until [A8 §9 item 1] lands.
   */
  'partyRole',
] as const

export type NonActType = (typeof NON_ACT_TYPES)[number]

/** Every `type` an Assertion may carry. On an Assertion this value **is** the fact class. */
export const ASSERTION_TYPES = [...ACT_TYPES, ...NON_ACT_TYPES] as const

export type AssertionType = ActType | NonActType

/**
 * [SD §1.3] item 1: "one member per **meta-record class** — `FactResolved` ([SD §4.3]) and
 * `Correction` ([SD §6])".
 *
 * [SD §1.3] item 4: "On a meta-record, `type` names the record class and the fact key is carried
 * explicitly… In both cases the envelope `subject` MUST equal the subject of the fact being
 * resolved or corrected."
 */
export const META_RECORD_TYPES = ['FactResolved', 'Correction'] as const

export type MetaRecordType = (typeof META_RECORD_TYPES)[number]

/** The one published record vocabulary. E-TYPE ([SD §1.3]) admits nothing outside it. */
export type RecordType = AssertionType | MetaRecordType

export const RECORD_TYPES = [...ASSERTION_TYPES, ...META_RECORD_TYPES] as const

export function isAssertionType(candidate: string): candidate is AssertionType {
  return (ASSERTION_TYPES as readonly string[]).includes(candidate)
}

export function isActType(candidate: string): candidate is ActType {
  return (ACT_TYPES as readonly string[]).includes(candidate)
}

/**
 * **Rule A-TYPE conformance** — [SD §2.5]. No member of the vocabulary may encode an outcome.
 *
 * If a future member were spelled `Delivery.Completed`, `OutcomeFreeTypeName` would drop it from
 * the union and this assignment would stop compiling. It is the whole enforcement: the vocabulary
 * is closed, so a name that cannot exist here cannot be carried by any record.
 */
type ATypeHolds = [RecordType] extends [OutcomeFreeTypeName<RecordType>] ? true : never
const _aTypeHolds: ATypeHolds = true
void _aTypeHolds

/**
 * Canonical subject **families** — [SD §4.7] note 2 and [SD §1.3] item 5.
 *
 * > "a family is a named, closed set of `aggregate` kinds — usually a singleton."
 *
 * Three are not singletons, and each is argued where it is declared:
 * - `stop = {stop, externallyPerformedLeg}` — [SD §8.2], "which is what lets an arrival be
 *   asserted about a leg performed by someone whose journey we cannot see";
 * - `goods = {shipment, portion}` — [SD §3.3], "which is what lets a separately-timed act name a
 *   Portion directly". The family and its name are **[ORIGINAL]** ([SD §4.7] note 2);
 * - `identity`'s family is the **whole `aggregate` enum** — [SD §7.1]: "`subject` may be **any**
 *   aggregate kind".
 *
 * DECISION: [SD §4.7] describes the third as "the whole `aggregate` enum" without naming it.
 * `anyAggregate` is this module's spelling, chosen so the family column can stay a single named
 * key like the other ten. The membership is quoted, not chosen.
 */
export const SUBJECT_FAMILIES = {
  stop: ['stop', 'externallyPerformedLeg'],
  goods: ['shipment', 'portion'],
  stay: ['stay'],
  item: ['item'],
  charge: ['charge'],
  trip: ['trip'],
  stopAction: ['stopAction'],
  assignment: ['assignment'],
  order: ['order'],
  partyRole: ['partyRole'],
  anyAggregate: AGGREGATE_KINDS,
} as const satisfies Record<string, readonly AggregateKind[]>

export type SubjectFamilyName = keyof typeof SUBJECT_FAMILIES

/** The aggregate kinds one family admits. */
export type FamilyMembers<F extends SubjectFamilyName> = (typeof SUBJECT_FAMILIES)[F][number]

/**
 * [SD §4.7.1] — **the table**, as the type→family column alone.
 *
 * `satisfies` against a mapped type over `AssertionType` is what makes the table itself
 * type-check: a vocabulary member with no row does not compile. That is the mechanism [SD §1.3]'s
 * "§4.7.1 is the complete declaration" needs, and it is the check [SD §4.7.2e] wished it had had —
 * the order lifecycle was "a binding document… specifying a record that could not be published".
 *
 * The table's other three columns are not here:
 * - `qualifier` is {@link QualifierByType}, below, because it is a shape rather than a value;
 * - `context[]` is advisory and non-authoritative ([SD §1.4]); encoding it as a constraint would
 *   make a non-authoritative field enforceable, which is the opposite of what it is for;
 * - the authority / `boundBy` column "is [A8]'s, quoted, not re-derived" ([SD §4.7] note 3) and
 *   is **owed** for twelve of the rows ([A8 §9 item 8]).
 *   TODO(authority module): carry [A8 §5]'s role table and `boundBy`, with the owed rows marked
 *   owed and barred from scoring ([SD §4.7] note 3, [SD §11]).
 */
export const CANONICAL_SUBJECT_FAMILY = {
  // Time facts about a visit — not acts ([SD §4.7.1] last row).
  arrival: 'stop',
  departure: 'stop',
  // Goods-side acts.
  packing: 'goods',
  loading: 'goods',
  unloading: 'goods',
  delivery: 'goods',
  // [SD §4.7.2f]: the F1 decision does **not** move this row. Candidate (d) — making the juncture
  // the subject — is rejected at the decision's §4(d): an `externallyPerformedLeg` is a span and
  // carries both sides of a transfer, one transfer is two `stopAction`s on two trips, and the
  // receiving interline hauler cannot name our `stopAction` at all. "A `handover` is a fact about
  // the goods and stays in this family — the juncture is not its subject." What changed is the
  // `qualifier` ({@link QualifierByType}), not the family.
  handover: 'goods',
  // Measures and counts about the goods.
  'weight.net': 'goods',
  'weight.gross': 'goods',
  // [SD §4.7.2c] the **consignment's** tare, never the equipment's: `src:nmfta-ebol`'s "weight of
  // the skids/pallets/slips used in the shipment". The equipment's own tare is a
  // `resource`-subject fact and therefore a different `type`, which [SD §4.7.3] leaves owed.
  'weight.tare': 'goods',
  pieceCount: 'goods',
  // The storage stay.
  storeIn: 'stay',
  sitEntryDate: 'stay',
  storeOut: 'stay',
  // [SD §5.4] a value **per article** is an `item`-subject fact; a scope of an act is a Portion.
  condition: 'item',
  identity: 'anyAggregate',
  charge: 'charge',
  // [SD §4.7.3] provisional: "no source fixes a subject for either".
  notification: 'goods',
  partyRole: 'partyRole',
  // The nine aggregate-lifecycle members; subjects quoted from [A3 §3.2] ([SD §4.7.2d]).
  tripDelay: 'trip',
  tripResequence: 'trip',
  tripCancellation: 'trip',
  membershipOffer: 'stopAction',
  membershipResponse: 'stopAction',
  membershipRelease: 'stopAction',
  assignmentOffer: 'assignment',
  assignmentResponse: 'assignment',
  assignmentRelease: 'assignment',
  // [SD §4.7.2e] minted rather than deferred, because [SD §1] and [fork-order §3.1] require them.
  orderAward: 'order',
  orderResponse: 'order',
  orderCancellation: 'order',
} as const satisfies { readonly [T in AssertionType]: SubjectFamilyName }

/** The family one `type` declares. */
export type CanonicalFamily<T extends AssertionType> = (typeof CANONICAL_SUBJECT_FAMILY)[T]

/**
 * The aggregate kinds a `type` may be asserted about — **E-CANON** ([SD §4.3]) at compile time.
 *
 * `Assertion<'arrival'>`'s subject is `stop | externallyPerformedLeg` and nothing else, so the
 * destination agent's shipment-phrased arrival ([SD §4.6.3]) does not typecheck — which is the
 * structural half of E-CANON-STRICT.
 */
export type CanonicalSubjectKind<T extends AssertionType> = FamilyMembers<CanonicalFamily<T>>

/**
 * [SD §4.7.2f] `handover`'s `side` — **the two halves of a transfer are two facts, not two sides
 * of one.**
 *
 * The decision's §2 settles it against the one sentence that reads the other way
 * ([SD §4.8.3]'s "the selected handover's receiving side") on five grounds, of which two are
 * decisive: [SD §4.8.3] rule 3 returns `UNKNOWN` "across a cross-dock dwell where **only one of the
 * two handovers** has been published", which is underivable if a lone release were a contest of one
 * that `FactResolved` would select; and `src:stedi-x12-reference` element 1650 publishes the halves
 * as **two codes** — `J1` Delivered to Connecting Line, `R1` Received from Prior Carrier — which the
 * stedi analysis calls "two complementary assertions by two different [parties]", while [SD §4.3]'s
 * machinery pairs **competing** assertions and has no winner to pick between complementary ones.
 *
 * **Sourced:** that the halves are separately reported, by separate parties.
 * **[ORIGINAL]:** that they are one `type` with a qualifier rather than two `type`s — which is
 * forced, because [A3 §3.2] rules them "**one `handover` type, asserted once by each side** … not
 * two types" and [SD §4.7.2a]'s `pieceCount` is the published precedent for the remedy.
 */
export const HANDOVER_SIDES = ['RELEASE', 'RECEIPT'] as const

export type HandoverSide = (typeof HANDOVER_SIDES)[number]

/**
 * [SD §4.7.2f] **Rule H-OCCUR** — the `occurrence` component, **[ORIGINAL]**:
 *
 * > "`occurrence` counts, from 1, the transfers of **this subject** in which **this ordered role
 * > pair** stood in these positions, on **this side**. It is absent — meaning 1 — unless a party is
 * > asserting the second or later such transfer. A party computes it from its own dealings with its
 * > own counterparty over this shipment, **never from the catalog's resolved history**."
 *
 * That last clause is the whole of the difference from the rejected candidate (c), a
 * custody-transfer sequence number: an ordinal over *all* transfers would require the receiving
 * agent to know about transfers it was not party to, which `src:sirva-ade`'s own analysis makes
 * concrete — "an agent cannot see the trip" ([A3 §3.3]) — and would be circular besides, because a
 * global ordinal counts *selected* handovers while selection runs per fact key.
 *
 * Optional, and absent **means** 1: {@link HANDOVER_FIRST_OCCURRENCE}. The fact key normalises the
 * two spellings onto one ({@link factRefOf}'s key form), so an omitted `occurrence` and an explicit
 * `1` pair rather than splitting one contest in two.
 *
 * Foreclosure 8 of the decision: **the platform may never derive it.** It is asserted or absent.
 */
export const HANDOVER_FIRST_OCCURRENCE = 1

/**
 * [SD §4.7.2f]'s qualifier for `handover`, so the fact key is
 * `(goods, handover, {releasing, receiving, side, occurrence?})`.
 *
 * Each component is checked against **Q-KEY** ([SD §4.7.2f], **[ORIGINAL]**): a qualifier component
 * must be (i) a vocabulary member and not a reference to an aggregate, (ii) computable by every
 * party entitled to assert the fact, from what that party holds at assertion time, and (iii) not
 * itself a value under contest for that fact.
 *
 * - `releasing` / `receiving` are **members of the published role vocabulary** ([A8 §2]) and not
 *   `partyRole` **references**. That distinction is the decision, not a detail: a `partyRole` is an
 *   aggregate with a fact class of its own ([SD §1.2], [SD §4.7.3]), so a qualifier carrying two of
 *   those refs is exactly the second-subject-in-the-payload violation [SD §4.7.2d(3)] refuses —
 *   whose refusal **stands**. A `RoleName` is a vocabulary member exactly as `identity`'s `scheme`
 *   is, and both parties can compute it: `R1` *names* the counterparty's position ("Received from
 *   **Prior Carrier**"), and `src:dp3-tender-of-service` §B.3.f makes the party actually hauling a
 *   nameable legal party within 2 GBD. **[SYNTHESIS]** — `src:open-trip-model`'s `HandOver` carries
 *   `from`/`to` actor refs and 1650's codes name the counterparty; rendering the two ends as key
 *   components is the join.
 * - `side` — §2's verdict. See {@link HANDOVER_SIDES}.
 * - `occurrence` — R5 only. See {@link HANDOVER_FIRST_OCCURRENCE} and H-OCCUR.
 *
 * Note what is **not** here, permanently: `occurredAt`. It fails Q-KEY(iii) — it *is* the contested
 * value, [SD §4.2]'s three-clock apparatus exists because parties disagree about it, and keying on
 * it would make a handover time the one act time in the model that can be neither contested nor
 * corrected (`supersedes` is constrained to the same fact key, so correcting the time would change
 * the key). Foreclosure 4: no future revision may reach for `{occurredAt}` to separate two
 * transfers between the same pair. `occurrence` is that seat and it is taken.
 */
export interface HandoverQualifier {
  /** A member of [A8 §2]'s published role vocabulary — the position, not the party. */
  readonly releasing: RoleName
  /** Idem. Who *actually* released and received is `value`'s, and is contestable there. */
  readonly receiving: RoleName
  readonly side: HandoverSide
  /** 1-based, OPTIONAL; absent means {@link HANDOVER_FIRST_OCCURRENCE}. H-OCCUR. */
  readonly occurrence?: number
}

/**
 * H-OCCUR's domain, checked: "integer ≥ 1", and absent is legal.
 *
 * A value rather than a branded type because the number is **asserted by a party**, never minted
 * here (foreclosure 8), so the check belongs at the boundary and not in a constructor this package
 * would have to own.
 */
export function handoverOccurrenceIsWellFormed(qualifier: HandoverQualifier): boolean {
  const occurrence = qualifier.occurrence
  if (occurrence === undefined) return true
  return Number.isInteger(occurrence) && occurrence >= HANDOVER_FIRST_OCCURRENCE
}

/**
 * Qualifier shapes — [SD §1.3] item 3: "`qualifier` exists for the types where one fact class
 * legitimately covers several independently-contested facts about one subject."
 *
 * Exactly four types declare one, and each is argued at [SD §4.7.2]. A type that declares none
 * has none, "and its fact key is `(subject, type)`."
 */
export interface QualifierByType {
  /** [SD §7.1] I-KEY. The worked case: "identifier arity and `primary` both key on
   * `(subject, scheme, vocabularyScope)` — that is not a special rule for identifiers, it is the
   * general key with `identity`'s declared qualifier substituted in" ([SD §1.3]). */
  identity: IdentityQualifier
  /** [SD §4.7.2a] `src:x12-212-trailer-manifest` `AT8-04` non-unitized and `AT8-05` unitized are
   * "two separate counts that sum to one total". **Sourced:** that they are separate and additive.
   * **[ORIGINAL]:** one `type` with a qualifier rather than two `type`s — "two types would put the
   * sum in a consumer's head." */
  pieceCount: { readonly unitization: 'UNITIZED' | 'NON_UNITIZED' }
  /** [SD §4.7.2b] and it **corrects [A8 §5 row 11]**: without the qualifier the fact key "would
   * put a _proposal_, an _approval_ and a _price_ into **one** contest, where an approval would
   * compete with an amount." */
  charge: { readonly aspect: 'PROPOSED' | 'DECIDED' | 'RATED' }
  /** [SD §4.7.2f], and it is what closes **F1**: with no qualifier every handover about one
   * shipment keyed to `(shipment, handover)`, [SD §4.3] selected one winner per key, and custody
   * could never change hands twice — so [SD §4.8.3]'s `until` was unreachable and an ordinary
   * interstate move was unpublishable. Under it, origin agent → hauler → destination agent is four
   * keys, two custody spans and two boundaries. See {@link HandoverQualifier}. */
  handover: HandoverQualifier
}

/** The qualifier a type declares, or `never` where it declares none. */
export type QualifierOf<T extends AssertionType> = T extends keyof QualifierByType
  ? QualifierByType[T]
  : never

/**
 * [SD §1.3] item 3: "**The fact key is derived, not stored.** `factRef` is **not a field**."
 *
 * ```
 * factRef = ( subject , type , qualifier? )
 * ```
 *
 * It is computed from fields the record already carries. It appears as an explicit field on
 * `FactResolved` "**here and only here**" ([SD §4.3]), because a meta-record's own `type` names
 * its record class rather than the fact it is about.
 */
export type FactRef<T extends AssertionType = AssertionType> = T extends AssertionType
  ? T extends keyof QualifierByType
    ? {
        readonly subject: SubjectRef<CanonicalSubjectKind<T>>
        readonly type: T
        readonly qualifier: QualifierByType[T]
      }
    : {
        readonly subject: SubjectRef<CanonicalSubjectKind<T>>
        readonly type: T
        readonly qualifier?: never
      }
  : never

/**
 * The fact-class families of [SD §4.1] — "each with published examples and a source that treats
 * the class as contested".
 *
 * They are not a second classification axis ([SD §1.1] forbids one): they are a grouping **over**
 * the one axis, used by the documents to argue that "weights, piece counts, conditions and
 * statuses DO have a competing-assertion story, and it is the same one times have" ([SD §4]).
 */
export const FACT_CLASS_FAMILIES = [
  /**
   * Times — arrival, departure, SIT entry date, actual delivery date. The contest is real because
   * `src:dp3-400ng` names **five** distinct delivery-date roles (requested at award / first
   * available / scheduled / actual / RDD) with different charges attached ([SD §4.1]).
   */
  'time',
  /**
   * Measures — net / gross / tare weight, cube. The contest is real because
   * `src:x12-212-trailer-manifest` element 187 types every weight: `G` gross, `N` actual net,
   * `T` tare, `E` estimated net, `B` billed ([SD §4.1]).
   */
  'measure',
  /**
   * Counts — cartons, handling units. The contest is real because `src:x12-212-trailer-manifest`
   * splits `AT8-04` non-unitized from `AT8-05` unitized: "two separate counts that sum to one
   * total" ([SD §4.1]).
   */
  'count',
  /**
   * Condition — per-article condition at receipt and at forwarding, `src:dp3-400ng` Item 17.12.c
   * and `src:cfr-49-375` §375.503 ([SD §4.1]).
   */
  'condition',
  /**
   * _A party's claim about a lifecycle state_ ([SD §4.1]) — SIRVA's dispatch lifecycle against
   * Weichert's procurement lifecycle, "two parties, two state assertions about one shipment,
   * neither derived from the other".
   *
   * **The family has no publishable member.** [SD §4.7.1] declares no `type` for it: the lifecycle
   * members are acts, and [SD §4.7.2d] is explicit that `in-transit` "is **not a record at all**:
   * it is a projection". Recorded as a finding at {@link FACT_CLASS_FAMILY} rather than repaired
   * here, because [SD §4.7] is the only place a family may be declared.
   */
  'state',
  /** Identifiers — BOL number, registration, SCAC, trip number. [SD §4.1] defers to [SD §7]. */
  'identity',
  /**
   * Who holds a role — "who is the hauling agent". The contest is real because `src:dp3-400ng`
   * Item 7.1 requires the origin representative to be named in DPS at acceptance and **updated** to
   * the one who will actually service the shipment ([SD §4.1]).
   */
  'partyRole',
  /**
   * The performance of an act — [SD §4.1] defers to [SD §2], which puts `(outcome, reason)` on
   * every act.
   *
   * **A record may never carry `type = actPerformance`** ([SD §4.7.1]): a type naming a family
   * rather than an act would be the outcome-free second axis A-TYPE exists to prevent, and
   * `outcome` would have nothing to attach to. Held structurally by
   * {@link ActPerformanceIsNotARecordType}.
   */
  'actPerformance',
] as const

export type FactClassFamily = (typeof FACT_CLASS_FAMILIES)[number]

/**
 * [SYNTHESIS] of [SD §4.1]'s family table and [SD §4.7.1]'s type declaration. The families and
 * their examples are [SD §4.1]'s; the per-type assignment is the mechanical join, and the two
 * rows the join cannot make are marked `'owed'` rather than guessed.
 *
 * Two findings fall out of writing it, and both are reported rather than papered over:
 *
 * 1. **`state` has no member.** [SD §4.1] declares a `state` family — "a party's claim about a
 *    lifecycle state", with SIRVA's dispatch lifecycle and Weichert's procurement lifecycle as
 *    the worked case, "two parties, two state assertions about one shipment, neither derived from
 *    the other" — and [SD §4.7.1] declares no `type` for it. The lifecycle members it might look
 *    like are acts, not states, and [SD §4.7.2d] is explicit that `in-transit` "is **not a record
 *    at all**: it is a projection". So a declared family has no publishable member.
 *    TODO([SD §4.7.3] / A1): either mint a state fact class or record `state` as absent and owed
 *    on the same terms as `weighing` and `unpacking`.
 * 2. **`charge` and `notification` have no family.** Neither is in [SD §4.1]'s list; `charge` is a
 *    money fact and `notification` is provisional throughout ([SD §4.7.3]).
 */
export const FACT_CLASS_FAMILY = {
  arrival: 'time',
  departure: 'time',
  sitEntryDate: 'time',
  'weight.net': 'measure',
  'weight.gross': 'measure',
  'weight.tare': 'measure',
  pieceCount: 'count',
  condition: 'condition',
  identity: 'identity',
  partyRole: 'partyRole',
  charge: 'owed',
  notification: 'owed',
  packing: 'actPerformance',
  loading: 'actPerformance',
  unloading: 'actPerformance',
  delivery: 'actPerformance',
  handover: 'actPerformance',
  storeIn: 'actPerformance',
  storeOut: 'actPerformance',
  tripDelay: 'actPerformance',
  tripResequence: 'actPerformance',
  tripCancellation: 'actPerformance',
  membershipOffer: 'actPerformance',
  membershipResponse: 'actPerformance',
  membershipRelease: 'actPerformance',
  assignmentOffer: 'actPerformance',
  assignmentResponse: 'actPerformance',
  assignmentRelease: 'actPerformance',
  orderAward: 'actPerformance',
  orderResponse: 'actPerformance',
  orderCancellation: 'actPerformance',
} as const satisfies { readonly [T in AssertionType]: FactClassFamily | 'owed' }

/**
 * [SD §4.7.1] "**A record may never carry `type = actPerformance`**; a type that names a family
 * rather than an act would be the outcome-free second axis A-TYPE exists to prevent, and
 * `outcome` would have nothing to attach to."
 *
 * Held structurally: `actPerformance` is a family name and not a member of the record vocabulary,
 * so it cannot reach an envelope's `type` field. (Three other family names — `condition`,
 * `identity`, `partyRole` — deliberately *do* coincide with a `type`, because in those three
 * cases the family has exactly one member and the two names denote the same thing.)
 */
export type ActPerformanceIsNotARecordType =
  Extract<'actPerformance', RecordType> extends never ? true : never
const _actPerformanceIsNotARecordType: ActPerformanceIsNotARecordType = true
void _actPerformanceIsNotARecordType

/** Every act type is in the act-performance family, and nothing else is. */
type ActFamilyIsExactlyTheActs = Exact<
  {
    [T in AssertionType]: (typeof FACT_CLASS_FAMILY)[T] extends 'actPerformance' ? T : never
  }[AssertionType],
  ActType
>
const _actFamilyIsExactlyTheActs: ActFamilyIsExactlyTheActs = true
void _actFamilyIsExactlyTheActs

/**
 * **Rule E-CANON-STRICT** — [SD §4.6.2]. "The admission check is purely structural: is
 * `subject.aggregate` a member of the family declared for `type` at this `specVersion`? If not,
 * the record is **not admitted to the catalog**. It acquires no `eventId`, is filed under no fact
 * key, and enters no contest. The boundary performs no substitution, no nearest-match and no
 * best-guess."
 */
export type Admission<T extends AssertionType> =
  | {
      readonly admitted: true
      readonly type: T
      readonly subject: SubjectRef<CanonicalSubjectKind<T>>
    }
  | {
      readonly admitted: false
      readonly type: T
      readonly named: AggregateKind
      readonly declaredFamily: CanonicalFamily<T>
      readonly members: readonly AggregateKind[]
    }

export function admitSubject<T extends AssertionType>(type: T, subject: SubjectRef): Admission<T> {
  const family = CANONICAL_SUBJECT_FAMILY[type] as CanonicalFamily<T>
  const members: readonly AggregateKind[] = SUBJECT_FAMILIES[family as SubjectFamilyName]
  if (members.includes(subject.aggregate)) {
    return {
      admitted: true,
      type,
      subject: subject as SubjectRef<CanonicalSubjectKind<T>>,
    }
  }
  // [SD §4.6.2] E-CANON-OBLIGATION: a rejection "is not a silence" — the inbound message, the rule
  // attempted, the candidate set and the refusal are retained outside the catalog and emit a
  // notification obligation to the asserting party.
  // TODO(ingest): E-CANON-RESOLVE (the named, versioned subject-resolution rule that must return
  // exactly one candidate) and the retained-rejection ledger sit *before* this boundary and are
  // not catalog records. They belong to an ingest module, not to the vocabulary.
  return { admitted: false, type, named: subject.aggregate, declaredFamily: family, members }
}

/**
 * Whether a family admits more than one aggregate kind. Three do ([SD §4.7] note 2); the rest are
 * singletons, and a fourth non-singleton would be a decision, not a detail.
 */
export function isSingletonFamily(family: SubjectFamilyName): boolean {
  return SUBJECT_FAMILIES[family].length === 1
}

/**
 * Prose aliases the documents use that **must not appear in a record** — [SD §4.7] note 5.
 *
 * "The spellings in the first column are the vocabulary; the rest are prose aliases." Held here so
 * a reader who finds `time.arrival` or `delivery-performance` in [A3] or [fork-time] can map it.
 */
export const PROSE_ALIASES = {
  'time.arrival': 'arrival',
  'time.departure': 'departure',
  'delivery-performance': 'delivery',
  'load performance': 'loading',
  'unload performance': 'unloading',
  'pack performance': 'packing',
  'custody handoff': 'handover',
  'SIT entry date': 'sitEntryDate',
  'SIT release': 'storeOut',
} as const satisfies Record<string, AssertionType>

/**
 * Fact classes named in the corpus and deliberately **absent** from the vocabulary — [SD §4.7.3],
 * "so their absence is not read as an oversight".
 *
 * Each "needs a row [in §4.7.1] **and** an A8 row before its area can score a dependent decision
 * high". `custody` is absent for a different reason and is listed separately below.
 */
export const ABSENT_AND_OWED = [
  'cube',
  'survey',
  'estimate',
  'eta',
  'sealIntegrity',
  'tracerResult',
  'claim',
  /** [SD §4.7.2c] the equipment's own tare — a `resource`-subject fact needing its own type. */
  'resourceTareWeight',
  /** [SD §4.7.3] "`weighing`'s canonical family cannot be read off the corpus": §375.509(a)(1)-(2)
   * performs the act on a **vehicle** to yield a fact about the **goods**. "No source settles it,
   * and a declaration table does not settle it by preference." */
  'weighing',
  /** [SD §4.7.3] deferred alongside `weighing` "for that reason and for no evidentiary one — **its
   * family is not in doubt**", because [SD §10.1] item 20 already directs A3 to record it as
   * absent, and "minting `unpacking` here while `A3` is told to record it as absent would put the
   * two halves of one decision in contradiction." */
  'unpacking',
] as const

export type AbsentAndOwedClass = (typeof ABSENT_AND_OWED)[number]

/**
 * [SD §4.7.3] "**And one that is absent because it is not a fact class at all: `custody`.**
 * `fork-time` §8.8 asserts 'a `custody` fact over the interval with `subject = shipment:S`'. There
 * is no such `type` and there will not be one."
 *
 * [SD §4.8]: Custody is "a projection — a named, versioned fold over the `handover` assertions
 * selected by `FactResolved`… and over `ExternallyPerformedLeg.custodyBasis`. It is never stored,
 * never asserted and never corrected." `boundBy = CUSTODY` names **that fold**.
 *
 * Held in the types by absence: `'custody'` is not in {@link RECORD_TYPES} and not in
 * `AGGREGATE_KINDS`, so it can be neither a `type` nor a `subject`.
 *
 * TODO(projections): `custodyAt(goods, instant)` ([SD §4.8.3]) is a fold over published records
 * and belongs to a projections module.
 */
export type CustodyIsNotAFactClass = Extract<RecordType, 'custody'> extends never ? true : never
const _custodyIsNotAFactClass: CustodyIsNotAFactClass = true
void _custodyIsNotAFactClass
