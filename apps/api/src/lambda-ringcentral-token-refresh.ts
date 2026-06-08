// ---------------------------------------------------------------------------
// Scheduled Lambda — refreshes RingCentral OAuth access/refresh tokens.
//
// RingCentral refresh tokens lapse if unused, and access tokens are short-lived.
// This cron keeps every active connection's token warm: read the stored refresh
// token, exchange it (RC rotates the refresh token on each use), and persist the
// rotated value back to Secrets Manager. A failed refresh marks the connection
// EXPIRED + UNHEALTHY so an operator (and the alarms in Unit 16) can react.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule). Inert until the
// integration is enabled: readOAuthConfig() returns null when RINGCENTRAL_ENABLED
// is unset, and the handler no-ops.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import {
  readOAuthConfig,
  refreshAccessToken,
  RingCentralOAuthError,
} from './services/ringcentral/oauth'
import { getRefreshToken, storeRefreshToken } from './lib/ringcentral-secrets'
import {
  listActiveConnections,
  markTokenRefreshed,
  markTokenExpired,
  updateConnectionHealth,
} from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-token-refresh')

export async function handler(): Promise<void> {
  const config = readOAuthConfig()
  if (!config) {
    logger.info('RingCentral integration disabled — skipping token refresh')
    return
  }

  const connections = await listActiveConnections(db)
  logger.info('Refreshing RingCentral tokens', { count: connections.length })

  let refreshed = 0
  let failed = 0
  for (const conn of connections) {
    // listActiveConnections already filters tokenSecretArn != null; guard anyway.
    if (!conn.tokenSecretArn) continue
    try {
      const refreshToken = await getRefreshToken(conn.tokenSecretArn)
      const tokens = await refreshAccessToken(config, refreshToken)
      // RC rotates the refresh token on use — persist the new value so the next
      // run isn't using a consumed token.
      const arn = await storeRefreshToken(conn.id, tokens.refresh_token)
      await markTokenRefreshed(db, conn.id, new Date(), arn)
      refreshed++
    } catch (err) {
      failed++
      // Only a 4xx (e.g. invalid_grant — the refresh token is genuinely dead)
      // means EXPIRED. A 5xx/network blip is transient: keep the connection
      // ACTIVE (so the next run retries it) and just flag it DEGRADED. Marking
      // it EXPIRED here would drop it from listActiveConnections permanently.
      const permanent = err instanceof RingCentralOAuthError && err.isPermanent
      logger.error('RingCentral token refresh failed', {
        connectionId: conn.id,
        permanent,
        error: err instanceof Error ? err.message : String(err),
      })
      if (permanent) {
        await markTokenExpired(db, conn.id)
      } else {
        await updateConnectionHealth(db, conn.id, 'DEGRADED')
      }
    }
  }

  logger.info('RingCentral token refresh complete', { refreshed, failed })
}
