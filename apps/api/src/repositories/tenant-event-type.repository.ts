// ---------------------------------------------------------------------------
// TenantEventType repository
//
// Manages the tenant's custom-event registry — the named event types a tenant
// defines so its workflows can trigger on events beyond the built-in taxonomy
// (lib/domain-events.ts). Always owned by a single tenant, so the model lives
// in TENANT_SCOPED_MODELS — every read/write below automatically picks up the
// current tenant via the Prisma extension.
//
// CRUD only here. The reserved-name guard (no collision with DOMAIN_EVENT_TYPES),
// the payloadSchema validity check, and the domainCondition.sourceEventType
// guard all live in the handler. The dispatcher's domain-condition deriver reads
// cross-tenant via the root `db`, NOT this repo.
//
// `hasDomainCondition` is a derived column (true iff domainCondition is set),
// maintained here so callers never have to set it by hand — it backs the cheap
// pre-filter the dispatcher uses to skip tenants with no conditions.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

export type TenantEventTypeRow = {
  id: string
  tenantId: string
  name: string
  description: string | null
  payloadSchema: Prisma.JsonValue | null
  domainCondition: Prisma.JsonValue | null
  hasDomainCondition: boolean
  enabled: boolean
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

const EVENT_TYPE_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  description: true,
  payloadSchema: true,
  domainCondition: true,
  hasDomainCondition: true,
  enabled: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const

export function createTenantEventTypeRepository(db: PrismaClient) {
  return {
    /**
     * Insert a new custom event type. Name/schema/condition validation is the
     * handler's responsibility — this is the raw write. Tenant scope is applied
     * implicitly on reads; the caller passes tenantId because the create path
     * is not rewritten by the extension (see lib/prisma.ts).
     */
    async create(input: {
      tenantId: string
      name: string
      description?: string | null
      payloadSchema?: Prisma.InputJsonValue | null
      domainCondition?: Prisma.InputJsonValue | null
      enabled: boolean
      createdByUserId: string
    }): Promise<TenantEventTypeRow> {
      const data: Prisma.TenantEventTypeUncheckedCreateInput = {
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled,
        createdByUserId: input.createdByUserId,
        hasDomainCondition: input.domainCondition !== undefined && input.domainCondition !== null,
      }
      // Omitted JSON columns stay SQL NULL — they have no default.
      if (input.payloadSchema !== undefined && input.payloadSchema !== null) {
        data.payloadSchema = input.payloadSchema
      }
      if (input.domainCondition !== undefined && input.domainCondition !== null) {
        data.domainCondition = input.domainCondition
      }
      return db.tenantEventType.create({ data, select: EVENT_TYPE_SELECT })
    },

    /** Tenant-scoped fetch by id (another tenant's row resolves to null). */
    async findById(id: string): Promise<TenantEventTypeRow | null> {
      return db.tenantEventType.findFirst({ where: { id }, select: EVENT_TYPE_SELECT })
    },

    /** Tenant-scoped fetch by name — the unique (tenantId, name) lookup. */
    async findByName(name: string): Promise<TenantEventTypeRow | null> {
      return db.tenantEventType.findFirst({ where: { name }, select: EVENT_TYPE_SELECT })
    },

    /** Tenant-scoped list, newest first, optionally filtered by enabled. */
    async list(opts: { enabled?: boolean } = {}): Promise<TenantEventTypeRow[]> {
      return db.tenantEventType.findMany({
        where: opts.enabled === undefined ? {} : { enabled: opts.enabled },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: EVENT_TYPE_SELECT,
      })
    },

    /**
     * Partial update by id. `hasDomainCondition` is re-derived whenever
     * `domainCondition` is part of the patch. Pass `null` for a JSON field to
     * clear it; omit it to leave it untouched.
     */
    async update(
      id: string,
      input: {
        description?: string | null
        payloadSchema?: Prisma.InputJsonValue | null
        domainCondition?: Prisma.InputJsonValue | null
        enabled?: boolean
      },
    ): Promise<TenantEventTypeRow> {
      const data: Prisma.TenantEventTypeUncheckedUpdateInput = {}
      if (input.description !== undefined) data.description = input.description
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.payloadSchema !== undefined) {
        data.payloadSchema = input.payloadSchema === null ? Prisma.JsonNull : input.payloadSchema
      }
      if (input.domainCondition !== undefined) {
        data.domainCondition =
          input.domainCondition === null ? Prisma.JsonNull : input.domainCondition
        data.hasDomainCondition = input.domainCondition !== null
      }
      return db.tenantEventType.update({
        where: { id },
        data,
        select: EVENT_TYPE_SELECT,
      })
    },

    /** Hard delete by id. Tenant scope is applied implicitly via the extension. */
    async deleteById(id: string): Promise<void> {
      await db.tenantEventType.delete({ where: { id } })
    },
  }
}

export type TenantEventTypeRepository = ReturnType<typeof createTenantEventTypeRepository>
