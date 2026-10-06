// ---------------------------------------------------------------------------
// Unit tests for the companies settings handler. The repository and the root db
// (tenant-scoped db) are mocked; requirePermission is NOT mocked — real RBAC is enforced.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { mockTenantDb } = vi.hoisted(() => ({ mockTenantDb: { tenant: { findUnique: vi.fn() } } }))

const { repo } = vi.hoisted(() => ({
  repo: {
    listSites: vi.fn(),
    listCompanies: vi.fn(),
    findSite: vi.fn(),
    findCompany: vi.fn(),
    ensureDefaultTarget: vi.fn(),
    createCompany: vi.fn(),
    updateCompany: vi.fn(),
    updateSite: vi.fn(),
  },
}))
vi.mock('../repositories/company.repository', async () => {
  const actual = await vi.importActual<object>('../repositories/company.repository')
  return { ...actual, createCompanyRepository: vi.fn(() => repo) }
})

const { memberships, listSalesmen, resolveCaller } = vi.hoisted(() => ({
  memberships: {
    listSyncUsers: vi.fn(),
    listExisting: vi.fn(),
    applyPlan: vi.fn(),
    listForCompany: vi.fn(),
    listUserEmails: vi.fn(),
  },
  listSalesmen: vi.fn(),
  resolveCaller: vi.fn(),
}))
vi.mock('../repositories/company-membership.repository', () => ({
  createCompanyMembershipRepository: vi.fn(() => memberships),
}))
vi.mock('../gateways/salesman-gateway.factory', () => ({
  resolveSalesmanGateway: vi.fn(async (_db: unknown, _t: unknown, callerOf: () => unknown) => {
    await callerOf()
    return { listSalesmen }
  }),
}))
vi.mock('../lib/pegii-request-context', () => ({ resolvePegiiCaller: resolveCaller }))

import { settingsCompaniesHandler } from './settings-companies'
import { PegiiApiError } from '../lib/pegii-api-client'

const SITE = '11111111-1111-4111-8111-111111111111'
const json = (res: Response) => res.json() as Promise<Record<string, unknown>>
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' })

function buildApp(role: string | null = 'tenant_admin') {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', mockTenantDb as unknown as PrismaClient)
    c.set('tenantId', 'tenant-1')
    await next()
  })
  app.route('/', settingsCompaniesHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
})

describe('GET /companies', () => {
  it('returns sites and companies', async () => {
    repo.listSites.mockResolvedValue([{ id: SITE, name: 'Primary' }])
    repo.listCompanies.mockResolvedValue([{ id: 'c1', code: 'QMM-US', isDefault: true }])

    const res = await buildApp().request('/companies')

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({
      sites: [{ id: SITE, name: 'Primary' }],
      companies: [{ id: 'c1', code: 'QMM-US', isDefault: true }],
    })
  })

  it('returns 403 without a settings role', async () => {
    const res = await buildApp(null).request('/companies')
    expect(res.status).toBe(403)
  })
})

describe('POST /companies', () => {
  const body = { code: 'QMM-CA', displayName: 'QMM Canada', dataSourceKey: 'QMM_CA' }

  it('adds a company on the Primary site, creating it on first use', async () => {
    mockTenantDb.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'QMM', slug: 'qmm' })
    repo.ensureDefaultTarget.mockResolvedValue({ site: { id: SITE }, company: { id: 'c1' } })
    repo.createCompany.mockResolvedValue({ id: 'c2', ...body })

    const res = await buildApp().request('/companies', send('POST', body))

    expect(res.status).toBe(201)
    expect(repo.createCompany).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      siteId: SITE,
      code: 'QMM-CA',
      displayName: 'QMM Canada',
      dataSourceKey: 'QMM_CA',
      systemEmployeeCode: null,
      isDefault: false,
    })
  })

  it("404s a siteId that isn't this tenant's", async () => {
    repo.findSite.mockResolvedValue(null)

    const res = await buildApp().request('/companies', send('POST', { ...body, siteId: SITE }))

    expect(res.status).toBe(404)
    expect(repo.createCompany).not.toHaveBeenCalled()
  })

  it('409s a duplicate code or site+dataSourceKey', async () => {
    repo.findSite.mockResolvedValue({ id: SITE })
    repo.createCompany.mockRejectedValue(p2002())

    const res = await buildApp().request('/companies', send('POST', { ...body, siteId: SITE }))

    expect(res.status).toBe(409)
    expect(await json(res)).toMatchObject({ code: 'COMPANY_CONFLICT' })
  })

  it.each([
    [{ ...body, code: 'qmm ca' }],
    [{ ...body, displayName: '' }],
    [{ ...body, systemEmployeeCode: -1 }],
    [{ ...body, unexpected: true }],
  ])('400s an invalid body %#', async (bad) => {
    const res = await buildApp().request('/companies', send('POST', bad))
    expect(res.status).toBe(400)
  })

  it('403s a non-admin role', async () => {
    const res = await buildApp('viewer').request('/companies', send('POST', body))
    expect(res.status).toBe(403)
  })
})

describe('PATCH /companies/:id', () => {
  it('moves the default / edits fields', async () => {
    repo.updateCompany.mockResolvedValue({ id: 'c2', isDefault: true })

    const res = await buildApp().request('/companies/c2', send('PATCH', { isDefault: true }))

    expect(res.status).toBe(200)
    expect(repo.updateCompany).toHaveBeenCalledWith('c2', { isDefault: true })
  })

  it("404s a company that isn't this tenant's", async () => {
    repo.updateCompany.mockResolvedValue(null)
    const res = await buildApp().request('/companies/other', send('PATCH', { displayName: 'x' }))
    expect(res.status).toBe(404)
  })

  it.each([[{ isDefault: false }], [{}]])('400s %j (defaults move, never unset)', async (bad) => {
    const res = await buildApp().request('/companies/c2', send('PATCH', bad))
    expect(res.status).toBe(400)
  })

  it('409s a conflicting change', async () => {
    repo.updateCompany.mockRejectedValue(p2002())
    const res = await buildApp().request('/companies/c2', send('PATCH', { code: 'TAKEN' }))
    expect(res.status).toBe(409)
  })
})

describe('PATCH /sites/:id', () => {
  it('flips the cloud-auth operator switch', async () => {
    repo.updateSite.mockResolvedValue({ id: SITE, cloudAuthEnabled: true })

    const res = await buildApp().request(
      `/sites/${SITE}`,
      send('PATCH', { cloudAuthEnabled: true }),
    )

    expect(res.status).toBe(200)
    expect(repo.updateSite).toHaveBeenCalledWith(SITE, { cloudAuthEnabled: true })
  })

  it("404s a site that isn't this tenant's", async () => {
    repo.updateSite.mockResolvedValue(null)
    const res = await buildApp().request('/sites/other', send('PATCH', { name: 'X' }))
    expect(res.status).toBe(404)
  })

  it('409s a duplicate site name', async () => {
    repo.updateSite.mockRejectedValue(p2002())
    const res = await buildApp().request(`/sites/${SITE}`, send('PATCH', { name: 'Taken' }))
    expect(res.status).toBe(409)
    expect(await json(res)).toMatchObject({ code: 'SITE_CONFLICT' })
  })

  it.each([[{}], [{ cloudAuthEnabled: 'yes' }], [{ other: 1 }]])('400s %j', async (bad) => {
    const res = await buildApp().request(`/sites/${SITE}`, send('PATCH', bad))
    expect(res.status).toBe(400)
  })

  it('403s a non-admin role', async () => {
    const res = await buildApp('viewer').request(
      `/sites/${SITE}`,
      send('PATCH', { cloudAuthEnabled: true }),
    )
    expect(res.status).toBe(403)
  })
})

describe('POST /companies/:id/membership-sync', () => {
  const salesman = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    email: null,
    winUsername: null,
    active: true,
    dateTerminated: null,
    ...over,
  })

  beforeEach(() => {
    repo.findCompany.mockResolvedValue({
      id: 'co-usa',
      code: 'QMM-USA',
      dataSourceKey: 'PegQMMUSA',
      siteId: SITE,
    })
    repo.findSite.mockResolvedValue({ id: SITE, cloudAuthEnabled: true })
    memberships.listExisting.mockResolvedValue([])
    memberships.applyPlan.mockResolvedValue(undefined)
  })

  it("reads the company's directory as the calling admin and applies the plan", async () => {
    listSalesmen.mockResolvedValue([
      salesman('1001', { email: 'jane@qmm.com', winUsername: 'jdoe' }),
      salesman('1002', { email: 'gone@qmm.com', active: false }),
    ])
    memberships.listSyncUsers.mockResolvedValue([
      { id: 'u1', email: 'jane@qmm.com', legacyWindowsUsername: null },
      { id: 'u2', email: 'nobody@qmm.com', legacyWindowsUsername: null },
    ])

    const res = await buildApp().request('/companies/co-usa/membership-sync', { method: 'POST' })

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({
      employees: 2,
      linked: 1,
      newlyLinked: 1,
      deactivated: 0,
      unmatched: 1,
      ambiguous: 0,
      unmatchedUserIds: ['u2'],
      ambiguousMatches: [],
    })
    expect(resolveCaller).toHaveBeenCalledWith(expect.anything(), { companyId: 'co-usa' })
    // No active filter: the sync must see leavers to deactivate their links.
    expect(listSalesmen).toHaveBeenCalledWith({})
    const [tenantId, companyId, plan] = memberships.applyPlan.mock.calls[0]!
    expect([tenantId, companyId]).toEqual(['tenant-1', 'co-usa'])
    expect(plan.writes).toEqual([
      expect.objectContaining({ tenantUserId: 'u1', employeeCode: 1001, status: 'LINKED' }),
    ])
  })

  it('refuses with 409 SITE_CLOUD_AUTH_DISABLED while the site has cloud auth off', async () => {
    repo.findSite.mockResolvedValue({ id: SITE, cloudAuthEnabled: false })

    const res = await buildApp().request('/companies/co-usa/membership-sync', { method: 'POST' })

    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('SITE_CLOUD_AUTH_DISABLED')
    expect(listSalesmen).not.toHaveBeenCalled()
    expect(memberships.applyPlan).not.toHaveBeenCalled()
  })

  it("404s for a company that isn't the tenant's, without calling pegII", async () => {
    repo.findCompany.mockResolvedValue(null)

    const res = await buildApp().request('/companies/foreign/membership-sync', { method: 'POST' })

    expect(res.status).toBe(404)
    expect(listSalesmen).not.toHaveBeenCalled()
  })

  it('maps an old site build to 503 PEGII_CAPABILITY_MISSING and writes nothing', async () => {
    listSalesmen.mockRejectedValue(
      new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'does not support: pegii.salesmen.list.v1'),
    )

    const res = await buildApp().request('/companies/co-usa/membership-sync', { method: 'POST' })

    expect(res.status).toBe(503)
    expect((await json(res))['code']).toBe('PEGII_CAPABILITY_MISSING')
    expect(memberships.applyPlan).not.toHaveBeenCalled()
  })

  it("maps the site's COMPANY_NOT_FOUND (no SpokeConnections entry) to a legible 404", async () => {
    listSalesmen.mockRejectedValue(
      new PegiiApiError('PEGII_API_HTTP_ERROR', 'x', 404, 'COMPANY_NOT_FOUND'),
    )

    const res = await buildApp().request('/companies/co-usa/membership-sync', { method: 'POST' })

    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('COMPANY_NOT_FOUND')
  })

  it('requires UpdateSettings', async () => {
    const res = await buildApp(null).request('/companies/co-usa/membership-sync', {
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})

describe('GET /companies/:id/memberships', () => {
  it('returns the members and unmatched users', async () => {
    repo.findCompany.mockResolvedValue({ id: 'co-1' })
    memberships.listForCompany.mockResolvedValue({ members: [], unmatched: [{ id: 'u1' }] })

    const res = await buildApp().request('/companies/co-1/memberships')

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual({ members: [], unmatched: [{ id: 'u1' }] })
    expect(memberships.listForCompany).toHaveBeenCalledWith('tenant-1', 'co-1')
  })

  it("404s for a company that isn't the tenant's", async () => {
    repo.findCompany.mockResolvedValue(null)
    expect((await buildApp().request('/companies/x/memberships')).status).toBe(404)
  })
})

describe('GET /companies/:id/directory', () => {
  beforeEach(() => {
    repo.findCompany.mockResolvedValue({ id: 'co-usa', siteId: SITE })
    repo.findSite.mockResolvedValue({ id: SITE, cloudAuthEnabled: true })
  })

  it("lists the company's ACTIVE employees, marking those who already have a login", async () => {
    listSalesmen.mockResolvedValue([
      { id: '7392', name: 'B ANDREOPULOS', email: ' BAndreopulos@QMM.com ', branch: '01' },
      { id: '7429', name: 'G DHOOPAR', email: null, branch: '02' },
    ])
    memberships.listUserEmails.mockResolvedValue([{ id: 'u1', email: 'bandreopulos@qmm.com' }])

    const res = await buildApp().request('/companies/co-usa/directory')

    expect(res.status).toBe(200)
    expect((await json(res))['data']).toEqual([
      {
        code: 7392,
        name: 'B ANDREOPULOS',
        email: 'BAndreopulos@QMM.com',
        branch: '01',
        existingUserId: 'u1',
      },
      { code: 7429, name: 'G DHOOPAR', email: null, branch: '02', existingUserId: null },
    ])
    expect(listSalesmen).toHaveBeenCalledWith({ active: true })
    expect(resolveCaller).toHaveBeenCalledWith(expect.anything(), { companyId: 'co-usa' })
  })

  it('refuses with 409 while the site has cloud auth off', async () => {
    repo.findSite.mockResolvedValue({ id: SITE, cloudAuthEnabled: false })
    const res = await buildApp().request('/companies/co-usa/directory')
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('SITE_CLOUD_AUTH_DISABLED')
  })

  it('requires ReadSettings', async () => {
    expect((await buildApp(null).request('/companies/co-usa/directory')).status).toBe(403)
  })
})
