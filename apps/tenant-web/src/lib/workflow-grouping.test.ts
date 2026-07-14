// ---------------------------------------------------------------------------
// Unit tests for workflow version grouping — collapsing the flat (name, version)
// list into one newest-first group per workflow name.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  compareSemver,
  compareWorkflowVersionsDesc,
  groupWorkflowsByName,
  type VersionedWorkflow,
} from './workflow-grouping'

function wf(name: string, version: string, createdAt: string): VersionedWorkflow {
  return { name, version, createdAt }
}

describe('compareSemver', () => {
  it('orders by numeric core fields', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0) // numeric, not lexical
    expect(compareSemver('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a release above any prerelease of the same core', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })

  it('orders prereleases per semver §11', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
    // numeric identifiers rank below alphanumeric ones
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    // a longer prerelease outranks its own prefix
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
  })
})

describe('compareWorkflowVersionsDesc', () => {
  it('sorts newest semver first', () => {
    const rows = [
      wf('a', '1.0.0', '2026-01-01T00:00:00Z'),
      wf('a', '2.1.0', '2026-03-01T00:00:00Z'),
      wf('a', '1.4.0', '2026-02-01T00:00:00Z'),
    ]
    const sorted = [...rows].sort(compareWorkflowVersionsDesc)
    expect(sorted.map((r) => r.version)).toEqual(['2.1.0', '1.4.0', '1.0.0'])
  })

  it('breaks equal-version ties by newest upload', () => {
    const older = wf('a', '1.0.0', '2026-01-01T00:00:00Z')
    const newer = wf('a', '1.0.0', '2026-02-01T00:00:00Z')
    expect(compareWorkflowVersionsDesc(older, newer)).toBeGreaterThan(0)
  })
})

describe('groupWorkflowsByName', () => {
  it('collapses versions into one group per name with latest as headline', () => {
    const rows = [
      wf('invoice-sync', '1.0.0', '2026-01-08T00:00:00Z'),
      wf('invoice-sync', '2.1.0', '2026-07-10T00:00:00Z'),
      wf('invoice-sync', '2.0.0', '2026-06-02T00:00:00Z'),
      wf('lead-router', '0.3.0', '2026-05-01T00:00:00Z'),
    ]
    const groups = groupWorkflowsByName(rows)
    expect(groups).toHaveLength(2)

    const invoice = groups.find((g) => g.name === 'invoice-sync')!
    expect(invoice.latest.version).toBe('2.1.0')
    expect(invoice.older.map((w) => w.version)).toEqual(['2.0.0', '1.0.0'])
    expect(invoice.versions).toHaveLength(3)
  })

  it('orders groups by most-recently-uploaded latest version', () => {
    const rows = [
      wf('old-flow', '3.0.0', '2026-02-01T00:00:00Z'),
      wf('fresh-flow', '1.0.0', '2026-07-01T00:00:00Z'),
    ]
    const groups = groupWorkflowsByName(rows)
    expect(groups.map((g) => g.name)).toEqual(['fresh-flow', 'old-flow'])
  })

  it('leaves single-version workflows with no older versions', () => {
    const groups = groupWorkflowsByName([wf('solo', '1.0.0', '2026-01-01T00:00:00Z')])
    expect(groups[0].older).toEqual([])
  })

  it('returns an empty array for no workflows', () => {
    expect(groupWorkflowsByName([])).toEqual([])
  })
})
