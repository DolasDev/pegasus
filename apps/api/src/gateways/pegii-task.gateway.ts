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
// are `{n:int}`/`{id:int}`, so the handler validates before calling here.
// ---------------------------------------------------------------------------

import type { TaskGateway } from './task.gateway'
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
  PegiiCreateTaskResultDto,
  PegiiOrderTasksDto,
  PegiiTaskDto,
  PegiiTaskSearchPageDto,
} from './pegii/pegii-task.dto'

export interface PegiiTaskGatewayOptions {
  tenantId: string
  baseUrl: string
  apiKey?: string | null
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
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
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
    async listOrderTasks(orderNumber) {
      await requireTasks()
      const page = await orNull(() =>
        client.get<PegiiOrderTasksDto>(`/api/v1/pegii/orders/${orderNumber}/tasks`),
      )
      return page === null ? null : (page.items ?? [])
    },

    async getTask(taskId) {
      await requireTasks()
      return orNull(() => client.get<PegiiTaskDto>(`/api/v1/pegii/tasks/${taskId}`))
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
      return { items: page?.items ?? [], nextCursor: page?.nextCursor ?? null }
    },

    async createTask(orderNumber, body) {
      await requireTasks()
      try {
        const result = await client.post<PegiiCreateTaskResultDto>(
          `/api/v1/pegii/orders/${orderNumber}/tasks`,
          body,
        )
        return { found: true, ...result }
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
      return orNull(() =>
        client.post<PegiiCloseTaskResultDto>(
          `/api/v1/pegii/tasks/${taskId}/close`,
          reason === null ? {} : { reason },
        ),
      )
    },
  }
}
