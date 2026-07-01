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
// cloud handlers lived under `/api/v1/onprem/longhaul/*`. The data source is a
// STUB today (services/pegii-orders.ts + services/pegii-tasks.ts); the route
// contract + Cedar gating are real so the SDK and workflow authors build against
// them now, and only the backing store swaps when the pegII API is bridged in.
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
import { getOrder, listOrders, type OrderRecord } from '../services/pegii-orders'
import { closeTask, getTask, listTasks, type TaskRecord } from '../services/pegii-tasks'
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

pegiiRuntimeHandler.use('*', dualAuthMiddleware)

// ── Orders ────────────────────────────────────────────────────────────────

// GET /orders — list orders, optionally filtered by status.
pegiiRuntimeHandler.get('/orders', requirePermission(Actions.ReadOrder), async (c) => {
  const tenantId = c.get('tenantId')
  const status = c.req.query('status')

  const orders = listOrders(tenantId, { ...(status ? { status } : {}) })
  logger.info('pegII orders listed', { count: orders.length, status, tenantId })
  return c.json({ data: orders.map(toOrderResponse), meta: { count: orders.length } })
})

// GET /orders/:orderId — fetch one order (materialised on first read; stub).
pegiiRuntimeHandler.get('/orders/:orderId', requirePermission(Actions.ReadOrder), async (c) => {
  const tenantId = c.get('tenantId')
  const orderId = c.req.param('orderId') ?? ''

  const order = getOrder(tenantId, orderId)
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
