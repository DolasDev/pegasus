// ---------------------------------------------------------------------------
// TaskAwait — the awaiter registry (task queue Phase 3b): a durable Workflow
// execution waiting, in the SDK's `await_task`, for a task to close. One table
// for both stores; unique per (execution, store, task).
//
// Every query names `tenantId` itself, so the repository is isolated on the
// root client too (the sweeper runs there). Writes are conditional on
// `status: 'waiting'` wherever a concurrent close or sweeper tick could have
// moved the row on, so nothing clobbers a delivery.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient, type TaskAwait } from '@prisma/client'
import type { TaskStore } from '../gateways/task.gateway'

export type TaskAwaitRow = TaskAwait

export interface RegisterAwaitInput {
  executionId: string
  store: TaskStore
  taskId: string
  orderNum: number
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createTaskAwaitRepository(db: PrismaClient, tenantId: string) {
  const key = (input: { executionId: string; store: TaskStore; taskId: string }) => ({
    tenantId,
    executionId: input.executionId,
    store: input.store,
    taskId: input.taskId,
  })

  /** The (re)armed fields: a fresh wait, polled at once when the task is legacy. */
  const armed = (store: TaskStore) => ({
    status: 'waiting' as const,
    attempts: 0,
    lastError: null,
    deliveredAt: null,
    nextPollAt: store === 'legacy' ? new Date() : null,
  })

  return {
    /**
     * Register (or re-arm) the wait. Idempotent per (execution, store, task):
     * a repeat call — the activity retried — re-arms the same row, and a row
     * already `delivered` / `abandoned` is reset to `waiting` (the Workflow is
     * asking again, so it wants a fresh signal). Two concurrent attempts race
     * the unique key; the loser re-arms the winner's row.
     */
    async registerWaiting(input: RegisterAwaitInput): Promise<TaskAwaitRow> {
      const rearm = async (id: string) =>
        db.taskAwait.update({
          where: { id },
          data: { ...armed(input.store), orderNum: input.orderNum },
        })

      const existing = await db.taskAwait.findFirst({ where: key(input), select: { id: true } })
      if (existing) return rearm(existing.id)
      try {
        return await db.taskAwait.create({
          // tenantId explicit: the scoped client does not rewrite every write.
          data: { ...key(input), orderNum: input.orderNum, ...armed(input.store) },
        })
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        const winner = await db.taskAwait.findFirst({ where: key(input), select: { id: true } })
        if (!winner) throw err
        return rearm(winner.id)
      }
    },

    /**
     * Mark this execution's wait on the task delivered — only while it is
     * still `waiting`. Returns how many rows moved (0 or 1).
     */
    async markDelivered(input: {
      executionId: string
      store: TaskStore
      taskId: string
    }): Promise<number> {
      const { count } = await db.taskAwait.updateMany({
        where: { ...key(input), status: 'waiting' },
        data: { status: 'delivered', deliveredAt: new Date(), nextPollAt: null },
      })
      return count
    },

    async findOne(input: {
      executionId: string
      store: TaskStore
      taskId: string
    }): Promise<TaskAwaitRow | null> {
      return db.taskAwait.findFirst({ where: key(input) })
    },
  }
}
