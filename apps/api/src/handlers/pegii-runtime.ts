// ---------------------------------------------------------------------------
// /api/v1/pegii — workflow-runtime reads/writes of legacy pegII operational
// records (orders + their tasks).
//
// The pegII (MoveManager) system is the source of truth for orders and the
// operational tasks hung off them (date confirmation, survey scheduling, …). A
// lifecycle workflow re-fetches authoritative order state and closes tasks here
// via the SDK (PegasusClient.get_order / list_orders / list_tasks / get_task /
// close_task).
//
//   GET  /orders                 ReadOrder     list orders (?status=…)
//   GET  /orders/:orderId        ReadOrder     fetch one order
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
// at `/api/v1/pegii/serialized/orders/:id` over the WireGuard tunnel. Order
// LISTING and all task routes remain STUB-backed (services/pegii-orders.ts +
// services/pegii-tasks.ts) — the pegII serialized endpoint is by-id only — with
// the route contract + Cedar gating real so the SDK and workflow authors build
// against them now, and the backing store swaps when pegII exposes collections.
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
import { listOrders, type OrderRecord } from '../services/pegii-orders'
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

// GET /orders — list orders, optionally filtered by status.
//
// The list itself is still stub-backed (the pegII serialized API is by-id only),
// but we first probe reachability through the OrderGateway so this route fails the
// SAME way GET /orders/:orderId does when the source is down — a 502/503 that names
// the dependency — rather than misleadingly returning `200 []` for a firewalled
// tenant. resolveOrderGateway throws PEGII_API_NOT_CONFIGURED (→ 503) and
// checkReachable throws PEGII_API_TUNNEL_ERROR (→ 502); the error boundary maps
// both. See sdk-feedback spec 0018 (AC: list_orders and get_order agree on
// reachability).
pegiiRuntimeHandler.get('/orders', requirePermission(Actions.ReadOrder), async (c) => {
  const tenantId = c.get('tenantId')
  const status = c.req.query('status')

  const gateway = await resolveOrderGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
  await gateway.checkReachable()

  const orders = listOrders(tenantId, { ...(status ? { status } : {}) })
  logger.info('pegII orders listed', { count: orders.length, status, tenantId })
  return c.json({ data: orders.map(toOrderResponse), meta: { count: orders.length } })
})

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
