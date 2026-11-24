// ---------------------------------------------------------------------------
// Delivering a closed task to the Workflows waiting on it (task queue Phase
// 3b, D5): signal each `waiting` TaskAwait's run with the reserved
// `pegasus.task_closed`, carrying the task in its wire shape (toTaskResponse —
// the same shape POST /tasks/:id/await answers for an already-closed task).
//
// Two callers:
//   - a cloud close, AFTER it commits (cloud-task.gateway's `onClosed`, wired
//     by the gateway factory) — best-effort and inline;
//   - the sweeper (step 6) — redelivery of cloud waiters a close couldn't
//     reach, and legacy tasks its poll finds closed.
//
// Outcome per waiter:
//   SIGNALLED                          → delivered
//   TERMINAL / NOT_RUNNING / NOT_DURABLE, or the run / workflow row is gone
//                                      → abandoned (nothing will ever take it)
//   NOT_STARTED / SIGNAL_FAILED / threw → stays waiting, attempts + 1,
//                                         lastError; the sweeper retries
//
// Never throws: a failed delivery must never fail the close that caused it.
// Every row write is conditional on `waiting` (task-await.repository.ts), so a
// delivery racing another (a close and a sweeper tick) can't regress a row.
// The Workflow side dedupes on task id, so a double signal is harmless.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { TaskRecord } from '../gateways/task.gateway'
import { createTaskAwaitRepository, type TaskAwaitRow } from '../repositories/task-await.repository'
import { createWorkflowExecutionRepository } from '../repositories/workflow-execution.repository'
import { createWorkflowRepository } from '../repositories/workflow.repository'
import { TASK_CLOSED_SIGNAL, signalPlatformExecution } from './signal-workflow-execution'
import { toTaskResponse } from './task-response'
import { logger } from './logger'

export type TaskAwaitDeliveryOutcome = 'delivered' | 'abandoned' | 'failed'

export interface TaskWaitersNotified {
  delivered: number
  abandoned: number
  failed: number
}

/** Deliver a CLOSED task to one waiter. Never throws. */
export async function deliverTaskClosed(
  db: PrismaClient,
  tenantId: string,
  awaiter: TaskAwaitRow,
  task: TaskRecord,
): Promise<TaskAwaitDeliveryOutcome> {
  const awaits = createTaskAwaitRepository(db, tenantId)
  const context = {
    tenantId,
    awaitId: awaiter.id,
    executionId: awaiter.executionId,
    store: awaiter.store,
    taskId: awaiter.taskId,
  }
  const abandon = async (reason: string): Promise<TaskAwaitDeliveryOutcome> => {
    await awaits.markAbandoned(awaiter.id, reason)
    logger.info('task await abandoned', { ...context, reason })
    return 'abandoned'
  }
  const fail = async (error: string): Promise<TaskAwaitDeliveryOutcome> => {
    await awaits.recordFailure(awaiter.id, error)
    logger.warn('task await delivery failed; the sweeper retries', { ...context, error })
    return 'failed'
  }

  try {
    const execution = await createWorkflowExecutionRepository(db).findByIdForTenant(
      awaiter.executionId,
      tenantId,
    )
    if (!execution) return await abandon('EXECUTION_NOT_FOUND')
    const workflow = await createWorkflowRepository(db).findByIdForTenant(
      execution.workflowId,
      tenantId,
      { includeRetired: true },
    )
    if (!workflow) return await abandon('WORKFLOW_NOT_FOUND')

    const result = await signalPlatformExecution(db, {
      workflow,
      execution,
      signalName: TASK_CLOSED_SIGNAL,
      args: [toTaskResponse(task)],
    })
    switch (result.outcome) {
      case 'SIGNALLED':
        await awaits.markDeliveredById(awaiter.id)
        logger.info('task await delivered', context)
        return 'delivered'
      case 'TERMINAL':
      case 'NOT_RUNNING':
      case 'NOT_DURABLE':
        return await abandon(result.outcome)
      case 'NOT_STARTED':
        return await fail('NOT_STARTED')
      case 'SIGNAL_FAILED':
        return await fail(`SIGNAL_FAILED: ${result.message}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      return await fail(`ERROR: ${message}`)
    } catch (recordErr) {
      logger.error('task await delivery failed and could not be recorded', {
        ...context,
        error: message,
        recordError: recordErr instanceof Error ? recordErr.message : String(recordErr),
      })
      return 'failed'
    }
  }
}

/**
 * Signal every `waiting` awaiter of a task that just CLOSED (a cloud close,
 * after commit). Sequential — a task has a handful of waiters at most. Never
 * throws; returns the tally.
 */
export async function notifyTaskWaiters(
  db: PrismaClient,
  tenantId: string,
  task: TaskRecord,
): Promise<TaskWaitersNotified> {
  const tally: TaskWaitersNotified = { delivered: 0, abandoned: 0, failed: 0 }
  if (task.status !== 'closed') return tally
  let waiters: TaskAwaitRow[]
  try {
    waiters = await createTaskAwaitRepository(db, tenantId).listWaitingForTask(task.store, task.id)
  } catch (err) {
    // Nothing recorded on any row: they stay `waiting`, and the sweeper's
    // redelivery lane finds them by the closed task.
    logger.error('task waiters could not be listed; the sweeper redelivers', {
      tenantId,
      store: task.store,
      taskId: task.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return tally
  }
  for (const awaiter of waiters) {
    tally[await deliverTaskClosed(db, tenantId, awaiter, task)] += 1
  }
  if (waiters.length > 0) {
    logger.info('task waiters notified', { tenantId, store: task.store, taskId: task.id, ...tally })
  }
  return tally
}
