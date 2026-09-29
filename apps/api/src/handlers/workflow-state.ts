// ---------------------------------------------------------------------------
// /api/v1/workflow-state — tenant-wide key/value state for running workflows
// (PegasusClient.get/put/list/delete_workflow_state).
//
// It is not tied to a partner integration (contrast integration-projections), and
// its writes can be conditional, because a ledger shared by overlapping runs needs
// more than last-write-wins:
//
//   GET    /:namespace                ReadWorkflowState   list (prefix, updatedSince, limit, cursor)
//   GET    /:namespace/:key           ReadWorkflowState   one row; 404 on miss
//   PUT    /:namespace/:key           WriteWorkflowState  { state, ifAbsent?, expectedVersion? }
//   DELETE /:namespace/:key           WriteWorkflowState  ?expectedVersion=N
//
// PUT modes (mutually exclusive):
//   - ifAbsent: true      → insert only if the key is free: 201, or 409 STATE_EXISTS
//                            carrying the existing row. This is the atomic claim.
//   - expectedVersion: N  → compare-and-set: 200, or 409 STATE_VERSION_CONFLICT
//                            carrying the current row (null if the key is gone).
//   - neither             → unconditional upsert: 201 created / 200 overwritten.
// Every write bumps `version`, which is the token the next compare-and-set names.
//
// Keys and namespaces are single path segments ([A-Za-z0-9._:-]); compose
// hierarchical keys with ':' (e.g. `pulse:490317:pack`) and list them by prefix.
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
  createWorkflowStateRepository,
  type WorkflowStateRow,
} from '../repositories/workflow-state.repository'
import { logger } from '../lib/logger'

const SEGMENT_RE = /^[A-Za-z0-9._:-]{1,256}$/
const SEGMENT_HELP = 'namespace and key must match [A-Za-z0-9._:-]{1,256}'

/** Cap on the serialized state (256 KB), same as integration projections. */
const MAX_STATE_BYTES = 256 * 1024

const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

const PutBody = z
  .object({
    state: z.unknown(),
    ifAbsent: z.boolean().optional(),
    expectedVersion: z.number().int().min(1).optional(),
  })
  .strict()

const ListQuery = z.object({
  prefix: z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,256}$/)
    .optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
  cursor: z.string().regex(SEGMENT_RE).optional(),
})

const ExpectedVersionQuery = z.object({
  expectedVersion: z.coerce.number().int().min(1).optional(),
})

function toResponse(row: WorkflowStateRow) {
  return {
    namespace: row.namespace,
    key: row.key,
    state: row.state,
    version: row.version,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function params(c: { req: { param: (name: string) => string | undefined } }) {
  const namespace = c.req.param('namespace') ?? ''
  const key = c.req.param('key') ?? ''
  return { namespace, key }
}

export const workflowStateHandler = new Hono<AppEnv>()

workflowStateHandler.use('*', dualAuthMiddleware)

// GET /:namespace — keyset-paged list, ascending by key.
workflowStateHandler.get('/:namespace', requirePermission(Actions.ReadWorkflowState), async (c) => {
  const { namespace } = params(c)
  if (!SEGMENT_RE.test(namespace)) {
    return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
  }
  const q = ListQuery.safeParse(c.req.query())
  if (!q.success) return c.json({ error: q.error.message, code: 'VALIDATION_ERROR' }, 400)

  const limit = q.data.limit ?? DEFAULT_LIST_LIMIT
  const repo = createWorkflowStateRepository(c.get('db'))
  const rows = await repo.list(namespace, {
    limit,
    ...(q.data.prefix ? { prefix: q.data.prefix } : {}),
    ...(q.data.cursor ? { cursor: q.data.cursor } : {}),
    ...(q.data.updatedSince ? { updatedSince: new Date(q.data.updatedSince) } : {}),
  })
  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.key : null
  return c.json({ data: rows.map(toResponse), nextCursor })
})

// GET /:namespace/:key — one row.
workflowStateHandler.get(
  '/:namespace/:key',
  requirePermission(Actions.ReadWorkflowState),
  async (c) => {
    const { namespace, key } = params(c)
    if (!SEGMENT_RE.test(namespace) || !SEGMENT_RE.test(key)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const row = await createWorkflowStateRepository(c.get('db')).find(namespace, key)
    if (!row) return c.json({ error: 'Workflow state not found', code: 'NOT_FOUND' }, 404)
    return c.json({ data: toResponse(row) })
  },
)

// PUT /:namespace/:key — claim, compare-and-set, or unconditional upsert.
workflowStateHandler.put(
  '/:namespace/:key',
  requirePermission(Actions.WriteWorkflowState),
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
    const { namespace, key } = params(c)
    if (!SEGMENT_RE.test(namespace) || !SEGMENT_RE.test(key)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const { state, ifAbsent, expectedVersion } = c.req.valid('json')
    if (state === undefined) {
      return c.json({ error: 'state is required', code: 'VALIDATION_ERROR' }, 400)
    }
    if (ifAbsent && expectedVersion !== undefined) {
      return c.json(
        { error: 'ifAbsent and expectedVersion are mutually exclusive', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    if (Buffer.byteLength(JSON.stringify(state) ?? '', 'utf8') > MAX_STATE_BYTES) {
      return c.json({ error: 'state exceeds 256 KB', code: 'VALIDATION_ERROR' }, 413)
    }

    const repo = createWorkflowStateRepository(c.get('db'))
    const input = { tenantId, namespace, key, state: state as object, updatedByUserId: userId }

    if (ifAbsent) {
      const result = await repo.claim(input)
      if (result.outcome === 'exists') {
        return c.json(
          {
            error: `workflow state ${namespace}/${key} already exists`,
            code: 'STATE_EXISTS',
            data: { current: toResponse(result.current) },
          },
          409,
        )
      }
      logger.info('Workflow state claimed', { tenantId, namespace, key })
      return c.json({ data: toResponse(result.row), created: true }, 201)
    }

    if (expectedVersion !== undefined) {
      const result = await repo.compareAndSet({ ...input, expectedVersion })
      if (result.outcome === 'conflict') {
        return c.json(
          {
            error: `workflow state ${namespace}/${key} is not at version ${expectedVersion}`,
            code: 'STATE_VERSION_CONFLICT',
            data: { current: result.current ? toResponse(result.current) : null },
          },
          409,
        )
      }
      return c.json({ data: toResponse(result.row), created: false })
    }

    const { row, created } = await repo.put(input)
    return c.json({ data: toResponse(row), created }, created ? 201 : 200)
  },
)

// DELETE /:namespace/:key — optionally guarded by ?expectedVersion=N.
workflowStateHandler.delete(
  '/:namespace/:key',
  requirePermission(Actions.WriteWorkflowState),
  async (c) => {
    const { namespace, key } = params(c)
    if (!SEGMENT_RE.test(namespace) || !SEGMENT_RE.test(key)) {
      return c.json({ error: SEGMENT_HELP, code: 'VALIDATION_ERROR' }, 400)
    }
    const q = ExpectedVersionQuery.safeParse(c.req.query())
    if (!q.success) return c.json({ error: q.error.message, code: 'VALIDATION_ERROR' }, 400)

    const result = await createWorkflowStateRepository(c.get('db')).remove(
      namespace,
      key,
      q.data.expectedVersion,
    )
    if (result.outcome === 'not_found') {
      return c.json({ error: 'Workflow state not found', code: 'NOT_FOUND' }, 404)
    }
    if (result.outcome === 'conflict') {
      return c.json(
        {
          error: `workflow state ${namespace}/${key} is not at version ${q.data.expectedVersion}`,
          code: 'STATE_VERSION_CONFLICT',
          data: { current: toResponse(result.current) },
        },
        409,
      )
    }
    return c.body(null, 204)
  },
)
