// ---------------------------------------------------------------------------
// API client authentication middleware (M2M)
//
// Authenticates requests that carry a vendor API key instead of a Cognito JWT.
// Vendor keys are distinguished by the "vnd_" prefix — Cognito JWTs begin with
// "eyJ" (base64-encoded JSON header) and never start with "vnd_".
//
// Auth flow:
//   1. Extract Bearer token; reject non-vnd_ tokens immediately (401).
//   2. Look up the ApiClient row by key_prefix (indexed column).
//   3. Compute SHA-256 of the incoming key and compare with stored hash using
//      crypto.timingSafeEqual to prevent timing-based attacks.
//   4. Reject if hash does not match (401) or key is revoked (403).
//   5. Fire-and-forget update of last_used_at.
//   6. Populate c.set('apiClient') and c.set('tenantId').
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { Context, Next } from 'hono'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { db as basePrisma } from '../db'
import { logger } from '../lib/logger'
import type { ApiClientEnv } from '../types'

export async function apiClientAuthMiddleware(
  c: Context<ApiClientEnv>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token?.startsWith('vnd_')) {
    return c.json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  const keyPrefix = token.slice(0, 12) // matches key_prefix column length
  const repo = createApiClientRepository(basePrisma)
  const candidate = await repo.findByPrefix(keyPrefix)

  if (!candidate) {
    return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  // Timing-safe comparison — prevents timing attacks on the hash comparison.
  const incomingHash = crypto.createHash('sha256').update(token).digest('hex')
  let match = false
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

  // Fire-and-forget — do not await; errors logged at WARN inside touchLastUsed.
  void repo.touchLastUsed(candidate.id).catch((err: unknown) => {
    logger.warn('apiClientAuthMiddleware: touchLastUsed threw unexpectedly', {
      id: candidate.id,
      error: String(err),
    })
  })

  // Exclude keyHash from context — strip it before setting.
  const { keyHash, ...clientRow } = candidate
  c.set('apiClient', clientRow)
  c.set('tenantId', candidate.tenantId)

  await next()
}
