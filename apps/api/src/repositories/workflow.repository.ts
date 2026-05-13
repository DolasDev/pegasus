// ---------------------------------------------------------------------------
// Workflow repository
//
// Manages Workflow rows — uploaded Python workflow artifacts. Visibility is
// derived server-side at finalize time from the uploading tenant:
//
//   isPlatformTenant tenant → visibility = GLOBAL  (visible to every tenant)
//   any other tenant        → visibility = TENANT  (visible only to owner)
//
// Workflow is intentionally NOT in TENANT_SCOPED_MODELS — the GLOBAL case
// requires reading rows owned by a different tenant (the platform tenant), so
// the auto-scoping extension would hide them. Every query in this file scopes
// manually with explicit `tenantId` / `visibility` predicates instead.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visibility enum as it appears at the API boundary. Mirrors the Prisma enum. */
export type WorkflowVisibility = 'GLOBAL' | 'TENANT'

/**
 * A safe projection of the workflows row. `artifactKey` is included because
 * the handler needs it to build a presigned download URL; the handler MUST
 * strip it before returning to the client.
 */
export type WorkflowRow = {
  id: string
  tenantId: string
  name: string
  version: string
  visibility: WorkflowVisibility
  artifactKey: string
  manifest: Prisma.JsonValue
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

const WORKFLOW_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  version: true,
  visibility: true,
  artifactKey: true,
  manifest: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createWorkflowRepository(db: PrismaClient) {
  return {
    /**
     * Insert a new workflow row. Caller is responsible for visibility
     * derivation — pass GLOBAL only when the uploading principal's tenant has
     * isPlatformTenant=true.
     *
     * Uniqueness on (tenantId, name, version) makes this throw
     * Prisma.PrismaClientKnownRequestError P2002 on duplicate; the handler
     * maps that to 409 CONFLICT.
     */
    async create(input: {
      id: string
      tenantId: string
      name: string
      version: string
      visibility: WorkflowVisibility
      artifactKey: string
      manifest: Prisma.InputJsonValue
      createdByUserId: string
    }): Promise<WorkflowRow> {
      return db.workflow.create({
        data: input,
        select: WORKFLOW_SELECT,
      })
    },

    /**
     * Find a single workflow by id, enforcing visibility:
     * - the caller's own tenant rows are always visible
     * - rows with visibility=GLOBAL are visible to every tenant
     * - everything else returns null (treated as 404 by the handler — avoids
     *   leaking the existence of other tenants' workflows)
     */
    async findByIdForTenant(id: string, tenantId: string): Promise<WorkflowRow | null> {
      return db.workflow.findFirst({
        where: {
          id,
          OR: [{ tenantId }, { visibility: 'GLOBAL' }],
        },
        select: WORKFLOW_SELECT,
      })
    },

    /**
     * List every workflow visible to a tenant: the tenant's own rows union
     * everything tagged GLOBAL. Sorted newest-first for display.
     */
    async listForTenant(tenantId: string): Promise<WorkflowRow[]> {
      return db.workflow.findMany({
        where: {
          OR: [{ tenantId }, { visibility: 'GLOBAL' }],
        },
        select: WORKFLOW_SELECT,
        orderBy: { createdAt: 'desc' },
      })
    },

    /**
     * Look up a workflow by its natural key. Used by the finalize path to
     * detect duplicate uploads before attempting the insert (more useful
     * error messages than the P2002 unique-violation).
     */
    async findByNaturalKey(
      tenantId: string,
      name: string,
      version: string,
    ): Promise<WorkflowRow | null> {
      return db.workflow.findUnique({
        where: { tenantId_name_version: { tenantId, name, version } },
        select: WORKFLOW_SELECT,
      })
    },
  }
}

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>
