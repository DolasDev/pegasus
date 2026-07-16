// ---------------------------------------------------------------------------
// Unit tests for the non-workflow projection read-model surface
// (sdk-feedback/0026 Part 2): GET /integrations/:id/projections/:entityType[/:key]
// with a status/updatedSince filter + keyset paging.
//
// The repository is mocked; dualAuthMiddleware is stubbed to inject context;
// requirePermission is NOT mocked — real Cedar RBAC runs. ReadIntegrationProjection
// is now granted to the viewer persona (so business users can read), while a role
// without it (workflow_developer) is denied.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    findByKey: vi.fn(),
    findState: vi.fn(),
    list: vi.fn(),
    upsert: vi.fn(),
    deleteByKey: vi.fn(),
  },
}))

vi.mock('../repositories/integration-projection.repository', () => ({
  createIntegrationProjectionRepository: vi.fn(() => mockRepo),
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationProjectionReadHandler } from './integration-projections'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

function buildApp(roleNames: readonly string[] = ['viewer']) {
  const fakeDb = {} as unknown as PrismaClient
  const tenantId = 'test-tenant-id'
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub: 'test-sub', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', 'user-1')
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/', integrationProjectionReadHandler)
  return app
}

const now = new Date('2026-07-16T12:00:00Z')
function projectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    tenantId: 'test-tenant-id',
    integrationId: 'sirva_ade_shipment',
    entityType: 'shipment',
    entityKey: 'AVL:111422:2014',
    state: { status: 'LOADED', Source: { RegNumber: '111422' } },
    version: 1,
    updatedByUserId: 'svc-user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const LIST = '/integrations/sirva_ade_shipment/projections/shipment'

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AUTHZ_OFFLINE'] = 'true'
  _clearAuthzCache()
  mockRepo.list.mockResolvedValue([projectionRow()])
  mockRepo.findByKey.mockResolvedValue(projectionRow())
})

describe('GET /integrations/:id/projections/:entityType (list)', () => {
  it('200 — viewer can read (ReadIntegrationProjection now granted to viewer)', async () => {
    const res = await buildApp(['viewer']).request(LIST)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['data'] as unknown[]).length).toBe(1)
    // Default paging: no filters, limit 50.
    expect(mockRepo.list).toHaveBeenCalledWith('sirva_ade_shipment', 'shipment', { limit: 50 })
  })

  it('200 — also readable by workflow_runtime', async () => {
    const res = await buildApp(['workflow_runtime']).request(LIST)
    expect(res.status).toBe(200)
  })

  it('403 — a role without ReadIntegrationProjection (workflow_developer) is denied', async () => {
    const res = await buildApp(['workflow_developer']).request(LIST)
    expect(res.status).toBe(403)
    expect(mockRepo.list).not.toHaveBeenCalled()
  })

  it('filters by status (a subset, not the whole type)', async () => {
    await buildApp().request(`${LIST}?status=LOADED`)
    expect(mockRepo.list).toHaveBeenCalledWith('sirva_ade_shipment', 'shipment', {
      status: 'LOADED',
      limit: 50,
    })
  })

  it('filters by updatedSince (parsed to a Date)', async () => {
    await buildApp().request(`${LIST}?updatedSince=2026-07-15T00:00:00Z`)
    const call = mockRepo.list.mock.calls[0]![2] as { updatedSince: Date; limit: number }
    expect(call.updatedSince).toBeInstanceOf(Date)
    expect(call.updatedSince.toISOString()).toBe('2026-07-15T00:00:00.000Z')
    expect(call.limit).toBe(50)
  })

  it('400 — invalid updatedSince', async () => {
    const res = await buildApp().request(`${LIST}?updatedSince=not-a-date`)
    expect(res.status).toBe(400)
    expect(mockRepo.list).not.toHaveBeenCalled()
  })

  it('paginates: a full page yields a nextCursor, a short page yields null', async () => {
    // Full page of 2 with limit=2 → nextCursor = last entityKey.
    mockRepo.list.mockResolvedValue([
      projectionRow({ entityKey: 'A' }),
      projectionRow({ entityKey: 'B' }),
    ])
    const res = await buildApp().request(`${LIST}?limit=2`)
    const body = await json(res)
    expect((body['meta'] as JsonBody)['nextCursor']).toBe('B')
    expect(mockRepo.list).toHaveBeenCalledWith('sirva_ade_shipment', 'shipment', { limit: 2 })

    // Short page → end of results.
    mockRepo.list.mockResolvedValue([projectionRow({ entityKey: 'A' })])
    const res2 = await buildApp().request(`${LIST}?limit=2`)
    expect(((await json(res2))['meta'] as JsonBody)['nextCursor']).toBeNull()
  })

  it('passes a cursor through to the repository', async () => {
    await buildApp().request(`${LIST}?limit=10&cursor=AVL:1:2020`)
    expect(mockRepo.list).toHaveBeenCalledWith('sirva_ade_shipment', 'shipment', {
      cursor: 'AVL:1:2020',
      limit: 10,
    })
  })

  it('400 — limit out of range', async () => {
    expect((await buildApp().request(`${LIST}?limit=0`)).status).toBe(400)
    expect((await buildApp().request(`${LIST}?limit=999`)).status).toBe(400)
  })
})

describe('GET /integrations/:id/projections/:entityType/:entityKey (one)', () => {
  it('200 — returns the single record', async () => {
    const res = await buildApp(['viewer']).request(`${LIST}/AVL:111422:2014`)
    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as JsonBody)['entityKey']).toBe('AVL:111422:2014')
  })

  it('404 — unknown key', async () => {
    mockRepo.findByKey.mockResolvedValue(null)
    const res = await buildApp(['viewer']).request(`${LIST}/nope`)
    expect(res.status).toBe(404)
  })

  it('403 — denied without the read action', async () => {
    const res = await buildApp(['workflow_developer']).request(`${LIST}/AVL:111422:2014`)
    expect(res.status).toBe(403)
  })
})
