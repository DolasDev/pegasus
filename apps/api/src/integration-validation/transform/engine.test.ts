import { describe, it, expect } from 'vitest'
import { applyMapping, type TransformSpec } from './engine'

describe('transform engine', () => {
  it('writes nested target paths', () => {
    const spec: TransformSpec = [{ to: 'status.id', from: ['s'], coerce: 'toNumber' }]
    expect(applyMapping(spec, { s: '5' })).toEqual({ status: { id: 5 } })
  })

  it('resolves the first defined source in a fallback chain', () => {
    const spec: TransformSpec = [
      { to: 'driver.id', from: ['driver.id', 'driver_id'], default: null },
    ]
    expect(applyMapping(spec, { driver_id: 7 })).toEqual({ driver: { id: 7 } })
    expect(applyMapping(spec, { driver: { id: 9 }, driver_id: 7 })).toEqual({ driver: { id: 9 } })
  })

  it('falls back to default when no source resolves', () => {
    const spec: TransformSpec = [{ to: 'x', from: ['a', 'b'], default: 42 }]
    expect(applyMapping(spec, {})).toEqual({ x: 42 })
  })

  it('coerces null safely with toNumberOrNull', () => {
    const spec: TransformSpec = [{ to: 'x', from: ['a'], default: null, coerce: 'toNumberOrNull' }]
    expect(applyMapping(spec, { a: null })).toEqual({ x: null })
    expect(applyMapping(spec, { a: '3' })).toEqual({ x: 3 })
  })

  it('maps arrays element-wise via each, defaulting a missing array to []', () => {
    const spec: TransformSpec = [
      { to: 'items', from: ['rows'], default: [], each: [{ to: 'n', from: ['order_num'] }] },
    ]
    expect(applyMapping(spec, { rows: [{ order_num: 1 }, { order_num: 2 }] })).toEqual({
      items: [{ n: 1 }, { n: 2 }],
    })
    expect(applyMapping(spec, {})).toEqual({ items: [] })
  })

  it('treats a non-array each-source as an empty list (no throw)', () => {
    const spec: TransformSpec = [
      { to: 'items', from: ['rows'], default: [], each: [{ to: 'n', from: ['x'] }] },
    ]
    expect(applyMapping(spec, { rows: 5 })).toEqual({ items: [] })
  })

  it('resolves "." to the whole input (identity)', () => {
    const spec: TransformSpec = [{ to: 'self', from: ['.'] }]
    expect(applyMapping(spec, { a: 1 })).toEqual({ self: { a: 1 } })
  })

  it('resolves array-index access in a path segment', () => {
    const spec: TransformSpec = [
      { to: 'first', from: ['dates[0]'] },
      { to: 'deep', from: ['a.b[1].c'] },
    ]
    expect(applyMapping(spec, { dates: ['x', 'y'], a: { b: [{ c: 1 }, { c: 2 }] } })).toEqual({
      first: 'x',
      deep: 2,
    })
  })

  it('wraps a single object source as a one-element list under $each', () => {
    const spec: TransformSpec = [{ to: 'items', from: ['.'], each: [{ to: 'n', from: ['id'] }] }]
    expect(applyMapping(spec, { id: 7 })).toEqual({ items: [{ n: 7 }] })
  })

  it('translates a resolved source value via $map (hit)', () => {
    const spec: TransformSpec = [{ to: 'status', from: ['s'], map: { Active: 'A', Inactive: 'I' } }]
    expect(applyMapping(spec, { s: 'Active' })).toEqual({ status: 'A' })
  })

  it('falls back to default on a $map miss when a default is declared', () => {
    const spec: TransformSpec = [{ to: 'status', from: ['s'], map: { Active: 'A' }, default: '?' }]
    expect(applyMapping(spec, { s: 'Unknown' })).toEqual({ status: '?' })
  })

  it('passes the source through on a $map miss when no default is declared', () => {
    const spec: TransformSpec = [{ to: 'status', from: ['s'], map: { Active: 'A' } }]
    expect(applyMapping(spec, { s: 'Unknown' })).toEqual({ status: 'Unknown' })
  })

  it('uses default directly (never $map-translates it) when no source resolves', () => {
    const spec: TransformSpec = [{ to: 'status', from: ['s'], map: { Active: 'A' }, default: 'D' }]
    expect(applyMapping(spec, {})).toEqual({ status: 'D' })
  })

  it('applies $map before coerce', () => {
    const spec: TransformSpec = [{ to: 'n', from: ['s'], map: { '1': '10' }, coerce: 'toNumber' }]
    expect(applyMapping(spec, { s: 1 })).toEqual({ n: 10 })
  })

  it('skips $map for a null source value', () => {
    const spec: TransformSpec = [{ to: 'x', from: ['s'], map: { Active: 'A' }, default: '?' }]
    expect(applyMapping(spec, { s: null })).toEqual({ x: null })
  })

  it('throws on an unknown coercion (caught upstream as fail-open)', () => {
    const spec = [{ to: 'x', from: ['a'], coerce: 'bogus' }] as unknown as TransformSpec
    expect(() => applyMapping(spec, { a: 1 })).toThrow(/Unknown coercion/)
  })
})

// sdk-feedback 0039 — every partner that documents `YYYY-MM-DD` needs these, and
// the legacy source only ever emits .NET datetimes.
describe('date coercions', () => {
  const dateOnly = (a: unknown): unknown =>
    applyMapping([{ to: 'd', from: ['a'], coerce: 'toDateOnly' }], { a })['d']
  const isoDateTime = (a: unknown): unknown =>
    applyMapping([{ to: 'd', from: ['a'], coerce: 'toIsoDateTime' }], { a })['d']

  it('truncates a .NET midnight datetime to its calendar date', () => {
    expect(dateOnly('2026-07-16T00:00:00')).toBe('2026-07-16')
  })

  it('keeps the serialized day for a datetime with a real time component', () => {
    // The day must not shift regardless of the host timezone — these are
    // wall-clock dates, so no parsing through the local-time Date constructor.
    expect(dateOnly('2026-08-10T17:06:13.093')).toBe('2026-08-10')
    expect(dateOnly('2026-08-10T23:59:59')).toBe('2026-08-10')
    expect(dateOnly('2026-08-10T00:00:00Z')).toBe('2026-08-10')
    expect(dateOnly('2026-08-10T00:00:00-05:00')).toBe('2026-08-10')
  })

  it('passes a date-only value through unchanged', () => {
    expect(dateOnly('2026-07-16')).toBe('2026-07-16')
  })

  it('yields null for every non-date input — never "Invalid Date" or an epoch', () => {
    expect(dateOnly(null)).toBeNull()
    expect(dateOnly(undefined)).toBeNull() // absent path
    expect(dateOnly('')).toBeNull()
    expect(dateOnly('   ')).toBeNull()
    expect(dateOnly('not a date')).toBeNull()
    expect(dateOnly('2026-07-16T00:00:00 and then some')).toBeNull()
    expect(dateOnly(20260716)).toBeNull()
    expect(dateOnly({ when: '2026-07-16' })).toBeNull()
  })

  it('rejects a well-shaped but non-existent calendar date', () => {
    expect(dateOnly('2026-02-30T00:00:00')).toBeNull()
    expect(dateOnly('2026-13-01')).toBeNull()
    expect(dateOnly('2026-07-16T25:00:00')).toBeNull()
    // ...while a real leap day passes.
    expect(dateOnly('2028-02-29T00:00:00')).toBe('2028-02-29')
  })

  it('preserves the .NET min-date sentinel as a date rather than inventing null', () => {
    // Nulling the sentinel is `$map`'s job (see the composition test below); the
    // coercion itself must not silently take on that policy.
    expect(dateOnly('0001-01-01T00:00:00')).toBe('0001-01-01')
  })

  it('normalizes to full ISO with toIsoDateTime, padding a date-only input', () => {
    expect(isoDateTime('2026-07-16')).toBe('2026-07-16T00:00:00')
    expect(isoDateTime('2026-08-10T17:06:13.093')).toBe('2026-08-10T17:06:13')
    expect(isoDateTime('2026-08-10T17:06')).toBe('2026-08-10T17:06:00')
    // Truncation, not conversion: the offset is dropped, the clock is untouched.
    expect(isoDateTime('2026-08-10T17:06:13Z')).toBe('2026-08-10T17:06:13')
    expect(isoDateTime('2026-08-10T17:06:13+05:30')).toBe('2026-08-10T17:06:13')
    expect(isoDateTime(null)).toBeNull()
    expect(isoDateTime('nope')).toBeNull()
  })

  it('composes with $map in ONE leaf: sentinel → null, real date → YYYY-MM-DD', () => {
    const spec: TransformSpec = [
      {
        to: 'surveyDate',
        from: ['KeyMoveDates.Survey.Planned'],
        map: { '0001-01-01T00:00:00': null },
        coerce: 'toDateOnly',
      },
    ]
    expect(
      applyMapping(spec, { KeyMoveDates: { Survey: { Planned: '0001-01-01T00:00:00' } } })[
        'surveyDate'
      ],
    ).toBeNull()
    expect(
      applyMapping(spec, { KeyMoveDates: { Survey: { Planned: '2026-07-09T00:00:00' } } }),
    ).toEqual({ surveyDate: '2026-07-09' })
  })

  it('applies inside $each (the shipment date leaves are all nested)', () => {
    const spec: TransformSpec = [
      {
        to: 'shipments',
        from: ['.'],
        each: [
          {
            to: 'packDate1.actual',
            from: ['KeyMoveDates.Pack.Actual'],
            map: { '0001-01-01T00:00:00': null },
            coerce: 'toDateOnly',
          },
          {
            to: 'packDate1.estimated',
            from: ['KeyMoveDates.Pack.Planned'],
            coerce: 'toDateOnly',
          },
        ],
      },
    ]
    expect(
      applyMapping(spec, {
        KeyMoveDates: { Pack: { Planned: '2026-07-16T00:00:00', Actual: '0001-01-01T00:00:00' } },
      }),
    ).toEqual({ shipments: [{ packDate1: { actual: null, estimated: '2026-07-16' } }] })
  })
})
