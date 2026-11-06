import { describe, it, expect, afterEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  getIntegrationDefinition,
  getBuiltInDefinition,
  refreshRegistryOverlay,
  loadRegistryOverlayIfStale,
  resolveIntegrationDefinition,
  coerceRequirements,
} from './registry'
import { compileMapping } from './transform/mapping-format'

/** A minimal fake Prisma client whose integrationConfig.findMany returns `rows`. */
function fakeDb(rows: unknown[]): PrismaClient {
  return { integrationConfig: { findMany: async () => rows } } as unknown as PrismaClient
}

/**
 * A fake Prisma client for the resolver's `findActiveForScope`, which issues two
 * findFirst calls: the tenant's own PUBLISHED row, then the GLOBAL PUBLISHED row.
 * Returns `own` when the where-clause carries a tenantId, else `global`.
 */
function scopedDb(own: unknown, global: unknown): PrismaClient {
  return {
    integrationConfig: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        'tenantId' in where ? own : global,
    },
  } as unknown as PrismaClient
}

const throwingDb = {
  integrationConfig: {
    findFirst: async () => {
      throw new Error('db down')
    },
  },
} as unknown as PrismaClient

const emptyDb = fakeDb([])

afterEach(async () => {
  // The overlay is module-level state — reset to empty so tests don't leak.
  await refreshRegistryOverlay(emptyDb)
  vi.useRealTimers()
})

describe('registry overlay', () => {
  it('returns the built-in definition when no overlay row applies', async () => {
    await refreshRegistryOverlay(emptyDb)
    const def = getIntegrationDefinition('demo_partner')!
    expect(def.mapping['serviceStatus']).toBe('Survey.SerivceStatus')
  })

  it('overrides mapping + rules from a GLOBAL config row, preserving code ground truth', async () => {
    const override = { serviceOrderNumber: 'CustomSource' }
    await refreshRegistryOverlay(
      fakeDb([
        {
          integrationId: 'demo_partner',
          version: 5,
          visibility: 'GLOBAL',
          status: 'PUBLISHED',
          mapping: override,
          rules: [],
        },
      ]),
    )
    const def = getIntegrationDefinition('demo_partner')!
    expect(def.mapping).toEqual(override)
    expect(def.rules).toEqual([])
    expect(def.transform).toEqual(compileMapping(override))
    // structuralContract / deriveFacts / factCatalog come from code, not the overlay.
    expect(typeof def.deriveFacts).toBe('function')
  })

  it('ignores an overlay row whose mapping does not parse (falls back to built-in)', async () => {
    await refreshRegistryOverlay(
      fakeDb([
        { integrationId: 'demo_partner', version: 1, mapping: { bad: { $from: '' } }, rules: [] },
      ]),
    )
    const def = getIntegrationDefinition('demo_partner')!
    expect(def.mapping['serviceStatus']).toBe('Survey.SerivceStatus')
  })

  it('ignores an overlay row for an unknown integration', async () => {
    await refreshRegistryOverlay(
      fakeDb([{ integrationId: 'ghost', version: 1, mapping: { x: 'y' }, rules: [] }]),
    )
    expect(getIntegrationDefinition('ghost')).toBeUndefined()
  })

  it('resolveIntegrationDefinition returns undefined for an unknown integration', async () => {
    expect(await resolveIntegrationDefinition(scopedDb(null, null), 'ghost', 't1')).toBeUndefined()
  })

  it('resolveIntegrationDefinition prefers a TENANT config over GLOBAL and built-in', async () => {
    const tenantOverride = { serviceOrderNumber: 'TenantSource' }
    const globalOverride = { serviceOrderNumber: 'GlobalSource' }
    const def = (await resolveIntegrationDefinition(
      scopedDb(
        { integrationId: 'demo_partner', version: 3, mapping: tenantOverride, rules: [] },
        { integrationId: 'demo_partner', version: 9, mapping: globalOverride, rules: [] },
      ),
      'demo_partner',
      't1',
    ))!
    expect(def.mapping).toEqual(tenantOverride)
    expect(def.transform).toEqual(compileMapping(tenantOverride))
    // Code ground truth is never overridden by a config row.
    expect(typeof def.deriveFacts).toBe('function')
  })

  it('resolveIntegrationDefinition falls back to GLOBAL when the tenant has no own config', async () => {
    const globalOverride = { serviceOrderNumber: 'GlobalSource' }
    const def = (await resolveIntegrationDefinition(
      scopedDb(null, {
        integrationId: 'demo_partner',
        version: 9,
        mapping: globalOverride,
        rules: [],
      }),
      'demo_partner',
      't1',
    ))!
    expect(def.mapping).toEqual(globalOverride)
  })

  it('gives a config-only partner on shipment_status_update the floor order binding (0045)', async () => {
    // The `weichert` shape: no built-in overlay, only a TENANT row naming the
    // floor. The correlation binding must come with the floor, or
    // put_projection(..., local_entity_*) answers `unsupported`.
    const def = (await resolveIntegrationDefinition(
      scopedDb(
        {
          integrationId: 'acme_movers',
          floor: 'shipment_status_update',
          version: 1,
          mapping: { serviceOrderNumber: 'Id' },
          rules: [],
        },
        null,
      ),
      'acme_movers',
      't1',
    ))!
    expect(def.correlation).toEqual({ localEntityType: 'order' })
    expect(def.projection?.entityType).toBe('order')
  })

  it('resolveIntegrationDefinition falls back to the built-in when no config applies', async () => {
    const def = (await resolveIntegrationDefinition(scopedDb(null, null), 'demo_partner', 't1'))!
    expect(def.mapping['serviceStatus']).toBe('Survey.SerivceStatus')
  })

  it('resolveIntegrationDefinition ignores an unparseable tenant row (built-in floor)', async () => {
    const def = (await resolveIntegrationDefinition(
      scopedDb(
        { integrationId: 'demo_partner', version: 3, mapping: { bad: { $from: '' } }, rules: [] },
        null,
      ),
      'demo_partner',
      't1',
    ))!
    expect(def.mapping['serviceStatus']).toBe('Survey.SerivceStatus')
  })

  it('resolveIntegrationDefinition fails open to the built-in on a DB error', async () => {
    const def = (await resolveIntegrationDefinition(throwingDb, 'demo_partner', 't1'))!
    expect(def.mapping['serviceStatus']).toBe('Survey.SerivceStatus')
  })

  it('resolveIntegrationDefinition uses the GLOBAL overlay for a platform-scoped (null tenant) key', async () => {
    const override = { serviceOrderNumber: 'GlobalOnly' }
    await refreshRegistryOverlay(
      fakeDb([{ integrationId: 'demo_partner', version: 2, mapping: override, rules: [] }]),
    )
    const def = (await resolveIntegrationDefinition(emptyDb, 'demo_partner', null))!
    expect(def.mapping).toEqual(override)
  })

  it('getBuiltInDefinition ignores the overlay entirely', async () => {
    await refreshRegistryOverlay(
      fakeDb([
        {
          integrationId: 'demo_partner',
          version: 2,
          mapping: { serviceOrderNumber: 'X' },
          rules: [],
        },
      ]),
    )
    expect(getBuiltInDefinition('demo_partner')!.mapping['serviceStatus']).toBe(
      'Survey.SerivceStatus',
    )
    expect(getBuiltInDefinition('ghost')).toBeUndefined()
  })

  it('loadRegistryOverlayIfStale reloads only after the TTL elapses', async () => {
    let calls = 0
    const db = {
      integrationConfig: {
        findMany: async () => {
          calls++
          return []
        },
      },
    } as unknown as PrismaClient

    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    await refreshRegistryOverlay(db) // calls = 1, loadedAt = 10_000
    await loadRegistryOverlayIfStale(db, 1000) // within TTL → no reload
    expect(calls).toBe(1)
    vi.setSystemTime(12_000)
    await loadRegistryOverlayIfStale(db, 1000) // TTL elapsed → reload
    expect(calls).toBe(2)
  })
})

describe('coerceRequirements', () => {
  it('keeps valid entries, defaults away blanks, and drops malformed ones', () => {
    expect(
      coerceRequirements([
        { key: 'SEND_API_KEY', group: 'sirva', description: 'key' },
        { key: 'A' }, // no group → left undefined (resolves to "global")
        { key: 'B', group: '' }, // blank group dropped
        42, // not an object
        null, // not an object
        {}, // no key
        { key: '' }, // empty key
        { key: 'C', description: 7 }, // non-string description dropped
      ]),
    ).toEqual([
      { key: 'SEND_API_KEY', group: 'sirva', description: 'key' },
      { key: 'A' },
      { key: 'B' },
      { key: 'C' },
    ])
  })

  it('returns undefined for a non-array or an all-invalid list', () => {
    expect(coerceRequirements(null)).toBeUndefined()
    expect(coerceRequirements('nope')).toBeUndefined()
    expect(coerceRequirements([42, {}, { key: '' }])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Floor-only configs (no built-in overlay) — the Atlas settlements shape.
//
// This is load-bearing for the declarative-fetch runtime: the handler reads the
// `fetch` block off the scoped config ROW, but takes `capabilities` off the
// resolved DEFINITION for its runtime name check. `atlas_settlement` has no code
// overlay, so if the resolver could not compose a floor-only row, the pilot
// would 404 at runtime for a reason that only surfaces on first real use.
// ---------------------------------------------------------------------------

/** A published row for a brand-new partner id that targets a floor directly. */
const floorOnlyRow = {
  id: 'cfg-atlas-1',
  tenantId: 'tenant-1',
  integrationId: 'atlas_settlement',
  version: 1,
  visibility: 'TENANT' as const,
  status: 'PUBLISHED' as const,
  mapping: { Id: 'orderNumber' },
  rules: [],
  corpus: [],
  gateReport: {},
  publishedBy: 'user-1',
  forkedFromConfigId: null,
  forkedFromVersion: null,
  floor: 'financial_settlement',
  displayName: 'Atlas Settlements',
  externalShape: null,
  externalMapping: null,
  inbound: null,
  fetch: {
    settlements: {
      method: 'GET',
      path: '/settlement/v1/settlement',
      query: { settlementDate: '{{settlementDate}}' },
      decode: 'jsonString',
    },
  },
  requiredSecrets: null,
  requiredConfigs: null,
  createdAt: new Date(),
}

describe('resolveIntegrationDefinition — a floor-only config (no built-in overlay)', () => {
  it('composes from the row’s `floor` alone', async () => {
    const def = await resolveIntegrationDefinition(
      scopedDb(floorOnlyRow, null),
      'atlas_settlement',
      'tenant-1',
    )
    expect(def).toBeDefined()
    expect(def?.floor).toBe('financial_settlement')
    expect(def?.displayName).toBe('Atlas Settlements')
  })

  it('carries the floor’s `capabilities` through, which the fetch runtime needs', async () => {
    const def = await resolveIntegrationDefinition(
      scopedDb(floorOnlyRow, null),
      'atlas_settlement',
      'tenant-1',
    )
    expect(def?.capabilities).toEqual(['settlements'])
  })

  it('does NOT put `fetch` on the definition — it is read off the row, like `inbound`', async () => {
    // Pins the design decision. `IntegrationDefinition` deliberately has no
    // `fetch` field: the handler reads the block off the scoped config row the
    // same way the ingress endpoint reads `inbound`. A future change that
    // threads it through here should delete this test on purpose, not by
    // accident.
    const def = await resolveIntegrationDefinition(
      scopedDb(floorOnlyRow, null),
      'atlas_settlement',
      'tenant-1',
    )
    expect(def).toBeDefined()
    expect(def).not.toHaveProperty('fetch')
  })

  it('returns undefined for a row naming an unknown floor with no built-in to fall back to', async () => {
    const def = await resolveIntegrationDefinition(
      scopedDb({ ...floorOnlyRow, floor: 'no_such_floor' }, null),
      'atlas_settlement',
      'tenant-1',
    )
    expect(def).toBeUndefined()
  })
})
