// ---------------------------------------------------------------------------
// /api/v1/sms — outbound SMS via RingCentral.
//
// POST /send fires an outbound SMS using the tenant's active RingCentral
// connection. The caller (typically the Python SDK `send_sms` method) must
// hold the `SendSms` Cedar action (granted to workflow_runtime).
//
// Failure modes:
//   400 VALIDATION_ERROR   — invalid E.164 `to` or body out of range
//   403 Forbidden          — Cedar denies (no SendSms permission)
//   404 NOT_FOUND          — tenant has no active RingCentral connection
//   429                    — RingCentral rate limit hit
//   502 UPSTREAM_ERROR     — permanent RingCentral OAuth/API error
//   503                    — RingCentral integration disabled platform-wide
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { isValidE164 } from '@pegasus/domain'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { readOAuthConfig, RingCentralOAuthError } from '../services/ringcentral/oauth'
import { RateLimitError } from '../services/ringcentral/client'
import { sendSms } from '../services/ringcentral/sms'
import { listConnectionsByTenant } from '../repositories/messaging.repository'

const SendSmsBody = z.object({
  /** Destination phone number in E.164 format (e.g. +15005550006). */
  to: z.string().refine(isValidE164, 'must be a valid E.164 phone number'),
  /** Message text (1..1000 characters, trimmed). */
  body: z.string().trim().min(1).max(1000),
})

export const smsHandler = new Hono<AppEnv>()

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
  validator('json', (value, c) => {
    const r = SendSmsBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    // Platform-wide integration gate — mirrors the connect endpoint's pattern.
    const oauthConfig = readOAuthConfig()
    if (!oauthConfig) {
      return c.json(
        { error: 'RingCentral integration is not enabled', code: 'SERVICE_UNAVAILABLE' },
        503,
      )
    }

    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const { to, body } = c.req.valid('json')

    // Resolve the tenant's active connection.
    const connections = await listConnectionsByTenant(db, tenantId)
    const connection = connections.find(
      (conn) => conn.tokenStatus === 'ACTIVE' && conn.tokenSecretArn != null,
    )
    if (!connection) {
      return c.json(
        { error: 'RingCentral is not connected for this account', code: 'NOT_FOUND' },
        404,
      )
    }

    // Send — propagate RateLimitError and permanent RingCentralOAuthError;
    // let unexpected errors bubble to the app error handler.
    try {
      const result = await sendSms(connection, to, body)
      return c.json(
        {
          data: {
            id: result.id,
            status: result.messageStatus,
          },
        },
        202,
      )
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Forward the Retry-After value as a standard HTTP header so clients
        // can implement correct backoff without parsing the message string.
        const retryAfterSec = Math.ceil(err.retryAfterMs / 1000)
        return c.json({ error: err.message }, 429, {
          'Retry-After': String(retryAfterSec),
        })
      }
      if (err instanceof RingCentralOAuthError && err.isPermanent) {
        return c.json({ error: err.message, code: 'UPSTREAM_ERROR' }, 502)
      }
      if (err instanceof RingCentralOAuthError) {
        // Transient RC error (5xx / network). Surface as 502 so callers know
        // the problem is upstream and the request may succeed on retry.
        return c.json({ error: err.message, code: 'UPSTREAM_ERROR' }, 502)
      }
      throw err
    }
  },
)
