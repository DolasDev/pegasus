// ---------------------------------------------------------------------------
// Event-types handler — the tenant custom-event registry.
//
// CRUD over TenantEventType rows: a tenant defines named event types its
// workflows can trigger on, beyond the built-in DOMAIN_EVENT_TYPES taxonomy.
// Mounted under /api/v1/event-types with dualAuthMiddleware (Cognito session
// for the SPA OR a vnd_ M2M key), exactly like /workflows. Per-route
// authorization is requirePermission(ManageEventTypes).
//
// The emit endpoint (POST /:name/emit) lives in Unit 7; this unit is the
// registry surface only.
//
// Guards enforced here (the repository is a raw writer):
//   - name is a slug AND not a reserved built-in event name.
//   - payloadSchema, when present, is a supported JSON-Schema subset.
//   - domainCondition.sourceEventType is a BUILT-IN event name (never a custom
//     one — this is what makes derivation cycles impossible) and its optional
//     filter is a valid event-filter expression.
//
// The whole surface is gated by CUSTOM_EVENTS_ENABLED — every route 404s when
// the feature is off, so the registry simply does not exist until ops flips it.
//
// DELETE is a hard delete. Triggers still subscribed to a deleted name are left
// intact; they simply never match a new event again (no cascade) — documented
// so a tenant isn't surprised that removing a type silently quiesces a trigger.
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
import { DOMAIN_EVENT_TYPES } from '../lib/domain-events'
import { validateFilterExpr } from '../lib/event-filter'
import { validatePayloadSchema } from '../lib/payload-schema-validator'
import { isCustomEventsEnabled } from '../lib/custom-events-feature'
import {
  createTenantEventTypeRepository,
  type TenantEventTypeRow,
} from '../repositories/tenant-event-type.repository'
import { logger } from '../lib/logger'

const DOMAIN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(DOMAIN_EVENT_TYPES)

/** Custom event-name slug — lowercase, dot/underscore/hyphen, ≤128 chars. */
const EVENT_NAME_RE = /^[a-z][a-z0-9_.-]{0,127}$/

const CreateBody = z
  .object({
    name: z.string(),
    description: z.string().max(1000).optional(),
    payloadSchema: z.record(z.string(), z.unknown()).optional(),
    domainCondition: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const UpdateBody = z
  .object({
    description: z.string().max(1000).nullable().optional(),
    payloadSchema: z.record(z.string(), z.unknown()).nullable().optional(),
    domainCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

function toResponse(row: TenantEventTypeRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    payloadSchema: row.payloadSchema,
    domainCondition: row.domainCondition,
    enabled: row.enabled,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Validate a domainCondition object. Returns an error string or null. */
function validateDomainCondition(condition: Record<string, unknown>): string | null {
  const allowed = new Set(['sourceEventType', 'filter'])
  for (const k of Object.keys(condition)) {
    if (!allowed.has(k)) return `domainCondition has unexpected key "${k}"`
  }
  const source = condition['sourceEventType']
  if (typeof source !== 'string' || !DOMAIN_EVENT_TYPE_SET.has(source)) {
    return `domainCondition.sourceEventType must be a built-in event type: ${DOMAIN_EVENT_TYPES.join(', ')}`
  }
  if (condition['filter'] !== undefined) {
    const r = validateFilterExpr(condition['filter'])
    if (!r.ok) return `domainCondition.filter is invalid: ${r.error}`
  }
  return null
}

export const eventTypesHandler = new Hono<AppEnv>()

eventTypesHandler.use('*', dualAuthMiddleware)

// Feature gate: the entire registry surface 404s when the master switch is off.
eventTypesHandler.use('*', async (c, next) => {
  if (!isCustomEventsEnabled()) {
    return c.json({ error: 'Custom events are not enabled', code: 'NOT_FOUND' }, 404)
  }
  await next()
})

// ── POST / — register a custom event type ─────────────────────────────────────
eventTypesHandler.post(
  '/',
  requirePermission(Actions.ManageEventTypes),
  validator('json', (value, c) => {
    const r = CreateBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!userId) {
      throw new DomainError('Authenticated user required to manage event types', 'UNAUTHENTICATED')
    }
    const body = c.req.valid('json')

    if (!EVENT_NAME_RE.test(body.name)) {
      return c.json(
        {
          error: 'name must be a lowercase slug ([a-z][a-z0-9_.-]{0,127})',
          code: 'VALIDATION_ERROR',
        },
        400,
      )
    }
    if (DOMAIN_EVENT_TYPE_SET.has(body.name)) {
      return c.json(
        { error: `"${body.name}" is a reserved built-in event type`, code: 'VALIDATION_ERROR' },
        400,
      )
    }
    if (body.payloadSchema) {
      const r = validatePayloadSchema(body.payloadSchema)
      if (!r.ok) {
        return c.json(
          { error: `payloadSchema is invalid: ${r.errors.join('; ')}`, code: 'VALIDATION_ERROR' },
          400,
        )
      }
    }
    if (body.domainCondition) {
      const err = validateDomainCondition(body.domainCondition)
      if (err) return c.json({ error: err, code: 'VALIDATION_ERROR' }, 400)
    }

    const repo = createTenantEventTypeRepository(c.get('db'))
    try {
      const row = await repo.create({
        tenantId,
        name: body.name,
        description: body.description ?? null,
        ...(body.payloadSchema
          ? { payloadSchema: body.payloadSchema as Prisma.InputJsonValue }
          : {}),
        ...(body.domainCondition
          ? { domainCondition: body.domainCondition as Prisma.InputJsonValue }
          : {}),
        enabled: body.enabled ?? true,
        createdByUserId: userId,
      })
      logger.info('Custom event type created', { id: row.id, name: row.name, tenantId })
      return c.json({ data: toResponse(row) }, 201)
    } catch (err) {
      if (String(err).includes('Unique constraint')) {
        return c.json(
          { error: `An event type named "${body.name}" already exists`, code: 'CONFLICT' },
          409,
        )
      }
      throw err
    }
  },
)

// ── GET / — list the tenant's custom event types ──────────────────────────────
eventTypesHandler.get('/', requirePermission(Actions.ManageEventTypes), async (c) => {
  const enabledParam = c.req.query('enabled')
  const repo = createTenantEventTypeRepository(c.get('db'))
  const rows = await repo.list(
    enabledParam === undefined ? {} : { enabled: enabledParam === 'true' },
  )
  return c.json({ data: rows.map(toResponse) })
})

// ── GET /:name — fetch one by name ────────────────────────────────────────────
eventTypesHandler.get('/:name', requirePermission(Actions.ManageEventTypes), async (c) => {
  const repo = createTenantEventTypeRepository(c.get('db'))
  const row = await repo.findByName(c.req.param('name') ?? '')
  if (!row) return c.json({ error: 'Event type not found', code: 'NOT_FOUND' }, 404)
  return c.json({ data: toResponse(row) })
})

// ── PATCH /:name — update description/schema/condition/enabled ─────────────────
eventTypesHandler.patch(
  '/:name',
  requirePermission(Actions.ManageEventTypes),
  validator('json', (value, c) => {
    const r = UpdateBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const body = c.req.valid('json')
    const repo = createTenantEventTypeRepository(c.get('db'))
    const existing = await repo.findByName(c.req.param('name') ?? '')
    if (!existing) return c.json({ error: 'Event type not found', code: 'NOT_FOUND' }, 404)

    if (body.payloadSchema) {
      const r = validatePayloadSchema(body.payloadSchema)
      if (!r.ok) {
        return c.json(
          { error: `payloadSchema is invalid: ${r.errors.join('; ')}`, code: 'VALIDATION_ERROR' },
          400,
        )
      }
    }
    if (body.domainCondition) {
      const err = validateDomainCondition(body.domainCondition)
      if (err) return c.json({ error: err, code: 'VALIDATION_ERROR' }, 400)
    }

    const row = await repo.update(existing.id, {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.payloadSchema !== undefined
        ? { payloadSchema: body.payloadSchema as Prisma.InputJsonValue | null }
        : {}),
      ...(body.domainCondition !== undefined
        ? { domainCondition: body.domainCondition as Prisma.InputJsonValue | null }
        : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    })
    logger.info('Custom event type updated', { id: row.id, name: row.name })
    return c.json({ data: toResponse(row) })
  },
)

// ── DELETE /:name — hard delete (subscribed triggers are left intact) ─────────
eventTypesHandler.delete('/:name', requirePermission(Actions.ManageEventTypes), async (c) => {
  const repo = createTenantEventTypeRepository(c.get('db'))
  const existing = await repo.findByName(c.req.param('name') ?? '')
  if (!existing) return c.json({ error: 'Event type not found', code: 'NOT_FOUND' }, 404)
  await repo.deleteById(existing.id)
  logger.info('Custom event type deleted', { id: existing.id, name: existing.name })
  return c.body(null, 204)
})
