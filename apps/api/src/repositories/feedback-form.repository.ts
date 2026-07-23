// ---------------------------------------------------------------------------
// FeedbackForm repository
//
// Published, versioned feedback form definitions. Append-only, exactly like
// IntegrationConfig: each publish inserts a new immutable (tenantId, formKey,
// version) row and supersedes the prior PUBLISHED row for the scope. Purely
// tenant-owned (no GLOBAL case), so the model is auto-scoped in
// TENANT_SCOPED_MODELS and every method here takes an already-tenant-scoped
// client — no manual tenantId predicates (contrast IntegrationConfig, which is
// unscoped to support its GLOBAL visibility).
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

export type FeedbackFormStatus = 'PUBLISHED' | 'SUPERSEDED'

export type FeedbackFormRow = {
  id: string
  tenantId: string
  formKey: string
  version: number
  status: FeedbackFormStatus
  title: string
  definition: Prisma.JsonValue
  messageTemplate: string | null
  publishedBy: string
  createdAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  formKey: true,
  version: true,
  status: true,
  title: true,
  definition: true,
  messageTemplate: true,
  publishedBy: true,
  createdAt: true,
} as const

export interface PublishFormInput {
  tenantId: string
  formKey: string
  title: string
  definition: Prisma.InputJsonValue
  messageTemplate?: string | null
  publishedBy: string
}

export function createFeedbackFormRepository(db: PrismaClient) {
  return {
    /**
     * Publish a new immutable form version for (tenantId, formKey). In one
     * transaction: compute the next version, supersede any prior PUBLISHED row
     * for the scope, and insert the new PUBLISHED row.
     */
    async publish(input: PublishFormInput): Promise<FeedbackFormRow> {
      return db.$transaction(async (tx) => {
        const max = await tx.feedbackForm.aggregate({
          where: { tenantId: input.tenantId, formKey: input.formKey },
          _max: { version: true },
        })
        const version = (max._max.version ?? 0) + 1

        await tx.feedbackForm.updateMany({
          where: { tenantId: input.tenantId, formKey: input.formKey, status: 'PUBLISHED' },
          data: { status: 'SUPERSEDED' },
        })

        return tx.feedbackForm.create({
          data: {
            tenantId: input.tenantId,
            formKey: input.formKey,
            title: input.title,
            definition: input.definition,
            messageTemplate: input.messageTemplate ?? null,
            publishedBy: input.publishedBy,
            version,
            status: 'PUBLISHED',
          },
          select: SELECT,
        })
      })
    },

    /** The live (latest PUBLISHED) form for a key, or null. */
    async findActive(formKey: string): Promise<FeedbackFormRow | null> {
      return db.feedbackForm.findFirst({
        where: { formKey, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /** The live PUBLISHED form for each key the tenant has authored, newest per key. */
    async listActive(): Promise<FeedbackFormRow[]> {
      return db.feedbackForm.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { formKey: 'asc' },
        select: SELECT,
      })
    },

    /** Version history for a key, newest first. */
    async listVersions(formKey: string): Promise<FeedbackFormRow[]> {
      return db.feedbackForm.findMany({
        where: { formKey },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /** A specific version within a key (used by rollback to source a prior form). */
    async findVersion(formKey: string, version: number): Promise<FeedbackFormRow | null> {
      return db.feedbackForm.findFirst({
        where: { formKey, version },
        select: SELECT,
      })
    },

    /**
     * A specific (tenantId, formKey, version) — the ROOT-db lookup for the public
     * respond endpoint, which bypasses the tenant-scoping extension and so MUST
     * pass tenantId explicitly (formKey is tenant-chosen and can collide across
     * tenants). Resolves the exact pinned definition a request was minted against.
     */
    async findVersionForTenant(
      tenantId: string,
      formKey: string,
      version: number,
    ): Promise<FeedbackFormRow | null> {
      return db.feedbackForm.findFirst({
        where: { tenantId, formKey, version },
        select: SELECT,
      })
    },
  }
}

export type FeedbackFormRepository = ReturnType<typeof createFeedbackFormRepository>
