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
    const csv = 'Driver Code,Notes\n1234,hello\n1235,world'
    const { columns, rows } = parseCsvText(csv, true)
    expect(columns).toEqual(['Driver Code', 'Notes'])
    expect(rows).toEqual([
      ['1234', 'hello'],
      ['1235', 'world'],
    ])
  })

  it('labels columns col1/col2/... when hasHeaders=false', () => {
    const csv = '1234,hello\n1235,world'
    const { columns, rows } = parseCsvText(csv, false)
    expect(columns).toEqual(['col1', 'col2'])
    expect(rows).toEqual([
      ['1234', 'hello'],
      ['1235', 'world'],
    ])
  })

  it('falls back to col<i> for blank header cells', () => {
    const csv = 'Code,,Notes\n1234,X,hi'
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
  it('requires driverId (Driver Code) to be mapped', () => {
    const { ok, errors } = validateMapping([null, 'notes'])
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/Driver Code/)
  })

  it('rejects duplicate targets', () => {
    const mapping: ColumnMapping = ['driverId', 'driverId']
    const { ok, errors } = validateMapping(mapping)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/more than one/)
  })

  it('passes when driverId is mapped exactly once', () => {
    expect(validateMapping(['driverId', 'notes']).ok).toBe(true)
  })
})

describe('coerceRow', () => {
  it('returns null when Driver Code cell is blank', () => {
    expect(coerceRow(['', 'hi'], ['driverId', 'notes'])).toBeNull()
  })

  it('returns null when Driver Code is not a positive integer', () => {
    expect(coerceRow(['oops', 'hi'], ['driverId', 'notes'])).toBeNull()
    expect(coerceRow(['0', 'hi'], ['driverId', 'notes'])).toBeNull()
    expect(coerceRow(['-1', 'hi'], ['driverId', 'notes'])).toBeNull()
    expect(coerceRow(['1.5', 'hi'], ['driverId', 'notes'])).toBeNull()
  })

  it('parses Driver Code as a number', () => {
    const row = coerceRow(['1234', 'hi'], ['driverId', 'notes'])
    expect(row?.driverId).toBe(1234)
  })

  it('coerces booleans across yes/no/true/false/1/0', () => {
    const mapping: ColumnMapping = ['driverId', 'canada', 'california']
    expect(coerceRow(['1', 'yes', '0'], mapping)).toMatchObject({
      canada: true,
      california: false,
    })
    expect(coerceRow(['1', 'NO', 'TRUE'], mapping)).toMatchObject({
      canada: false,
      california: true,
    })
  })

  it('coerces numbers and falls back to null on NaN', () => {
    const mapping: ColumnMapping = ['driverId', 'rating']
    expect(coerceRow(['1', '4'], mapping)?.rating).toBe(4)
    expect(coerceRow(['1', 'oops'], mapping)?.rating).toBeNull()
  })

  it('normalises dates to YYYY-MM-DD', () => {
    const mapping: ColumnMapping = ['driverId', 'confirmedDate']
    expect(coerceRow(['1', '2026-06-15'], mapping)?.confirmedDate).toBe('2026-06-15')
    expect(coerceRow(['1', 'June 15 2026'], mapping)?.confirmedDate).toBe('2026-06-15')
    expect(coerceRow(['1', 'not a date'], mapping)?.confirmedDate).toBeNull()
  })

  it('treats empty cells as null regardless of kind', () => {
    const mapping: ColumnMapping = ['driverId', 'notes', 'rating']
    const row = coerceRow(['1', '', ''], mapping)
    expect(row?.notes).toBeNull()
    expect(row?.rating).toBeNull()
  })

  it('skips columns mapped to null', () => {
    const mapping: ColumnMapping = ['driverId', null, 'notes']
    const row = coerceRow(['1', 'IGNORED', 'hi'], mapping)
    expect(row).toEqual({ driverId: 1, notes: 'hi' })
  })
})

describe('toUpdatePayload', () => {
  it('joins state + city into "STATE, City" for confirmedLocation', () => {
    const row = coerceRow(['42', 'tx', 'Houston'], ['driverId', 'confirmedState', 'confirmedCity'])!
    const payload = toUpdatePayload(row)
    expect(payload.confirmedLocation).toBe('TX, Houston')
    expect(payload.driverId).toBe(42)
  })

  it('falls back to state-only or city-only when one side is blank', () => {
    const stateOnly = coerceRow(['1', 'CA', ''], ['driverId', 'confirmedState', 'confirmedCity'])!
    expect(toUpdatePayload(stateOnly).confirmedLocation).toBe('CA')
    const cityOnly = coerceRow(
      ['1', '', 'Seattle'],
      ['driverId', 'confirmedState', 'confirmedCity'],
    )!
    expect(toUpdatePayload(cityOnly).confirmedLocation).toBe('Seattle')
  })

  it('confirmedLocation is null when both state and city are unmapped', () => {
    const row = coerceRow(['1', 'hi'], ['driverId', 'notes'])!
    expect(toUpdatePayload(row).confirmedLocation).toBeNull()
  })

  it('only emits optional keys that the row actually set', () => {
    const row = coerceRow(['1', 'hi'], ['driverId', 'notes'])!
    const payload = toUpdatePayload(row)
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

  it('lists Driver Code (not Agent Code) as the first header', () => {
    expect(TEMPLATE_HEADERS[0]).toBe('Driver Code')
  })

  it('includes a non-empty sample data row', () => {
    const csv = buildTemplateCsv()
    const lines = csv.split(/\r?\n/).filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[1]!.split(',').length).toBe(TEMPLATE_HEADERS.length)
  })
})
