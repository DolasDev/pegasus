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
//   GET  /orders                 ReadOrder   list orders (?status=…)
//   GET  /orders/:orderId        ReadOrder   fetch one order
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
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { listOrders, type OrderRecord } from '../services/pegii-orders'
import { closeTask, getTask, listTasks, type TaskRecord } from '../services/pegii-tasks'
import { resolveOrderGateway } from '../gateways/order-gateway.factory'
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

  const gateway = await resolveOrderGateway(c.get('db'), tenantId)
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

  const gateway = await resolveOrderGateway(c.get('db'), tenantId)

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
  validator('json', (value, c) => {
    const r = CloseBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const { orderId, taskType, reason } = c.req.valid('json')

    const { task, alreadyClosed } = closeTask(tenantId, {
      orderId,
      taskType,
      reason: reason ?? null,
    })
    logger.info('pegII task closed', { orderId, taskType, alreadyClosed, tenantId })
    return c.json({ data: { ...toTaskResponse(task), alreadyClosed } })
  },
)
