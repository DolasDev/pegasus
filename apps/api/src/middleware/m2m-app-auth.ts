// ---------------------------------------------------------------------------
// M2M application authentication middleware
//
// Authenticates requests from API clients (machine-to-machine) carrying a
// vnd_-prefixed Bearer token. After verifying the key the middleware resolves
// the service-account TenantUser the client acts as and populates the AppEnv
// context so M2M-only handlers can run through the same Cedar/AVP authz path
// as Cognito-authenticated routes.
//
// Variables set on success:
//   tenantId      — from ApiClient.tenantId
//   db            — tenant-scoped Prisma client (same extension used by Cognito routes)
//   userId        — actsAsUser.id (the service-account TenantUser)
//   principal     — { sub: actsAsUser.id, tenantId, roleNames } — Cedar input
//   idToken       — undefined (no Cognito JWT; authorize() falls back to the wasm backend)
//   policyStoreId — tenant.policyStoreId ?? undefined
//   apiClient     — the verified ApiClient record (keyHash excluded). Retained
//                   for legacy scope-based middleware that hasn't migrated yet
//                   (see middleware/longhaul-user.ts).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { db as basePrisma } from '../db'
import { createTenantDb } from '../lib/prisma'
import { logger } from '../lib/logger'
import type { AppEnv } from '../types'

export const m2mAppAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token?.startsWith('vnd_')) {
    return c.json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  const keyPrefix = token.slice(0, 12)
  const repo = createApiClientRepository(basePrisma)
  const candidate = await repo.findByPrefix(keyPrefix)

  if (!candidate) {
    return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  const incomingHash = crypto.createHash('sha256').update(token).digest('hex')
  let match: boolean
  try {
    match = crypto.timingSafeEqual(
      Buffer.from(candidate.keyHash, 'hex'),
      Buffer.from(incomingHash, 'hex'),
    )
  } catch {
    // timingSafeEqual throws if buffer lengths differ — treat as mismatch
    match = false
  }

  if (!match) {
    return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  if (candidate.revokedAt !== null) {
    return c.json({ error: 'API key has been revoked', code: 'FORBIDDEN' }, 403)
  }

  // Verify tenant is active before proceeding
  const tenant = await basePrisma.tenant.findUnique({
    where: { id: candidate.tenantId },
    select: { id: true, status: true, policyStoreId: true },
  })

  if (!tenant || tenant.status === 'OFFBOARDED') {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }
  if (tenant.status === 'SUSPENDED') {
    return c.json({ error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' }, 403)
  }

  // Resolve the service-account principal this key acts as. Without a valid
  // service-account user there is no Cedar input — the request must be
  // rejected. These are 403s rather than 401s because the caller proved key
  // ownership but the row is mis-configured (or stale, pre-migration).
  const actsAs = candidate.actsAsUser
  if (candidate.actsAsUserId === null || actsAs === null) {
    logger.warn('m2mAppAuthMiddleware: ApiClient has no service-account principal', {
      apiClientId: candidate.id,
      tenantId: candidate.tenantId,
    })
    return c.json(
      {
        error: 'API key is not bound to a service account',
        code: 'API_CLIENT_MISCONFIGURED',
      },
      403,
    )
  }
  if (actsAs.tenantId !== candidate.tenantId) {
    // FK alone doesn't constrain same-tenant — guard against a stale row that
    // was rebound across tenants.
    logger.error('m2mAppAuthMiddleware: ApiClient acts-as user belongs to a different tenant', {
      apiClientId: candidate.id,
      apiClientTenantId: candidate.tenantId,
      userTenantId: actsAs.tenantId,
    })
    return c.json(
      {
        error: 'API key is not bound to a service account',
        code: 'API_CLIENT_MISCONFIGURED',
      },
      403,
    )
  }
  if (!actsAs.isServiceAccount) {
    return c.json(
      {
        error: 'API key is not bound to a service account',
        code: 'API_CLIENT_MISCONFIGURED',
      },
      403,
    )
  }
  if (actsAs.status !== 'ACTIVE') {
    return c.json(
      {
        error: 'Service account is not active',
        code: 'SERVICE_ACCOUNT_INACTIVE',
      },
      403,
    )
  }

  // Fire-and-forget — do not await
  void repo.touchLastUsed(candidate.id).catch((err: unknown) => {
    logger.warn('m2mAppAuthMiddleware: touchLastUsed threw unexpectedly', {
      id: candidate.id,
      error: String(err),
    })
  })

  const tenantDb = createTenantDb(basePrisma, tenant.id)

  const { keyHash: _keyHash, actsAsUser: _actsAsUser, ...rest } = candidate
  const clientRow = { ...rest, roleNames: actsAs.roleNames }

  c.set('tenantId', tenant.id)
  c.set('db', tenantDb as unknown as PrismaClient)
  c.set('userId', actsAs.id)
  c.set('principal', {
    sub: actsAs.id,
    tenantId: tenant.id,
    roleNames: actsAs.roleNames,
  })
  c.set('idToken', undefined)
  c.set('policyStoreId', tenant.policyStoreId ?? undefined)
  c.set('apiClient', clientRow)

  await next()
}
