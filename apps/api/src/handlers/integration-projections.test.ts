// ---------------------------------------------------------------------------
// Unit tests for the integration-projections handler.
//
// The repository is mocked so no DB is required. dualAuthMiddleware is stubbed
// to inject the AppEnv context; requirePermission is NOT mocked — real Cedar
// RBAC runs. The runtime surface is gated by Read/WriteIntegrationProjection,
// granted to workflow_runtime; workflow_developer holds neither, so it is the
// negative persona here. tenant_admin is permit-all (not used for 403 cases).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo, mockCorrRepo, mockResolveDefinition } = vi.hoisted(() => ({
  mockRepo: {
    findByKey: vi.fn(),
    findState: vi.fn(),
    list: vi.fn(),
    upsert: vi.fn(),
    deleteByKey: vi.fn(),
  },
  mockCorrRepo: {
    findByLocal: vi.fn(),
    findByExternal: vi.fn(),
    upsert: vi.fn(),
    deleteByLocal: vi.fn(),
  },
  mockResolveDefinition: vi.fn(),
}))

vi.mock('../repositories/integration-projection.repository', () => ({
  createIntegrationProjectionRepository: vi.fn(() => mockRepo),
}))

vi.mock('../repositories/integration-correlation.repository', () => ({
  createIntegrationCorrelationRepository: vi.fn(() => mockCorrRepo),
}))

vi.mock('../integration-validation/registry', () => ({
  resolveIntegrationDefinition: mockResolveDefinition,
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { integrationProjectionsHandler } from './integration-projections'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(
  roleNames: readonly string[] = ['workflow_runtime'],
  ctx: { userId?: string | null } = {},
) {
  const fakeDb = {} as unknown as PrismaClient
  const tenantId = 'test-tenant-id'
  const userId = ctx.userId === undefined ? 'svc-user-1' : ctx.userId
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub: 'test-sub', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', userId ?? undefined)
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/integration-projections', integrationProjectionsHandler)
  return app
}

const now = new Date('2026-06-29T12:00:00Z')
function projectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    tenantId: 'test-tenant-id',
    integrationId: 'demo_partner',
    entityType: 'order',
    entityKey: 'SO-1',
    state: { serviceOrderNumber: 'SO-1' },
    version: 1,
    fetchedAt: null,
    updatedByUserId: 'svc-user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const BASE = '/integration-projections/runtime/demo_partner/order'

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
})

describe('GET /runtime/:integrationId/:entityType/:entityKey', () => {
  it('returns the projection for workflow_runtime', async () => {
    mockRepo.findByKey.mockResolvedValue(projectionRow())
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/SO-1`)
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Record<string, unknown>
    expect(data['entityKey']).toBe('SO-1')
    expect(data['state']).toEqual({ serviceOrderNumber: 'SO-1' })
    expect(mockRepo.findByKey).toHaveBeenCalledWith('demo_partner', 'order', 'SO-1')
  })

  it('returns 404 on a miss', async () => {
    mockRepo.findByKey.mockResolvedValue(null)
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/NOPE`)
    expect(res.status).toBe(404)
  })

  it('rejects a role without ReadIntegrationProjection (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(`${BASE}/SO-1`)
    expect(res.status).toBe(403)
    expect(mockRepo.findByKey).not.toHaveBeenCalled()
  })

  it('returns 400 on an invalid path segment', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/bad%20key%21%21`)
    // '!' is not in the allowed set
    expect(res.status).toBe(400)
    expect(mockRepo.findByKey).not.toHaveBeenCalled()
  })
})

describe('GET /runtime/:integrationId/:entityType (list)', () => {
  it('lists records for the entity type', async () => {
    mockRepo.list.mockResolvedValue([projectionRow(), projectionRow({ entityKey: 'SO-2' })])
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(BASE)
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as Array<Record<string, unknown>>
    expect(data.map((r) => r['entityKey'])).toEqual(['SO-1', 'SO-2'])
    expect(mockRepo.list).toHaveBeenCalledWith('demo_partner', 'order')
  })
})

describe('PUT /runtime/:integrationId/:entityType/:entityKey', () => {
  it('creates a projection (201) for workflow_runtime', async () => {
    mockRepo.upsert.mockResolvedValue({ row: projectionRow(), created: true })
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/SO-1`, put({ state: { serviceOrderNumber: 'SO-1' } }))
    expect(res.status).toBe(201)
    expect(mockRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'test-tenant-id',
        integrationId: 'demo_partner',
        entityType: 'order',
        entityKey: 'SO-1',
        updatedByUserId: 'svc-user-1',
      }),
    )
  })

  it('updates a projection (200) when it already exists', async () => {
    mockRepo.upsert.mockResolvedValue({ row: projectionRow({ version: 2 }), created: false })
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/SO-1`, put({ state: { serviceOrderNumber: 'SO-1' } }))
    expect(res.status).toBe(200)
    expect((await json(res))['data']).toMatchObject({ version: 2 })
  })

  it('rejects a role without WriteIntegrationProjection (workflow_developer) with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(`${BASE}/SO-1`, put({ state: {} }))
    expect(res.status).toBe(403)
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 when state is missing from the body', async () => {
    const app = buildApp(['workflow_runtime'])
    const res = await app.request(`${BASE}/SO-1`, put({}))
    expect(res.status).toBe(400)
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })

  it('returns 413 when the state exceeds 256 KB', async () => {
    const app = buildApp(['workflow_runtime'])
    const big = { blob: 'x'.repeat(256 * 1024 + 1) }
    const res = await app.request(`${BASE}/SO-1`, put({ state: big }))
    expect(res.status).toBe(413)
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })

  it('returns 422 without an authenticated user', async () => {
    const app = buildApp(['workflow_runtime'], { userId: null })
    const res = await app.request(`${BASE}/SO-1`, put({ state: {} }))
    expect(res.status).toBe(422)
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /runtime/:integrationId/:entityType/:entityKey', () => {
  it('returns 204 then 404 when absent', async () => {
    mockRepo.deleteByKey.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const app = buildApp(['workflow_runtime'])
    const ok = await app.request(`${BASE}/SO-1`, { method: 'DELETE' })
    expect(ok.status).toBe(204)
    expect(mockRepo.deleteByKey).toHaveBeenCalledWith('demo_partner', 'order', 'SO-1')
    const missing = await app.request(`${BASE}/NOPE`, { method: 'DELETE' })
    expect(missing.status).toBe(404)
  })

  it('rejects a role without WriteIntegrationProjection with 403', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(`${BASE}/SO-1`, { method: 'DELETE' })
    expect(res.status).toBe(403)
    expect(mockRepo.deleteByKey).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Correlation (vanline-source-binding Phase 1, Gap A)
// ---------------------------------------------------------------------------

const withCorrelation = { correlation: { localEntityType: 'shipment' } }

describe('PUT with a correlation', () => {
  beforeEach(() => {
    mockRepo.upsert.mockResolvedValue({ row: projectionRow(), created: false })
    mockResolveDefinition.mockResolvedValue(withCorrelation)
    mockCorrRepo.upsert.mockResolvedValue({ row: {}, outcome: 'created' })
  })

  it('binds the projection to a local entity and reports the outcome', async () => {
    const app = buildApp()
    const res = await app.request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, localEntityType: 'shipment', localEntityId: 'ship-7' }),
    )
    expect(res.status).toBe(200)
    expect((await json(res))['correlation']).toEqual({ outcome: 'created' })
    expect(mockCorrRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        localEntityType: 'shipment',
        localEntityId: 'ship-7',
        entityKey: 'SO-1',
      }),
    )
  })

  it('writes no correlation when the caller supplies none', async () => {
    const app = buildApp()
    const res = await app.request(`${BASE}/SO-1`, put({ state: { a: 1 } }))
    expect(res.status).toBe(200)
    expect((await json(res))['correlation']).toBeUndefined()
    expect(mockCorrRepo.upsert).not.toHaveBeenCalled()
  })

  it('rejects a half-supplied binding rather than silently ignoring it', async () => {
    const app = buildApp()
    const res = await app.request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, localEntityType: 'shipment' }),
    )
    expect(res.status).toBe(400)
    // The projection must not be written either — the caller gets to retry whole.
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })

  it("rejects a localEntityType the floor doesn't declare", async () => {
    const app = buildApp()
    const res = await app.request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, localEntityType: 'vehicle', localEntityId: 'v-1' }),
    )
    expect(res.status).toBe(200)
    const body = (await json(res))['correlation'] as JsonBody
    expect(body['outcome']).toBe('rejected')
    expect(mockCorrRepo.upsert).not.toHaveBeenCalled()
  })

  it('reports unsupported when the integration declares no correlation', async () => {
    mockResolveDefinition.mockResolvedValue({})
    const app = buildApp()
    const res = await app.request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, localEntityType: 'shipment', localEntityId: 'ship-7' }),
    )
    expect(res.status).toBe(200)
    expect(((await json(res))['correlation'] as JsonBody)['outcome']).toBe('unsupported')
  })

  it('still persists the projection when the key is already bound elsewhere', async () => {
    mockCorrRepo.upsert.mockResolvedValue({ row: null, outcome: 'conflict' })
    const app = buildApp()
    const res = await app.request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, localEntityType: 'shipment', localEntityId: 'ship-9' }),
    )
    // The cached state is the durable artifact; the binding is an index into it.
    expect(res.status).toBe(200)
    expect(mockRepo.upsert).toHaveBeenCalled()
    expect(((await json(res))['correlation'] as JsonBody)['outcome']).toBe('conflict')
  })
})

describe('GET .../by-local/:localEntityType/:localEntityId', () => {
  const LOCAL = `${BASE}/by-local/shipment/ship-7`

  it('resolves our id to their key and returns the cached state', async () => {
    mockCorrRepo.findByLocal.mockResolvedValue({
      localEntityType: 'shipment',
      localEntityId: 'ship-7',
      entityKey: 'SO-1',
      updatedAt: now,
    })
    mockRepo.findByKey.mockResolvedValue(projectionRow())

    const app = buildApp()
    const res = await app.request(LOCAL)
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['entityKey']).toBe('SO-1')
    expect((data['projection'] as JsonBody)['state']).toEqual({ serviceOrderNumber: 'SO-1' })
  })

  it('returns the key with a null projection when the cache entry is gone', async () => {
    mockCorrRepo.findByLocal.mockResolvedValue({
      localEntityType: 'shipment',
      localEntityId: 'ship-7',
      entityKey: 'SO-1',
      updatedAt: now,
    })
    mockRepo.findByKey.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request(LOCAL)
    // A binding outliving its cache entry is normal — the caller should fetch,
    // not conclude the entity is unknown.
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data['entityKey']).toBe('SO-1')
    expect(data['projection']).toBeNull()
  })

  it('404s when the entity has no binding', async () => {
    mockCorrRepo.findByLocal.mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request(LOCAL)
    expect(res.status).toBe(404)
    expect(mockRepo.findByKey).not.toHaveBeenCalled()
  })

  it('403s for a persona without ReadIntegrationProjection', async () => {
    const app = buildApp(['workflow_developer'])
    const res = await app.request(LOCAL)
    expect(res.status).toBe(403)
    expect(mockCorrRepo.findByLocal).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// fetchedAt — provenance, distinct from updatedAt (C4). The question each
// answers is different: `updatedAt` is when WE wrote, `fetchedAt` is when it was
// true at the partner. These pin that the two never substitute for each other.
// ---------------------------------------------------------------------------

describe('fetchedAt provenance', () => {
  const AT = '2026-11-12T09:30:00.000Z'

  it('stores a supplied fetchedAt as a Date', async () => {
    mockRepo.upsert.mockResolvedValue({ row: projectionRow(), created: true })
    const res = await buildApp().request(`${BASE}/SO-1`, put({ state: { a: 1 }, fetchedAt: AT }))
    expect(res.status).toBe(201)
    expect(mockRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ fetchedAt: new Date(AT) }),
    )
  })

  it('CLEARS fetchedAt when a write omits it — state is replaced wholesale', async () => {
    // The trap: inheriting the previous timestamp would claim provenance for
    // bytes it never described.
    mockRepo.upsert.mockResolvedValue({ row: projectionRow(), created: false })
    await buildApp().request(`${BASE}/SO-1`, put({ state: { a: 2 } }))
    expect(mockRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({ fetchedAt: null }))
  })

  it('reports fetchedAt on the write response', async () => {
    mockRepo.upsert.mockResolvedValue({
      row: projectionRow({ fetchedAt: new Date(AT) }),
      created: false,
    })
    const res = await buildApp().request(`${BASE}/SO-1`, put({ state: { a: 1 }, fetchedAt: AT }))
    expect((await json(res))['data']).toMatchObject({ fetchedAt: AT })
  })

  it('reports fetchedAt as null — never absent — when provenance is unknown', async () => {
    // A reader has to be able to tell "we do not know" from "it is old". An
    // absent key would make those two indistinguishable.
    mockRepo.findByKey.mockResolvedValue(projectionRow({ fetchedAt: null }))
    const res = await buildApp().request(`${BASE}/SO-1`)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toHaveProperty('fetchedAt')
    expect(data['fetchedAt']).toBeNull()
  })

  it('never substitutes updatedAt for an unknown fetchedAt', async () => {
    mockRepo.findByKey.mockResolvedValue(projectionRow({ fetchedAt: null }))
    const res = await buildApp().request(`${BASE}/SO-1`)
    const data = (await json(res))['data'] as JsonBody
    expect(data['updatedAt']).toBe(now.toISOString())
    expect(data['fetchedAt']).not.toBe(data['updatedAt'])
  })

  it('reports a fetchedAt OLDER than updatedAt without complaint', async () => {
    // The normal case for a replayed/backfilled read, and the whole reason the
    // two columns exist separately.
    const older = new Date('2026-01-01T00:00:00.000Z')
    mockRepo.findByKey.mockResolvedValue(projectionRow({ fetchedAt: older }))
    const res = await buildApp().request(`${BASE}/SO-1`)
    const data = (await json(res))['data'] as JsonBody
    expect(data['fetchedAt']).toBe(older.toISOString())
    expect(Date.parse(data['updatedAt'] as string)).toBeGreaterThan(older.getTime())
  })

  it('400s on a fetchedAt that is not an ISO datetime', async () => {
    const res = await buildApp().request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, fetchedAt: 'last tuesday' }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.upsert).not.toHaveBeenCalled()
  })

  it('400s on a date without a time — provenance is an instant, not a day', async () => {
    const res = await buildApp().request(
      `${BASE}/SO-1`,
      put({ state: { a: 1 }, fetchedAt: '2026-11-12' }),
    )
    expect(res.status).toBe(400)
  })

  it('round-trips the asOf a fetch_external response hands back', async () => {
    // The intended wiring: fetch_external returns `asOf`, the workflow passes it
    // straight to put_projection, and provenance survives the hop.
    const asOf = new Date().toISOString()
    mockRepo.upsert.mockResolvedValue({
      row: projectionRow({ fetchedAt: new Date(asOf) }),
      created: true,
    })
    const res = await buildApp().request(`${BASE}/SO-1`, put({ state: { a: 1 }, fetchedAt: asOf }))
    expect((await json(res))['data']).toMatchObject({ fetchedAt: asOf })
  })
})
