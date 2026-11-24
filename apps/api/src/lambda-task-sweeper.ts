// ---------------------------------------------------------------------------
// Scheduled Lambda — the task-await sweeper (task queue Phase 3b, D6). Every
// 5 minutes (EventBridge rule in the CDK ApiStack) it moves TaskAwait rows —
// durable Workflows waiting in `await_task` — toward `delivered` or
// `abandoned`. Three lanes, in this order:
//
//   (c) CLEANUP — a `waiting` awaiter whose run has ended is `abandoned`
//       (EXECUTION_ENDED). First, so the lanes below never poll or signal for a
//       dead run.
//   (a) CLOUD REDELIVERY — a backstop. A close signals its waiters inline
//       (lib/task-await-delivery.ts); this lane catches the ones it couldn't
//       reach (Temporal down, a run not yet started) and any that registered
//       while the close ran. Due `waiting` cloud awaiters (`nextPollAt <= now`
//       or null), at most CLOUD_REDELIVERY_BATCH, their WorkItems looked up by
//       (tenant, id): closed → delivered; still open → re-checked in
//       CLOUD_RECHECK_MS (so open waits rotate and never starve the batch);
//       closed under REDELIVERY_GRACE_MS ago → left to the close itself.
//   (b) LEGACY POLL — legacy tasks have no close hook, so the sweeper polls:
//       `waiting` legacy awaiters due (`nextPollAt <= now`), grouped by
//       (tenant, order), at most LEGACY_ORDERS_PER_TICK orders, one
//       `listOrderTasks` per order. Closed → delivered; still open → polled
//       again in LEGACY_POLL_INTERVAL_MS; gone from the order → abandoned
//       (TASK_NOT_FOUND); a failed poll → attempts + 1, retried next interval.
//
// Identity (D7): a legacy poll is a pegII read, and pegII tokens need a
// subject (lib/pegii-token.ts refuses PEGII_PRINCIPAL_UNRESOLVED), so each
// poll acts as an awaiting Workflow's own runtime service account (its runtime
// ApiClient's acts-as TenantUser) — attributed to the Workflow that waits, and
// read-only. The pegII caller is built on a tenant-SCOPED client
// (buildPegiiCaller's default-company lookup has no tenantId of its own).
// Calls go through the tunnel-proxy Lambda, so this Lambda needs no VPC.
//
// Cross-tenant by design, like the reconciler: the root `db`, with tenantId
// named on every per-tenant query. Every row write is conditional on
// `waiting` (repositories/task-await.repository.ts), so a tick racing a close
// can't regress a row; the Workflow dedupes a double signal by task id.
//
// A time budget bounds a tick: no new order or redelivery starts after it.
// No raw SQL (db-access-guard): TaskAwait has no FK to WorkItem (taskId is
// shared with the legacy store), so lane (a) reads due awaiters, then their
// WorkItems, rather than joining.
// ---------------------------------------------------------------------------

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { db as rootDb } from './db'
import { createLogger } from './lib/logger'
import { createTenantDb } from './lib/prisma'
import { buildPegiiCaller, type PegiiCaller } from './lib/pegii-request-context'
import { deliverTaskClosed, type TaskAwaitDeliveryOutcome } from './lib/task-await-delivery'
import { resolveTaskGateway } from './gateways/task-gateway.factory'
import { workItemToRecord } from './gateways/cloud-task.gateway'
import type { TaskGateway } from './gateways/task.gateway'
import { createTaskAwaitRepository } from './repositories/task-await.repository'
import { TERMINAL_STATUSES } from './repositories/workflow-execution.repository'

const logger = createLogger('pegasus-task-sweeper')
const cloudwatch = new CloudWatchClient({})

// Duplicated literally in packages/infra/lib/metrics.ts (apps/api can't import
// @pegasus/infra). Keep both sides in sync.
const METRIC_NAMESPACE = 'Pegasus/Workflows'
export const TASK_AWAIT_METRICS = {
  delivered: 'TaskAwaitDelivered',
  abandoned: 'TaskAwaitAbandoned',
  failed: 'TaskAwaitDeliveryFailed',
  pollFailed: 'TaskAwaitLegacyPollFailed',
} as const

/** Cloud awaiters redelivered per tick. */
export const CLOUD_REDELIVERY_BATCH = 100
/** How soon an open cloud task's awaiter is re-checked by the backstop. */
export const CLOUD_RECHECK_MS = 15 * 60 * 1000
/** Leave a just-closed task to its own close-time delivery. */
export const REDELIVERY_GRACE_MS = 60 * 1000
/** Distinct (tenant, order) legacy polls per tick. */
export const LEGACY_ORDERS_PER_TICK = 50
/** How soon an open legacy task (or a failed poll) is polled again. */
export const LEGACY_POLL_INTERVAL_MS = 15 * 60 * 1000
/** Past this many failed attempts a waiter is logged as stuck every tick (never abandoned:
 * once Temporal / the tunnel recover, the next attempt succeeds). */
export const STUCK_ATTEMPTS = 12
/** Stop starting new work this long into a tick (the Lambda timeout is longer). */
export const DEFAULT_BUDGET_MS = 4 * 60 * 1000

export interface SweepCounts {
  abandonedEnded: number
  cloud: Record<TaskAwaitDeliveryOutcome, number>
  /** Cloud awaiters whose task is still open, pushed back one re-check interval. */
  cloudDeferred: number
  legacy: Record<TaskAwaitDeliveryOutcome | 'deferred', number>
  legacyOrdersPolled: number
  legacyPollFailures: number
  budgetExhausted: boolean
}

export interface SweepOptions {
  db?: PrismaClient
  now?: () => Date
  budgetMs?: number
  /**
   * Sweep only these tenants (every lane). Default: all. Tests use it so a
   * cross-tenant sweep can't touch other suites' rows in a shared database;
   * also an operator's one-tenant sweep.
   */
  onlyTenantIds?: string[]
  /** The legacy gateway for a tenant (test seam). Default: resolveTaskGateway. */
  legacyGateway?: (
    tenantDb: PrismaClient,
    tenantId: string,
    callerOf: () => Promise<PegiiCaller>,
  ) => Promise<TaskGateway>
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** One sweep. Never throws for a single row or order; returns the tally. */
export async function sweepTaskAwaits(opts: SweepOptions = {}): Promise<SweepCounts> {
  const db = opts.db ?? (rootDb as unknown as PrismaClient)
  const now = opts.now ?? (() => new Date())
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const overBudget = () => Date.now() - startedAt > budgetMs
  const scope = opts.onlyTenantIds ? { tenantId: { in: opts.onlyTenantIds } } : {}
  const legacyGateway =
    opts.legacyGateway ??
    ((tenantDb, tenantId, callerOf) => resolveTaskGateway(tenantDb, tenantId, callerOf))

  const counts: SweepCounts = {
    abandonedEnded: 0,
    cloud: { delivered: 0, abandoned: 0, failed: 0 },
    cloudDeferred: 0,
    legacy: { delivered: 0, abandoned: 0, failed: 0, deferred: 0 },
    legacyOrdersPolled: 0,
    legacyPollFailures: 0,
    budgetExhausted: false,
  }

  // (c) CLEANUP. Each row is judged by its own run (the FK), so one
  // cross-tenant statement is safe.
  const ended = await db.taskAwait.updateMany({
    where: {
      ...scope,
      status: 'waiting',
      execution: { status: { in: [...TERMINAL_STATUSES] } },
    },
    data: { status: 'abandoned', lastError: 'EXECUTION_ENDED', nextPollAt: null },
  })
  counts.abandonedEnded = ended.count

  // (a) CLOUD REDELIVERY.
  const tickNow = now()
  const graceCutoff = new Date(tickNow.getTime() - REDELIVERY_GRACE_MS)
  const dueCloud = await db.taskAwait.findMany({
    where: {
      ...scope,
      store: 'cloud',
      status: 'waiting',
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: tickNow } }],
    },
    orderBy: { nextPollAt: { sort: 'asc', nulls: 'first' } },
    take: CLOUD_REDELIVERY_BATCH,
  })
  const byTenant = new Map<string, typeof dueCloud>()
  for (const awaiter of dueCloud) {
    byTenant.set(awaiter.tenantId, [...(byTenant.get(awaiter.tenantId) ?? []), awaiter])
  }
  for (const [tenantId, awaiters] of byTenant) {
    if (counts.budgetExhausted) break
    const items = await db.workItem.findMany({
      where: { tenantId, id: { in: [...new Set(awaiters.map((a) => a.taskId))] } },
    })
    const itemById = new Map(items.map((i) => [i.id, i]))
    const stillOpen: string[] = []
    for (const awaiter of awaiters) {
      if (overBudget()) {
        counts.budgetExhausted = true
        break
      }
      const item = itemById.get(awaiter.taskId)
      if (!item) {
        // WorkItems are never deleted on their own (only with their tenant,
        // which cascades the awaiter too): defensive.
        await createTaskAwaitRepository(db, tenantId).markAbandoned(awaiter.id, 'TASK_NOT_FOUND')
        counts.cloud.abandoned += 1
        continue
      }
      const record = workItemToRecord(item)
      if (record.status !== 'closed') {
        stillOpen.push(awaiter.id)
        continue
      }
      if (item.updatedAt >= graceCutoff) continue // the close is still delivering it
      warnIfStuck(awaiter)
      counts.cloud[await deliverTaskClosed(db, tenantId, awaiter, record)] += 1
    }
    counts.cloudDeferred += await createTaskAwaitRepository(db, tenantId).deferPoll(
      stillOpen,
      new Date(tickNow.getTime() + CLOUD_RECHECK_MS),
    )
  }

  // (b) LEGACY POLL. Due (tenant, order) pairs, least recently polled first.
  const nowDate = tickNow
  const orders = await db.taskAwait.groupBy({
    by: ['tenantId', 'orderNum'],
    where: {
      ...scope,
      store: 'legacy',
      status: 'waiting',
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: nowDate } }],
    },
    _min: { nextPollAt: true },
    orderBy: { _min: { nextPollAt: 'asc' } },
    take: LEGACY_ORDERS_PER_TICK,
  })
  for (const { tenantId, orderNum } of orders) {
    if (overBudget()) {
      counts.budgetExhausted = true
      break
    }
    await pollLegacyOrder({ db, tenantId, orderNum, now: nowDate, legacyGateway, counts })
  }

  logger.info('Task await sweep finished', {
    ...counts,
    cloudRedeliveryScanned: dueCloud.length,
    legacyOrdersDue: orders.length,
    elapsedMs: Date.now() - startedAt,
  })
  if (counts.budgetExhausted) {
    logger.warn('Task await sweep hit its time budget; the next tick continues', { budgetMs })
  }
  return counts
}

function warnIfStuck(awaiter: {
  id: string
  tenantId: string
  attempts: number
  lastError: string | null
}) {
  if (awaiter.attempts >= STUCK_ATTEMPTS) {
    logger.error('Task await stuck: delivery keeps failing', {
      awaitId: awaiter.id,
      tenantId: awaiter.tenantId,
      attempts: awaiter.attempts,
      lastError: awaiter.lastError,
    })
  }
}

/**
 * The TenantUser a legacy poll acts as: the runtime ApiClient's acts-as
 * service account of the first waiter's Workflow, in THIS tenant. Null when it
 * can't be resolved (never a guessed identity).
 */
async function actingUserFor(
  db: PrismaClient,
  tenantId: string,
  executionIds: string[],
): Promise<string | null> {
  const executions = await db.workflowExecution.findMany({
    where: { id: { in: executionIds }, tenantId },
    select: { workflow: { select: { runtimeApiClientId: true } } },
  })
  for (const execution of executions) {
    const clientId = execution.workflow.runtimeApiClientId
    if (!clientId) continue
    const client = await db.apiClient.findFirst({
      where: { id: clientId, tenantId, revokedAt: null },
      select: { actsAsUserId: true },
    })
    if (client?.actsAsUserId) return client.actsAsUserId
  }
  return null
}

async function pollLegacyOrder(args: {
  db: PrismaClient
  tenantId: string
  orderNum: number
  now: Date
  legacyGateway: NonNullable<SweepOptions['legacyGateway']>
  counts: SweepCounts
}): Promise<void> {
  const { db, tenantId, orderNum, now, counts } = args
  const awaits = createTaskAwaitRepository(db, tenantId)
  const awaiters = await awaits.listDueLegacyForOrder(orderNum, now)
  if (awaiters.length === 0) return
  const nextPoll = new Date(now.getTime() + LEGACY_POLL_INTERVAL_MS)
  const context = { tenantId, orderNum, awaiters: awaiters.length }

  const failAll = async (error: string) => {
    counts.legacyPollFailures += 1
    for (const awaiter of awaiters) {
      warnIfStuck(awaiter)
      await awaits.recordFailure(awaiter.id, error, nextPoll)
    }
    logger.warn('Legacy task poll failed; retried next interval', { ...context, error })
  }

  let tasks: Awaited<ReturnType<TaskGateway['listOrderTasks']>>
  try {
    const tenantUserId = await actingUserFor(
      db,
      tenantId,
      awaiters.map((a) => a.executionId),
    )
    if (!tenantUserId) return await failAll('RUNTIME_ACCOUNT_UNRESOLVED')
    const tenantDb = createTenantDb(db, tenantId) as unknown as PrismaClient
    const correlationId = `task-sweeper-${randomUUID()}`
    const gateway = await args.legacyGateway(tenantDb, tenantId, () =>
      buildPegiiCaller(tenantDb, { tenantId, tenantUserId, correlationId }),
    )
    counts.legacyOrdersPolled += 1
    tasks = await gateway.listOrderTasks(String(orderNum))
  } catch (err) {
    return await failAll(`POLL_FAILED: ${errorMessage(err)}`)
  }

  const stillOpen: string[] = []
  for (const awaiter of awaiters) {
    const task = tasks?.find((t) => t.store === 'legacy' && t.id === awaiter.taskId) ?? null
    if (task === null) {
      // The order or the task is gone (deleted in MoveManager): nothing will
      // ever close it, so stop polling. The Workflow's await_task timeout (or
      // its lifetime cap) ends its wait.
      await awaits.markAbandoned(awaiter.id, tasks === null ? 'ORDER_NOT_FOUND' : 'TASK_NOT_FOUND')
      counts.legacy.abandoned += 1
      logger.warn('Legacy task awaited but no longer on its order; abandoned', {
        tenantId,
        orderNum,
        awaitId: awaiter.id,
        taskId: awaiter.taskId,
      })
      continue
    }
    if (task.status === 'closed') {
      counts.legacy[await deliverTaskClosed(db, tenantId, awaiter, task)] += 1
    } else {
      stillOpen.push(awaiter.id)
    }
  }
  counts.legacy.deferred += await awaits.deferPoll(stillOpen, nextPoll)
}

async function emitMetrics(counts: SweepCounts): Promise<void> {
  const values: Array<[string, number]> = [
    [TASK_AWAIT_METRICS.delivered, counts.cloud.delivered + counts.legacy.delivered],
    [
      TASK_AWAIT_METRICS.abandoned,
      counts.abandonedEnded + counts.cloud.abandoned + counts.legacy.abandoned,
    ],
    [TASK_AWAIT_METRICS.failed, counts.cloud.failed + counts.legacy.failed],
    [TASK_AWAIT_METRICS.pollFailed, counts.legacyPollFailures],
  ]
  const timestamp = new Date()
  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: METRIC_NAMESPACE,
      MetricData: values.map(([MetricName, Value]) => ({
        MetricName,
        Value,
        Unit: 'Count',
        Timestamp: timestamp,
      })),
    }),
  )
}

export async function handler(): Promise<SweepCounts> {
  const counts = await sweepTaskAwaits()
  try {
    await emitMetrics(counts)
  } catch (err) {
    logger.warn('Task sweeper metrics not emitted', { error: errorMessage(err) })
  }
  return counts
}
