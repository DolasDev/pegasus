// ---------------------------------------------------------------------------
// API client authentication middleware (M2M)
//
// Authenticates requests that carry a vendor API key instead of a Cognito JWT.
// Vendor keys are distinguished by the "vnd_" prefix — Cognito JWTs begin with
// "eyJ" (base64-encoded JSON header) and never start with "vnd_".
//
// Two auth paths, tried in order:
//
//   1. Platform-key path (DB-free).
//      The WireGuard reconcile agent and any future platform-scoped daemon
//      authenticate via a static token whose SHA-256 is injected into the
//      Lambda env as VPN_AGENT_APIKEY_HASH (resolved from SSM at deploy time
//      by ApiStack). On match, sets a synthetic apiClient with the
//      'vpn:sync' scope and a null tenantId — tenant-scoped handlers reject
//      such requests via the same null check they apply to misconfigured
//      tokens.
//
//   2. Tenant-scoped DB path.
//      Looks up the ApiClient row by key_prefix, timing-safe-compares the
//      hash, rejects if revoked, fires-and-forgets last_used_at.
//
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import type { Context, Next } from 'hono'
import { createApiClientRepository } from '../repositories/api-client.repository'
import { db as basePrisma } from '../db'
import { logger } from '../lib/logger'
import type { ApiClientContext, ApiClientEnv } from '../types'

/** Scope granted to the WireGuard hub reconcile agent's platform key. */
const VPN_AGENT_SCOPE = 'vpn:sync'

/** Synthetic ApiClient id used for the platform-key path. */
const PLATFORM_VPN_AGENT_ID = 'platform-vpn-agent'

export async function apiClientAuthMiddleware(
  c: Context<ApiClientEnv>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token?.startsWith('vnd_')) {
    return c.json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  const incomingHash = crypto.createHash('sha256').update(token).digest('hex')

  // ---- 1. Platform-key path
  const platformContext = matchPlatformKey(incomingHash, token)
  if (platformContext !== null) {
    c.set('apiClient', platformContext)
    c.set('tenantId', null)
    await next()
    return
  }

  // ---- 2. Tenant-scoped DB path
  const keyPrefix = token.slice(0, 12) // matches key_prefix column length
  const repo = createApiClientRepository(basePrisma)
  const candidate = await repo.findByPrefix(keyPrefix)

  if (!candidate) {
    return c.json({ error: 'Invalid API key', code: 'UNAUTHORIZED' }, 401)
  }

  // Timing-safe comparison — prevents timing attacks on the hash comparison.
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

/**
 * Compare the incoming token's hash against the env-injected platform-key
 * hash. Returns a synthetic ApiClientContext on match, or null when the
 * platform key is unconfigured or the hash doesn't match.
 *
 * The expected hash is read from the env on every call rather than
 * captured at module load time so the middleware can be exercised by tests
 * that set process.env.VPN_AGENT_APIKEY_HASH after import.
 */
function matchPlatformKey(incomingHash: string, token: string): ApiClientContext | null {
  const expectedHash = process.env['VPN_AGENT_APIKEY_HASH']
  if (!expectedHash) return null

  let match: boolean
  try {
    match = crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(incomingHash, 'hex'),
    )
  } catch {
    return null
  }
  if (!match) return null

  const now = new Date()
  return {
    id: PLATFORM_VPN_AGENT_ID,
    tenantId: null,
    name: 'Platform VPN Agent',
    keyPrefix: token.slice(0, 12),
    scopes: [VPN_AGENT_SCOPE],
    lastUsedAt: null,
    revokedAt: null,
    createdById: null,
    createdAt: now,
    updatedAt: now,
  }
}
