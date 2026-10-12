// ---------------------------------------------------------------------------
// /api/v1/availability-filters — saved filters for Operations → Availability.
//
// The Availability counterpart of Planning's saved shipment filters (same
// Save / Load / Use-as-Default / Delete, My vs Public UX), stored in Postgres
// rather than the legacy `longhaul_shipment_filter` table — that table has no
// screen discriminator, so sharing it would leak these rows into Planning.
//
// No requirePermission gate, matching the page's own data route
// (/onprem/longhaul/driver-planning): any signed-in tenant user who can open
// Availability can save their own filters. Ownership is enforced here instead:
// the owner is always c.get('userId'), never the body, and only the owner can
// delete. Unlike Planning's DELETE, a non-owner cannot delete someone's filter.
//
// The user's default is TenantUser.preferences.operations.defaultAvailabilityFilterId.
// A default that no longer resolves to a visible filter reads as null.
//
// Endpoints:
//   GET    /?scope=mine|public — mine: everything I own; public: all public filters
//   GET    /default            — my default filter, or null
//   POST   /                   — save { name, query, isPublic?, isDefault? } (201)
//   PUT    /default            — set/clear my default { filterId: uuid | null }
//   DELETE /:id                — delete a filter I own (404 otherwise)
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { AvailabilityFilterQuery } from '../lib/availability-filter-query'
import { getUserPreferences, updateUserPreferences } from '../lib/user-preferences'
import {
  createFilter,
  deleteOwnedFilter,
  findVisibleFilter,
  listOwnedFilters,
  listPublicFilters,
  type AvailabilityFilterRow,
} from '../repositories/availability-filter.repository'

const SaveBody = z.object({
  name: z.string().trim().min(1).max(100),
  query: AvailabilityFilterQuery,
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const SetDefaultBody = z.object({ filterId: z.uuid().nullable() })

export const availabilityFiltersHandler = new Hono<AppEnv>()

function toDto(row: AvailabilityFilterRow, defaultId: string | null | undefined) {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    isPublic: row.isPublic,
    isDefault: row.id === defaultId,
    owner: { id: row.owner.id, email: row.owner.email },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function noUser(c: Context<AppEnv>) {
  return c.json({ error: 'This principal has no user profile', code: 'NO_USER_PROFILE' }, 403)
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  return c.req.json().catch(() => null)
}

async function defaultIdFor(c: Context<AppEnv>, userId: string) {
  const prefs = await getUserPreferences(c.get('db'), userId)
  return prefs.operations?.defaultAvailabilityFilterId ?? null
}

availabilityFiltersHandler.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const db = c.get('db')
  const scope = c.req.query('scope') === 'public' ? 'public' : 'mine'

  const [rows, defaultId] = await Promise.all([
    scope === 'public' ? listPublicFilters(db) : listOwnedFilters(db, userId),
    defaultIdFor(c, userId),
  ])
  return c.json({ data: rows.map((r) => toDto(r, defaultId)) })
})

availabilityFiltersHandler.get('/default', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const defaultId = await defaultIdFor(c, userId)
  if (!defaultId) return c.json({ data: null })
  const row = await findVisibleFilter(c.get('db'), defaultId, userId)
  return c.json({ data: row ? toDto(row, defaultId) : null })
})

availabilityFiltersHandler.post('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const parsed = SaveBody.safeParse(await readJson(c))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR' }, 400)
  }
  const db = c.get('db')

  const row = await createFilter(db, c.get('tenantId'), {
    ownerId: userId,
    name: parsed.data.name,
    query: parsed.data.query,
    isPublic: parsed.data.isPublic ?? false,
  })
  if (parsed.data.isDefault) {
    await updateUserPreferences(db, userId, {
      operations: { defaultAvailabilityFilterId: row.id },
    })
  }
  const defaultId = parsed.data.isDefault ? row.id : await defaultIdFor(c, userId)
  return c.json({ data: toDto(row, defaultId) }, 201)
})

availabilityFiltersHandler.put('/default', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const parsed = SetDefaultBody.safeParse(await readJson(c))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR' }, 400)
  }
  const db = c.get('db')
  const { filterId } = parsed.data

  if (filterId && !(await findVisibleFilter(db, filterId, userId))) {
    return c.json({ error: 'Filter not found', code: 'NOT_FOUND' }, 404)
  }
  await updateUserPreferences(db, userId, {
    operations: { defaultAvailabilityFilterId: filterId },
  })
  return c.json({ data: { filterId } })
})

availabilityFiltersHandler.delete('/:id', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) {
    return c.json({ error: 'Filter not found', code: 'NOT_FOUND' }, 404)
  }
  const db = c.get('db')

  if (!(await deleteOwnedFilter(db, id, userId))) {
    return c.json({ error: 'Filter not found', code: 'NOT_FOUND' }, 404)
  }
  // Clear MY default if it pointed here. Other users' defaults that pointed at
  // this (public) filter dangle and read as null — no cross-user writes.
  if ((await defaultIdFor(c, userId)) === id) {
    await updateUserPreferences(db, userId, {
      operations: { defaultAvailabilityFilterId: null },
    })
  }
  return c.body(null, 204)
})
