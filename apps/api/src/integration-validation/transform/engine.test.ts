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

  it('throws on an unknown coercion (caught upstream as fail-open)', () => {
    const spec = [{ to: 'x', from: ['a'], coerce: 'bogus' }] as unknown as TransformSpec
    expect(() => applyMapping(spec, { a: 1 })).toThrow(/Unknown coercion/)
  })
})
