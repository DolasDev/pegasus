// ---------------------------------------------------------------------------
// WorkflowTrigger repository
//
// Manages WorkflowTrigger rows — event / schedule subscriptions a tenant
// attaches to a workflow. Always owned by a single tenant (a tenant's trigger
// on a GLOBAL workflow is still the tenant's own row), so the model lives in
// TENANT_SCOPED_MODELS — every read/write below automatically picks up the
// current tenant via the Prisma extension.
//
// CRUD only here: the dispatcher Lambda (which reads via the tenant-agnostic
// root `db`, not this repo) matches EVENT rows against domain-event outbox
// rows (Unit 3) and cron-evaluates SCHEDULE rows each tick (Unit 4).
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trigger kind as it appears at the API boundary. Mirrors the Prisma enum. */
export type WorkflowTriggerKind = 'EVENT' | 'SCHEDULE'

/**
 * What an EVENT trigger does with a matching event. Mirrors the Prisma enum.
 * NEW = a new execution per event; START / DELIVER = deliver the event as
 * `signalName` to the durable Workflow instance for its business key
 * (`correlationPath`), START creating it when none is open.
 */
export type WorkflowTriggerMode = 'NEW' | 'START' | 'DELIVER'

export type WorkflowTriggerRow = {
  id: string
  tenantId: string
  workflowId: string
  kind: WorkflowTriggerKind
  /** EVENT kind: domain-event type (lib/domain-events.ts). Null for SCHEDULE. */
  eventType: string | null
  /** EVENT kind: optional payload-match object. Null for SCHEDULE. */
  filter: Prisma.JsonValue | null
  /** SCHEDULE kind: 5-field cron expression. Null for EVENT. */
  cronExpression: string | null
  enabled: boolean
  /** Every execution this trigger starts runs in dry-run mode. */
  dryRun: boolean
  mode: WorkflowTriggerMode
  /** START / DELIVER: dot path into the event envelope naming the business key. */
  correlationPath: string | null
  /** START / DELIVER: the declared signal the event is delivered as. */
  signalName: string | null
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

const TRIGGER_SELECT = {
  id: true,
  tenantId: true,
  workflowId: true,
  kind: true,
  eventType: true,
  filter: true,
  cronExpression: true,
  enabled: true,
  dryRun: true,
  mode: true,
  correlationPath: true,
  signalName: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createWorkflowTriggerRepository(db: PrismaClient) {
  return {
    /**
     * Insert a new trigger. Kind-conditional field validation (eventType for
     * EVENT, cronExpression for SCHEDULE) is the handler's responsibility —
     * this method is the raw write.
     *
     * Tenant scope is applied implicitly via the extension on reads; the
     * caller still passes tenantId because the column is non-null and the
     * create path is NOT rewritten by the extension (see lib/prisma.ts).
     */
    async create(input: {
      tenantId: string
      workflowId: string
      kind: WorkflowTriggerKind
      eventType?: string | null
      filter?: Prisma.InputJsonValue | null
      cronExpression?: string | null
      enabled: boolean
      dryRun?: boolean
      mode?: WorkflowTriggerMode
      correlationPath?: string | null
      signalName?: string | null
      createdByUserId: string
    }): Promise<WorkflowTriggerRow> {
      const data: Prisma.WorkflowTriggerUncheckedCreateInput = {
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        kind: input.kind,
        eventType: input.eventType ?? null,
        cronExpression: input.cronExpression ?? null,
        enabled: input.enabled,
        dryRun: input.dryRun ?? false,
        mode: input.mode ?? 'NEW',
        correlationPath: input.correlationPath ?? null,
        signalName: input.signalName ?? null,
        createdByUserId: input.createdByUserId,
      }
      // Omitted filter stays SQL NULL — the column has no default.
      if (input.filter !== undefined && input.filter !== null) {
        data.filter = input.filter
      }
      return db.workflowTrigger.create({
        data,
        select: TRIGGER_SELECT,
      })
    },

    /**
     * Tenant-scoped fetch. The TENANT_SCOPED_MODELS extension AND-merges the
     * tenantId predicate, so another tenant's trigger resolves to null.
     */
    async findById(triggerId: string): Promise<WorkflowTriggerRow | null> {
      return db.workflowTrigger.findFirst({
        where: { id: triggerId },
        select: TRIGGER_SELECT,
      })
    },

    /** Tenant-scoped list of triggers for one workflow, newest first. */
    async listByWorkflow(workflowId: string): Promise<WorkflowTriggerRow[]> {
      return db.workflowTrigger.findMany({
        where: { workflowId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: TRIGGER_SELECT,
      })
    },

    /**
     * Distinct ids of the workflows this tenant has an ENABLED trigger on —
     * the versions that still run even when a newer one exists. Tenant-scoped
     * via the extension.
     */
    async listEnabledWorkflowIds(): Promise<string[]> {
      const rows = await db.workflowTrigger.findMany({
        where: { enabled: true },
        select: { workflowId: true },
        distinct: ['workflowId'],
      })
      return rows.map((r) => r.workflowId)
    },

    /**
     * Partial update. Kind changes are rejected at the handler; this method
     * never writes `kind`. `filter` accepts Prisma.JsonNull-style clears only
     * via explicit undefined-skip — pass a value to set it.
     */
    async update(
      triggerId: string,
      input: {
        enabled?: boolean
        dryRun?: boolean
        eventType?: string
        filter?: Prisma.InputJsonValue
        cronExpression?: string
        mode?: WorkflowTriggerMode
        /** null clears it (a trigger switched back to NEW). */
        correlationPath?: string | null
        signalName?: string | null
      },
    ): Promise<WorkflowTriggerRow> {
      const data: Prisma.WorkflowTriggerUncheckedUpdateInput = {}
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.dryRun !== undefined) data.dryRun = input.dryRun
      if (input.eventType !== undefined) data.eventType = input.eventType
      if (input.filter !== undefined) data.filter = input.filter
      if (input.cronExpression !== undefined) data.cronExpression = input.cronExpression
      if (input.mode !== undefined) data.mode = input.mode
      if (input.correlationPath !== undefined) data.correlationPath = input.correlationPath
      if (input.signalName !== undefined) data.signalName = input.signalName
      return db.workflowTrigger.update({
        where: { id: triggerId },
        data,
        select: TRIGGER_SELECT,
      })
    },

    /** Hard delete. Tenant scope is applied implicitly via the extension. */
    async deleteById(triggerId: string): Promise<void> {
      await db.workflowTrigger.delete({ where: { id: triggerId } })
    },
  }
}

export type WorkflowTriggerRepository = ReturnType<typeof createWorkflowTriggerRepository>
