// ---------------------------------------------------------------------------
// Unit tests for apps/api/src/lib/app-settings.ts
//
// Covers the parse-with-defaults guarantee (any tenant row, even {}, hydrates
// to a fully-typed AppSettings), the deep-merge semantics of mergeAppSettings,
// and the zod validation that rejects bad longhaulClient values.
//
// The repo functions getAppSettings / updateAppSettings are exercised via the
// handler test (settings.test.ts) where the Prisma client is mocked. Here we
// just verify the pure schema + merger behavior.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  AppSettingsSchema,
  AppSettingsPatchSchema,
  mergeAppSettings,
  type AppSettings,
} from './app-settings'

describe('AppSettingsSchema', () => {
  it('hydrates an empty object to a fully-typed AppSettings (every section present)', () => {
    const parsed = AppSettingsSchema.parse({})
    // Each section is present and defaults to {}; spot-check a couple.
    expect(parsed.dashboard).toEqual({})
    expect(parsed.operations).toEqual({})
    // The full set of sections matches the main-menu list.
    expect(Object.keys(parsed).sort()).toEqual([
      'billing',
      'customers',
      'dashboard',
      'dispatch',
      'moves',
      'operations',
      'quotes',
    ])
  })

  it('accepts a valid operations.longhaulClient', () => {
    const parsed = AppSettingsSchema.parse({ operations: { longhaulClient: 'qmm' } })
    expect(parsed.operations.longhaulClient).toBe('qmm')
  })

  it('accepts null for operations.longhaulClient (explicit "unconfigured")', () => {
    const parsed = AppSettingsSchema.parse({ operations: { longhaulClient: null } })
    expect(parsed.operations.longhaulClient).toBeNull()
  })

  it('rejects an unknown operations.longhaulClient value', () => {
    const r = AppSettingsSchema.safeParse({ operations: { longhaulClient: 'acme' } })
    expect(r.success).toBe(false)
  })

  it('strips unknown keys at the root and inside a section', () => {
    const parsed = AppSettingsSchema.parse({
      operations: { longhaulClient: 'nwi', somethingNew: 'ignored' },
      futureSection: { foo: 'bar' },
    })
    expect(parsed.operations).toEqual({ longhaulClient: 'nwi' })
    expect((parsed as unknown as Record<string, unknown>).futureSection).toBeUndefined()
  })
})

describe('AppSettingsPatchSchema', () => {
  it('accepts a sparse patch touching only one section', () => {
    const r = AppSettingsPatchSchema.safeParse({ operations: { longhaulClient: 'nwi' } })
    expect(r.success).toBe(true)
  })

  it('rejects an unknown section at the root (strict)', () => {
    const r = AppSettingsPatchSchema.safeParse({ futureSection: {} })
    expect(r.success).toBe(false)
  })

  it('rejects a bad value even inside an otherwise valid patch', () => {
    const r = AppSettingsPatchSchema.safeParse({ operations: { longhaulClient: 'bogus' } })
    expect(r.success).toBe(false)
  })
})

describe('mergeAppSettings', () => {
  function freshDefaults(): AppSettings {
    return AppSettingsSchema.parse({})
  }

  it('overlays a section without touching siblings', () => {
    const current = freshDefaults()
    const next = mergeAppSettings(current, { operations: { longhaulClient: 'qmm' } })
    expect(next.operations.longhaulClient).toBe('qmm')
    // Untouched sections survive intact.
    expect(next.dashboard).toEqual({})
    expect(next.billing).toEqual({})
  })

  it('flipping the value preserves merge identity (old → new)', () => {
    const current = AppSettingsSchema.parse({ operations: { longhaulClient: 'nwi' } })
    const next = mergeAppSettings(current, { operations: { longhaulClient: 'qmm' } })
    expect(next.operations.longhaulClient).toBe('qmm')
  })

  it('explicit null clears the value (admin "unconfigure" action)', () => {
    const current = AppSettingsSchema.parse({ operations: { longhaulClient: 'nwi' } })
    const next = mergeAppSettings(current, { operations: { longhaulClient: null } })
    expect(next.operations.longhaulClient).toBeNull()
  })

  it('an empty patch is a no-op', () => {
    const current = AppSettingsSchema.parse({ operations: { longhaulClient: 'nwi' } })
    const next = mergeAppSettings(current, {})
    expect(next).toEqual(current)
  })
})
