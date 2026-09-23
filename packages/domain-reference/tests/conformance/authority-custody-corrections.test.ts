/**
 * Conformance — authority, the custody fold, and corrections, behaviourally.
 *
 * The type-level half is `authority-custody-corrections-refuses.ts`. This half runs the rules,
 * because the two documents state their hardest cases as worked examples — [A8 §7.6] "Scenario 8,
 * expressed end to end" and [SD §4.8.3] "The fold, **stated so it is testable**" — and a worked
 * example nobody executes is prose again.
 */
import { describe, expect, it } from 'vitest'

import {
  AUTHORITY_TABLE,
  CUSTODY_AT_RULE,
  HANDED_OVER,
  HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY,
  JOINT_AT_CUSTODY_BOUNDARY,
  R_WEIGHT_LOWER,
  areDistinctWeighings,
  authorityAtBoundary,
  authorityMovesAtHandover,
  authorityToDeclare,
  authoritativeHolderAt,
  contestAfterRetraction,
  corroborationIsIndependent,
  custodyAt,
  decideCorrection,
  documentId,
  eventId,
  factRefOf,
  hasAuthorityRow,
  instant,
  instantTheFactIsAbout,
  itemId,
  jointResolutionIsWellFormed,
  listedStandingOf,
  movesWithPrincipal,
  owedCode,
  partyId,
  partyRoleId,
  reachesThePricedRecord,
  recencyIsPublishedFor,
  resolveNetWeight,
  ruleRef,
  sameFactKey,
  shipmentId,
  specVersion,
  standingAfterBoundary,
  stopId,
  subjectRef,
  type AuthorityContext,
  type CapturedAssertion,
  type CustodyEvidence,
  type CustodyHolder,
  type FactInstant,
  type FactResolved,
} from '../../src/index'

const spec = specVersion('1')
const S = subjectRef('shipment', shipmentId('S'))
const stopX = subjectRef('stop', stopId('X'))

const originAgentA = partyId('A')
const haulerH = partyId('H')
const destinationAgentD = partyId('D')
const platform = partyId('platform')

const originRole: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('role-origin-A')),
}
const haulerRole: CustodyHolder = {
  kind: 'partyRole',
  partyRole: subjectRef('partyRole', partyRoleId('role-hauler-H')),
}

/** One transfer, two instants — [SD §4.7.2f] §2. The release opens a gap; the receipt closes it. */
const T0 = instant('2026-03-03T14:05:00Z')
const T1 = instant('2026-03-03T16:20:00Z')
const beforeT1 = instant('2026-03-03T09:00:00Z')
const afterT1 = instant('2026-03-03T18:00:00Z')

/** [A8 §7.6]: the `J1` half — the origin agent releases, `custodyBasis = 349`. Its key carries
 * `side = RELEASE`, so it is its own fact and not the receipt's rival ([SD §4.7.2f] §0(1)). */
const handoverJ1: CapturedAssertion<'handover'> = {
  eventId: eventId('h-j1'),
  type: 'handover',
  specVersion: spec,
  subject: S,
  qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RELEASE' },
  assertedBy: { party: originAgentA, role: 'originAgent' },
  assertedAt: instant('2026-03-03T14:30:00Z'),
  capturedBy: 'KEYED_BY_PERSON',
  context: [stopX],
  basis: 'ACTUAL',
  value: {
    occurredAt: T0,
    outcome: 'COMPLETED',
    custodyBasis: HANDED_OVER,
    releasingParty: originRole,
    receivingParty: haulerRole,
  },
}

/** The `R1` half — the hauler receives. Two complementary assertions by two parties, on two keys. */
const handoverR1: CapturedAssertion<'handover'> = {
  eventId: eventId('h-r1'),
  type: 'handover',
  specVersion: spec,
  subject: S,
  qualifier: { releasing: 'originAgent', receiving: 'hauler', side: 'RECEIPT' },
  assertedBy: { party: haulerH, role: 'hauler' },
  assertedAt: instant('2026-03-03T16:40:00Z'),
  capturedBy: 'PARTNER_ASSERTED',
  context: [stopX],
  basis: 'ACTUAL',
  value: {
    occurredAt: T1,
    outcome: 'COMPLETED',
    custodyBasis: HANDED_OVER,
    releasingParty: originRole,
    receivingParty: haulerRole,
  },
}

function resolutionFor(
  handoverAssertion: CapturedAssertion<'handover'>,
  id: string,
): FactResolved<'handover'> {
  return {
    eventId: eventId(id),
    type: 'FactResolved',
    specVersion: spec,
    subject: S,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-03-03T17:00:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: factRefOf(handoverAssertion),
    selected: handoverAssertion.eventId,
    considered: [handoverAssertion.eventId],
    rule: ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1'),
  }
}

const releaseResolved = resolutionFor(handoverJ1, 'fr-handover-release')
const handoverResolved = resolutionFor(handoverR1, 'fr-handover')

const evidence: CustodyEvidence = {
  handovers: [handoverJ1, handoverR1],
  resolutions: [releaseResolved, handoverResolved],
  legs: [],
}

function factInstant(at: string): FactInstant {
  const probe: CapturedAssertion<'arrival'> = {
    eventId: eventId('probe'),
    type: 'arrival',
    specVersion: spec,
    subject: stopX,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant(at),
    capturedBy: 'KEYED_BY_PERSON',
    basis: 'ACTUAL',
    value: { at: instant(at) },
  }
  const resolution = instantTheFactIsAbout(probe)
  if (!resolution.resolved) throw new Error('an arrival carries the instant it describes')
  return resolution.at
}

describe('[SD §4.8.3] custodyAt — the fold', () => {
  it("returns the selected RECEIPT's `value.receivingParty`, with the rule that produced it", () => {
    const answer = custodyAt(S, afterT1, evidence)
    expect(answer.custody).toBe('KNOWN')
    if (answer.custody !== 'KNOWN') return
    expect(answer.holder).toEqual(haulerRole)
    expect(answer.basis).toBe(HANDED_OVER)
    expect(answer.since).toBe(T1)
    // "every handover assertion and FactResolved the fold read"
    expect(answer.evidencedBy).toContain(eventId('h-r1'))
    expect(answer.evidencedBy).toContain(eventId('fr-handover'))
    // Rule 2: the answer names the rule.
    expect(answer.rule).toEqual(CUSTODY_AT_RULE)
  })

  it('is UNKNOWN before the first handover, and does not fall through to anybody', () => {
    const answer = custodyAt(S, beforeT1, evidence)
    expect(answer).toEqual({
      custody: 'UNKNOWN',
      why: 'NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT',
      rule: CUSTODY_AT_RULE,
    })
    // Rule 3, stated as the absence it is: no holder is offered, not even the party that spoke.
    expect(answer).not.toHaveProperty('holder')
  })

  it('reads only FactResolved-SELECTED handovers — an unselected receipt is not custody', () => {
    // Nothing selected h-r1, so only the origin agent's release reaches the fold — and a release
    // yields no holder. [SD §4.7.2f] foreclosure 2: custody never moves on one party's word.
    const onlyJ1: CustodyEvidence = { ...evidence, resolutions: [releaseResolved] }
    const answer = custodyAt(S, afterT1, onlyJ1)
    expect(answer.custody).toBe('UNKNOWN')
    if (answer.custody !== 'UNKNOWN') return
    expect(answer.why).toBe('IN_TRANSFER_GAP')
  })

  it('C5 — between the release and the receipt the fold is silent, and says why', () => {
    // [SD §4.8.3] rule 3's second named case, now DERIVED: "across a cross-dock dwell where only
    // one of the two handovers has been published, the fold returns `UNKNOWN`."
    expect(custodyAt(S, instant('2026-03-03T15:00:00Z'), evidence)).toEqual({
      custody: 'UNKNOWN',
      why: 'IN_TRANSFER_GAP',
      rule: CUSTODY_AT_RULE,
    })
  })

  it('the two halves are two FACTS: they carry different keys and never pair', () => {
    // [SD §4.7.2f] §0(1). `src:stedi-x12-reference` element 1650 publishes them as two codes by two
    // parties — "two complementary assertions" — and [SD §4.3] pairs COMPETING ones.
    expect(sameFactKey(factRefOf(handoverJ1), factRefOf(handoverR1))).toBe(false)
    expect(handoverJ1.qualifier.side).toBe('RELEASE')
    expect(handoverR1.qualifier.side).toBe('RECEIPT')
  })

  it('declines to answer when A8-JOINT declined to select', () => {
    const unresolved: CustodyEvidence = {
      ...evidence,
      resolutions: [{ ...handoverResolved, selected: null }],
    }
    expect(custodyAt(S, afterT1, unresolved).custody).toBe('UNKNOWN')
  })

  it('ignores a PLANNED handover — a projection may not report custody nobody asserted', () => {
    const planned: CapturedAssertion<'handover'> = {
      ...handoverR1,
      eventId: eventId('h-planned'),
      basis: 'PLANNED',
      value: {
        occurredAt: T1,
        custodyBasis: HANDED_OVER,
        releasingParty: originRole,
        receivingParty: haulerRole,
      },
    }
    const plannedOnly: CustodyEvidence = {
      handovers: [planned],
      resolutions: [{ ...handoverResolved, selected: eventId('h-planned') }],
      legs: [],
    }
    expect(custodyAt(S, afterT1, plannedOnly).custody).toBe('UNKNOWN')
  })
})

describe('[A8 §7.1] A8-MOVE — the hinge is the responsibility distinction', () => {
  it('moves authority at 349 and does not at 41', () => {
    expect(authorityMovesAtHandover(HANDED_OVER)).toBe(true)
    expect(authorityMovesAtHandover(HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY)).toBe(false)
  })

  it('[A8 §7.2] A8-LIABILITY — a handoff moves authority and moves nothing else', () => {
    const boundary = authorityAtBoundary(custodyAt(S, afterT1, evidence))
    expect(boundary?.authorityMoved).toBe(true)
    expect(boundary?.liabilityMoved).toBe(false)
  })
})

describe('[A8 §4.2] A8-INSTANT, and [A8 §7.6] why the origin agent loses', () => {
  it('reads the instant off the value, and refuses to resolve one the value does not carry', () => {
    expect(instantTheFactIsAbout(handoverJ1)).toEqual({ resolved: true, at: T0 })
    const weight = netWeight('w1', 5000, 'WT-1')
    expect(instantTheFactIsAbout(weight)).toEqual({ resolved: false, type: 'weight.net' })
  })

  it("A's LATER delivery assertion is advisory; D is authoritative", () => {
    const context: AuthorityContext = {
      at: factInstant('2026-03-24T10:00:00Z'),
      custody: custodyAt(S, afterT1, evidence),
    }
    const verdict = authoritativeHolderAt('delivery', context)
    expect(verdict).toEqual({
      kind: 'holder',
      holder: { kind: 'role', role: 'destinationAgent' },
      rule: AUTHORITY_TABLE.delivery.rule,
    })
    // [A8 §7.4] A8-AFTER: recorded, considered, never suppressed — and never authoritative.
    expect(standingAfterBoundary('delivery', 'originAgent')).toBe('advisory')
    expect(listedStandingOf('delivery', 'originAgent')).toBe('advisory')
    // …while the customer's signature is constitutive, so the customer COMPETES.
    expect(standingAfterBoundary('delivery', 'customer')).toBe('competing')
  })

  it("…and A's LOAD assertion, made at the same moment, is still authoritative", () => {
    expect(listedStandingOf('loading', 'originAgent')).toBe('authoritative')
  })
})

describe('[A8 §5] the table', () => {
  it('has sixteen rows and still marks every fact class it does not reach owed', () => {
    const rowed = Object.values(AUTHORITY_TABLE).filter((entry) => 'a8Row' in entry)
    // Eleven at `0.1.0`; rows 12-16 closed the five of [A8 §9 item 8]'s owed rows the corpus
    // supports — `handover` (F3), `weight.gross`, `weight.tare`, `packing`, `pieceCount`.
    expect(rowed).toHaveLength(16)
    expect(hasAuthorityRow('arrival')).toBe(true)
    expect(hasAuthorityRow('packing')).toBe(true)
    expect(hasAuthorityRow('handover')).toBe(true)
    // Owed is a VALUE, not an absence — an owed row still names what it is owed to. Fourteen
    // remain, and `tripDelay` is one the corpus cannot close: no source binds a plan change to an
    // asserting role ([A8 §9 item 8]).
    expect(hasAuthorityRow('tripDelay')).toBe(false)
    const tripDelay = AUTHORITY_TABLE.tripDelay
    expect(tripDelay.row.owed).toBe('authorityRow')
    expect(tripDelay.row.owedTo).toContain('A8 §9 item 8')
  })

  it('[A8 §4.4] A8-NAMED — the recency registry is empty, for every fact class', () => {
    expect(recencyIsPublishedFor('arrival')).toBe(false)
    expect(recencyIsPublishedFor('weight.net')).toBe(false)
  })

  it('[A8 §5 r11] resolves per {aspect}, because three aspects are three fact keys', () => {
    const base = {
      at: factInstant('2026-03-10T00:00:00Z'),
      custody: custodyAt(S, afterT1, evidence),
    }
    expect(authoritativeHolderAt('charge', { ...base, aspect: 'DECIDED' })).toMatchObject({
      holder: { kind: 'role', role: 'accountParty' },
    })
    expect(authoritativeHolderAt('charge', { ...base, aspect: 'PROPOSED' })).toMatchObject({
      holder: { kind: 'performingRole' },
    })
    // The tariff owner is not in the role enum, and is carried as owed rather than bent onto one.
    expect(authoritativeHolderAt('charge', { ...base, aspect: 'RATED' })).toMatchObject({
      holder: { kind: 'owedRole' },
    })
    // Asking without an aspect is asking which of a proposal and a price wins. It gets no holder.
    expect(authoritativeHolderAt('charge', base).kind).toBe('owed')
  })

  it('[A8 §7.5] A8-PRINCIPAL moves only what is bound to the principal', () => {
    expect(movesWithPrincipal('charge')).toBe(true)
    expect(movesWithPrincipal('delivery')).toBe(false)
  })

  it('[A8 §3] A8-SELF — one company holding two roles does not corroborate itself', () => {
    expect(corroborationIsIndependent(haulerH, destinationAgentD)).toBe(true)
    expect(corroborationIsIndependent(haulerH, haulerH)).toBe(false)
  })

  it('a CUSTODY-bound row has no answer while the fold has none', () => {
    const verdict = authoritativeHolderAt('arrival', {
      at: factInstant('2026-03-03T08:00:00Z'),
      custody: custodyAt(S, beforeT1, evidence),
    })
    expect(verdict.kind).toBe('custodyUnknown')
  })
})

describe('[A8 §7.3] A8-JOINT', () => {
  // [A8 §7.6] item 2: `subject: item:*` was never a subject. It is ONE assertion per article, and
  // so one resolution per article — this is item i7's.
  const i7 = subjectRef('item', itemId('i7'))
  const jointResolution: FactResolved<'condition'> = {
    eventId: eventId('fr-condition'),
    type: 'FactResolved',
    specVersion: spec,
    subject: i7,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-03-03T15:05:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: { subject: i7, type: 'condition' },
    selected: null,
    considered: [eventId('cond-A'), eventId('cond-H')],
    rule: JOINT_AT_CUSTODY_BOUNDARY,
  }

  it('publishes the disagreement and does not select', () => {
    expect(jointResolutionIsWellFormed(jointResolution, true)).toBe(true)
    expect(
      jointResolutionIsWellFormed({ ...jointResolution, selected: eventId('cond-A') }, true),
    ).toBe(false)
  })

  it('agreement is an affirmative record, so a selection over agreeing sides is well formed', () => {
    expect(
      jointResolutionIsWellFormed({ ...jointResolution, selected: eventId('cond-A') }, false),
    ).toBe(true)
  })
})

/* ---------------------------------------------------------------------------------------- */

function netWeight(
  id: string,
  amount: number,
  ticket: string | undefined,
  unit = 'lb',
): CapturedAssertion<'weight.net'> {
  const base = {
    eventId: eventId(id),
    type: 'weight.net',
    specVersion: spec,
    subject: S,
    assertedBy: { party: haulerH, role: 'hauler' },
    assertedAt: instant('2026-03-04T10:00:00Z'),
    capturedBy: 'KEYED_BY_PERSON',
    basis: 'ACTUAL',
    value: { amount, unit: owedCode('unitOfMeasure', unit) },
  } as const
  return ticket === undefined
    ? base
    : {
        ...base,
        evidence: [{ kind: 'document', ref: subjectRef('document', documentId(ticket)) }],
      }
}

describe('[SD §4.4] R-WEIGHT-LOWER', () => {
  it('takes the lower of two ACTUAL net weights from distinct weighings', () => {
    const original = netWeight('w-original', 8200, 'WT-1')
    const reweigh = netWeight('w-reweigh', 7900, 'WT-2')
    const resolution = resolveNetWeight(original, reweigh, 'ORIGINAL_VS_REWEIGH')
    expect(resolution).toEqual({
      applied: true,
      selected: eventId('w-reweigh'),
      considered: [eventId('w-original'), eventId('w-reweigh')],
      rule: R_WEIGHT_LOWER,
      pairing: 'ORIGINAL_VS_REWEIGH',
    })
  })

  it('will not apply to one weighing keyed twice', () => {
    const left = netWeight('w-a', 8200, 'WT-1')
    const right = netWeight('w-b', 7900, 'WT-1')
    expect(areDistinctWeighings(left, right)).toBe('SAME_WEIGHING')
    expect(resolveNetWeight(left, right)).toMatchObject({
      applied: false,
      because: 'SAME_WEIGHING',
    })
  })

  it('reports undetermined distinctness rather than guessing it', () => {
    const left = netWeight('w-a', 8200, undefined)
    const right = netWeight('w-b', 7900, 'WT-2')
    expect(areDistinctWeighings(left, right)).toBe('UNDETERMINED')
    expect(resolveNetWeight(left, right)).toMatchObject({
      applied: false,
      because: 'DISTINCTNESS_UNDETERMINED',
    })
  })

  it('refuses to compare across units, because no unit vocabulary is published', () => {
    const pounds = netWeight('w-a', 8200, 'WT-1', 'lb')
    const kilos = netWeight('w-b', 3700, 'WT-2', 'kg')
    expect(resolveNetWeight(pounds, kilos)).toMatchObject({
      applied: false,
      because: 'UNITS_DIFFER',
    })
  })

  it('never licenses a fall-back to recency when it does not apply', () => {
    const outcome = resolveNetWeight(netWeight('w-a', 1, undefined), netWeight('w-b', 2, undefined))
    expect(outcome).toMatchObject({ applied: false, mayFallBackToRecency: false })
  })

  it('is scoped to weight.net: the row that carries it is boundBy NONE', () => {
    expect(AUTHORITY_TABLE['weight.net'].boundBy).toBe('NONE')
    expect(AUTHORITY_TABLE['weight.net'].authoritative.kind).toBe('none')
  })
})

describe('[SD §6] corrections — every attempt recorded, no refusal path', () => {
  const at = factInstant('2026-03-20T10:00:00Z')
  const context: AuthorityContext = { at, custody: custodyAt(S, afterT1, evidence) }

  it('APPLIED — inside the window, by an authorised role', () => {
    const verdict = decideCorrection(
      {
        corrects: eventId('d1'),
        type: 'delivery',
        reason: { errorReason: 'INCORRECT_DATA' },
        authority: { kind: 'role', role: 'destinationAgent' },
        declaredBy: destinationAgentD,
        at,
      },
      { kind: 'OPEN' },
      context,
    )
    expect(verdict.effect).toBe('APPLIED')
    expect(verdict.entersTheContest).toBe(true)
    expect(verdict.reachesThePricedRecord).toBe(true)
    expect(verdict.obligations).toHaveLength(1)
  })

  it('INEFFECTIVE — right party, closed window: recorded, never priced, still obliged', () => {
    const verdict = decideCorrection(
      {
        corrects: eventId('d1'),
        type: 'delivery',
        reason: { errorReason: 'INCORRECT_DATA' },
        authority: { kind: 'role', role: 'destinationAgent' },
        declaredBy: destinationAgentD,
        at,
      },
      { kind: 'CLOSED', closedBy: 'LOADING_BEGAN' },
      context,
    )
    expect(verdict.effect).toBe('INEFFECTIVE')
    expect(verdict.reachesThePricedRecord).toBe(false)
    expect(verdict.entersTheContest).toBe(false)
    expect(verdict.obligations[0]?.because).toBe('INEFFECTIVE')
  })

  it('UNAUTHORISED — wrong party, and the obligation names who does have authority', () => {
    const verdict = decideCorrection(
      {
        corrects: eventId('d1'),
        type: 'delivery',
        reason: { errorReason: 'INCORRECT_DATA' },
        authority: { kind: 'role', role: 'originAgent' },
        declaredBy: originAgentA,
        at,
      },
      { kind: 'OPEN' },
      context,
    )
    expect(verdict.effect).toBe('UNAUTHORISED')
    expect(verdict.obligations[0]?.recipient).toEqual({
      kind: 'holderOfAuthority',
      holder: { kind: 'role', role: 'destinationAgent' },
    })
  })

  it('[A8 §8] an instrument grants what a role does not — and only while in force', () => {
    const sf1200 = {
      kind: 'RESERVED_CORRECTION_FORM',
      instance: 'SF 1200',
      grants: ['delivery'],
      effectiveFrom: instant('2026-03-19T00:00:00Z'),
    } as const
    expect(
      authorityToDeclare('delivery', { kind: 'instrument', instrument: sf1200 }, context).kind,
    ).toBe('AUTHORISED')
    // A-413 §H.2: the same act is unauthorised on day 1 and authorised on day 31.
    const notYet = { ...sf1200, effectiveFrom: instant('2026-04-01T00:00:00Z') }
    expect(
      authorityToDeclare('delivery', { kind: 'instrument', instrument: notYet }, context),
    ).toEqual({ kind: 'UNAUTHORISED', because: 'INSTRUMENT_NOT_IN_FORCE_AT_THIS_INSTANT' })
    // Table A-402-4: an instrument is scoped by what it may touch.
    expect(
      authorityToDeclare('weight.net', { kind: 'instrument', instrument: sf1200 }, context),
    ).toEqual({ kind: 'UNAUTHORISED', because: 'INSTRUMENT_DOES_NOT_REACH_THIS_FACT_CLASS' })
  })

  it('an owed row never silently authorises', () => {
    expect(authorityToDeclare('tripDelay', { kind: 'role', role: 'hauler' }, context)).toEqual({
      kind: 'UNAUTHORISED',
      because: 'NO_AUTHORITY_ROW_FOR_THIS_FACT_CLASS',
    })
  })

  it('[SD §6.3] only APPLIED reaches the priced record', () => {
    expect(reachesThePricedRecord('APPLIED')).toBe(true)
    expect(reachesThePricedRecord('INEFFECTIVE')).toBe(false)
    expect(reachesThePricedRecord('UNAUTHORISED')).toBe(false)
  })

  it('[SD §6.4] a retraction removes its assertion from the contest and promotes nobody', () => {
    const remaining = contestAfterRetraction(
      [eventId('a1'), eventId('a2'), eventId('a3')],
      eventId('a2'),
    )
    expect(remaining).toEqual([eventId('a1'), eventId('a3')])
    // What it does NOT do is name a winner among what remains — that is FactResolved's, republished.
    expect(remaining).not.toContain(eventId('a2'))
  })
})
