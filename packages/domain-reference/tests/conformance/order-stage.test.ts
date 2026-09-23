/**
 * `orderStageAt` — [A1 §3.3]'s fold, held to the five rules that define it.
 *
 * The fold is the executable half of decision **A1-STAGE**, so this file is written the way
 * `alloy/custody.als` is written about the other projection: every test names the rule it holds,
 * and the two that could have been guessed rather than decided — rule 3 (a refused cancellation
 * does not govern) and rule 5 (a response with no award is `UNKNOWN`) — carry the argument in the
 * test rather than in a comment beside it.
 *
 * It also holds the **mapping** [A1 §3.2] publishes: element 558's `A` and `B` land on different
 * outcome members and on the **same stage**, and that is the test of the mapping rather than a
 * coincidence of it.
 */
import { describe, expect, it } from 'vitest'

import {
  ORDER_STAGES,
  ORDER_STAGE_AT_RULE,
  ORDER_STAGE_UNKNOWN_REASONS,
  AUTHORITATIVE_ROLE_AT_INSTANT,
  REASON_CODES,
  eventId,
  factRefOf,
  instant,
  orderId,
  orderStageAt,
  partyId,
  reasonCode,
  roleClass,
  specVersion,
  subjectRef,
  type CapturedAssertion,
  type FactResolved,
  type OrderCommitmentEvidence,
  type OrderLifecycleType,
  type Outcome,
  type Reason,
} from '../../src/index'

const spec = specVersion('1')
const order = subjectRef('order', orderId('O-1'))
const otherOrder = subjectRef('order', orderId('O-2'))

const vanLine = partyId('VL')
const agent = partyId('AG')
const platform = partyId('P-PLATFORM')

/** A minimal reason. Its content is not what any test here turns on; its **presence** is. */
function because(code: string): Reason {
  return {
    code: reasonCode(code),
    scope: 'ACT',
    // [A8 §9 item 2] owes the enum; `roleClass` is an `OwedCode` for exactly that reason.
    attribution: { roleClass: roleClass('carrier') },
  }
}

function act(fields: {
  id: string
  type: OrderLifecycleType
  at: string
  outcome: Outcome
  by?: 'booker' | 'hauler'
  subject?: typeof order
}): CapturedAssertion<OrderLifecycleType> {
  const base = {
    eventId: eventId(fields.id),
    type: fields.type,
    specVersion: spec,
    subject: fields.subject ?? order,
    assertedBy: {
      party: fields.by === 'hauler' ? agent : vanLine,
      role: fields.by ?? ('booker' as const),
    },
    assertedAt: instant(fields.at),
    capturedBy: 'KEYED_BY_PERSON' as const,
    basis: 'ACTUAL' as const,
  }
  const value =
    fields.outcome === 'COMPLETED'
      ? { occurredAt: instant(fields.at), outcome: 'COMPLETED' as const }
      : {
          occurredAt: instant(fields.at),
          outcome: fields.outcome,
          reasons: [because('CAUSE_UNKNOWN')] as const,
        }
  return { ...base, value } as unknown as CapturedAssertion<OrderLifecycleType>
}

/** One `FactResolved` per key — and with no qualifier on any of the three, one key per type. */
function resolve(
  assertion: CapturedAssertion<OrderLifecycleType>,
  selected: boolean = true,
): FactResolved {
  return {
    eventId: eventId(`fr-${assertion.eventId}`),
    type: 'FactResolved',
    specVersion: spec,
    subject: assertion.subject,
    assertedBy: { party: platform, role: 'platform' },
    assertedAt: instant('2026-04-01T00:00:00Z'),
    capturedBy: 'DERIVED_BY_RULE',
    factRef: factRefOf(assertion),
    selected: selected ? assertion.eventId : null,
    considered: [assertion.eventId],
    // The rule that picked the winner, not the fold that reads it — [A8 §4.4] A8-NAMED. Writing
    // `ORDER_STAGE_AT_RULE` here would put the consumer's rule on the producer's record.
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
  } as unknown as FactResolved
}

function evidenceOf(...acts: CapturedAssertion<OrderLifecycleType>[]): OrderCommitmentEvidence {
  return { acts, resolutions: acts.map((one) => resolve(one)) }
}

const NOW = instant('2026-12-31T00:00:00Z')

const awarded = act({
  id: 'a1',
  type: 'orderAward',
  at: '2026-04-02T09:00:00Z',
  outcome: 'COMPLETED',
})

describe('[A1 §3.3] orderStageAt — the commitment fold', () => {
  it('answers UNAWARDED with no evidence at all, and that is a stage rather than an UNKNOWN', () => {
    // [`fork-order` §5.3]: the order is a subject before anything is committed about it.
    const stage = orderStageAt(order, NOW, { acts: [], resolutions: [] })
    expect(stage.stage).toBe('UNAWARDED')
    expect(stage).not.toHaveProperty('why')
    // The one case where the fold answers without evidence, and the shape says so rather than
    // fabricating an instant.
    if (stage.stage !== 'UNKNOWN') {
      expect(stage.evidencedBy).toEqual([])
      expect(stage.since).toBeUndefined()
    }
  })

  it('names the rule that produced every answer — [SD §4.8.3] rule 2', () => {
    expect(orderStageAt(order, NOW, evidenceOf(awarded)).rule).toEqual(ORDER_STAGE_AT_RULE)
    expect(orderStageAt(order, NOW, { acts: [], resolutions: [] }).rule).toEqual(
      ORDER_STAGE_AT_RULE,
    )
  })

  it('walks award → accepted → cancelled, and is time-travellable', () => {
    const accepted = act({
      id: 'r1',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const cancelled = act({
      id: 'c1',
      type: 'orderCancellation',
      at: '2026-04-10T09:00:00Z',
      outcome: 'COMPLETED',
    })
    const evidence = evidenceOf(awarded, accepted, cancelled)

    expect(orderStageAt(order, instant('2026-04-01T00:00:00Z'), evidence).stage).toBe('UNAWARDED')
    expect(orderStageAt(order, instant('2026-04-02T12:00:00Z'), evidence).stage).toBe('AWARDED')
    expect(orderStageAt(order, instant('2026-04-05T00:00:00Z'), evidence).stage).toBe('ACCEPTED')
    expect(orderStageAt(order, NOW, evidence).stage).toBe('CANCELLED')
  })

  it('reads only the records about THIS order — [SD §1.4] rule 1', () => {
    const elsewhere = act({
      id: 'a-other',
      type: 'orderAward',
      at: '2026-04-02T09:00:00Z',
      outcome: 'COMPLETED',
      subject: otherOrder,
    })
    expect(orderStageAt(order, NOW, evidenceOf(elsewhere)).stage).toBe('UNAWARDED')
    expect(orderStageAt(otherOrder, NOW, evidenceOf(elsewhere)).stage).toBe('AWARDED')
  })

  it('contributes nothing from a resolution that selected nobody — [A8 §7.3] A8-JOINT', () => {
    // This is the state [A1 §8] scenario 7 lands in: the three order authority rows are owed, so a
    // contested commitment fact has no winner and the fold must read the silence as silence.
    const evidence: OrderCommitmentEvidence = {
      acts: [awarded],
      resolutions: [resolve(awarded, false)],
    }
    expect(orderStageAt(order, NOW, evidence).stage).toBe('UNAWARDED')
  })
})

describe('[A1 §3.2] element 558 — A and B differ in outcome and agree on the stage', () => {
  const cases: ReadonlyArray<readonly [string, Outcome, string]> = [
    ['A Reservation Accepted', 'COMPLETED', 'ACCEPTED'],
    ['B Conditional Acceptance', 'COMPLETED_WITH_EXCEPTION', 'ACCEPTED'],
    ['C Counter Proposal Made', 'NOT_COMPLETED', 'DECLINED'],
  ]

  for (const [label, outcome, expected] of cases) {
    it(`${label} → ${outcome} → ${expected}`, () => {
      const response = act({
        id: `r-${outcome}`,
        type: 'orderResponse',
        at: '2026-04-03T09:00:00Z',
        outcome,
        by: 'hauler',
      })
      expect(orderStageAt(order, NOW, evidenceOf(awarded, response)).stage).toBe(expected)
    })
  }

  it('is the whole test of the mapping: A and B are different records and one stage', () => {
    // If these two ever disagreed, [A1 §3.2]'s discriminator — "does a commitment stand?" — would
    // not be the thing the outcome axis encodes, and the mapping would be wrong.
    const plain = act({
      id: 'r-a',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const conditional = act({
      id: 'r-b',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED_WITH_EXCEPTION',
      by: 'hauler',
    })
    expect(orderStageAt(order, NOW, evidenceOf(awarded, plain)).stage).toBe(
      orderStageAt(order, NOW, evidenceOf(awarded, conditional)).stage,
    )
  })
})

describe('[A1 §3.3] rule 3 — a refused cancellation does not govern', () => {
  const accepted = act({
    id: 'r1',
    type: 'orderResponse',
    at: '2026-04-03T09:00:00Z',
    outcome: 'COMPLETED',
    by: 'hauler',
  })

  it('leaves an accepted order ACCEPTED — [SD §4.7.2e] item 3', () => {
    // `src:dcsa` runs cancellation on a third status track "because cancelling a confirmed booking
    // is itself a request the carrier can refuse"; `src:milmove-mymove` splits it into two acts by
    // two parties. Under [SD §4.7.2e] item 3 neither needs a mechanism of its own.
    const refused = act({
      id: 'c-refused',
      type: 'orderCancellation',
      at: '2026-04-10T09:00:00Z',
      outcome: 'NOT_COMPLETED',
      by: 'hauler',
    })
    expect(orderStageAt(order, NOW, evidenceOf(awarded, accepted, refused)).stage).toBe('ACCEPTED')
  })

  it('and a refused cancellation over an UNAWARDED order still answers UNAWARDED', () => {
    const refused = act({
      id: 'c-refused-2',
      type: 'orderCancellation',
      at: '2026-04-10T09:00:00Z',
      outcome: 'NOT_COMPLETED',
    })
    expect(orderStageAt(order, NOW, evidenceOf(refused)).stage).toBe('UNAWARDED')
  })
})

describe('[A1 §3.3] rule 4 — a tie at one instant is not broken', () => {
  it('returns UNKNOWN where two governing facts at one occurredAt answer differently', () => {
    // [A8 §4.4] A8-NAMED in its commitment-side form. The fold does not order the two by type, by
    // `assertedAt` or by the stability of the sort.
    const at = '2026-04-03T09:00:00Z'
    const accepted = act({
      id: 'r-tie',
      type: 'orderResponse',
      at,
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const cancelled = act({ id: 'c-tie', type: 'orderCancellation', at, outcome: 'COMPLETED' })
    const stage = orderStageAt(order, NOW, evidenceOf(awarded, accepted, cancelled))
    expect(stage.stage).toBe('UNKNOWN')
    if (stage.stage === 'UNKNOWN') expect(stage.why).toBe('AMBIGUOUS_ORDER_AT_INSTANT')
  })

  it('does not fire where the two facts at one instant agree', () => {
    const at = '2026-04-03T09:00:00Z'
    const accepted = act({
      id: 'r-agree',
      type: 'orderResponse',
      at,
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const refused = act({
      id: 'c-agree',
      type: 'orderCancellation',
      at,
      outcome: 'NOT_COMPLETED',
    })
    // The refused cancellation does not govern (rule 3), so there is no tie to break.
    expect(orderStageAt(order, NOW, evidenceOf(awarded, accepted, refused)).stage).toBe('ACCEPTED')
  })
})

describe('[A1 §3.3] rule 5 — a response with no award behind it is UNKNOWN', () => {
  it('refuses to let a commitment stand on one party’s word alone', () => {
    // [ORIGINAL], and the commitment-side twin of [SD §4.8.3]'s C5. Answering ACCEPTED here would
    // be the foreclosure [SD §4.7.2f] spent C5 to buy, one aggregate to the left.
    const accepted = act({
      id: 'r-orphan',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const stage = orderStageAt(order, NOW, evidenceOf(accepted))
    expect(stage.stage).toBe('UNKNOWN')
    if (stage.stage === 'UNKNOWN') expect(stage.why).toBe('RESPONSE_WITHOUT_AWARD')
  })

  it('fires where the only award is one that was not made', () => {
    const notAwarded = act({
      id: 'a-failed',
      type: 'orderAward',
      at: '2026-04-02T09:00:00Z',
      outcome: 'NOT_COMPLETED',
    })
    const accepted = act({
      id: 'r-after-failed',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    const stage = orderStageAt(order, NOW, evidenceOf(notAwarded, accepted))
    expect(stage.stage).toBe('UNKNOWN')
    if (stage.stage === 'UNKNOWN') expect(stage.why).toBe('RESPONSE_WITHOUT_AWARD')
  })

  it('does not fire where an award stands before the response', () => {
    const accepted = act({
      id: 'r-ok',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'COMPLETED',
      by: 'hauler',
    })
    expect(orderStageAt(order, NOW, evidenceOf(awarded, accepted)).stage).toBe('ACCEPTED')
  })
})

describe('[A1 §3.3] rule 2 — the readings the fold declines', () => {
  const partials: ReadonlyArray<readonly [OrderLifecycleType, string]> = [
    ['orderAward', 'AWARD_SCOPE_NOT_EXPRESSIBLE'],
    ['orderResponse', 'RESPONSE_SCOPE_NOT_EXPRESSIBLE'],
    ['orderCancellation', 'CANCELLATION_SCOPE_NOT_EXPRESSIBLE'],
  ]

  for (const [type, why] of partials) {
    it(`${type} at PARTIALLY_COMPLETED is UNKNOWN — ${why}`, () => {
      // `Reason.appliesTo` reaches a Portion and an item ([SD §2.4]) and an order's parts are
      // neither. [A1 §3.2] records the per-stop acceptance owed rather than widening it.
      const partial = act({
        id: `p-${type}`,
        type,
        at: '2026-04-20T09:00:00Z',
        outcome: 'PARTIALLY_COMPLETED',
      })
      const stage = orderStageAt(order, NOW, evidenceOf(awarded, partial))
      expect(stage.stage).toBe('UNKNOWN')
      if (stage.stage === 'UNKNOWN') expect(stage.why).toBe(why)
    })
  }

  for (const type of ['orderAward', 'orderResponse', 'orderCancellation'] as const) {
    it(`${type} at CANCELLED is UNKNOWN — a retraction is [SD §6]'s, not an outcome`, () => {
      const calledOff = act({
        id: `x-${type}`,
        type,
        at: '2026-04-20T09:00:00Z',
        outcome: 'CANCELLED',
      })
      const stage = orderStageAt(order, NOW, evidenceOf(awarded, calledOff))
      expect(stage.stage).toBe('UNKNOWN')
      if (stage.stage === 'UNKNOWN') expect(stage.why).toBe('ACT_CALLED_OFF')
    })
  }

  it('[A1 §3.5] a re-award yields AWARDED, not UNAWARDED — the row the table nearly got wrong', () => {
    // `DECLINED` and `CANCELLED` are terminal **for that award**; the next award puts the order back
    // in play. The superseding record is an `orderAward` at `COMPLETED`, which rule 2 reads as
    // `AWARDED`. A permission row saying the supersession returns the order to `UNAWARDED` would
    // contradict the fold it is a table of.
    const declined = act({
      id: 'r-declined',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'NOT_COMPLETED',
      by: 'hauler',
    })
    const reAwarded = act({
      id: 'a2',
      type: 'orderAward',
      at: '2026-04-04T09:00:00Z',
      outcome: 'COMPLETED',
    })
    expect(
      orderStageAt(order, instant('2026-04-03T12:00:00Z'), evidenceOf(awarded, declined)).stage,
    ).toBe('DECLINED')
    // The re-award supersedes, so resolution serves it alone under the key `(order, orderAward)`.
    expect(orderStageAt(order, NOW, evidenceOf(reAwarded, declined)).stage).toBe('AWARDED')
  })

  it('[A1 §3.5] a pull-back is a withdrawal act, not an award undone', () => {
    // `src:dtr-part-iv` §C.6.a-b. There is no `orderAward` outcome that removes a standing award —
    // `NOT_COMPLETED` means the award was never made (the blackout case, below). Withdrawing one
    // that WAS made is an `orderCancellation` before any response, and the fold says `CANCELLED`.
    const pulledBack = act({
      id: 'c-pullback',
      type: 'orderCancellation',
      at: '2026-04-02T18:00:00Z',
      outcome: 'COMPLETED',
    })
    expect(orderStageAt(order, NOW, evidenceOf(awarded, pulledBack)).stage).toBe('CANCELLED')
  })

  it('an award that was not made puts the order back at UNAWARDED', () => {
    // `src:dtr-part-iv`'s blackout, and the case where no eligible offeree exists.
    const notAwarded = act({
      id: 'a-none',
      type: 'orderAward',
      at: '2026-04-02T09:00:00Z',
      outcome: 'NOT_COMPLETED',
    })
    expect(orderStageAt(order, NOW, evidenceOf(notAwarded)).stage).toBe('UNAWARDED')
  })
})

describe('[A1 §3.6] DEADLINE_LAPSED', () => {
  it('is a published member of the reason vocabulary', () => {
    expect(REASON_CODES).toContain('DEADLINE_LAPSED')
  })

  it('carries the lapsed-offer case, which is a declined response with no actor', () => {
    // `src:dtr-part-iv` §C.4.b publishes non-response as a typed event **caused by nobody**;
    // `src:project44`'s `EXPIRED` and `src:alvys-api`'s `ExpirationDate` are the same shape.
    const lapsed = act({
      id: 'r-lapsed',
      type: 'orderResponse',
      at: '2026-04-03T09:00:00Z',
      outcome: 'NOT_COMPLETED',
      by: 'hauler',
    })
    const withReason = {
      ...(lapsed as unknown as Record<string, unknown>),
      value: {
        occurredAt: instant('2026-04-03T09:00:00Z'),
        outcome: 'NOT_COMPLETED',
        reasons: [because('DEADLINE_LAPSED')],
      },
    } as unknown as CapturedAssertion<OrderLifecycleType>
    expect(orderStageAt(order, NOW, evidenceOf(awarded, withReason)).stage).toBe('DECLINED')
  })
})

describe('the fold’s own vocabularies', () => {
  it('declares five stages and six UNKNOWN reasons, and no stage is spelled UNKNOWN', () => {
    expect([...ORDER_STAGES]).toEqual(['UNAWARDED', 'AWARDED', 'ACCEPTED', 'DECLINED', 'CANCELLED'])
    // `UNKNOWN` is the *absence* of a stage and must not also be a member of the enum, or a
    // consumer could not tell a computed answer from a declined one.
    expect(ORDER_STAGES as readonly string[]).not.toContain('UNKNOWN')
    expect(ORDER_STAGE_UNKNOWN_REASONS).toHaveLength(6)
  })
})
