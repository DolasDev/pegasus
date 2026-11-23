// ---------------------------------------------------------------------------
// What the task routes need around the two task stores (task queue plan
// Phase 3a step 5). The handler (handlers/pegii-runtime.ts) stays thin: it
// validates, asks this module which store and which assignee, and calls one
// gateway.
//
//   - routing: the tenant's `taskRouting` (lib/task-routing.ts decides).
//   - the merged order list: both stores, legacy first; legacy is skipped only
//     when the tenant has no pegII peer at all, and a configured-but-failing
//     legacy read fails the call (never a silent half-list).
//   - the `operations` assignee: the move's dispatcher (lib/move-dispatcher.ts).
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { getAppSettings } from './app-settings'
import { resolvePegiiCaller } from './pegii-request-context'
import type { TaskRouting } from './task-routing'
import {
  hasLegacyTaskStore,
  resolveCloudTaskGateway,
  resolveTaskGateway,
  type TaskGatewayContext,
} from '../gateways/task-gateway.factory'
import type { TaskAssignee, TaskRecord } from '../gateways/task.gateway'
import { createCompanyRepository } from '../repositories/company.repository'
import {
  legacyOperationsIdReader,
  MoveDispatcherUnavailableError,
  resolveMoveDispatcher,
  type MoveDispatcher,
} from './move-dispatcher'

/** The gateway context for this request: tenant, caller (pegII only), and the acting user. */
export function taskGatewayContext(c: Context<AppEnv>): TaskGatewayContext {
  const apiClient = c.get('apiClient')
  return {
    db: c.get('db'),
    tenantId: c.get('tenantId'),
    callerOf: () => resolvePegiiCaller(c),
    actorUserId: apiClient?.actsAsUserId ?? c.get('userId') ?? null,
  }
}

/** The tenant's per-role task routing; null when it has none. */
export async function taskRoutingFor(
  db: PrismaClient,
  tenantId: string,
): Promise<TaskRouting | null> {
  const settings = await getAppSettings(db, tenantId)
  return settings.operations.taskRouting ?? null
}

/**
 * Every task on an order, from both stores (legacy first). Null only when the
 * legacy store says the order doesn't exist AND the cloud has no task on it.
 */
export async function listOrderTasksAllStores(
  ctx: TaskGatewayContext,
  orderId: string,
): Promise<TaskRecord[] | null> {
  const cloud = (await resolveCloudTaskGateway(ctx).listOrderTasks(orderId)) ?? []
  if (!(await hasLegacyTaskStore(ctx.db, ctx.tenantId))) return cloud
  const legacyGateway = await resolveTaskGateway(ctx.db, ctx.tenantId, ctx.callerOf)
  const legacy = await legacyGateway.listOrderTasks(orderId)
  if (legacy === null) return cloud.length > 0 ? cloud : null
  return [...legacy, ...cloud]
}

/** The `operations` dispatcher could not be read (the tunnel or executor failed). */
export class DispatcherUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `the move's dispatcher could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = 'DispatcherUnavailableError'
  }
}

/**
 * The move's dispatcher for an `operations` task. A tenant with no legacy
 * database has no dispatchers (found: false). Any other failure throws
 * DispatcherUnavailableError — a task must not silently lose its owner.
 */
export async function moveDispatcherFor(
  ctx: TaskGatewayContext,
  orderNum: number,
): Promise<MoveDispatcher> {
  const target = await createCompanyRepository(ctx.db).getDefaultTarget()
  try {
    return await resolveMoveDispatcher({
      db: ctx.db,
      tenantId: ctx.tenantId,
      companyId: target?.company.id ?? null,
      orderNum,
      readOperationsId: legacyOperationsIdReader(ctx.tenantId),
    })
  } catch (err) {
    if (err instanceof MoveDispatcherUnavailableError) return { found: false }
    throw new DispatcherUnavailableError(err)
  }
}

/** A cloud `operations` task's assignee, from the move's dispatcher (D4). */
export function cloudAssigneeFrom(dispatcher: MoveDispatcher): TaskAssignee {
  if (!dispatcher.found) return { userId: null, employeeCode: null, unresolved: 'NO_DISPATCHER' }
  return {
    userId: dispatcher.tenantUserId,
    employeeCode: dispatcher.employeeCode,
    unresolved: dispatcher.tenantUserId === null ? 'DISPATCHER_NOT_LINKED' : null,
  }
}
