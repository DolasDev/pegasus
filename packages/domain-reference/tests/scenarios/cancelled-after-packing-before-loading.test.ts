/**
 * **Scenario 6 — an order cancelled after packing but before loading, with packing materials
 * already charged.**
 *
 * The critique failed this one as *blocked* rather than merely unhandled: "§6.3 leaves open whether
 * a local-move day with a pack crew and no linehaul is a Trip. If it is not, the pack generated no
 * Stop; §Cross-area then binds accessorials to 'the **stop** that caused them', so the packing
 * charge has no anchor, and the shipment — having no `StopAction` — has no origin either."
 * `fork-order` failed it from the other side: a move cancelled before loading "normally has no BOL
 * at all", so "the charged packing materials attach to an entity the definition does not admit
 * exists."
 *
 * [SD §8.4] closes the first half — "**a day of service performed at one place with no linehaul is
 * a Trip with one Stop**" — and [SD §10.2 item 9] records the consequence: "cancelled-after-packing
 * is now expressible: the pack day is a Trip with one Stop, the pack act has an outcome, and the
 * shipment has an origin."
 *
 * The second half is where this file spends most of its assertions, because the model's answer is
 * uncomfortable and honest: the charge exists, it is anchored, it can only be reversed by an
 * offsetting record — and **its value has no published shape at all**.
 */
import { describe, expect, it } from 'vitest'

import {
  ADJUSTMENT_CODES,
  AUTHORITY_TABLE,
  CANONICAL_SUBJECT_FAMILY,
  authoritativeHolderAt,
  cancellationZeroesOut,
  chargeId,
  checkCaptureOf,
  custodyAt,
  eventId,
  factRefOf,
  hasAuthorityRow,
  instant,
  instantTheFactIsAbout,
  isAssertionType,
  movesWithPrincipal,
  orderId,
  orderStageAt,
  owed,
  partyId,
  reachesThePricedRecord,
  reasonCode,
  reasonsAreRequired,
  roleClass,
  sameFactKey,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type AuthorityContext,
  AUTHORITATIVE_ROLE_AT_INSTANT,
  ORDER_STAGE_AT_RULE,
  type CapturedAssertion,
  type CustodyEvidence,
  type FactResolved,
  type OffsettingRecord,
  type OrderCommitmentEvidence,
  type OrderLifecycleType,
} from '../../src/index'

const spec = specVersion('1')

const order = subjectRef('order', orderId('ORD-33051'))
const shipment = subjectRef('shipment', shipmentId('S-33051'))
/** [SD §8.4]: the pack day is a Trip with one Stop, so the packing act has a place to anchor to. */
const packDay = subjectRef('trip', tripId('T-PACK-33051'))
const residence = subjectRef('stop', stopId('ST-RESIDENCE'))

const originAgent = { party: partyId('P-ORIGIN-CO'), role: 'originAgent' } as const
const accountParty = { party: partyId('P-RMC'), role: 'accountParty' } as const

const packedAt = instant('2026-08-17T16:40:00Z')
const cancelledAt = instant('2026-08-18T09:15:00Z')

/**
 * [SD §4.7.1] `packing` row: family `goods`, `context[]` carries `stopAction`, `stop`, `trip`. The
 * pack happened and completed — the cancellation does not retract it, and nothing here says it does.
 */
const packed: CapturedAssertion<'packing'> = {
  eventId: eventId('PK-33051'),
  type: 'packing',
  specVersion: spec,
  subject: shipment,
  assertedBy: originAgent,
  assertedAt: instant('2026-08-17T17:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [residence, packDay],
  basis: 'ACTUAL',
  value: { occurredAt: packedAt, outcome: 'COMPLETED' },
}

/**
 * The charge for the materials. [SD §4.7.1] `charge` row: subject family `charge`, qualifier
 * `{aspect}`, `context[]` carries `shipment`/`portion`, `order`, `stopAction`/`stop`, `stay`.
 *
 * [SD §4.7.2b] splits the fact into three **aspects** — propose / decide / rate — and the split is
 * not cosmetic: "without the qualifier the fact key would put a _proposal_, an _approval_ and a
 * _price_ into **one** contest, where an approval would compete with an amount."
 */
const proposedCharge: CapturedAssertion<'charge'> = {
  eventId: eventId('CH-MATERIALS-PROPOSED'),
  type: 'charge',
  specVersion: spec,
  subject: subjectRef('charge', chargeId('CH-MATERIALS')),
  assertedBy: originAgent,
  assertedAt: instant('2026-08-17T17:05:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [shipment, order, residence],
  qualifier: { aspect: 'PROPOSED' },
  basis: 'ACTUAL',
  // **Owed.** [SD §4.7.3]: "No document gives any of the three a shape."
  value: owed('chargeValue', 'A11 — charge facts [SD §4.7.3]', {
    note: 'cartons, dish packs, paper and tape, as the crew listed them on the pack sheet',
  }),
}

describe('[SD §8.4] the pack day is a Trip with one Stop, so the packing anchors', () => {
  it('gives the packing act a stop and the shipment an origin', () => {
    expect(CANONICAL_SUBJECT_FAMILY.packing).toBe('goods')
    expect(packed.context).toContain(residence)
    expect(packed.context).toContain(packDay)
    // The act completed, and completion is recorded rather than implied — [SD §2.3] invariant 2
    // forbids a reason here, which is exactly right: nothing went wrong with the pack.
    expect(packed.value.outcome).toBe('COMPLETED')
    expect(reasonsAreRequired('COMPLETED')).toBe(false)
    expect(checkCaptureOf(packed)).toMatchObject({ verdict: 'ADMITTED' })
  })

  it('and the charge hangs off the stop and the order, without a subject path', () => {
    // [SD §1.1] forbids `order/…/shipment/…`. The charge is its own subject; everything it is
    // *also* about is `context[]`, non-authoritatively.
    expect(factRefOf(proposedCharge)).toEqual({
      subject: subjectRef('charge', chargeId('CH-MATERIALS')),
      type: 'charge',
      qualifier: { aspect: 'PROPOSED' },
    })
  })

  it('[SD §4.7.2b] and the three aspects are three fact keys, so an approval never fights an amount', () => {
    const decided: CapturedAssertion<'charge'> = {
      ...proposedCharge,
      eventId: eventId('CH-MATERIALS-DECIDED'),
      assertedBy: accountParty,
      qualifier: { aspect: 'DECIDED' },
    }
    expect(sameFactKey(factRefOf(proposedCharge), factRefOf(decided))).toBe(false)
  })
})

describe('[SD §4.7.2e] the cancellation is an act with an outcome', () => {
  /**
   * [SD §4.7.2e] item 3: "A cancellation is an act with an outcome, and a refused cancellation needs
   * no new mechanism… `orderCancellation` carries `outcome` like every other act." DCSA runs it on a
   * third status track because "cancelling a confirmed booking is itself a request the carrier can
   * refuse"; under [SD §2.3] that is already expressible.
   */
  const cancelled: CapturedAssertion<'orderCancellation'> = {
    eventId: eventId('OC-33051'),
    type: 'orderCancellation',
    specVersion: spec,
    subject: order,
    assertedBy: accountParty,
    assertedAt: instant('2026-08-18T09:20:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    context: [shipment],
    basis: 'ACTUAL',
    value: { occurredAt: cancelledAt, outcome: 'COMPLETED' },
  }

  /** The same request, refused by the carrier — the case DCSA spends a whole status track on. */
  const cancellationRefused: CapturedAssertion<'orderCancellation'> = {
    ...cancelled,
    eventId: eventId('OC-33051-REFUSED'),
    value: {
      occurredAt: cancelledAt,
      outcome: 'NOT_COMPLETED',
      reasons: [
        {
          // [A4 §4.3]: `ALREADY_PERFORMED` was rejected for putting a completion verb in a closed
          // enum, where `outcomeWordIn` cannot see it and only a reader can. `OUT_OF_SEQUENCE` names
          // the request's place in the sequence — it arrived after the act it would have prevented —
          // and its scope is `ACT`, not `ADMINISTRATIVE`: nothing is wrong on paper.
          code: reasonCode('OUT_OF_SEQUENCE'),
          scope: 'ACT',
          attribution: { roleClass: roleClass('carrier') },
        },
      ],
    },
  }

  it('needs no `orderDecline` and no third status track', () => {
    // [SD §4.7.2e] item 1: minting `orderDecline` "would bake an outcome into a type name, which
    // A-TYPE forbids in as many words."
    expect(isAssertionType('orderDecline')).toBe(false)
    expect(isAssertionType('orderCancellation')).toBe(true)
    expect(cancelled.value.outcome).toBe('COMPLETED')
    expect(cancellationRefused.value.outcome).toBe('NOT_COMPLETED')
    // Both are the same fact key — one contested fact about whether this order was cancelled.
    expect(sameFactKey(factRefOf(cancelled), factRefOf(cancellationRefused))).toBe(true)
  })

  it('leaves the packing untouched: a cancellation is not a retraction', () => {
    // The materials were used. [SD §6.4]'s `DID_NOT_OCCUR` is the record that would say otherwise
    // and nothing here is one — the pack act carries no `corrects` link and no supersession.
    expect(packed.value.occurredAt).toBe(packedAt)
    expect(packed).not.toHaveProperty('corrects')
    expect(Date.parse(cancelledAt)).toBeGreaterThan(Date.parse(packedAt))
  })

  /**
   * [A1 §3.3] — the stage is a **projection**, so this scenario's "cancelled" is an answer the fold
   * computes rather than a field anyone set. Both branches are run, because the interesting half of
   * this scenario is that they are the same records with one outcome different.
   */
  const awarded: CapturedAssertion<'orderAward'> = {
    eventId: eventId('OA-33051'),
    type: 'orderAward',
    specVersion: spec,
    subject: order,
    assertedBy: accountParty,
    assertedAt: instant('2026-08-01T10:00:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    basis: 'ACTUAL',
    value: { occurredAt: instant('2026-08-01T10:00:00Z'), outcome: 'COMPLETED' },
  }

  const accepted: CapturedAssertion<'orderResponse'> = {
    eventId: eventId('OR-33051'),
    type: 'orderResponse',
    specVersion: spec,
    subject: order,
    assertedBy: originAgent,
    assertedAt: instant('2026-08-02T11:00:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    basis: 'ACTUAL',
    value: { occurredAt: instant('2026-08-02T11:00:00Z'), outcome: 'COMPLETED' },
  }

  function resolved(assertion: CapturedAssertion<OrderLifecycleType>): FactResolved {
    return {
      eventId: eventId(`FR-${assertion.eventId}`),
      type: 'FactResolved',
      specVersion: spec,
      subject: order,
      assertedBy: { party: partyId('P-PLATFORM'), role: 'platform' },
      assertedAt: instant('2026-08-19T00:00:00Z'),
      capturedBy: 'DERIVED_BY_RULE',
      factRef: factRefOf(assertion),
      selected: assertion.eventId,
      considered: [assertion.eventId],
      rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    } as unknown as FactResolved
  }

  function commitment(...acts: CapturedAssertion<OrderLifecycleType>[]): OrderCommitmentEvidence {
    return { acts, resolutions: acts.map(resolved) }
  }

  const after = instant('2026-08-19T00:00:00Z')

  it('[A1 §3.3] the stage is computed, not set — and the fold says CANCELLED', () => {
    const stage = orderStageAt(order, after, commitment(awarded, accepted, cancelled))
    expect(stage.stage).toBe('CANCELLED')
    // [SD §4.8.3] rule 2: the answer names the rule that produced it.
    expect(stage.rule).toEqual(ORDER_STAGE_AT_RULE)
  })

  it('[A1 §3.3] rule 3 — the refused branch leaves the order ACCEPTED', () => {
    // Same three records, one outcome different, and the packing and the charge are untouched
    // either way. This is [SD §4.7.2e] item 3's "needs no new mechanism", executed.
    expect(
      orderStageAt(order, after, commitment(awarded, accepted, cancellationRefused)).stage,
    ).toBe('ACCEPTED')
    expect(packed.value.occurredAt).toBe(packedAt)
  })

  it('FINDING: who ended the order is not carried by any authoritative field', () => {
    // [SD §4.7.2e] item 2 places who-ended-it on "the stage plus `reasons[].attribution`". At
    // `outcome = COMPLETED` — a cancellation that succeeded, which is this scenario — [SD §2.3]
    // invariant 2 FORBIDS reasons, so the attribution field the section names is unavailable.
    expect(cancelled.value.reasons).toBeUndefined()
    // What remains is `assertedBy`, which is who *said* it; the row that would make the asserter
    // authoritative is owed and is marked "Do not score on this".
    expect(cancelled.assertedBy).toEqual(accountParty)
    expect(hasAuthorityRow('orderCancellation')).toBe(false)
    expect(AUTHORITY_TABLE.orderCancellation.provisional).toContain('Do not score on this')
    // On the refused branch the attribution IS available, because the outcome is exceptional.
    expect(cancellationRefused.value.reasons?.[0]?.attribution.roleClass).toBe('carrier')
  })
})

describe('[SD §6.3] the packing charge can only be reversed by an offsetting record', () => {
  it('excludes `charge` from what a Correction may name — in the type, not in a comment', () => {
    // "Operational facts are corrected by supersede/retract. **Financial facts are corrected only by
    // an offsetting record, never by retraction.**" `CorrectableType` is
    // `Exclude<AssertionType, 'charge'>`, so a correction against the charge does not compile and
    // `OffsettingRecord` is the only door. What is observable at runtime is the door itself.
    const reversal: OffsettingRecord = {
      offsets: proposedCharge.eventId,
      // `ORIGINAL` is the thing being offset, not an offset, so the type cannot spell it here.
      adjCode: 'CAN',
      batch: 'B-2026-08-31',
      // 400NG Items 4.12 / 4.13.3.b / 17-2.7 / 27.4.b-c: refunds and re-bills are "additional coded
      // transactions carrying a narrative note, never edits to the original charge".
      narrative: 'order cancelled 18 Aug after pack; materials charge cancelled in full',
    }
    expect(ADJUSTMENT_CODES).toEqual(['ORIGINAL', 'ADJ', 'CAN'])
    expect(reversal.offsets).toBe(eventId('CH-MATERIALS-PROPOSED'))
    // `src:sirva-ade` ABS p.3's stated invariant: a `CAN` combined with the Original amounts "will
    // zero out the shipment".
    expect(cancellationZeroesOut(1480, -1480)).toBe(true)
    expect(cancellationZeroesOut(1480, -1200)).toBe(false)
  })

  it('[SD §6.1] and an ineffective or unauthorised attempt never reaches the priced record', () => {
    expect(reachesThePricedRecord('APPLIED')).toBe(true)
    expect(reachesThePricedRecord('INEFFECTIVE')).toBe(false)
    expect(reachesThePricedRecord('UNAUTHORISED')).toBe(false)
  })
})

describe('[A8 §5 r11] who may say what about the charge', () => {
  const evidence: CustodyEvidence = {
    handovers: [],
    resolutions: [],
    legs: [],
  }

  function contextAt(): AuthorityContext {
    const at = instantTheFactIsAbout(packed)
    if (!at.resolved) throw new Error('a packing act carries the instant it occurred at')
    return { at: at.at, custody: custodyAt(shipment, packedAt, evidence) }
  }

  it('gives the proposal to the performing role and the decision to the account party', () => {
    const base = contextAt()
    // The origin agent packed, so the origin agent proposes what it cost.
    expect(authoritativeHolderAt('charge', { ...base, aspect: 'PROPOSED' })).toMatchObject({
      holder: { kind: 'performingRole' },
    })
    expect(authoritativeHolderAt('charge', { ...base, aspect: 'DECIDED' })).toMatchObject({
      holder: { kind: 'role', role: 'accountParty' },
    })
  })

  it('OWED: the rating authority is a role the vocabulary cannot name', () => {
    // "The tariff owner (the van line / the party whose tariff prices it)" — [A8 §2]'s cast has no
    // member for it, so the holder is carried as owed rather than bent onto `booker`.
    const rated = authoritativeHolderAt('charge', { ...contextAt(), aspect: 'RATED' })
    expect(rated).toMatchObject({ holder: { kind: 'owedRole' } })
    if (rated.kind !== 'holder' || rated.holder.kind !== 'owedRole') return
    expect(rated.holder.owedRole.owed).toBe('tariffOwner')
    expect(rated.holder.owedRole.owedTo).toContain('A8 §9 item 2')
  })

  it('and asking without an aspect gets no holder at all', () => {
    // Not owed by A8 — owed by the caller. A standing question about a charge must name its aspect
    // before it has an answer, which is the contest the qualifier exists to prevent.
    expect(authoritativeHolderAt('charge', contextAt()).kind).toBe('owed')
  })

  it('[A8 §7.5] A8-PRINCIPAL — the charge moves with the principal, the pack does not', () => {
    expect(movesWithPrincipal('charge')).toBe(true)
    expect(movesWithPrincipal('packing')).toBe(false)
  })
})

describe('OWED — the charge exists, is anchored, and has no value', () => {
  it('[SD §4.7.3] no document gives a charge value a shape, so none is invented', () => {
    // This is the scenario's sharpest gap and it is asserted rather than worked around: "packing
    // materials already charged" and the model cannot say how much. The amount rides as a
    // provisional payload on the owed marker, which [SD §0] makes explicitly non-normative.
    expect(proposedCharge.value.owed).toBe('chargeValue')
    expect(proposedCharge.value.owedTo).toContain('A11')
    expect(proposedCharge.value.provisional).toBeDefined()
  })

  it('[A8 §5] row 15 — `packing` now has an authority row, and the customer competes on scope', () => {
    // This block used to record the gap: "the origin agent packed and says so" was not backed by a
    // table, so a dispute about the SCOPE of what was packed had nothing published to decide it.
    // Row 15 decides it, as the mirror of row 3 (loading) — which is the authored step.
    expect(hasAuthorityRow('packing')).toBe(true)
    const packing = AUTHORITY_TABLE.packing
    expect(packing.a8Row).toBe(15)
    expect(packing.boundBy).toBe('CUSTODY')
    expect(packing.authoritative).toMatchObject({
      kind: 'held',
      primary: { kind: 'role', role: 'packer' },
    })
    // `src:cfr-49-375` §375.503(a) and (d) give the shipper the opportunity to observe, verify and
    // note in writing at both ends — a published right to contest the scope.
    expect(packing.competing).toContain('customer')
  })

  it('[SD §10.2 item 9] and what a shipment boundary that never got its BOL *is* remains owed', () => {
    // The move was cancelled before loading, so no bill of lading was ever issued
    // (`src:cfr-49-375` §375.505(c) puts the BOL in the driver's hands before the vehicle leaves).
    // The shared layer says the scenario is expressible and explicitly does NOT settle this:
    // "§5.2's provisional boundary still needs to say what a boundary that never acquires its
    // defining document _is_." What holds either way is that the shipment is a subject in its own
    // right, so every record above has somewhere to hang regardless of how A2 answers it.
    expect(packed.subject).toEqual(shipment)
    expect(proposedCharge.context).toContain(shipment)
  })
})
