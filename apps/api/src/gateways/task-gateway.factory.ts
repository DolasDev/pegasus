// ---------------------------------------------------------------------------
// TaskGateway factory — resolves a tenant to a live gateway for ONE store.
//
// Which store a call needs is decided first (lib/task-routing.ts: a create's
// role, or an id's shape), and only that store is built. So a cloud-routed call
// never needs a pegII target, and a legacy-routed one fails exactly as before:
//
//   - legacy: a tenant with no reachable pegII target throws
//     PegiiApiError('PEGII_API_NOT_CONFIGURED', ...) (→ 503) rather than serving
//     invented rows. Same shape as order-gateway.factory.ts.
//   - cloud: WorkItem rows. A NEW create checks the order exists through the
//     order gateway when the tenant has a pegII peer at all; a tenant with none
//     has nothing to check against, so the check is skipped. A peer that exists
//     but is down fails the create loudly (503), never a silent unchecked row.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { PegiiCaller } from '../lib/pegii-request-context'
import type { TaskGateway, TaskStore } from './task.gateway'
import { createPegiiTaskGateway } from './pegii-task.gateway'
import { createCloudTaskGateway } from './cloud-task.gateway'
import { resolveOrderGateway } from './order-gateway.factory'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'
import { notifyTaskWaiters } from '../lib/task-await-delivery'

export interface TaskGatewayContext {
  db: PrismaClient
  tenantId: string
  /** Resolves the calling principal + company; invoked only when a pegII gateway is built. */
  callerOf?: () => Promise<PegiiCaller>
  /** The acting TenantUser, recorded on cloud closes. */
  actorUserId?: string | null
}

/** The legacy (pegII) task gateway. Throws PEGII_API_NOT_CONFIGURED without a reachable target. */
export async function resolveTaskGateway(
  db: PrismaClient,
  tenantId: string,
  callerOf?: () => Promise<PegiiCaller>,
): Promise<TaskGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII task source unavailable — no fallback permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII task source: ${resolved.message}`,
    )
  }

  return createPegiiTaskGateway({
    tenantId,
    baseUrl: resolved.target.base,
    ...(callerOf ? { caller: await callerOf() } : {}),
  })
}

/**
 * Does the tenant have a legacy task store at all? False only when it has no
 * pegII peer configured. A configured peer that is down is still "has one" —
 * the read then fails loudly rather than answering a silent half-list.
 */
export async function hasLegacyTaskStore(db: PrismaClient, tenantId: string): Promise<boolean> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  return resolved.ok || resolved.code !== 'PEGII_API_NO_PEER'
}

/** The cloud (WorkItem) task gateway. Never touches pegII except for a new create's order check. */
export function resolveCloudTaskGateway(ctx: TaskGatewayContext): TaskGateway {
  const { db, tenantId } = ctx
  return createCloudTaskGateway({
    db,
    tenantId,
    actorUserId: ctx.actorUserId ?? null,
    // Signal the Workflows awaiting the task (task queue Phase 3b, D5).
    onClosed: (task) => notifyTaskWaiters(db, tenantId, task),
    orderExists: async (orderNum) => {
      if (!(await hasLegacyTaskStore(db, tenantId))) return true
      const orders = await resolveOrderGateway(db, tenantId, ctx.callerOf)
      return (await orders.findOrderById(String(orderNum))) !== null
    },
  })
}

/** The gateway for one store. Only that store is resolved. */
export async function resolveTaskGatewayForStore(
  store: TaskStore,
  ctx: TaskGatewayContext,
): Promise<TaskGateway> {
  return store === 'cloud'
    ? resolveCloudTaskGateway(ctx)
    : resolveTaskGateway(ctx.db, ctx.tenantId, ctx.callerOf)
}
