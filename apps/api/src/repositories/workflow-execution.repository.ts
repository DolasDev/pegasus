// ---------------------------------------------------------------------------
// WorkflowExecution repository
//
// Manages WorkflowExecution rows — one row per server-side run of a Workflow.
// Always owned by a single tenant (no GLOBAL case, unlike Workflow itself),
// so the model lives in TENANT_SCOPED_MODELS — every read/write below
// automatically picks up the current tenant via the Prisma extension.
//
// Lifecycle: QUEUED → RUNNING → { COMPLETED | FAILED | TIMED_OUT | CANCELLED }.
// The API itself inserts the QUEUED row and transitions to RUNNING after a
// successful `start_workflow` on Temporal Cloud. The worker writes terminal
// transitions back via `PATCH /api/v1/internal/workflow-executions/:id`,
// which calls markStarted / markTerminal here.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status enum as it appears at the API boundary. Mirrors the Prisma enum. */
export type WorkflowExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'

/** Terminal statuses — no transitions out of these. */
export const TERMINAL_STATUSES: ReadonlySet<WorkflowExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
])

/** Execution provenance as it appears at the API boundary. Mirrors the
 * Prisma enum: USER = manual run, EVENT / SCHEDULE = trigger-fired. */
export type WorkflowExecutionTriggerSource = 'USER' | 'EVENT' | 'SCHEDULE'

export type WorkflowExecutionRow = {
  id: string
  tenantId: string
  workflowId: string
  status: WorkflowExecutionStatus
  input: Prisma.JsonValue
  result: Prisma.JsonValue | null
  errorMessage: string | null
  temporalWorkflowId: string | null
  temporalRunId: string | null
  /** Null for trigger-fired executions (triggerSource EVENT / SCHEDULE). */
  triggeredByUserId: string | null
  triggerSource: WorkflowExecutionTriggerSource
  /** WorkflowTrigger.id that fired this execution; null for USER source. */
  triggeredByTriggerId: string | null
  /** True when started in dry-run mode (reads live, mutations captured). */
  dryRun: boolean
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const EXECUTION_SELECT = {
  id: true,
  tenantId: true,
  workflowId: true,
  status: true,
  input: true,
  result: true,
  errorMessage: true,
  temporalWorkflowId: true,
  temporalRunId: true,
  triggeredByUserId: true,
  triggerSource: true,
  triggeredByTriggerId: true,
  dryRun: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createWorkflowExecutionRepository(db: PrismaClient) {
  return {
    /**
     * Insert a new QUEUED execution. `queuedAt` is stamped server-side, not
     * accepted from the caller — keeps the timeline honest if the API clock
     * and the worker clock drift.
     *
     * Provenance defaults to the manual run path (USER, no trigger). The
     * trigger dispatcher (Phase 3 Unit 3) passes EVENT + triggeredByTriggerId
     * with a null triggeredByUserId, plus its deterministic temporalWorkflowId
     * — persisting that id BEFORE the Temporal start is what makes domain-
     * event redelivery idempotent (the dispatcher pre-checks it).
     *
     * Tenant scope is applied implicitly via the extension; the caller still
     * passes tenantId because the column is non-null and the create path is
     * NOT rewritten by the extension (see lib/prisma.ts).
     */
    async create(input: {
      tenantId: string
      workflowId: string
      /** Null for trigger-fired executions (EVENT / SCHEDULE sources). */
      triggeredByUserId: string | null
      triggerSource?: WorkflowExecutionTriggerSource
      /** WorkflowTrigger.id that fired this execution; null for USER source. */
      triggeredByTriggerId?: string | null
      /** Pre-assigned Temporal workflow id (dispatcher); null for manual runs
       * — those only record it at markStarted. */
      temporalWorkflowId?: string | null
      input: Prisma.InputJsonValue
      /** Started in dry-run mode. Defaults false. */
      dryRun?: boolean
    }): Promise<WorkflowExecutionRow> {
      return db.workflowExecution.create({
        data: {
          tenantId: input.tenantId,
          workflowId: input.workflowId,
          triggeredByUserId: input.triggeredByUserId,
          triggerSource: input.triggerSource ?? 'USER',
          triggeredByTriggerId: input.triggeredByTriggerId ?? null,
          temporalWorkflowId: input.temporalWorkflowId ?? null,
          input: input.input,
          dryRun: input.dryRun ?? false,
          status: 'QUEUED',
          queuedAt: new Date(),
        },
        select: EXECUTION_SELECT,
      })
    },

    /**
     * Tenant-scoped fetch. The TENANT_SCOPED_MODELS extension means the
     * tenantId predicate is added implicitly; the explicit id-only query is
     * still safe because the extension AND-merges it on top.
     */
    async findById(executionId: string): Promise<WorkflowExecutionRow | null> {
      return db.workflowExecution.findFirst({
        where: { id: executionId },
        select: EXECUTION_SELECT,
      })
    },

    /**
     * Tenant-scoped paged list of executions for one workflow, newest first.
     *
     * The pagination is keyset-by-id-and-queuedAt: `before` is the id of the
     * last row on the previous page, and the implementation reads its
     * queuedAt timestamp first to anchor the next page. This is robust to
     * inserts during pagination — an offset-based scheme would silently
     * shift items between pages.
     */
    async listByWorkflow(
      workflowId: string,
      opts: { limit: number; before?: string | null },
    ): Promise<WorkflowExecutionRow[]> {
      const limit = Math.max(1, Math.min(opts.limit, 200))
      let cursor: { queuedAt: Date; id: string } | null = null

      if (opts.before) {
        const anchor = await db.workflowExecution.findFirst({
          where: { id: opts.before, workflowId },
          select: { queuedAt: true, id: true },
        })
        if (anchor) cursor = anchor
      }

      return db.workflowExecution.findMany({
        where: cursor
          ? {
              workflowId,
              OR: [
                { queuedAt: { lt: cursor.queuedAt } },
                { queuedAt: cursor.queuedAt, id: { lt: cursor.id } },
              ],
            }
          : { workflowId },
        orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: EXECUTION_SELECT,
      })
    },

    /**
     * Transition a QUEUED row to RUNNING. Called by the worker write-back
     * endpoint once Temporal acknowledges the start. Populates the Temporal
     * ids so the reconcile poller can address the run if needed.
     */
    async markStarted(
      executionId: string,
      input: {
        temporalWorkflowId: string
        temporalRunId: string
        startedAt: Date
      },
    ): Promise<WorkflowExecutionRow> {
      return db.workflowExecution.update({
        where: { id: executionId },
        data: {
          status: 'RUNNING',
          temporalWorkflowId: input.temporalWorkflowId,
          temporalRunId: input.temporalRunId,
          startedAt: input.startedAt,
        },
        select: EXECUTION_SELECT,
      })
    },

    /**
     * Transition a RUNNING (or, defensively, QUEUED) row to one of the
     * terminal states. Sets `finishedAt` and the optional result/error
     * payloads. The caller is responsible for state-machine validation;
     * this method is the raw write.
     */
    async markTerminal(
      executionId: string,
      input: {
        status: Extract<WorkflowExecutionStatus, 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'>
        finishedAt: Date
        result?: object | Prisma.InputJsonValue | null
        errorMessage?: string | null
      },
    ): Promise<WorkflowExecutionRow> {
      const data: Prisma.WorkflowExecutionUncheckedUpdateInput = {
        status: input.status,
        finishedAt: input.finishedAt,
      }
      if ('result' in input && input.result !== undefined) {
        // `null` means "clear" — Prisma's JsonNull is needed for true SQL NULL.
        data.result =
          input.result === null
            ? (null as unknown as Prisma.InputJsonValue)
            : (input.result as Prisma.InputJsonValue)
      }
      if ('errorMessage' in input && input.errorMessage !== undefined) {
        data.errorMessage = input.errorMessage
      }
      return db.workflowExecution.update({
        where: { id: executionId },
        data,
        select: EXECUTION_SELECT,
      })
    },
  }
}

export type WorkflowExecutionRepository = ReturnType<typeof createWorkflowExecutionRepository>
