// ---------------------------------------------------------------------------
// /api/v1/email — platform email, delivered through the tenant's pegII API.
//
//   POST /send   SendEmail   { to, cc?, subject, body, bodyType?, dedupKey? }
//
// Policy lives in services/email/outbound.ts: recipients must be on the
// tenant's allowed-domain list (internal only), ≤ 10 recipients, ≤ 100 KB
// body, a per-tenant daily limit, and dedupKey idempotency like send_sms.
//
//   200 { data: { id, alreadySent: true } }    replay of an earlier send
//   202 { data: { id, alreadySent: false } }   accepted by the site's SMTP relay
//   400 VALIDATION_ERROR | RECIPIENT_NOT_ALLOWED | TOO_MANY_RECIPIENTS
//   409 EMAIL_RECIPIENTS_NOT_CONFIGURED | EMAIL_SEND_IN_PROGRESS |
//       EMAIL_SEND_IN_DOUBT | IDEMPOTENCY_KEY_REUSED
//   413 BODY_TOO_LARGE          429 EMAIL_DAILY_LIMIT
//   502/503 pegII failures (unreachable, auth, capability, SMTP)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { requirePermission } from '../middleware/rbac'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { sendTenantEmail } from '../services/email/outbound'
import { resolveEmailGateway } from '../gateways/pegii-email.gateway'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'

const address = z.string().trim().email()

const SendEmailBody = z
  .object({
    /** One address or a list. */
    to: z.union([address, z.array(address).min(1)]),
    cc: z.array(address).optional(),
    /** Header injection guard: no CR/LF. */
    subject: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((s) => !/[\r\n]/.test(s), 'subject must be a single line'),
    body: z.string().min(1),
    bodyType: z.enum(['text', 'html']).default('text'),
    dedupKey: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,200}$/, 'dedupKey must match [A-Za-z0-9._:-]{1,200}')
      .optional(),
  })
  .strict()

export const emailHandler = new Hono<AppEnv>()

emailHandler.use('*', dualAuthMiddleware)

emailHandler.post(
  '/send',
  requirePermission(Actions.SendEmail),
  validator('json', (value, c) => {
    const r = SendEmailBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    try {
      const result = await sendTenantEmail(
        db,
        tenantId,
        {
          to: Array.isArray(body.to) ? body.to : [body.to],
          cc: body.cc ?? [],
          subject: body.subject,
          body: body.body,
          bodyType: body.bodyType,
          ...(body.dedupKey !== undefined ? { dedupKey: body.dedupKey } : {}),
        },
        () => resolveEmailGateway(db, tenantId),
      )
      switch (result.kind) {
        case 'sent':
          return c.json(
            { data: { id: result.id, alreadySent: result.alreadySent } },
            result.alreadySent ? 200 : 202,
          )
        case 'not_configured':
          return c.json(
            {
              error:
                'No email recipient domains are configured for this tenant (Settings → App → Operations)',
              code: 'EMAIL_RECIPIENTS_NOT_CONFIGURED',
            },
            409,
          )
        case 'recipient_not_allowed':
          return c.json(
            {
              error: `Recipients outside the allowed domains: ${result.recipients.join(', ')}`,
              code: 'RECIPIENT_NOT_ALLOWED',
            },
            400,
          )
        case 'too_many_recipients':
          return c.json({ error: 'At most 10 recipients', code: 'TOO_MANY_RECIPIENTS' }, 400)
        case 'body_too_large':
          return c.json({ error: 'body exceeds 100 KB', code: 'BODY_TOO_LARGE' }, 413)
        case 'daily_limit':
          return c.json({ error: 'Daily email limit reached', code: 'EMAIL_DAILY_LIMIT' }, 429)
        case 'in_progress':
          return c.json(
            { error: 'A send with this dedupKey is in progress', code: 'EMAIL_SEND_IN_PROGRESS' },
            409,
          )
        case 'in_doubt':
          return c.json(
            {
              error:
                'A send with this dedupKey started but its outcome is unknown; it will not be resent automatically',
              code: 'EMAIL_SEND_IN_DOUBT',
            },
            409,
          )
        case 'key_reused':
          return c.json(
            {
              error: 'dedupKey was already used for a different email',
              code: 'IDEMPOTENCY_KEY_REUSED',
            },
            409,
          )
      }
    } catch (err) {
      if (err instanceof PegiiApiError) {
        // The site's own email errors keep their meaning rather than collapsing to a 502.
        if (err.upstreamCode === 'EMAIL_NOT_CONFIGURED') {
          return c.json(
            { error: 'The site has no SMTP account configured', code: 'EMAIL_NOT_CONFIGURED' },
            503,
          )
        }
        if (err.upstreamCode === 'EMAIL_SEND_FAILED') {
          return c.json({ error: err.message, code: 'EMAIL_SEND_FAILED' }, 502)
        }
        const mapped = pegiiApiErrorToHttp(err)
        return c.json({ error: mapped.message, code: mapped.code }, mapped.status)
      }
      throw err
    }
  },
)
