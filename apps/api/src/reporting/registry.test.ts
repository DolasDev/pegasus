// ---------------------------------------------------------------------------
// Registry invariants.
//
// These are contract tests, not behavior tests: a dataset id is a permanent
// public identifier (phase-2 dashboard definitions reference it), so the rules
// that keep the catalog safe to publish are pinned here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { allDatasets, canRunDataset, catalogFor, datasetById, toCatalogEntry } from './registry'
import { isLegacyDataset } from './types'
import { ALL_ACTIONS } from '../authz/actions'

describe('reporting registry — catalog invariants', () => {
  it('registers every dataset under a unique id', () => {
    const ids = allDatasets().map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses kebab-case ids — they are permanent public identifiers', () => {
    for (const d of allDatasets()) {
      expect(d.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('declares a positive integer version on every dataset', () => {
    for (const d of allDatasets()) {
      expect(Number.isInteger(d.version)).toBe(true)
      expect(d.version).toBeGreaterThan(0)
    }
  })

  it('requires an action that exists in the Cedar catalog', () => {
    // A dataset must piggyback a REAL action, otherwise the second
    // authorization gate silently passes for everyone.
    const known = new Set(ALL_ACTIONS.map((a) => a.id))
    for (const d of allDatasets()) {
      expect(known.has(d.requires.id)).toBe(true)
    }
  })

  it('declares at least one column, with unique keys', () => {
    for (const d of allDatasets()) {
      const keys = d.columns.map((col) => col.key)
      expect(keys.length).toBeGreaterThan(0)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('resolves a known id and returns undefined for an unknown one', () => {
    expect(datasetById('moves-by-status')?.id).toBe('moves-by-status')
    expect(datasetById('no-such-dataset')).toBeUndefined()
  })
})

describe('reporting registry — legacy SQL safety', () => {
  // Legacy fragments are concatenated into ONE multi-statement batch, so a
  // caller-supplied string reaching `sql()` would be an injection vector.
  // Until the executor's bound-parameter path is verified end to end, legacy
  // datasets must take no free-form params at all.
  it('accepts no free-form string params on any legacy dataset', () => {
    for (const d of allDatasets().filter(isLegacyDataset)) {
      const schema = z.toJSONSchema(d.params) as {
        properties?: Record<string, { type?: string }>
      }
      const props = schema.properties ?? {}
      for (const [name, prop] of Object.entries(props)) {
        expect(prop.type, `legacy dataset "${d.id}" exposes string param "${name}"`).not.toBe(
          'string',
        )
      }
    }
  })

  it('emits exactly one statement per legacy fragment, with no trailing semicolon', () => {
    // The handler joins fragments with ';' — a fragment that carries its own
    // terminator or a second statement would shift every later recordset by
    // one and silently mis-map results onto the wrong widget.
    for (const d of allDatasets().filter(isLegacyDataset)) {
      const sql = d.sql(d.params.parse(undefined))
      expect(sql.trim().endsWith(';'), `"${d.id}" ends with ';'`).toBe(false)
      expect(sql.includes(';'), `"${d.id}" contains ';'`).toBe(false)
    }
  })

  it('never uses SELECT * — a star select can make mssql return arrays', () => {
    for (const d of allDatasets().filter(isLegacyDataset)) {
      expect(d.sql(d.params.parse(undefined))).not.toMatch(/select\s+\*/i)
    }
  })
})

describe('reporting registry — permission filtering', () => {
  it('returns an empty catalog for a caller with no dataset grants', () => {
    expect(catalogFor(new Set())).toEqual([])
  })

  it('returns only the datasets whose required permission the caller holds', () => {
    const invoiceOnly = new Set(['invoice:read'])
    const ids = catalogFor(invoiceOnly).map((d) => d.id)

    expect(ids).toContain('invoices-outstanding')
    expect(ids).toContain('longhaul-invoiced-ytd')
    expect(ids).not.toContain('moves-by-status')
    expect(ids).not.toContain('quotes-conversion-30d')
  })

  it('canRunDataset gates on the dataset’s own permission string', () => {
    const moves = datasetById('moves-by-status')!
    expect(canRunDataset(moves, new Set(['move:list']))).toBe(true)
    expect(canRunDataset(moves, new Set(['report:read']))).toBe(false)
  })
})

describe('reporting registry — catalog entry shape', () => {
  it('exposes the contract and never the implementation', () => {
    const entry = toCatalogEntry(datasetById('moves-by-status')!) as unknown as Record<
      string,
      unknown
    >

    expect(entry['id']).toBe('moves-by-status')
    expect(entry['source']).toBe('postgres')
    expect(entry['permission']).toBe('move:list')
    // Implementation details must not leak into a published contract.
    expect(entry['run']).toBeUndefined()
    expect(entry['sql']).toBeUndefined()
    expect(entry['map']).toBeUndefined()
  })

  it('renders params as a JSON Schema a client can build against', () => {
    const entry = toCatalogEntry(datasetById('moves-by-status')!)
    const schema = entry.paramsSchema as { properties?: Record<string, unknown> }
    expect(schema.properties).toHaveProperty('window')
  })
})
