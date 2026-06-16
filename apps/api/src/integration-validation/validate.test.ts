// ---------------------------------------------------------------------------
// Golden-corpus runner + orchestrator tests. The corpus is the AI loop's seed:
// (order input → expected validation outcome) cases as diffable JSON. Each case
// also proves guard-for-guard parity with the imperative handlers it replaces.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateOrder, UnknownIntegrationError } from './validate'
import type { ValidationInput } from './types'

interface CorpusCase {
  name: string
  input: ValidationInput
  expected: { valid: boolean; ruleIds: string[] }
}

// Vitest runs with cwd = the apps/api package root (turbo per-package execution).
const corpusDir = join(process.cwd(), 'src/integration-validation/__corpus__/longhaul')

function loadCorpus(): CorpusCase[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(corpusDir, f), 'utf8')) as CorpusCase)
}

describe('validateOrder — longhaul golden corpus', () => {
  const corpus = loadCorpus()

  it('has a corpus covering all six lifted guards', () => {
    const covered = new Set(corpus.flatMap((c) => c.expected.ruleIds))
    for (const id of [
      'trip-must-have-shipments',
      'no-driver-change-in-progress',
      'no-remove-activity-with-actual-date',
      'no-advance-without-driver',
      'no-finalize-without-actual-dates',
      'no-cancel-after-in-progress',
    ]) {
      expect(covered, `corpus must exercise ${id}`).toContain(id)
    }
  })

  for (const c of corpus) {
    it(`corpus: ${c.name}`, () => {
      const result = validateOrder('longhaul', c.input)
      expect(result.degraded).toBe(false)
      expect(result.valid).toBe(c.expected.valid)
      expect(result.issues.map((i) => i.ruleId).sort()).toEqual([...c.expected.ruleIds].sort())
    })
  }
})

describe('validateOrder — orchestration', () => {
  it('throws UnknownIntegrationError for an unregistered integration', () => {
    expect(() => validateOrder('nope', { order: {} })).toThrow(UnknownIntegrationError)
  })

  it('maps a structural issue onto its canonical field path', () => {
    const result = validateOrder('longhaul', {
      order: { TripStatus_id: 'x', shipments: [{ order_num: 1 }] },
    })
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toMatchObject({ kind: 'structural', field: 'status.id' })
  })

  it('skips transition rules when prior state is malformed (rather than blocking)', () => {
    const result = validateOrder('longhaul', {
      action: 'save',
      order: {
        TripStatus_id: 4,
        driver: { id: 99 },
        shipments: [{ order_num: 1 }],
        activities: [],
      },
      prior: { TripStatus_id: 'broken' },
    })
    // R2 needs a usable prior; with prior unusable, no driver-change issue fires.
    expect(result.issues.map((i) => i.ruleId)).not.toContain('no-driver-change-in-progress')
    expect(result.degraded).toBe(false)
  })

  it('attaches a stable ruleId and field to a behavioral issue', () => {
    const result = validateOrder('longhaul', { order: { TripStatus_id: 1, shipments: [] } })
    expect(result.issues).toEqual([
      expect.objectContaining({
        ruleId: 'trip-must-have-shipments',
        field: 'shipments',
        kind: 'behavioral',
      }),
    ])
  })
})
