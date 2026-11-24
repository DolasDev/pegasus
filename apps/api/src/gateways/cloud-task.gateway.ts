// ---------------------------------------------------------------------------
// Cloud-backed TaskGateway — the platform's own task store (`WorkItem` rows;
// task queue plan Phase 3a, TQ-D2/TQ-D4). The other store is legacy pegII
// (pegii-task.gateway.ts); which one a (tenant, role) uses is decided by the
// router, never here.
//
// Contract parity with the legacy store (one test table runs against both):
//   - `idempotencyKey`: the same key with the same request answers the
//     original task with `alreadyExists: true`; with a different request,
//     409 IDEMPOTENCY_KEY_REUSED.
//   - A repeat close answers `alreadyClosed: true`.
//   - An unknown order is `found: false, ORDER_NOT_FOUND` — when the caller
//     supplies an order check (`orderExists`); a tenant with no pegII target
//     has nothing to check against, so the factory passes none.
//   - Ids this store can't hold (anything but a UUID) are simply not found.
//
// Every query names `tenantId` itself, so the gateway is isolated on the root
// client too; the tenant-scoped client (WorkItem is in TENANT_SCOPED_MODELS)
// is a second backstop.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient, type WorkItem } from '@prisma/client'
import {
  TaskStoreError,
  type TaskCreateInput,
  type TaskGateway,
  type TaskRecord,
  type TaskAssigneeUnresolved,
} from './task.gateway'
import { isPegiiInt } from './pegii-task.gateway'
import { logger } from '../lib/logger'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Page size when the caller names none. */
export const CLOUD_TASK_SEARCH_DEFAULT_LIMIT = 100

export interface CloudTaskGatewayOptions {
  db: PrismaClient
  tenantId: string
  /** The TenantUser acting (recorded as `closedBy`); null for a caller with no user row. */
  actorUserId?: string | null
  /**
   * Does the pegII order exist? Called once per NEW create (never on an
   * idempotent replay, never on a read). Absent = no check.
   */
  orderExists?: (orderNumber: number) => Promise<boolean>
  /**
   * Called once, AFTER the close is written, when THIS call closed the task
   * (never on a repeat close, or when a concurrent close won). The factory
   * wires it to signal the Workflows awaiting the task (lib/task-await-
   * delivery.ts). Best-effort: if it throws, the close still succeeds.
   */
  onClosed?: (task: TaskRecord) => Promise<unknown>
  /** Test seam. */
  now?: () => Date
}

const isoDay = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10))
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

/** A WorkItem row → the neutral TaskRecord (`store: 'cloud'`). */
export function workItemToRecord(row: WorkItem): TaskRecord {
  const closed = row.status === 'done' || row.status === 'cancelled'
  return {
    store: 'cloud',
    id: row.id,
    orderId: String(row.orderNum),
    taskType: row.taskType,
    title: row.title,
    description: row.description,
    priority: row.priority,
    dueDate: isoDay(row.dueDate),
    assigneeCode: row.assigneeEmployeeCode,
    status: closed ? 'closed' : 'open',
    reason: row.closeReason,
    createdByApi: true,
    active: true,
    completedAt: iso(row.doneAt),
    completedBy: null,
    actualDate: null,
    createdAt: iso(row.createdAt),
    closedAt: iso(row.doneAt ?? row.cancelledAt),
    role: row.owningRole,
    assigneeUnresolved: row.assigneeUnresolved as TaskAssigneeUnresolved | null,
  }
}

/** The request fields idempotency compares; a replay must match all of them. */
function requestHash(orderNum: number, input: TaskCreateInput): string {
  const canonical = JSON.stringify([
    orderNum,
    input.taskType,
    input.title,
    input.description ?? null,
    input.priority ?? 'normal',
    input.dueDate ?? null,
    input.role ?? null,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

/** Keyset cursor over (createdAt, id): opaque base64url of `<iso>|<uuid>`. */
function encodeCursor(row: WorkItem): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(at ?? '')
  if (Number.isNaN(createdAt.getTime()) || id === undefined || !UUID_RE.test(id)) {
    throw new TaskStoreError('INVALID_CURSOR', 400, 'cursor is not one this search returned')
  }
  return { createdAt, id }
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

export function createCloudTaskGateway(opts: CloudTaskGatewayOptions): TaskGateway {
  const { db, tenantId } = opts
  const now = opts.now ?? (() => new Date())

  async function findOne(id: string): Promise<WorkItem | null> {
    if (!UUID_RE.test(id)) return null
    return db.workItem.findFirst({ where: { id, tenantId } })
  }

  /** The replay of an idempotency key: the original, or 409 when the request differs. */
  function replay(existing: WorkItem, hash: string) {
    if (existing.requestHash !== hash) {
      throw new TaskStoreError(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        `dedupKey ${existing.dedupKey} was already used for a different task`,
      )
    }
    return { found: true as const, task: workItemToRecord(existing), alreadyExists: true }
  }

  return {
    store: 'cloud',

    async listOrderTasks(orderNumber) {
      if (!isPegiiInt(orderNumber)) return null
      const rows = await db.workItem.findMany({
        where: { tenantId, orderNum: Number(orderNumber) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return rows.map(workItemToRecord)
    },

    async getTask(taskId) {
      const row = await findOne(taskId)
      return row === null ? null : workItemToRecord(row)
    },

    async searchTasks(criteria) {
      const limit = criteria.limit ?? CLOUD_TASK_SEARCH_DEFAULT_LIMIT
      const after = criteria.cursor === undefined ? null : decodeCursor(criteria.cursor)
      const where: Prisma.WorkItemWhereInput = {
        tenantId,
        taskType: { equals: criteria.taskType, mode: 'insensitive' },
        ...(criteria.open === undefined
          ? {}
          : { status: { in: criteria.open ? ['open', 'blocked'] : ['done', 'cancelled'] } }),
        ...(criteria.dueBefore === undefined
          ? {}
          : { dueDate: { lt: new Date(`${criteria.dueBefore}T00:00:00Z`) } }),
        ...(after === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }),
      }
      const rows = await db.workItem.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      })
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      return {
        items: page.map(workItemToRecord),
        nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last) : null,
      }
    },

    async createTask(orderNumber, input) {
      if (!isPegiiInt(orderNumber)) {
        return { found: false, code: 'ORDER_NOT_FOUND', message: `Order ${orderNumber} not found` }
      }
      if (input.assigneeCode !== undefined) {
        throw new TaskStoreError(
          'UNSUPPORTED_ON_CLOUD_STORE',
          400,
          "assigneeCode is a MoveManager employee code; a cloud task's assignee comes from its role",
        )
      }
      // The router routes a role-less create to legacy, so this is a bug, not a caller error.
      if (input.role === undefined) throw new Error('cloud task create requires a role')

      const orderNum = Number(orderNumber)
      const hash = requestHash(orderNum, input)
      const key = input.idempotencyKey

      if (key !== undefined) {
        const existing = await db.workItem.findFirst({ where: { tenantId, dedupKey: key } })
        if (existing) return replay(existing, hash)
      }

      if (opts.orderExists && !(await opts.orderExists(orderNum))) {
        return { found: false, code: 'ORDER_NOT_FOUND', message: `Order ${orderNumber} not found` }
      }

      try {
        const row = await db.workItem.create({
          data: {
            tenantId,
            orderNum,
            taskType: input.taskType,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'normal',
            owningRole: input.role,
            assigneeUserId: input.assignee?.userId ?? null,
            assigneeEmployeeCode: input.assignee?.employeeCode ?? null,
            assigneeUnresolved: input.assignee?.unresolved ?? null,
            dueDate: input.dueDate === undefined ? null : new Date(`${input.dueDate}T00:00:00Z`),
            dedupKey: key ?? null,
            requestHash: key === undefined ? null : hash,
          },
        })
        return { found: true, task: workItemToRecord(row), alreadyExists: false }
      } catch (err) {
        // Two creates raced on one key: the loser answers as a replay.
        if (key !== undefined && isUniqueViolation(err)) {
          const winner = await db.workItem.findFirst({ where: { tenantId, dedupKey: key } })
          if (winner) return replay(winner, hash)
        }
        throw err
      }
    },

    async closeTask(taskId, reason) {
      const row = await findOne(taskId)
      if (row === null) return null
      if (row.status === 'done' || row.status === 'cancelled') {
        return { task: workItemToRecord(row), alreadyClosed: true }
      }
      // Conditional on still being open, so a concurrent close can't close twice.
      const { count } = await db.workItem.updateMany({
        where: { id: row.id, tenantId, status: { in: ['open', 'blocked'] } },
        data: {
          status: 'done',
          doneAt: now(),
          closeReason: reason,
          closedByUserId: opts.actorUserId ?? null,
        },
      })
      const after = await findOne(taskId)
      if (after === null) return null
      const task = workItemToRecord(after)
      // Post-commit: the update above is its own statement, so any waiter that
      // registered before it is visible here (POST /tasks/:id/await re-reads
      // the task after registering, covering one that registers after).
      if (count === 1 && opts.onClosed) {
        try {
          await opts.onClosed(task)
        } catch (err) {
          logger.error('cloud task onClosed hook failed; the close stands', {
            tenantId,
            taskId: row.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      return { task, alreadyClosed: count === 0 }
    },
  }
}
