// ---------------------------------------------------------------------------
// IntegrationConfig repository
//
// Manages IntegrationConfig rows — published, versioned integration-validator
// config (mapping + rules + golden corpus). Append-only: each publish inserts a
// new immutable (integrationId, tenantId, version) row and supersedes prior
// PUBLISHED rows for the same scope.
//
// The one exception is `deleteScope` (sdk-feedback 0030 + 0031): an explicit,
// permission-gated hard delete of an ENTIRE (integrationId, tenantId) lineage,
// so a published id can be withdrawn rather than merely superseded. Nothing
// mutates a row in place; a config is either appended or its lineage is removed.
//
// Visibility is derived server-side at publish time from the publishing tenant
// (GLOBAL for the platform tenant, TENANT otherwise) — exactly like Workflow.
// IntegrationConfig is intentionally NOT in TENANT_SCOPED_MODELS: the GLOBAL
// case reads rows owned by the platform tenant, which the auto-scoping extension
// would hide. Every query here scopes manually via explicit
// `tenantId` / `visibility` predicates.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

export type IntegrationConfigVisibility = 'GLOBAL' | 'TENANT'
export type IntegrationConfigStatus = 'PUBLISHED' | 'SUPERSEDED'

/** A read projection of an integration_configs row. */
export type IntegrationConfigRow = {
  id: string
  tenantId: string
  integrationId: string
  version: number
  visibility: IntegrationConfigVisibility
  status: IntegrationConfigStatus
  mapping: Prisma.JsonValue
  rules: Prisma.JsonValue
  corpus: Prisma.JsonValue
  gateReport: Prisma.JsonValue
  publishedBy: string
  /** Source IntegrationConfig.id when this row was forked from a GLOBAL config; else null. */
  forkedFromConfigId: string | null
  /** Source config version at fork time; else null. */
  forkedFromVersion: number | null
  /** Type floor this overlay is built on (0020). Null ⇒ resolve via the built-in overlay's floor. */
  floor: string | null
  /** Human-facing label decoupled from integrationId (0019). Null ⇒ fall back to the built-in/id. */
  displayName: string | null
  /** Partner external output shape as a JSON Schema (0020). Null ⇒ external == canonical (identity). */
  externalShape: Prisma.JsonValue | null
  /** Canonical → external projection (0020). Null ⇒ identity. */
  externalMapping: Prisma.JsonValue | null
  /** Inbound (ingress) behavior block (0021). Null ⇒ generic ack. */
  inbound: Prisma.JsonValue | null
  createdAt: Date
}

const SELECT = {
  id: true,
  tenantId: true,
  integrationId: true,
  version: true,
  visibility: true,
  status: true,
  mapping: true,
  rules: true,
  corpus: true,
  gateReport: true,
  publishedBy: true,
  forkedFromConfigId: true,
  forkedFromVersion: true,
  floor: true,
  displayName: true,
  externalShape: true,
  externalMapping: true,
  inbound: true,
  createdAt: true,
} as const

export interface PublishConfigInput {
  integrationId: string
  /** Owning tenant. The platform tenant owns GLOBAL rows. */
  tenantId: string
  /** Derived server-side from the publishing tenant's isPlatformTenant flag. */
  visibility: IntegrationConfigVisibility
  mapping: Prisma.InputJsonValue
  rules: Prisma.InputJsonValue
  corpus: Prisma.InputJsonValue
  gateReport: Prisma.InputJsonValue
  publishedBy: string
  /** Set by the fork path: the source GLOBAL config's id. Omit for direct publishes. */
  forkedFromConfigId?: string
  /** Set by the fork path: the source GLOBAL config's version. Omit for direct publishes. */
  forkedFromVersion?: number
  /** Type floor this overlay targets (0020). Omit to inherit the built-in overlay's floor. */
  floor?: string
  /** Human-facing label (0019). Omit to fall back to the built-in/id. */
  displayName?: string
  /** Partner external output shape as a JSON Schema (0020). Omit ⇒ identity. */
  externalShape?: Prisma.InputJsonValue
  /** Canonical → external projection (0020). Omit ⇒ identity. */
  externalMapping?: Prisma.InputJsonValue
  /** Inbound (ingress) behavior block (0021). Omit ⇒ generic ack. */
  inbound?: Prisma.InputJsonValue
}

export function createIntegrationConfigRepository(db: PrismaClient) {
  return {
    /**
     * Publish a new immutable config version for (integrationId, tenantId).
     * In one transaction: compute the next version, supersede any prior
     * PUBLISHED rows for the scope, and insert the new PUBLISHED row.
     */
    async publish(input: PublishConfigInput): Promise<IntegrationConfigRow> {
      return db.$transaction(async (tx) => {
        const max = await tx.integrationConfig.aggregate({
          where: { integrationId: input.integrationId, tenantId: input.tenantId },
          _max: { version: true },
        })
        const version = (max._max.version ?? 0) + 1

        await tx.integrationConfig.updateMany({
          where: {
            integrationId: input.integrationId,
            tenantId: input.tenantId,
            status: 'PUBLISHED',
          },
          data: { status: 'SUPERSEDED' },
        })

        return tx.integrationConfig.create({
          data: { ...input, version, status: 'PUBLISHED' },
          select: SELECT,
        })
      })
    },

    /**
     * Resolve the live config for an integration in a tenant's scope: the
     * tenant's own latest PUBLISHED row wins; otherwise the GLOBAL (platform)
     * latest PUBLISHED row. Null when neither exists (caller falls back to the
     * built-in code definition).
     */
    async findActiveForScope(
      integrationId: string,
      tenantId: string,
    ): Promise<IntegrationConfigRow | null> {
      const own = await db.integrationConfig.findFirst({
        where: { integrationId, tenantId, status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      if (own) return own
      return db.integrationConfig.findFirst({
        where: { integrationId, visibility: 'GLOBAL', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /**
     * The latest PUBLISHED GLOBAL row for one integration — the fork source.
     * Null when the platform has published no GLOBAL config for it (only a
     * built-in code definition exists), which the fork handler treats as 404.
     */
    async findActiveGlobal(integrationId: string): Promise<IntegrationConfigRow | null> {
      return db.integrationConfig.findFirst({
        where: { integrationId, visibility: 'GLOBAL', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /**
     * The tenant's OWN latest PUBLISHED row (visibility TENANT, owned by the
     * caller) for one integration — used by the fork guard to refuse clobbering
     * a tenant that has already customized. Null when the tenant has no own row
     * (they only see GLOBAL/built-in). Distinct from findActiveForScope, which
     * falls back to GLOBAL.
     */
    async findActiveOwn(
      integrationId: string,
      tenantId: string,
    ): Promise<IntegrationConfigRow | null> {
      return db.integrationConfig.findFirst({
        where: { integrationId, tenantId, visibility: 'TENANT', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /** The latest PUBLISHED GLOBAL row per integration — used to warm the registry overlay. */
    async listActiveGlobal(): Promise<IntegrationConfigRow[]> {
      const rows = await db.integrationConfig.findMany({
        where: { visibility: 'GLOBAL', status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
      // One (latest) per integrationId — rows are version-desc, so first wins.
      const seen = new Set<string>()
      const latest: IntegrationConfigRow[] = []
      for (const row of rows) {
        if (seen.has(row.integrationId)) continue
        seen.add(row.integrationId)
        latest.push(row)
      }
      return latest
    },

    /** Fetch one row by id, visible to the tenant (own ∪ GLOBAL); null otherwise. */
    async findByIdForScope(id: string, tenantId: string): Promise<IntegrationConfigRow | null> {
      return db.integrationConfig.findFirst({
        where: { id, OR: [{ tenantId }, { visibility: 'GLOBAL' }] },
        select: SELECT,
      })
    },

    /** Version history for (integrationId, tenantId), newest first. */
    async listVersions(integrationId: string, tenantId: string): Promise<IntegrationConfigRow[]> {
      return db.integrationConfig.findMany({
        where: { integrationId, tenantId },
        orderBy: { version: 'desc' },
        select: SELECT,
      })
    },

    /**
     * How many rows (any status, any version) exist for one (integrationId,
     * tenantId) lineage. Used by the delete handler to distinguish "nothing to
     * delete" (404) from a real removal, without loading the JSON blobs
     * `listVersions` returns.
     */
    async countScope(integrationId: string, tenantId: string): Promise<number> {
      return db.integrationConfig.count({ where: { integrationId, tenantId } })
    },

    /**
     * Count OTHER tenants' live (PUBLISHED, TENANT-visibility) configs for one
     * integration id — the dependency guard for deleting a GLOBAL config
     * (sdk-feedback 0031). Excludes `excludeTenantId` (the platform tenant doing
     * the delete) and non-PUBLISHED rows, so only tenants actively resolving
     * their own overlay for the id are counted.
     */
    async countOtherTenantOverlays(
      integrationId: string,
      excludeTenantId: string,
    ): Promise<number> {
      return db.integrationConfig.count({
        where: {
          integrationId,
          visibility: 'TENANT',
          status: 'PUBLISHED',
          tenantId: { not: excludeTenantId },
        },
      })
    },

    /**
     * Hard-delete the ENTIRE (integrationId, tenantId) lineage — every version,
     * not just the active one (sdk-feedback 0030 + 0031). Scoped strictly by the
     * owning tenantId, so a caller can only ever remove rows it owns: the
     * platform tenant its GLOBAL lineage, any other tenant its own overlay.
     *
     * Irreversible: unlike a supersede, the versions do not survive in history.
     * A subsequent publish for the same scope therefore starts again at v1.
     */
    async deleteScope(integrationId: string, tenantId: string): Promise<number> {
      const { count } = await db.integrationConfig.deleteMany({
        where: { integrationId, tenantId },
      })
      return count
    },

    /** A specific version within a scope (used by rollback to source a prior config). */
    async findVersion(
      integrationId: string,
      tenantId: string,
      version: number,
    ): Promise<IntegrationConfigRow | null> {
      return db.integrationConfig.findUnique({
        where: {
          integrationId_tenantId_version: { integrationId, tenantId, version },
        },
        select: SELECT,
      })
    },
  }
}

export type IntegrationConfigRepository = ReturnType<typeof createIntegrationConfigRepository>
