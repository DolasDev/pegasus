// ---------------------------------------------------------------------------
// Weichert golden-corpus runner + transform checks. The corpus inputs are in the
// LEGACY Weichert move shape (InvolvedParties/Survey/KeyMoveDates/...); each case
// pins the expected validation outcome after the mapping + rules run.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateOrder, UnknownIntegrationError } from './validate'
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

describe('weichert shipmentStatus restricted picklist', () => {
  // Structural (NOT a gate-corpus case — the gate's round-trip stage requires
  // corpus inputs to be structurally valid). A bad shipmentStatus reproduces the
  // live "bad value for restricted picklist" rejection.
  const order = (shipmentStatus: string) => ({
    Id: 'S1',
    InvolvedParties: {
      ShipperEmployer: { Identity: { Description: 'O-1' } },
      Coordinator: { Identity: { Description: 'C' }, EmailAddress: 'c@d.com' },
    },
    Survey: { SerivceStatus: 'Accepted', ShipmentStatus: shipmentStatus },
    DocumentationDates: ['2024-01-01'],
    KeyMoveDates: { Survey: { Planned: '2024-01-01' } },
    Financials: { EstimatedWeight: 1000 },
  })

  it('rejects a bad shipmentStatus as a structural-contract issue', () => {
    const res = validateOrder('weichert', { order: order('Under Reivew') })
    expect(res.valid).toBe(false)
    expect(res.issues).toEqual([
      expect.objectContaining({ kind: 'structural', field: 'shipments.0.shipmentStatus' }),
    ])
  })

  it('accepts a valid shipmentStatus', () => {
    expect(validateOrder('weichert', { order: order('In Process') }).valid).toBe(true)
  })
})

// Integration-agnostic orchestration behaviour of validateOrder, exercised via
// weichert (the registered integration). Mirrors the checks the longhaul POC test
// used to cover before that integration was removed.
describe('validateOrder — orchestration', () => {
  const validOrder = {
    Id: 'S1',
    InvolvedParties: {
      ShipperEmployer: { Identity: { Description: 'O-1' } },
      Coordinator: { Identity: { Description: 'Cora' }, EmailAddress: 'c@d.com' },
    },
    Survey: { SerivceStatus: 'Accepted' },
    DocumentationDates: ['2024-01-01'],
    KeyMoveDates: { Survey: { Planned: '2024-01-01' } },
    Financials: { EstimatedWeight: 1000 },
  }

  it('throws UnknownIntegrationError for an unregistered integration', () => {
    expect(() => validateOrder('nope', { order: {} })).toThrow(UnknownIntegrationError)
  })

  it('attaches a stable ruleId, field and kind to a behavioral issue', () => {
    const result = validateOrder('weichert', {
      order: { ...validOrder, Survey: { SerivceStatus: 'Awarded' } },
    })
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        ruleId: 'service-status-not-supplier-settable',
        field: 'serviceStatus',
        kind: 'behavioral',
      }),
    )
  })

  it('skips a malformed prior (rather than blocking the save on it)', () => {
    // The prior's mapped output fails the contract (bad shipmentStatus enum), so
    // the validator drops it and validates the order alone — no throw, not degraded.
    const result = validateOrder('weichert', {
      order: validOrder,
      prior: {
        ...validOrder,
        Survey: { SerivceStatus: 'Accepted', ShipmentStatus: 'NOT_A_STATUS' },
      },
    })
    expect(result.degraded).toBe(false)
    expect(result.valid).toBe(true)
  })
})
