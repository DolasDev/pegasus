/**
 * **Scenario 3 — delivery attempted twice: customer absent, then refused for damage, two items
 * short.**
 *
 * The critique's headline failure, and it failed in all three documents at once: A3's `StopAction`
 * had "a quantity and a result — with no result vocabulary and no item grain"; `fork-order`'s only
 * sub-shipment device was "far too heavy for two items, and too light for a claim"; `fork-time`'s
 * `OccurrenceEvent.type` was `Delivery.Completed`, which bakes the outcome into the type name.
 *
 * [SD §2.6] works the scenario verbatim and this file is that worked example, executed. The three
 * decisions it rests on are [SD §2] (an `outcome` + structured `reasons[]` on every act), [SD §2.5]
 * (**A-TYPE** — the type names the act and never the outcome) and [SD §3.4] (the required form for
 * "delivered, two items short": one act, one reason, one `ENUMERATED` Portion).
 */
import { describe, expect, it } from 'vitest'

import {
  CANONICAL_SUBJECT_FAMILY,
  REASON_CODE_OTHER,
  canSupportClaim,
  checkCaptureOf,
  enumeratedSubsetOf,
  eventId,
  factRefOf,
  grainFor,
  instant,
  isAssertionType,
  isWellFormedActOutcome,
  itemId,
  partyId,
  portionId,
  reasonCode,
  reasonsAreRequired,
  roleClass,
  sameFactKey,
  shipmentId,
  specVersion,
  stayId,
  stopId,
  subjectRef,
  type CapturedAssertion,
  type Portion,
  type Reason,
  type Remedy,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S-7702'))
const firstAttempt = subjectRef('stop', stopId('ST-T1'))
const secondAttempt = subjectRef('stop', stopId('ST-T2'))

const destinationAgent = { party: partyId('P-DEST-CO'), role: 'destinationAgent' } as const

/** The party `PARTY_ABSENT` attributes to. [A4 §3] makes naming them mandatory for this code. */
const customer = partyId('P-CUSTOMER')

/** The armchair with the torn arm, and the crate nobody could find — two articles, named. */
const armchair = itemId('INV-0041')
const crate = itemId('INV-0107')
const alsoShort = itemId('INV-0108')

/**
 * [SD §3.4]: the refused articles and the short articles are two **Portions**, not a quantity.
 * "Not a quantity (that has no identity to refer back to when the two items surface in SIT a week
 * later.)" Both are `ENUMERATED`, which is also what lets them support a claim (**P-CLAIM**).
 */
const refusedForDamage: Portion = {
  portionId: portionId('P-DAMAGED'),
  shipment,
  // [A4 §4] rejected `REFUSED_DAMAGE`: it encodes the outcome in a verb, which [SD §2.4] rule 1
  // forbids. `GOODS_DAMAGED` is the one code, and the outcome axis says whether it was accepted.
  basis: reasonCode('GOODS_DAMAGED'),
  membership: 'ENUMERATED',
  enumeration: { items: [armchair] },
}

const shortOnDelivery: Portion = {
  portionId: portionId('P-SHORT'),
  shipment,
  basis: reasonCode('GOODS_MISSING'),
  membership: 'ENUMERATED',
  enumeration: { items: [crate, alsoShort] },
}

/**
 * [SD §2.6], first record. `src:shippeo` `REN/DAF` consignee-absent, with the required `new_slot` —
 * "a failed delivery that does not say when it will be retried is an incomplete record" ([SD §2.4]).
 *
 * The code is `PARTY_ABSENT`, not [SD §2.6]'s `CONSIGNEE_ABSENT`: [A4 §4] rejected that spelling
 * because it bakes a role into the code, which [SD §2.4] rule 6 forbids in as many words. The
 * remedy is no longer owed — {@link NewWindow} is the one shape [SD §2.4] rule 5 sources, and
 * `PARTY_ABSENT` is one of the two codes that **require** it.
 */
const partyAbsent: Reason = {
  code: reasonCode('PARTY_ABSENT'),
  scope: 'PARTY',
  attribution: { party: customer, roleClass: roleClass('customer') },
  remedy: {
    newWindow: { start: instant('2026-05-02T08:00:00Z'), end: instant('2026-05-02T12:00:00Z') },
  },
}

const attemptOne: CapturedAssertion<'delivery'> = {
  eventId: eventId('D-T1'),
  type: 'delivery',
  specVersion: spec,
  subject: shipment,
  assertedBy: destinationAgent,
  assertedAt: instant('2026-04-30T10:15:00Z'),
  capturedBy: 'OBSERVED_BY_PERSON',
  context: [firstAttempt],
  basis: 'ACTUAL',
  value: {
    occurredAt: instant('2026-04-30T10:05:00Z'),
    outcome: 'NOT_COMPLETED',
    reasons: [partyAbsent],
  },
}

/**
 * [SD §2.6], second record. Two reasons on **one** act: `src:shippeo` `REN/AVA` refused-for-damage
 * and `LIV/MQP` delivered-but-short, each scoped by an `appliesTo` Portion.
 *
 * `PARTIALLY_COMPLETED` rather than `COMPLETED_WITH_EXCEPTION` because [SD §2.2] separates the two
 * on **scope of performance**: part of the goods did not arrive, which is a billing and claims
 * difference rather than a shade of meaning.
 */
const attemptTwo: CapturedAssertion<'delivery'> = {
  eventId: eventId('D-T2'),
  type: 'delivery',
  specVersion: spec,
  subject: shipment,
  assertedBy: destinationAgent,
  assertedAt: instant('2026-05-02T14:50:00Z'),
  capturedBy: 'OBSERVED_BY_PERSON',
  context: [secondAttempt],
  basis: 'ACTUAL',
  value: {
    occurredAt: instant('2026-05-02T14:20:00Z'),
    outcome: 'PARTIALLY_COMPLETED',
    reasons: [
      {
        code: reasonCode('GOODS_DAMAGED'),
        scope: 'GOODS',
        attribution: { roleClass: roleClass('carrier') },
        appliesTo: [subjectRef('portion', refusedForDamage.portionId)],
      },
      {
        code: reasonCode('GOODS_MISSING'),
        scope: 'GOODS',
        attribution: { roleClass: roleClass('unknown') },
        appliesTo: [subjectRef('portion', shortOnDelivery.portionId)],
      },
    ],
  },
}

describe('[SD §2.5] A-TYPE — the type names the act, twice over', () => {
  it('has no `attempt` type: an attempted delivery is `delivery` + NOT_COMPLETED', () => {
    // [SD §10.1 item 20]: "**`attempt` is not a type at all** — A-TYPE forbids a type that names the
    // outcome, and §2.6 already works this exact scenario."
    expect(isAssertionType('attempt')).toBe(false)
    expect(attemptOne.type).toBe('delivery')
    expect(attemptOne.value.outcome).toBe('NOT_COMPLETED')
  })

  it('has no `Delivery.Completed` either — the defect `fork-time` published', () => {
    // Sourced from a defect report: Shippeo's `…PartiallyMissing` schema declaring
    // `event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — "the event name must be an alias for the code
    // pair and never the identity."
    expect(isAssertionType('Delivery.Completed')).toBe(false)
    expect(isAssertionType('delivery')).toBe(true)
  })

  it('so both attempts land on ONE fact key, and the catalog holds both records', () => {
    // Two visits, one contested fact: whether and how this shipment was delivered. The stops differ
    // and they ride in `context[]`, which [SD §1.3] does not read.
    expect(sameFactKey(factRefOf(attemptOne), factRefOf(attemptTwo))).toBe(true)
    expect(attemptOne.context).not.toEqual(attemptTwo.context)
  })
})

describe('[SD §2.3] invariant 2 — an exception always says why', () => {
  it('requires a reason on every outcome but COMPLETED', () => {
    expect(reasonsAreRequired('COMPLETED')).toBe(false)
    expect(reasonsAreRequired('NOT_COMPLETED')).toBe(true)
    expect(reasonsAreRequired('PARTIALLY_COMPLETED')).toBe(true)
    expect(isWellFormedActOutcome(attemptOne.value)).toBe(true)
    expect(isWellFormedActOutcome(attemptTwo.value)).toBe(true)
    // …and forbids one where the act completed — `src:shippeo`'s always-paired `CFM` normalised.
    expect(isWellFormedActOutcome({ outcome: 'COMPLETED' })).toBe(true)
  })

  it('[SD §5.2] M3 — and a machine may not assert the exception', () => {
    // A geofence can witness a departure; it cannot witness that the consignee was out. M2 reaches
    // this record first, because a delivery is possession-changing, and refuses it there; M3 is what
    // would refuse the same record for a non-possession-changing act.
    const byGeofence = { ...attemptOne, capturedBy: 'DEVICE_GEOFENCE' } as const
    expect(checkCaptureOf(byGeofence)).toMatchObject({
      verdict: 'REJECTED',
      rejection: { rule: 'M2', code: 'POSSESSION_CHANGING_NEEDS_HUMAN_OR_PARTNER' },
    })
    // Keyed by the agent who was standing there, it is admitted.
    expect(checkCaptureOf(attemptOne)).toMatchObject({ verdict: 'ADMITTED' })
  })
})

describe('[SD §3.4] the required form for "delivered, two items short"', () => {
  it('is one act with a scoped reason — never two acts and never a quantity', () => {
    // "Not two acts (that double-counts the visit and erases the fact that a delivery happened)."
    // [SD §2.3] invariant 2 is in the type, so `reasons` is absent on the `COMPLETED` arm and the
    // compiler makes a reader narrow before reading it. That is the invariant, not an inconvenience.
    const reasons = attemptTwo.value.reasons
    expect(reasons).toHaveLength(2)
    expect(reasons?.[0]?.appliesTo).toEqual([subjectRef('portion', portionId('P-DAMAGED'))])
    expect(reasons?.[1]?.appliesTo).toEqual([subjectRef('portion', portionId('P-SHORT'))])
    // [SD §3.3]: "**The `quantity` field is deleted.** A quantity floating on an act is a measure
    // with no identity, so a second act cannot say 'the same part'."
    expect(attemptTwo.value).not.toHaveProperty('quantity')
  })

  it('[SD §1.1] and `appliesTo` is a scope, not a second subject', () => {
    // The Portions are the scope of one asserted value. The fact key does not read them, so naming
    // them does not split the contest — which is what lets the shortfall be learned later.
    expect(factRefOf(attemptTwo)).toEqual({ subject: shipment, type: 'delivery' })
  })

  it('[SD §3.2] P-CLAIM — the refused articles can support a claim because they are named', () => {
    expect(canSupportClaim(refusedForDamage)).toBe(true)
    expect(canSupportClaim(shortOnDelivery)).toBe(true)
    // A subset known only by weight cannot: "A claim addresses items… and **the catalog says so**
    // rather than leaving a consumer to discover it."
    const weighedOnly: Portion = {
      portionId: portionId('P-GUESS'),
      shipment,
      basis: reasonCode('GOODS_MISSING'),
      membership: 'MEASURED',
      measure: { weight: { amount: 240, unit: 'lb' } },
    }
    expect(canSupportClaim(weighedOnly)).toBe(false)
  })

  it('[SD §3.2] P-OVERLAP — and the two missing crates may later nest inside a SIT Portion', () => {
    // "'The twelve items that went into SIT' and 'the three of those refused on delivery-out' are
    // both Portions, and the second is a subset of the first."
    const intoStorage: Portion = {
      portionId: portionId('P-SIT'),
      shipment,
      basis: reasonCode('GOODS_MISSING'),
      membership: 'ENUMERATED',
      enumeration: { items: [crate, alsoShort, armchair] },
    }
    expect(enumeratedSubsetOf(shortOnDelivery, intoStorage)).toBe(true)
    expect(enumeratedSubsetOf(intoStorage, shortOnDelivery)).toBe(false)
  })

  it('[SD §5.4] the damage itself is an `item`-grain fact, and the refusal is a Portion', () => {
    // "does this fact have a different value for each article, or does it have one value and a
    // scope?" The armchair's condition differs per article; "refused" is one value with a scope.
    expect(grainFor(true)).toBe('item')
    expect(grainFor(false)).toBe('portion')
  })
})

describe('A4 — the vocabulary this scenario now names, and what is still owed', () => {
  it('every code here is a published member, and an unpublished one is refused', () => {
    // While the vocabulary was owed, `reasonCode` could only reject the empty string and every
    // literal in this file was visibly a placeholder. [A4 §3] published the list, so the constructor
    // is now a boundary check — **E-TYPE**'s discipline ([SD §1.3]) one axis over.
    expect(reasonCode('GOODS_MISSING')).toBe('GOODS_MISSING')
    expect(() => reasonCode('SHORT')).toThrow(/not a published reason code/)
    expect(() => reasonCode('CONSIGNEE_ABSENT')).toThrow(/not a published reason code/)
    expect(() => reasonCode('REFUSED_DAMAGE')).toThrow(/not a published reason code/)
    // `OTHER` is the one code the shape itself declares, and it carries an obligation the published
    // ones do not — a mandatory narrative. Passing it through the constructor is refused.
    expect(() => reasonCode(REASON_CODE_OTHER)).toThrow(/declared by \[SD §2\.4\]/)
    const withNarrative: Reason = {
      code: REASON_CODE_OTHER,
      remark: 'crate opened at the dock; contents not matched to the inventory',
      scope: 'GOODS',
      attribution: { roleClass: roleClass('unknown') },
    }
    expect(withNarrative.remark).not.toBe('')
  })

  it('the new delivery window is typed, and so is the other branch — a stay opens', () => {
    // [SD §2.4] rule 5's one sourced shape. `src:shippeo`'s `new_slot {start, end}` is REQUIRED on
    // appointment events, and [A4 §3] makes `PARTY_ABSENT` one of the two codes that require it.
    const remedy = partyAbsent.remedy
    expect(remedy !== undefined && 'newWindow' in remedy).toBe(true)
    // [A5 §3.2] discharged what A4 left owed: the remedy that opens a storage-in-transit stay —
    // `src:shippeo`'s "deepest structural gap", where in freight an exception is a retry and in
    // household goods it starts a whole new phase. The union is now two shapes and no `Owed`.
    const sitRemedy: Remedy = {
      opensStay: {
        stay: subjectRef('stay', stayId('SIT-2291')),
        location: 'DESTINATION',
      },
    }
    expect('opensStay' in sitRemedy && sitRemedy.opensStay.location).toBe('DESTINATION')
    // A remedy is a promise, not a performance: nothing here asserts anything about the stay. The
    // first record that does is a `storeIn` whose ENVELOPE subject is this same aggregate
    // ([SD §5.3]), which is why the forward ref is not [SD §1.1]'s second subject.
    expect(CANONICAL_SUBJECT_FAMILY.storeIn).toBe('stay')
  })

  it('and the role class is owed too — three examples are not a vocabulary', () => {
    // [SD §2.4] rule 6 makes attribution structured and sources the fact that reason vocabularies
    // are organised by responsible party; no document publishes the class list, and [A8 §9 item 2]
    // owes the role enum it would be cut from.
    expect(partyAbsent.attribution.roleClass).toBe('customer')
    // `party` is optional BY DEFAULT and required per code: [A4 §3] sets `partyRequired` on every
    // PARTY-scope member, because a party-side reason that cannot name the party is the `DIV`
    // overload invariant 2 exists to remove.
    expect(partyAbsent.attribution.party).toBe(customer)
    expect(attemptTwo.value.reasons?.[1]?.attribution.roleClass).toBe('unknown')
  })
})
