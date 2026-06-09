// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral connection credential health-check.
//
// With per-tenant JWT auth there is no refresh token to rotate — access tokens
// are minted on demand from the stored JWT. This cron proactively verifies each
// active connection's credentials still work: it does a real jwt-bearer exchange
// (bypassing the in-memory token cache) per connection. A permanent failure (4xx
// — a revoked/expired JWT or bad client secret) marks the connection EXPIRED +
// UNHEALTHY; a transient failure flags it DEGRADED; success restores HEALTHY.
// This keeps the ConnectionsUnhealthy metric/alarm (Unit 16) meaningful.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule). Inert until the
// integration is enabled: readOAuthConfig() returns null when RINGCENTRAL_ENABLED
// is unset, and the handler no-ops.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import {
  readOAuthConfig,
  exchangeJwtForToken,
  RingCentralOAuthError,
  DEFAULT_API_BASE,
} from './services/ringcentral/oauth'
import { getConnectionCredentials } from './lib/ringcentral-secrets'
import {
  listActiveConnections,
  markTokenRefreshed,
  markTokenExpired,
  updateConnectionHealth,
} from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-credential-check')

export async function handler(): Promise<void> {
  const config = readOAuthConfig()
  if (!config) {
    logger.info('RingCentral integration disabled — skipping credential check')
    return
  }

  const connections = await listActiveConnections(db)
  logger.info('Checking RingCentral connection credentials', { count: connections.length })

  let healthy = 0
  let failed = 0
  for (const conn of connections) {
    // listActiveConnections already filters tokenSecretArn != null; guard anyway.
    if (!conn.tokenSecretArn) continue
    try {
      const creds = await getConnectionCredentials(conn.tokenSecretArn)
      await exchangeJwtForToken(creds, creds.apiBase ?? DEFAULT_API_BASE)
      // Credentials work — restore ACTIVE/HEALTHY + stamp lastRefreshedAt.
      await markTokenRefreshed(db, conn.id, new Date())
      healthy++
    } catch (err) {
      failed++
      // Only a 4xx (a genuinely dead/revoked JWT or bad secret) means EXPIRED —
      // the tenant must paste a new JWT. A 5xx/network blip is transient: keep
      // the connection ACTIVE (so the next run retries) and flag it DEGRADED.
      const permanent = err instanceof RingCentralOAuthError && err.isPermanent
      logger.error('RingCentral credential check failed', {
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

  logger.info('RingCentral credential check complete', { healthy, failed })
}
