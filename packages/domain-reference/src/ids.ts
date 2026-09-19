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
  'order',
  'shipment',
  'portion',
  'stay',
  'trip',
  'stop',
  'stopAction',
  'assignment',
  'partyRole',
  'item',
  'charge',
  'resource',
  'document',
  'externallyPerformedLeg',
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
 * A party.
 *
 * **Deliberately not an aggregate kind.** [SD §1.2]'s enum has `partyRole` (the role-holding) and
 * no `party`, while [SD §1.1] `assertedBy`, [SD §2.4] `attribution.party` and [SD §7.1] `issuer`
 * all reference a party. [A8 §9 items 1-2] leave the party entity and the role enum undefined, so
 * the party is represented here as an identifier with no aggregate behind it rather than by
 * silently widening [SD §1.2]'s closed enum.
 *
 * TODO(A8 §9 item 1): when the party entity lands, decide whether it becomes a fifteenth
 * aggregate kind (an addition the enum permits) or stays outside the subject enum.
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
