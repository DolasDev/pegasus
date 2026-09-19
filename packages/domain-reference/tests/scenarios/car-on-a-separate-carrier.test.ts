/**
 * **Scenario 5 — one booked order that also moves a car on a separate carrier, delivered a week
 * apart.**
 *
 * This is the scenario the critique used to show that the acceptance tests "are not mutually
 * satisfiable": `fork-order` passed it "on paper (a second shipment under the same order)" and
 * deferred all routing to A3, while A3 "cannot record a stop performed by a vehicle it cannot
 * identify" — so "the car's delivery is unrecordable, and until someone mints a phantom trip the car
 * shipment has **no destination at all**." "The pair passes each half of the test by pointing at the
 * other."
 *
 * [SD §8] takes both halves: "one identified vehicle" is struck from `Stop`, and the
 * `ExternallyPerformedLeg` is minted — "we are not modelling a journey we cannot see. We are
 * modelling **a named party's undertaking to move goods between two places**." The leg is a member
 * of `arrival`'s own subject family ([SD §4.7] note 2), which is what gives the car a destination.
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITY_TABLE,
  HANDED_OVER,
  SUBJECT_FAMILIES,
  admitSubject,
  authoritativeHolderAt,
  custodyAt,
  eventId,
  externallyPerformedLegId,
  factRefOf,
  hasAuthorityRow,
  instant,
  instantTheFactIsAbout,
  isSingletonFamily,
  orderId,
  partyId,
  partyRoleId,
  ruleRef,
  sameFactKey,
  schemeName,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type CustodyHolder,
  type ExternallyPerformedLeg,
  type FactResolved,
} from '../../src/index'

const spec = specVersion('1')

/** One booking. [fork-order §3.1] carries the lifecycle on `subject = order:…`; [SD §1.2] agrees. */
const order = subjectRef('order', orderId('ORD-88120'))

/** Two shipments under it: the household goods on our van, and the car on somebody else's. */
const householdGoods = subjectRef('shipment', shipmentId('S-HHG'))
const car = subjectRef('shipment', shipmentId('S-AUTO'))

const booker = { party: partyId('P-RMC'), role: 'booker' } as const
const vanLine = { party: partyId('P-VANLINE'), role: 'hauler' } as const
const destinationAgent = { party: partyId('P-DEST-CO'), role: 'destinationAgent' } as const
const autoCarrier = partyId('P-REDLINE-AUTO-TRANSPORT')
const platform = partyId('P-PLATFORM')

const hhgDeliveredAt = instant('2026-07-13T15:10:00Z')
const carHandedOverAt = instant('2026-07-08T09:30:00Z')
const carReceivedAt = instant('2026-07-08T10:10:00Z')
const carDeliveredAt = instant('2026-07-20T11:45:00Z')

/**
 * [SD §4.7.1]'s order row, and [SD §4.7.2e] item 1: accept and decline are the two outcomes of one
 * act, so there is no `orderDecline` type — minting one "would bake an outcome into a type name,
 * which **A-TYPE** forbids in as many words."
 */
const awarded: CapturedAssertion<'orderAward'> = {
  eventId: eventId('OA-88120'),
  type: 'orderAward',
  specVersion: spec,
  subject: order,
  assertedBy: booker,
  assertedAt: instant('2026-06-19T13:00:00Z'),
  capturedBy: 'PARTNER_ASSERTED',
  // [SD §4.7.2e]: `context[]` carries the shipments committed under the order **where there are
  // any** — zero is normal and is "a legal state on a live RMC wire" ([fork-order §5.3]). At award
  // the RMC has named neither shipment yet.
  basis: 'ACTUAL',
  value: { occurredAt: instant('2026-06-19T12:55:00Z'), outcome: 'COMPLETED' },
}

const accepted: CapturedAssertion<'orderResponse'> = {
  eventId: eventId('OR-88120'),
  type: 'orderResponse',
  specVersion: spec,
  subject: order,
  assertedBy: vanLine,
  assertedAt: instant('2026-06-19T16:20:00Z'),
  capturedBy: 'PARTNER_ASSERTED',
  context: [householdGoods, car],
  basis: 'ACTUAL',
  value: { occurredAt: instant('2026-06-19T16:15:00Z'), outcome: 'COMPLETED' },
}

/**
 * [SD §8.2]. `performedBy` is mandatory and is the whole point: `src:dp3-tender-of-service` §B.3.f
 * requires the legal name and US DOT number of the provider **actually hauling**, which its analysis
 * calls "the only place in the corpus where _the party actually performing_ must be named."
 */
const autoLeg: ExternallyPerformedLeg = {
  legId: externallyPerformedLegId('LEG-AUTO-88120'),
  moved: car,
  performedBy: autoCarrier,
  // 349: handed over to another party — so authority moves with it (A8-MOVE).
  custodyBasis: HANDED_OVER,
  authoritativeAsserter: autoCarrier,
  from: { kind: 'stop', stop: subjectRef('stop', stopId('ST-ORIGIN')) },
  to: {
    kind: 'place',
    place: { owed: 'placeRef', owedTo: '[SD §1.2] — no `place` aggregate' },
  },
}

const legRef = subjectRef('externallyPerformedLeg', autoLeg.legId)

describe('[SD §8.1] the car gets a destination, because the leg is a legal subject', () => {
  it("puts the leg in `arrival`'s own family — the non-singleton [SD §4.7] note 2 exists for", () => {
    expect(SUBJECT_FAMILIES.stop).toEqual(['stop', 'externallyPerformedLeg'])
    expect(isSingletonFamily('stop')).toBe(false)
    // "which is what lets an arrival be asserted about a leg performed by someone whose journey we
    // cannot see." Under A3's old definition this record could not exist at all.
    expect(admitSubject('arrival', legRef).admitted).toBe(true)
  })

  it("records the car's arrival against the leg, with no vehicle of ours anywhere in it", () => {
    const carArrives: CapturedAssertion<'arrival'> = {
      eventId: eventId('A-AUTO'),
      type: 'arrival',
      specVersion: spec,
      subject: legRef,
      assertedBy: { party: autoCarrier, role: 'hauler' },
      assertedAt: instant('2026-07-20T12:00:00Z'),
      // [SD §8.2]: "`capturedBy` will typically be `PARTNER_ASSERTED` or `KEYED_BY_PERSON`."
      capturedBy: 'PARTNER_ASSERTED',
      context: [car],
      basis: 'ACTUAL',
      value: { at: instant('2026-07-20T11:20:00Z') },
    }
    expect(factRefOf(carArrives)).toEqual({ subject: legRef, type: 'arrival' })
    // There is no trip, no stop of ours, and no licence plate — and the record is still complete.
    expect(carArrives.context).toEqual([car])
  })

  it('OWED: [SD §1.2] has no `place` aggregate, so the far end of the leg has no schema', () => {
    // The near end is a Stop of one of our trips and is typed. The far end is the customer's new
    // driveway, which nothing in the binding layer can reference — carried as owed rather than as a
    // bare string, "because a bare string here would read as a settled shape".
    expect(autoLeg.from).toMatchObject({ kind: 'stop' })
    expect(autoLeg.to).toMatchObject({ kind: 'place', place: { owed: 'placeRef' } })
  })
})

describe('[fork-order §3.2] one order, two shipments, two fact keys', () => {
  const deliverGoods: CapturedAssertion<'delivery'> = {
    eventId: eventId('D-HHG'),
    type: 'delivery',
    specVersion: spec,
    subject: householdGoods,
    assertedBy: destinationAgent,
    assertedAt: instant('2026-07-13T15:30:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    context: [subjectRef('stop', stopId('ST-DEST')), subjectRef('trip', tripId('T-4410'))],
    basis: 'ACTUAL',
    value: { occurredAt: hhgDeliveredAt, outcome: 'COMPLETED' },
  }

  const deliverCar: CapturedAssertion<'delivery'> = {
    eventId: eventId('D-AUTO'),
    type: 'delivery',
    specVersion: spec,
    subject: car,
    assertedBy: { party: autoCarrier, role: 'hauler' },
    assertedAt: instant('2026-07-20T12:05:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    // [SD §4.7.1] `delivery` row: `context[]` carries `stop` **or** `externallyPerformedLeg`.
    context: [legRef],
    basis: 'ACTUAL',
    value: { occurredAt: carDeliveredAt, outcome: 'COMPLETED' },
  }

  it("keeps the two deliveries a week apart out of each other's contest", () => {
    // One order does not fuse them: the fact key reads the subject, and the subjects are two
    // shipments. Nothing has to be said about "which delivery is the real one".
    expect(sameFactKey(factRefOf(deliverGoods), factRefOf(deliverCar))).toBe(false)
    const daysApart =
      (Date.parse(deliverCar.value.occurredAt) - Date.parse(deliverGoods.value.occurredAt)) /
      (24 * 60 * 60 * 1000)
    expect(daysApart).toBeGreaterThan(6)
  })

  it('and the order that ties them together is a subject, not a parent', () => {
    // [SD §1.1]: no subject path, so there is no `order/…/shipment/…`. The order's own lifecycle
    // records are about the order; the shipments ride in `context[]`, non-authoritatively.
    expect(factRefOf(accepted)).toEqual({ subject: order, type: 'orderResponse' })
    expect(accepted.context).toEqual([householdGoods, car])
  })

  it('[fork-order §5.3] an accepted order with zero shipments is a legal state', () => {
    // Weichert's observed behaviour: accept is expressed as an update carrying an empty `shipments`
    // array. The award record therefore carries no `context[]` at all, and that is not a defect.
    expect(awarded.context).toBeUndefined()
    expect(awarded.value.outcome).toBe('COMPLETED')
  })
})

describe("[A8 §5 r5] the auto carrier's assertions govern its own leg", () => {
  /**
   * The car is handed to the auto carrier at origin: the `J1`/`R1` pair, **both sides**.
   *
   * This scenario used to publish only the releasing half and let the fold take the holder from
   * `ExternallyPerformedLeg.performedBy`. [SD §4.7.2f] §7.1 sources `holder` from the selected
   * **RECEIPT**'s `value.receivingParty`, full stop, so a one-sided transfer is now a permanent
   * `UNKNOWN` span — foreclosure 2, and the intended cost. What the leg still supplies is the
   * **basis** ([SD §4.8.3] rule 1) and the authority alternate ([A8 §5] rows 1, 2, 5).
   */
  const vanLineRole: CustodyHolder = {
    kind: 'partyRole',
    partyRole: subjectRef('partyRole', partyRoleId('role-origin-vanline')),
  }
  const autoCarrierParty: CustodyHolder = { kind: 'party', party: autoCarrier }

  const releaseToAutoCarrier: CapturedAssertion<'handover'> = {
    eventId: eventId('H-AUTO-REL'),
    type: 'handover',
    specVersion: spec,
    subject: car,
    qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RELEASE' },
    assertedBy: { party: vanLine.party, role: 'originAgent' },
    assertedAt: instant('2026-07-08T09:45:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    context: [legRef],
    basis: 'ACTUAL',
    value: {
      occurredAt: carHandedOverAt,
      outcome: 'COMPLETED',
      custodyBasis: HANDED_OVER,
      releasingParty: vanLineRole,
      receivingParty: autoCarrierParty,
    },
  }

  const receiptByAutoCarrier: CapturedAssertion<'handover'> = {
    ...releaseToAutoCarrier,
    eventId: eventId('H-AUTO-REC'),
    qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RECEIPT' },
    assertedBy: { party: autoCarrier, role: 'hauler' },
    assertedAt: instant('2026-07-08T10:15:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    // The receipt is its own act at its own instant: the driver signs for the car forty minutes
    // after the van line let go of it. Between the two, C5 says the fold is silent.
    value: { ...releaseToAutoCarrier.value, occurredAt: carReceivedAt },
  }

  function resolutionFor(
    handoverAssertion: CapturedAssertion<'handover'>,
    id: string,
  ): FactResolved<'handover'> {
    return {
      eventId: eventId(id),
      type: 'FactResolved',
      specVersion: spec,
      subject: car,
      assertedBy: { party: platform, role: 'platform' },
      assertedAt: instant('2026-07-08T10:30:00Z'),
      capturedBy: 'DERIVED_BY_RULE',
      factRef: factRefOf(handoverAssertion),
      selected: handoverAssertion.eventId,
      considered: [handoverAssertion.eventId],
      rule: ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'),
    }
  }

  const evidence: CustodyEvidence = {
    handovers: [releaseToAutoCarrier, receiptByAutoCarrier],
    resolutions: [
      resolutionFor(releaseToAutoCarrier, 'FR-H-AUTO-REL'),
      resolutionFor(receiptByAutoCarrier, 'FR-H-AUTO-REC'),
    ],
    legs: [autoLeg],
  }

  it("resolves the delivery authority to the leg's authoritativeAsserter", () => {
    const probe: CapturedAssertion<'delivery'> = {
      eventId: eventId('probe-auto'),
      type: 'delivery',
      specVersion: spec,
      subject: car,
      assertedBy: { party: autoCarrier, role: 'hauler' },
      assertedAt: instant('2026-07-20T12:05:00Z'),
      capturedBy: 'PARTNER_ASSERTED',
      basis: 'ACTUAL',
      value: { occurredAt: carDeliveredAt, outcome: 'COMPLETED' },
    }
    const at = instantTheFactIsAbout(probe)
    expect(at.resolved).toBe(true)
    if (!at.resolved) return

    const context: AuthorityContext = {
      at: at.at,
      custody: custodyAt(car, carDeliveredAt, evidence),
      leg: autoLeg,
      conditions: ['EXTERNALLY_PERFORMED_LEG'],
    }
    expect(authoritativeHolderAt('delivery', context)).toMatchObject({
      kind: 'holder',
      holder: { kind: 'legAuthoritativeAsserter' },
      rule: AUTHORITY_TABLE.delivery.rule,
    })
  })

  it('and the fold reports the carrier holding the car from its RECEIPT onward', () => {
    const duringTransit = custodyAt(car, instant('2026-07-15T00:00:00Z'), evidence)
    expect(duringTransit.custody).toBe('KNOWN')
    if (duringTransit.custody !== 'KNOWN') return
    expect(duringTransit.holder).toEqual({ kind: 'party', party: autoCarrier })
    // The holder is the receipt's own `value.receivingParty` — NOT the leg's `performedBy`, which
    // happens to name the same party here and is no longer a source of holders at all. Nothing
    // published says the two must agree; that edge is recorded at [SD §4.7.2f] §7.5 and as command
    // C8 in `alloy/custody.als`, and is [SD §4.8.3]'s to settle.
    expect(receiptByAutoCarrier.value.receivingParty).toEqual({ kind: 'party', party: autoCarrier })
    // What the leg DOES still supply is the basis — [SD §4.8.3] rule 1, unchanged by F1.
    expect(duringTransit.basis).toBe(HANDED_OVER)
    expect(autoLeg.custodyBasis).toBe(HANDED_OVER)
    // …and it knows nothing about the car before the handover, rather than guessing the van line.
    expect(custodyAt(car, instant('2026-07-01T00:00:00Z'), evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
    })
  })

  it('and a partner that emits only the release leaves a permanent UNKNOWN span', () => {
    // [SD §4.7.2f] foreclosure 2, stated to ingest rather than discovered in production: "A partner
    // that emits only `J1`, or only `R1`, leaves permanent `UNKNOWN` spans. That is a real
    // operational cost and it is the intended one."
    const oneSided: CustodyEvidence = {
      handovers: [releaseToAutoCarrier],
      resolutions: [resolutionFor(releaseToAutoCarrier, 'FR-H-AUTO-REL')],
      legs: [autoLeg],
    }
    expect(custodyAt(car, instant('2026-07-15T00:00:00Z'), oneSided)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
  })
})

describe('OWED — what this scenario still cannot score', () => {
  it('[A8 §9 item 8] the order lifecycle has no authority row', () => {
    // Who is authoritative when the RMC and the van line disagree about whether the order was
    // accepted is exactly the question this scenario raises, and A8 §5 has no order row.
    expect(hasAuthorityRow('orderAward')).toBe(false)
    expect(hasAuthorityRow('orderResponse')).toBe(false)
    expect(hasAuthorityRow('orderCancellation')).toBe(false)
    expect(AUTHORITY_TABLE.orderAward.provisional).toContain('Do not score on this')
  })

  it('and its binding is owed, deliberately not CUSTODY', () => {
    // "an order is a commitment, not a fact about the goods, and §4.8's fold does not reach it."
    // Holding the car has nothing to do with who may speak for the booking.
    expect(AUTHORITY_TABLE.orderAward.boundBy).toMatchObject({ owed: 'boundBy' })
  })

  it("OWED: the two carriers' shipment numbers are PEER identifiers, not a hierarchy", () => {
    // [A8 §5 r10]: the van line's registration and the auto carrier's pro number are "values under
    // two schemes with two issuers", neither authoritative over the other — and the scheme
    // vocabulary itself is owed to A9, so both scheme names here are placeholders.
    expect(schemeName('vanline.registration')).toBe('vanline.registration')
    expect(schemeName('autocarrier.pro')).toBe('autocarrier.pro')
    expect(AUTHORITY_TABLE.identity.boundBy).toBe('SCHEME')
  })
})
