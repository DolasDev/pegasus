/**
 * Identity of the aggregates — [SD §1.2].
 *
 * The `aggregate` enum is "a **versioned closed enum**, open to _addition_ in a later
 * `specVersion`, never to reinterpretation" [SD §1.2]. Fourteen members: eleven the critique
 * requires, plus `resource`, `document` and `externallyPerformedLeg`, each argued at [SD §1.2].
 *
 * Ids are branded per kind, so a shipment id is not assignable to a stop id. That is not
 * decoration: [SD §1.1] forbids a subject _path_ and forbids a second subject, which leaves the
 * (aggregate, id) pair as the only way a record says what it is about — and a pair whose halves
 * can drift is not a reference.
 */

import type { Brand } from './primitives'

/**
 * [SD §1.2]. Order matters to nothing; membership matters to everything.
 *
 * `custody` is deliberately NOT a member: "its absence is a decision rather than an omission"
 * [SD §1.2, §4.8] — Custody is a projection folded from `handover` assertions, never an aggregate.
 */
export const AGGREGATE_KINDS = [
  /**
   * One commitment, to one performing party, to perform a named set of services — carrying the
   * commercial terms and its own award / accept / decline / cancel lifecycle
   * ([fork-order §3.1], adopted at [SD §4.7.2e]). One order carries one **or more** shipments;
   * N may be 1, and may be 0.
   */
  'order',
  /**
   * _The set of goods committed to move under one transport undertaking_ ([fork-order §3.1]) —
   * [A3 §3.2] states the same grain as "the goods of one customer moving under one bill of lading
   * (or the counterparty's single equivalent), with an identity that survives every vehicle, every
   * re-plan and every custody change".
   *
   * [SD §1.2]: **a shipment is not privileged.** It is one member of this enum, and an
   * order-scoped, trip-scoped, assignment-scoped or charge-scoped record carries no shipment at all.
   */
  'shipment',
  /**
   * _A named subset of one shipment's goods, with its own identity, whose membership is stated
   * either by enumeration over items or by measure, and which is minted by the first act that
   * applies to less than the whole shipment_ — [SD §3]. A Portion never spans shipments and never
   * changes the shipment boundary (**P-IDENTITY**, [SD §3.2]).
   */
  'portion',
  /**
   * One storage occupancy — _"stay (a SIT occupancy)"_, [SD §7.4]. It has its own identity, and the
   * industry already publishes one: `src:dtr-part-iv`'s **SIT control number**, 9 digits of `YY` +
   * Julian day of entry + a sequence within that day, with a split shipment getting one per
   * increment. Origin-side and destination-side SIT are therefore two stays — the defect the grain
   * prevents, since `src:sirva-ade` has no SIT identifier and "cannot say which one".
   */
  'stay',
  /**
   * _One vehicle journey performed by an assigned resource set: an ordered sequence of stops, from
   * the moment the plan is committed to the moment the last stop is completed_ — [A3 §3.2]. A trip
   * carries **no goods**; it carries stops, assignments and a status, and it is the unit of
   * dispatch and cost, never of revenue. A day of service at one place with no linehaul is a trip
   * with one stop ([A3 §3.2], binding from [SD §8.4]).
   */
  'trip',
  /**
   * _A visit to one place, at one position in one trip's sequence_ — [A3 §3.2] as corrected at
   * [SD §8.1], which struck "one identified vehicle": **the vehicle and crew are `Assignment`s on
   * the trip, not part of the stop's identity.** Two stops at the same place on one trip are two
   * stops, and a stop's identity is never its sequence number.
   */
  'stop',
  /**
   * The join. _One act performed on one shipment (or on one `Portion` of it) at one stop_ —
   * [A3 §3.2] — naming exactly one shipment-or-portion and exactly one stop. The membership is "an
   * entity with its own identity, not a foreign key" (`src:x12-212-trailer-manifest`'s loop 0200),
   * and it carries **no quantity and no result**.
   */
  'stopAction',
  /**
   * _A dated, typed binding of a resource to a trip, which is itself an asserted fact_ — [A3 §3.2].
   * Not a foreign key: it has an effective interval, which is how a driver change is expressed, and
   * it must name a legal party with an identifier (`src:dp3-tender-of-service` §B.3.f).
   */
  'assignment',
  /**
   * The **role-holding** itself — [SD §4.7.3], "the role-holding itself is an aggregate (§1.2)".
   * [SD §1.1] puts the role on the assertion rather than on the party, and [A8 §3(a)] makes role
   * "an attribute of the _assignment_, never of the party".
   *
   * Note that `party` is a **separate** member below, and the two are not interchangeable:
   * [A9 §3.6] item 2 rules out filing an identifier against the role-holding, because a SCAC
   * "belongs to the company whatever it is doing on this shipment".
   */
  'partyRole',
  /**
   * One article. [SD §3]: "`item` remains a subject kind for facts genuinely about one article",
   * and [SD §5.4] supplies the test — "does this fact have a different value for each article, or
   * does it have one value and a scope?" A per-article condition is an `item`-subject fact; the
   * scope of an act is a `portion`.
   */
  'item',
  /**
   * One charge — the thing a money fact is about. [SD §1.2] admits it so that a **charge-scoped**
   * record is "a first-class record with no shipment on it at all", and [SD §4.7.2b] splits the
   * fact about it into three aspects (propose / decide / rate).
   *
   * **[ORIGINAL]** as a gloss: no document in the binding layer defines the aggregate's own
   * internals, and [SD §4.7.3] leaves the charge `value` owed — to **A7 / A12** since [A7 §6],
   * which found the previous owner (A11) is a claims area and re-pointed it.
   *
   * **There is no `invoice` and no `payment` beside it**, and [A7 §3.2] records that as a decision:
   * seven publishers group charges into an invoice and no two group the same things, two of them
   * across shipments. So no act on a charge has a record, and the blocker is here rather than in
   * the record vocabulary.
   */
  'charge',
  /**
   * _A vehicle, trailer, driver or crew member_ — [SD §1.2], added because [A3]'s `Assignment`
   * binds a resource to a trip and an equipment identifier must attach to the equipment
   * (`src:x12-212-trailer-manifest` `MS2`: owner SCAC + owner-assigned number + check digit,
   * "equipment identity is owner-scoped").
   */
  'resource',
  /**
   * A weight ticket, the bill of lading, the inventory — things that are "asserted about and
   * evidenced against" ([SD §1.2]), with 400NG Item 4.10 making a weight ticket a six-field record
   * with its own retention rules. **[ORIGINAL]** as an envelope decision; A6 may narrow it, never
   * remove it.
   */
  'document',
  /**
   * _A named party's undertaking to move goods between two places, where we cannot see the vehicle,
   * the trip or the stop sequence_ — [SD §8.2], quoted verbatim at [A3 §3.2]. Not a phantom trip:
   * "we are not modelling a journey we cannot see. We are modelling **a named party's undertaking
   * to move goods between two places**." **[ORIGINAL]**: the aggregate itself, and the rule that
   * origin and destination derive over legs as well as stops.
   */
  'externallyPerformedLeg',
  /**
   * A party — a company or a person that asserts facts, holds roles and is identified by schemes
   * whose authority is somebody else. Minted at [A8 §9 item 1], whose first sentence is the reason:
   * _"Until it lands, `assertedBy.partyRef` has no target schema."_
   *
   * **A bare subject, deliberately: no fact class of its own and no fields.** [A9 §3.6] is the
   * second and independent reason to mint it — five of its twenty witnessed schemes identify a
   * party, so "an assertion under any of them has no `subject`", and `scac` is the best-witnessed
   * row in the whole table. Those identifiers are **not** fields a party record would carry; each
   * is an `identity` assertion _about_ the party, and [SD §7.1] already admits one — "`subject` may
   * be **any** aggregate kind" — so this member is the entire mechanism and no record type is
   * needed.
   *
   * **What it does NOT settle**, because the measurement said so rather than the scope:
   * the party's **name** and the **branch grain** stay owed to [A8 §9 item 3] — `src:sirva-ade`'s
   * `Resource` is `{Id, Name, Type, Owner}` whose `Id` "can contain agent, vendor, driver or
   * equipment code based on the resource `Type`", so its `Name` names a company, a person or a
   * tractor, and a party must be defined before it can be named. The **hierarchy**
   * (`src:atlas-world-group-api`'s `parentAgentCode`) is a party-to-party relation no fact class
   * holds.
   *
   * **Not `partyRole`, and that was decided elsewhere.** [A9 §3.6] item 2: a SCAC "belongs to the
   * company whatever it is doing on this shipment", so filing it against the role-holding "would
   * key it on a tuple it does not vary with".
   */
  'party',
] as const

export type AggregateKind = (typeof AGGREGATE_KINDS)[number]

/** The id type for one aggregate kind. Distinct per kind by construction. */
export type AggregateId<K extends AggregateKind> = Brand<string, `id:${K}`>

export type OrderId = AggregateId<'order'>
export type ShipmentId = AggregateId<'shipment'>
export type PortionId = AggregateId<'portion'>
export type StayId = AggregateId<'stay'>
export type TripId = AggregateId<'trip'>
export type StopId = AggregateId<'stop'>
export type StopActionId = AggregateId<'stopAction'>
export type AssignmentId = AggregateId<'assignment'>
export type PartyRoleId = AggregateId<'partyRole'>
export type ItemId = AggregateId<'item'>
export type ChargeId = AggregateId<'charge'>
export type ResourceId = AggregateId<'resource'>
export type DocumentId = AggregateId<'document'>
export type ExternallyPerformedLegId = AggregateId<'externallyPerformedLeg'>

/**
 * A reference to a party, as it appears inside a record — [SD §1.1] `assertedBy`, [SD §2.4]
 * `attribution.party`, [SD §7.1] `issuer` and `vocabularyScope.authority`.
 *
 * **`party` IS an aggregate kind now** ([A8 §9 item 1], this release), so the sentence this
 * docstring used to carry — that the party is "an identifier with no aggregate behind it" — is
 * discharged. The subject form is {@link AggregateId}`<'party'>`.
 *
 * **Two brands for one concept, and that is an owed item rather than an oversight.** This type is
 * branded `party` and the subject form is branded `id:party`, so both reach the wire. The decision
 * not to unify them in this release is recorded rather than assumed: **no published rule compares a
 * party-as-subject with a party-as-reference.** A8-SELF ({@link corroborationIsIndependent}) takes
 * two **references**; `FactResolved` contests run per `(subject, scheme, vocabularyScope)` and never
 * cross the two; `authorityToDeclare` compares role names. So unifying would be a change made for a
 * comparison [SD §7.1]'s issuer/authority split _invites_ and nothing _asks_ for.
 *
 * TODO([A8 §9 item 1]): the successor shape is `SubjectRef<'party'>`, because every other aggregate
 * is referenced that way and never by a bare id — `LegEndpoint.stop`, `CustodyHolder.partyRole`.
 * This brand is the fossil of there having been no party aggregate. Closing it is
 * `changedValueShape` (breaking) at six declaring sites, and it wants a rule that needs the
 * comparison first.
 */
export type PartyId = Brand<string, 'party'>

function checkRaw(kind: string, raw: string): string {
  if (raw.length === 0) {
    throw new RangeError(`empty ${kind} id`)
  }
  // [SD §1.1] "A subject _path_ (`shipment/…/stop/…`)" is forbidden permanently: "a path presumes
  // a containment hierarchy, and the hierarchy is exactly what the three documents disagree
  // about." An id carrying a separator is that path arriving one field lower down.
  if (raw.includes('/')) {
    throw new RangeError(`${kind} id must not be a path: ${JSON.stringify(raw)}`)
  }
  return raw
}

function makeId<K extends AggregateKind>(kind: K, raw: string): AggregateId<K> {
  return checkRaw(kind, raw) as AggregateId<K>
}

export const orderId = (raw: string): OrderId => makeId('order', raw)
export const shipmentId = (raw: string): ShipmentId => makeId('shipment', raw)
export const portionId = (raw: string): PortionId => makeId('portion', raw)
export const stayId = (raw: string): StayId => makeId('stay', raw)
export const tripId = (raw: string): TripId => makeId('trip', raw)
export const stopId = (raw: string): StopId => makeId('stop', raw)
export const stopActionId = (raw: string): StopActionId => makeId('stopAction', raw)
export const assignmentId = (raw: string): AssignmentId => makeId('assignment', raw)
export const partyRoleId = (raw: string): PartyRoleId => makeId('partyRole', raw)
export const itemId = (raw: string): ItemId => makeId('item', raw)
export const chargeId = (raw: string): ChargeId => makeId('charge', raw)
export const resourceId = (raw: string): ResourceId => makeId('resource', raw)
export const documentId = (raw: string): DocumentId => makeId('document', raw)
export const externallyPerformedLegId = (raw: string): ExternallyPerformedLegId =>
  makeId('externallyPerformedLeg', raw)

export const partyId = (raw: string): PartyId => checkRaw('party', raw) as PartyId

/** Kind-parameterised constructor, for code that is generic over the enum. */
export function aggregateId<K extends AggregateKind>(kind: K, raw: string): AggregateId<K> {
  return makeId(kind, raw)
}

export function isAggregateKind(candidate: string): candidate is AggregateKind {
  return (AGGREGATE_KINDS as readonly string[]).includes(candidate)
}
