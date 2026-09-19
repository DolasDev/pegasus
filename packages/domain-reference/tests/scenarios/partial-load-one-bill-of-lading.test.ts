/**
 * **Scenario 9 — a partial load: half the goods today, half next week, one bill of lading.**
 *
 * The critique passed this one and still failed the model on it: "expressible here as two `load`
 * actions with quantities, but the parallel document expresses the identical physical fact as a
 * `Portion` entity, and neither references the other." Its must-fix #3 is the instruction: "**Pick
 * one sub-shipment grain and make everything use it** — partial load, split delivery, overflow, SIT
 * remainder, refused items and short deliveries are one phenomenon with four models across three
 * documents today."
 *
 * [SD §3] picks the **Portion**, and with it deletes the alternative outright: "**There is no
 * quantity field on any act.** A quantity floating on an act is a measure with no identity, so a
 * second act cannot say 'the same part'." Next week's crew has to be able to say *the same part*,
 * which is the whole reason this scenario is a test of the grain rather than of loading.
 *
 * One bill of lading is the other half: **P-IDENTITY** — "A Portion never changes the shipment
 * boundary. Minting a Portion is not splitting a shipment."
 */
import { describe, expect, it } from 'vitest'

import {
  PORTION_MEMBERSHIP_FACT_CLASS,
  SUBJECT_FAMILIES,
  admitSubject,
  canSupportClaim,
  enumeratedSubsetOf,
  eventId,
  factRefOf,
  instant,
  isLegalMembershipTransition,
  isSingletonFamily,
  itemId,
  itemsOf,
  documentId,
  owedCode,
  partyId,
  portionId,
  reasonCode,
  sameFactKey,
  sameIdentityFactKey,
  schemeName,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type CapturedAssertion,
  type IdentityFactKey,
  type Portion,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S-6031'))
const residence = subjectRef('stop', stopId('ST-ORIGIN'))
const todaysTrip = subjectRef('trip', tripId('T-DAY1'))
const nextWeeksTrip = subjectRef('trip', tripId('T-DAY8'))

const loadAgent = { party: partyId('P-ORIGIN-CO'), role: 'loadAgent' } as const
const vanLine = partyId('P-VANLINE')

const todayAt = instant('2026-10-05T15:30:00Z')
const nextWeekAt = instant('2026-10-12T14:10:00Z')

/**
 * Today's half, minted `MEASURED`. **Rule P-MEMBER**'s own case: "the crew often knows the weight
 * and not the contents" — `src:dp3-400ng` Item 17.13 requires "the **actual weight** of the portion",
 * and `src:sirva-ade`'s `Overflow` event carries `Weight` and nothing else.
 */
const firstHalfAtMint: Portion = {
  portionId: portionId('P-DAY1'),
  shipment,
  basis: reasonCode('PARTIAL_LOAD'),
  membership: 'MEASURED',
  measure: { weight: { amount: 4120, unit: 'lb' }, pieceCount: 63 },
}

/** The same Portion after the inventory is reconciled — **the same `portionId`**. */
const firstHalfEnumerated: Portion = {
  portionId: portionId('P-DAY1'),
  shipment,
  basis: reasonCode('PARTIAL_LOAD'),
  membership: 'BOTH',
  measure: { weight: { amount: 4120, unit: 'lb' }, pieceCount: 63 },
  // `src:x12-212-trailer-manifest` `MAN-02`/`MAN-03`: the inventory-sticker series as a start–end
  // range, "without inventing anything".
  enumeration: { marks: { markFrom: '0001', markTo: '0063' } },
}

/** Next week's half, enumerated from the start because the remainder is what is left on the floor. */
const secondHalf: Portion = {
  portionId: portionId('P-DAY8'),
  shipment,
  basis: reasonCode('PARTIAL_LOAD'),
  membership: 'ENUMERATED',
  enumeration: { items: [itemId('INV-0064'), itemId('INV-0065'), itemId('INV-0066')] },
}

/**
 * [SD §3.3]: "The act's subject is the shipment and `reasons[].appliesTo` names a Portion; **or, for
 * a separately-timed act, the act names the Portion directly.**" A week apart is as separately-timed
 * as it gets, so each load names its own Portion — which is legal because `loading`'s canonical
 * family is `goods = {shipment, portion}` ([SD §4.7] note 2).
 */
const loadToday: CapturedAssertion<'loading'> = {
  eventId: eventId('L-DAY1'),
  type: 'loading',
  specVersion: spec,
  subject: subjectRef('portion', firstHalfAtMint.portionId),
  assertedBy: loadAgent,
  assertedAt: instant('2026-10-05T15:45:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [residence, todaysTrip, shipment],
  basis: 'ACTUAL',
  value: { occurredAt: todayAt, outcome: 'COMPLETED' },
}

const loadNextWeek: CapturedAssertion<'loading'> = {
  eventId: eventId('L-DAY8'),
  type: 'loading',
  specVersion: spec,
  subject: subjectRef('portion', secondHalf.portionId),
  assertedBy: loadAgent,
  assertedAt: instant('2026-10-12T14:25:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [residence, nextWeeksTrip, shipment],
  basis: 'ACTUAL',
  value: { occurredAt: nextWeekAt, outcome: 'COMPLETED' },
}

/**
 * The alternative form [SD §3.3] licenses for the same physical fact — one shipment-subject act,
 * `PARTIALLY_COMPLETED`, with the Portion named as the scope of a reason. Both are legal; what is
 * illegal in both is a quantity.
 */
const loadTodayShipmentPhrased: CapturedAssertion<'loading'> = {
  eventId: eventId('L-DAY1-ALT'),
  type: 'loading',
  specVersion: spec,
  subject: shipment,
  assertedBy: loadAgent,
  assertedAt: instant('2026-10-05T15:45:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [residence, todaysTrip],
  basis: 'ACTUAL',
  value: {
    occurredAt: todayAt,
    outcome: 'PARTIALLY_COMPLETED',
    reasons: [
      {
        code: reasonCode('PARTIAL_LOAD'),
        scope: 'ACT',
        attribution: { roleClass: owedCode('roleClass', 'carrier') },
        appliesTo: [subjectRef('portion', firstHalfAtMint.portionId)],
      },
    ],
  },
}

describe('[SD §3] one grain — and the quantity is gone', () => {
  it('names a Portion on each act, so next week\'s crew can say "the same part"', () => {
    expect(SUBJECT_FAMILIES.goods).toEqual(['shipment', 'portion'])
    expect(isSingletonFamily('goods')).toBe(false)
    expect(admitSubject('loading', subjectRef('portion', portionId('P-DAY1'))).admitted).toBe(true)
    expect(loadToday.subject.aggregate).toBe('portion')
    expect(loadNextWeek.subject.aggregate).toBe('portion')
  })

  it('[SD §3.3] carries no quantity on either act, in either form', () => {
    // "**The `quantity` field is deleted.**" It is `quantity?: never` in the type at every basis,
    // so neither form can spell it; what is observable at runtime is that neither carries one.
    expect(loadToday.value).not.toHaveProperty('quantity')
    expect(loadNextWeek.value).not.toHaveProperty('quantity')
    expect(loadTodayShipmentPhrased.value).not.toHaveProperty('quantity')
  })

  it('makes the two loads two fact keys, so they do not contest each other', () => {
    // Two separately-timed acts on two subsets are two facts, not one fact asserted twice. That is
    // what the Portion's identity buys, and what a quantity could never have expressed.
    expect(sameFactKey(factRefOf(loadToday), factRefOf(loadNextWeek))).toBe(false)
    expect(factRefOf(loadToday)).toEqual({
      subject: subjectRef('portion', portionId('P-DAY1')),
      type: 'loading',
    })
  })

  it('and the shipment-phrased form says the same thing with a scoped reason', () => {
    // [SD §3.3]'s OTM row: sub-results "published as `appliesTo` refs on the reasons of one act,
    // because our envelope has no nesting and because the shortfall is frequently learned after the
    // act was published."
    const reasons = loadTodayShipmentPhrased.value.reasons
    expect(reasons?.[0]?.appliesTo).toEqual([subjectRef('portion', portionId('P-DAY1'))])
    // The scope is not a second subject: the fact key is still the shipment's.
    expect(factRefOf(loadTodayShipmentPhrased)).toEqual({ subject: shipment, type: 'loading' })
  })
})

describe('[SD §3.2] P-MEMBER — knowledge may be added and never removed', () => {
  it("lets today's half become ENUMERATED under the same portionId", () => {
    expect(firstHalfAtMint.portionId).toBe(firstHalfEnumerated.portionId)
    expect(isLegalMembershipTransition('MEASURED', 'ENUMERATED')).toBe(true)
    expect(isLegalMembershipTransition('MEASURED', 'BOTH')).toBe(true)
    expect(isLegalMembershipTransition('ENUMERATED', 'BOTH')).toBe(true)
  })

  it('and forbids every narrowing transition — the load-bearing half of the rule', () => {
    // DECISION recorded in `portion.ts`: the rule names one direction and is read as knowledge
    // monotonicity. "The narrowing half is the load-bearing one: it is what stops a Portion that has
    // supported a claim under P-CLAIM from quietly ceasing to."
    expect(isLegalMembershipTransition('BOTH', 'MEASURED')).toBe(false)
    expect(isLegalMembershipTransition('BOTH', 'ENUMERATED')).toBe(false)
    expect(isLegalMembershipTransition('ENUMERATED', 'MEASURED')).toBe(false)
  })

  it('[SD §3.2] P-CLAIM — and only the enumerated forms can support a claim', () => {
    expect(canSupportClaim(firstHalfAtMint)).toBe(false)
    expect(canSupportClaim(firstHalfEnumerated)).toBe(true)
    expect(canSupportClaim(secondHalf)).toBe(true)
  })

  it("[SD §3.2] P-OVERLAP — and next week's half may later nest inside a bigger Portion", () => {
    const everythingLeftBehind: Portion = {
      portionId: portionId('P-REMAINDER'),
      shipment,
      basis: reasonCode('PARTIAL_LOAD'),
      membership: 'ENUMERATED',
      enumeration: {
        items: [itemId('INV-0064'), itemId('INV-0065'), itemId('INV-0066'), itemId('INV-0067')],
      },
    }
    expect(enumeratedSubsetOf(secondHalf, everythingLeftBehind)).toBe(true)
    // A mark range has no item members to compare — the same asymmetry P-CLAIM rests on.
    expect(itemsOf(firstHalfEnumerated)).toBeUndefined()
    expect(enumeratedSubsetOf(firstHalfEnumerated, everythingLeftBehind)).toBe(false)
  })
})

describe('[SD §3.2] P-IDENTITY — one bill of lading, and it stays one', () => {
  const bolScheme = schemeName('vanline.bol')
  const bolKey: IdentityFactKey<'shipment'> = {
    subject: shipment,
    scheme: bolScheme,
    vocabularyScope: { authority: vanLine, brand: 'MAYFLOWER', year: 2026 },
  }

  const billOfLading: CapturedAssertion<'identity'> = {
    eventId: eventId('ID-BOL'),
    type: 'identity',
    specVersion: spec,
    subject: shipment,
    assertedBy: { party: vanLine, role: 'hauler' },
    assertedAt: instant('2026-10-05T07:00:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    context: [subjectRef('document', documentId('DOC-BOL-6031'))],
    qualifier: { scheme: bolScheme, vocabularyScope: bolKey.vocabularyScope },
    basis: 'ACTUAL',
    value: {
      // [SD §7.1]: "verbatim as the counterparty gave it; **never canonicalised in storage**".
      id: '600-6031-4',
      issuer: vanLine,
      effectiveFrom: instant('2026-10-05T07:00:00Z'),
    },
  }

  it('leaves the shipment boundary untouched — minting a Portion is not a split', () => {
    // Both Portions name the same shipment, and a Portion "never spans shipments". The BL is a fact
    // about the shipment and neither load reaches it.
    expect(firstHalfAtMint.shipment).toEqual(shipment)
    expect(secondHalf.shipment).toEqual(shipment)
    expect(factRefOf(billOfLading).subject).toEqual(shipment)
  })

  it('[SD §7.1] I-KEY — the BL keys on (subject, scheme, vocabularyScope), not on the Portions', () => {
    expect(sameIdentityFactKey(bolKey, { ...bolKey, subject: shipment })).toBe(true)
    // A second van line's brand scope is a DIFFERENT key, not a loser: "an agent booking for two
    // van lines holds two registrations under the one scheme with different brand scopes, both
    // concurrently valid" (revision 3 defect D).
    expect(
      sameIdentityFactKey(bolKey, {
        ...bolKey,
        vocabularyScope: { ...bolKey.vocabularyScope, brand: 'UNITED' },
      }),
    ).toBe(false)
  })

  it('[SD §7.5] and `primary` is derived, never stored on the record', () => {
    expect(billOfLading.value).not.toHaveProperty('primary')
    // "The reissued-BOL problem is solved by the interval, not by a new field… No `issuedAt` field
    // is added." Which is what keeps one BL across two load days: the interval is still open.
    expect(billOfLading.value).not.toHaveProperty('issuedAt')
    expect(billOfLading.value.effectiveTo).toBeUndefined()
  })
})

describe('OWED — the Portion is asserted, and no type carries the assertion', () => {
  it('[SD §3.1] vs [SD §4.7.1]: two parties cannot contest which goods went today', () => {
    // [SD §3.1]: "A Portion is itself asserted (§4) — it is a claim about which goods form a subset,
    // **by a party, at a time, and two parties can disagree about it**." [SD §1.3] makes §4.7.1 the
    // complete declaration and it has no membership fact class, so under **E-TYPE** the assertion
    // §3.1 requires has no legal `type`.
    //
    // This scenario is where that bites hardest: the crew says 63 pieces went today and the
    // customer says 61, and the disagreement has nowhere to be published. Recorded as owed rather
    // than minted — "minting a vocabulary member is [SD §4.7]'s to do, and no other document may
    // declare a family."
    expect(PORTION_MEMBERSHIP_FACT_CLASS.owed).toBe('portionMembership')
    expect(PORTION_MEMBERSHIP_FACT_CLASS.owedTo).toContain('[SD §4.7.1]')
    expect(PORTION_MEMBERSHIP_FACT_CLASS.owedTo).toContain('no declared type carries the assertion')
  })

  it("OWED: and the Portion's own measure carries the same unpublished unit vocabulary", () => {
    // `PortionMeasure.weight.unit` is a bare string where `MeasureValue.unit` is an owed code — the
    // two shapes describe the same unpublished vocabulary and do not yet read from one place.
    expect(firstHalfAtMint.measure.weight?.unit).toBe('lb')
    expect(owedCode('unitOfMeasure', 'lb')).toBe('lb')
  })

  it('[A8 §9 item 8] and `pieceCount` away from a custody boundary has no authority row', () => {
    // "63 pieces today" is exactly a piece count away from a boundary — A8-JOINT does not reach it,
    // and nothing else does either.
    const countedToday: CapturedAssertion<'pieceCount'> = {
      eventId: eventId('PC-DAY1'),
      type: 'pieceCount',
      specVersion: spec,
      subject: subjectRef('portion', firstHalfAtMint.portionId),
      assertedBy: loadAgent,
      assertedAt: instant('2026-10-05T15:50:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      // [SD §4.7.2a] `AT8-04` non-unitized vs `AT8-05` unitized: "two separate counts that sum to
      // one total", which is why the qualifier exists rather than two types.
      qualifier: { unitization: 'NON_UNITIZED' },
      basis: 'ACTUAL',
      value: { count: 63 },
    }
    expect(factRefOf(countedToday)).toEqual({
      subject: subjectRef('portion', firstHalfAtMint.portionId),
      type: 'pieceCount',
      qualifier: { unitization: 'NON_UNITIZED' },
    })
    // The unitized count is a different fact key, so the two never contest.
    expect(
      sameFactKey(factRefOf(countedToday), {
        subject: subjectRef('portion', firstHalfAtMint.portionId),
        type: 'pieceCount',
        qualifier: { unitization: 'UNITIZED' },
      }),
    ).toBe(false)
  })
})
