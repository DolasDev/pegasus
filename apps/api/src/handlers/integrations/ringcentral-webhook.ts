// ---------------------------------------------------------------------------
// RingCentral webhook handler — POST /api/integrations/ringcentral/webhook
//
// Mounted pre-tenant (unauthenticated; RingCentral's delivery carries no
// session). Resolves the tenant from the payload's subscriptionId.
//
//   1. Validation handshake — if a Validation-Token header is present (sub
//      create/renew), echo it back in the response header + 200, immediately.
//   2. Event auth — compare the inbound verification-token header against the
//      subscription's stored token (timing-safe). Resolve tenant from the sub.
//   3. Fast-ack — persist the raw event + enqueue a capture job (if the queue
//      is configured) and return 200 in <1s. No heavy work inline (a slow or
//      erroring endpoint gets the subscription blacklisted by RC).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { db } from '../../db'
import type { AppEnv } from '../../types'
import { logger } from '../../lib/logger'
import { isWebhookValidationHandshake } from '@pegasus/domain'
import { findSubscriptionByRcId, recordWebhookEvent } from '../../repositories/messaging.repository'
import { enqueueCapture } from '../../lib/ringcentral-queue'

export const ringcentralWebhookHandler = new Hono<AppEnv>()

/** Constant-time string compare that tolerates unequal lengths. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

ringcentralWebhookHandler.post('/webhook', async (c) => {
  const headers = c.req.header() as Record<string, string | undefined>

  // 1. Validation handshake — echo the token, no body work.
  const validationToken = isWebhookValidationHandshake(headers)
  if (validationToken) {
    c.header('Validation-Token', validationToken)
    return c.body(null, 200)
  }

  // 2. Resolve the subscription from the payload.
  const payload = (await c.req.json().catch(() => null)) as { subscriptionId?: string } | null
  const subscriptionId = payload?.subscriptionId
  if (!payload || !subscriptionId) {
    return c.json({ error: 'Missing subscriptionId' }, 400)
  }

  const subscription = await findSubscriptionByRcId(db, String(subscriptionId))
  if (!subscription) {
    logger.warn('RingCentral webhook for unknown subscription', { subscriptionId })
    return c.json({ error: 'Unknown subscription' }, 404)
  }

  // 3. Verify the per-subscription token. RC sends it on each notification as
  //    the Verification-Token header (the Validation-Token handshake already
  //    returned above). Header keys are lowercased by Hono.
  const provided = headers['verification-token']
  if (!provided || !tokenMatches(provided, subscription.verificationToken)) {
    logger.warn('RingCentral webhook verification-token mismatch', {
      subscriptionId,
      tenantId: subscription.tenantId,
    })
    return c.json({ error: 'Invalid verification token' }, 401)
  }

  // 4. Fast-ack: persist raw event, enqueue capture, return 200.
  const webhookEventId = await recordWebhookEvent(db, subscription.tenantId, {
    subscriptionId: String(subscriptionId),
    connectionId: subscription.connectionId,
    rawPayload: payload as object,
    headers: headers as Record<string, string>,
  })

  const enqueued = await enqueueCapture({
    webhookEventId,
    tenantId: subscription.tenantId,
    connectionId: subscription.connectionId,
    subscriptionId: String(subscriptionId),
  })

  logger.info('RingCentral webhook accepted', {
    subscriptionId,
    tenantId: subscription.tenantId,
    webhookEventId,
    enqueued,
  })
  return c.json({ status: 'accepted' }, 200)
})
