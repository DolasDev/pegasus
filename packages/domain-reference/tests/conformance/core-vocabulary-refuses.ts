/**
 * Conformance — the shapes the core vocabulary must REFUSE.
 *
 * Every `@ts-expect-error` below must fire. If an illegal state ever becomes legal, TypeScript
 * reports the directive as unused and this file fails to compile, which is the check: the
 * package's claim is that "illegal states fail to compile", and this is where that claim is
 * tested rather than asserted.
 *
 * A type-level suite: nothing here runs.
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
  type QueriedAssertion,
  type Portion,
  type StopId,
  type Reason,
  reasonCode,
  roleClass,
  REASON_CODE_OTHER,
} from '../../src/index'

const S = subjectRef('shipment', shipmentId('S1'))
const T = subjectRef('stop', stopId('T2'))
const by = { party: partyId('p1'), role: 'driver' } as const
const head = {
  eventId: eventId('e'),
  specVersion: specVersion('1'),
  assertedBy: by,
  assertedAt: instant('2026-03-01T10:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
} as const

// 1. branded ids are nominal
// @ts-expect-error a shipment id is not a stop id
const x: StopId = shipmentId('S1')
void x

// 2. E-CANON: arrival's family is {stop, externallyPerformedLeg}; shipment is not in it
const a1: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  // @ts-expect-error the subject is the error: a shipment is outside arrival's declared family
  subject: S,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void a1

// 3. delivery's family is goods; a stop is not in it
const a2: CapturedAssertion<'delivery'> = {
  ...head,
  type: 'delivery',
  // @ts-expect-error the subject is the error: a stop is not a goods subject
  subject: T,
  basis: 'ACTUAL',
  value: { occurredAt: instant('2026-03-01T09:00:00Z'), outcome: 'COMPLETED' },
}
void a2

// 4. an outcome at basis = PLANNED
const a3: CapturedAssertion<'delivery'> = {
  ...head,
  type: 'delivery',
  subject: S,
  basis: 'PLANNED',
  // @ts-expect-error the value is the error: a plan carries no outcome
  value: { occurredAt: instant('2026-03-01T09:00:00Z'), outcome: 'COMPLETED' },
}
void a3

// 5. COMPLETED forbids reasons
const a4: CapturedAssertion<'delivery'> = {
  ...head,
  type: 'delivery',
  subject: S,
  basis: 'ACTUAL',
  value: {
    occurredAt: instant('2026-03-01T09:00:00Z'),
    outcome: 'COMPLETED',
    // @ts-expect-error the reasons list is the error: COMPLETED forbids one
    reasons: [
      {
        code: reasonCode('SHORT'),
        scope: 'GOODS',
        attribution: { roleClass: roleClass('carrier') },
      },
    ],
  },
}
void a4

// 6. a non-COMPLETED outcome requires at least one reason
const a5: CapturedAssertion<'delivery'> = {
  ...head,
  type: 'delivery',
  subject: S,
  basis: 'ACTUAL',
  // @ts-expect-error the value is the error: NOT_COMPLETED with no reasons at all
  value: { occurredAt: instant('2026-03-01T09:00:00Z'), outcome: 'NOT_COMPLETED' },
}
void a5

// 7. an empty reasons list is not "at least one"
const a6: CapturedAssertion<'delivery'> = {
  ...head,
  type: 'delivery',
  subject: S,
  basis: 'ACTUAL',
  // @ts-expect-error the value is the error: `reasons: []` is not a NonEmptyArray
  value: { occurredAt: instant('2026-03-01T09:00:00Z'), outcome: 'NOT_COMPLETED', reasons: [] },
}
void a6

// 8. no quantity on an act
const a7: CapturedAssertion<'loading'> = {
  ...head,
  type: 'loading',
  subject: S,
  basis: 'ACTUAL',
  // @ts-expect-error the value is the error: an act value carries no quantity
  value: { occurredAt: instant('2026-03-01T09:00:00Z'), outcome: 'COMPLETED', quantity: 3 },
}
void a7

// 9. recordedAt is FORBIDDEN on capture
const a8: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
  // @ts-expect-error the property is the error: a captured assertion has no recordedAt
  recordedAt: instant('2026-03-01T10:00:00Z'),
}
void a8

// @ts-expect-error 10. recordedAt is MANDATORY on query
const a9: QueriedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void a9

// @ts-expect-error 11. ESTIMATED requires asOf
const a10: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ESTIMATED',
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void a10

// @ts-expect-error 12. asOf is meaningless at any other basis
const a11: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  asOf: instant('2026-03-01T09:00:00Z'),
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void a11

// @ts-expect-error 13. identity declares a qualifier; omitting it is not legal
const a12: CapturedAssertion<'identity'> = {
  ...head,
  type: 'identity',
  subject: S,
  basis: 'ACTUAL',
  value: { id: 'BL-1', issuer: partyId('p9'), effectiveFrom: instant('2026-01-01T00:00:00Z') },
}
void a12

// 14. a type that declares no qualifier may not carry one
const a13: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  // @ts-expect-error the property is the error: arrival declares no qualifier, so its type is never
  qualifier: { scheme: 'x' },
  value: { at: instant('2026-03-01T09:00:00Z') },
}
void a13

// 15. the deleted correlation bag
const a14: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
  // @ts-expect-error the property is the error: the correlation bag is deleted
  correlation: { supersedes: eventId('e0') },
}
void a14

// 16. a mutable current-state field
const a15: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
  // @ts-expect-error the property is the error: state is a projection, never a stored field
  status: 'ARRIVED',
}
void a15

// 17. a second classification axis
const a16: CapturedAssertion<'arrival'> = {
  ...head,
  type: 'arrival',
  subject: T,
  basis: 'ACTUAL',
  value: { at: instant('2026-03-01T09:00:00Z') },
  // @ts-expect-error the property is the error: `type` is the only classification axis
  factClass: 'time',
}
void a16

// @ts-expect-error 18. a type outside the vocabulary (E-TYPE)
const a17: CapturedAssertion<'Delivery.Completed'> = {} as never
void a17

// @ts-expect-error 19. code = OTHER without a remark
const r1: Reason = {
  code: REASON_CODE_OTHER,
  scope: 'ACT',
  attribution: { roleClass: roleClass('carrier') },
}
void r1

// @ts-expect-error 20. a MEASURED portion may not enumerate items
const p1: Portion = {
  portionId: portionId('P1'),
  shipment: S,
  basis: reasonCode('SHORT'),
  membership: 'MEASURED',
  measure: { pieceCount: 2 },
  enumeration: { items: [itemId('i1')] },
}
void p1

// @ts-expect-error 21. an ENUMERATED portion must say what it enumerates
const p2: Portion = {
  portionId: portionId('P1'),
  shipment: S,
  basis: reasonCode('SHORT'),
  membership: 'ENUMERATED',
}
void p2

// 22. a Portion never spans shipments — it is one ref, of one kind
const p3: Portion = {
  portionId: portionId('P1'),
  // @ts-expect-error the property is the error: a Portion's shipment ref is a shipment, not a stop
  shipment: T,
  basis: reasonCode('SHORT'),
  membership: 'MEASURED',
  measure: { pieceCount: 2 },
}
void p3

// @ts-expect-error 23. a subject path is not an id
const s1 = subjectRef('stop', shipmentId('S1'))
void s1

// 24. primary is never stored on an identity value
const a18: CapturedAssertion<'identity'> = {
  ...head,
  type: 'identity',
  subject: S,
  basis: 'ACTUAL',
  qualifier: { scheme: 'x' as never, vocabularyScope: { authority: partyId('p9') } },
  value: {
    id: 'BL-1',
    issuer: partyId('p9'),
    effectiveFrom: instant('2026-01-01T00:00:00Z'),
    // @ts-expect-error the property is the error: primacy is derived, never stored on the value
    primary: true,
  },
}
void a18
