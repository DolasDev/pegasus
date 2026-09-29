// ---------------------------------------------------------------------------
// WorkflowState repository
//
// Tenant-wide key/value state for running workflows (send ledgers, idempotency
// claims, per-day reservations), keyed by (namespace, key) within a tenant.
//
// Three write modes, because a ledger needs more than last-write-wins:
//
//   - claim (insert-if-absent): a plain `create`. The unique index is the lock,
//     so two overlapping runs racing for one key get exactly one winner. The
//     loser gets `{ outcome: 'exists', current }`. Deliberately NOT inside an
//     interactive transaction: a P2002 there aborts the whole PG transaction.
//   - compare-and-set: `updateMany` filtered on the expected `version`; a count
//     of 0 means someone else wrote first (or the row is gone).
//   - put: unconditional upsert that still bumps `version`.
//
// The model is in TENANT_SCOPED_MODELS, so every read/update/delete below is
// scoped by the Prisma extension. `create` is not rewritten by the extension,
// so tenantId is passed explicitly.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'

export type WorkflowStateRow = {
  id: string
  tenantId: string
  namespace: string
  key: string
  state: Prisma.JsonValue
  version: number
  updatedByUserId: string
  createdAt: Date
  updatedAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  namespace: true,
  key: true,
  state: true,
  version: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

export type ClaimResult =
  { outcome: 'created'; row: WorkflowStateRow } | { outcome: 'exists'; current: WorkflowStateRow }

export type CompareAndSetResult =
  | { outcome: 'updated'; row: WorkflowStateRow }
  | { outcome: 'conflict'; current: WorkflowStateRow | null }

export type DeleteResult =
  | { outcome: 'deleted' }
  | { outcome: 'not_found' }
  | { outcome: 'conflict'; current: WorkflowStateRow }

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createWorkflowStateRepository(db: PrismaClient) {
  const find = (namespace: string, key: string) =>
    db.workflowState.findFirst({ where: { namespace, key }, select: SELECT })

  const create = (input: WriteInput) =>
    db.workflowState.create({
      data: {
        tenantId: input.tenantId,
        namespace: input.namespace,
        key: input.key,
        state: input.state,
        updatedByUserId: input.updatedByUserId,
      },
      select: SELECT,
    })

  return {
    find,

    /**
     * Keyset-paged list of one namespace, ascending by key. `prefix` narrows to
     * keys starting with it (the ledger's "every pulse for order 123" lookup);
     * `cursor` is the last key of the previous page, exclusive.
     */
    async list(
      namespace: string,
      opts: { prefix?: string; updatedSince?: Date; limit: number; cursor?: string },
    ): Promise<WorkflowStateRow[]> {
      const keyFilter: Prisma.StringFilter = {}
      if (opts.prefix) keyFilter.startsWith = opts.prefix
      if (opts.cursor) keyFilter.gt = opts.cursor
      const where: Prisma.WorkflowStateWhereInput = { namespace }
      if (opts.prefix || opts.cursor) where.key = keyFilter
      if (opts.updatedSince) where.updatedAt = { gte: opts.updatedSince }
      return db.workflowState.findMany({
        where,
        orderBy: { key: 'asc' },
        take: opts.limit,
        select: SELECT,
      })
    },

    /** Insert only if the key is free — the atomic claim. */
    async claim(input: WriteInput): Promise<ClaimResult> {
      try {
        return { outcome: 'created', row: await create(input) }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        const current = await find(input.namespace, input.key)
        // Deleted between the failed insert and this read: the caller may retry,
        // but must not be told it won a claim it never made.
        if (!current) throw err
        return { outcome: 'exists', current }
      }
    },

    /** Write only while the stored version still equals `expectedVersion`. */
    async compareAndSet(
      input: WriteInput & { expectedVersion: number },
    ): Promise<CompareAndSetResult> {
      const { count } = await db.workflowState.updateMany({
        where: { namespace: input.namespace, key: input.key, version: input.expectedVersion },
        data: {
          state: input.state,
          version: { increment: 1 },
          updatedByUserId: input.updatedByUserId,
        },
      })
      const current = await find(input.namespace, input.key)
      if (count === 0) return { outcome: 'conflict', current }
      // The row we just wrote; `current` can only be null here if it was deleted
      // in the instant after our update, which a conflict describes correctly.
      if (!current) return { outcome: 'conflict', current: null }
      return { outcome: 'updated', row: current }
    },

    /** Unconditional write; creates the row or overwrites it, bumping version. */
    async put(input: WriteInput): Promise<{ row: WorkflowStateRow; created: boolean }> {
      const data = {
        state: input.state,
        version: { increment: 1 },
        updatedByUserId: input.updatedByUserId,
      }
      const { count } = await db.workflowState.updateMany({
        where: { namespace: input.namespace, key: input.key },
        data,
      })
      if (count === 0) {
        try {
          return { row: await create(input), created: true }
        } catch (err) {
          // Lost a create race: the key now exists, so overwrite it instead.
          if (!isUniqueViolation(err)) throw err
          await db.workflowState.updateMany({
            where: { namespace: input.namespace, key: input.key },
            data,
          })
        }
      }
      const row = await find(input.namespace, input.key)
      if (!row) throw new Error(`workflow state ${input.namespace}/${input.key} vanished mid-write`)
      return { row, created: false }
    },

    /** Delete, optionally only while the stored version equals `expectedVersion`. */
    async remove(namespace: string, key: string, expectedVersion?: number): Promise<DeleteResult> {
      const where: Prisma.WorkflowStateWhereInput = { namespace, key }
      if (expectedVersion !== undefined) where.version = expectedVersion
      const { count } = await db.workflowState.deleteMany({ where })
      if (count > 0) return { outcome: 'deleted' }
      if (expectedVersion === undefined) return { outcome: 'not_found' }
      const current = await find(namespace, key)
      return current ? { outcome: 'conflict', current } : { outcome: 'not_found' }
    },
  }
}

type WriteInput = {
  tenantId: string
  namespace: string
  key: string
  state: Prisma.InputJsonValue
  updatedByUserId: string
}
