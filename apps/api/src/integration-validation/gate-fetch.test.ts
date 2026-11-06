// ---------------------------------------------------------------------------
// The `fetch` stages of the publish gate (Gap B), exercised through the REAL
// gate against REAL floors — not against `checkFetchBlock` directly (that has
// its own unit tests in lib/integration-fetch.test.ts). What this file pins is
// the WIRING: that a floor's `capabilities` actually reach the gate, that a
// fetch problem fails the gate, and that a floor declaring none refuses a pull.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { runGatePipeline } from './gate-pipeline'
import { getGateBase, getIntegrationDefinition } from './registry'
import { FINANCIAL_SETTLEMENT_FLOOR } from './floors/financial-settlement.floor'
import { demoPartnerCorpus } from './corpus'

/** A settlement-floor base — the floor that declares `settlements`. */
const settlementBase = getGateBase('atlas_settlement', FINANCIAL_SETTLEMENT_FLOOR)!

/** demo_partner sits on shipment_status_update, which declares NO capabilities. */
const demoBase = getIntegrationDefinition('demo_partner')!

/** A gate candidate that is otherwise valid, so only the fetch stage can fail. */
function candidate(fetch?: unknown) {
  return {
    mapping: {},
    rules: [],
    corpus: [],
    ...(fetch !== undefined ? { fetch } : {}),
  }
}

const atlasFetch = {
  settlements: {
    method: 'GET',
    path: '/settlement/v1/settlement',
    query: { settlementDate: '{{settlementDate}}' },
    decode: 'jsonString',
    recordsPath: 'agentSettlements',
    page: { style: 'none' },
  },
}

describe('gate — capabilities reach it from the floor', () => {
  it('financial_settlement declares settlements', () => {
    expect(settlementBase.capabilities).toEqual(['settlements'])
  })

  it('shipment_status_update declares none, so declarative pull is unavailable', () => {
    expect(demoBase.capabilities).toBeUndefined()
  })
})

describe('gate — a valid fetch block passes', () => {
  it('accepts the Atlas settlements descriptor on the settlement floor', () => {
    const report = runGatePipeline(settlementBase, candidate(atlasFetch))
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('a config with no fetch block is unaffected', () => {
    const report = runGatePipeline(settlementBase, candidate())
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('does not disturb the shipped demo_partner gate run', () => {
    const report = runGatePipeline(demoBase, {
      mapping: demoBase.mapping,
      rules: demoBase.rules,
      corpus: demoPartnerCorpus,
    })
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
  })
})

describe('gate — fetch-format stage (shape)', () => {
  it('fails the gate on an unknown page style, tagged fetch-format', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({ settlements: { method: 'GET', path: '/s', page: { style: 'offset' } } }),
    )
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'fetch-format')).toBe(true)
  })

  it('fails on a mutating method — a fetch is a read', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({ settlements: { method: 'DELETE', path: '/s' } }),
    )
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'fetch-format')).toBe(true)
  })

  it('reports fetch-format and skips the content stage for the same block', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({ documents: { method: 'WRONG', path: '/d' } }),
    )
    // Shape failed, so the capability check never ran — one stage, not both.
    expect(report.problems.every((p) => p.stage === 'fetch-format')).toBe(true)
  })
})

describe('gate — fetch stage (content)', () => {
  it('refuses an operation the floor does not declare', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({ documents: { method: 'GET', path: '/documents/v1/list' } }),
    )
    expect(report.ok).toBe(false)
    const problem = report.problems.find((p) => p.stage === 'fetch')
    expect(problem).toMatchObject({ where: 'documents' })
    expect(problem?.problem).toContain('settlements')
  })

  it('refuses ANY operation on a floor declaring no capabilities', () => {
    const report = runGatePipeline(demoBase, {
      mapping: demoBase.mapping,
      rules: demoBase.rules,
      corpus: demoPartnerCorpus,
      fetch: atlasFetch,
    })
    expect(report.ok).toBe(false)
    expect(
      report.problems.some((p) => p.stage === 'fetch' && /no capabilities/.test(p.problem)),
    ).toBe(true)
  })

  it('refuses a secret templated into a query string', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({
        settlements: { method: 'GET', path: '/s', query: { k: '{{secret:ATLAS_SUB_KEY}}' } },
      }),
    )
    expect(report.ok).toBe(false)
    const problem = report.problems.find((p) => p.stage === 'fetch')
    expect(problem?.where).toBe('settlements.query.k')
    expect(problem?.problem).toContain('secretHeaders')
  })

  it('refuses a reserved header', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({
        settlements: { method: 'GET', path: '/s', headers: { Authorization: 'Bearer x' } },
      }),
    )
    expect(report.ok).toBe(false)
    expect(report.problems.some((p) => p.stage === 'fetch' && /reserved/.test(p.problem))).toBe(
      true,
    )
  })

  it('refuses an expression, keeping the DSL bounded', () => {
    const report = runGatePipeline(
      settlementBase,
      candidate({
        settlements: { method: 'GET', path: '/s', query: { q: '{{#if vendor}}' } },
      }),
    )
    expect(report.ok).toBe(false)
    expect(
      report.problems.some(
        (p) => p.stage === 'fetch' && /not an expression language/.test(p.problem),
      ),
    ).toBe(true)
  })
})
