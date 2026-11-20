// ---------------------------------------------------------------------------
// pegII-backed TaskGateway — the site's task routes (movemanager
// `TaskEndpoints`) over the WireGuard tunnel:
//
//   GET  /api/v1/pegii/orders/{n}/tasks      every task on an order
//   POST /api/v1/pegii/orders/{n}/tasks      create (idempotent with a key)
//   GET  /api/v1/pegii/tasks/{id}            one task
//   GET  /api/v1/pegii/tasks?taskType=…      cloud-created tasks of one type
//   POST /api/v1/pegii/tasks/{id}/close      close any task
//
// All five are gated on `pegii.tasks.v1`. Numeric ids only: the site's routes
// are `{n:int}`/`{id:int}`. An id that isn't a pegII int can't name a task
// here, so getTask/closeTask answer null for it without calling the site.
//
// This is the `legacy` store: each PegiiTaskDto is adapted to the neutral
// TaskRecord (task.gateway.ts) on the way out.
// ---------------------------------------------------------------------------

import type { TaskGateway, TaskRecord } from './task.gateway'
import type { PegiiCaller } from '../lib/pegii-request-context'
import {
  createPegiiApiClient,
  isPegiiNotFound,
  PegiiApiError,
  type PegiiApiClient,
} from '../lib/pegii-api-client'
import { requirePegiiCapabilities, PegiiCapabilities } from '../lib/pegii-capabilities'
import type {
  PegiiCloseTaskResultDto,
  PegiiCreateTaskBody,
  PegiiCreateTaskResultDto,
  PegiiOrderTasksDto,
  PegiiTaskDto,
  PegiiTaskSearchPageDto,
} from './pegii/pegii-task.dto'

/** A pegII order number or task id: the site's routes are `{n:int}` (Int32, positive). */
const PEGII_INT_RE = /^[1-9]\d{0,9}$/
const PEGII_INT_MAX = 2_147_483_647
export const isPegiiInt = (v: string): boolean => PEGII_INT_RE.test(v) && Number(v) <= PEGII_INT_MAX

/** pegII's TaskDto → the neutral TaskRecord (`store: 'legacy'`). */
export function pegiiTaskToRecord(task: PegiiTaskDto): TaskRecord {
  return {
    store: 'legacy',
    id: String(task.id),
    orderId: String(task.orderNumber),
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate,
    assigneeCode: task.assigneeCode,
    status: task.completed ? 'closed' : 'open',
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

export interface PegiiTaskGatewayOptions {
  tenantId: string
  baseUrl: string
  /** Test seam: inject a stub PegiiApiClient instead of the tunnel-backed one. */
  client?: PegiiApiClient
  /** Who is calling (cloud-issued token + x-correlation-id); see lib/pegii-request-context.ts. */
  caller?: PegiiCaller
  /** Test seam: the /version capability gate. */
  requireCapabilities?: typeof requirePegiiCapabilities
}

export function createPegiiTaskGateway(opts: PegiiTaskGatewayOptions): TaskGateway {
  const client =
    opts.client ??
    createPegiiApiClient({
      tenantId: opts.tenantId,
      baseUrl: opts.baseUrl,
      ...(opts.caller ? { caller: opts.caller } : {}),
    })

  const requireCaps = opts.requireCapabilities ?? requirePegiiCapabilities
  const requireTasks = () =>
    requireCaps(opts.baseUrl, [PegiiCapabilities.Tasks], {
      ...(opts.caller ? { correlationId: opts.caller.correlationId } : {}),
    })

  /** Null-maps the site's 404 (no such order/task); anything else propagates. */
  async function orNull<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call()
    } catch (err) {
      if (isPegiiNotFound(err)) return null
      throw err
    }
  }

  return {
    store: 'legacy',

    async listOrderTasks(orderNumber) {
      await requireTasks()
      if (!isPegiiInt(orderNumber)) return null
      const page = await orNull(() =>
        client.get<PegiiOrderTasksDto>(`/api/v1/pegii/orders/${orderNumber}/tasks`),
      )
      return page === null ? null : (page.items ?? []).map(pegiiTaskToRecord)
    },

    async getTask(taskId) {
      await requireTasks()
      if (!isPegiiInt(taskId)) return null
      const task = await orNull(() => client.get<PegiiTaskDto>(`/api/v1/pegii/tasks/${taskId}`))
      return task === null ? null : pegiiTaskToRecord(task)
    },

    async searchTasks(criteria) {
      await requireTasks()
      const page = await client.get<PegiiTaskSearchPageDto>('/api/v1/pegii/tasks', {
        taskType: criteria.taskType,
        open: criteria.open === undefined ? undefined : String(criteria.open),
        dueBefore: criteria.dueBefore,
        cursor: criteria.cursor,
        limit: criteria.limit,
      })
      const next = page?.nextCursor ?? null
      return {
        items: (page?.items ?? []).map(pegiiTaskToRecord),
        nextCursor: next === null ? null : String(next),
      }
    },

    async createTask(orderNumber, input) {
      await requireTasks()
      if (!isPegiiInt(orderNumber)) {
        return { found: false, code: 'ORDER_NOT_FOUND', message: `Order ${orderNumber} not found` }
      }
      const body: PegiiCreateTaskBody = {
        taskType: input.taskType,
        title: input.title,
        dueDate: input.dueDate,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assigneeCode !== undefined ? { assigneeCode: input.assigneeCode } : {}),
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      }
      try {
        const result = await client.post<PegiiCreateTaskResultDto>(
          `/api/v1/pegii/orders/${orderNumber}/tasks`,
          body,
        )
        return {
          found: true,
          task: pegiiTaskToRecord(result.task),
          alreadyExists: result.alreadyExists,
        }
      } catch (err) {
        // Keep pegII's code (ORDER_NOT_FOUND) rather than the boundary's generic NOT_FOUND.
        if (isPegiiNotFound(err) && err instanceof PegiiApiError) {
          return { found: false, code: err.upstreamCode ?? 'ORDER_NOT_FOUND', message: err.message }
        }
        throw err
      }
    },

    async closeTask(taskId, reason) {
      await requireTasks()
      if (!isPegiiInt(taskId)) return null
      const result = await orNull(() =>
        client.post<PegiiCloseTaskResultDto>(
          `/api/v1/pegii/tasks/${taskId}/close`,
          reason === null ? {} : { reason },
        ),
      )
      return result === null
        ? null
        : { task: pegiiTaskToRecord(result.task), alreadyClosed: result.alreadyClosed }
    },
  }
}
