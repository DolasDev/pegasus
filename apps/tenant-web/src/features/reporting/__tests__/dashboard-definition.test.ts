// ---------------------------------------------------------------------------
// DashboardDefinition schema + the phase-2 substitution guard.
//
// The point of phase 1 is that phase 2 (publishable, forkable dashboards with a
// per-user default) costs a loader change and nothing else. The round-trip test
// at the bottom is what actually holds us to that.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  DashboardDefinitionSchema,
  parseDashboardDefinition,
  toQueryRequests,
} from '../dashboard-definition'
import { BUILTIN_DASHBOARD } from '../builtin-dashboard'

const valid = {
  schemaVersion: 1,
  id: 'test-dash',
  title: 'Test',
  widgets: [
    { datasetId: 'moves-by-status', datasetVersion: 1, widget: 'bar', title: 'Moves', span: 2 },
  ],
}

describe('DashboardDefinition schema', () => {
  it('accepts a well-formed definition', () => {
    expect(() => parseDashboardDefinition(valid)).not.toThrow()
  })

  it('requires datasetVersion on every widget', () => {
    // Without it, a forked dashboard cannot detect that the dataset it was
    // authored against has since changed its columns.
    const noVersion = {
      ...valid,
      widgets: [{ datasetId: 'moves-by-status', widget: 'bar', title: 'Moves', span: 2 }],
    }
    expect(() => parseDashboardDefinition(noVersion)).toThrow()
  })

  it('rejects a non-positive datasetVersion', () => {
    const bad = { ...valid, widgets: [{ ...valid.widgets[0], datasetVersion: 0 }] }
    expect(() => parseDashboardDefinition(bad)).toThrow()
  })

  it('rejects an unknown widget kind', () => {
    const bad = { ...valid, widgets: [{ ...valid.widgets[0], widget: 'pie' }] }
    expect(() => parseDashboardDefinition(bad)).toThrow()
  })

  it('rejects an unknown schemaVersion', () => {
    expect(() => parseDashboardDefinition({ ...valid, schemaVersion: 2 })).toThrow()
  })

  it('rejects an empty widget list', () => {
    expect(() => parseDashboardDefinition({ ...valid, widgets: [] })).toThrow()
  })

  it('caps widgets at the API batch limit of 12', () => {
    // Mirrors MAX_BATCH server-side — a 13-widget dashboard would 400 at query
    // time, so it must not be constructible here either.
    const thirteen = { ...valid, widgets: Array.from({ length: 13 }, () => valid.widgets[0]) }
    expect(() => parseDashboardDefinition(thirteen)).toThrow()
  })
})

describe('toQueryRequests', () => {
  it('emits one request per widget, preserving order', () => {
    expect(toQueryRequests(BUILTIN_DASHBOARD).map((r) => r.datasetId)).toEqual(
      BUILTIN_DASHBOARD.widgets.map((w) => w.datasetId),
    )
  })

  it('omits params entirely when a widget declares none', () => {
    const [first] = toQueryRequests(parseDashboardDefinition(valid))
    expect(first).toEqual({ datasetId: 'moves-by-status' })
    expect('params' in first!).toBe(false)
  })
})

describe('the built-in dashboard', () => {
  it('is a valid definition (parsed at module load)', () => {
    expect(() => DashboardDefinitionSchema.parse(BUILTIN_DASHBOARD)).not.toThrow()
  })

  it('stays within the API batch limit', () => {
    expect(BUILTIN_DASHBOARD.widgets.length).toBeLessThanOrEqual(12)
  })
})

describe('phase-2 substitution guard', () => {
  it('parses identically from a JSON string as from the code constant', () => {
    // Phase 2 loads a definition from a Postgres JSON column instead of a
    // module constant. Serializing the built-in and re-parsing it simulates
    // exactly that round trip: if this passes, swapping the loader is the only
    // change phase 2 needs on the render path.
    const fromDb: unknown = JSON.parse(JSON.stringify(BUILTIN_DASHBOARD))
    expect(parseDashboardDefinition(fromDb)).toEqual(BUILTIN_DASHBOARD)
    expect(toQueryRequests(parseDashboardDefinition(fromDb))).toEqual(
      toQueryRequests(BUILTIN_DASHBOARD),
    )
  })
})
