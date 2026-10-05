import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'

const { tenantFindUnique } = vi.hoisted(() => ({ tenantFindUnique: vi.fn() }))

const { repo, memberships } = vi.hoisted(() => ({
  repo: {
    getDefaultTarget: vi.fn(),
    ensureDefaultTarget: vi.fn(),
    findCompany: vi.fn(),
    findSite: vi.fn(),
  },
  memberships: { findLinked: vi.fn() },
}))
vi.mock('../../repositories/company.repository', () => ({
  createCompanyRepository: vi.fn(() => repo),
}))
vi.mock('../../repositories/company-membership.repository', () => ({
  createCompanyMembershipRepository: vi.fn(() => memberships),
}))

import { resolvePegiiCaller, type PegiiCaller } from '../pegii-request-context'

const TARGET = {
  site: { id: 'site-1', name: 'Primary', cloudAuthEnabled: true },
  company: {
    id: 'co-1',
    code: 'NW',
    dataSourceKey: null,
    systemEmployeeCode: 1001,
    isDefault: true,
  },
}

/** Run resolvePegiiCaller inside a request with the given context variables. */
async function resolveWith(vars: {
  userId?: string
  actsAsUserId?: string | null
  users?: Record<string, { id: string; isServiceAccount: boolean }>
  companyId?: string
}): Promise<{ caller: PegiiCaller; findFirst: ReturnType<typeof vi.fn> }> {
  const findFirst = vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
    where.tenantId === 'tenant-1' ? (vars.users?.[where.id] ?? null) : null,
  )
  const app = new Hono<AppEnv>()
  let caller: PegiiCaller | undefined
  app.get('/', async (c) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'req-42')
    c.set('db', {
      tenantUser: { findFirst },
      tenant: { findUnique: tenantFindUnique },
    } as unknown as PrismaClient)
    c.set('userId', vars.userId)
    c.set(
      'apiClient',
      vars.actsAsUserId !== undefined
        ? ({ id: 'client-1', actsAsUserId: vars.actsAsUserId } as never)
        : undefined,
    )
    caller = await resolvePegiiCaller(c, vars.companyId ? { companyId: vars.companyId } : {})
    return c.text('ok')
  })
  await app.request('/')
  return { caller: caller!, findFirst }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.getDefaultTarget.mockResolvedValue(TARGET)
  memberships.findLinked.mockResolvedValue(null)
})

describe('resolvePegiiCaller', () => {
  it('acts as the ApiClient service account for M2M / workflow calls', async () => {
    const { caller } = await resolveWith({
      actsAsUserId: 'svc-1',
      userId: 'ignored-user',
      users: { 'svc-1': { id: 'svc-1', isServiceAccount: true } },
    })

    expect(caller).toEqual({
      tenantId: 'tenant-1',
      correlationId: 'req-42',
      principal: { tenantUserId: 'svc-1', isServiceAccount: true, attribution: null },
      site: { id: 'site-1', cloudAuthEnabled: true },
      company: { id: 'co-1', code: 'NW', dataSourceKey: null, systemEmployeeCode: 1001 },
    })
  })

  it('acts as the signed-in TenantUser for Cognito calls', async () => {
    const { caller } = await resolveWith({
      userId: 'user-1',
      users: { 'user-1': { id: 'user-1', isServiceAccount: false } },
    })

    expect(caller.principal).toEqual({
      tenantUserId: 'user-1',
      isServiceAccount: false,
      attribution: null,
    })
    expect(memberships.findLinked).toHaveBeenCalledWith('co-1', 'user-1')
  })

  it("carries a user's LINKED membership in the target company as attribution", async () => {
    memberships.findLinked.mockResolvedValue({ employeeCode: 4471, legacyWindowsUsername: 'jdoe' })

    const { caller } = await resolveWith({
      userId: 'user-1',
      users: { 'user-1': { id: 'user-1', isServiceAccount: false } },
    })

    expect(caller.principal.attribution).toEqual({ employeeCode: 4471, windowsUsername: 'jdoe' })
  })

  it('never looks up a membership for a service account', async () => {
    await resolveWith({
      actsAsUserId: 'svc-1',
      users: { 'svc-1': { id: 'svc-1', isServiceAccount: true } },
    })

    expect(memberships.findLinked).not.toHaveBeenCalled()
  })

  it('targets a named company and its site instead of the default', async () => {
    repo.findCompany.mockResolvedValue({
      ...TARGET.company,
      id: 'co-usa',
      code: 'QMM-USA',
      dataSourceKey: 'PegQMMUSA',
      siteId: 'site-1',
      isDefault: false,
    })
    repo.findSite.mockResolvedValue(TARGET.site)

    const { caller } = await resolveWith({
      userId: 'user-1',
      users: { 'user-1': { id: 'user-1', isServiceAccount: false } },
      companyId: 'co-usa',
    })

    expect(repo.getDefaultTarget).not.toHaveBeenCalled()
    expect(caller.company).toMatchObject({ id: 'co-usa', dataSourceKey: 'PegQMMUSA' })
    expect(memberships.findLinked).toHaveBeenCalledWith('co-usa', 'user-1')
  })

  it("refuses a named company the tenant-scoped read can't see", async () => {
    repo.findCompany.mockResolvedValue(null)
    const app = new Hono<AppEnv>()
    app.get('/', async (c) => {
      c.set('tenantId', 'tenant-1')
      c.set('db', { tenantUser: { findFirst: vi.fn() } } as unknown as PrismaClient)
      await resolvePegiiCaller(c, { companyId: 'foreign' })
      return c.text('ok')
    })

    expect((await app.request('/')).status).toBe(500)
  })

  it('looks the user up within the tenant only, so a foreign id resolves to no principal', async () => {
    const { caller, findFirst } = await resolveWith({ userId: 'someone-elses-user' })

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses-user', tenantId: 'tenant-1' } }),
    )
    expect(caller.principal.tenantUserId).toBeNull()
  })

  it('leaves the principal unresolved for a legacy ApiClient with no acts-as user', async () => {
    const { caller, findFirst } = await resolveWith({ actsAsUserId: null })

    expect(findFirst).not.toHaveBeenCalled()
    expect(caller.principal).toEqual({
      tenantUserId: null,
      isServiceAccount: false,
      attribution: null,
    })
  })

  it('creates the Primary site + default company on first use', async () => {
    repo.getDefaultTarget.mockResolvedValue(null)
    repo.ensureDefaultTarget.mockResolvedValue(TARGET)
    tenantFindUnique.mockResolvedValue({ id: 'tenant-1', name: 'NW', slug: 'nw' })

    const { caller } = await resolveWith({ userId: 'u' })

    expect(repo.ensureDefaultTarget).toHaveBeenCalledWith({
      id: 'tenant-1',
      name: 'NW',
      slug: 'nw',
    })
    expect(caller.site.id).toBe('site-1')
  })
})
