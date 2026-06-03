// ---------------------------------------------------------------------------
// Unit tests for the Driver Import CSV pipeline. Covers the pure functions
// only — parseCsv (File) and downloadTemplate (Blob) are exercised
// indirectly via parseCsvText / buildTemplateCsv.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest'
import {
  buildTemplateCsv,
  coerceRow,
  parseCsvText,
  TEMPLATE_HEADERS,
  toUpdatePayload,
  validateMapping,
  type ColumnMapping,
} from '../csv'

describe('parseCsvText', () => {
  it('uses real header names when hasHeaders=true', () => {
    const csv = 'Driver Code,Notes\nAB1,hello\nAB2,world'
    const { columns, rows } = parseCsvText(csv, true)
    expect(columns).toEqual(['Driver Code', 'Notes'])
    expect(rows).toEqual([
      ['AB1', 'hello'],
      ['AB2', 'world'],
    ])
  })

  it('labels columns col1/col2/... when hasHeaders=false', () => {
    const csv = 'AB1,hello\nAB2,world'
    const { columns, rows } = parseCsvText(csv, false)
    expect(columns).toEqual(['col1', 'col2'])
    expect(rows).toEqual([
      ['AB1', 'hello'],
      ['AB2', 'world'],
    ])
  })

  it('falls back to col<i> for blank header cells', () => {
    const csv = 'Code,,Notes\nAB1,X,hi'
    const { columns } = parseCsvText(csv, true)
    expect(columns).toEqual(['Code', 'col2', 'Notes'])
  })

  it('pads short rows to the widest row length', () => {
    const csv = 'a,b,c\n1,2\n3,4,5'
    const { rows } = parseCsvText(csv, true)
    expect(rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
    ])
  })

  it('throws when the file is empty', () => {
    expect(() => parseCsvText('', true)).toThrow(/empty/i)
  })
})

describe('validateMapping', () => {
  it('requires agentCode to be mapped', () => {
    const { ok, errors } = validateMapping([null, 'notes'])
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/Driver Code/)
  })

  it('rejects duplicate targets', () => {
    const mapping: ColumnMapping = ['agentCode', 'agentCode']
    const { ok, errors } = validateMapping(mapping)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/more than one/)
  })

  it('passes when agentCode is mapped exactly once', () => {
    expect(validateMapping(['agentCode', 'notes']).ok).toBe(true)
  })
})

describe('coerceRow', () => {
  it('returns null when agentCode cell is blank', () => {
    expect(coerceRow(['', 'hi'], ['agentCode', 'notes'])).toBeNull()
  })

  it('coerces booleans across yes/no/true/false/1/0', () => {
    const mapping: ColumnMapping = ['agentCode', 'canada', 'california']
    expect(coerceRow(['AB1', 'yes', '0'], mapping)).toMatchObject({
      canada: true,
      california: false,
    })
    expect(coerceRow(['AB1', 'NO', 'TRUE'], mapping)).toMatchObject({
      canada: false,
      california: true,
    })
  })

  it('coerces numbers and falls back to null on NaN', () => {
    const mapping: ColumnMapping = ['agentCode', 'rating']
    expect(coerceRow(['AB1', '4'], mapping)?.rating).toBe(4)
    expect(coerceRow(['AB1', 'oops'], mapping)?.rating).toBeNull()
  })

  it('normalises dates to YYYY-MM-DD', () => {
    const mapping: ColumnMapping = ['agentCode', 'confirmedDate']
    expect(coerceRow(['AB1', '2026-06-15'], mapping)?.confirmedDate).toBe('2026-06-15')
    expect(coerceRow(['AB1', 'June 15 2026'], mapping)?.confirmedDate).toBe('2026-06-15')
    expect(coerceRow(['AB1', 'not a date'], mapping)?.confirmedDate).toBeNull()
  })

  it('treats empty cells as null regardless of kind', () => {
    const mapping: ColumnMapping = ['agentCode', 'notes', 'rating']
    const row = coerceRow(['AB1', '', ''], mapping)
    expect(row?.notes).toBeNull()
    expect(row?.rating).toBeNull()
  })

  it('skips columns mapped to null', () => {
    const mapping: ColumnMapping = ['agentCode', null, 'notes']
    const row = coerceRow(['AB1', 'IGNORED', 'hi'], mapping)
    expect(row).toEqual({ agentCode: 'AB1', notes: 'hi' })
  })
})

describe('toUpdatePayload', () => {
  it('joins state + city into "STATE, City" for confirmedLocation', () => {
    const row = coerceRow(
      ['AB1', 'tx', 'Houston'],
      ['agentCode', 'confirmedState', 'confirmedCity'],
    )!
    const payload = toUpdatePayload(row, 42)
    expect(payload.confirmedLocation).toBe('TX, Houston')
    expect(payload.driverId).toBe(42)
  })

  it('falls back to state-only or city-only when one side is blank', () => {
    const stateOnly = coerceRow(
      ['AB1', 'CA', ''],
      ['agentCode', 'confirmedState', 'confirmedCity'],
    )!
    expect(toUpdatePayload(stateOnly, 1).confirmedLocation).toBe('CA')
    const cityOnly = coerceRow(
      ['AB1', '', 'Seattle'],
      ['agentCode', 'confirmedState', 'confirmedCity'],
    )!
    expect(toUpdatePayload(cityOnly, 1).confirmedLocation).toBe('Seattle')
  })

  it('confirmedLocation is null when both state and city are unmapped', () => {
    const row = coerceRow(['AB1', 'hi'], ['agentCode', 'notes'])!
    expect(toUpdatePayload(row, 1).confirmedLocation).toBeNull()
  })

  it('only emits optional keys that the row actually set', () => {
    const row = coerceRow(['AB1', 'hi'], ['agentCode', 'notes'])!
    const payload = toUpdatePayload(row, 1)
    expect(payload).toEqual({
      driverId: 1,
      confirmedDate: null,
      confirmedLocation: null,
      notes: 'hi',
    })
    expect('canada' in payload).toBe(false)
    expect('rating' in payload).toBe(false)
  })
})

describe('buildTemplateCsv', () => {
  it('emits the canonical header row first', () => {
    const csv = buildTemplateCsv()
    const firstLine = csv.split(/\r?\n/)[0]!
    expect(firstLine.split(',')).toEqual(TEMPLATE_HEADERS)
  })

  it('includes a non-empty sample data row', () => {
    const csv = buildTemplateCsv()
    const lines = csv.split(/\r?\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[1]!.split(',').length).toBe(TEMPLATE_HEADERS.length)
  })
})
