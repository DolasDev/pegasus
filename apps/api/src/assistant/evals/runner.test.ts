import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _clearAuthzCache } from '../../lib/authz'
import { createFakeProvider } from '../../lib/inference/fake'
import { DEFAULT_PROMPT } from '../prompt'
import { grade, runEvalCase, summarize, type CaseResult } from './runner'
import { parseEvalSet } from './schema'
import baseline from './ops-baseline.json'

beforeEach(() => {
  _clearAuthzCache()
  process.env['AUTHZ_OFFLINE'] = 'true'
})

describe('grade', () => {
  it('passes when every mustInclude is present and no mustNotInclude is', () => {
    expect(
      grade('Trip 4471 is late', { answer: 'x', mustInclude: ['4471'], mustNotInclude: ['$'] }),
    ).toEqual({
      verdict: 'pass',
      reasons: [],
    })
  })

  it('is case-insensitive and lists every reason', () => {
    expect(
      grade('The INVOICE total is $40', {
        answer: 'x',
        mustInclude: ['trip'],
        mustNotInclude: ['invoice', '$'],
      }),
    ).toEqual({
      verdict: 'fail',
      reasons: ['missing "trip"', 'contains forbidden "invoice"', 'contains forbidden "$"'],
    })
  })

  it('reports a case with no assertions as ungraded, never as a pass', () => {
    expect(grade('anything', { answer: 'x', mustInclude: [], mustNotInclude: [] }).verdict).toBe(
      'ungraded',
    )
  })
})

describe('runEvalCase', () => {
  it('offers tools for the CASE role, not the Lab user: the driver refusal case gets no invoice tool', async () => {
    const set = parseEvalSet(baseline)
    const driverCase = set.cases.find((c) => c.askedAs === 'driver')!
    const provider = createFakeProvider([
      { content: [{ type: 'text', text: "I don't have access to billing information." }] },
    ])
    const result = await runEvalCase({
      evalCase: driverCase,
      provider,
      prompt: DEFAULT_PROMPT,
      caller: { sub: 'lab-user', tenantId: 't', roleNames: ['tenant_admin'] },
      idToken: 'tok',
      policyStoreId: undefined,
      fetchApi: vi.fn(),
      now: new Date('2026-11-10T12:00:00Z'),
    })
    expect(result.toolsOffered).not.toContain('list_invoices')
    expect(result.verdict).toBe('pass')
  })
})

describe('summarize', () => {
  const r = (verdict: CaseResult['verdict'], tools = 0): CaseResult => ({
    id: verdict,
    askedAs: 'tenant_admin',
    verdict,
    reasons: [],
    answer: '',
    toolsCalled: Array.from({ length: tools }, () => 't'),
    toolsOffered: [],
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    latencyMs: 1000,
  })

  it('computes the pass rate over graded cases only (errors count as graded failures)', () => {
    const s = summarize([r('pass', 2), r('fail'), r('error'), r('ungraded')])
    expect(s).toMatchObject({ total: 4, graded: 3, passed: 1, meanToolCalls: 0.5 })
    expect(s.passRate).toBeCloseTo(1 / 3)
  })

  it('has a null pass rate when nothing is graded', () => {
    expect(summarize([r('ungraded')]).passRate).toBeNull()
  })
})
