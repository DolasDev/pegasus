// ---------------------------------------------------------------------------
// Settings → companies & sites (tenant admin)
//
// A tenant (customer organization) operates one or more companies — legal
// entities, one legacy company database each (e.g. QMM-US and QMM-CA) — reached
// through an on-prem pegII site. The company's `dataSourceKey` is the site's
// SpokeConnections key for its database and travels as the pegII token's `cid`;
// null means the site's default database. See
// plans/todo/cloud-identity-and-companies.md.
//
//   GET   /companies        — sites + companies (ReadSettings)
//   POST  /companies        — add a company (UpdateSettings)
//   PATCH /companies/:id    — edit a company / make it the default (UpdateSettings)
//   PATCH /sites/:id        — rename a site / flip the cloud-auth switch (UpdateSettings)
//
// `cloudAuthEnabled` is the operator switch for cloud-issued pegII tokens: the
// bridge uses them for a site only when it is on AND the site's /version
// advertises pegii.cloud-auth.v1. Turn it on after the site runs a pegII API
// build that verifies cloud tokens (I2).
//
// Session-only (mounted on v1 under /settings), like the other settings routes.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import {
  createCompanyRepository,
  isUniqueViolation,
  type UpdateCompanyInput,
} from '../repositories/company.repository'

const Code = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, 'code must be 1-32 chars: A-Z, 0-9, "_" or "-"')
const DataSourceKey = z.string().trim().min(1).max(100).nullable()
const EmployeeCode = z.number().int().positive().nullable()

const CreateCompanyBody = z
  .object({
    code: Code,
    displayName: z.string().trim().min(1).max(200),
    dataSourceKey: DataSourceKey.optional(),
    systemEmployeeCode: EmployeeCode.optional(),
    siteId: z.string().uuid().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()

const PatchCompanyBody = z
  .object({
    code: Code.optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    dataSourceKey: DataSourceKey.optional(),
    systemEmployeeCode: EmployeeCode.optional(),
    isActive: z.boolean().optional(),
    // A default can only be moved, never unset — make another company default instead.
    isDefault: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required')

function validate<T extends z.ZodTypeAny>(schema: T) {
  return validator('json', (value, c) => {
    const r = schema.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data as z.infer<T>
  })
}

const conflict = (c: { json: (b: unknown, s: 409) => Response }) =>
  c.json(
    {
      error: 'a company with this code, or this site + dataSourceKey, already exists',
      code: 'COMPANY_CONFLICT',
    },
    409,
  )

export const settingsCompaniesHandler = new Hono<AppEnv>()

settingsCompaniesHandler.get('/companies', requirePermission(Actions.ReadSettings), async (c) => {
  const repo = createCompanyRepository(c.get('db') as PrismaClient)
  const [sites, companies] = await Promise.all([repo.listSites(), repo.listCompanies()])
  return c.json({ data: { sites, companies } })
})

settingsCompaniesHandler.post(
  '/companies',
  requirePermission(Actions.UpdateSettings),
  validate(CreateCompanyBody),
  async (c) => {
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')
    const repo = createCompanyRepository(c.get('db') as PrismaClient)

    let siteId = body.siteId
    if (siteId) {
      if (!(await repo.findSite(siteId))) {
        return c.json({ error: 'site not found', code: 'NOT_FOUND' }, 404)
      }
    } else {
      // No site given: use the tenant's Primary site, creating it (and the
      // tenant's default company) on first use.
      const tenant = await (c.get('db') as PrismaClient).tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true },
      })
      if (!tenant) return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
      siteId = (await repo.ensureDefaultTarget(tenant)).site.id
    }

    try {
      const company = await repo.createCompany({
        tenantId,
        siteId,
        code: body.code,
        displayName: body.displayName,
        dataSourceKey: body.dataSourceKey ?? null,
        systemEmployeeCode: body.systemEmployeeCode ?? null,
        isDefault: body.isDefault ?? false,
      })
      logger.info('company created', { tenantId, companyId: company.id, code: company.code })
      return c.json({ data: company }, 201)
    } catch (err) {
      if (isUniqueViolation(err)) return conflict(c)
      throw err
    }
  },
)

settingsCompaniesHandler.patch(
  '/companies/:id',
  requirePermission(Actions.UpdateSettings),
  validate(PatchCompanyBody),
  async (c) => {
    const tenantId = c.get('tenantId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = createCompanyRepository(c.get('db') as PrismaClient)

    const patch = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as UpdateCompanyInput

    try {
      const company = await repo.updateCompany(id, patch)
      if (!company) return c.json({ error: 'company not found', code: 'NOT_FOUND' }, 404)
      logger.info('company updated', { tenantId, companyId: id, fields: Object.keys(body) })
      return c.json({ data: company })
    } catch (err) {
      if (isUniqueViolation(err)) return conflict(c)
      throw err
    }
  },
)

const PatchSiteBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    cloudAuthEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required')

settingsCompaniesHandler.patch(
  '/sites/:id',
  requirePermission(Actions.UpdateSettings),
  validate(PatchSiteBody),
  async (c) => {
    const tenantId = c.get('tenantId')
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const repo = createCompanyRepository(c.get('db') as PrismaClient)

    const patch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.cloudAuthEnabled !== undefined ? { cloudAuthEnabled: body.cloudAuthEnabled } : {}),
    }
    try {
      const site = await repo.updateSite(id, patch)
      if (!site) return c.json({ error: 'site not found', code: 'NOT_FOUND' }, 404)
      logger.info('site updated', { tenantId, siteId: id, ...patch })
      return c.json({ data: site })
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json({ error: 'a site with this name already exists', code: 'SITE_CONFLICT' }, 409)
      }
      throw err
    }
  },
)
