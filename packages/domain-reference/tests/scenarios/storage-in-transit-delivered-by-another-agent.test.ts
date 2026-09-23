/**
 * **Scenario 2 — goods into storage-in-transit, delivered from the warehouse six weeks later by a
 * DIFFERENT agent.**
 *
 * [round-2-critique] rated this one twice and failed it twice: A3's discharge "requires a warehouse-
 * crew delivery day to be a Trip — the same open §6.3", and `fork-time`'s SIT start was a derived
 * actual whose correction cascade was "a correction to a warehouse-authoritative, legally
 * load-bearing date, declared by the platform, with no authority the model grants it."
 *
 * Three decisions close it. [SD §5.3] makes the store-in **act** and the SIT entry **date** two fact
 * classes with different subjects, asserters and capture rules. [SD §6.6] makes the cascade a new
 * derived Assertion rather than a correction. [SD §8] gives the warehouse delivery-out a home —
 * either a Trip with one Stop ([SD §8.4]) or, where the performing party is somebody else's, an
 * `ExternallyPerformedLeg`. This file takes the second, because "a DIFFERENT agent" is precisely
 * §8's case.
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITY_TABLE,
  CANONICAL_SUBJECT_FAMILY,
  HANDED_OVER,
  STAY_LOCATIONS,
  authoritativeHolderAt,
  calendarDate,
  cascadeOnRetractedInput,
  checkCaptureOf,
  custodyAt,
  eventId,
  factRefOf,
  externallyPerformedLegId,
  instant,
  instantTheFactIsAbout,
  isAggregateKind,
  listedStandingOf,
  partyId,
  partyRoleId,
  ruleRef,
  shipmentId,
  specVersion,
  stayId,
  stopId,
  subjectRef,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type CustodyHolder,
  type ExternallyPerformedLeg,
  type FactResolved,
  type Remedy,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S-4417'))
/** [SD §10.4]: "the `stay` is an aggregate with its own identity and its own subject kind." */
const stay = subjectRef('stay', stayId('SIT-4417'))
const warehouseDock = subjectRef('stop', stopId('ST-WH'))

const warehouseman = partyId('P-KEENE-WAREHOUSE')
const hauler = partyId('P-VANLINE')
/** Six weeks later the goods go out on somebody else's truck — not the one that brought them. */
const localAgent = partyId('P-BRIDGE-MOVING')
const platform = partyId('P-PLATFORM')

const storedAt = instant('2026-02-11T15:40:00Z')
const releasedAt = instant('2026-03-25T08:05:00Z')
const receivedAt = instant('2026-03-25T08:25:00Z')
const deliveredAt = instant('2026-03-25T13:20:00Z')

/**
 * [SD §4.7.1] `storeIn` row: family `stay`; "the warehouse agent or TSP crew who performed it".
 * [SD §5.2] M2 — possession-changing, so a human or partner asserter and **never derived**.
 */
const storeIn: CapturedAssertion<'storeIn'> = {
  eventId: eventId('SI-4417'),
  type: 'storeIn',
  specVersion: spec,
  subject: stay,
  assertedBy: { party: warehouseman, role: 'sitAgent' },
  assertedAt: instant('2026-02-11T16:00:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [shipment, warehouseDock],
  basis: 'ACTUAL',
  value: { occurredAt: storedAt, outcome: 'COMPLETED' },
}

/**
 * The TSP's **first available delivery date** — the input, and the only thing in this pair anybody
 * has authority over ([A8 §5] row 7: "authority applies only to the **input**").
 *
 * It has no declared `type` of its own; what the test needs from it is its `eventId`, because M4
 * requires the derived record to name its inputs. Carried as the hauler's arrival assertion at the
 * warehouse dock, which is the record the date was read off.
 */
const firstAvailableDeliveryDate: CapturedAssertion<'arrival'> = {
  eventId: eventId('FADD-4417'),
  type: 'arrival',
  specVersion: spec,
  subject: warehouseDock,
  assertedBy: { party: hauler, role: 'hauler' },
  assertedAt: instant('2026-02-11T15:05:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [shipment],
  basis: 'ACTUAL',
  value: { at: instant('2026-02-11T15:00:00Z') },
}

/**
 * [SD §5.3] `sitEntryDate`: "a **date**: when storage starts counting", mandatorily
 * `DERIVED_BY_RULE` ([SD §5.2] M4) and carrying `{ruleId, ruleVersion}` and its inputs' `eventId`s.
 */
const sitEntryDate: CapturedAssertion<'sitEntryDate'> = {
  eventId: eventId('SED-4417'),
  type: 'sitEntryDate',
  specVersion: spec,
  subject: stay,
  assertedBy: { party: platform, role: 'platform' },
  assertedAt: instant('2026-02-11T16:30:00Z'),
  capturedBy: 'DERIVED_BY_RULE',
  context: [shipment],
  basis: 'ACTUAL',
  value: {
    date: calendarDate('2026-02-12'),
    derivedBy: ruleRef('SIT-ENTRY-DATE-DERIVED', '1'),
    inputs: [firstAvailableDeliveryDate.eventId],
  },
}

describe('[SD §5.3] the store-in act and the SIT entry date are two fact classes', () => {
  it('shares a subject and nothing else — which is why only the `type` can tell them apart', () => {
    expect(CANONICAL_SUBJECT_FAMILY.storeIn).toBe('stay')
    expect(CANONICAL_SUBJECT_FAMILY.sitEntryDate).toBe('stay')
    expect(storeIn.subject).toEqual(sitEntryDate.subject)
    // [SD §5.2] M7's closing point: "the answer is **two vocabulary entries**, not a second axis."
    expect(storeIn.type).not.toBe(sitEntryDate.type)
  })

  it('keeps a date and an instant apart in the type — 400NG Items 29.6 / 17.20', () => {
    // "the arrival date must NOT be entered as the SIT entry date." The store-in act carries an
    // occurrence INSTANT; the entry date is a CalendarDate. The tariff forbids the substitution and
    // the two are not the same primitive, so the substitution cannot be made by accident.
    expect(sitEntryDate.value.date).toBe('2026-02-12')
    expect(storeIn.value.occurredAt).toBe(storedAt)
    // And the derivation names the FIRST AVAILABLE DELIVERY DATE as its input, not the arrival at
    // the dock as an arrival — the input is the record whose eventId is cited, and it is cited.
    expect(sitEntryDate.value.inputs).toEqual([eventId('FADD-4417')])
  })

  it('[SD §5.2] admits the derived date and refuses a keyed one', () => {
    expect(checkCaptureOf(sitEntryDate)).toEqual({
      verdict: 'ADMITTED',
      type: 'sitEntryDate',
      capturedBy: 'DERIVED_BY_RULE',
      licensedBy: 'M7_CLOSED_DECLARATION',
    })

    // M4's `mandatory: true` is the half that bites: "a keyed arrival date published as the SIT
    // entry date… a detectable defect, and the catalog can detect it."
    const keyed = { ...sitEntryDate, capturedBy: 'KEYED_BY_PERSON' } as const
    expect(checkCaptureOf(keyed)).toMatchObject({
      verdict: 'REJECTED',
      rejection: { rule: 'M4', code: 'DECLARED_DERIVED_MUST_BE_DERIVED' },
    })
  })

  it('[SD §5.2] M2 refuses a DERIVED store-in, with its own repair', () => {
    // "M4 does **not** reach into M2's list: it licenses a _different_ fact class, never a derived
    // substitute for an act somebody was supposed to witness." The repair is not "get a human to key
    // it" but "publish the `sitEntryDate` you actually meant", so the code says which.
    const derived = { ...storeIn, capturedBy: 'DERIVED_BY_RULE' } as const
    expect(checkCaptureOf(derived)).toMatchObject({
      verdict: 'REJECTED',
      rejection: {
        rule: 'M2',
        code: 'DERIVED_SUBSTITUTE_FOR_A_WITNESSED_ACT',
        theDifferentFactClass: 'sitEntryDate',
      },
    })
  })

  it('[SD §6.6] a retracted input cascades as a new derivation, never as a correction', () => {
    // The critique's three-rule collision, closed: "The platform asserts what it derived, which it
    // plainly has authority to do; it never corrects the warehouse agent's fact."
    expect(cascadeOnRetractedInput('sitEntryDate')).toEqual({
      publishNewDerivedAssertion: true,
      republishFactResolved: true,
      correctTheWitnessedAct: false,
    })
  })

  it('OWED: [A8 §4.2] the entry date carries no instant for authority to be evaluated at', () => {
    // A8-INSTANT reads the instant the fact is ABOUT. A `sitEntryDate` value describes a **date**,
    // and [SD §5.3] keeps a date and an instant apart precisely so one cannot stand in for the
    // other — so the resolution is reported unresolved rather than filled in from `assertedAt`.
    expect(instantTheFactIsAbout(sitEntryDate)).toEqual({ resolved: false, type: 'sitEntryDate' })
  })
})

describe('[A8 §5 r8] the warehouse is the party of record for what happened inside it', () => {
  const storeOut: CapturedAssertion<'storeOut'> = {
    eventId: eventId('SO-4417'),
    type: 'storeOut',
    specVersion: spec,
    subject: stay,
    assertedBy: { party: warehouseman, role: 'sitAgent' },
    assertedAt: instant('2026-03-25T08:30:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    // [SD §4.7.1] `storeOut` row: the collecting carrier's `partyRole` rides in `context[]`.
    context: [shipment, warehouseDock],
    basis: 'ACTUAL',
    value: { occurredAt: releasedAt, outcome: 'COMPLETED' },
  }

  it('makes the sitAgent authoritative and the collecting carrier competing', () => {
    expect(listedStandingOf('storeOut', 'sitAgent')).toBe('authoritative')
    // "`Hauler` collecting — this is a handoff, so the exception-sheet rule applies" ([A8 §7.3]).
    expect(listedStandingOf('storeOut', 'hauler')).toBe('competing')
    expect(AUTHORITY_TABLE.storeOut.a8Row).toBe(8)
    expect(storeOut.value.occurredAt).toBe(releasedAt)
  })
})

describe('[SD §8.2] the different agent gets a home — an ExternallyPerformedLeg', () => {
  /**
   * "We are not modelling a journey we cannot see. We are modelling **a named party's undertaking to
   * move goods between two places**." `src:dp3-tender-of-service` §B.3.f is what makes naming the
   * party mandatory: the legal name and US DOT number of the provider **actually hauling**.
   */
  const leg: ExternallyPerformedLeg = {
    legId: externallyPerformedLegId('LEG-4417-OUT'),
    moved: shipment,
    performedBy: localAgent,
    custodyBasis: HANDED_OVER,
    authoritativeAsserter: localAgent,
    from: { kind: 'stop', stop: warehouseDock },
    // OWED: [SD §1.2] has no `place` aggregate, so the residence has no target schema.
    to: {
      kind: 'place',
      place: { owed: 'placeRef', owedTo: '[SD §1.2] — no `place` aggregate' },
    },
  }

  const legRef = subjectRef('externallyPerformedLeg', leg.legId)

  /**
   * The `J1`/`R1` pair at the dock: the warehouseman releases, the local agent receives.
   *
   * **Both** sides are published, and under [SD §4.7.2f] they must be: the fold takes the holder
   * from the selected **RECEIPT**'s `value.receivingParty`, so a release on its own is an
   * `IN_TRANSFER_GAP` and not a custody change. The leg still supplies the basis ([SD §4.8.3]
   * rule 1) and the delivery authority ([A8 §5] row 5).
   */
  const warehouseRole: CustodyHolder = {
    kind: 'partyRole',
    partyRole: subjectRef('partyRole', partyRoleId('role-sit-warehouse')),
  }
  const localAgentParty: CustodyHolder = { kind: 'party', party: localAgent }

  const handoverOut: CapturedAssertion<'handover'> = {
    eventId: eventId('H-OUT'),
    type: 'handover',
    specVersion: spec,
    subject: shipment,
    qualifier: { releasing: 'sitAgent', receiving: 'destinationAgent', side: 'RELEASE' },
    assertedBy: { party: warehouseman, role: 'sitAgent' },
    assertedAt: instant('2026-03-25T08:40:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    // [SD §4.7.1] handover row: `context[]` carries "both `stop`s / `trip`s, **or** the
    // `externallyPerformedLeg`" — which is how the fold finds the leg ([SD §4.8.3] rule 1). Note
    // what it no longer carries: the two `partyRole`s, which moved into `value` at [SD §4.7.2f].
    context: [warehouseDock, legRef],
    basis: 'ACTUAL',
    value: {
      occurredAt: releasedAt,
      outcome: 'COMPLETED',
      custodyBasis: HANDED_OVER,
      releasingParty: warehouseRole,
      receivingParty: localAgentParty,
    },
  }

  const handoverIn: CapturedAssertion<'handover'> = {
    ...handoverOut,
    eventId: eventId('H-IN'),
    qualifier: { releasing: 'sitAgent', receiving: 'destinationAgent', side: 'RECEIPT' },
    assertedBy: { party: localAgent, role: 'destinationAgent' },
    assertedAt: instant('2026-03-25T09:10:00Z'),
    capturedBy: 'PARTNER_ASSERTED',
    // Its own instant: the local agent signs for the lot twenty minutes after the warehouseman
    // releases it. C5 makes the span open here, not at the release.
    value: { ...handoverOut.value, occurredAt: receivedAt },
  }

  function resolutionFor(
    handoverAssertion: CapturedAssertion<'handover'>,
    id: string,
  ): FactResolved<'handover'> {
    return {
      eventId: eventId(id),
      type: 'FactResolved',
      specVersion: spec,
      subject: shipment,
      assertedBy: { party: platform, role: 'platform' },
      assertedAt: instant('2026-03-25T09:30:00Z'),
      capturedBy: 'DERIVED_BY_RULE',
      factRef: factRefOf(handoverAssertion),
      selected: handoverAssertion.eventId,
      considered: [handoverAssertion.eventId],
      rule: ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'),
    }
  }

  const evidence: CustodyEvidence = {
    handovers: [handoverOut, handoverIn],
    resolutions: [resolutionFor(handoverOut, 'FR-H-OUT'), resolutionFor(handoverIn, 'FR-H-IN')],
    legs: [leg],
  }

  it('names a party where A3 could only have named a vehicle it never sees', () => {
    expect(leg.performedBy).toBe(localAgent)
    expect(leg.authoritativeAsserter).toBe(localAgent)
    // The leg is a legal `subject` in the `stop` family, so an arrival may be asserted about it.
    expect(CANONICAL_SUBJECT_FAMILY.arrival).toBe('stop')
  })

  it('[SD §4.8.3] the fold reads the leg for the basis, and the RECEIPT for the holder', () => {
    const answer = custodyAt(shipment, deliveredAt, evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    // Rule 1 still reads "that leg's declared `custodyBasis`". What changed at [SD §4.7.2f] §7.1 is
    // the holder: it is the selected RECEIPT's `value.receivingParty`, not the leg's `performedBy`.
    // The two name the same party here, which is the ordinary case and not a guarantee.
    expect(answer.holder).toEqual({ kind: 'party', party: localAgent })
    expect(leg.performedBy).toBe(localAgent)
    expect(answer.basis).toBe(HANDED_OVER)
    // …and the span opens at the RECEIPT, not at the release. Between them, the fold is silent.
    expect(answer.since).toBe(handoverIn.value.occurredAt)
    expect(answer.since).toBe(receivedAt)
    expect(Date.parse(receivedAt)).toBeGreaterThan(Date.parse(releasedAt))
    expect(custodyAt(shipment, instant('2026-03-25T08:15:00Z'), evidence)).toMatchObject({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
    })
  })

  it('[A8 §5 r5] and the leg carries the delivery authority the destination agent would have had', () => {
    const delivered: CapturedAssertion<'delivery'> = {
      eventId: eventId('D-4417'),
      type: 'delivery',
      specVersion: spec,
      subject: shipment,
      assertedBy: { party: localAgent, role: 'destinationAgent' },
      assertedAt: instant('2026-03-25T14:00:00Z'),
      capturedBy: 'PARTNER_ASSERTED',
      context: [legRef],
      basis: 'ACTUAL',
      value: { occurredAt: deliveredAt, outcome: 'COMPLETED' },
    }
    // A8-INSTANT: the instant comes off the VALUE. There is deliberately no constructor from
    // `assertedAt`, so this is the only way a caller can obtain one.
    const at = instantTheFactIsAbout(delivered)
    expect(at.resolved).toBe(true)
    if (!at.resolved) return
    const context: AuthorityContext = {
      at: at.at,
      custody: custodyAt(shipment, deliveredAt, evidence),
      leg,
      conditions: ['EXTERNALLY_PERFORMED_LEG'],
    }
    expect(authoritativeHolderAt('delivery', context)).toMatchObject({
      kind: 'holder',
      holder: { kind: 'legAuthoritativeAsserter' },
    })
  })

  it("OWED: the leg's non-Stop endpoint has no schema — [SD §1.2] has no `place` aggregate", () => {
    // Represented as owed rather than typed as a string, "because a bare string here would read as a
    // settled shape". The scenario needs a destination address and the model declines to invent one.
    expect(leg.to).toMatchObject({ kind: 'place', place: { owed: 'placeRef' } })
    expect(isAggregateKind('place')).toBe(false)
  })

  it('[A5 §3.4] A5 has answered its half: the STAY is untouched by termination', () => {
    // Six weeks is ordinary SIT and the shipment is untouched. [SD §10.4] left the TERMINATED case
    // to A2/A5, and [A5 §3.4] settles A5's half: termination ends the carrier's bill-of-lading
    // liability and makes the customer the depositor (`src:dtr-part-iv` §D.5.c(2), §A.6.f(1)), but
    // the occupancy does not end and neither does its identity — the same lot is in the same
    // warehouse under the same SIT control number. So a `storeOut` after a terminated stay names
    // **the same stay** as its `storeIn`.
    expect(isAggregateKind('stay')).toBe(true)
    expect(storeIn.subject.id).toBe(stay.id)
    // "who held the goods is answered without an owner at all, because it is not a stored thing."
    expect(isAggregateKind('custody')).toBe(false)
  })

  it('[A5 §3.4] and A2 still owns the other half — the SHIPMENT boundary', () => {
    // What A5 does NOT settle, and says so: whether the goods moving out on a new bill of lading
    // (`src:dtr-part-iv` §E.4(4)(c)) are the same shipment. That is [SD §10.4]'s A2 question, and
    // A5's contribution is the constraint that the stay id is not the thing that answers it — the
    // stay is a bailment, the shipment is a movement, and only one of them ended.
    expect(CANONICAL_SUBJECT_FAMILY.storeOut).toBe('stay')
    expect(CANONICAL_SUBJECT_FAMILY.delivery).toBe('goods')
  })

  it('[A5 §3.2] the remedy that opens this stay is typed, and points at this subject', () => {
    // The shape [A4 §5] item 2 owed to A5. A delivery that fails because the destination is not
    // ready is the moment the stay is promised; `storeIn` above is the moment it is performed.
    const remedy: Remedy = { opensStay: { stay, location: 'DESTINATION' } }
    expect('opensStay' in remedy && remedy.opensStay.stay).toEqual(storeIn.subject)
    expect(STAY_LOCATIONS).toContain('IN_TRANSIT')
  })
})
