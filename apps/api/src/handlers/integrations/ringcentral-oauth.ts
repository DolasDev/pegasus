// ---------------------------------------------------------------------------
// RingCentral connections handler (tenant-admin).
//
//   POST   /api/v1/integrations/ringcentral/connections      → connect (BYO JWT)
//   GET    /api/v1/integrations/ringcentral/connections      → list
//   DELETE /api/v1/integrations/ringcentral/connections/:id  → disconnect
//
// Bring-your-own auth: the tenant pastes their own RingCentral app's client id +
// client secret + a JWT credential (bound to that app). Connect validates them
// with a live jwt-bearer exchange, then stores them in Secrets Manager and
// records the connection. There is no platform OAuth app and no consent redirect.
//
// Connect fails closed with 503 when RINGCENTRAL_ENABLED is unset (platform
// master switch). List/disconnect operate on DB rows and are NOT flag-gated.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../../middleware/rbac'
import { Actions } from '../../authz/actions'
import { db } from '../../db'
import type { AppEnv } from '../../types'
import { logger } from '../../lib/logger'
import { isValidE164 } from '@pegasus/domain'
import {
  readOAuthConfig,
  exchangeJwtForToken,
  fetchExtensionInfo,
  RingCentralOAuthError,
  type JwtCredentials,
} from '../../services/ringcentral/oauth'
import {
  storeConnectionCredentials,
  deleteConnectionCredentials,
} from '../../lib/ringcentral-secrets'
import { enqueueBackfill } from '../../lib/ringcentral-queue'
import {
  upsertConnection,
  markTokenRefreshed,
  listConnectionsByTenant,
  findConnectionById,
  deleteConnectionForTenant,
} from '../../repositories/messaging.repository'

/**
 * Days to backfill when a connection is first established. Defaults to the sync
 * service's own default (90) when unset/invalid; capped so a fat-fingered env
 * can't request an unbounded FSync window.
 */
const MAX_BACKFILL_DAYS = 365
function readBackfillDays(): number | undefined {
  const raw = process.env['RINGCENTRAL_BACKFILL_DAYS']
  if (!raw) return undefined
  const days = Number(raw)
  if (!Number.isFinite(days) || days <= 0) return undefined
  return Math.min(Math.floor(days), MAX_BACKFILL_DAYS)
}

export const ringcentralOauthHandler = new Hono<AppEnv>()

/** The connection shape returned to the Settings UI. Deliberately omits the
 * `tokenSecretArn` (secret pointer) and bookkeeping (`updatedAt`/`tenantId`). */
type RcConnection = {
  id: string
  ownerNumber: string
  rcAccountId: string
  rcExtensionId: string
  tokenStatus: 'ACTIVE' | 'EXPIRED'
  health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
  lastRefreshedAt: string | null
  scopes: string[]
  createdAt: string
}

// ---------------------------------------------------------------------------
// Connect (bring-your-own JWT credentials)
// ---------------------------------------------------------------------------

const ConnectBody = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  jwt: z.string().min(1),
  number: z.string().refine(isValidE164, 'must be a valid E.164 phone number'),
  apiBase: z.string().url().optional(),
})

ringcentralOauthHandler.post(
  '/connections',
  requirePermission(Actions.ManageRingCentralIntegration),
  validator('json', (value, c) => {
    const r = ConnectBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const config = readOAuthConfig()
    if (!config) {
      return c.json({ error: 'RingCentral integration is not enabled' }, 503)
    }
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    const apiBase = body.apiBase ?? config.apiBase
    const creds: JwtCredentials = {
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      jwt: body.jwt,
      ...(body.apiBase != null ? { apiBase: body.apiBase } : {}),
    }

    // Validate the pasted credentials with a live exchange + identity read
    // before persisting anything.
    let info
    try {
      const tokens = await exchangeJwtForToken(creds, apiBase)
      info = await fetchExtensionInfo(apiBase, tokens.access_token)
    } catch (err) {
      if (err instanceof RingCentralOAuthError && err.isPermanent) {
        logger.warn('RingCentral connect rejected credentials', { tenantId })
        return c.json(
          { error: 'RingCentral rejected the provided credentials', code: 'INVALID_CREDENTIALS' },
          400,
        )
      }
      logger.error('RingCentral connect failed during credential validation', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
      return c.json(
        { error: 'Failed to validate RingCentral credentials', code: 'EXCHANGE_FAILED' },
        502,
      )
    }

    let connectionId: string
    try {
      const connection = await upsertConnection(db, tenantId, {
        rcAccountId: info.rcAccountId,
        rcExtensionId: info.rcExtensionId,
        ownerNumber: body.number,
        scopes: [],
      })
      connectionId = connection.id
      const secretArn = await storeConnectionCredentials(connection.id, creds)
      await markTokenRefreshed(db, connection.id, new Date(), secretArn)
    } catch (err) {
      // A failure between creating the row and storing the secret leaves the row
      // with a null tokenSecretArn — inert (the crons filter those out via
      // listActiveConnections) and self-healing on a re-connect (idempotent
      // upsert + secret overwrite). Surface a clean 502 rather than a raw 500.
      logger.error('RingCentral connect failed while persisting the connection', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      })
      return c.json(
        { error: 'Failed to save the RingCentral connection', code: 'PERSIST_FAILED' },
        502,
      )
    }

    // Kick an immediate backfill so historical SMS show up right away rather
    // than after the next reconciliation cron. The freshly-upserted connection
    // has no sync cursor, so the worker's syncConnection does a full FSync of
    // both stores. Best-effort: a queue failure must not fail the connect.
    const enqueued = await enqueueBackfill(tenantId, connectionId, readBackfillDays()).catch(
      (err: unknown) => {
        logger.warn('failed to enqueue RingCentral backfill — cron will backstop', {
          connectionId,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      },
    )

    logger.info('RingCentral connection established', {
      tenantId,
      connectionId,
      rcAccountId: info.rcAccountId,
      backfillEnqueued: enqueued,
    })
    return c.json({ data: { connectionId } }, 201)
  },
)

// ---------------------------------------------------------------------------
// List / disconnect (operate on DB rows — not flag-gated)
// ---------------------------------------------------------------------------

ringcentralOauthHandler.get(
  '/connections',
  requirePermission(Actions.ManageRingCentralIntegration),
  async (c) => {
    const tenantId = c.get('tenantId')
    const rows = await listConnectionsByTenant(db, tenantId)
    const connections: RcConnection[] = rows.map((row) => ({
      id: row.id,
      ownerNumber: row.ownerNumber,
      rcAccountId: row.rcAccountId,
      rcExtensionId: row.rcExtensionId,
      tokenStatus: row.tokenStatus,
      health: row.health,
      lastRefreshedAt: row.lastRefreshedAt ? row.lastRefreshedAt.toISOString() : null,
      scopes: row.scopes,
      createdAt: row.createdAt.toISOString(),
      // NB: tokenSecretArn / updatedAt / tenantId are deliberately dropped.
    }))
    return c.json({ data: { connections } })
  },
)

ringcentralOauthHandler.delete(
  '/connections/:id',
  requirePermission(Actions.ManageRingCentralIntegration),
  async (c) => {
    const tenantId = c.get('tenantId')
    const id = c.req.param('id')
    if (!id) {
      return c.json({ error: 'RingCentral connection not found', code: 'NOT_FOUND' }, 404)
    }

    // Capture the secret ARN before the row is gone so we can clean it up.
    const existing = await findConnectionById(db, id)
    const tokenSecretArn =
      existing && existing.tenantId === tenantId ? existing.tokenSecretArn : null

    const deleted = await deleteConnectionForTenant(db, tenantId, id)
    if (deleted === 0) {
      return c.json({ error: 'RingCentral connection not found', code: 'NOT_FOUND' }, 404)
    }

    // Best-effort: free the credential secret. A failure here must not fail the
    // disconnect (the row is already gone), so swallow + log.
    if (tokenSecretArn) {
      try {
        await deleteConnectionCredentials(tokenSecretArn)
      } catch (err) {
        logger.warn('failed to delete RingCentral credential secret on disconnect', {
          connectionId: id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // We deliberately do NOT call RingCentral to delete the remote webhook
    // subscription: without the renewal cron keeping it alive it expires on its
    // own (~7 days), so leaving it is safe and avoids a network dependency on
    // the disconnect path.
    logger.info('RingCentral connection disconnected', { tenantId, connectionId: id })
    return c.json({ data: { disconnected: true } })
  },
)
