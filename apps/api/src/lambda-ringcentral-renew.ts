// ---------------------------------------------------------------------------
// Scheduled Lambda — RingCentral subscription renewal.
//
// Iterates active connections and ensures each has a healthy webhook
// subscription (create / renew / recreate — see subscription-manager). Runs
// often enough to renew before expiry and recreate after a blacklist/outage.
//
// Inert until RINGCENTRAL_ENABLED=true AND RINGCENTRAL_WEBHOOK_URL is set (no
// point creating a subscription without a delivery address). Per-connection
// failures are isolated.
// ---------------------------------------------------------------------------

import { db } from './db'
import { createLogger } from './lib/logger'
import { readOAuthConfig } from './services/ringcentral/oauth'
import { ensureForConnection, readWebhookUrl } from './services/ringcentral/subscription-manager'
import { RateLimitError } from './services/ringcentral/client'
import { listActiveConnections } from './repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-renew')

export async function handler(): Promise<void> {
  const config = readOAuthConfig()
  const webhookUrl = readWebhookUrl()
  if (!config || !webhookUrl) {
    logger.info('RingCentral webhooks not configured — skipping subscription renewal', {
      enabled: Boolean(config),
      hasWebhookUrl: Boolean(webhookUrl),
    })
    return
  }

  const connections = await listActiveConnections(db)
  logger.info('Subscription renewal starting', { connections: connections.length })

  const actions = { created: 0, renewed: 0, recreated: 0, noop: 0 }
  let failed = 0
  for (const conn of connections) {
    try {
      const action = await ensureForConnection(db, config, conn, webhookUrl)
      actions[action]++
    } catch (err) {
      failed++
      if (err instanceof RateLimitError) {
        logger.warn('RingCentral rate-limited during renewal — retry next run', {
          connectionId: conn.id,
        })
        continue
      }
      logger.error('subscription ensure failed for connection', {
        connectionId: conn.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  logger.info('Subscription renewal complete', { ...actions, failed })
}
