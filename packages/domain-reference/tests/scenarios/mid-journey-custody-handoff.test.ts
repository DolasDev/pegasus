/**
 * **Scenario 8 — a mid-journey custody handoff, now with TWO of them.**
 *
 * _Goods move from the origin agent's shuttle to a second van line's linehaul hauler at a
 * cross-dock, and from that hauler to the destination agent. Both A and D later assert a delivery
 * date._ — [A8 §7.6] works the first half end to end; the second half is what **F1** proved the
 * catalog could not publish.
 *
 * **What this file had to be rebuilt to exercise.** It used to carry one transfer, and it passed —
 * which was the finding, not the reassurance. `findings-from-alloy.md` F1: "`custodyAt` takes the
 * already-selected handovers as an input, so it folds correctly over whatever it is given and never
 * asks whether two selected handovers about one goods could exist. **The scenario test therefore
 * passes on a history the catalog cannot publish.**" Under the old shape every handover about
 * `shipment:S` keyed to `(shipment:S, handover)` ([SD §4.7.1]: no qualifier) and [SD §4.3] selects
 * **one** winner per key, so the four records below were one contest with one survivor: custody
 * could never change hands twice, and [SD §4.8.3]'s `until` was unreachable.
 *
 * So the first `describe` below is the regression gate. It asserts the four records carry **four
 * distinct fact keys**, and then strips the qualifier and asserts they collapse to **one** — which
 * is F1, reproduced as an assertion rather than described. Against the old shape that block fails
 * at its first expectation; against [SD §4.7.2f]'s `{releasing, receiving, side, occurrence?}` it
 * passes, and the two-span history underneath it becomes publishable.
 *
 * **The recency trap is kept and still has to be disproved.** The critique's charge was precise:
 * "§5.5 concedes that without the ORIGINAL authoritative-asserter rule, rule (b)(4)'s resolution
 * **degenerates to recency**." So the delivery contest is built to make recency the tempting
 * answer — **A's losing assertion is the more recent of the two** — and then the model reaches the
 * other one. It does not reach it by preferring the older record. It reaches it through
 * **A8-INSTANT** ([A8 §4.2]): "a role's standing for a fact is determined by the instant the fact is
 * _about_… **never by `assertedAt` or `recordedAt`**." A's role was never authoritative over an
 * instant three weeks past the `349` boundary, so there is nothing to downgrade and nothing to
 * expire — and A's **load** assertion, made at the same moment from the same non-custodial
 * position, stays authoritative, which is the half that proves the rule is about the instant and
 * not about A.
 *
 * Scoreboard label, fixed verbatim at [SD §10.5]: **Expressible — dwell classification deferred to
 * A5, custody authority deferred to A8.**
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITATIVE_ROLE_AT_INSTANT,
  AUTHORITY_TABLE,
  CUSTODY_AT_RULE,
  CUSTODY_UNKNOWN_REASONS,
  HANDED_OVER,
  HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY,
  JOINT_AT_CUSTODY_BOUNDARY,
  authorityAtBoundary,
  authorityMovesAtHandover,
  authoritativeHolderAt,
  custodyAt,
  custodyAuthorityAt,
  eventId,
  factRefOf,
  handoverOccurrenceIsWellFormed,
  hasAuthorityRow,
  instant,
  instantTheFactIsAbout,
  itemId,
  jointResolutionIsWellFormed,
  jointRuleApplies,
  listedStandingOf,
  partyId,
  partyRoleId,
  recencyIsPublishedFor,
  ruleRef,
  sameFactKey,
  specVersion,
  stableStringify,
  standingAfterBoundary,
  shipmentId,
  stopId,
  subjectRef,
  tripId,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type CustodyHolder,
  type FactRef,
  type FactResolved,
  type HandoverQualifier,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S'))

/**
 * **One place, two stops — and this is not a naming convenience.** [SD §8.1] fixes a `Stop` as "a
 * visit to one place, at **one position in one trip's sequence**", so a single `Stop` can never
 * belong to two trips. The cross-dock is visited twice — once by the shuttle (T1) to drop, once by
 * the linehaul (T2) to collect — so it is `stop:X1` on T1 and `stop:X2` on T2, at the same place.
 * [A3 §8] says it in as many words: "the releasing side against a stop on trip 1, the receiving
 * side against a stop on trip 2."
 *
 * This file previously wrote one `stop:X` into **both** handovers' `context[]`, alongside T1 on the
 * release and T2 on the receipt — the identical transcription slip [A8 §7.6]'s third correction
 * bullet now names and fixes. Nothing about the scenario's conclusion turns on it, because
 * `context[]` is not the resolution key ([SD §1.4] rule 3); it was unpublishable all the same.
 *
 * The same slip ran through the second transfer, so the destination interchange is split the same
 * way: `stop:Y1` on the linehaul trip (T2) and `stop:Y2` on the delivery trip (T3).
 */
const crossDockOnShuttle = subjectRef('stop', stopId('X1'))
const crossDockOnLinehaul = subjectRef('stop', stopId('X2'))
const interchangeOnLinehaul = subjectRef('stop', stopId('Y1'))
const interchangeOnDelivery = subjectRef('stop', stopId('Y2'))
const destination = subjectRef('stop', stopId('Z'))
const shuttleTrip = subjectRef('trip', tripId('T1'))
const linehaulTrip = subjectRef('trip', tripId('T2'))
const deliveryTrip = subjectRef('trip', tripId('T3'))

const originAgentA = partyId('A')
const haulerH = partyId('H')
const destinationAgentD = partyId('D')
const platform = partyId('P-PLATFORM')

const originAgentRole: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('role-origin-A')),
}
const haulerRole: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('role-hauler-H')),
}
const destinationAgentRole: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('role-destination-D')),
}

/** The instants the scenario turns on. Two transfers, so four of them, and two gaps. */
const loadedAt = instant('2026-03-02T08:15:00Z')
/** Transfer 1, A → H, at the cross-dock. The release and the receipt are hours apart: the goods
 * dwell on the dock overnight, which is [A8 §7.6]'s own open question and [A3 §8]'s "thin part". */
const releasedByAAt = instant('2026-03-03T14:05:00Z')
const receivedByHAt = instant('2026-03-04T09:20:00Z')
/** Transfer 2, H → D, at the destination interchange. */
const releasedByHAt = instant('2026-03-20T16:40:00Z')
const receivedByDAt = instant('2026-03-21T07:55:00Z')
const deliveredAt = instant('2026-03-24T10:00:00Z')

/* ------------------------------------------------------------------------------------------------
 * Two transfers, four facts, four keys — [SD §4.7.2f] §6 R1
 *
 * "Origin agent → hauler → destination agent publishes four facts on four keys:
 *  {OriginAgent, Hauler, RELEASE}, {OriginAgent, Hauler, RECEIPT},
 *  {Hauler, DestinationAgent, RELEASE}, {Hauler, DestinationAgent, RECEIPT}.
 *  Two custody spans, two boundaries."
 * ---------------------------------------------------------------------------------------------- */

function handover(fields: {
  id: string
  qualifier: HandoverQualifier
  by: { party: ReturnType<typeof partyId>; role: 'originAgent' | 'hauler' | 'destinationAgent' }
  said: string
  context: readonly (typeof crossDockOnShuttle | typeof shuttleTrip)[]
  at: ReturnType<typeof instant>
  releasingParty: CustodyHolder
  receivingParty: CustodyHolder
}): CapturedAssertion<'handover'> {
  return {
    eventId: eventId(fields.id),
    type: 'handover',
    specVersion: spec,
    subject: shipment,
    qualifier: fields.qualifier,
    assertedBy: fields.by,
    assertedAt: instant(fields.said),
    // M2: custody handed over is possession-changing, so a human or partner asserter. [SD §5] M2
    // forbids `ASSUMED_FROM_PLAN` here outright, which is why no configuration below reaches for it.
    capturedBy: fields.by.role === 'hauler' ? 'PARTNER_ASSERTED' : 'KEYED_BY_PERSON',
    context: [...fields.context],
    basis: 'ACTUAL',
    value: {
      occurredAt: fields.at,
      outcome: 'COMPLETED',
      // `src:uncefact-rec24` rev3 p.15 — handed over **to another party**. An interline transfer,
      // not 400NG Item 125's shuttle to the same agent's own van.
      custodyBasis: HANDED_OVER,
      // [SD §4.7.2f] §0(4): both parties ride BOTH records, which preserves
      // `src:open-trip-model`'s `HandOver` `from`/`to` field-for-field. What is not preserved is
      // the claim that one publisher's record settles both sides.
      releasingParty: fields.releasingParty,
      receivingParty: fields.receivingParty,
    },
  }
}

/** Transfer 1, releasing side — the `J1` half of `src:stedi-x12-reference` element 1650. */
const releaseAtoH = handover({
  id: 'h1-release',
  qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RELEASE' },
  by: { party: originAgentA, role: 'originAgent' },
  said: '2026-03-03T14:30:00Z',
  context: [crossDockOnShuttle, shuttleTrip],
  at: releasedByAAt,
  releasingParty: originAgentRole,
  receivingParty: haulerRole,
})

/** Transfer 1, receiving side — the `R1` half. A different party, a different key, a different
 * stop on a different trip: [A3 §8], "the releasing side against a stop on trip 1, the receiving
 * side against a stop on trip 2". */
const receiptAtoH = handover({
  id: 'h1-receipt',
  qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RECEIPT' },
  by: { party: haulerH, role: 'hauler' },
  said: '2026-03-04T09:40:00Z',
  context: [crossDockOnLinehaul, linehaulTrip],
  at: receivedByHAt,
  releasingParty: originAgentRole,
  receivingParty: haulerRole,
})

/** Transfer 2, releasing side. The counterpart role differs, so this separates from transfer 1
 * **without** an ordinal — [SD §4.7.2f] §6 R1. */
const releaseHtoD = handover({
  id: 'h2-release',
  qualifier: { releasing: 'hauler', receiving: 'destinationAgent', side: 'RELEASE' },
  by: { party: haulerH, role: 'hauler' },
  said: '2026-03-20T17:10:00Z',
  context: [interchangeOnLinehaul, linehaulTrip],
  at: releasedByHAt,
  releasingParty: haulerRole,
  receivingParty: destinationAgentRole,
})

/** Transfer 2, receiving side. */
const receiptHtoD = handover({
  id: 'h2-receipt',
  qualifier: { releasing: 'hauler', receiving: 'destinationAgent', side: 'RECEIPT' },
  by: { party: destinationAgentD, role: 'destinationAgent' },
  said: '2026-03-21T08:05:00Z',
  context: [interchangeOnDelivery, deliveryTrip],
  at: receivedByDAt,
  releasingParty: haulerRole,
  receivingParty: destinationAgentRole,
})

const HANDOVERS = [releaseAtoH, receiptAtoH, releaseHtoD, receiptHtoD] as const

/**
 * One `FactResolved` per key. Four keys, four resolutions, four winners — which is the whole of
 * what F1 said was impossible, because under one key [SD §4.3] admits one winner.
 *
 * Each is a contest of one here, and that is not a defect: the release and the receipt key
 * differently, so nobody is ever asked to choose between them ([SD §4.7.2f] §2). [A8 §7.6] now
 * publishes exactly this shape — one `FactResolved` per handover key, two of them for one transfer.
 * (Its earlier shape — no `FactResolved` on the handovers at all — was cited here as evidence for
 * the two-facts reading; that citation is **withdrawn**, because the same edit that gave `handover`
 * its qualifier rewrote the passage it read. See [SD §4.7.2f]'s withdrawn evidence item (b).)
 * The contest with two assertions in it is the same-side case, exercised further down.
 */
function resolutionFor(handoverAssertion: CapturedAssertion<'handover'>): FactResolved<'handover'> {
  return {
    eventId: eventId(`fr-${handoverAssertion.eventId}`),
    type: 'FactResolved',
    specVersion: spec,
    subject: shipment,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-03-25T00:00:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: factRefOf(handoverAssertion),
    selected: handoverAssertion.eventId,
    considered: [handoverAssertion.eventId],
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
  }
}

const evidence: CustodyEvidence = {
  handovers: [...HANDOVERS],
  resolutions: HANDOVERS.map(resolutionFor),
  legs: [],
}

/* ------------------------------------------------------------------------------------------------
 * Three weeks later, both assert the delivery — and A speaks LAST
 * ---------------------------------------------------------------------------------------------- */

/**
 * [A8 §7.6] is explicit that A's is "in fact the _more recent_ of the two, which is the exact case
 * the critique raised". `assertedAt` is a day later than D's.
 */
const deliveryByA: CapturedAssertion<'delivery'> = {
  eventId: eventId('d-A'),
  type: 'delivery',
  specVersion: spec,
  subject: shipment,
  assertedBy: { party: originAgentA, role: 'originAgent' },
  assertedAt: instant('2026-03-25T09:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  // [SD §4.7.1] row 5 and [A8 §7.6]'s own correction: the subject is the GOODS; the stop is context.
  context: [destination],
  basis: 'ACTUAL',
  value: { occurredAt: deliveredAt, outcome: 'COMPLETED' },
}

const deliveryByD: CapturedAssertion<'delivery'> = {
  eventId: eventId('d-D'),
  type: 'delivery',
  specVersion: spec,
  subject: shipment,
  assertedBy: { party: destinationAgentD, role: 'destinationAgent' },
  assertedAt: instant('2026-03-24T11:30:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [destination],
  basis: 'ACTUAL',
  value: { occurredAt: deliveredAt, outcome: 'COMPLETED' },
}

const deliveryResolved: FactResolved<'delivery'> = {
  eventId: eventId('fr-delivery'),
  type: 'FactResolved',
  specVersion: spec,
  subject: shipment,
  assertedBy: { party: platform, role: 'platform' },
  assertedAt: instant('2026-03-25T10:00:00Z'),
  capturedBy: 'DERIVED_BY_RULE',
  context: [destination],
  factRef: { subject: shipment, type: 'delivery' },
  selected: deliveryByD.eventId,
  considered: [deliveryByA.eventId, deliveryByD.eventId],
  rule: AUTHORITATIVE_ROLE_AT_INSTANT,
}

function contextAt(assertion: CapturedAssertion<'delivery' | 'loading'>): AuthorityContext {
  const at = instantTheFactIsAbout(assertion)
  if (!at.resolved) throw new Error('an act carries the instant it occurred at')
  return {
    at: at.at,
    custody: custodyAt(shipment, at.at, evidence),
    custodyAuthority: custodyAuthorityAt(shipment, at.at, evidence),
  }
}

/* ================================================================================================
 * F1 — the regression gate. This block is what fails against the old shape.
 * ============================================================================================== */

describe('F1 [SD §4.7.2f] — four successive handover facts are four keys, not one contest', () => {
  const keys = HANDOVERS.map((handoverAssertion) => stableStringify(factRefOf(handoverAssertion)))

  it('publishes the four keys [SD §4.7.2f] §6 R1 names, all distinct', () => {
    // {OriginAgent, Hauler, RELEASE} · {OriginAgent, Hauler, RECEIPT}
    // {Hauler, DestinationAgent, RELEASE} · {Hauler, DestinationAgent, RECEIPT}
    expect(new Set(keys).size).toBe(4)
    for (const left of HANDOVERS) {
      for (const right of HANDOVERS) {
        if (left === right) continue
        expect(
          sameFactKey(factRefOf(left), factRefOf(right)),
          `${left.eventId} vs ${right.eventId}`,
        ).toBe(false)
      }
    }
    // Note which pair is separated by which component, because the decision's §6 R1 turns on it:
    // transfer 1's two sides differ only in `side`; the two transfers differ in the role pair, so
    // they separate WITHOUT an ordinal and `occurrence` stays absent on all four.
    expect(releaseAtoH.qualifier.receiving).toBe(receiptAtoH.qualifier.receiving)
    expect(releaseAtoH.qualifier.side).not.toBe(receiptAtoH.qualifier.side)
    expect(receiptAtoH.qualifier.releasing).not.toBe(receiptHtoD.qualifier.releasing)
    for (const handoverAssertion of HANDOVERS) {
      expect(handoverAssertion.qualifier.occurrence).toBeUndefined()
      expect(handoverOccurrenceIsWellFormed(handoverAssertion.qualifier)).toBe(true)
    }
  })

  it('and against the OLD shape they collapse to one key — which is the defect, reproduced', () => {
    // [SD §4.7.1] before the amendment declared `qualifier: null` for `handover`, so the derived key
    // ([SD §1.3]) was `(subject, type)` and every one of these four was `(shipment:S, handover)`.
    // [SD §4.3] selects ONE winner per key, so three of the four could never be selected — custody
    // could not change hands twice, and [SD §4.8.3]'s `until` was unreachable. That is F1.
    const withoutQualifier = HANDOVERS.map((handoverAssertion) =>
      stableStringify({ subject: handoverAssertion.subject, type: handoverAssertion.type }),
    )
    expect(new Set(withoutQualifier).size).toBe(1)
  })

  it('H-OCCUR — an absent `occurrence` and an explicit 1 are ONE key, not two', () => {
    // [SD §4.7.2f]: "absent — meaning 1". Two spellings of one ordinal must pair, or the driver
    // omitting it and its own office writing `1` would never meet, which is exactly the contest the
    // fact key exists to hold.
    const explicit: FactRef<'handover'> = {
      subject: shipment,
      type: 'handover',
      qualifier: { ...receiptAtoH.qualifier, occurrence: 1 },
    }
    expect(sameFactKey(factRefOf(receiptAtoH), explicit)).toBe(true)
    // …and a second transfer between the SAME pair on the same side is a different key (R5).
    const second: FactRef<'handover'> = {
      subject: shipment,
      type: 'handover',
      qualifier: { ...receiptAtoH.qualifier, occurrence: 2 },
    }
    expect(sameFactKey(factRefOf(receiptAtoH), second)).toBe(false)
    expect(handoverOccurrenceIsWellFormed({ ...receiptAtoH.qualifier, occurrence: 0 })).toBe(false)
    expect(handoverOccurrenceIsWellFormed({ ...receiptAtoH.qualifier, occurrence: 1.5 })).toBe(
      false,
    )
  })
})

describe('[SD §4.8.3] + C5 — two custody spans, two boundaries, and a gap between each pair', () => {
  it("holds nothing before the first receipt, and NOT on the releasing party's word alone", () => {
    // Before anything is published.
    expect(custodyAt(shipment, loadedAt, evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
    })
    // A has released and H has not yet said it took the goods. [SD §4.7.2f] foreclosure 2: "custody
    // can never move on one party's word." Under the one-fact reading a lone `J1` would be a contest
    // of one, `FactResolved` would select it, and the fold would report custody moving on the
    // releasing party's word — M1's record-versus-fabrication argument, one field over.
    expect(custodyAt(shipment, instant('2026-03-03T20:00:00Z'), evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
  })

  it('span 1 — the hauler holds them, and the span CLOSES at its own release', () => {
    const answer = custodyAt(shipment, instant('2026-03-10T00:00:00Z'), evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(haulerRole)
    expect(answer.since).toBe(receivedByHAt)
    // `until` — F1's third failing predicate, and the one that was **unreachable** before the
    // qualifier, because it read "the next selected handover's `occurredAt`" and a second selected
    // handover about one goods could not exist.
    expect(answer.until).toBe(releasedByHAt)
    expect(answer.rule).toEqual(CUSTODY_AT_RULE)
    // "every handover assertion **and FactResolved** the fold read" — both ends of the span.
    expect(answer.evidencedBy).toContain(receiptAtoH.eventId)
    expect(answer.evidencedBy).toContain(eventId(`fr-${receiptAtoH.eventId}`))
    expect(answer.evidencedBy).toContain(releaseHtoD.eventId)
  })

  it('the second gap — [A3 §8]\'s "thin part", produced by the fold rather than stipulated', () => {
    // [SD §4.8.3] rule 3 used to STATE this case ("across a cross-dock dwell where only one of the
    // two handovers has been published"). Under C5 it is derived, which is itself the evidence for
    // [SD §4.7.2f] §2's two-facts verdict.
    expect(custodyAt(shipment, instant('2026-03-20T23:00:00Z'), evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
  })

  it('span 2 — the destination agent holds them, open-ended', () => {
    const answer = custodyAt(shipment, deliveredAt, evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(destinationAgentRole)
    expect(answer.since).toBe(receivedByDAt)
    expect(answer.until).toBeUndefined()
  })

  it('two spans and two DIFFERENT holders — the history F1 said was unpublishable', () => {
    const inSpan1 = custodyAt(shipment, instant('2026-03-10T00:00:00Z'), evidence)
    const inSpan2 = custodyAt(shipment, deliveredAt, evidence)
    expect(inSpan1.custody).toBe('KNOWN')
    expect(inSpan2.custody).toBe('KNOWN')
    if (inSpan1.custody !== 'KNOWN' || inSpan2.custody !== 'KNOWN') return
    expect(inSpan1.holder).not.toEqual(inSpan2.holder)
  })

  it('C6 — a tie at one instant is UNKNOWN, never an ordering nobody published', () => {
    // Two selected facts about one goods at one `occurredAt` that would open and close differently.
    // The fold does not order them by key, by `assertedAt`, by `recordedAt` or by `occurrence`:
    // A8-NAMED ([A8 §4.4]) in its custody-side form.
    const rival = handover({
      id: 'h1-receipt-rival',
      // A different transfer entirely — the origin agent handing to a SECOND hauler — asserted at
      // the same instant. Distinct key, so this is an ordering problem and not a selection one.
      qualifier: { releasing: 'originAgent', receiving: 'driver', side: 'RECEIPT' },
      by: { party: haulerH, role: 'hauler' },
      said: '2026-03-04T10:00:00Z',
      context: [crossDockOnLinehaul, linehaulTrip],
      at: receivedByHAt,
      releasingParty: originAgentRole,
      receivingParty: destinationAgentRole,
    })
    const tied: CustodyEvidence = {
      handovers: [...HANDOVERS, rival],
      resolutions: [...HANDOVERS.map(resolutionFor), resolutionFor(rival)],
      legs: [],
    }
    expect(sameFactKey(factRefOf(receiptAtoH), factRefOf(rival))).toBe(false)
    expect(custodyAt(shipment, instant('2026-03-10T00:00:00Z'), tied)).toEqual({
      custody: 'UNKNOWN',
      why: 'AMBIGUOUS_ORDER_AT_INSTANT',
      rule: CUSTODY_AT_RULE,
    })
  })
})

describe('[A8 §7.1] A8-MOVE — the hinge is the responsibility distinction, not the movement', () => {
  it('moves authority at 349 and pointedly does not at 41', () => {
    expect(authorityMovesAtHandover(HANDED_OVER)).toBe(true)
    // 400NG Item 125 Shuttle Service: a truck-to-truck transfer to the same agent's own linehaul
    // van. Custody moves; responsibility does not; so authority does not either.
    expect(authorityMovesAtHandover(HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY)).toBe(false)
  })

  it('[A8 §7.2] A8-LIABILITY — and moves nothing else', () => {
    // [SD §4.7.2f] §7.3: the boundary is the **RECEIPT**'s instant, not the release's. There are
    // two instants now and the rule has to name one; naming the release would move authority to a
    // party that has not spoken (M1).
    const boundary = authorityAtBoundary(custodyAt(shipment, receivedByHAt, evidence))
    expect(boundary?.custodyMoved).toBe(true)
    expect(boundary?.authorityMoved).toBe(true)
    // "the rule most likely to be **forgotten** rather than disputed". DP3 ToS §B.3.g makes the TSP
    // "solely responsible for the acts and omissions of any third party it contracts with".
    expect(boundary?.liabilityMoved).toBe(false)
    expect(boundary?.authorityNowHeldBy).toEqual(haulerRole)
    // At the release instant there is no boundary at all — the fold is in a transfer gap.
    expect(authorityAtBoundary(custodyAt(shipment, releasedByAAt, evidence))).toBeUndefined()
  })

  it('A8-MOVE amended — a transfer gap is a custody UNKNOWN and NOT an authority vacuum', () => {
    const inGap = instant('2026-03-20T23:00:00Z')
    expect(custodyAt(shipment, inGap, evidence)).toMatchObject({ why: 'IN_TRANSFER_GAP' })
    // "Across a transfer gap (C5) the releasing role remains authoritative until the receipt."
    // The releasing role across gap 2 is the hauler — which is precisely the party that held the
    // last 349 receipt, so the rule needs no new input, only a second function over the same one.
    const authority = custodyAuthorityAt(shipment, inGap, evidence)
    expect(authority.authority).toBe('HELD')
    if (authority.authority !== 'HELD') return
    expect(authority.holder).toEqual(haulerRole)
    expect(authority.holder).toEqual(releaseHtoD.value.releasingParty)

    // …and a CUSTODY-bound row can therefore still be evaluated inside the gap.
    const verdict = authoritativeHolderAt('arrival', {
      at: inGap as AuthorityContext['at'],
      custody: custodyAt(shipment, inGap, evidence),
      custodyAuthority: authority,
    })
    expect(verdict).toEqual({
      kind: 'holder',
      holder: { kind: 'releasingRoleAcrossTransferGap', holder: haulerRole },
      rule: AUTHORITY_TABLE.arrival.rule,
    })

    // Without the amended rule supplied, the answer is the one A8 gave before it: no guess.
    expect(
      authoritativeHolderAt('arrival', {
        at: inGap as AuthorityContext['at'],
        custody: custodyAt(shipment, inGap, evidence),
      }),
    ).toEqual({ kind: 'custodyUnknown', rule: AUTHORITY_TABLE.arrival.rule })

    // And before anything at all is published, authority really is empty — A8-NAMED's case, and
    // the difference between "nobody has spoken" and "we are mid-transfer".
    expect(custodyAuthorityAt(shipment, loadedAt, evidence)).toMatchObject({
      authority: 'NONE',
      why: 'NO_SELECTED_RECEIPT_AT_OR_BEFORE_INSTANT',
    })
  })

  it('[SD §4.8] and nothing is stored — the answer is recomputed from the acts', () => {
    const answer = custodyAt(shipment, deliveredAt, evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(destinationAgentRole)
    expect(answer.rule).toEqual(CUSTODY_AT_RULE)
    expect(answer.evidencedBy).toContain(receiptHtoD.eventId)
    expect(answer.evidencedBy).toContain(eventId(`fr-${receiptHtoD.eventId}`))
  })
})

describe('[SD §4.7.2f] §2.3 — two parties, one transfer: which of them pair and which do not', () => {
  it('the RELEASE and the RECEIPT of one transfer are two facts and never pair', () => {
    // §2's verdict, and §0(1): "The pairing unit is one side of one transfer, not the transfer."
    // `src:stedi-x12-reference` element 1650 publishes them as two codes by two parties, which the
    // stedi analysis calls "two complementary assertions" — and [SD §4.3]'s machinery pairs
    // COMPETING assertions. A release at 14:05 and a receipt at 09:20 the next day are both true.
    expect(sameFactKey(factRefOf(releaseAtoH), factRefOf(receiptAtoH))).toBe(false)
    expect(releaseAtoH.value.occurredAt).not.toBe(receiptAtoH.value.occurredAt)
    // So no `FactResolved` is ever asked to choose between them: each resolution's `considered[]`
    // names records on one key only ([SD §4.3]).
    for (const resolution of evidence.resolutions) {
      expect(resolution.considered).toHaveLength(1)
    }
  })

  it('but two parties about the SAME side DO pair, and the fold reads the winner', () => {
    // §2.3: "Where two parties speak about the same side of the same transfer, they pair." Here the
    // hauler and the destination agent disagree about **who took the goods** — which is exactly what
    // `value.receivingParty` is for, and exactly what Q-KEY(iii) keeps OUT of the key, so that the
    // disagreement is a contest rather than two keys that never meet.
    const rivalReceipt = handover({
      id: 'h2-receipt-rival',
      qualifier: { ...receiptHtoD.qualifier },
      by: { party: haulerH, role: 'hauler' },
      said: '2026-03-21T09:00:00Z',
      context: [interchangeOnDelivery, deliveryTrip],
      at: receivedByDAt,
      releasingParty: haulerRole,
      // The hauler says it handed to the ORIGIN agent's man, not the destination agent.
      receivingParty: originAgentRole,
    })

    // One key, one contest — this is the case [SD §4.3] and [SD §4.5] already handle.
    expect(sameFactKey(factRefOf(receiptHtoD), factRefOf(rivalReceipt))).toBe(true)
    expect(rivalReceipt.value.receivingParty).not.toEqual(receiptHtoD.value.receivingParty)

    const contested: FactResolved<'handover'> = {
      ...resolutionFor(receiptHtoD),
      eventId: eventId('fr-h2-receipt-contested'),
      considered: [receiptHtoD.eventId, rivalReceipt.eventId],
      selected: receiptHtoD.eventId,
    }
    const withRival: CustodyEvidence = {
      handovers: [...HANDOVERS, rivalReceipt],
      resolutions: [...HANDOVERS.filter((h) => h !== receiptHtoD).map(resolutionFor), contested],
      legs: [],
    }

    // The fold reads the winner's party and nobody else's — and does NOT go ambiguous, because a
    // contest on one key has a winner, unlike C6's two facts on two keys at one instant.
    const answer = custodyAt(shipment, deliveredAt, withRival)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(destinationAgentRole)
    // The loser is not suppressed: [A8 §7.4(a)] — recorded, attributed, and named in `considered[]`.
    expect(contested.considered).toContain(rivalReceipt.eventId)
    expect(rivalReceipt.assertedBy).toEqual({ party: haulerH, role: 'hauler' })

    // And had the platform declined to select, the fold would not pick for it ([A8 §7.3]'s shape).
    const undecided: CustodyEvidence = {
      ...withRival,
      resolutions: [
        ...HANDOVERS.filter((h) => h !== receiptHtoD).map(resolutionFor),
        { ...contested, selected: null },
      ],
    }
    expect(custodyAt(shipment, deliveredAt, undecided)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
  })
})

describe('the resolution does NOT degenerate to recency', () => {
  it('sets the trap: A spoke last, and A lost', () => {
    expect(Date.parse(deliveryByA.assertedAt)).toBeGreaterThan(Date.parse(deliveryByD.assertedAt))
    expect(deliveryResolved.selected).toBe(deliveryByD.eventId)
    // Both claim the SAME occurrence instant, so this cannot be explained away as "one of them was
    // simply wrong about when". They pair on one fact key and one of them has to win.
    expect(deliveryByA.value.occurredAt).toBe(deliveryByD.value.occurredAt)
    expect(sameFactKey(factRefOf(deliveryByA), factRefOf(deliveryByD))).toBe(true)
  })

  it('[A8 §4.2] A8-INSTANT — authority is evaluated at the instant the fact is ABOUT', () => {
    // The clock that decides is on the VALUE. There is deliberately no constructor for a
    // `FactInstant` from `assertedAt` or `recordedAt`, so the recency reading cannot even be
    // spelled: it is not that we choose not to ask the declaration clock, it is that we cannot.
    expect(instantTheFactIsAbout(deliveryByA)).toEqual({ resolved: true, at: deliveredAt })
    expect(instantTheFactIsAbout(deliveryByD)).toEqual({ resolved: true, at: deliveredAt })

    const verdict = authoritativeHolderAt('delivery', contextAt(deliveryByA))
    expect(verdict).toEqual({
      kind: 'holder',
      holder: { kind: 'role', role: 'destinationAgent' },
      rule: AUTHORITY_TABLE.delivery.rule,
    })
  })

  it('[A8 §7.4] A8-AFTER — A is advisory, recorded, and never suppressed', () => {
    // (c): A never *had* authority for facts after the boundary, "so nothing is downgraded" — which
    // is stronger than "they stop being", because a stopping rule would force re-evaluation of
    // published resolutions whenever a custody record is corrected.
    expect(standingAfterBoundary('delivery', 'originAgent')).toBe('advisory')
    expect(listedStandingOf('delivery', 'originAgent')).toBe('advisory')
    // (a): not false, not retracted, not deleted — and in `considered[]`, by name.
    expect(deliveryResolved.considered).toContain(deliveryByA.eventId)
    // The published anti-pattern, avoided: `src:sirva-ade` GSD p.4 drops a replaced provider from
    // the Resource group entirely, so its assertions become unattributable. A's is still A's.
    expect(deliveryByA.assertedBy).toEqual({ party: originAgentA, role: 'originAgent' })
  })

  it("[A8 §7.6] and A's LOAD assertion, made at the same moment, is STILL authoritative", () => {
    // This is what separates A8-INSTANT from "the previous holder goes quiet". A keys both records
    // on 25 March from the same non-custodial position; the load's instant sits inside A's custody
    // interval and the delivery's does not, so the two are decided differently.
    const loadByA: CapturedAssertion<'loading'> = {
      eventId: eventId('l-A'),
      type: 'loading',
      specVersion: spec,
      subject: shipment,
      assertedBy: { party: originAgentA, role: 'originAgent' },
      assertedAt: instant('2026-03-25T09:02:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      context: [shuttleTrip],
      basis: 'ACTUAL',
      value: { occurredAt: loadedAt, outcome: 'COMPLETED' },
    }
    expect(Date.parse(loadByA.assertedAt)).toBeGreaterThan(Date.parse(receivedByHAt))
    // [A8 §5 r3]: `LoadAgent`, or `OriginAgent` where no separate load agent is assigned.
    expect(listedStandingOf('loading', 'originAgent')).toBe('authoritative')
    expect(
      authoritativeHolderAt('loading', {
        ...contextAt(loadByA),
        conditions: ['NO_SEPARATE_LOAD_AGENT_ASSIGNED'],
      }),
    ).toMatchObject({ kind: 'holder', holder: { kind: 'role', role: 'originAgent' } })
  })

  it('[A8 §4.4] A8-NAMED — and recency is not a published rule for this class either', () => {
    expect(recencyIsPublishedFor('delivery')).toBe(false)
    expect(deliveryResolved.rule).toEqual(ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'))
  })
})

describe('[A8 §7.3] A8-JOINT at the cross-dock — condition, per article', () => {
  /**
   * [A8 §7.6] item 2's correction: "`subject: item:*` was not a subject… it is **one Assertion per
   * article**". This is item i7's, and there is another pair for i8, i9, and so on.
   */
  const i7 = subjectRef('item', itemId('i7'))

  const conditionByA: CapturedAssertion<'condition'> = {
    eventId: eventId('cond-A'),
    type: 'condition',
    specVersion: spec,
    subject: i7,
    assertedBy: { party: originAgentA, role: 'originAgent' },
    assertedAt: instant('2026-03-03T14:20:00Z'),
    capturedBy: 'OBSERVED_BY_PERSON',
    // The releasing side sights the articles at **its own** stop — `stop:X1` on the shuttle trip.
    // There is no one stop both sides can name (see the two-stop note at the top of this file), and
    // that costs the pairing nothing: `context[]` is not the resolution key ([SD §1.4] rule 3), so
    // the two records below still pair on `(item:i7, condition)` and still resolve jointly.
    context: [shipment, crossDockOnShuttle],
    basis: 'ACTUAL',
    // **Owed.** No document fixes the condition vocabulary, so the value is carried as owed with a
    // non-normative provisional payload rather than invented.
    value: {
      owed: 'conditionValue',
      owedTo: 'A4 / A10 — no document fixes the condition vocabulary',
      provisional: 'sound, wrapped',
    },
  }

  const conditionByH: CapturedAssertion<'condition'> = {
    ...conditionByA,
    eventId: eventId('cond-H'),
    assertedBy: { party: haulerH, role: 'hauler' },
    assertedAt: instant('2026-03-03T14:35:00Z'),
    // …and the receiving side at its own — `stop:X2` on the linehaul trip.
    context: [shipment, crossDockOnLinehaul],
    value: {
      owed: 'conditionValue',
      owedTo: 'A4 / A10 — no document fixes the condition vocabulary',
      provisional: 'gouge to top panel, noted on the exception sheet',
    },
  }

  const jointResolution: FactResolved<'condition'> = {
    eventId: eventId('fr-condition-i7'),
    type: 'FactResolved',
    specVersion: spec,
    subject: i7,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-03-03T15:05:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: { subject: i7, type: 'condition' },
    // The deliberate non-selection. "the model does not pick."
    selected: null,
    considered: [conditionByA.eventId, conditionByH.eventId],
    rule: JOINT_AT_CUSTODY_BOUNDARY,
  }

  it('publishes both opinions and MUST NOT select one', () => {
    // The sentence the rule is cut from is a regulation: DP3 ToS NTS §1.6.10 — where the driver's
    // and the NTS representative's opinions differ, "**both opinions will be listed on the exception
    // sheet and separately identified as to source**."
    expect(jointRuleApplies('condition', true)).toBe(true)
    expect(jointResolutionIsWellFormed(jointResolution, true)).toBe(true)
    expect(
      jointResolutionIsWellFormed({ ...jointResolution, selected: conditionByH.eventId }, true),
    ).toBe(false)
    expect(sameFactKey(factRefOf(conditionByA), factRefOf(conditionByH))).toBe(true)
  })

  it('reaches the counts asserted with it, and only at a boundary', () => {
    // "the counts asserted with it" is `pieceCount` — which is why this rule reaches a type whose
    // own authority row is otherwise owed.
    expect(jointRuleApplies('pieceCount', true)).toBe(true)
    expect(jointRuleApplies('pieceCount', false)).toBe(false)
    expect(jointRuleApplies('delivery', true)).toBe(false)
  })

  it('and agreement is an affirmative record, not the absence of disagreement', () => {
    // NTS §1.6.10 again: where there is nothing to report the parties still write "no differences
    // noted", sign and date it. So a joint resolution over two agreeing sides MAY select.
    expect(
      jointResolutionIsWellFormed({ ...jointResolution, selected: conditionByA.eventId }, false),
    ).toBe(true)
  })
})

describe('OWED — [SD §10.5]: dwell classification to A5, custody authority to A8', () => {
  it('the cross-dock dwell has no classification in this layer, and now no holder either', () => {
    // [A8 §7.6]: "Goods dwelling on the cross-dock overnight between T1 and T2: whether that dwell
    // is a `stay`, a SIT occupancy or neither is **A5's** question."
    //
    // What CHANGED under [SD §4.7.2f]: the dwell between A's release and H's receipt is a **C5
    // transfer gap**, so the fold no longer answers who held the goods across it. That is not a
    // regression, it is [SD §4.8.3] rule 3's own second case finally being derived — and it is the
    // intended operational cost of foreclosure 2 ("custody can never move on one party's word").
    // A partner that emits only `J1` leaves a permanent `UNKNOWN` span, and ingest must be told so
    // before it is discovered in production.
    expect(custodyAt(shipment, instant('2026-03-03T23:00:00Z'), evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
    // Authority does not go dark with it — A8-MOVE as amended. Across THIS gap the releasing role
    // is the origin agent, and it is empty here only because no 349 receipt has landed yet.
    expect(custodyAuthorityAt(shipment, instant('2026-03-03T23:00:00Z'), evidence)).toMatchObject({
      authority: 'NONE',
      why: 'NO_SELECTED_RECEIPT_AT_OR_BEFORE_INSTANT',
    })
    // Calling the dwell a storage stay would mean publishing a `storeIn`, whose authority row is
    // itself owed — so the deferral is not costless and the test records that it is not. Whether a
    // SIT handling-in ALSO publishes a `handover` is expressly not settled by the F1 decision
    // (§7.5); it belongs with A5's storage boundary ([SD §10.4]).
    expect(hasAuthorityRow('storeIn')).toBe(false)
  })

  it('F3, resolved — the `handover` row is row 12, and its `boundBy` is `KEY` not `CUSTODY`', () => {
    // [SD §4.7.1]'s handover row is a SHAPE, not a standing table. Which side wins when the two
    // halves of a handover disagree cannot be answered by a `CUSTODY` binding, "because A8-MOVE
    // would then be defined in terms of the thing it defines" ([SD §4.8.2]) — and [SD §4.7.1] used
    // to give the row `boundBy = CUSTODY` anyway. The two sentences contradicted each other, and
    // F1's fix made the contradiction load-bearing, because the fold now depends on selecting among
    // paired handover assertions. [SD §4.7.2f] §7.4 resolves it: the binding is owed, expressly not
    // `CUSTODY`. Recorded as **F3** in `findings-from-alloy.md`, and now resolved there.
    // **F3 is closed, and the half that mattered is the one this line still checks:** the binding
    // is NOT `CUSTODY`. It is `KEY` — authority belongs to the role the fact's own qualifier names
    // (A8-KEY, [A8 §5] row 12), which reads the key rather than the fold and so cannot define
    // A8-MOVE in terms of the thing it defines.
    expect(hasAuthorityRow('handover')).toBe(true)
    const handover = AUTHORITY_TABLE.handover
    expect(handover.boundBy).not.toBe('CUSTODY')
    expect(handover.boundBy).toBe('KEY')
    expect(handover.a8Row).toBe(12)
    expect(handover.authoritative).toMatchObject({
      kind: 'held',
      primary: { kind: 'keySideRole' },
    })
    // Exactly one authoritative role, so A8-NAMED never fires and the row names no tie-break.
    expect('tieBreak' in handover).toBe(false)
    expect(recencyIsPublishedFor('handover')).toBe(false)
  })

  it('F2 — the receiving side now comes off an authoritative, LABELLED field', () => {
    // This block used to withhold a named `receivingSides` input and watch the fold say
    // `RECEIVING_SIDE_NOT_PUBLISHED`. That input is retired: [SD §4.8.3] returned the holder "from
    // the selected handover's **receiving side**" while [SD §4.7.1] put the two `partyRole`s in
    // `context[]`, which [SD §1.4] rules 2 and 3 make valueless, non-authoritative and unlabelled —
    // so the fold was reading an authoritative output off a non-authoritative field. [SD §4.7.2f]
    // §0(4) moves both parties into `value`.
    for (const handoverAssertion of HANDOVERS) {
      expect(handoverAssertion.value.receivingParty).toBeDefined()
      expect(handoverAssertion.value.releasingParty).toBeDefined()
      // And the deletion that closes the second home: `partyRole` has LEFT `context[]`.
      for (const ref of handoverAssertion.context ?? []) {
        expect(ref.aggregate).not.toBe('partyRole')
      }
    }
    // The reason is gone from the vocabulary, not merely unused.
    expect(CUSTODY_UNKNOWN_REASONS).not.toContain('RECEIVING_SIDE_NOT_PUBLISHED')
    expect(CUSTODY_UNKNOWN_REASONS).toEqual([
      'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
      'IN_TRANSFER_GAP',
      'AMBIGUOUS_ORDER_AT_INSTANT',
    ])
  })
})
