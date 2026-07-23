// ---------------------------------------------------------------------------
// Feedback requests — mint a per-recipient capability link to a published form.
//
// The mint is the PRIMITIVE (sdk-feedback design): POST / returns
// { requestId, url, expiresAt } and a running workflow sends that url however it
// likes (typically the existing send_sms). The mint-and-send SMS path is SUGAR
// layered on top: pass channel:"sms" + to and the platform renders the form's
// messageTemplate and fires one SMS through the tenant's RingCentral connection.
// A delivery failure never loses the link — the response always carries the url,
// and `delivery` reports what happened so the workflow can resend.
//
// Mounted on the M2M v1 plane (dualAuthMiddleware). Both routes are gated by
// CreateFeedbackRequest (granted to workflow_runtime, like SendSms): the same
// persona that MINTS a request polls its status, so mint + status-read share one
// action rather than adding a separate read grant the v1 UI never needs (the
// tenant-web viewer reads FORMS, not requests). tenant_admin covers both anyway.
//
// Gated by FEEDBACK_ENABLED (404 when off), like the forms surface.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { isValidE164 } from '@pegasus/domain'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { isFeedbackEnabled, feedbackUrl } from '../lib/feedback-feature'
import { renderMessageTemplate } from '../lib/feedback-form'
import { createFeedbackFormRepository } from '../repositories/feedback-form.repository'
import {
  createFeedbackRequestRepository,
  type FeedbackRequestRow,
} from '../repositories/feedback-request.repository'
import { listConnectionsByTenant } from '../repositories/messaging.repository'
import { readOAuthConfig } from '../services/ringcentral/oauth'
import { sendSms } from '../services/ringcentral/sms'
import { logger } from '../lib/logger'

/** TTL bounds: at least an hour, at most 90 days. Default 72h. */
const MIN_TTL_HOURS = 1
const MAX_TTL_HOURS = 24 * 90
const DEFAULT_TTL_HOURS = 72

const MintBody = z
  .object({
    formKey: z.string().min(1),
    subject: z
      .object({
        type: z.string().trim().min(1).max(64),
        id: z.string().trim().min(1).max(200),
      })
      .strict(),
    ttlHours: z.number().int().min(MIN_TTL_HOURS).max(MAX_TTL_HOURS).optional(),
    // Sugar: fire one SMS with the rendered message body. Omit for mint-only.
    channel: z.literal('sms').optional(),
    to: z.string().optional(),
  })
  .strict()

type DeliveryResult =
  | { channel: 'sms'; status: 'sent'; id: string | number | null }
  | { channel: 'sms'; status: 'failed'; error: string }

function toStatus(row: FeedbackRequestRow) {
  return {
    id: row.id,
    formKey: row.formKey,
    formVersion: row.formVersion,
    subject: { type: row.subjectType, id: row.subjectId },
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    response: row.responsePayload,
    createdAt: row.createdAt.toISOString(),
  }
}

export const feedbackRequestsHandler = new Hono<AppEnv>()

feedbackRequestsHandler.use('*', dualAuthMiddleware)

feedbackRequestsHandler.use('*', async (c, next) => {
  if (!isFeedbackEnabled()) {
    return c.json({ error: 'Feedback is not enabled', code: 'NOT_FOUND' }, 404)
  }
  await next()
})

/**
 * Best-effort SMS delivery for the sugar path — never throws. A missing
 * connection / disabled integration / upstream error is reported as a failed
 * delivery, not a failed mint (the link is already returned to the caller).
 */
async function deliverSms(
  db: PrismaClient,
  tenantId: string,
  to: string,
  body: string,
): Promise<DeliveryResult> {
  try {
    if (!readOAuthConfig()) {
      return { channel: 'sms', status: 'failed', error: 'RingCentral integration is not enabled' }
    }
    const connections = await listConnectionsByTenant(db, tenantId)
    const connection = connections.find(
      (conn) => conn.tokenStatus === 'ACTIVE' && conn.tokenSecretArn != null,
    )
    if (!connection) {
      return { channel: 'sms', status: 'failed', error: 'RingCentral is not connected' }
    }
    const result = await sendSms(connection, to, body)
    return { channel: 'sms', status: 'sent', id: result.id ?? null }
  } catch (err) {
    return {
      channel: 'sms',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── POST / — mint a capability link (optionally send it via SMS) ──────────────
feedbackRequestsHandler.post(
  '/',
  requirePermission(Actions.CreateFeedbackRequest),
  validator('json', (value, c) => {
    const r = MintBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const db = c.get('db')
    const { formKey, subject, ttlHours, channel, to } = c.req.valid('json')

    // The SMS sugar path needs a valid destination up front — reject before minting.
    if (channel === 'sms') {
      if (!to || !isValidE164(to)) {
        return c.json(
          {
            error: '`to` must be a valid E.164 phone number when channel is "sms"',
            code: 'VALIDATION_ERROR',
          },
          400,
        )
      }
    }

    // Pin the form version at mint so a later publish never changes what the
    // respondent already opened.
    const form = await createFeedbackFormRepository(db).findActive(formKey)
    if (!form) {
      return c.json({ error: `No published form "${formKey}"`, code: 'NOT_FOUND' }, 404)
    }

    const expiresAt = new Date(Date.now() + (ttlHours ?? DEFAULT_TTL_HOURS) * 3600_000)
    const repo = createFeedbackRequestRepository(db)
    const { row, plainToken } = await repo.mint({
      tenantId,
      formKey,
      formVersion: form.version,
      subjectType: subject.type,
      subjectId: subject.id,
      expiresAt,
    })
    const url = feedbackUrl(plainToken)
    logger.info('feedback request minted', {
      requestId: row.id,
      tenantId,
      formKey,
      formVersion: form.version,
    })

    const body: {
      requestId: string
      url: string
      expiresAt: string
      delivery?: DeliveryResult
    } = { requestId: row.id, url, expiresAt: expiresAt.toISOString() }

    if (channel === 'sms' && to) {
      const template = form.messageTemplate ?? 'We would value your feedback: {{url}}'
      const message = renderMessageTemplate(template, { url, subjectId: subject.id })
      body.delivery = await deliverSms(db, tenantId, to, message)
    }

    return c.json({ data: body }, 201)
  },
)

// ── GET /:id — status of a minted request (poll for the response) ─────────────
feedbackRequestsHandler.get('/:id', requirePermission(Actions.CreateFeedbackRequest), async (c) => {
  const id = c.req.param('id') ?? ''
  const repo = createFeedbackRequestRepository(c.get('db'))
  const row = await repo.findById(id)
  if (!row) return c.json({ error: 'Feedback request not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: toStatus(row) })
})
