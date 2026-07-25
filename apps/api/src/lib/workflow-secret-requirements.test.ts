import { describe, it, expect } from 'vitest'
import {
  extractRequirements,
  resolveAgainst,
  countMissing,
  presenceKey,
  type PresenceSets,
} from './workflow-secret-requirements'

// Build presence sets via the same presenceKey the resolver uses so the tests
// never depend on its internal key spelling.
const sets = (secrets: [string, string][], configs: [string, string][]): PresenceSets => ({
  secrets: new Set(secrets.map(([g, k]) => presenceKey(g, k))),
  configs: new Set(configs.map(([g, k]) => presenceKey(g, k))),
})

describe('extractRequirements', () => {
  it('pulls requiredSecrets/requiredConfigs and defaults a blank group to "global"', () => {
    const { secrets, configs } = extractRequirements({
      requiredSecrets: [
        { key: 'STRIPE_API_KEY', group: 'billing', description: 'x' },
        { key: 'B' },
      ],
      requiredConfigs: [{ key: 'DEFAULT_REGION' }],
    })
    expect(secrets).toEqual([
      { key: 'STRIPE_API_KEY', group: 'billing', description: 'x' },
      { key: 'B', group: 'global', description: null },
    ])
    expect(configs).toEqual([{ key: 'DEFAULT_REGION', group: 'global', description: null }])
  })

  it('is defensive against non-array / malformed entries', () => {
    expect(extractRequirements(null)).toEqual({ secrets: [], configs: [] })
    expect(extractRequirements({ requiredSecrets: 'nope' })).toEqual({ secrets: [], configs: [] })
    expect(
      extractRequirements({ requiredSecrets: [42, {}, { key: '' }, { key: 'OK' }] }).secrets,
    ).toEqual([{ key: 'OK', group: 'global', description: null }])
  })
})

describe('resolveAgainst', () => {
  it('tags each requirement present/missing by (group, key), per kind', () => {
    const manifest = {
      requiredSecrets: [{ key: 'STRIPE_API_KEY', group: 'billing' }, { key: 'MISSING_ONE' }],
      requiredConfigs: [{ key: 'DEFAULT_REGION' }],
    }
    const resolved = resolveAgainst(
      manifest,
      sets([['billing', 'STRIPE_API_KEY']], [['global', 'DEFAULT_REGION']]),
    )
    expect(resolved).toEqual([
      { kind: 'SECRET', key: 'STRIPE_API_KEY', group: 'billing', description: null, present: true },
      { kind: 'SECRET', key: 'MISSING_ONE', group: 'global', description: null, present: false },
      { kind: 'CONFIG', key: 'DEFAULT_REGION', group: 'global', description: null, present: true },
    ])
  })

  it('does not cross kinds — a CONFIG key present does not satisfy a SECRET of the same name', () => {
    const resolved = resolveAgainst(
      { requiredSecrets: [{ key: 'SHARED' }] },
      sets([], [['global', 'SHARED']]),
    )
    expect(resolved).toEqual([
      { kind: 'SECRET', key: 'SHARED', group: 'global', description: null, present: false },
    ])
  })

  it('returns [] when nothing is declared', () => {
    expect(resolveAgainst({}, sets([], []))).toEqual([])
  })
})

describe('countMissing', () => {
  it('counts requirements that are not present', () => {
    const resolved = resolveAgainst(
      { requiredSecrets: [{ key: 'A' }, { key: 'B' }], requiredConfigs: [{ key: 'C' }] },
      sets([['global', 'A']], [['global', 'C']]),
    )
    expect(countMissing(resolved)).toBe(1)
  })
})
