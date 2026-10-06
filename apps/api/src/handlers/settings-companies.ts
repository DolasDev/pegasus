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
//   POST  /companies/:id/membership-sync — link users to the company's employees (UpdateSettings)
//   GET   /companies/:id/memberships     — linked members + unmatched users (ReadSettings)
//   GET   /companies/:id/directory       — active employees for "Add from pegII" (ReadSettings)
//
// The membership sync (cloud identity I3) reads the company's salesman directory
// from its pegII site — minted as the calling admin, routed by the company's
// `cid` — and matches users by email, then Windows username
// (services/company-membership-sync.ts). On demand only; there is no cron. A
// LINKED membership puts `emp`/`wun` on that user's pegII tokens for that
// company — attribution only, never access (D-I1).
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
import { createCompanyMembershipRepository } from '../repositories/company-membership.repository'
import {
  CompanyDirectoryRefused,
  readCompanyDirectory,
  syncCompanyMemberships,
} from '../lib/company-directory'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'

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

// The membership sync calls the company's pegII site. Map a PegiiApiError to the
// same legible 502/503/404 the pegII runtime routes return (see
// pegiiApiErrorToHttp), e.g. 503 PEGII_CAPABILITY_MISSING for a site whose API
// build predates the salesman directory, or 404 COMPANY_NOT_FOUND when the
// site has no database for the company's dataSourceKey.
settingsCompaniesHandler.onError((err, c) => {
  if (err instanceof CompanyDirectoryRefused) {
    return c.json({ error: err.message, code: err.code }, err.status)
  }
  if (err instanceof PegiiApiError) {
    const { status, code, message } = pegiiApiErrorToHttp(err)
    const correlationId = c.get('correlationId') ?? 'unknown'
    logger.warn('company membership sync: pegII failure', {
      pegiiCode: err.code,
      pegiiStatus: err.status,
      status,
      correlationId,
    })
    return c.json({ error: message, code, correlationId }, status)
  }
  throw err
})

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

settingsCompaniesHandler.post(
  '/companies/:id/membership-sync',
  requirePermission(Actions.UpdateSettings),
  async (c) => {
    const tenantId = c.get('tenantId')
    const companyId = c.req.param('id') ?? ''
    // All employees, active or not: the sync deactivates links to leavers.
    const { directory } = await readCompanyDirectory(c, companyId)
    const summary = await syncCompanyMemberships(
      c.get('db') as PrismaClient,
      tenantId,
      companyId,
      directory,
    )
    // Counts only — no emails or usernames in the log.
    const { unmatchedUserIds: _u, ambiguousMatches: _a, ...counts } = summary
    logger.info('company membership sync', { tenantId, companyId, ...counts })
    return c.json({ data: summary })
  },
)

// GET /companies/:id/directory — the company's ACTIVE employees for the "Add
// from pegII" picker, each marked with the tenant user who already has that
// email (any status), so the picker can grey them out. The import route
// re-reads the directory itself; nothing here is trusted on the way back.
settingsCompaniesHandler.get(
  '/companies/:id/directory',
  requirePermission(Actions.ReadSettings),
  async (c) => {
    const tenantId = c.get('tenantId')
    const companyId = c.req.param('id') ?? ''
    const { directory } = await readCompanyDirectory(c, companyId, { active: true })
    const users = await createCompanyMembershipRepository(
      c.get('db') as PrismaClient,
    ).listUserEmails(tenantId)
    const userByEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id]))
    return c.json({
      data: directory.map((s) => ({
        code: Number(s.id),
        name: s.name,
        email: s.email?.trim() || null,
        branch: s.branch,
        existingUserId: s.email ? (userByEmail.get(s.email.trim().toLowerCase()) ?? null) : null,
      })),
    })
  },
)

settingsCompaniesHandler.get(
  '/companies/:id/memberships',
  requirePermission(Actions.ReadSettings),
  async (c) => {
    const tenantId = c.get('tenantId')
    const companyId = c.req.param('id') ?? ''
    const db = c.get('db') as PrismaClient
    const company = await createCompanyRepository(db).findCompany(companyId)
    if (!company) return c.json({ error: 'company not found', code: 'NOT_FOUND' }, 404)

    const view = await createCompanyMembershipRepository(db).listForCompany(tenantId, companyId)
    return c.json({ data: view })
  },
)
