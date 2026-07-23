// ---------------------------------------------------------------------------
// Public feedback endpoint — where a customer/driver opens the capability link
// and submits a response. Mounted PRE-TENANT (no session): the caller carries
// only the opaque token in the path, and the tenant is resolved FROM the token.
// Uses the root `db` (cross-tenant), exactly like the ingress endpoint.
//
//   GET  /feedback/:token  — return the pinned form definition to render. Leaks
//     NO subject PII: only { status, title, definition }. Status distinguishes
//     pending / submitted / expired so the SPA can render the right state.
//
//   POST /feedback/:token  — validate the response against the compiled payload-
//     schema, record it (single-submit at the DB level), and emit the built-in
//     `feedback.submitted` DomainEvent in ONE transaction. The ordinary trigger
//     dispatcher then fires the tenant's workflow — no new dispatch path.
//
// Token-in-path with no cookies/session ⇒ not CSRF-susceptible. The whole
// surface is gated by FEEDBACK_ENABLED (404 when off).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { db as rootDb } from '../db'
import { logger } from '../lib/logger'
import { tokenPrefixOf, tokenMatches } from '../lib/opaque-token'
import { isFeedbackEnabled } from '../lib/feedback-feature'
import { compileResponseSchema } from '../lib/feedback-form'
import { validatePayload } from '../lib/payload-schema-validator'
import { emitDomainEvent } from '../lib/domain-events'
import { createFeedbackFormRepository } from '../repositories/feedback-form.repository'
import {
  createFeedbackRequestRepository,
  type FeedbackRequestAuthRow,
} from '../repositories/feedback-request.repository'

export const feedbackPublicHandler = new Hono<AppEnv>()

feedbackPublicHandler.use('*', async (c, next) => {
  if (!isFeedbackEnabled()) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  }
  await next()
})

/** Resolve a presented token to its request row via prefix lookup + hash compare. */
async function resolveRequest(token: string): Promise<FeedbackRequestAuthRow | null> {
  const repo = createFeedbackRequestRepository(rootDb)
  const rows = await repo.findByTokenPrefix(tokenPrefixOf(token))
  for (const row of rows) {
    if (tokenMatches(token, row.tokenHash)) return row
  }
  return null
}

/** Derived respondent-facing status: SUBMITTED wins, then expiry, else pending. */
function derivedStatus(row: FeedbackRequestAuthRow): 'pending' | 'submitted' | 'expired' {
  if (row.status === 'SUBMITTED') return 'submitted'
  if (row.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'pending'
}

// ── GET /feedback/:token — the form to render (no PII) ────────────────────────
feedbackPublicHandler.get('/feedback/:token', async (c) => {
  const token = c.req.param('token') ?? ''
  const req = await resolveRequest(token)
  if (!req) return c.json({ error: 'Invalid or expired link', code: 'NOT_FOUND' }, 404)

  const status = derivedStatus(req)
  const form = await createFeedbackFormRepository(rootDb).findVersionForTenant(
    req.tenantId,
    req.formKey,
    req.formVersion,
  )
  if (!form) {
    // The pinned version was hard-deleted — nothing renderable.
    return c.json({ error: 'This form is no longer available', code: 'NOT_FOUND' }, 404)
  }

  return c.json({
    data: {
      status,
      title: form.title,
      definition: form.definition,
    },
  })
})

// ── POST /feedback/:token — submit a response ─────────────────────────────────
feedbackPublicHandler.post('/feedback/:token', async (c) => {
  const token = c.req.param('token') ?? ''
  const req = await resolveRequest(token)
  if (!req) return c.json({ error: 'Invalid or expired link', code: 'NOT_FOUND' }, 404)

  if (req.status === 'SUBMITTED') {
    return c.json({ error: 'This feedback was already submitted', code: 'ALREADY_SUBMITTED' }, 409)
  }
  if (req.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: 'This link has expired', code: 'EXPIRED' }, 410)
  }

  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ error: 'Malformed request body', code: 'VALIDATION_ERROR' }, 400)
  }
  const response = (payload as { response?: unknown } | null)?.response ?? payload

  const form = await createFeedbackFormRepository(rootDb).findVersionForTenant(
    req.tenantId,
    req.formKey,
    req.formVersion,
  )
  if (!form) {
    return c.json({ error: 'This form is no longer available', code: 'NOT_FOUND' }, 404)
  }

  const schema = compileResponseSchema(form.definition)
  const check = validatePayload(schema, response)
  if (!check.ok) {
    return c.json(
      { error: `response is invalid: ${check.errors.join('; ')}`, code: 'VALIDATION_ERROR' },
      400,
    )
  }

  // Record + emit atomically. recordSubmission only matches a still-PENDING row,
  // so a concurrent double-submit flips exactly one; the loser emits nothing.
  let recorded = false
  await rootDb.$transaction(async (tx) => {
    const repo = createFeedbackRequestRepository(tx as typeof rootDb)
    recorded = await repo.recordSubmission(req.id, response as object)
    if (!recorded) return
    await emitDomainEvent(tx, {
      tenantId: req.tenantId,
      eventType: 'feedback.submitted',
      payload: {
        requestId: req.id,
        formKey: req.formKey,
        subject: { type: req.subjectType, id: req.subjectId },
        response,
      },
    })
  })

  if (!recorded) {
    // Lost the single-submit race — another submit landed first.
    return c.json({ error: 'This feedback was already submitted', code: 'ALREADY_SUBMITTED' }, 409)
  }

  logger.info('feedback response recorded', {
    requestId: req.id,
    tenantId: req.tenantId,
    formKey: req.formKey,
  })
  return c.json({ data: { status: 'submitted' } }, 201)
})
