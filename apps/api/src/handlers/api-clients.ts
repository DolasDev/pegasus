// ---------------------------------------------------------------------------
// API client management handler — /api/v1/api-clients
//
// Lets tenant administrators create, list, update, revoke, and rotate vendor
// API keys for M2M (machine-to-machine) integrations. The plaintext key is
// returned only on create/rotate and must never be logged or stored.
//
// Each ApiClient is bound to a service-account TenantUser (cognitoSub=null,
// isServiceAccount=true) — that user's roleNames drive Cedar/AVP authorization
// when the key is used. Create and patch take roleNames directly; the handler
// transparently provisions/updates the service-account user.
//
// Endpoints:
//   POST   /                    — create new API client; returns plainKey once
//   GET    /                    — list all clients (no keyHash, no plainKey)
//   GET    /:id                 — get single client
//   PATCH  /:id                 — update name and/or roleNames
//   POST   /:id/revoke          — soft-revoke (sets revokedAt)
//   POST   /:id/rotate          — issue new key; returns plainKey once
//   DELETE /:id                 — hard-delete key + its service-account user
//
// Security invariants:
//   - keyHash is NEVER in any response (excluded at repository select level)
//   - plainKey is NEVER logged; only logged fields: id, keyPrefix
//   - permission gating via Actions.{Create,List,Rotate,Revoke,Delete}ApiClient
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { createApiClientRepository } from '../repositories/api-client.repository'
import type { ApiClientRow } from '../repositories/api-client.repository'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateApiClientBody = z.object({
  name: z.string().min(1),
  /**
   * Cedar role-group names assigned to the service-account TenantUser this
   * key acts as. At least one role is required so the key has some authority
   * (an empty array would deny every action).
   */
  roleNames: z.array(z.string().min(1)).min(1),
})

const PatchApiClientBody = z
  .object({
    name: z.string().min(1).optional(),
    roleNames: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((v) => v.name !== undefined || v.roleNames !== undefined, {
    message: 'At least one of name or roleNames must be provided',
  })

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

type ApiClientResponse = Omit<
  ApiClientRow,
  'createdAt' | 'updatedAt' | 'lastUsedAt' | 'revokedAt' | 'scopes'
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
    roleNames: row.roleNames,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdById: row.createdById,
    actsAsUserId: row.actsAsUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const apiClientsHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// POST /
//
// Creates a new API client. Atomically provisions a service-account TenantUser
// with the requested roleNames and binds the new key to it; the user has
// cognitoSub=null and is unable to sign in via Cognito. Returns the plainKey
// once — it will not be shown again.
//
// Request:  { name: string, roleNames: string[] }
// Response: { data: ApiClientResponse & { plainKey } } (201)
// ---------------------------------------------------------------------------
apiClientsHandler.post(
  '/',
  requirePermission(Actions.CreateApiClient),
  validator('json', (value, c) => {
    const r = CreateApiClientBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const createdById = c.get('userId') ?? ''
    const { name, roleNames } = c.req.valid('json')
    const db = c.get('db')

    // Pre-generate the service-account user id so we can use it in the
    // synthetic email (which has a per-tenant unique constraint) without an
    // extra round-trip after insert.
    const serviceAccountId = crypto.randomUUID()
    const now = new Date()

    const { row, plainKey } = await db.$transaction(async (tx) => {
      await tx.tenantUser.create({
        data: {
          id: serviceAccountId,
          tenantId,
          email: `svc-${serviceAccountId}@svc.invalid`,
          cognitoSub: null,
          isServiceAccount: true,
          status: 'ACTIVE',
          activatedAt: now,
          roleNames,
        },
      })
      const repo = createApiClientRepository(tx as PrismaClient)
      // Tenant-scoped clients no longer use the freeform `scopes` column —
      // pass [] and let the bound service-account user's roleNames drive
      // Cedar authorization.
      return repo.create(tenantId, name, [], createdById, serviceAccountId)
    })

    logger.info('API client created', {
      id: row.id,
      keyPrefix: row.keyPrefix,
      tenantId,
      serviceAccountId,
    })
    const response: ApiClientCreateResponse = { ...toResponse(row), plainKey }
    return c.json({ data: response }, 201)
  },
)

// ---------------------------------------------------------------------------
// GET /
//
// Lists all API clients for the current tenant. No keyHash, no plainKey.
//
// Response: { data: ApiClientResponse[], meta: { count } }
// ---------------------------------------------------------------------------
apiClientsHandler.get('/', requirePermission(Actions.ListApiClients), async (c) => {
  const tenantId = c.get('tenantId')
  const repo = createApiClientRepository(c.get('db'))

  const rows = await repo.listByTenant(tenantId)
  return c.json({ data: rows.map(toResponse), meta: { count: rows.length } })
})

// ---------------------------------------------------------------------------
// GET /:id
//
// Returns a single API client by id (tenant-scoped). 404 if not found or
// wrong tenant.
//
// Response: { data: ApiClientResponse } (200) | 404
// ---------------------------------------------------------------------------
apiClientsHandler.get('/:id', requirePermission(Actions.ListApiClients), async (c) => {
  const tenantId = c.get('tenantId')
  // The route is `/:id` so `id` is always present at runtime; the `?? ''`
  // satisfies the looser middleware-chained Hono typing.
  const id = c.req.param('id') ?? ''
  const repo = createApiClientRepository(c.get('db'))

  const row = await repo.findById(id, tenantId)
  if (!row) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: toResponse(row) })
})

// ---------------------------------------------------------------------------
// PATCH /:id
//
// Updates the ApiClient's name and/or the bound service-account user's
// roleNames. At least one field must be provided. roleNames updates require
// a non-stale row (actsAsUserId set); stale rows must be deleted and recreated.
//
// Request:  { name?: string, roleNames?: string[] }
// Response: { data: ApiClientResponse } (200) | 400 | 404 | 409
// ---------------------------------------------------------------------------
apiClientsHandler.patch(
  '/:id',
  requirePermission(Actions.CreateApiClient),
  validator('json', (value, c) => {
    const r = PatchApiClientBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const id = c.req.param('id') ?? ''
    const patch = c.req.valid('json')
    const db = c.get('db')

    const repo = createApiClientRepository(db)
    const existing = await repo.findById(id, tenantId)
    if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

    if (patch.roleNames !== undefined && existing.actsAsUserId === null) {
      return c.json(
        {
          error: 'Cannot update roles on a stale API client. Revoke this key and create a new one.',
          code: 'STALE_API_CLIENT',
        },
        409,
      )
    }

    const updated = await db.$transaction(async (tx) => {
      if (patch.roleNames !== undefined && existing.actsAsUserId !== null) {
        await tx.tenantUser.update({
          where: { id: existing.actsAsUserId },
          data: { roleNames: patch.roleNames },
        })
      }
      const txRepo = createApiClientRepository(tx as PrismaClient)
      if (patch.name !== undefined) {
        return txRepo.update(id, tenantId, { name: patch.name })
      }
      // No name change — re-read so the response reflects the updated roleNames.
      const reread = await txRepo.findById(id, tenantId)
      if (!reread) throw new Error('api-client disappeared mid-transaction')
      return reread
    })

    return c.json({ data: toResponse(updated) })
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
apiClientsHandler.post('/:id/revoke', requirePermission(Actions.RevokeApiClient), async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id') ?? ''
  const repo = createApiClientRepository(c.get('db'))

  const existing = await repo.findById(id, tenantId)
  if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

  if (existing.revokedAt !== null) {
    return c.json({ error: 'API client is already revoked', code: 'CONFLICT' }, 409)
  }

  const revoked = await repo.revoke(id, tenantId)
  logger.info('API client revoked', { id, tenantId })
  return c.json({ data: toResponse(revoked) })
})

// ---------------------------------------------------------------------------
// POST /:id/rotate
//
// Issues a new key on the same row (new keyHash/keyPrefix, revokedAt cleared).
// The new plainKey is returned once — it will not be shown again.
//
// Response: { data: ApiClientResponse & { plainKey } } (200) | 404
// ---------------------------------------------------------------------------
apiClientsHandler.post('/:id/rotate', requirePermission(Actions.RotateApiClient), async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id') ?? ''
  const repo = createApiClientRepository(c.get('db'))

  const existing = await repo.findById(id, tenantId)
  if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

  const { row, plainKey } = await repo.rotate(id, tenantId)
  logger.info('API client rotated', { id: row.id, keyPrefix: row.keyPrefix, tenantId })
  const response: ApiClientCreateResponse = { ...toResponse(row), plainKey }
  return c.json({ data: response })
})

// ---------------------------------------------------------------------------
// DELETE /:id
//
// Hard-deletes the API client AND its bound service-account TenantUser (the
// `svc-<uuid>@svc.invalid` principal) in one transaction — leaving no orphaned
// user behind. Unlike revoke (soft, reversible), delete is permanent; the key
// and its principal are gone.
//
// Refused with 409 RUNTIME_CLIENT_IN_USE when the key is a workflow-runtime
// credential (referenced by a Workflow.runtimeApiClientId): those are owned by
// the workflow lifecycle and deleting one would strand that workflow's runtime
// auth. Such keys are also hidden from GET / entirely.
//
// Response: { data: { id, deleted: true } } (200) | 404 | 409
// ---------------------------------------------------------------------------
apiClientsHandler.delete('/:id', requirePermission(Actions.DeleteApiClient), async (c) => {
  const tenantId = c.get('tenantId')
  const id = c.req.param('id') ?? ''
  const db = c.get('db')
  const repo = createApiClientRepository(db)

  const existing = await repo.findById(id, tenantId)
  if (!existing) return c.json({ error: 'API client not found', code: 'NOT_FOUND' }, 404)

  // Guard: never delete a live workflow-runtime credential out from under its
  // workflow. Authoritative check against the Workflow table (not the key's
  // name), so a hand-renamed key can't dodge it.
  const runtimeOwner = await db.workflow.findFirst({
    where: { tenantId, runtimeApiClientId: id },
    select: { id: true, name: true },
  })
  if (runtimeOwner) {
    return c.json(
      {
        error:
          'This key is the runtime credential for a workflow and cannot be deleted here — it is managed by the workflow lifecycle.',
        code: 'RUNTIME_CLIENT_IN_USE',
      },
      409,
    )
  }

  await repo.deleteWithServiceAccount(id, tenantId)
  logger.info('API client deleted', {
    id,
    tenantId,
    serviceAccountId: existing.actsAsUserId,
  })
  return c.json({ data: { id, deleted: true } })
})
