// ---------------------------------------------------------------------------
// M2M application authentication middleware
//
// Authenticates requests from API clients (machine-to-machine) carrying a
// vnd_-prefixed Bearer token. Unlike apiClientAuthMiddleware (which only sets
// ApiClientEnv variables), this middleware also sets up the full AppEnv
// context so M2M-only handlers can be mounted alongside Cognito-protected
// routes under the same /api/v1 prefix.
//
// Variables set on success:
//   tenantId  — from ApiClient.tenantId
//   db        — tenant-scoped Prisma client (same extension used by Cognito routes)
//   role      — fixed string 'api_client'
//   userId    — undefined (no human user context)
//   apiClient — the verified ApiClient record (keyHash excluded)
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

  // Fire-and-forget — do not await
  void repo.touchLastUsed(candidate.id).catch((err: unknown) => {
    logger.warn('m2mAppAuthMiddleware: touchLastUsed threw unexpectedly', {
      id: candidate.id,
      error: String(err),
    })
  })

  // Verify tenant is active before proceeding
  const tenant = await basePrisma.tenant.findUnique({
    where: { id: candidate.tenantId },
    select: { id: true, status: true },
  })

  if (!tenant || tenant.status === 'OFFBOARDED') {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }
  if (tenant.status === 'SUSPENDED') {
    return c.json({ error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' }, 403)
  }

  const tenantDb = createTenantDb(basePrisma, tenant.id)

  const { keyHash, ...clientRow } = candidate

  c.set('tenantId', tenant.id)
  c.set('db', tenantDb as unknown as PrismaClient)
  c.set('role', 'api_client')
  c.set('userId', undefined)
  c.set('apiClient', clientRow)

  await next()
}
