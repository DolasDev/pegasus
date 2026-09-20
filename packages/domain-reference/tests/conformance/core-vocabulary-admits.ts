/**
 * Conformance — the shapes the core vocabulary must ADMIT.
 *
 * A type-level suite: it asserts nothing at runtime and is checked by `tsc` alone. It exists
 * because the negative suite next door is only meaningful if the legal cases still compile — a
 * type that refuses everything refuses nothing in particular.
 *
 * Each case is one record the binding documents work through in prose.
 */
import {
  eventId,
  specVersion,
  subjectRef,
  shipmentId,
  stopId,
  partyId,
  portionId,
  itemId,
  instant,
  type CapturedAssertion,
  type Portion,
  reasonCode,
  roleClass,
  REASON_CODE_OTHER,
  admitSubject,
  factRefOf,
  isLegalMembershipTransition,
  canSupportClaim,
} from '../../src/index'

const S = subjectRef('shipment', shipmentId('S1'))
const T = subjectRef('stop', stopId('T2'))

// an ACTUAL delivery, partially completed, two reasons, one naming a portion
const delivery: CapturedAssertion<'delivery'> = {
  eventId: eventId('e1'),
  type: 'delivery',
  specVersion: specVersion('1'),
  subject: S,
  assertedBy: { party: partyId('p1'), role: 'destinationAgent' },
  assertedAt: instant('2026-03-01T10:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [T],
  basis: 'ACTUAL',
  value: {
    occurredAt: instant('2026-03-01T09:00:00Z'),
    outcome: 'PARTIALLY_COMPLETED',
    reasons: [
      {
        code: reasonCode('SHORT'),
        scope: 'GOODS',
        attribution: { roleClass: roleClass('unknown') },
        appliesTo: [subjectRef('portion', portionId('P2'))],
      },
      {
        code: REASON_CODE_OTHER,
        scope: 'SITE',
        attribution: { roleClass: roleClass('carrier') },
        remark: 'elevator out of service',
      },
    ],
  },
}
void factRefOf(delivery)

// a PLANNED arrival on a stop: no outcome anywhere
const arrival: CapturedAssertion<'arrival'> = {
  eventId: eventId('e2'),
  type: 'arrival',
  specVersion: specVersion('1'),
  subject: T,
  assertedBy: { party: partyId('p2'), role: 'driver' },
  assertedAt: instant('2026-03-01T08:00:00Z'),
  capturedBy: 'DEVICE_GEOFENCE',
  basis: 'PLANNED',
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void arrival

// an ESTIMATED arrival must carry asOf
const eta: CapturedAssertion<'arrival'> = {
  eventId: eventId('e3'),
  type: 'arrival',
  specVersion: specVersion('1'),
  subject: T,
  assertedBy: { party: partyId('p2'), role: 'driver' },
  assertedAt: instant('2026-03-01T08:00:00Z'),
  capturedBy: 'DERIVED_BY_RULE',
  basis: 'ESTIMATED',
  asOf: instant('2026-03-01T08:00:00Z'),
  value: { at: instant('2026-03-01T09:30:00Z') },
}
void eta

const p: Portion = {
  portionId: portionId('P2'),
  shipment: S,
  basis: reasonCode('SHORT'),
  membership: 'ENUMERATED',
  enumeration: { items: [itemId('i1'), itemId('i2')] },
}
void canSupportClaim(p)
void isLegalMembershipTransition('MEASURED', 'BOTH')
void admitSubject('arrival', S)
