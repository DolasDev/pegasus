// ---------------------------------------------------------------------------
// /api/v1/integration-projections — per-record cache of an external system's
// last-known state that running workflows maintain via the SDK
// (PegasusClient.get_projection / put_projection) and the integration validator
// reads back as the `prior` input for transition rules.
//
// Two surfaces share this handler + repository:
//
//   /runtime/...  — the workflow_runtime vnd_ key writes/reads the cache (actions
//   declared in the workflow manifest). WriteIntegrationProjection is granted to
//   workflow_runtime alone; a Cognito session is authorized away (403) on writes.
//
//   /integrations/:id/projections/...  — a READ-ONLY read-model surface for
//   consumers OUTSIDE a workflow (the tenant web app / an API key), so the
//   normalized entities a workflow lands in a projection (the sdk-feedback/0026
//   landing zone) can be read back and listed. ReadIntegrationProjection is now
//   also granted to the viewer persona, so a business user can query them.
//
//   GET    /runtime/:integrationId/:entityType/:entityKey   ReadIntegrationProjection
//   PUT    /runtime/:integrationId/:entityType/:entityKey   WriteIntegrationProjection  { state }
//   DELETE /runtime/:integrationId/:entityType/:entityKey   WriteIntegrationProjection
//   GET    /runtime/:integrationId/:entityType              ReadIntegrationProjection   (list)
//   GET    /integrations/:id/projections/:entityType        ReadIntegrationProjection   (list + filter/page)
//   GET    /integrations/:id/projections/:entityType/:key   ReadIntegrationProjection   (one)
//
// State is arbitrary JSON in the integration's NATIVE payload shape (identical
// to the validate `order`/`prior` body) and is capped in serialized size.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import {
  createIntegrationProjectionRepository,
  type IntegrationProjectionRow,
} from '../repositories/integration-projection.repository'
import { logger } from '../lib/logger'

/** Path-segment shape for integrationId / entityType / entityKey. */
const SEGMENT_RE = /^[A-Za-z0-9._:-]{1,256}$/
const SEGMENT_HELP = 'path segments must match [A-Za-z0-9._:-]{1,256}'

/** Cap on the serialized projection state (256 KB). */
const MAX_STATE_BYTES = 256 * 1024

const PutBody = z
  .object({
    // `state` is the external record's native payload; any defined JSON value.
    state: z.unknown(),
  })
  .strict()

function toResponse(row: IntegrationProjectionRow) {
  return {
    id: row.id,
    integrationId: row.integrationId,
    entityType: row.entityType,
    entityKey: row.entityKey,
    state: row.state,
    version: row.version,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Validate the three natural-key path segments; returns null on success. */
function badSegment(...segments: string[]): boolean {
  return segments.some((s) => !SEGMENT_RE.test(s))
}

export const integrationProjectionsHandler = new Hono<AppEnv>()

integrationProjectionsHandler.use('*', dualAuthMiddleware)

// GET /runtime/:integrationId/:entityType/:entityKey — read one projection.
integrationProjectionsHandler.get(
  '/runtime/:integrationId/:entityType/:entityKey',
  requirePermission(Actions.ReadIntegrationProjection),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    const entityKey = c.req.param('entityKey') ?? ''
    if (badSegment(integrationId, entityType, entityKey)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const repo = createIntegrationProjectionRepository(c.get('db'))
    const row = await repo.findByKey(integrationId, entityType, entityKey)
    if (!row) return c.json({ error: 'Projection not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toResponse(row) })
  },
)

// GET /runtime/:integrationId/:entityType — list all records for an entity type.
integrationProjectionsHandler.get(
  '/runtime/:integrationId/:entityType',
  requirePermission(Actions.ReadIntegrationProjection),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    if (badSegment(integrationId, entityType)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const repo = createIntegrationProjectionRepository(c.get('db'))
    const rows = await repo.list(integrationId, entityType)
    return c.json({ data: rows.map(toResponse) })
  },
)

// PUT /runtime/:integrationId/:entityType/:entityKey — upsert the cached state.
integrationProjectionsHandler.put(
  '/runtime/:integrationId/:entityType/:entityKey',
  requirePermission(Actions.WriteIntegrationProjection),
  validator('json', (value, c) => {
    const r = PutBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    if (!tenantId || !userId) {
      throw new DomainError('Authenticated tenant user required', 'UNAUTHENTICATED')
    }
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    const entityKey = c.req.param('entityKey') ?? ''
    if (badSegment(integrationId, entityType, entityKey)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }

    const { state } = c.req.valid('json')
    if (state === undefined) {
      return c.json({ error: 'state is required', code: 'VALIDATION_ERROR' }, 400)
    }
    if (Buffer.byteLength(JSON.stringify(state) ?? '', 'utf8') > MAX_STATE_BYTES) {
      return c.json({ error: 'state exceeds 256 KB', code: 'VALIDATION_ERROR' }, 413)
    }

    const repo = createIntegrationProjectionRepository(c.get('db'))
    const { row, created } = await repo.upsert({
      tenantId,
      integrationId,
      entityType,
      entityKey,
      state: state as object,
      updatedByUserId: userId,
    })
    logger.info('Integration projection upserted', {
      integrationId,
      entityType,
      entityKey,
      tenantId,
      version: row.version,
      created,
    })
    return c.json({ data: toResponse(row) }, created ? 201 : 200)
  },
)

// DELETE /runtime/:integrationId/:entityType/:entityKey — remove a projection.
integrationProjectionsHandler.delete(
  '/runtime/:integrationId/:entityType/:entityKey',
  requirePermission(Actions.WriteIntegrationProjection),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    const entityKey = c.req.param('entityKey') ?? ''
    if (badSegment(integrationId, entityType, entityKey)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const repo = createIntegrationProjectionRepository(c.get('db'))
    const count = await repo.deleteByKey(integrationId, entityType, entityKey)
    if (count === 0) return c.json({ error: 'Projection not found', code: 'NOT_FOUND' }, 404)
    return c.body(null, 204)
  },
)

// ---------------------------------------------------------------------------
// Non-workflow read-model surface (sdk-feedback/0026 Part 2). Mounted at the
// m2mV1 root so it lives under /api/v1/integrations/:id/projections/... — a
// read-only window for the tenant web app / an API key onto the entities a
// workflow landed in a projection, listable with a filter + keyset paging.
// dualAuth + ReadIntegrationProjection (now granted to viewer as well as
// workflow_runtime). Separate Hono instance so it can mount under /integrations.
// ---------------------------------------------------------------------------

/** Default / max page size for the read-model list. */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export const integrationProjectionReadHandler = new Hono<AppEnv>()

integrationProjectionReadHandler.use('*', dualAuthMiddleware)

// GET /integrations/:integrationId/projections/:entityType — list + filter/page.
integrationProjectionReadHandler.get(
  '/integrations/:integrationId/projections/:entityType',
  requirePermission(Actions.ReadIntegrationProjection),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    if (badSegment(integrationId, entityType)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }

    // Query params: ?status=&updatedSince=<ISO>&limit=&cursor=
    const status = c.req.query('status')
    const updatedSinceRaw = c.req.query('updatedSince')
    const cursor = c.req.query('cursor')
    const limitRaw = c.req.query('limit')

    let updatedSince: Date | undefined
    if (updatedSinceRaw !== undefined) {
      const d = new Date(updatedSinceRaw)
      if (Number.isNaN(d.getTime())) {
        return c.json(
          { error: 'updatedSince must be an ISO-8601 date', code: 'VALIDATION_ERROR' },
          400,
        )
      }
      updatedSince = d
    }

    let limit = DEFAULT_LIMIT
    if (limitRaw !== undefined) {
      const n = Number(limitRaw)
      if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        return c.json(
          { error: `limit must be an integer in 1..${MAX_LIMIT}`, code: 'VALIDATION_ERROR' },
          400,
        )
      }
      limit = n
    }

    const repo = createIntegrationProjectionRepository(c.get('db'))
    const rows = await repo.list(integrationId, entityType, {
      ...(status !== undefined ? { status } : {}),
      ...(updatedSince ? { updatedSince } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    })
    // Keyset paging: a full page implies there may be more — the next cursor is
    // the last entityKey seen. A short page is the end (nextCursor null).
    const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.entityKey ?? null) : null
    return c.json({ data: rows.map(toResponse), meta: { count: rows.length, nextCursor } })
  },
)

// GET /integrations/:integrationId/projections/:entityType/:entityKey — one record.
integrationProjectionReadHandler.get(
  '/integrations/:integrationId/projections/:entityType/:entityKey',
  requirePermission(Actions.ReadIntegrationProjection),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const entityType = c.req.param('entityType') ?? ''
    const entityKey = c.req.param('entityKey') ?? ''
    if (badSegment(integrationId, entityType, entityKey)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const repo = createIntegrationProjectionRepository(c.get('db'))
    const row = await repo.findByKey(integrationId, entityType, entityKey)
    if (!row) return c.json({ error: 'Projection not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toResponse(row) })
  },
)
