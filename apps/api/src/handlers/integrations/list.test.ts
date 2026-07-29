// ---------------------------------------------------------------------------
// Unit tests for the integrations list handler (GET /api/v1/integrations).
//
// Mirrors config.test.ts:
//   - createIntegrationConfigRepository is mocked (no DB).
//   - listIntegrationIdsForScope / getIntegrationDefinition / toDefinitionFromRow
//     are mocked (no registry state).
//   - requirePermission is NOT mocked — the real RBAC enforces ReadIntegrationConfig
//     against the principal's roleNames via the offline Cedar backend.
// A context-injecting stub middleware supplies principal / db / tenantId, exactly
// as the v1 tenantMiddleware would at runtime.
//
// Scope note: with the registry stubbed, these tests cover the handler's RBAC and
// response shape ONLY — they cannot observe which ids the real registry would
// enumerate. That is what summaries.test.ts (DB-backed) is for; a mocked test
// here is structurally incapable of catching a cold-cache/id-set regression.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import { _clearAuthzCache } from '../../lib/authz'

const {
  mockRepo,
  mockListIntegrationIdsForScope,
  mockGetIntegrationDefinition,
  mockToDefinitionFromRow,
} = vi.hoisted(() => ({
  mockRepo: { findActiveForScope: vi.fn() },
  mockListIntegrationIdsForScope: vi.fn(),
  mockGetIntegrationDefinition: vi.fn(),
  mockToDefinitionFromRow: vi.fn(),
}))

vi.mock('../../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: vi.fn(() => mockRepo),
}))

vi.mock('../../integration-validation/registry', () => ({
  listIntegrationIdsForScope: mockListIntegrationIdsForScope,
  getIntegrationDefinition: mockGetIntegrationDefinition,
  toDefinitionFromRow: mockToDefinitionFromRow,
}))

import { integrationsHandler } from './list'

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

const DEFS: Record<string, { id: string; displayName: string; description: string }> = {
  demo_partner: {
    id: 'demo_partner',
    displayName: 'Demo Partner',
    description: 'Validates Demo Partner orders.',
  },
}

function buildApp(roleNames: readonly string[] = ['tenant_admin'], tenantId = 'test-tenant-id') {
  const fakeDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub: 'test-sub', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', 'user-1')
    await next()
  })
  app.route('/integrations', integrationsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integrations list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['AUTHZ_OFFLINE'] = 'true'
    _clearAuthzCache()
    mockListIntegrationIdsForScope.mockResolvedValue(['demo_partner'])
    mockGetIntegrationDefinition.mockImplementation((id: string) => DEFS[id])
    mockToDefinitionFromRow.mockReturnValue(null)
    mockRepo.findActiveForScope.mockResolvedValue(null)
  })

  it('allows the viewer read-only role to list integrations', async () => {
    // ReadIntegrationConfig is on the viewer baseline (20-viewer.cedar) so
    // business users see the Integrations list, not just admins.
    const res = await buildApp(['viewer']).request('/integrations')
    expect(res.status).toBe(200)
    expect(mockRepo.findActiveForScope).toHaveBeenCalled()
  })

  it('returns one row per registered integration with display metadata (tenant_admin)', async () => {
    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data).toEqual([
      {
        id: 'demo_partner',
        name: 'Demo Partner',
        description: 'Validates Demo Partner orders.',
        published: false,
        version: null,
        visibility: null,
      },
    ])
  })

  it('reflects an active published config (version + visibility) when one exists', async () => {
    mockRepo.findActiveForScope.mockImplementation(async (id: string) =>
      id === 'demo_partner' ? { version: 4, visibility: 'GLOBAL' as const } : null,
    )
    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    const data = (await json(res)).data as Array<Record<string, unknown>>
    expect(data[0]).toMatchObject({
      id: 'demo_partner',
      published: true,
      version: 4,
      visibility: 'GLOBAL',
    })
  })

  it('refuses to list anything without tenant context', async () => {
    // The read model is tenant-scoped end to end; no tenant means no query, not
    // an unscoped one.
    const res = await buildApp(['tenant_admin'], '').request('/integrations')
    // The test error handler collapses every DomainError to 422, so assert the
    // code — that is the part the real error handler keys off.
    expect(await json(res)).toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(mockListIntegrationIdsForScope).not.toHaveBeenCalled()
  })

  it('resolves an id with no built-in definition from its published row', async () => {
    // A TENANT-scoped config may introduce an id the code registry has never
    // heard of; its display metadata can only come from the row itself.
    mockListIntegrationIdsForScope.mockResolvedValue(['my_partner'])
    mockGetIntegrationDefinition.mockReturnValue(undefined)
    mockRepo.findActiveForScope.mockResolvedValue({
      version: 2,
      visibility: 'TENANT' as const,
      displayName: 'My Partner',
    })
    mockToDefinitionFromRow.mockReturnValue({
      id: 'my_partner',
      displayName: 'My Partner',
      description: 'Tenant-authored partner.',
    })

    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    expect((await json(res)).data).toEqual([
      {
        id: 'my_partner',
        name: 'My Partner',
        description: 'Tenant-authored partner.',
        published: true,
        version: 2,
        visibility: 'TENANT',
      },
    ])
  })

  it('skips an id that resolves to no definition at all', async () => {
    // e.g. a row naming an unknown floor — it can never take effect, so listing
    // it would misrepresent what the tenant has.
    mockListIntegrationIdsForScope.mockResolvedValue(['ghost'])
    mockGetIntegrationDefinition.mockReturnValue(undefined)
    mockRepo.findActiveForScope.mockResolvedValue({ version: 1, visibility: 'TENANT' as const })
    mockToDefinitionFromRow.mockReturnValue(null)

    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    expect((await json(res)).data).toEqual([])
  })
})
