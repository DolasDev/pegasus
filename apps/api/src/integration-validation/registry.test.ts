import { describe, it, expect, afterEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  getIntegrationDefinition,
  refreshRegistryOverlay,
  loadRegistryOverlayIfStale,
} from './registry'
import { compileMapping } from './transform/mapping-format'

/** A minimal fake Prisma client whose integrationConfig.findMany returns `rows`. */
function fakeDb(rows: unknown[]): PrismaClient {
  return { integrationConfig: { findMany: async () => rows } } as unknown as PrismaClient
}

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
