// ---------------------------------------------------------------------------
// WorkflowTrigger repository
//
// Manages WorkflowTrigger rows — event / schedule subscriptions a tenant
// attaches to a workflow. Always owned by a single tenant (a tenant's trigger
// on a GLOBAL workflow is still the tenant's own row), so the model lives in
// TENANT_SCOPED_MODELS — every read/write below automatically picks up the
// current tenant via the Prisma extension.
//
// CRUD only in this unit: EVENT rows wait for the Unit 3 dispatcher to match
// them against domain-event outbox rows; SCHEDULE rows are stored but inert
// until Unit 4 realizes them as Temporal Schedules.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trigger kind as it appears at the API boundary. Mirrors the Prisma enum. */
export type WorkflowTriggerKind = 'EVENT' | 'SCHEDULE'

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
      createdByUserId: string
    }): Promise<WorkflowTriggerRow> {
      const data: Prisma.WorkflowTriggerUncheckedCreateInput = {
        tenantId: input.tenantId,
        workflowId: input.workflowId,
        kind: input.kind,
        eventType: input.eventType ?? null,
        cronExpression: input.cronExpression ?? null,
        enabled: input.enabled,
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
     * Partial update. Kind changes are rejected at the handler; this method
     * never writes `kind`. `filter` accepts Prisma.JsonNull-style clears only
     * via explicit undefined-skip — pass a value to set it.
     */
    async update(
      triggerId: string,
      input: {
        enabled?: boolean
        eventType?: string
        filter?: Prisma.InputJsonValue
        cronExpression?: string
      },
    ): Promise<WorkflowTriggerRow> {
      const data: Prisma.WorkflowTriggerUncheckedUpdateInput = {}
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.eventType !== undefined) data.eventType = input.eventType
      if (input.filter !== undefined) data.filter = input.filter
      if (input.cronExpression !== undefined) data.cronExpression = input.cronExpression
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
