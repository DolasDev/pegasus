// ---------------------------------------------------------------------------
// /api/v1/sms — outbound SMS, inbound message reads and opt-out state.
//
//   POST /send                    SendSms          { to, body, dedupKey? }
//   GET  /messages/:id            ReadTextMessage  one captured message (cloud buffer)
//   POST /messages/:id/read       UpdateTextMessage mark it read at RingCentral
//   GET  /opt-outs/:phoneE164     ReadSmsOptOut    opt-out state for a number
//   POST /opt-outs                ManageSmsOptOut  { phone, optedOut?, source? }
//
// /send goes through services/sms/outbound.ts, so opt-out and dedup policy hold
// for every platform text. Failure modes of /send:
//   400 VALIDATION_ERROR       — invalid E.164 `to`, body out of range, bad key
//   403 Forbidden              — Cedar denies (no SendSms permission)
//   404 NOT_FOUND              — tenant has no active RingCentral connection
//   409 SMS_OPTED_OUT          — the recipient opted out (keyword or provider)
//   409 SMS_SEND_IN_PROGRESS   — same dedupKey is mid-send; retry later
//   409 SMS_SEND_IN_DOUBT      — same dedupKey stuck PENDING; outcome unknown
//   409 IDEMPOTENCY_KEY_REUSED — same dedupKey, different recipient or body
//   429                        — RingCentral rate limit hit
//   502 UPSTREAM_ERROR         — RingCentral OAuth/API error
//   503                        — RingCentral integration disabled platform-wide
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { isValidE164 } from '@pegasus/domain'
import { requirePermission } from '../middleware/rbac'
import { meterUsage } from '../middleware/meter-usage'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { RingCentralOAuthError } from '../services/ringcentral/oauth'
import { RateLimitError } from '../services/ringcentral/client'
import { sendTenantSms } from '../services/sms/outbound'
import { createSmsOptOutRepository } from '../repositories/sms-opt-out.repository'
import { listConnectionsByTenant } from '../repositories/messaging.repository'
import { readOAuthConfig } from '../services/ringcentral/oauth'
import { setMessageReadStatus } from '../services/ringcentral/message-store'

const SendSmsBody = z.object({
  /** Destination phone number in E.164 format (e.g. +15005550006). */
  to: z.string().refine(isValidE164, 'must be a valid E.164 phone number'),
  /** Message text (1..1000 characters, trimmed). */
  body: z.string().trim().min(1).max(1000),
  /**
   * Optional idempotency key: a retry with the same key returns the first send
   * (`alreadySent: true`) instead of texting the recipient again.
   */
  dedupKey: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,200}$/, 'dedupKey must match [A-Za-z0-9._:-]{1,200}')
    .optional(),
})

const RecordOptOutBody = z
  .object({
    phone: z.string().refine(isValidE164, 'must be a valid E.164 phone number'),
    /** false records an opt-IN (the customer asked to resume texts). */
    optedOut: z.boolean().default(true),
    source: z.enum(['MANUAL', 'KEYWORD']).default('MANUAL'),
  })
  .strict()

export const smsHandler = new Hono<AppEnv>()

// Authenticate every SMS route through dualAuthMiddleware so the workflow
// runtime's `vnd_` key (the workflow_runtime service account, holding SendSms)
// is accepted — the same pattern as workflowsHandler / eventTypesHandler. This
// handler is mounted on the m2mV1 router (app.ts), which has no wildcard auth,
// so the middleware must be applied here. Previously the route lived on the
// Cognito-JWT-only `v1` router and every workflow `send_sms` got 401.
smsHandler.use('*', dualAuthMiddleware)

// ---------------------------------------------------------------------------
// POST /send — fire an outbound SMS via the tenant's RingCentral connection.
//
// Response: { data: { id, status } }  (202 Accepted)
//           { error, code: VALIDATION_ERROR } (400)
//           { error, code: NOT_FOUND }        (404) — no active connection
//           { error }                         (429) — rate limited
//           { error, code: UPSTREAM_ERROR }   (502) — permanent RC error
//           { error }                         (503) — integration disabled
// ---------------------------------------------------------------------------
smsHandler.post(
  '/send',
  requirePermission(Actions.SendSms),
  meterUsage(Actions.SendSms),
  validator('json', (value, c) => {
    const r = SendSmsBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { to, body, dedupKey } = c.req.valid('json')
    try {
      const result = await sendTenantSms(c.get('db'), c.get('tenantId'), {
        to,
        body,
        ...(dedupKey !== undefined ? { dedupKey } : {}),
      })
      switch (result.kind) {
        case 'sent':
          return c.json(
            { data: { id: result.id, status: result.status, alreadySent: result.alreadySent } },
            result.alreadySent ? 200 : 202,
          )
        case 'disabled':
          return c.json(
            { error: 'RingCentral integration is not enabled', code: 'SERVICE_UNAVAILABLE' },
            503,
          )
        case 'no_connection':
          return c.json(
            { error: 'RingCentral is not connected for this account', code: 'NOT_FOUND' },
            404,
          )
        case 'opted_out':
          return c.json(
            { error: 'The recipient has opted out of texts', code: 'SMS_OPTED_OUT' },
            409,
          )
        case 'in_progress':
          return c.json(
            { error: 'A send with this dedupKey is in progress', code: 'SMS_SEND_IN_PROGRESS' },
            409,
          )
        case 'in_doubt':
          return c.json(
            {
              error:
                'A send with this dedupKey started but its outcome is unknown; it will not be resent automatically',
              code: 'SMS_SEND_IN_DOUBT',
            },
            409,
          )
        case 'key_reused':
          return c.json(
            {
              error: 'dedupKey was already used for a different recipient or body',
              code: 'IDEMPOTENCY_KEY_REUSED',
            },
            409,
          )
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Forward the Retry-After value as a standard HTTP header so clients
        // can implement correct backoff without parsing the message string.
        const retryAfterSec = Math.ceil(err.retryAfterMs / 1000)
        return c.json({ error: err.message }, 429, {
          'Retry-After': String(retryAfterSec),
        })
      }
      if (err instanceof RingCentralOAuthError) {
        // Permanent or transient, the problem is upstream: 502 either way.
        return c.json({ error: err.message, code: 'UPSTREAM_ERROR' }, 502)
      }
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// GET /messages/:id — one captured message from the cloud buffer, by the
// `messageId` an `sms.received` event carries. The body is purged 72h after the
// message is forwarded on-prem (`bodyPurged: true`); read it promptly. Read
// state and order/coordinator links live on-prem, not here.
// ---------------------------------------------------------------------------
smsHandler.get('/messages/:id', requirePermission(Actions.ReadTextMessage), async (c) => {
  const id = c.req.param('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: 'id must be a message uuid', code: 'VALIDATION_ERROR' }, 400)
  }
  const row = await c.get('db').message.findFirst({ where: { id } })
  if (!row) return c.json({ error: 'Message not found', code: 'NOT_FOUND' }, 404)
  return c.json({
    data: {
      id: row.id,
      source: row.source,
      externalId: row.externalId,
      threadId: row.threadId,
      direction: row.direction,
      fromNumber: row.fromNumber,
      toNumber: row.toNumber,
      body: row.body,
      bodyPurged: row.bodyPurgedAt != null,
      createdAt: row.rcCreationTime.toISOString(),
      capturedAt: row.capturedAt.toISOString(),
    },
  })
})

// ---------------------------------------------------------------------------
// POST /messages/:id/read — mark a captured inbound text read AT RINGCENTRAL.
//
// RingCentral owns read state: the legacy desktop copies it into its own store
// on every reconciliation and marks read by writing here first, so this is the
// write that clears the unread badge coordinators see. Idempotent — an already
// read message reports `alreadyRead: true` and costs no write.
//
//   200 { data: { id, readStatus: 'Read', alreadyRead } }
//   404 NOT_FOUND            unknown message id (or RingCentral no longer has it)
//   409 UNSUPPORTED_SOURCE   a thread-store message (not addressable here)
//   409 NO_CONNECTION        the tenant has no active RingCentral connection
//   429 / 502 / 503          as for /send
// ---------------------------------------------------------------------------
smsHandler.post(
  '/messages/:id/read',
  requirePermission(Actions.UpdateTextMessage),
  meterUsage(Actions.UpdateTextMessage),
  async (c) => {
    const id = c.req.param('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return c.json({ error: 'id must be a message uuid', code: 'VALIDATION_ERROR' }, 400)
    }
    if (!readOAuthConfig()) {
      return c.json(
        { error: 'RingCentral integration is not enabled', code: 'SERVICE_UNAVAILABLE' },
        503,
      )
    }
    const db = c.get('db')
    const message = await db.message.findFirst({ where: { id } })
    if (!message) return c.json({ error: 'Message not found', code: 'NOT_FOUND' }, 404)
    if (message.source !== 'V1_STORE') {
      return c.json(
        {
          error: 'Only RingCentral message-store messages can be marked read',
          code: 'UNSUPPORTED_SOURCE',
        },
        409,
      )
    }

    // Prefer the connection that captured the message; any active one otherwise.
    const active = (await listConnectionsByTenant(db, c.get('tenantId'))).filter(
      (conn) => conn.tokenStatus === 'ACTIVE' && conn.tokenSecretArn != null,
    )
    const connection = active.find((conn) => conn.id === message.connectionId) ?? active[0]
    if (!connection) {
      return c.json(
        { error: 'RingCentral is not connected for this account', code: 'NO_CONNECTION' },
        409,
      )
    }

    try {
      const result = await setMessageReadStatus(connection, message.externalId, 'Read')
      return c.json({
        data: { id, readStatus: result.readStatus, alreadyRead: !result.changed },
      })
    } catch (err) {
      if (err instanceof RateLimitError) {
        return c.json({ error: err.message }, 429, {
          'Retry-After': String(Math.ceil(err.retryAfterMs / 1000)),
        })
      }
      if (err instanceof RingCentralOAuthError && err.status === 404) {
        return c.json({ error: 'RingCentral has no such message', code: 'NOT_FOUND' }, 404)
      }
      if (err instanceof RingCentralOAuthError) {
        return c.json({ error: err.message, code: 'UPSTREAM_ERROR' }, 502)
      }
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// GET /opt-outs/:phoneE164 — opt-out state for one number. A number with no
// record has never opted out: { optedOut: false, source: null }.
// ---------------------------------------------------------------------------
smsHandler.get('/opt-outs/:phone', requirePermission(Actions.ReadSmsOptOut), async (c) => {
  const phone = c.req.param('phone') ?? ''
  if (!isValidE164(phone)) {
    return c.json({ error: 'phone must be a valid E.164 number', code: 'VALIDATION_ERROR' }, 400)
  }
  const row = await createSmsOptOutRepository(c.get('db')).find(c.get('tenantId'), phone)
  return c.json({
    data: row
      ? {
          phone: row.phoneE164,
          optedOut: row.optedOut,
          source: row.source,
          keyword: row.keyword,
          updatedAt: row.effectiveAt.toISOString(),
        }
      : { phone, optedOut: false, source: null, keyword: null, updatedAt: null },
  })
})

// ---------------------------------------------------------------------------
// POST /opt-outs — record an opt-out (or, with optedOut:false, an opt-in) for a
// number. Takes effect now, so it overrides any earlier keyword. Idempotent.
// ---------------------------------------------------------------------------
smsHandler.post(
  '/opt-outs',
  requirePermission(Actions.ManageSmsOptOut),
  validator('json', (value, c) => {
    const r = RecordOptOutBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const { phone, optedOut, source } = c.req.valid('json')
    const repo = createSmsOptOutRepository(c.get('db'))
    await repo.record({ tenantId, phoneE164: phone, optedOut, source, effectiveAt: new Date() })
    const row = await repo.find(tenantId, phone)
    return c.json({
      data: {
        phone,
        optedOut: row?.optedOut ?? optedOut,
        source: row?.source ?? source,
        keyword: row?.keyword ?? null,
        updatedAt: (row?.effectiveAt ?? new Date()).toISOString(),
      },
    })
  },
)
