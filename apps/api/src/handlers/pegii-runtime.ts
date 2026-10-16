// ---------------------------------------------------------------------------
// /api/v1/pegii — workflow-runtime reads/writes of legacy pegII operational
// records (orders + their tasks).
//
// The pegII (MoveManager) system is the source of truth for orders and the
// operational tasks hung off them (date confirmation, survey scheduling, …). A
// lifecycle workflow re-fetches authoritative order state and closes tasks here
// via the SDK (PegasusClient.get_order / update_order / search_orders / list_tasks /
// get_task / close_task).
//
//   GET  /orders                 ReadOrder     DEPRECATED — always [] (use /orders/search)
//   GET  /orders/search          ReadOrder     live order search over `sales`
//   GET  /orders/:orderId        ReadOrder     fetch one order
//   PATCH /orders/:orderId       WriteOrder    write allowlisted fields back (native fragment)
//   GET  /salesmen               ReadSalesman  list salesmen (?active=…)
//   GET  /salesmen/:salesmanId   ReadSalesman  fetch one salesman
//   GET  /tasks                  ReadTask    list tasks (?orderId=… ?status=…)
//   GET  /tasks/:taskId          ReadTask    fetch one task
//   POST /tasks/close            CloseTask   close (orderId, taskType) — idempotent
//
// This is a namespaced legacy-bridge surface, exactly like the retired longhaul
// cloud handlers lived under `/api/v1/onprem/longhaul/*`. Single-order reads are
// LIVE: GET /orders/:orderId resolves an OrderGateway (gateways/order-gateway.
// factory.ts) and fetches the serialized order from the pegII team's on-prem API
// at `/api/v1/pegii/serialized/orders/:id` over the WireGuard tunnel; selecting
// orders is the site's live search (GET /orders/search). The task routes remain
// STUB-backed (services/pegii-tasks.ts) until the pegII task API lands (NW pulse
// Phase 6), with the route contract + Cedar gating real so the SDK and workflow
// authors build against them now.
//
// Distinct from the M2M `/api/v1/orders` endpoint (handlers/orders.ts), which is
// a move-backed reporting view for integration clients and is left untouched.
//
// Mounted on dualAuthMiddleware for symmetry with /workflow-secrets-configs and
// /integration-projections: the workflow_runtime `vnd_` key carries ReadOrder /
// ReadTask / CloseTask, so a Cognito session authenticates but is authorized
// away (403) on every route here.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { resolvePegiiCaller } from '../lib/pegii-request-context'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { meterUsage } from '../middleware/meter-usage'
import type { OrderRecord } from '../services/pegii-orders'
import {
  ORDER_SEARCH_DATE_FIELDS,
  ORDER_SEARCH_MAX_LIMIT,
  ORDER_SEARCH_MAX_SPAN_DAYS,
} from '../gateways/pegii/pegii-order-search.dto'
import type { SalesmanRecord } from '../services/pegii-salesmen'
import { closeTask, getTask, listTasks, type TaskRecord } from '../services/pegii-tasks'
import { resolveOrderGateway } from '../gateways/order-gateway.factory'
import { resolveSalesmanGateway } from '../gateways/salesman-gateway.factory'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/** Identifier shape for orderId / taskId / taskType path+body segments. */
const IDENT_RE = /^[A-Za-z0-9._:-]{1,128}$/

const CloseBody = z
  .object({
    orderId: z.string().regex(IDENT_RE, 'orderId must match [A-Za-z0-9._:-]{1,128}'),
    taskType: z.string().regex(IDENT_RE, 'taskType must match [A-Za-z0-9._:-]{1,128}'),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isoDay = (name: string) =>
  z
    .string({ error: `${name} is required (YYYY-MM-DD)` })
    .regex(ISO_DAY_RE, `${name} must be YYYY-MM-DD`)
    // Round-trip, because Date.parse rolls 2026-02-30 over to March 2.
    .refine((v) => {
      const t = Date.parse(`${v}T00:00:00Z`)
      return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
    }, `${name} is not a real date`)
const DAY_MS = 24 * 60 * 60 * 1000

// Mirrors movemanager OrderSearchCriteria so a bad call fails here with a
// legible 400 instead of a tunnel round-trip; the site re-validates anyway.
const OrderSearchQuery = z
  .object({
    dateField: z.enum(ORDER_SEARCH_DATE_FIELDS, {
      error: `dateField must be one of: ${ORDER_SEARCH_DATE_FIELDS.join(', ')}`,
    }),
    from: isoDay('from'),
    to: isoDay('to'),
    status: z
      .string()
      .regex(/^([A-Za-z]|\*)$/, "status must be one shipment-status letter, or '*' for all")
      .optional(),
    cursor: z.coerce.number().int().min(0, 'cursor must not be negative').optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, `limit must be between 1 and ${ORDER_SEARCH_MAX_LIMIT}`)
      .max(ORDER_SEARCH_MAX_LIMIT, `limit must be between 1 and ${ORDER_SEARCH_MAX_LIMIT}`)
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const span = (Date.parse(q.to) - Date.parse(q.from)) / DAY_MS
    if (span < 0) ctx.addIssue({ code: 'custom', message: 'to must be on or after from' })
    else if (span > ORDER_SEARCH_MAX_SPAN_DAYS)
      ctx.addIssue({
        code: 'custom',
        message: `the from/to range may span at most ${ORDER_SEARCH_MAX_SPAN_DAYS} days`,
      })
  })

function toOrderResponse(order: OrderRecord) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    scheduledDate: order.scheduledDate,
    packingActualDate: order.packingActualDate,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }
}

function toSalesmanResponse(salesman: SalesmanRecord) {
  return {
    id: salesman.id,
    avlCode: salesman.avlCode,
    firstName: salesman.firstName,
    lastName: salesman.lastName,
    name: salesman.name,
    title: salesman.title,
    email: salesman.email,
    extension: salesman.extension,
    branch: salesman.branch,
    agencyCode: salesman.agencyCode,
    roles: salesman.roles,
    employeeType: salesman.employeeType,
    active: salesman.active,
    startDate: salesman.startDate,
    dateTerminated: salesman.dateTerminated,
  }
}

function toTaskResponse(task: TaskRecord) {
  return {
    id: task.id,
    orderId: task.orderId,
    taskType: task.taskType,
    status: task.status,
    reason: task.reason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    closedAt: task.closedAt,
    // Every task row is synthesized by the in-memory stub (services/pegii-tasks)
    // until the real pegII task bridge lands (NW pulse Phase 6), which drops
    // this flag. It is on the row so no caller can mistake a fake for pegII
    // state (sdk-feedback 0046 C).
    stub: true as const,
  }
}

export const pegiiRuntimeHandler = new Hono<AppEnv>()

// Router-scoped error boundary. A PegiiApiError (the legacy pegII source is
// unreachable / not configured / answered with a bad envelope) is mapped to a
// legible 502/503/404 that names the dependency, instead of the bare 500
// INTERNAL_ERROR the global app.onError would produce. Anything else is
// re-thrown so the global handler keeps owning it (DomainError → 422, genuine
// bugs → 500). A mounted sub-app's own onError is what Hono invokes for throws
// from its routes, and a re-throw here propagates to the parent onError. See
// sdk-feedback spec 0018.
pegiiRuntimeHandler.onError((err, c) => {
  if (err instanceof PegiiApiError) {
    const { status, code, message } = pegiiApiErrorToHttp(err)
    const correlationId = c.get('correlationId') ?? 'unknown'
    logger.warn('pegII bridge upstream failure', {
      pegiiCode: err.code,
      pegiiStatus: err.status,
      status,
      correlationId,
    })
    return c.json({ error: message, code, correlationId }, status)
  }
  throw err
})

pegiiRuntimeHandler.use('*', dualAuthMiddleware)

// ── Orders ────────────────────────────────────────────────────────────────

// GET /orders — DEPRECATED (D4, NW pulse plan Phase 5). pegII has no snapshot
// collection to list, and the old in-memory stub only ever returned `[]` at
// runtime. Select orders with GET /orders/search instead. Kept so existing
// callers don't break: still probes reachability through the OrderGateway, so a
// down source is the same 502/503 a by-id read gives (sdk-feedback 0018), never
// a misleading `200 []`. Removed in a later SDK minor.
pegiiRuntimeHandler.get('/orders', requirePermission(Actions.ReadOrder), async (c) => {
  const tenantId = c.get('tenantId')

  const gateway = await resolveOrderGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
  await gateway.checkReachable()

  c.header('Deprecation', 'true')
  c.header('Link', '</api/v1/pegii/orders/search>; rel="successor-version"')
  return c.json({
    data: [],
    meta: {
      count: 0,
      deprecated: 'GET /api/v1/pegii/orders is deprecated; use GET /api/v1/pegii/orders/search',
    },
  })
})

// GET /orders/search — the site's LIVE order search over `sales` (not the
// serialized snapshot, which DB triggers and direct `UPDATE sales` paths leave
// stale): orders whose `dateField` falls in [from, to], one keyset page per
// call, each item carrying the eligibility fields a scheduled workflow needs —
// including the desktop's own texting verdict (`texting.status`). Items pass
// through unchanged; `meta.nextCursor` is null on the last page. Registered
// BEFORE /orders/:orderId so "search" is never read as an order id. A site whose
// API predates the search → 503 PEGII_CAPABILITY_MISSING; the site's own 400
// passes through with its code.
pegiiRuntimeHandler.get(
  '/orders/search',
  requirePermission(Actions.ReadOrder),
  validator('query', (value, c) => {
    const parsed = OrderSearchQuery.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: message, code: 'VALIDATION_ERROR' }, 400)
    }
    return parsed.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const criteria = c.req.valid('query')

    const gateway = await resolveOrderGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
    const page = await gateway.searchOrders(criteria)

    logger.info('pegII orders searched', {
      tenantId,
      dateField: criteria.dateField,
      from: criteria.from,
      to: criteria.to,
      count: page.items.length,
      more: page.nextCursor !== null,
    })
    return c.json({
      data: page.items,
      meta: { count: page.items.length, nextCursor: page.nextCursor },
    })
  },
)

// GET /orders/:orderId — fetch one order from the pegII serialized endpoint via
// the OrderGateway. A tenant with no configured pegII target → 503 and an
// unreachable source → 502 (the error boundary maps the thrown PegiiApiError);
// an unknown order id is a 404 (the gateway null-maps the upstream 404).
//
// `?shape=native` returns the RAW serialized pegII payload (`{Id, Survey,
// InvolvedParties, …}`) instead of the projected OrderRecord — the shape a
// partner posts to the ingress, so it can feed a published integration's
// `map_from_external` to dry-run the mapping against a real order id
// (sdk-feedback 0029). Same `ReadOrder` gate. Any other `shape` value is a 400.
pegiiRuntimeHandler.get('/orders/:orderId', requirePermission(Actions.ReadOrder), async (c) => {
  const tenantId = c.get('tenantId')
  const orderId = c.req.param('orderId') ?? ''
  const shape = c.req.query('shape')

  if (shape !== undefined && shape !== 'native') {
    return c.json({ error: "shape must be 'native' when provided", code: 'INVALID_SHAPE' }, 400)
  }

  const gateway = await resolveOrderGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))

  if (shape === 'native') {
    const native = await gateway.findOrderNativeById(orderId)
    if (native == null) {
      return c.json({ error: 'Order not found', code: 'NOT_FOUND' }, 404)
    }
    logger.info('pegII order fetched (native)', { orderId, tenantId })
    return c.json({ data: native })
  }

  const order = await gateway.findOrderById(orderId)
  if (!order) {
    return c.json({ error: 'Order not found', code: 'NOT_FOUND' }, 404)
  }
  logger.info('pegII order fetched', { orderId, tenantId })
  return c.json({ data: toOrderResponse(order) })
})

// PATCH /orders/:orderId — write allowlisted fields back onto the pegII order
// (sdk-feedback 0044). The body is a native-shape fragment, the same vocabulary
// `?shape=native` reads, e.g. `{"Survey": {"SerivceStatus": "In Progress"}}`.
// The SITE owns the allowlist and the validation: any other path is its 400
// naming the path, passed through by pegiiApiErrorToHttp. `ORDER_NOT_FOUND` and
// `ORDER_SNAPSHOT_MISSING` keep pegII's code on the 404. The response is the
// order exactly as `?shape=native` returns it after the write, plus
// `meta.applied` (false when the values were already there, which is not billed;
// mirrored in the `x-pegasus-applied` header the meter reads). A site whose API
// predates the write → 503 PEGII_CAPABILITY_MISSING.
pegiiRuntimeHandler.patch(
  '/orders/:orderId',
  requirePermission(Actions.WriteOrder),
  meterUsage(Actions.WriteOrder),
  async (c) => {
    const tenantId = c.get('tenantId')
    const orderId = c.req.param('orderId') ?? ''

    let patch: unknown
    try {
      patch = await c.req.json()
    } catch {
      return c.json({ error: 'The body must be JSON', code: 'VALIDATION_ERROR' }, 400)
    }
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      return c.json(
        {
          error:
            'The body must be a JSON object, e.g. {"Survey": {"SerivceStatus": "In Progress"}}',
          code: 'VALIDATION_ERROR',
        },
        400,
      )
    }

    const gateway = await resolveOrderGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
    const result = await gateway.updateOrderNative(orderId, patch as Record<string, unknown>)
    if (!result.found) {
      return c.json({ error: result.message, code: result.code }, 404)
    }

    logger.info('pegII order written', { orderId, tenantId, applied: result.applied })
    c.header('x-pegasus-applied', result.applied ? 'true' : 'false')
    return c.json({ data: result.order, meta: { applied: result.applied } })
  },
)

// ── Salesmen ────────────────────────────────────────────────────────────────

// GET /salesmen — list salesmen, optionally filtered by active state, from the
// pegII directory (`GET /api/v1/pegii/salesmen`, all pages). A site whose API
// build predates `pegii.salesmen.list.v1` → 503 PEGII_CAPABILITY_MISSING; an
// unreachable source → 502 (the error boundary maps the PegiiApiError). The
// response shape omits `winUsername` — it's for the membership sync, not
// workflows. The `active` query param, when present, is parsed as a boolean
// ("true"/"false"/"1"/"0").
pegiiRuntimeHandler.get('/salesmen', requirePermission(Actions.ReadSalesman), async (c) => {
  const tenantId = c.get('tenantId')
  const activeRaw = c.req.query('active')
  const active = activeRaw === undefined ? undefined : activeRaw === 'true' || activeRaw === '1'

  const gateway = await resolveSalesmanGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
  const salesmen = await gateway.listSalesmen(active !== undefined ? { active } : {})
  logger.info('pegII salesmen listed', { count: salesmen.length, active, tenantId })
  return c.json({ data: salesmen.map(toSalesmanResponse), meta: { count: salesmen.length } })
})

// GET /salesmen/:salesmanId — fetch one salesman from the pegII serialized
// endpoint via the SalesmanGateway. A tenant with no configured pegII target →
// 503 and an unreachable source → 502 (the error boundary maps the thrown
// PegiiApiError); an unknown salesman id is a 404 (the gateway null-maps the
// upstream 404).
pegiiRuntimeHandler.get(
  '/salesmen/:salesmanId',
  requirePermission(Actions.ReadSalesman),
  async (c) => {
    const tenantId = c.get('tenantId')
    const salesmanId = c.req.param('salesmanId') ?? ''

    const gateway = await resolveSalesmanGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
    const salesman = await gateway.findSalesmanById(salesmanId)
    if (!salesman) {
      return c.json({ error: 'Salesman not found', code: 'NOT_FOUND' }, 404)
    }
    logger.info('pegII salesman fetched', { salesmanId, tenantId })
    return c.json({ data: toSalesmanResponse(salesman) })
  },
)

// ── Tasks ─────────────────────────────────────────────────────────────────

// GET /tasks — list tasks, optionally scoped to one order and/or status.
pegiiRuntimeHandler.get('/tasks', requirePermission(Actions.ReadTask), async (c) => {
  const tenantId = c.get('tenantId')
  const orderId = c.req.query('orderId')
  const status = c.req.query('status')

  const tasks = listTasks(tenantId, {
    ...(orderId ? { orderId } : {}),
    ...(status ? { status } : {}),
  })
  logger.info('pegII tasks listed', { count: tasks.length, orderId, status, tenantId })
  return c.json({ data: tasks.map(toTaskResponse), meta: { count: tasks.length } })
})

// GET /tasks/:taskId — fetch a single task.
pegiiRuntimeHandler.get('/tasks/:taskId', requirePermission(Actions.ReadTask), async (c) => {
  const tenantId = c.get('tenantId')
  const taskId = c.req.param('taskId') ?? ''

  const task = getTask(tenantId, taskId)
  if (!task) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404)
  }
  return c.json({ data: toTaskResponse(task) })
})

// POST /tasks/close — close (orderId, taskType). Idempotent: a second close of
// an already-closed task returns 200 with `alreadyClosed: true`, never an error.
pegiiRuntimeHandler.post(
  '/tasks/close',
  requirePermission(Actions.CloseTask),
  meterUsage(Actions.CloseTask),
  validator('json', (value, c) => {
    const r = CloseBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const { orderId, taskType, reason } = c.req.valid('json')

    const result = closeTask(tenantId, {
      orderId,
      taskType,
      reason: reason ?? null,
    })
    if (!result) {
      // A miss is a 404, never a fabricated success. The meter skips non-2xx,
      // so a close that closed nothing is not billed (sdk-feedback 0046 B).
      return c.json(
        {
          error: `No ${taskType} task on order ${orderId}`,
          code: 'TASK_NOT_FOUND',
        },
        404,
      )
    }
    const { task, alreadyClosed } = result
    logger.info('pegII task closed', { orderId, taskType, alreadyClosed, tenantId })
    return c.json({ data: { ...toTaskResponse(task), alreadyClosed } })
  },
)

// ── Unmatched routes ──────────────────────────────────────────────────────

// Terminal catch-all: MUST stay the last registration on this router. A caller
// who passed dual-auth above but matched no route here would otherwise fall
// through to app.ts's `v1` router (same `/api/v1` prefix), whose tenant
// middleware only accepts Cognito sessions and answers `401 "Invalid or
// unverifiable token"` to a valid `vnd_` key. That made "no such route"
// indistinguishable from "bad credentials" (sdk-feedback 0044 Part C).
//
// Safe because no `v1` route lives under `/api/v1/pegii/*`; session pegII
// routes are deliberately mounted at sibling prefixes (`/pegii-reports`,
// `/settings/pegii`) for the reason route-prefix-middleware-bleed.test.ts pins.
// An unauthenticated caller never reaches this: dual-auth answers 401 first.
pegiiRuntimeHandler.all('*', (c) =>
  c.json({ error: `No such route: ${c.req.method} ${c.req.path}`, code: 'NOT_FOUND' }, 404),
)
