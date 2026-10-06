// ---------------------------------------------------------------------------
// POST /users/import ("Add from pegII") and the SSO-only refusals on
// resend-invite / reset-password.
//
// The company directory read + membership sync (lib/company-directory), the
// users repository and Cognito provisioning are mocked; RBAC is real.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { seedPrincipalForRole } from '../__tests__/_principal'
import { _clearAuthzCache } from '../lib/authz'

const { repo, readDirectory, syncMemberships, provision, db } = vi.hoisted(() => ({
  repo: { findByEmail: vi.fn(), findById: vi.fn(), invite: vi.fn() },
  readDirectory: vi.fn(),
  syncMemberships: vi.fn(),
  provision: vi.fn(),
  db: {
    tenant: { findUnique: vi.fn() },
    tenantUser: { findFirst: vi.fn() },
    tenantSsoProvider: { count: vi.fn() },
  },
}))

vi.mock('../repositories/users', () => ({ createUsersRepository: vi.fn(() => repo) }))
vi.mock('./admin/cognito', () => ({
  provisionCognitoUser: provision,
  resetCognitoUserPassword: vi.fn(),
  resendCognitoInvite: vi.fn(),
}))
vi.mock('../lib/company-directory', async () => {
  const actual = await vi.importActual<object>('../lib/company-directory')
  return {
    ...actual,
    readCompanyDirectory: readDirectory,
    syncCompanyMemberships: syncMemberships,
  }
})

import { usersHandler } from './users'
import { CompanyDirectoryRefused } from '../lib/company-directory'
import { PegiiApiError } from '../lib/pegii-api-client'

const json = (res: Response) => res.json() as Promise<Record<string, unknown>>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(role: string | null = 'tenant_admin') {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', seedPrincipalForRole(role))
  app.use('*', async (c, next) => {
    c.set('db', db as unknown as PrismaClient)
    await next()
  })
  app.route('/', usersHandler)
  return app
}

const employee = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `E${id}`,
  email: `e${id}@qmm.com`,
  winUsername: `wun${id}`,
  active: true,
  dateTerminated: null,
  branch: '01',
  ...over,
})

const userRow = (id: string, email: string, ssoOnly = false) => ({
  id,
  tenantId: 'test-tenant-id',
  email,
  cognitoSub: null,
  legacyWindowsUsername: null,
  longhaulDriverId: null,
  roleNames: ['viewer'],
  status: 'PENDING',
  invitedAt: new Date('2026-10-06T00:00:00Z'),
  activatedAt: null,
  deactivatedAt: null,
  crewMember: null,
  ssoOnly,
})

const body = (over: Record<string, unknown> = {}) => ({
  companyId: 'co-usa',
  employeeCodes: [1001],
  roleNames: ['viewer'],
  sendInvite: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  db.tenantSsoProvider.count.mockResolvedValue(1)
  db.tenantUser.findFirst.mockResolvedValue(null)
  db.tenant.findUnique.mockResolvedValue({ name: 'QMM', slug: 'qmm' })
  repo.findByEmail.mockResolvedValue(null)
  repo.invite.mockImplementation(
    async (_t: string, email: string, _r: string[], o: { ssoOnly: boolean }) =>
      userRow(`u-${email}`, email, o.ssoOnly),
  )
  syncMemberships.mockResolvedValue({ employees: 2, linked: 1, newlyLinked: 1 })
  provision.mockResolvedValue(undefined)
})

describe('POST /import', () => {
  it('SSO-only: writes the row with no Cognito call, keeps the Windows username, then links', async () => {
    const directory = [employee('1001', { email: ' E1001@QMM.com ' }), employee('1002')]
    readDirectory.mockResolvedValue({ company: { id: 'co-usa' }, directory })

    const res = await buildApp().request('/import', post(body()))

    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Record<string, unknown>
    expect(data['results']).toEqual([
      { code: 1001, email: 'e1001@qmm.com', status: 'created', userId: 'u-e1001@qmm.com' },
    ])
    expect(data['created']).toBe(1)
    expect(provision).not.toHaveBeenCalled()
    expect(repo.invite).toHaveBeenCalledWith('test-tenant-id', 'e1001@qmm.com', ['viewer'], {
      ssoOnly: true,
      legacyWindowsUsername: 'wun1001',
    })
    // The sync gets the WHOLE directory it already read — no second pegII call.
    expect(syncMemberships).toHaveBeenCalledWith(db, 'test-tenant-id', 'co-usa', directory)
    expect(data['membershipSync']).toEqual({ employees: 2, linked: 1, newlyLinked: 1 })
  })

  it('sendInvite: provisions the Cognito user before writing a normal (non-SSO) row', async () => {
    readDirectory.mockResolvedValue({ company: {}, directory: [employee('1001')] })

    const res = await buildApp().request('/import', post(body({ sendInvite: true })))

    const results = ((await json(res))['data'] as { results: unknown[] }).results
    expect(results).toEqual([expect.objectContaining({ status: 'invited' })])
    expect(provision).toHaveBeenCalledWith('e1001@qmm.com', {
      tenantId: 'test-tenant-id',
      tenantName: 'QMM',
      tenantSlug: 'qmm',
    })
    expect(repo.invite.mock.calls[0]![3]).toMatchObject({ ssoOnly: false })
    expect(db.tenantSsoProvider.count).not.toHaveBeenCalled()
  })

  it('skips each ineligible employee with its reason and creates nothing for them', async () => {
    readDirectory.mockResolvedValue({
      company: {},
      directory: [
        employee('1'),
        employee('2', { active: false }),
        employee('3', { email: null }),
        employee('4', { email: 'not-an-email' }),
        employee('5'),
      ],
    })
    repo.findByEmail.mockImplementation(async (email: string) =>
      email === 'e1@qmm.com' ? userRow('existing', email) : null,
    )
    db.tenantUser.findFirst.mockImplementation(
      async ({ where }: { where: { email: { equals: string } } }) =>
        where.email.equals === 'e5@qmm.com' ? { id: 'other-tenant-user' } : null,
    )

    const res = await buildApp().request(
      '/import',
      post(body({ employeeCodes: [1, 2, 3, 4, 5, 999] })),
    )

    const data = (await json(res))['data'] as {
      results: Array<Record<string, unknown>>
      created: number
    }
    expect(data.results.map((r) => [r['code'], r['status'], r['reason']])).toEqual([
      [1, 'skipped', 'ALREADY_A_USER'],
      [2, 'skipped', 'INACTIVE'],
      [3, 'skipped', 'NO_EMAIL'],
      [4, 'skipped', 'NO_EMAIL'],
      [5, 'skipped', 'ACTIVE_IN_ANOTHER_TENANT'],
      [999, 'skipped', 'NOT_IN_DIRECTORY'],
    ])
    expect(data.created).toBe(0)
    expect(repo.invite).not.toHaveBeenCalled()
    expect(syncMemberships).not.toHaveBeenCalled()
  })

  it('one failing employee does not stop the rest', async () => {
    readDirectory.mockResolvedValue({ company: {}, directory: [employee('1'), employee('2')] })
    provision.mockRejectedValueOnce(new Error('cognito down'))

    const res = await buildApp().request(
      '/import',
      post(body({ employeeCodes: [1, 2], sendInvite: true })),
    )

    const results = ((await json(res))['data'] as { results: Array<Record<string, unknown>> })
      .results
    expect(results.map((r) => [r['code'], r['status'], r['reason']])).toEqual([
      [1, 'failed', 'COGNITO_ERROR'],
      [2, 'invited', undefined],
    ])
  })

  it('reports a membership-sync failure without undoing the created users', async () => {
    readDirectory.mockResolvedValue({ company: {}, directory: [employee('1')] })
    syncMemberships.mockRejectedValue(new Error('db'))

    const data = (
      await json(await buildApp().request('/import', post(body({ employeeCodes: [1] }))))
    )['data'] as Record<string, unknown>

    expect(data['created']).toBe(1)
    expect(data['membershipSync']).toEqual({ error: expect.stringMatching(/Sync employees/) })
  })

  it('refuses SSO-only without an enabled SSO provider, before reading pegII', async () => {
    db.tenantSsoProvider.count.mockResolvedValue(0)

    const res = await buildApp().request('/import', post(body()))

    expect(res.status).toBe(422)
    expect((await json(res))['code']).toBe('SSO_NOT_CONFIGURED')
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('maps directory refusals and pegII failures', async () => {
    readDirectory.mockRejectedValueOnce(
      new CompanyDirectoryRefused(409, 'SITE_CLOUD_AUTH_DISABLED', 'off'),
    )
    const refused = await buildApp().request('/import', post(body()))
    expect(refused.status).toBe(409)
    expect((await json(refused))['code']).toBe('SITE_CLOUD_AUTH_DISABLED')

    readDirectory.mockRejectedValueOnce(new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'old'))
    const old = await buildApp().request('/import', post(body()))
    expect(old.status).toBe(503)
    expect((await json(old))['code']).toBe('PEGII_CAPABILITY_MISSING')
  })

  it.each([
    ['an unknown role', { roleNames: ['superuser'] }],
    ['no roles', { roleNames: [] }],
    ['more than 50 employees', { employeeCodes: Array.from({ length: 51 }, (_, i) => i) }],
    ['a client-supplied email', { emails: ['x@y.com'] }],
  ])('rejects %s with 400', async (_label, over) => {
    const res = await buildApp().request('/import', post(body(over)))
    expect(res.status).toBe(400)
    expect(readDirectory).not.toHaveBeenCalled()
  })

  it('requires InviteUser', async () => {
    expect((await buildApp('viewer').request('/import', post(body()))).status).toBe(403)
  })
})

describe('SSO-only users refuse password flows', () => {
  it('resend-invite answers 422 SSO_ONLY without touching Cognito', async () => {
    repo.findById.mockResolvedValue(userRow('u1', 'a@qmm.com', true))

    const res = await buildApp().request('/u1/resend-invite', { method: 'POST' })

    expect(res.status).toBe(422)
    expect((await json(res))['code']).toBe('SSO_ONLY')
  })

  it('reset-password answers 422 SSO_ONLY even once they have signed in', async () => {
    repo.findById.mockResolvedValue({
      ...userRow('u1', 'a@qmm.com', true),
      status: 'ACTIVE',
      cognitoSub: 'federated-sub',
    })

    const res = await buildApp().request('/u1/reset-password', { method: 'POST' })

    expect(res.status).toBe(422)
    expect((await json(res))['code']).toBe('SSO_ONLY')
  })
})
