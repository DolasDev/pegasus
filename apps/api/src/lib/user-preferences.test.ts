// ---------------------------------------------------------------------------
// Per-user preferences — hydration and merge semantics.
//
// The behaviours worth pinning are the ones that protect a user's stored tree:
// a null column hydrates to a full object, and a partial patch never wipes a
// section the client did not send.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { getUserPreferences, updateUserPreferences } from './user-preferences'

const findUnique = vi.fn()
const update = vi.fn()
const db = { tenantUser: { findUnique, update } } as unknown as PrismaClient

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({})
})

describe('getUserPreferences', () => {
  it('hydrates a null column to a fully-typed object', async () => {
    // A user row predating the column must not blow up any caller.
    findUnique.mockResolvedValue({ preferences: null })
    expect(await getUserPreferences(db, 'u1')).toEqual({ reporting: {} })
  })

  it('hydrates a missing user to defaults rather than throwing', async () => {
    findUnique.mockResolvedValue(null)
    expect(await getUserPreferences(db, 'nope')).toEqual({ reporting: {} })
  })

  it('reads a stored default dashboard slug', async () => {
    findUnique.mockResolvedValue({ preferences: { reporting: { defaultDashboardSlug: 'ops' } } })
    const prefs = await getUserPreferences(db, 'u1')
    expect(prefs.reporting?.defaultDashboardSlug).toBe('ops')
  })

  it('drops unknown keys rather than failing the read', async () => {
    // Forward-compat: a newer client's field must not brick an older server.
    findUnique.mockResolvedValue({ preferences: { reporting: {}, somethingNew: { a: 1 } } })
    expect(await getUserPreferences(db, 'u1')).toEqual({ reporting: {} })
  })
})

describe('updateUserPreferences', () => {
  it('sets a default dashboard slug', async () => {
    findUnique.mockResolvedValue({ preferences: {} })
    const next = await updateUserPreferences(db, 'u1', {
      reporting: { defaultDashboardSlug: 'ops' },
    })
    expect(next.reporting?.defaultDashboardSlug).toBe('ops')
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { preferences: { reporting: { defaultDashboardSlug: 'ops' } } },
    })
  })

  it('clears the default with an explicit null', async () => {
    findUnique.mockResolvedValue({ preferences: { reporting: { defaultDashboardSlug: 'ops' } } })
    const next = await updateUserPreferences(db, 'u1', {
      reporting: { defaultDashboardSlug: null },
    })
    expect(next.reporting?.defaultDashboardSlug).toBeNull()
  })

  it('leaves untouched sections intact', async () => {
    // A client that knows nothing about a section added later must not wipe it
    // by round-tripping an older shape.
    findUnique.mockResolvedValue({ preferences: { reporting: { defaultDashboardSlug: 'ops' } } })
    const next = await updateUserPreferences(db, 'u1', {})
    expect(next.reporting?.defaultDashboardSlug).toBe('ops')
  })
})
