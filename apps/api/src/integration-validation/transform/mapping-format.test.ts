import { describe, it, expect } from 'vitest'
import {
  MappingTemplateSchema,
  compileMapping,
  collectTargetPaths,
  collectTopLevelSourceRoots,
  mappingFormatJsonSchema,
  type MappingTemplate,
} from './mapping-format'
import { applyMapping } from './engine'
import { longhaulMapping } from './longhaul.transform'

describe('mapping format — parsing', () => {
  it('accepts plain-string leaves, directives, nesting and $each', () => {
    const tmpl: MappingTemplate = {
      a: 'src_a',
      nested: { b: { $from: ['x', 'y'], default: null, coerce: 'toNumber' } },
      list: { $from: 'rows', $each: { n: { $from: 'order_num' } } },
    }
    expect(MappingTemplateSchema.safeParse(tmpl).success).toBe(true)
  })

  it('rejects a nested field name starting with "$" (reserved for directives)', () => {
    expect(MappingTemplateSchema.safeParse({ obj: { $weird: 'x' } }).success).toBe(false)
  })

  it('rejects a directive with unknown keys (typo guard)', () => {
    expect(MappingTemplateSchema.safeParse({ a: { $from: 'x', defualt: 1 } }).success).toBe(false)
  })

  it('rejects an empty $from', () => {
    expect(MappingTemplateSchema.safeParse({ a: { $from: '' } }).success).toBe(false)
  })

  it('accepts a $map value-translation table of scalar outputs', () => {
    const tmpl: MappingTemplate = { status: { $from: 's', $map: { Active: 'A', Gone: null } } }
    expect(MappingTemplateSchema.safeParse(tmpl).success).toBe(true)
  })

  it('rejects a $map whose output value is not a scalar', () => {
    expect(
      MappingTemplateSchema.safeParse({ a: { $from: 's', $map: { X: { nested: 1 } } } }).success,
    ).toBe(false)
  })
})

describe('mapping format — compile', () => {
  it('compiles plain string to a single-source field mapping', () => {
    expect(compileMapping({ a: 'src' })).toEqual([{ to: 'a', from: ['src'] }])
  })

  it('compiles nested objects to dot-path targets', () => {
    expect(compileMapping({ status: { id: 'TripStatus_id' } })).toEqual([
      { to: 'status.id', from: ['TripStatus_id'] },
    ])
  })

  it('compiles a directive with fallback chain, default and coerce', () => {
    expect(
      compileMapping({ d: { $from: ['a', 'b'], default: null, coerce: 'toNumberOrNull' } }),
    ).toEqual([{ to: 'd', from: ['a', 'b'], default: null, coerce: 'toNumberOrNull' }])
  })

  it('compiles $each to an array field mapping with an element sub-spec', () => {
    expect(
      compileMapping({ list: { $from: 'rows', $each: { n: { $from: 'order_num' } } } }),
    ).toEqual([
      { to: 'list', from: ['rows'], default: [], each: [{ to: 'n', from: ['order_num'] }] },
    ])
  })

  it('compiles a $map directive to a field mapping with a value-translation table', () => {
    expect(
      compileMapping({ status: { $from: 's', $map: { Active: 'A' }, default: null } }),
    ).toEqual([{ to: 'status', from: ['s'], default: null, map: { Active: 'A' } }])
  })

  it('compiled longhaul mapping transforms a real DTO to the canonical shape', () => {
    const out = applyMapping(compileMapping(longhaulMapping), {
      id: 50,
      TripStatus_id: 4,
      driver: { id: 7 },
      dispatcher: { code: 5 },
      shipments: [{ order_num: 100 }],
      activities: [{ order_num: 100, ActivityType_code: 'LOAD', actual_date: '2026-01-01' }],
    })
    expect(out).toEqual({
      id: 50,
      status: { id: 4, name: null },
      driver: { id: 7 },
      dispatcher: { code: '5' },
      shipments: [{ orderNum: 100 }],
      activities: [{ orderNum: 100, typeCode: 'LOAD', actualDate: '2026-01-01' }],
    })
  })
})

describe('mapping format — path collection', () => {
  it('collects produced target paths (arrays marked with [])', () => {
    expect(collectTargetPaths(longhaulMapping).sort()).toEqual(
      [
        'activities[].actualDate',
        'activities[].orderNum',
        'activities[].typeCode',
        'dispatcher.code',
        'driver.id',
        'id',
        'shipments[].orderNum',
        'status.id',
        'status.name',
      ].sort(),
    )
  })

  it('collects top-level source roots without descending into $each', () => {
    const roots = collectTopLevelSourceRoots(longhaulMapping).sort()
    expect(roots).toContain('TripStatus_id')
    expect(roots).toContain('shipments')
    // order_num lives inside $each (element scope) — must NOT surface as an order root.
    expect(roots).not.toContain('order_num')
  })
})

describe('mapping format — published JSON Schema', () => {
  it('exports a draft-2020-12 object schema', () => {
    const js = mappingFormatJsonSchema() as Record<string, unknown>
    expect(js['$schema']).toContain('2020-12')
    expect(js['type']).toBe('object')
  })
})
