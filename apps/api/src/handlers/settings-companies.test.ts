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

import { settingsCompaniesHandler } from './settings-companies'

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
