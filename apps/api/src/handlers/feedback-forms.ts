// ---------------------------------------------------------------------------
// Feedback forms — the tenant-authored, versioned survey definitions.
//
// The SDK/CLI authoring surface, mounted on the M2M v1 plane (vnd_ keys via
// dualAuthMiddleware, OR a Cognito session for the read-only SPA viewer) and
// RBAC-gated:
//   - ManageFeedbackForms — validate (dry-run), publish, rollback
//   - ReadFeedbackForms    — get active form, list, list versions
//
// Mirrors handlers/integration-validation/config.ts (append-only publish with
// supersede + version history + rollback) but with a far simpler gate: a form
// definition is a question list, validated by lib/feedback-form. There is no
// golden-corpus/gate pipeline — the "does a response satisfy this" contract is
// the compiled payload-schema the public endpoint enforces at submit time.
//
// The whole surface is gated by FEEDBACK_ENABLED — every route 404s when the
// feature is off, so the registry simply does not exist until ops flips it.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { isFeedbackEnabled } from '../lib/feedback-feature'
import { validateFormDefinition } from '../lib/feedback-form'
import {
  createFeedbackFormRepository,
  type FeedbackFormRow,
} from '../repositories/feedback-form.repository'
import { logger } from '../lib/logger'

/** Form-key slug — lowercase, dot/underscore/hyphen, ≤128 chars. */
const FORM_KEY_RE = /^[a-z][a-z0-9_.-]{0,127}$/

const PublishBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    // `definition` is validated structurally by validateFormDefinition; Zod only
    // guarantees it is an object here so the HTTP layer doesn't pre-judge shape.
    definition: z.record(z.string(), z.unknown()),
    messageTemplate: z.string().max(2000).nullable().optional(),
  })
  .strict()

function toFull(row: FeedbackFormRow) {
  return {
    id: row.id,
    formKey: row.formKey,
    version: row.version,
    status: row.status,
    title: row.title,
    definition: row.definition,
    messageTemplate: row.messageTemplate,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function toSummary(row: FeedbackFormRow) {
  return {
    id: row.id,
    formKey: row.formKey,
    version: row.version,
    status: row.status,
    title: row.title,
    publishedBy: row.publishedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export const feedbackFormsHandler = new Hono<AppEnv>()

feedbackFormsHandler.use('*', dualAuthMiddleware)

// Feature gate: the entire surface 404s when the master switch is off.
feedbackFormsHandler.use('*', async (c, next) => {
  if (!isFeedbackEnabled()) {
    return c.json({ error: 'Feedback is not enabled', code: 'NOT_FOUND' }, 404)
  }
  await next()
})

function validKey(formKey: string): boolean {
  return FORM_KEY_RE.test(formKey)
}

// ── POST /:formKey/validate — dry-run the definition, no write ────────────────
feedbackFormsHandler.post(
  '/:formKey/validate',
  requirePermission(Actions.ManageFeedbackForms),
  validator('json', (value, c) => {
    const r = PublishBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  (c) => {
    const formKey = c.req.param('formKey') ?? ''
    if (!validKey(formKey)) {
      return c.json({ error: 'formKey must be a slug', code: 'VALIDATION_ERROR' }, 400)
    }
    const { definition } = c.req.valid('json')
    const check = validateFormDefinition(definition)
    return c.json({ data: { valid: check.ok, errors: check.ok ? [] : check.errors } })
  },
)

// ── POST /:formKey — publish a new immutable version ──────────────────────────
feedbackFormsHandler.post(
  '/:formKey',
  requirePermission(Actions.ManageFeedbackForms),
  validator('json', (value, c) => {
    const r = PublishBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to publish a form', 'UNAUTHENTICATED')
    }
    const formKey = c.req.param('formKey') ?? ''
    if (!validKey(formKey)) {
      return c.json({ error: 'formKey must be a slug', code: 'VALIDATION_ERROR' }, 400)
    }
    const { title, definition, messageTemplate } = c.req.valid('json')

    const check = validateFormDefinition(definition)
    if (!check.ok) {
      return c.json(
        { error: `definition is invalid: ${check.errors.join('; ')}`, code: 'VALIDATION_ERROR' },
        400,
      )
    }

    const repo = createFeedbackFormRepository(c.get('db'))
    const row = await repo.publish({
      tenantId,
      formKey,
      title,
      definition: definition as Prisma.InputJsonValue,
      messageTemplate: messageTemplate ?? null,
      publishedBy: userId,
    })
    logger.info('feedback form published', { formKey, tenantId, version: row.version })
    return c.json({ data: toFull(row) }, 201)
  },
)

// ── GET / — list the tenant's active (latest PUBLISHED) forms ─────────────────
feedbackFormsHandler.get('/', requirePermission(Actions.ReadFeedbackForms), async (c) => {
  const repo = createFeedbackFormRepository(c.get('db'))
  const rows = await repo.listActive()
  return c.json({ data: rows.map(toSummary), meta: { count: rows.length } })
})

// ── GET /:formKey/versions — version history for a key ────────────────────────
feedbackFormsHandler.get(
  '/:formKey/versions',
  requirePermission(Actions.ReadFeedbackForms),
  async (c) => {
    const formKey = c.req.param('formKey') ?? ''
    const repo = createFeedbackFormRepository(c.get('db'))
    const rows = await repo.listVersions(formKey)
    return c.json({ data: rows.map(toSummary), meta: { count: rows.length } })
  },
)

// ── GET /:formKey — the active form for a key ─────────────────────────────────
feedbackFormsHandler.get('/:formKey', requirePermission(Actions.ReadFeedbackForms), async (c) => {
  const formKey = c.req.param('formKey') ?? ''
  const repo = createFeedbackFormRepository(c.get('db'))
  const row = await repo.findActive(formKey)
  if (!row) return c.json({ error: 'No published form', code: 'NOT_FOUND' }, 404)
  return c.json({ data: toFull(row) })
})

// ── POST /:formKey/rollback/:version — re-publish a prior version ─────────────
feedbackFormsHandler.post(
  '/:formKey/rollback/:version',
  requirePermission(Actions.ManageFeedbackForms),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to publish a form', 'UNAUTHENTICATED')
    }
    const formKey = c.req.param('formKey') ?? ''
    const version = Number.parseInt(c.req.param('version') ?? '', 10)
    if (!Number.isInteger(version) || version < 1) {
      return c.json({ error: 'Invalid version', code: 'VALIDATION_ERROR' }, 400)
    }

    const repo = createFeedbackFormRepository(c.get('db'))
    const source = await repo.findVersion(formKey, version)
    if (!source) return c.json({ error: `Version ${version} not found`, code: 'NOT_FOUND' }, 404)

    const row = await repo.publish({
      tenantId,
      formKey,
      title: source.title,
      definition: source.definition as Prisma.InputJsonValue,
      messageTemplate: source.messageTemplate,
      publishedBy: userId,
    })
    logger.info('feedback form rolled back', {
      formKey,
      tenantId,
      fromVersion: version,
      newVersion: row.version,
    })
    return c.json({ data: toFull(row) }, 201)
  },
)
