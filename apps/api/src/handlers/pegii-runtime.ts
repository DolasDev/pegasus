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
//   POST /orders/:orderId/memos  WriteOrderMemo add a desktop order memo (idempotent with dedupKey)
//   GET  /memo-types             ReadOrder     this company's memo-type labels
//   GET  /salesmen               ReadSalesman  list salesmen (?active=…)
//   GET  /salesmen/:salesmanId   ReadSalesman  fetch one salesman
//   GET  /tasks                  ReadTask      an order's tasks (?orderId=) or one type across orders (?taskType=)
//   GET  /tasks/:taskId          ReadTask      fetch one task
//   POST /tasks                  CreateTask    create a task on an order (idempotent with dedupKey)
//   POST /tasks/close            CloseTask     close by taskId or (orderId, taskType) — idempotent
//
// This is a namespaced legacy-bridge surface, exactly like the retired longhaul
// cloud handlers lived under `/api/v1/onprem/longhaul/*`. Single-order reads are
// LIVE: GET /orders/:orderId resolves an OrderGateway (gateways/order-gateway.
// factory.ts) and fetches the serialized order from the pegII team's on-prem API
// at `/api/v1/pegii/serialized/orders/:id` over the WireGuard tunnel; selecting
// orders is the site's live search (GET /orders/search). Tasks are the site's
// task API (pegii.tasks.v1, NW pulse Phase 6) through a TaskGateway.
//
// Distinct from the M2M `/api/v1/orders` endpoint (handlers/orders.ts), which is
// a move-backed reporting view for integration clients and is left untouched.
//
// Mounted on dualAuthMiddleware for symmetry with /workflow-secrets-configs and
// /integration-projections: the workflow_runtime `vnd_` key carries ReadOrder /
// ReadTask / CreateTask / CloseTask, so a Cognito session authenticates but is authorized
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
import { resolveTaskGateway } from '../gateways/task-gateway.factory'
import type { PegiiTaskDto } from '../gateways/pegii/pegii-task.dto'
import { TASK_SEARCH_MAX_LIMIT } from '../gateways/pegii/pegii-task.dto'
import { resolveOrderGateway } from '../gateways/order-gateway.factory'
import { resolveMemoGateway } from '../gateways/memo-gateway.factory'
import type { PegiiMemoDto } from '../gateways/pegii/pegii-memo.dto'
import { resolveSalesmanGateway } from '../gateways/salesman-gateway.factory'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/** A pegII order number or task id: the site's routes are `{n:int}`. */
const PEGII_INT_RE = /^[1-9]\d{0,9}$/
const PEGII_INT_MAX = 2_147_483_647
const isPegiiInt = (v: string): boolean => PEGII_INT_RE.test(v) && Number(v) <= PEGII_INT_MAX

const orderNumber = z
  .string({ error: 'orderId is required' })
  .refine(isPegiiInt, 'orderId must be a pegII order number (digits)')
// A task type is free text with spaces ("Pulse Follow-Up"); the site's sidecar column is 64.
const taskType = z
  .string({ error: 'taskType is required' })
  .trim()
  .min(1, 'taskType must not be empty')
  .max(64, 'taskType may be at most 64 characters')
  .refine(
    (v) => [...v].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f),
    'taskType must not contain control characters',
  )

/** pegII task types compare case-insensitively (the site's registry does). */
const sameTaskType = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

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

const TaskListQuery = z
  .object({
    orderId: orderNumber.optional(),
    taskType: taskType.optional(),
    status: z.enum(['open', 'closed'], { error: "status must be 'open' or 'closed'" }).optional(),
    dueBefore: isoDay('dueBefore').optional(),
    cursor: z.coerce.number().int().min(0, 'cursor must not be negative').optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, `limit must be between 1 and ${TASK_SEARCH_MAX_LIMIT}`)
      .max(TASK_SEARCH_MAX_LIMIT, `limit must be between 1 and ${TASK_SEARCH_MAX_LIMIT}`)
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.orderId === undefined && q.taskType === undefined)
      ctx.addIssue({ code: 'custom', message: 'orderId or taskType is required' })
    if (q.orderId !== undefined && (q.cursor !== undefined || q.limit !== undefined))
      ctx.addIssue({
        code: 'custom',
        message: "cursor/limit page the cross-order search; an order's tasks come in one response",
      })
  })

const CreateTaskBody = z
  .object({
    orderId: orderNumber,
    taskType,
    title: z
      .string({ error: 'title is required' })
      .trim()
      .min(1, 'title is required')
      .max(200, 'title may be at most 200 characters'),
    description: z
      .string()
      .trim()
      .max(1000, 'description may be at most 1000 characters')
      .optional(),
    priority: z
      .enum(['low', 'normal', 'high'], { error: "priority must be 'low', 'normal' or 'high'" })
      .optional(),
    dueDate: isoDay('dueDate'),
    assigneeCode: z
      .number()
      .int()
      .positive('assigneeCode must be a MoveManager employee code')
      .optional(),
    dedupKey: z
      .string()
      .trim()
      .min(1, 'dedupKey must not be empty')
      .max(190, 'dedupKey may be at most 190 characters')
      .optional(),
  })
  .strict()

const CloseBody = z
  .object({
    taskId: z.union([z.string(), z.number().int()]).transform(String).optional(),
    orderId: orderNumber.optional(),
    taskType: taskType.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const byId = b.taskId !== undefined
    const byType = b.orderId !== undefined || b.taskType !== undefined
    if (byId === byType)
      ctx.addIssue({ code: 'custom', message: 'give exactly one of taskId, or orderId + taskType' })
    else if (byType && (b.orderId === undefined || b.taskType === undefined))
      ctx.addIssue({ code: 'custom', message: 'orderId and taskType go together' })
  })

// Mirrors movemanager OrderSearchCriteria so a bad call fails here with a
// legible 400 instead of a tunnel round-trip; the site re-validates anyway.
const CreateMemoBody = z
  .object({
    memoType: z
      .number({ error: 'memoType is required (the memo-type code, 1-7; see GET /memo-types)' })
      .int()
      .min(1, 'memoType must be between 1 and 7')
      .max(7, 'memoType must be between 1 and 7'),
    subject: z
      .string({ error: 'subject is required' })
      .trim()
      .min(1, 'subject is required')
      .max(150, 'subject may be at most 150 characters'),
    text: z
      .string({ error: 'text is required' })
      .trim()
      .min(1, 'text is required')
      .max(1000, 'text may be at most 1000 characters'),
    nextAction: z
      .string()
      .trim()
      .min(1, 'nextAction must not be empty')
      .max(100, 'nextAction may be at most 100 characters')
      .optional(),
    nextDate: isoDay('nextDate').optional(),
    personCode: z
      .number()
      .int()
      .positive('personCode must be a MoveManager employee code')
      .optional(),
    dedupKey: z
      .string()
      .trim()
      .min(1, 'dedupKey must not be empty')
      .max(190, 'dedupKey may be at most 190 characters')
      .optional(),
  })
  .strict()

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

/** A pegII order memo in the SDK's shape. Ids are strings, like every pegII id here. */
function toMemoResponse(memo: PegiiMemoDto) {
  return {
    id: String(memo.id),
    orderId: String(memo.orderNumber),
    memoType: memo.memoType,
    subject: memo.subject,
    text: memo.text,
    nextAction: memo.nextAction,
    nextDate: memo.nextDate,
    callDate: memo.callDate,
    callTime: memo.callTime,
    whoCalled: memo.whoCalled,
    shipper: memo.shipper,
    personCode: memo.personCode,
    acknowledged: memo.acknowledged,
    createdBy: memo.createdBy,
  }
}

const statusOf = (t: PegiiTaskDto): 'open' | 'closed' => (t.completed ? 'closed' : 'open')

/**
 * A pegII task in the SDK's shape. Ids are strings (opaque per instance). `createdAt` is
 * known only for a task the cloud created (pegII's `Tasks` has no created column) and
 * `closedAt` only for a close made through the API; `completedAt` is the site-local time
 * MoveManager stamps on any completion.
 */
function toTaskResponse(task: PegiiTaskDto) {
  return {
    id: String(task.id),
    orderId: String(task.orderNumber),
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate,
    assigneeCode: task.assigneeCode,
    status: statusOf(task),
    reason: task.closeReason,
    createdByApi: task.createdByApi,
    active: task.active,
    completedAt: task.completedAt,
    completedBy: task.completedBy,
    actualDate: task.actualDate,
    createdAt: task.createdUtc,
    closedAt: task.closedUtc,
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

// ── Memos ───────────────────────────────────────────────────────────────────
//
// Backed by the pegII site's memo API (gateways/pegii-memo.gateway.ts), gated on
// `pegii.memos.v1` (503 PEGII_CAPABILITY_MISSING without it).

// POST /orders/:orderId/memos — add a memo to an order (WriteOrderMemo,
// billable). The site writes a desktop order memo (`memos`, source 'O'):
// `subject` is its "Re:" (stored uppercased), `text` its "Notes:". It lands on
// the "Memos I need to acknowledge" list of `personCode` (default: the order's
// coordinator) from `nextDate` (default: today). `memoType` is the stored digit;
// its label is the company's (GET /memo-types). The site's 400s pass through
// with their codes, among them MEMO_TEXT_TRIGGERS_REJECTION (a `text` the
// desktop's memo trigger would treat as a rejection) and UNKNOWN_PERSON.
// `dedupKey` makes it idempotent: the same key with the same request answers
// 200 `alreadyExists: true` (the original memo; not billed), with a different
// request 409 IDEMPOTENCY_KEY_REUSED. A new memo is 201.
pegiiRuntimeHandler.post(
  '/orders/:orderId/memos',
  requirePermission(Actions.WriteOrderMemo),
  meterUsage(Actions.WriteOrderMemo),
  validator('json', (value, c) => {
    const parsed = CreateMemoBody.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: message, code: 'VALIDATION_ERROR' }, 400)
    }
    return parsed.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const orderId = c.req.param('orderId') ?? ''
    if (!isPegiiInt(orderId)) {
      return c.json(
        { error: 'orderId must be a pegII order number (digits)', code: 'VALIDATION_ERROR' },
        400,
      )
    }
    const b = c.req.valid('json')

    const gateway = await resolveMemoGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
    const result = await gateway.createMemo(Number(orderId), {
      memoType: b.memoType,
      subject: b.subject,
      text: b.text,
      ...(b.nextAction !== undefined ? { nextAction: b.nextAction } : {}),
      ...(b.nextDate !== undefined ? { nextDate: b.nextDate } : {}),
      ...(b.personCode !== undefined ? { personCode: b.personCode } : {}),
      ...(b.dedupKey !== undefined ? { idempotencyKey: b.dedupKey } : {}),
    })
    if (!result.found) {
      return c.json({ error: `Order ${orderId} not found`, code: result.code }, 404)
    }

    logger.info('pegII order memo added', {
      tenantId,
      orderId,
      memoId: result.memo.id,
      memoType: b.memoType,
      alreadyExists: result.alreadyExists,
    })
    return c.json(
      { data: { ...toMemoResponse(result.memo), alreadyExists: result.alreadyExists } },
      result.alreadyExists ? 200 : 201,
    )
  },
)

// GET /memo-types — the memo-type labels this site's desktop shows. The codes
// are the same everywhere; the labels are the company's (on NW, 4 is "Customer
// Service"; on QMM, "General"). `company` is null when the site can't tell, and
// the labels are then the generic ones.
pegiiRuntimeHandler.get('/memo-types', requirePermission(Actions.ReadOrder), async (c) => {
  const gateway = await resolveMemoGateway(c.get('db'), c.get('tenantId'), () =>
    resolvePegiiCaller(c),
  )
  const types = await gateway.listMemoTypes()
  return c.json({ data: types.items, meta: { company: types.company, count: types.items.length } })
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
//
// Backed by the pegII site's task API (gateways/pegii-task.gateway.ts), gated on
// the site's `pegii.tasks.v1` (503 PEGII_CAPABILITY_MISSING without it). Ids are
// pegII's `Tasks.id`, one per task instance. Reads cover every task on an
// order, the desktop's own included (a desktop task reports its legacy code as
// `taskType` and has no priority); create writes a desktop user-defined task;
// close completes any task.

// GET /tasks — an order's tasks (`orderId`), or cloud-created tasks of one type
// across orders (`taskType`, keyset-paged by `meta.nextCursor`). One of the two
// is required. An unknown order → 404 ORDER_NOT_FOUND; an order with no tasks
// → []. Nothing is created by a read.
pegiiRuntimeHandler.get(
  '/tasks',
  requirePermission(Actions.ReadTask),
  validator('query', (value, c) => {
    const parsed = TaskListQuery.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: message, code: 'VALIDATION_ERROR' }, 400)
    }
    return parsed.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const q = c.req.valid('query')
    const gateway = await resolveTaskGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))

    if (q.orderId !== undefined) {
      const all = await gateway.listOrderTasks(Number(q.orderId))
      if (all === null) {
        return c.json({ error: `Order ${q.orderId} not found`, code: 'ORDER_NOT_FOUND' }, 404)
      }
      const tasks = all.filter(
        (t) =>
          (q.taskType === undefined || sameTaskType(t.taskType, q.taskType)) &&
          (q.status === undefined || statusOf(t) === q.status) &&
          (q.dueBefore === undefined || (t.dueDate !== null && t.dueDate < q.dueBefore)),
      )
      logger.info('pegII tasks listed', { tenantId, orderId: q.orderId, count: tasks.length })
      return c.json({
        data: tasks.map(toTaskResponse),
        meta: { count: tasks.length, nextCursor: null },
      })
    }

    const page = await gateway.searchTasks({
      taskType: q.taskType!,
      ...(q.status !== undefined ? { open: q.status === 'open' } : {}),
      ...(q.dueBefore !== undefined ? { dueBefore: q.dueBefore } : {}),
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    })
    logger.info('pegII tasks searched', {
      tenantId,
      taskType: q.taskType,
      count: page.items.length,
      more: page.nextCursor !== null,
    })
    return c.json({
      data: page.items.map(toTaskResponse),
      meta: {
        count: page.items.length,
        nextCursor: page.nextCursor === null ? null : String(page.nextCursor),
      },
    })
  },
)

// GET /tasks/:taskId — one task, desktop or cloud. An id that isn't a pegII
// task id (e.g. the retired stub's `task_<order>_<type>`) is simply not found.
pegiiRuntimeHandler.get('/tasks/:taskId', requirePermission(Actions.ReadTask), async (c) => {
  const tenantId = c.get('tenantId')
  const taskId = c.req.param('taskId') ?? ''
  if (!isPegiiInt(taskId)) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404)
  }

  const gateway = await resolveTaskGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
  const task = await gateway.getTask(Number(taskId))
  if (!task) {
    return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404)
  }
  return c.json({ data: toTaskResponse(task) })
})

// POST /tasks — create a task on an order (CreateTask, billable). The site
// writes a MoveManager user-defined (USRDEF) task the coordinator sees and
// completes like their own, and validates the type (`Pulse Follow-Up` today),
// title, priority and assignee — its 400s pass through with their codes.
// `dedupKey` makes it idempotent: the same key with the same request answers
// 200 `alreadyExists: true` (the original task; not billed), with a different
// request 409 IDEMPOTENCY_KEY_REUSED. A new task is 201.
pegiiRuntimeHandler.post(
  '/tasks',
  requirePermission(Actions.CreateTask),
  meterUsage(Actions.CreateTask),
  validator('json', (value, c) => {
    const parsed = CreateTaskBody.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: message, code: 'VALIDATION_ERROR' }, 400)
    }
    return parsed.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const b = c.req.valid('json')

    const gateway = await resolveTaskGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))
    const result = await gateway.createTask(Number(b.orderId), {
      taskType: b.taskType,
      title: b.title,
      dueDate: b.dueDate,
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.priority !== undefined ? { priority: b.priority } : {}),
      ...(b.assigneeCode !== undefined ? { assigneeCode: b.assigneeCode } : {}),
      ...(b.dedupKey !== undefined ? { idempotencyKey: b.dedupKey } : {}),
    })
    if (!result.found) {
      return c.json({ error: `Order ${b.orderId} not found`, code: result.code }, 404)
    }

    logger.info('pegII task created', {
      tenantId,
      orderId: b.orderId,
      taskId: result.task.id,
      taskType: b.taskType,
      alreadyExists: result.alreadyExists,
    })
    return c.json(
      { data: { ...toTaskResponse(result.task), alreadyExists: result.alreadyExists } },
      result.alreadyExists ? 200 : 201,
    )
  },
)

// POST /tasks/close — close one task (CloseTask, billable), by `taskId` or by
// `(orderId, taskType)`. Exactly one form. Idempotent: closing a closed task is
// 200 `alreadyClosed: true` (not billed). By (order, type), the order's OPEN
// tasks of that type decide: one → closed; two or more → 409 TASK_AMBIGUOUS
// naming `candidateIds`, nothing closed; none open but some closed → the latest
// as `alreadyClosed`; none at all → 404 TASK_NOT_FOUND.
pegiiRuntimeHandler.post(
  '/tasks/close',
  requirePermission(Actions.CloseTask),
  meterUsage(Actions.CloseTask),
  validator('json', (value, c) => {
    const parsed = CloseBody.safeParse(value)
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ')
      return c.json({ error: message, code: 'VALIDATION_ERROR' }, 400)
    }
    return parsed.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    const reason = body.reason ?? null
    const gateway = await resolveTaskGateway(c.get('db'), tenantId, () => resolvePegiiCaller(c))

    let taskId: number
    if (body.taskId !== undefined) {
      if (!isPegiiInt(body.taskId)) {
        return c.json({ error: `Task ${body.taskId} not found`, code: 'TASK_NOT_FOUND' }, 404)
      }
      taskId = Number(body.taskId)
    } else {
      const { orderId, taskType } = body as { orderId: string; taskType: string }
      const all = await gateway.listOrderTasks(Number(orderId))
      if (all === null) {
        return c.json({ error: `Order ${orderId} not found`, code: 'ORDER_NOT_FOUND' }, 404)
      }
      const matches = all.filter((t) => sameTaskType(t.taskType, taskType))
      const open = matches.filter((t) => !t.completed)
      if (open.length > 1) {
        const candidateIds = open.map((t) => String(t.id))
        return c.json(
          {
            error: `Order ${orderId} has ${open.length} open ${taskType} tasks; close one by taskId`,
            code: 'TASK_AMBIGUOUS',
            candidateIds,
          },
          409,
        )
      }
      if (open.length === 0) {
        const latest = matches.reduce<PegiiTaskDto | null>(
          (best, t) => (best === null || t.id > best.id ? t : best),
          null,
        )
        if (latest === null) {
          return c.json(
            { error: `No ${taskType} task on order ${orderId}`, code: 'TASK_NOT_FOUND' },
            404,
          )
        }
        logger.info('pegII task closed', { tenantId, taskId: latest.id, alreadyClosed: true })
        return c.json({ data: { ...toTaskResponse(latest), alreadyClosed: true } })
      }
      taskId = open[0]!.id
    }

    const result = await gateway.closeTask(taskId, reason)
    if (!result) {
      // A miss is a 404, never a fabricated success; the meter skips non-2xx.
      return c.json({ error: `Task ${taskId} not found`, code: 'TASK_NOT_FOUND' }, 404)
    }
    logger.info('pegII task closed', { tenantId, taskId, alreadyClosed: result.alreadyClosed })
    return c.json({ data: { ...toTaskResponse(result.task), alreadyClosed: result.alreadyClosed } })
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
