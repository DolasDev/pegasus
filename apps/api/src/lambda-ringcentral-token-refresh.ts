// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral connection credential health-check.
//
// With per-tenant JWT auth there is no refresh token to rotate. This cron
// checks each active connection still works by making one cheap authenticated
// call (GET extension info) with the connection's SHARED access token.
//
// It deliberately does NOT mint a token of its own. Each mint is a new
// RingCentral session, RingCentral keeps only ~5 per user per app, and this
// cron used to mint 48 a day per connection, which helped evict the legacy
// desktop's token (401 OAU-213). A token is minted only when the shared one has
// expired or been revoked, which is when a mint is needed anyway, so the JWT
// is still exercised at least once per token lifetime.
//
// Outcome mapping is unchanged: only the TOKEN ENDPOINT refusing the
// credentials (4xx, other than 429 — a revoked/expired JWT or bad client
// secret) marks the connection EXPIRED + UNHEALTHY. Anything else, including a
// 4xx from the probe call itself, flags it DEGRADED so the next run retries;
// success restores HEALTHY.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule). Inert until the
// integration is enabled: readOAuthConfig() returns null when RINGCENTRAL_ENABLED
// is unset, and the handler no-ops.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { readOAuthConfig, RingCentralTokenExchangeError } from './services/ringcentral/oauth'
import { withRingCentralToken } from './services/ringcentral/client'
import {
  listActiveConnections,
  markTokenRefreshed,
  markTokenExpired,
  updateConnectionHealth,
} from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-credential-check')

/** Cheapest authenticated read that proves the token + extension still work. */
export const EXTENSION_INFO_PATH = '/restapi/v1.0/account/~/extension/~'

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
      await withRingCentralToken(conn, (client) => client.get(EXTENSION_INFO_PATH))
      // Credentials work — restore ACTIVE/HEALTHY + stamp lastRefreshedAt.
      await markTokenRefreshed(db, conn.id, new Date())
      healthy++
    } catch (err) {
      failed++
      // Only the token endpoint refusing the credentials (a genuinely
      // dead/revoked JWT or bad secret) means EXPIRED — the tenant must paste a
      // new JWT. Everything else is transient: keep the connection ACTIVE (so
      // the next run retries) and flag it DEGRADED. That includes a 429 (says
      // nothing about the credential) and a 4xx from the probe call, which
      // must not take a connection offline when the JWT itself still works.
      const permanent =
        err instanceof RingCentralTokenExchangeError && err.isPermanent && err.status !== 429
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
