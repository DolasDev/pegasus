// ---------------------------------------------------------------------------
// /api/v1/services-filters — saved filters for Operations → Services.
//
// The Services counterpart of /availability-filters, with the same endpoints,
// the same ownership rules and its own table, so neither screen's rows appear
// in the other's dialog. See handlers/availability-filters.ts for the reasoning
// behind the shape.
//
// No requirePermission gate, matching /availability-filters. The board's own
// data route is role-gated in tenant-web (OPERATIONS_ROLES), and a user who
// can't open the board has nothing to apply a saved filter to. Ownership is
// enforced here: the owner is always c.get('userId'), never the body, and only
// the owner can delete.
//
// The user's default is TenantUser.preferences.operations.defaultServicesFilterId.
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
import { ServicesFilterQuery } from '../lib/services-filter-query'
import { getUserPreferences, updateUserPreferences } from '../lib/user-preferences'
import {
  createFilter,
  deleteOwnedFilter,
  findVisibleFilter,
  listOwnedFilters,
  listPublicFilters,
  type ServicesFilterRow,
} from '../repositories/services-filter.repository'

const SaveBody = z.object({
  name: z.string().trim().min(1).max(100),
  query: ServicesFilterQuery,
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

const SetDefaultBody = z.object({ filterId: z.uuid().nullable() })

export const servicesFiltersHandler = new Hono<AppEnv>()

function toDto(row: ServicesFilterRow, defaultId: string | null | undefined) {
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
  return prefs.operations?.defaultServicesFilterId ?? null
}

servicesFiltersHandler.get('/', async (c) => {
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

servicesFiltersHandler.get('/default', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const defaultId = await defaultIdFor(c, userId)
  if (!defaultId) return c.json({ data: null })
  const row = await findVisibleFilter(c.get('db'), defaultId, userId)
  return c.json({ data: row ? toDto(row, defaultId) : null })
})

servicesFiltersHandler.post('/', async (c) => {
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
      operations: { defaultServicesFilterId: row.id },
    })
  }
  const defaultId = parsed.data.isDefault ? row.id : await defaultIdFor(c, userId)
  return c.json({ data: toDto(row, defaultId) }, 201)
})

servicesFiltersHandler.put('/default', async (c) => {
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
    operations: { defaultServicesFilterId: filterId },
  })
  return c.json({ data: { filterId } })
})

servicesFiltersHandler.delete('/:id', async (c) => {
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
  // Clear MY default if it pointed here; other users' defaults dangle and read as null.
  if ((await defaultIdFor(c, userId)) === id) {
    await updateUserPreferences(db, userId, {
      operations: { defaultServicesFilterId: null },
    })
  }
  return c.body(null, 204)
})
