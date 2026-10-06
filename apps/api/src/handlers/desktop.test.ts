// ---------------------------------------------------------------------------
// POST /api/v1/desktop/session (cloud identity I4).
//
// Repositories are mocked; the minter is a REAL local-key ES256 minter, so the
// assertions read the actual claims the desktop would carry to the site.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Hono } from 'hono'
import { decodeJwt } from 'jose'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipal } from '../__tests__/_principal'
import { createLocalSigner } from '../lib/pegii-signer'
import { __setPegiiTokenMinterForTests, createPegiiTokenMinter } from '../lib/pegii-token'
import type { CompanyRow, SiteRow } from '../repositories/company.repository'

const { repo, memberships } = vi.hoisted(() => ({
  repo: { listCompanies: vi.fn(), listSites: vi.fn() },
  memberships: { listLinkedForUser: vi.fn() },
}))
vi.mock('../repositories/company.repository', async () => {
  const actual = await vi.importActual<object>('../repositories/company.repository')
  return { ...actual, createCompanyRepository: vi.fn(() => repo) }
})
vi.mock('../repositories/company-membership.repository', () => ({
  createCompanyMembershipRepository: vi.fn(() => memberships),
}))

import { desktopHandler } from './desktop'

const TENANT = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const SITE_ON = '11111111-1111-4111-8111-111111111111'
const SITE_OFF = '11111111-1111-4111-8111-1111111111ff'
const CANADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const USA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const HOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const RETIRED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'

const t0 = new Date('2026-10-06T00:00:00Z')
const site = (id: string, cloudAuthEnabled: boolean): SiteRow => ({
  id,
  tenantId: TENANT,
  name: id === SITE_ON ? 'Primary' : 'Other',
  cloudAuthEnabled,
  createdAt: t0,
  updatedAt: t0,
})
const company = (
  id: string,
  over: Partial<CompanyRow> & Pick<CompanyRow, 'code' | 'siteId'>,
): CompanyRow => ({
  id,
  tenantId: TENANT,
  displayName: over.code,
  dataSourceKey: null,
  systemEmployeeCode: null,
  isDefault: false,
  isActive: true,
  createdAt: t0,
  updatedAt: t0,
  ...over,
})

const COMPANIES = [
  company(CANADA, { code: 'QMM-CANADA', siteId: SITE_ON, isDefault: true }),
  company(USA, { code: 'QMM-USA', siteId: SITE_ON, dataSourceKey: 'PegQMMUSA' }),
  company(HOLD, { code: 'HOLD', siteId: SITE_OFF, dataSourceKey: 'PegHold' }),
  company(RETIRED, { code: 'RETIRED', siteId: SITE_ON, dataSourceKey: 'PegOld', isActive: false }),
]

const db = { tenantUser: { findFirst: vi.fn() } }

/** `userId: null` simulates a TenantUser that did not resolve. */
function buildApp(roleNames: string[], { userId = USER as string | null } = {}) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipal({ roleNames, tenantId: TENANT }))
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as PrismaClient)
    c.set('userId', userId ?? undefined)
    await next()
  })
  app.route('/', desktopHandler)
  return app
}

const session = (app: ReturnType<typeof buildApp>, body: unknown = {}) =>
  app.request('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

type Body = {
  data: {
    companies: Array<{ id: string; code: string; employeeCode: number | null }>
    bootstrapAllowed: boolean
    session?: { companyId: string; siteId: string; token: string; expiresAt: string }
  }
  code?: string
}

describe('POST /desktop/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    __setPegiiTokenMinterForTests(
      createPegiiTokenMinter({
        signer: createLocalSigner({ keyId: 'kid-1', privateKey }),
        issuer: 'https://api.pegasus.example.test',
      }),
    )
    repo.listCompanies.mockResolvedValue(COMPANIES)
    repo.listSites.mockResolvedValue([site(SITE_ON, true), site(SITE_OFF, false)])
    memberships.listLinkedForUser.mockResolvedValue(
      new Map([[USA, { employeeCode: 7429, legacyWindowsUsername: 'gdhoopar' }]]),
    )
    db.tenantUser.findFirst.mockResolvedValue({ isServiceAccount: false, status: 'ACTIVE' })
  })

  afterEach(() => {
    __setPegiiTokenMinterForTests(null)
  })

  it('lists only the LINKED companies on cloud-auth sites for an ordinary user', async () => {
    const res = await session(buildApp(['coordinator']))
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    expect(data.companies.map((c) => c.code)).toEqual(['QMM-USA'])
    expect(data.companies[0]!.employeeCode).toBe(7429)
    expect(data.bootstrapAllowed).toBe(false)
    expect(data.session).toBeUndefined()
  })

  it('mints a desktop-scoped token with cid/emp/wun for a linked company', async () => {
    const res = await session(buildApp(['coordinator']), { companyId: USA })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as Body
    const claims = decodeJwt(data.session!.token)
    expect(claims).toMatchObject({
      aud: `pegii-site:${SITE_ON}`,
      sub: USER,
      tid: TENANT,
      ptype: 'user',
      cid: 'PegQMMUSA',
      emp: 7429,
      wun: 'gdhoopar',
      scp: 'desktop',
    })
    expect(data.session!.siteId).toBe(SITE_ON)
    expect(data.session!.expiresAt).toBe(new Date(claims.exp! * 1000).toISOString())
  })

  it('refuses an unlinked company to an ordinary user (403)', async () => {
    const res = await session(buildApp(['coordinator']), { companyId: CANADA })
    expect(res.status).toBe(403)
    expect(((await res.json()) as Body).code).toBe('COMPANY_ACCESS_DENIED')
  })

  it('offers a tenant_admin every active company on a cloud-auth site, plus bootstrap', async () => {
    memberships.listLinkedForUser.mockResolvedValue(new Map())
    const res = await session(buildApp(['tenant_admin']))
    const { data } = (await res.json()) as Body
    expect(data.companies.map((c) => c.code)).toEqual(['QMM-CANADA', 'QMM-USA'])
    expect(data.bootstrapAllowed).toBe(true)
  })

  it('mints a tenant_admin bootstrap token for the default company: no cid, no emp/wun', async () => {
    memberships.listLinkedForUser.mockResolvedValue(new Map())
    const res = await session(buildApp(['tenant_admin']), { companyId: CANADA })
    expect(res.status).toBe(200)
    const claims = decodeJwt(((await res.json()) as Body).data.session!.token)
    expect(claims['scp']).toBe('desktop')
    expect(claims).not.toHaveProperty('cid')
    expect(claims).not.toHaveProperty('emp')
    expect(claims).not.toHaveProperty('wun')
  })

  it('answers 409 SITE_CLOUD_AUTH_DISABLED for a company whose site is on hold', async () => {
    const res = await session(buildApp(['tenant_admin']), { companyId: HOLD })
    expect(res.status).toBe(409)
    expect(((await res.json()) as Body).code).toBe('SITE_CLOUD_AUTH_DISABLED')
  })

  it('does not reveal a hold-site company to a user who could not open it anyway (403)', async () => {
    const res = await session(buildApp(['coordinator']), { companyId: HOLD })
    expect(res.status).toBe(403)
  })

  it('refuses an inactive company (403) and an unknown or cross-tenant one (404)', async () => {
    const admin = buildApp(['tenant_admin'])
    expect((await session(admin, { companyId: RETIRED })).status).toBe(403)
    // The tenant-scoped repository never returns another tenant's company.
    const res = await session(admin, { companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    expect(res.status).toBe(404)
  })

  it('refuses a service account (403) and a deactivated user (403)', async () => {
    db.tenantUser.findFirst.mockResolvedValueOnce({ isServiceAccount: true, status: 'ACTIVE' })
    expect((await session(buildApp(['tenant_admin']))).status).toBe(403)
    db.tenantUser.findFirst.mockResolvedValueOnce({
      isServiceAccount: false,
      status: 'DEACTIVATED',
    })
    expect((await session(buildApp(['tenant_admin']))).status).toBe(403)
  })

  it('answers 409 NO_USER when the TenantUser did not resolve', async () => {
    const res = await session(buildApp(['tenant_admin'], { userId: null }))
    expect(res.status).toBe(409)
    expect(memberships.listLinkedForUser).not.toHaveBeenCalled()
  })

  it('rejects a malformed companyId and unknown fields (400)', async () => {
    expect((await session(buildApp(['tenant_admin']), { companyId: 'nope' })).status).toBe(400)
    expect((await session(buildApp(['tenant_admin']), { tenantId: TENANT })).status).toBe(400)
  })

  it('surfaces an unconfigured minter as a legible error, not a 500 crash', async () => {
    __setPegiiTokenMinterForTests(null)
    const saved = process.env['PEGII_TOKEN_KMS_KEY_IDS']
    delete process.env['PEGII_TOKEN_KMS_KEY_IDS']
    try {
      const res = await session(buildApp(['coordinator']), { companyId: USA })
      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(((await res.json()) as Body).code).toBeDefined()
    } finally {
      if (saved !== undefined) process.env['PEGII_TOKEN_KMS_KEY_IDS'] = saved
    }
  })
})
