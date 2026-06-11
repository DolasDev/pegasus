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
   * server-side only; the run path keeps the curated-names gate until Unit 10.
   */
  executable: boolean
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
  forkedFromWorkflowId: true,
  forkedFromVersion: true,
  runtimeTokenCiphertext: true,
  runtimeApiClientId: true,
  artifactSha256: true,
  artifactSizeBytes: true,
  executable: true,
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
