/**
 * **Scenario 4 — a shipment reweighed in transit at the shipper's request.**
 *
 * [round-2-critique] made this its **must-fix #4** and named the acceptance test: "`src:dp3-400ng`
 * Item 4 Note 2 — on duplicate reweighs the record takes **the lower** of the two net weights." The
 * old model could not hold it, because "the resolution machinery is time-only… and `Correction`
 * handles wrongness, not two correct-but-different observations."
 *
 * [SD §4] answers it by generalising the Assertion past time, and [SD §4.4] publishes the one value
 * rule in the binding layer: **`R-WEIGHT-LOWER`**. The row that carries it is [A8 §5] row 6, which
 * is `boundBy = NONE` — "this row proves authority and value rules are two mechanisms."
 *
 * The rule must **bite**, so this file drives it in both directions: the reweigh wins when it is
 * lower, and **loses when it is higher**, which is the half that proves it reads the value rather
 * than the clock.
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITY_TABLE,
  R_WEIGHT_LOWER,
  WEIGHT_SOURCE_HIERARCHY_RULE_IS_OWED,
  areDistinctWeighings,
  authoritativeHolderAt,
  custodyAt,
  documentId,
  eventId,
  factResolvedSubjectMatches,
  instant,
  instantTheFactIsAbout,
  listedStandingOf,
  owedCode,
  partyId,
  recencyIsPublishedFor,
  resolveNetWeight,
  ruleRef,
  sameFactKey,
  factRefOf,
  selectionIsAmongConsidered,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  supersedesIsWellFormed,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type FactResolved,
} from '../../src/index'

const spec = specVersion('1')

const shipment = subjectRef('shipment', shipmentId('S-5150'))

const hauler = { party: partyId('P-VANLINE'), role: 'hauler' } as const
const customer = { party: partyId('P-SHIPPER'), role: 'customer' } as const
const platform = partyId('P-PLATFORM')

/**
 * Two weighings, and the distinctness is physical: `src:cfr-49-375` §375.517 gives the shipper the
 * reweigh demand **before unloading begins**, and 400NG Item 4.11.d forbids the reweigh being
 * performed on the same scale as the original. §375.519 puts the scale's name and location on the
 * ticket — which is why the evidence refs are how the model tells the two apart ([SD §4.4]).
 */
function netWeight(
  id: string,
  amount: number,
  ticket: string,
  asserter: typeof hauler | typeof customer,
  unit = 'lb',
): CapturedAssertion<'weight.net'> {
  return {
    eventId: eventId(id),
    type: 'weight.net',
    specVersion: spec,
    subject: shipment,
    assertedBy: asserter,
    assertedAt: instant(id === 'W-ORIGINAL' ? '2026-06-02T11:00:00Z' : '2026-06-04T16:30:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    basis: 'ACTUAL',
    // [SD §4.4] routes a weight's provenance through `capturedBy` + `evidence[]`, and the weigh
    // master signs the ticket (§375.519) rather than making the assertion.
    evidence: [{ kind: 'document', ref: subjectRef('document', documentId(ticket)) }],
    value: { amount, unit: owedCode('unitOfMeasure', unit) },
  }
}

/** Origin weighing on the agent's certified scale. */
const original = netWeight('W-ORIGINAL', 8240, 'TICKET-ORIGIN-3391', hauler)
/** The reweigh the shipper demanded in transit, on a different scale two days later. */
const reweigh = netWeight('W-REWEIGH', 7980, 'TICKET-REWEIGH-7712', hauler)

describe('[SD §4.4] R-WEIGHT-LOWER bites', () => {
  it('selects the lower of two ACTUAL net weights from distinct weighings', () => {
    expect(areDistinctWeighings(original, reweigh)).toBe('DISTINCT')
    const resolution = resolveNetWeight(original, reweigh, 'ORIGINAL_VS_REWEIGH')
    expect(resolution).toEqual({
      applied: true,
      selected: eventId('W-REWEIGH'),
      considered: [eventId('W-ORIGINAL'), eventId('W-REWEIGH')],
      rule: R_WEIGHT_LOWER,
      // [SD §4.4] insists the citation is per pairing: this one is 400NG Item 4.11.d, "invoice on
      // the lesser weight" — not Item 4 Note 2, which is the duplicate-reweigh case.
      pairing: 'ORIGINAL_VS_REWEIGH',
    })
  })

  it('and the LATER, more authoritative-looking reweigh loses when it is higher', () => {
    // This is the half that proves the rule reads the value. The reweigh was demanded by the
    // shipper, performed on a second scale, and asserted two days after the original — every
    // recency and provenance instinct points at it. The rule takes the lower anyway.
    const heavierReweigh = netWeight('W-REWEIGH-HIGH', 8600, 'TICKET-REWEIGH-7712', hauler)
    const resolution = resolveNetWeight(original, heavierReweigh, 'ORIGINAL_VS_REWEIGH')
    expect(resolution).toMatchObject({ applied: true, selected: eventId('W-ORIGINAL') })
  })

  it('refuses one weighing keyed twice — the lower of a value and itself is not a finding', () => {
    // Same ticket on both sides: this is the original, re-keyed by the second party.
    const rekeyed = netWeight('W-REKEYED', 8240, 'TICKET-ORIGIN-3391', customer)
    expect(areDistinctWeighings(original, rekeyed)).toBe('SAME_WEIGHING')
    expect(resolveNetWeight(original, rekeyed)).toMatchObject({
      applied: false,
      because: 'SAME_WEIGHING',
    })
  })

  it('OWED: reports undetermined distinctness rather than guessing it', () => {
    // "Distinct weighings" is [SD §4.4]'s own condition and the one part of the rule the binding
    // layer does not define. A weight with no evidence could be a second weighing or the first one
    // spoken twice; treating it as either would be a guess, so it resolves to neither.
    const unticketed: CapturedAssertion<'weight.net'> = {
      ...original,
      eventId: eventId('W-NO-TICKET'),
      evidence: [],
    }
    expect(areDistinctWeighings(unticketed, reweigh)).toBe('UNDETERMINED')
    expect(resolveNetWeight(unticketed, reweigh)).toMatchObject({
      applied: false,
      because: 'DISTINCTNESS_UNDETERMINED',
    })
  })

  it('OWED: refuses to compare across units, because no unit vocabulary is published', () => {
    // [SD §4.1] fixes the shape `(kind, unit, value, source)` and fixes no unit list, so
    // `MeasureValue.unit` is an owed code. "Lower" across two unconvertible units is not a
    // comparison, and the rule says so rather than converting on an assumed factor.
    const kilos = netWeight('W-METRIC', 3620, 'TICKET-REWEIGH-7712', hauler, 'kg')
    expect(resolveNetWeight(original, kilos)).toMatchObject({
      applied: false,
      because: 'UNITS_DIFFER',
    })
  })
})

describe('[SD §4.4] note 2 — a reweigh is NOT a correction', () => {
  it('leaves both assertions standing: the first weighing occurred and was recorded correctly', () => {
    // "Under `fork-time`'s preference order the reweigh would have been a 'compensate', leaving two
    // authoritative weights and no winner — which is precisely the failure the critique identified."
    expect(original.value.amount).toBe(8240)
    expect(reweigh.value.amount).toBe(7980)
    // Neither record claims the other was wrong: there is no `corrects` link on either.
    expect(original).not.toHaveProperty('corrects')
    expect(reweigh).not.toHaveProperty('corrects')
  })

  it('and it is not a supersession either — [SD §4.1] restricts that to the same party', () => {
    // A reweigh is characteristically by the other side. Even where the hauler asserts both, a
    // supersession must name the earlier record; these two are a contest, which is a different
    // mechanism and produces a different published record.
    const claimingSupersession = { ...reweigh, supersedes: eventId('W-ORIGINAL') } as const
    const bySomebodyElse = { ...claimingSupersession, assertedBy: customer } as const
    expect(supersedesIsWellFormed(original, bySomebodyElse)).toBe(false)
    // By the same party, with the same fact key, it would be well formed — which is the point of
    // keeping the two mechanisms apart rather than reading every second weight as a revision.
    expect(supersedesIsWellFormed(original, claimingSupersession)).toBe(true)
    // Either way the two weights pair on ONE fact key, so a contest is available.
    expect(sameFactKey(factRefOf(original), factRefOf(reweigh))).toBe(true)
  })
})

describe('[A8 §5 r6] nobody is authoritative, and that is the finding', () => {
  const evidence: CustodyEvidence = {
    handovers: [],
    resolutions: [],
    legs: [],
  }

  it('returns `noRole`, settled by the value rule rather than by a winner', () => {
    // A8-INSTANT: a weight's value describes no instant, so there is no clock to evaluate a role
    // at — and the row does not need one, because no role wins it.
    expect(instantTheFactIsAbout(original)).toEqual({ resolved: false, type: 'weight.net' })

    const probe: CapturedAssertion<'arrival'> = {
      eventId: eventId('probe'),
      type: 'arrival',
      specVersion: spec,
      subject: subjectRef('stop', stopId('ST-SCALE')),
      assertedBy: { party: platform, role: 'platform' },
      assertedAt: instant('2026-06-04T16:00:00Z'),
      capturedBy: 'KEYED_BY_PERSON',
      basis: 'ACTUAL',
      value: { at: instant('2026-06-04T16:00:00Z') },
    }
    const at = instantTheFactIsAbout(probe)
    expect(at.resolved).toBe(true)
    if (!at.resolved) return

    const context: AuthorityContext = {
      at: at.at,
      custody: custodyAt(shipment, instant('2026-06-04T16:00:00Z'), evidence),
    }
    expect(authoritativeHolderAt('weight.net', context)).toEqual({
      kind: 'noRole',
      settledBy: { kind: 'valueRule', rule: R_WEIGHT_LOWER },
      tieBreak: { kind: 'rule', rule: R_WEIGHT_LOWER },
      rule: R_WEIGHT_LOWER,
    })
    expect(AUTHORITY_TABLE['weight.net'].boundBy).toBe('NONE')
  })

  it('places the shipper as COMPETING and the weigh master as evidence', () => {
    // §375.517 gives the shipper the reweigh demand and makes the freight bill follow the reweigh
    // weight, so the reweigh-demanding side competes rather than corroborates.
    expect(listedStandingOf('weight.net', 'customer')).toBe('competing')
    expect(listedStandingOf('weight.net', 'accountParty')).toBe('competing')
    expect(listedStandingOf('weight.net', 'hauler')).toBe('competing')
    // "The weigh master SUPPLIES THE EVIDENCE, NOT THE ASSERTION" (§375.519 puts the signature on
    // the weigh master); the row must place the role somewhere and places it as corroborating.
    expect(listedStandingOf('weight.net', 'weighMaster')).toBe('corroborating')
  })

  it('[A8 §4.4] A8-NAMED — and there is no recency back door when the rule does not apply', () => {
    expect(recencyIsPublishedFor('weight.net')).toBe(false)
    const undetermined = resolveNetWeight(
      { ...original, evidence: [] },
      { ...reweigh, evidence: [] },
    )
    expect(undetermined).toMatchObject({ applied: false, mayFallBackToRecency: false })
  })
})

describe('[SD §4.3] the resolution is published, append-only, and names its rule', () => {
  const resolved: FactResolved<'weight.net'> = {
    eventId: eventId('FR-W-5150'),
    type: 'FactResolved',
    specVersion: spec,
    subject: shipment,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-06-04T17:00:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: { subject: shipment, type: 'weight.net' },
    selected: eventId('W-REWEIGH'),
    considered: [eventId('W-ORIGINAL'), eventId('W-REWEIGH')],
    rule: R_WEIGHT_LOWER,
  }

  it('keeps the losing weight in considered[] and names the version of the rule', () => {
    expect(resolved.considered).toContain(eventId('W-ORIGINAL'))
    expect(selectionIsAmongConsidered(resolved)).toBe(true)
    expect(factResolvedSubjectMatches(resolved)).toBe(true)
    // The version is what keeps the authored generalisation honest: [SD §4.4] states the rule once
    // over any two ACTUAL net weights, where the tariff states it three times per pairing.
    expect(resolved.rule).toEqual(ruleRef('R-WEIGHT-LOWER', '1'))
  })

  it('OWED: the source hierarchy that would choose between a ticket and a reference book is not published', () => {
    // 400NG Items 4.9.g-i enumerate the permitted SOURCES of a weight (certified-scale ticket,
    // Branham, NADA, constructive rate per cubic foot). [SD §4.4] says a named rule must choose
    // between them, and does not publish one — and it is not this rule, which chooses by value.
    expect(WEIGHT_SOURCE_HIERARCHY_RULE_IS_OWED).toBe(true)
  })

  it('OWED: R-WEIGHT-LOWER is a DoD program rule and is scoped to `weight.net` alone', () => {
    // [SD §4.4]'s honest note: "this is a DoD program rule, not a universal one", and the versioned
    // rule ref is what lets a commercial tariff carry a different one over the same fact class.
    // Its scope is visible in the table: the gross and tare rows do not carry it, and their
    // authority is owed outright.
    expect(AUTHORITY_TABLE['weight.gross'].row.owed).toBe('authorityRow')
    expect(AUTHORITY_TABLE['weight.tare'].provisional).toContain('Do not score on this')
  })
})
