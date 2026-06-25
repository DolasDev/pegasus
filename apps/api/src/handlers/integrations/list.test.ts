// ---------------------------------------------------------------------------
// Unit tests for the integrations list handler (GET /api/v1/integrations).
//
// Mirrors config.test.ts:
//   - createIntegrationConfigRepository is mocked (no DB).
//   - listIntegrationIds / getIntegrationDefinition are mocked (no registry state).
//   - requirePermission is NOT mocked — the real RBAC enforces ReadIntegrationConfig
//     against the principal's roleNames via the offline Cedar backend.
// A context-injecting stub middleware supplies principal / db / tenantId, exactly
// as the v1 tenantMiddleware would at runtime.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import { _clearAuthzCache } from '../../lib/authz'

const { mockRepo, mockListIntegrationIds, mockGetIntegrationDefinition } = vi.hoisted(() => ({
  mockRepo: { findActiveForScope: vi.fn() },
  mockListIntegrationIds: vi.fn(),
  mockGetIntegrationDefinition: vi.fn(),
}))

vi.mock('../../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: vi.fn(() => mockRepo),
}))

vi.mock('../../integration-validation/registry', () => ({
  listIntegrationIds: mockListIntegrationIds,
  getIntegrationDefinition: mockGetIntegrationDefinition,
}))

import { integrationsHandler } from './list'

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

const DEFS: Record<string, { id: string; displayName: string; description: string }> = {
  weichert: { id: 'weichert', displayName: 'Weichert', description: 'Validates Weichert orders.' },
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
    mockListIntegrationIds.mockReturnValue(['weichert'])
    mockGetIntegrationDefinition.mockImplementation((id: string) => DEFS[id])
    mockRepo.findActiveForScope.mockResolvedValue(null)
  })

  it('returns 403 without ReadIntegrationConfig (viewer)', async () => {
    const res = await buildApp(['viewer']).request('/integrations')
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('FORBIDDEN')
    expect(mockRepo.findActiveForScope).not.toHaveBeenCalled()
  })

  it('returns one row per registered integration with display metadata (tenant_admin)', async () => {
    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.data).toEqual([
      {
        id: 'weichert',
        name: 'Weichert',
        description: 'Validates Weichert orders.',
        published: false,
        version: null,
        visibility: null,
      },
    ])
  })

  it('reflects an active published config (version + visibility) when one exists', async () => {
    mockRepo.findActiveForScope.mockImplementation(async (id: string) =>
      id === 'weichert' ? { version: 4, visibility: 'GLOBAL' as const } : null,
    )
    const res = await buildApp(['tenant_admin']).request('/integrations')
    expect(res.status).toBe(200)
    const data = (await json(res)).data as Array<Record<string, unknown>>
    expect(data[0]).toMatchObject({
      id: 'weichert',
      published: true,
      version: 4,
      visibility: 'GLOBAL',
    })
  })
})
