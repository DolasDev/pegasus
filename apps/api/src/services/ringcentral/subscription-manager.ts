// ---------------------------------------------------------------------------
// RingCentral subscription manager.
//
// Maintains one managed webhook subscription per connection against the shared
// webhook URL. ensureForConnection is idempotent:
//   - create  if the connection has no subscription
//   - renew   (PUT) when within the renewal threshold of expiry
//   - recreate (DELETE + create) when BLACKLISTED/DEAD or a renew 404s
//
// Each subscription carries its own verificationToken; the webhook resolves
// subscriptionId → connection → tenant and checks that token (Unit 10).
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { createLogger } from '../../lib/logger'
import { RingCentralOAuthError } from './oauth'
import { acquireAccessToken, makeClient, type RingCentralClient } from './client'
import {
  findSubscriptionByConnection,
  upsertSubscription,
  updateSubscription,
  deleteSubscription,
} from '../../repositories/messaging.repository'

const logger = createLogger('pegasus-ringcentral-subscription')

const SUBSCRIPTION_PATH = '/restapi/v1.0/subscription'

/** Event filters covering both SMS stores (plan §5b). */
export const EVENT_FILTERS: readonly string[] = [
  // Thread message events (inbound + threaded outbound) — primary.
  '/restapi/v1.0/account/~/message-threads/entries/sync',
  // v1.0 message-store SMS (legacy/API outbound), if v1.0 send remains in use.
  '/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS',
]

/** Renew when the subscription is within this window of expiry. */
export const RENEW_THRESHOLD_MS = 24 * 60 * 60 * 1000

/** A 7-day fallback when RC omits expirationTime from the response. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface SubManagerConnection {
  id: string
  tenantId: string
  tokenSecretArn: string | null
}

interface RcSubscriptionResponse {
  id: string | number
  expirationTime?: string
}

function newVerificationToken(): string {
  return randomBytes(24).toString('hex')
}

function expiryFrom(res: RcSubscriptionResponse, now: number): Date {
  if (res.expirationTime) {
    const d = new Date(res.expirationTime)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date(now + DEFAULT_TTL_MS)
}

/** Reads the shared webhook delivery URL; null when not configured. */
export function readWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env['RINGCENTRAL_WEBHOOK_URL'] ?? null
}

// ---------------------------------------------------------------------------
// Create / renew
// ---------------------------------------------------------------------------

async function createSubscription(
  db: PrismaClient,
  client: RingCentralClient,
  connection: SubManagerConnection,
  webhookUrl: string,
  now: number,
) {
  const verificationToken = newVerificationToken()
  const res = await client.post<RcSubscriptionResponse>(SUBSCRIPTION_PATH, {
    eventFilters: [...EVENT_FILTERS],
    deliveryMode: { transportType: 'WebHook', address: webhookUrl, verificationToken },
  })
  return upsertSubscription(db, connection.tenantId, {
    connectionId: connection.id,
    subscriptionId: String(res.id),
    eventFilters: [...EVENT_FILTERS],
    deliveryAddress: webhookUrl,
    verificationToken,
    expiresAt: expiryFrom(res, now),
  })
}

/**
 * Ensures the connection has a healthy subscription. Returns the action taken.
 * `acquireAccessToken`/RC failures propagate to the caller (the cron isolates
 * them per connection).
 */
export async function ensureForConnection(
  db: PrismaClient,
  connection: SubManagerConnection,
  webhookUrl: string,
  now: number = Date.now(),
): Promise<'created' | 'renewed' | 'recreated' | 'noop'> {
  const { accessToken, apiBase } = await acquireAccessToken(connection, now)
  const client = makeClient(apiBase, accessToken)
  const existing = await findSubscriptionByConnection(db, connection.id)

  if (!existing) {
    await createSubscription(db, client, connection, webhookUrl, now)
    logger.info('created RingCentral subscription', { connectionId: connection.id })
    return 'created'
  }

  if (existing.status === 'BLACKLISTED' || existing.status === 'DEAD') {
    await recreate(db, client, connection, existing.id, existing.subscriptionId, webhookUrl, now)
    return 'recreated'
  }

  if (existing.expiresAt.getTime() - now <= RENEW_THRESHOLD_MS) {
    try {
      const res = await client.put<RcSubscriptionResponse>(
        `${SUBSCRIPTION_PATH}/${existing.subscriptionId}`,
        { eventFilters: [...EVENT_FILTERS] },
      )
      await updateSubscription(db, existing.id, {
        status: 'ACTIVE',
        expiresAt: expiryFrom(res, now),
        lastRenewedAt: new Date(now),
        failureCount: 0,
      })
      logger.info('renewed RingCentral subscription', { connectionId: connection.id })
      return 'renewed'
    } catch (err) {
      // A 404 means RC dropped the subscription — recreate it.
      if (err instanceof RingCentralOAuthError && err.status === 404) {
        await recreate(
          db,
          client,
          connection,
          existing.id,
          existing.subscriptionId,
          webhookUrl,
          now,
        )
        return 'recreated'
      }
      throw err
    }
  }

  return 'noop'
}

async function recreate(
  db: PrismaClient,
  client: RingCentralClient,
  connection: SubManagerConnection,
  rowId: string,
  rcSubscriptionId: string,
  webhookUrl: string,
  now: number,
) {
  // Best-effort delete of the stale RC subscription; ignore failures (it may
  // already be gone — that's why we're recreating).
  try {
    await client.del(`${SUBSCRIPTION_PATH}/${rcSubscriptionId}`)
  } catch (err) {
    logger.warn('failed to delete stale RingCentral subscription (continuing)', {
      connectionId: connection.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await deleteSubscription(db, rowId)
  await createSubscription(db, client, connection, webhookUrl, now)
  logger.info('recreated RingCentral subscription', { connectionId: connection.id })
}
