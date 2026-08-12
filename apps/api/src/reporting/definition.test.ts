// ---------------------------------------------------------------------------
// Dashboard document schema + the v1 -> v2 upgrade.
//
// The upgrade is the load-bearing part: phase-1 documents (the built-in, and any
// row written before this deploy) are schemaVersion 1 and MUST keep rendering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { DashboardDefinitionSchema, GRID_COLUMNS, MAX_WIDGETS, parseDefinition } from './definition'

const v2Widget = {
  datasetId: 'moves-by-status',
  datasetVersion: 1,
  widget: 'bar',
  title: 'Moves',
  span: 2,
  layout: { x: 0, y: 0, w: 6, h: 4 },
}

const v2Doc = { schemaVersion: 2, widgets: [v2Widget] }

describe('v2 document schema', () => {
  it('accepts a well-formed v2 document', () => {
    expect(() => parseDefinition(v2Doc)).not.toThrow()
  })

  it('rejects a widget whose layout exceeds the grid width', () => {
    const bad = {
      ...v2Doc,
      widgets: [{ ...v2Widget, layout: { x: 0, y: 0, w: GRID_COLUMNS + 1, h: 4 } }],
    }
    expect(() => parseDefinition(bad)).toThrow()
  })

  it('rejects a negative grid position', () => {
    const bad = { ...v2Doc, widgets: [{ ...v2Widget, layout: { x: -1, y: 0, w: 6, h: 4 } }] }
    expect(() => parseDefinition(bad)).toThrow()
  })

  it(`caps widgets at ${MAX_WIDGETS} (the query endpoint's MAX_BATCH)`, () => {
    const tooMany = {
      schemaVersion: 2,
      widgets: Array.from({ length: MAX_WIDGETS + 1 }, () => v2Widget),
    }
    expect(() => parseDefinition(tooMany)).toThrow()
  })

  it('still requires datasetVersion — the drift signal', () => {
    const { datasetVersion: _omitted, ...noVersion } = v2Widget
    expect(() => parseDefinition({ schemaVersion: 2, widgets: [noVersion] })).toThrow()
  })
})

describe('v1 -> v2 upgrade', () => {
  // A phase-1 document: no `layout`, geometry expressed only as `span`, and
  // document-level id/title/description that phase 2 promotes to columns.
  const v1Doc = {
    schemaVersion: 1,
    id: 'operations-overview',
    title: 'Operations overview',
    description: 'Legacy phase-1 document',
    widgets: [
      {
        datasetId: 'longhaul-invoiced-ytd',
        datasetVersion: 1,
        widget: 'scalar',
        title: 'A',
        span: 2,
      },
      {
        datasetId: 'invoices-outstanding',
        datasetVersion: 1,
        widget: 'scalar',
        title: 'B',
        span: 2,
      },
      { datasetId: 'moves-by-status', datasetVersion: 1, widget: 'bar', title: 'C', span: 4 },
    ],
  }

  it('upgrades rather than rejecting — phase-1 rows must keep rendering', () => {
    const upgraded = parseDefinition(v1Doc)
    expect(upgraded.schemaVersion).toBe(2)
    expect(upgraded.widgets).toHaveLength(3)
  })

  it('flows spans across the 12-column grid exactly as v1 rendered', () => {
    const { widgets } = parseDefinition(v1Doc)
    // span 2 -> 6 columns. Two of them fill row 0; the span-4 wraps to row 1.
    expect(widgets[0]!.layout).toEqual({ x: 0, y: 0, w: 6, h: 4 })
    expect(widgets[1]!.layout).toEqual({ x: 6, y: 0, w: 6, h: 4 })
    expect(widgets[2]!.layout).toEqual({ x: 0, y: 4, w: 12, h: 4 })
  })

  it('retains `span` so a code rollback still renders the row', () => {
    const { widgets } = parseDefinition(v1Doc)
    expect(widgets.map((w) => w.span)).toEqual([2, 2, 4])
  })

  it('is idempotent — re-parsing an upgraded document is a no-op', () => {
    const once = parseDefinition(v1Doc)
    expect(parseDefinition(once)).toEqual(once)
  })

  it('produces a document that satisfies the v2 schema outright', () => {
    expect(() => DashboardDefinitionSchema.parse(parseDefinition(v1Doc))).not.toThrow()
  })

  it('defaults a v1 widget with no span at all', () => {
    const noSpan = {
      schemaVersion: 1,
      widgets: [{ datasetId: 'moves-by-status', datasetVersion: 1, widget: 'bar', title: 'X' }],
    }
    const { widgets } = parseDefinition(noSpan)
    expect(widgets[0]!.span).toBe(2)
    expect(widgets[0]!.layout.w).toBe(6)
  })
})

describe('unsupported documents', () => {
  it('throws on an unknown schemaVersion', () => {
    expect(() => parseDefinition({ schemaVersion: 99, widgets: [v2Widget] })).toThrow()
  })

  it('throws on a non-object', () => {
    expect(() => parseDefinition('nope')).toThrow()
  })
})
