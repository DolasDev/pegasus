/**
 * **Scenario 1 — a van carrying five families' goods, interleaved pickups and deliveries over four
 * days.**
 *
 * [round-2-critique] found this "expressible, but the definitions fight": A3's Trip was "one vehicle
 * journey performed by **one assigned resource set**" while its `Assignment[]` carried an effective
 * interval, so "the prose answers §6.1 'new trip'; the structure answers 'new assignment interval'."
 * [SD §10.1 item 13] settles it — "**Pick the structure, and say so**" — and [SD §1] is what makes
 * the consolidation expressible at all: five shipments are five subjects, and the trip they share is
 * `context[]`.
 *
 * What this file is testing is therefore not "can five families ride one van" but the two things
 * that make the answer non-trivial: that the five families' facts stay **five contests** ([SD §1.3]),
 * and that the one van's facts do not leak into them ([SD §1.4] rule 1).
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITY_TABLE,
  CANONICAL_SUBJECT_FAMILY,
  admitSubject,
  assignmentId,
  eventId,
  factRefOf,
  hasAuthorityRow,
  instant,
  isAbout,
  mentions,
  partyId,
  sameFactKey,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type CapturedAssertion,
  type SubjectRef,
} from '../../src/index'

const spec = specVersion('1')

/** One van, one journey. [SD §1.2]: `trip` is an aggregate kind and therefore a legal subject. */
const trip = subjectRef('trip', tripId('T-901'))

/** Five families, five shipments — five `subject`s, never one consolidated record. */
const families = {
  alvarez: subjectRef('shipment', shipmentId('S-ALVAREZ')),
  brand: subjectRef('shipment', shipmentId('S-BRAND')),
  cho: subjectRef('shipment', shipmentId('S-CHO')),
  dunne: subjectRef('shipment', shipmentId('S-DUNNE')),
  eze: subjectRef('shipment', shipmentId('S-EZE')),
} as const satisfies Record<string, SubjectRef<'shipment'>>

const onBoardAfterDayOne = [families.alvarez, families.brand, families.cho] as const

const day2Pickup = subjectRef('stop', stopId('ST-04'))
const day3Delivery = subjectRef('stop', stopId('ST-07'))

const driverJoni = { party: partyId('P-JONI'), role: 'driver' } as const
const driverRay = { party: partyId('P-RAY'), role: 'driver' } as const
const loadAgent = { party: partyId('P-ORIGIN-CO'), role: 'loadAgent' } as const
const destinationAgent = { party: partyId('P-DEST-CO'), role: 'destinationAgent' } as const
const hauler = { party: partyId('P-VANLINE'), role: 'hauler' } as const

/**
 * [SD §4.7.1] `loading` row: family `goods`, `context[]` carries `stopAction`, `stop`, `trip`. The
 * act is about the goods; the place and the journey are cross-references and nothing more.
 */
function loading(id: string, goods: SubjectRef<'shipment'>, at: string, stop: SubjectRef<'stop'>) {
  const record: CapturedAssertion<'loading'> = {
    eventId: eventId(id),
    type: 'loading',
    specVersion: spec,
    subject: goods,
    assertedBy: loadAgent,
    assertedAt: instant(at),
    capturedBy: 'KEYED_BY_PERSON',
    context: [stop, trip],
    basis: 'ACTUAL',
    value: { occurredAt: instant(at), outcome: 'COMPLETED' },
  }
  return record
}

/** Day 2: two of the five families are picked up at the same stop, one after the other. */
const loadBrand = loading('L-BRAND', families.brand, '2026-04-07T09:20:00Z', day2Pickup)
const loadCho = loading('L-CHO', families.cho, '2026-04-07T13:05:00Z', day2Pickup)

/**
 * [SD §4.7.1] `arrival` row: family `stop`, `context[]` carries the `trip` and **every `shipment` on
 * board**. One visit, one arrival — not one per family.
 */
const vanArrivesDay2: CapturedAssertion<'arrival'> = {
  eventId: eventId('A-ST04'),
  type: 'arrival',
  specVersion: spec,
  subject: day2Pickup,
  assertedBy: driverJoni,
  assertedAt: instant('2026-04-07T09:02:00Z'),
  // [SD §5.2] M5: a geofence may carry `basis = ACTUAL` for arrival at a stop.
  capturedBy: 'DEVICE_GEOFENCE',
  context: [trip, ...onBoardAfterDayOne],
  basis: 'ACTUAL',
  value: { at: instant('2026-04-07T09:01:30Z') },
}

/** Day 3, interleaved: one family is delivered in the morning, another loaded in the afternoon. */
const deliverAlvarez: CapturedAssertion<'delivery'> = {
  eventId: eventId('D-ALVAREZ'),
  type: 'delivery',
  specVersion: spec,
  subject: families.alvarez,
  assertedBy: destinationAgent,
  assertedAt: instant('2026-04-08T11:40:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [day3Delivery, trip],
  basis: 'ACTUAL',
  value: { occurredAt: instant('2026-04-08T11:30:00Z'), outcome: 'COMPLETED' },
}

const loadDunne = loading('L-DUNNE', families.dunne, '2026-04-08T16:10:00Z', day3Delivery)

describe('[SD §1.3] five families on one van are five contests, not one', () => {
  it('pairs each act on its own fact key — the interleaving fuses nothing', () => {
    // The fact key is `(subject, type, qualifier?)`, derived. Two loadings at one stop, minutes
    // apart, by one crew, on one trip: same `type`, same `context[]`, different `subject`.
    expect(sameFactKey(factRefOf(loadBrand), factRefOf(loadCho))).toBe(false)
    expect(factRefOf(loadBrand)).toEqual({ subject: families.brand, type: 'loading' })

    // …and across the four days, the day-3 delivery and the day-3 load are likewise two keys.
    expect(sameFactKey(factRefOf(deliverAlvarez), factRefOf(loadDunne))).toBe(false)
  })

  it('[SD §1.1] carries no consolidation axis — one record, one subject', () => {
    // There is no `subjects[]`, no `subjectPath` and no manifest record. A van-level claim about
    // five families would need one of those, and all three are forbidden permanently. Held in the
    // type (`ForbiddenOnEnvelope`); observable here as the absence on a real record.
    expect(loadBrand).not.toHaveProperty('subjects')
    expect(loadBrand).not.toHaveProperty('subjectPath')
    expect(loadBrand).not.toHaveProperty('status')
  })
})

describe("[SD §1.4] the van's own facts do not leak into a family's", () => {
  it('rule 1 — a consumer filtering by subject is not served context matches', () => {
    // The arrival is about the STOP. Family Cho is on board and is named in `context[]`, which is
    // "explicitly non-authoritative": no fact is asserted about Cho's shipment by this record.
    expect(isAbout(vanArrivesDay2, day2Pickup)).toBe(true)
    expect(isAbout(vanArrivesDay2, families.cho)).toBe(false)
    // The non-authoritative half is available, but only when asked for by name.
    expect(mentions(vanArrivesDay2, families.cho)).toBe(true)
    expect(mentions(vanArrivesDay2, families.dunne)).toBe(false)

    // [SD §11] records this as the one risk in §1: "if `context[]` leaks into subject-filtered reads
    // by default, the shipment-rooted envelope returns through the query layer."
  })

  it('[SD §1.3] the fact key never reads context[], so the five do not contest the arrival', () => {
    // Every shipment on board rides in `context[]`; none of them appears in the derived key.
    expect(factRefOf(vanArrivesDay2)).toEqual({ subject: day2Pickup, type: 'arrival' })
  })

  it('[SD §4.6.2] and a family-phrased arrival is not admitted at all', () => {
    // The temptation on a consolidated van is "shipment S arrived". `arrival`'s declared family is
    // `stop = {stop, externallyPerformedLeg}`, so E-CANON-STRICT refuses it — it is not re-keyed
    // onto one of the five candidate stops. [SD §4.6.3] works the two-candidate case in full.
    const refused = admitSubject('arrival', families.cho)
    expect(refused.admitted).toBe(false)
    if (refused.admitted) return
    expect(refused.named).toBe('shipment')
    expect(refused.members).toEqual(['stop', 'externallyPerformedLeg'])
  })
})

describe('[SD §10.1 item 13] a driver change on day 3 is an Assignment interval, not a new trip', () => {
  /**
   * "The prose says a driver change is a new trip, the structure says a new `Assignment` interval.
   * **Pick the structure, and say so.**" So the day-3 relay publishes two `assignment`-subject acts
   * and no second trip — which is also what keeps the four days one journey for the three families
   * still on board.
   */
  const joniReleased: CapturedAssertion<'assignmentRelease'> = {
    eventId: eventId('AR-JONI'),
    type: 'assignmentRelease',
    specVersion: spec,
    subject: subjectRef('assignment', assignmentId('ASG-JONI')),
    assertedBy: hauler,
    assertedAt: instant('2026-04-08T18:00:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    context: [trip],
    basis: 'ACTUAL',
    value: { occurredAt: instant('2026-04-08T17:55:00Z'), outcome: 'COMPLETED' },
  }

  const rayAccepted: CapturedAssertion<'assignmentResponse'> = {
    eventId: eventId('AS-RAY'),
    type: 'assignmentResponse',
    specVersion: spec,
    subject: subjectRef('assignment', assignmentId('ASG-RAY')),
    assertedBy: driverRay,
    assertedAt: instant('2026-04-08T18:04:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    context: [trip],
    basis: 'ACTUAL',
    value: { occurredAt: instant('2026-04-08T18:03:00Z'), outcome: 'COMPLETED' },
  }

  it('keeps one trip across the relay', () => {
    // Both assignment records name the SAME trip in `context[]`. Nothing mints a second trip, and
    // the shipments on board never change their membership because a driver went home.
    expect(joniReleased.context).toEqual([trip])
    expect(rayAccepted.context).toEqual([trip])
    // Two assignments, one journey — the structure A3 already had.
    expect(joniReleased.subject.id).not.toBe(rayAccepted.subject.id)
    expect(CANONICAL_SUBJECT_FAMILY.assignmentRelease).toBe('assignment')
  })

  it('and both drivers keep their own arrivals — [A8 §7.4] A8-AFTER, by way of the envelope', () => {
    // Joni's day-2 arrival is not touched by Ray taking over on day 3. There is no current-driver
    // field to overwrite ([SD §1.1] forbids one), so nothing can be lost by the relay.
    expect(vanArrivesDay2.assertedBy).toEqual(driverJoni)
  })
})

describe('[SD §4.7.1] a resequence on day 4 is a fact about the trip — and its authority is owed', () => {
  const resequence: CapturedAssertion<'tripResequence'> = {
    eventId: eventId('TR-901-1'),
    type: 'tripResequence',
    specVersion: spec,
    subject: trip,
    assertedBy: hauler,
    assertedAt: instant('2026-04-09T07:15:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    // [SD §1.4]'s own worked example: "a trip-scoped delay's `subject` is the trip, its `context[]`
    // names every shipment on board".
    context: [families.cho, families.dunne, families.eze, day3Delivery],
    basis: 'ACTUAL',
    value: { occurredAt: instant('2026-04-09T07:10:00Z'), outcome: 'COMPLETED' },
  }

  it('names the trip as subject and every shipment on board as context', () => {
    expect(CANONICAL_SUBJECT_FAMILY.tripResequence).toBe('trip')
    expect(factRefOf(resequence)).toEqual({ subject: trip, type: 'tripResequence' })
    expect(mentions(resequence, families.eze)).toBe(true)
    // …and it asserts nothing about Eze's goods, which is the point of the row.
    expect(isAbout(resequence, families.eze)).toBe(false)
  })

  it('OWED: [A8 §9 item 8] has no row for it, and the binding is deliberately not CUSTODY', () => {
    // The scenario depends on this and the gap is real, so it is asserted rather than assumed away:
    // nobody has said whose resequence wins when the hauler and the booker disagree.
    expect(hasAuthorityRow('tripResequence')).toBe(false)
    const row = AUTHORITY_TABLE.tripResequence
    expect(row.row.owed).toBe('authorityRow')
    expect(row.row.owedTo).toContain('A8 §9 item 8')
    // [SD §4.7.1]: "**not** `CUSTODY`: a plan change is not a fact about the goods, and §4.8's fold
    // does not reach it." An owed binding and a `NONE` binding are different statements.
    expect(row.boundBy).toMatchObject({ owed: 'boundBy' })
    expect(row.provisional).toContain('Do not score on this')
  })
})
