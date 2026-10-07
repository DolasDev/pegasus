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

import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'
import { copyObject } from '../lib/documents-s3'

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
  /** Set when this row was created by forking another workflow; the source id. */
  forkedFromWorkflowId: string | null
  /** The source workflow's version at fork time. */
  forkedFromVersion: string | null
  /**
   * KMS-encrypted runtime credential for the per-workflow runtime service
   * account. Null until provisioned. MUST NOT be returned in API responses.
   */
  runtimeTokenCiphertext: string | null
  /** ApiClient.id of the per-workflow runtime service account. Null until provisioned. */
  runtimeApiClientId: string | null
  /** Hex SHA-256 of the artifact zip, recorded at finalize. Null for pre-Unit-6 rows. */
  artifactSha256: string | null
  /** Artifact zip size in bytes, recorded at finalize. Null for pre-Unit-6 rows. */
  artifactSizeBytes: number | null
  /**
   * True when the artifact passed integrity validation at finalize. Derived
   * server-side only; since Unit 10 the run path routes executable non-curated
   * rows to the tenant runner (curated names → stdlib lane).
   */
  executable: boolean
  /** ACTIVE, or RETIRED (sdk-feedback 0032). Default reads return ACTIVE rows only. */
  status: WorkflowStatus
  retiredAt: Date | null
  retiredByUserId: string | null
  createdAt: Date
  updatedAt: Date
}

export type WorkflowStatus = 'ACTIVE' | 'RETIRED'

/** Opt-in for the reads that must still see retired rows: execution history, triggers. */
export type RetiredFilter = { includeRetired?: boolean }

const activeOnly = (opts?: RetiredFilter) =>
  opts?.includeRetired ? {} : { status: 'ACTIVE' as const }

/** A row named in a retire outcome. */
export type RetireRef = { id: string; name: string; version: string }

/** What blocks a retire: a live binding that would silently stop working. */
export type RetireBlocker = { id: string; workflowId: string; version: string }

export type RetireOutcome =
  | { kind: 'not_found' }
  | { kind: 'blocked'; enabledTriggers: RetireBlocker[]; openExecutions: RetireBlocker[] }
  | {
      kind: 'retired'
      retired: RetireRef[]
      alreadyRetired: RetireRef[]
      /** Tenant forks of the retired rows. They are independent rows and keep running. */
      forkCount: number
    }

const OPEN_EXECUTION_STATUSES = ['QUEUED', 'RUNNING'] as const

const WORKFLOW_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  version: true,
  visibility: true,
  artifactKey: true,
  manifest: true,
  createdByUserId: true,
  forkedFromWorkflowId: true,
  forkedFromVersion: true,
  runtimeTokenCiphertext: true,
  runtimeApiClientId: true,
  artifactSha256: true,
  artifactSizeBytes: true,
  executable: true,
  status: true,
  retiredAt: true,
  retiredByUserId: true,
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
      /** Integrity facts from finalize-time artifact validation (Unit 6). */
      artifactSha256: string
      artifactSizeBytes: number
      executable: boolean
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
     * - a RETIRED row is null too, unless the caller opts in. That makes get,
     *   run, fork, download, trigger create/enable and the trigger dispatcher
     *   all refuse a retired workflow by default (sdk-feedback 0032).
     */
    async findByIdForTenant(
      id: string,
      tenantId: string,
      opts?: RetiredFilter,
    ): Promise<WorkflowRow | null> {
      return db.workflow.findFirst({
        where: {
          id,
          OR: [{ tenantId }, { visibility: 'GLOBAL' }],
          ...activeOnly(opts),
        },
        select: WORKFLOW_SELECT,
      })
    },

    /**
     * List every workflow visible to a tenant: the tenant's own rows union
     * everything tagged GLOBAL. Sorted newest-first for display. Retired rows
     * are left out unless the caller opts in.
     */
    async listForTenant(tenantId: string, opts?: RetiredFilter): Promise<WorkflowRow[]> {
      return db.workflow.findMany({
        where: {
          OR: [{ tenantId }, { visibility: 'GLOBAL' }],
          ...activeOnly(opts),
        },
        select: WORKFLOW_SELECT,
        orderBy: { createdAt: 'desc' },
      })
    },

    /**
     * Retire every version of `name` the OWNER tenant holds, or just `version`
     * (sdk-feedback 0032). Soft: rows stay for audit, see findByIdForTenant.
     * Only rows the owner tenant holds can match, so a tenant can never retire
     * another tenant's row, GLOBAL or not.
     *
     * All-or-nothing, and refused while anything would silently break: an
     * ENABLED trigger, or a QUEUED/RUNNING execution, on any matching row, from
     * ANY tenant. That is why this must be given the ROOT client. A GLOBAL
     * workflow is triggered and run by tenants that never forked it, and a
     * tenant-scoped client would hide exactly those rows. Disabled triggers and
     * finished executions do not block. Forks are separate rows and keep
     * running; their count is reported.
     *
     * The guard and the update share one transaction. A trigger created
     * between them would land on a row that is retired the moment this
     * commits, and the dispatcher skips retired rows.
     */
    async retire(input: {
      ownerTenantId: string
      name: string
      version?: string | undefined
      retiredByUserId: string
    }): Promise<RetireOutcome> {
      return db.$transaction(async (tx) => {
        const rows = await tx.workflow.findMany({
          where: {
            tenantId: input.ownerTenantId,
            name: input.name,
            ...(input.version !== undefined ? { version: input.version } : {}),
          },
          select: { id: true, name: true, version: true, status: true },
          orderBy: { createdAt: 'asc' },
        })
        if (rows.length === 0) return { kind: 'not_found' }

        const active = rows.filter((r) => r.status === 'ACTIVE')
        const alreadyRetired = rows
          .filter((r) => r.status === 'RETIRED')
          .map(({ id, name, version }) => ({ id, name, version }))
        if (active.length === 0) {
          return { kind: 'retired', retired: [], alreadyRetired, forkCount: 0 }
        }

        const ids = active.map((r) => r.id)
        const versionOf = new Map(active.map((r) => [r.id, r.version]))
        const [triggers, executions] = await Promise.all([
          tx.workflowTrigger.findMany({
            where: { workflowId: { in: ids }, enabled: true },
            select: { id: true, workflowId: true },
            orderBy: { createdAt: 'asc' },
          }),
          tx.workflowExecution.findMany({
            where: { workflowId: { in: ids }, status: { in: [...OPEN_EXECUTION_STATUSES] } },
            select: { id: true, workflowId: true },
            orderBy: { queuedAt: 'asc' },
          }),
        ])
        const ref = (b: { id: string; workflowId: string }): RetireBlocker => ({
          id: b.id,
          workflowId: b.workflowId,
          version: versionOf.get(b.workflowId) ?? '',
        })
        if (triggers.length > 0 || executions.length > 0) {
          return {
            kind: 'blocked',
            enabledTriggers: triggers.map(ref),
            openExecutions: executions.map(ref),
          }
        }

        await tx.workflow.updateMany({
          where: { id: { in: ids }, status: 'ACTIVE' },
          data: {
            status: 'RETIRED',
            retiredAt: new Date(),
            retiredByUserId: input.retiredByUserId,
          },
        })
        const forkCount = await tx.workflow.count({ where: { forkedFromWorkflowId: { in: ids } } })
        return {
          kind: 'retired',
          retired: active.map(({ id, name, version }) => ({ id, name, version })),
          alreadyRetired,
          forkCount,
        }
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

    /**
     * One-click fork: copy a GLOBAL source workflow into `targetTenantId`'s
     * own store. The source artifact is server-side S3-copied to a new
     * tenant-owned key, then a fresh TENANT-visibility row is inserted with
     * `forkedFrom*` provenance pointing at the source.
     *
     * The caller is responsible for confirming the source is visible and
     * GLOBAL before calling this (the handler does, via findByIdForTenant).
     *
     * The S3 copy runs before the insert so a unique-key clash on
     * (targetTenantId, name, version) leaves only an orphan artifact, never a
     * row without its bytes. Prisma throws P2002 on that clash; it propagates
     * to the caller, which maps it to 409.
     */
    async forkGlobalToTenant(
      source: WorkflowRow,
      targetTenantId: string,
      createdByUserId: string,
    ): Promise<WorkflowRow> {
      const newWorkflowId = randomUUID()
      const newArtifactKey = `workflows/${targetTenantId}/${newWorkflowId}/${source.version}.zip`

      await copyObject(source.artifactKey, newArtifactKey)

      return db.workflow.create({
        data: {
          id: newWorkflowId,
          tenantId: targetTenantId,
          name: source.name,
          version: source.version,
          visibility: 'TENANT',
          artifactKey: newArtifactKey,
          manifest: source.manifest as Prisma.InputJsonValue,
          createdByUserId,
          forkedFromWorkflowId: source.id,
          forkedFromVersion: source.version,
          // The S3 copy above is byte-identical, so the integrity facts carry
          // over verbatim — no re-download/re-validation on fork (Unit 6).
          artifactSha256: source.artifactSha256,
          artifactSizeBytes: source.artifactSizeBytes,
          executable: source.executable,
        },
        select: WORKFLOW_SELECT,
      })
    },

    /**
     * Persist the per-workflow runtime service-account credential onto an
     * existing workflow row: the KMS-ciphertext of the scoped `vnd_` key and
     * the bound ApiClient.id.
     *
     * Accepts an optional transaction client so finalize / fork can run this
     * update inside the same transaction that created the workflow row — if
     * the outer transaction rolls back, the credential columns roll back too.
     */
    async attachRuntimeToken(
      workflowId: string,
      input: { runtimeTokenCiphertext: string; runtimeApiClientId: string },
      tx?: Prisma.TransactionClient,
    ): Promise<WorkflowRow> {
      const client = tx ?? db
      return client.workflow.update({
        where: { id: workflowId },
        data: {
          runtimeTokenCiphertext: input.runtimeTokenCiphertext,
          runtimeApiClientId: input.runtimeApiClientId,
        },
        select: WORKFLOW_SELECT,
      })
    },
  }
}

export type WorkflowRepository = ReturnType<typeof createWorkflowRepository>
