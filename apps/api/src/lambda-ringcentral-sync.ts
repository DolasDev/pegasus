// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral reconciliation sync (the safety net).
//
// Iterates active connections and runs the dual-store sync (Unit 7). Once the
// webhook path (Phase 2) is live this is the low-frequency backstop that
// recovers anything a webhook missed (subscription blacklist windows, outages);
// until then it is the primary capture path — and on its own it fixes the
// original "only outbound SMS visible" problem.
//
// Scheduling lives in the CDK ApiStack (EventBridge rule). Inert until
// RINGCENTRAL_ENABLED=true (readOAuthConfig returns null → no-op). Per-connection
// failures are isolated so one bad connection can't starve the others.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { readOAuthConfig } from './services/ringcentral/oauth'
import { syncConnection } from './services/ringcentral/sync'
import { RateLimitError } from './services/ringcentral/client'
import { listActiveConnections } from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-sync')

export async function handler(): Promise<void> {
  const config = readOAuthConfig()
  if (!config) {
    logger.info('RingCentral integration disabled — skipping reconciliation sync')
    return
  }

  const connections = await listActiveConnections(db)
  logger.info('Reconciliation sync starting', { connections: connections.length })

  let captured = 0
  let failed = 0
  for (const conn of connections) {
    try {
      const result = await syncConnection(db, conn)
      captured += result.captured
    } catch (err) {
      failed++
      if (err instanceof RateLimitError) {
        logger.warn('RingCentral rate-limited — will retry next run', {
          connectionId: conn.id,
          retryAfterMs: err.retryAfterMs,
        })
        continue
      }
      logger.error('Reconciliation sync failed for connection', {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Reconciliation sync complete', {
    connections: connections.length,
    captured,
    failed,
  })
}
