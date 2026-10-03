// ---------------------------------------------------------------------------
// Company / Site repository
//
// A tenant (customer organization) operates one or more companies — legal
// entities, one legacy company database each — reached through sites (on-prem
// pegII API instances). See plans/todo/cloud-identity-and-companies.md.
//
// Both models are in TENANT_SCOPED_MODELS, so reads/updates are scoped by the
// Prisma extension; `create` is not rewritten by the extension, so tenantId is
// passed explicitly. Invariants the database enforces (see the migration):
//   - exactly one default company per tenant (partial unique index),
//   - (siteId, dataSourceKey) unique, and at most one company per site on the
//     site's default database (dataSourceKey IS NULL).
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'

export type SiteRow = {
  id: string
  tenantId: string
  name: string
  cloudAuthEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type CompanyRow = {
  id: string
  tenantId: string
  siteId: string
  code: string
  displayName: string
  dataSourceKey: string | null
  systemEmployeeCode: number | null
  isDefault: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export type CompanyTarget = { company: CompanyRow; site: SiteRow }

export type CreateCompanyInput = {
  tenantId: string
  siteId: string
  code: string
  displayName: string
  dataSourceKey?: string | null
  systemEmployeeCode?: number | null
  isDefault?: boolean
}

export type UpdateCompanyInput = Partial<
  Pick<CompanyRow, 'code' | 'displayName' | 'dataSourceKey' | 'systemEmployeeCode' | 'isActive'>
> & { isDefault?: true }

/** The site name the backfill and lazy creation use. */
export const PRIMARY_SITE_NAME = 'Primary'

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function createCompanyRepository(db: PrismaClient) {
  async function getDefaultTarget(): Promise<CompanyTarget | null> {
    const company = await db.company.findFirst({ where: { isDefault: true } })
    if (!company) return null
    const site = await db.site.findFirst({ where: { id: company.siteId } })
    return site ? { company, site } : null
  }

  return {
    listSites(): Promise<SiteRow[]> {
      return db.site.findMany({ orderBy: { createdAt: 'asc' } })
    },

    listCompanies(): Promise<CompanyRow[]> {
      return db.company.findMany({ orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] })
    },

    findCompany(id: string): Promise<CompanyRow | null> {
      return db.company.findFirst({ where: { id } })
    },

    findSite(id: string): Promise<SiteRow | null> {
      return db.site.findFirst({ where: { id } })
    },

    /** Patch a site (the cloud-auth operator switch). Null when the id is not this tenant's. */
    async updateSite(
      id: string,
      patch: Partial<Pick<SiteRow, 'name' | 'cloudAuthEnabled'>>,
    ): Promise<SiteRow | null> {
      const { count } = await db.site.updateMany({ where: { id }, data: patch })
      return count === 0 ? null : db.site.findFirst({ where: { id } })
    },

    getDefaultTarget,

    /**
     * The default company + its site, creating the tenant's "Primary" site and a
     * default company on the site's default database if none exist yet (a tenant
     * wired to pegII after the backfill migration). Idempotent and race-safe: the
     * unique indexes turn a concurrent duplicate into P2002, after which we re-read.
     */
    async ensureDefaultTarget(tenant: {
      id: string
      name: string
      slug: string
    }): Promise<CompanyTarget> {
      const existing = await getDefaultTarget()
      if (existing) return existing
      try {
        await db.$transaction(async (tx) => {
          const site =
            (await tx.site.findFirst({ where: { name: PRIMARY_SITE_NAME } })) ??
            (await tx.site.create({ data: { tenantId: tenant.id, name: PRIMARY_SITE_NAME } }))
          await tx.company.create({
            data: {
              tenantId: tenant.id,
              siteId: site.id,
              code: tenant.slug.toUpperCase(),
              displayName: tenant.name,
              isDefault: true,
            },
          })
        })
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
      }
      const target = await getDefaultTarget()
      if (!target) throw new Error(`tenant ${tenant.id} has no default company after ensure`)
      return target
    },

    /** Create a company; `isDefault` moves the tenant's default to it atomically. */
    async createCompany(input: CreateCompanyInput): Promise<CompanyRow> {
      return db.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.company.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
        }
        return tx.company.create({
          data: {
            tenantId: input.tenantId,
            siteId: input.siteId,
            code: input.code,
            displayName: input.displayName,
            dataSourceKey: input.dataSourceKey ?? null,
            systemEmployeeCode: input.systemEmployeeCode ?? null,
            isDefault: input.isDefault ?? false,
          },
        })
      })
    },

    /**
     * Patch a company. Setting `isDefault: true` moves the default atomically;
     * a default can't be unset directly (choose another company as default).
     * Returns null when the id is not this tenant's.
     */
    async updateCompany(id: string, patch: UpdateCompanyInput): Promise<CompanyRow | null> {
      return db.$transaction(async (tx) => {
        const current = await tx.company.findFirst({ where: { id } })
        if (!current) return null
        if (patch.isDefault && !current.isDefault) {
          await tx.company.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
        }
        await tx.company.updateMany({ where: { id }, data: patch })
        return tx.company.findFirst({ where: { id } })
      })
    },
  }
}

export type CompanyRepository = ReturnType<typeof createCompanyRepository>
