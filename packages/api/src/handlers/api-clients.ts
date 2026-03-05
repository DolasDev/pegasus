// ---------------------------------------------------------------------------
// API client management handler — /api/v1/api-clients
//
// Lets tenant administrators create, list, update, revoke, and rotate vendor
// API keys for M2M (machine-to-machine) integrations. All endpoints require
// the tenant_admin role. The plaintext key is returned only on create/rotate
// and must never be logged or stored.
//
// Endpoints:
//   POST   /                    — create new API client; returns plainKey once
//   GET    /                    — list all clients (no keyHash, no plainKey)
//   GET    /:id                 — get single client
//   PATCH  /:id                 — update name or scopes
//   POST   /:id/revoke          — soft-revoke (sets revokedAt)
//   POST   /:id/rotate          — issue new key; returns plainKey once
//
// Security invariants:
//   - keyHash is NEVER in any response (excluded at repository select level)
//   - plainKey is NEVER logged; only logged fields: id, keyPrefix
//   - requireRole(['tenant_admin']) enforced on all routes
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requireRole } from '../middleware/rbac'
import { createApiClientRepository } from '../repositories/api-client.repository'
import type { ApiClientRow } from '../repositories/api-client.repository'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateApiClientBody = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).min(1),
})

const PatchApiClientBody = z
  .object({
    name: z.string().min(1).optional(),
    scopes: z.array(z.string()).optional(),
  })
  .refine((v) => v.name !== undefined || v.scopes !== undefined, {
    message: 'At least one of name or scopes must be provided',
  })

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

type ApiClientResponse = Omit<
  ApiClientRow,
  'createdAt' | 'updatedAt' | 'lastUsedAt' | 'revokedAt'
> & {
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type ApiClientCreateResponse = ApiClientResponse & { plainKey: string }

function toResponse(row: ApiClientRow): ApiClientResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const apiClientsHandler = new Hono<AppEnv>()

// All endpoints require tenant_admin.
apiClientsHandler.use('*', requireRole(['tenant_admin']))

// ---------------------------------------------------------------------------
// POST /
//
// Creates a new API client. Returns the plainKey once — it will not be shown
// again. The caller must store it securely.
//
// Request:  { name: string, scopes: string[] }
// Response: { data: ApiClientResponse & { plainKey } } (201)
// ---------------------------------------------------------------------------
apiClientsHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = CreateApiClientBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId') ?? ''
    const { name, scopes } = c.req.valid('json')
    const repo = createApiClientRepository(c.get('db'))

    try {
      const { row, plainKey } = await repo.create(tenantId, name, scopes, userId)
      logger.info('API client created', { id: row.id, keyPrefix: row.keyPrefix, tenantId })
      const response: ApiClientCreateResponse = { ...toResponse(row), plainKey }
      return c.json({ data: response }, 201)
    } catch (err) {
      logger.error('POST /api-clients: failed to create', { error: String(err) })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// GET /
//
// Lists all API clients for the current tenant. No keyHash, no plainKey.
//
// Response: { data: ApiClientResponse[], meta: { count } }
// ---------------------------------------------------------------------------
apiClientsHandler.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const repo = createApiClientRepository(c.get('db'))

  try {
    const rows = await repo.listByTenant(tenantId)
    return c.json({ data: rows.map(toResponse), meta: { count: rows.length } })
  } catch (err) {
    logger.error('GET /api-clients: failed to list', { error: String(err) })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /:id
//
// Returns a single API client by id (tenant-scoped). 404 if not found or
// wrong tenant.
//
// Response: { data: ApiClientResponse } (200) | 404
// ---------------------------------------------------------------------------
apiClientsHandler.get('/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const repo = createApiClientRepository(c.get('db'))

  try {
    const row = await repo.findById(id, tenantId)
    if (!row) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toResponse(row) })
  } catch (err) {
    logger.error('GET /api-clients/:id: failed', { error: String(err), id })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// PATCH /:id
//
// Updates name and/or scopes. At least one field must be provided.
//
// Request:  { name?: string, scopes?: string[] }
// Response: { data: ApiClientResponse } (200) | 400 | 404
// ---------------------------------------------------------------------------
apiClientsHandler.patch(
  '/:id',
  validator('json', (value, c) => {
    const r = PatchApiClientBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const id = c.req.param('id')
    const patch = c.req.valid('json')
    const repo = createApiClientRepository(c.get('db'))

    const existing = await repo.findById(id, tenantId)
    if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

    // Build patch with only defined fields to satisfy exactOptionalPropertyTypes.
    const cleanPatch: { name?: string; scopes?: string[] } = {}
    if (patch.name !== undefined) cleanPatch.name = patch.name
    if (patch.scopes !== undefined) cleanPatch.scopes = patch.scopes

    try {
      const updated = await repo.update(id, tenantId, cleanPatch)
      return c.json({ data: toResponse(updated) })
    } catch (err) {
      logger.error('PATCH /api-clients/:id: failed', { error: String(err), id })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /:id/revoke
//
// Soft-revokes the API client by setting revokedAt. Revoked clients return
// 403 on subsequent auth attempts.
//
// Response: { data: ApiClientResponse } (200) | 404 | 409 (already revoked)
// ---------------------------------------------------------------------------
apiClientsHandler.post('/:id/revoke', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const repo = createApiClientRepository(c.get('db'))

  const existing = await repo.findById(id, tenantId)
  if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

  if (existing.revokedAt !== null) {
    return c.json({ error: 'API client is already revoked', code: 'CONFLICT' }, 409)
  }

  try {
    const revoked = await repo.revoke(id, tenantId)
    logger.info('API client revoked', { id, tenantId })
    return c.json({ data: toResponse(revoked) })
  } catch (err) {
    logger.error('POST /api-clients/:id/revoke: failed', { error: String(err), id })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /:id/rotate
//
// Issues a new key on the same row (new keyHash/keyPrefix, revokedAt cleared).
// The new plainKey is returned once — it will not be shown again.
//
// Response: { data: ApiClientResponse & { plainKey } } (200) | 404
// ---------------------------------------------------------------------------
apiClientsHandler.post('/:id/rotate', async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id')
  const repo = createApiClientRepository(c.get('db'))

  const existing = await repo.findById(id, tenantId)
  if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

  try {
    const { row, plainKey } = await repo.rotate(id, tenantId)
    logger.info('API client rotated', { id: row.id, keyPrefix: row.keyPrefix, tenantId })
    const response: ApiClientCreateResponse = { ...toResponse(row), plainKey }
    return c.json({ data: response })
  } catch (err) {
    logger.error('POST /api-clients/:id/rotate: failed', { error: String(err), id })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
