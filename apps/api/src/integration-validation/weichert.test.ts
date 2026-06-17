// ---------------------------------------------------------------------------
// Weichert golden-corpus runner + transform checks. The corpus inputs are in the
// LEGACY Weichert move shape (InvolvedParties/Survey/KeyMoveDates/...); each case
// pins the expected validation outcome after the mapping + rules run.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateOrder } from './validate'
import { compileMapping } from './transform/mapping-format'
import { weichertMapping } from './transform/weichert.transform'
import { applyMapping } from './transform/engine'
import type { ValidationInput } from './types'

interface CorpusCase {
  name: string
  input: ValidationInput
  expected: { valid: boolean; ruleIds: string[] }
}

const corpusDir = join(process.cwd(), 'src/integration-validation/__corpus__/weichert')

function loadCorpus(): CorpusCase[] {
  return readdirSync(corpusDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(corpusDir, f), 'utf8')) as CorpusCase)
}

describe('validateOrder — weichert golden corpus', () => {
  for (const c of loadCorpus()) {
    it(`corpus: ${c.name}`, () => {
      const result = validateOrder('weichert', c.input)
      expect(result.degraded).toBe(false)
      expect(result.valid).toBe(c.expected.valid)
      expect(result.issues.map((i) => i.ruleId).sort()).toEqual([...c.expected.ruleIds].sort())
    })
  }
})

describe('weichert transform — engine extensions', () => {
  const transform = compileMapping(weichertMapping)

  it('maps the root object into a one-element shipments array ($from: ".")', () => {
    const out = applyMapping(transform, {
      Id: 'SHIP-9',
      InvolvedParties: {
        ShipperEmployer: { Identity: { Description: 'O-1' } },
        Coordinator: { Identity: { Description: 'Cora' }, EmailAddress: 'c@d.com' },
      },
      Survey: { SerivceStatus: 'Accepted', Storage1stDay: 10, GeneralComments: 'hi' },
      DocumentationDates: ['2024-01-02'],
      KeyMoveDates: { Survey: { Planned: '2024-01-01' } },
      Financials: { EstimatedWeight: 1000, ActualWeight: 1100 },
    }) as Record<string, unknown>

    expect(out['serviceOrderNumber']).toBe('O-1')
    // contactMadeDate uses array-index access DocumentationDates[0]
    expect(out['contactMadeDate']).toBe('2024-01-02')
    const shipments = out['shipments'] as Array<Record<string, unknown>>
    expect(shipments).toHaveLength(1)
    expect(shipments[0]).toMatchObject({
      supplierShipmentId: 'SHIP-9',
      netWeight: { estimated: 1000, actual: 1100 },
      surveyedStorageCostFirstDay: 10,
      comments: 'hi',
    })
  })
})
