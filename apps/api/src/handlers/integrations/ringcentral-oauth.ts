// ---------------------------------------------------------------------------
// RingCentral OAuth connect handler.
//
//   GET /api/v1/integrations/ringcentral/oauth/start    (tenant admin)
//       → returns the RingCentral authorize URL with a signed state.
//   GET /api/integrations/ringcentral/oauth/callback    (pre-tenant; RC redirect)
//       → exchanges the code, records the connection, stores the refresh token.
//
// Flag-gated by RINGCENTRAL_ENABLED — when off (or not configured) the routes
// fail closed with 503, so the deploy is inert until the platform RC app and
// its secrets are wired up.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { requirePermission } from '../../middleware/rbac'
import { Actions } from '../../authz/actions'
import { db } from '../../db'
import type { AppEnv } from '../../types'
import { logger } from '../../lib/logger'
import { isValidE164 } from '@pegasus/domain'
import {
  readOAuthConfig,
  signState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchExtensionInfo,
} from '../../services/ringcentral/oauth'
import { storeRefreshToken } from '../../lib/ringcentral-secrets'
import { enqueueBackfill } from '../../lib/ringcentral-queue'
import { upsertConnection, markTokenRefreshed } from '../../repositories/messaging.repository'

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

// ---------------------------------------------------------------------------
// Admin: start the connect flow (tenant-authenticated)
// ---------------------------------------------------------------------------

export const ringcentralOauthHandler = new Hono<AppEnv>()

ringcentralOauthHandler.get(
  '/oauth/start',
  requirePermission(Actions.ManageRingCentralIntegration),
  (c) => {
    const config = readOAuthConfig()
    if (!config) {
      return c.json({ error: 'RingCentral integration is not enabled' }, 503)
    }
    const tenantId = c.get('tenantId')
    const ownerNumber = c.req.query('number')
    if (!ownerNumber || !isValidE164(ownerNumber)) {
      return c.json({ error: 'A valid E.164 `number` query parameter is required' }, 400)
    }
    const state = signState(
      { tenantId, ownerNumber, nonce: randomUUID(), iat: Date.now() },
      config.stateSecret,
    )
    return c.json({ url: buildAuthorizeUrl(config, state) })
  },
)

// ---------------------------------------------------------------------------
// Pre-tenant: OAuth callback (RingCentral redirect carries no session)
// ---------------------------------------------------------------------------

export const ringcentralOauthCallbackHandler = new Hono<AppEnv>()

ringcentralOauthCallbackHandler.get('/oauth/callback', async (c) => {
  const config = readOAuthConfig()
  if (!config) {
    return c.json({ error: 'RingCentral integration is not enabled' }, 503)
  }

  const error = c.req.query('error')
  if (error) {
    logger.warn('RingCentral OAuth callback returned an error', { error })
    return c.json({ error: `RingCentral authorization failed: ${error}` }, 400)
  }

  const code = c.req.query('code')
  const stateToken = c.req.query('state')
  if (!code || !stateToken) {
    return c.json({ error: 'Missing code or state' }, 400)
  }

  const state = verifyState(stateToken, config.stateSecret)
  if (!state) {
    logger.warn('RingCentral OAuth callback rejected: invalid state signature')
    return c.json({ error: 'Invalid state' }, 401)
  }

  try {
    const tokens = await exchangeCodeForToken(config, code)
    const info = await fetchExtensionInfo(config, tokens.access_token)

    const connection = await upsertConnection(db, state.tenantId, {
      rcAccountId: info.rcAccountId,
      rcExtensionId: info.rcExtensionId,
      ownerNumber: state.ownerNumber,
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
    })

    const secretArn = await storeRefreshToken(connection.id, tokens.refresh_token)
    await markTokenRefreshed(db, connection.id, new Date(), secretArn)

    // Kick an immediate backfill so historical SMS show up right away rather
    // than after the next reconciliation cron. The freshly-upserted connection
    // has no sync cursor, so the worker's syncConnection does a full FSync of
    // both stores. Best-effort: a queue failure must not fail the connect (the
    // cron is the backstop), so log and continue.
    const enqueued = await enqueueBackfill(state.tenantId, connection.id, readBackfillDays()).catch(
      (err: unknown) => {
        logger.warn('failed to enqueue RingCentral backfill — cron will backstop', {
          connectionId: connection.id,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      },
    )

    logger.info('RingCentral connection established', {
      tenantId: state.tenantId,
      connectionId: connection.id,
      rcAccountId: info.rcAccountId,
      backfillEnqueued: enqueued,
    })

    const successRedirect = process.env['RINGCENTRAL_OAUTH_SUCCESS_REDIRECT']
    if (successRedirect) return c.redirect(successRedirect)
    return c.json({ status: 'connected', connectionId: connection.id })
  } catch (err) {
    logger.error('RingCentral OAuth callback failed', {
      tenantId: state.tenantId,
      error: err instanceof Error ? err.message : String(err),
    })
    return c.json({ error: 'Failed to complete RingCentral connection' }, 502)
  }
})
