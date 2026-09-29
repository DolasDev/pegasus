// ---------------------------------------------------------------------------
// Unit tests for the workflow-state handler.
//
// The repository is mocked so no DB is required (the claim / compare-and-set
// races are covered against Postgres in workflow-state.repository.test.ts).
// dualAuthMiddleware is stubbed to inject the AppEnv context; requirePermission
// is NOT mocked — real Cedar RBAC runs. Read/WriteWorkflowState are granted to
// workflow_runtime; workflow_developer holds neither, so it is the negative
// persona here.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { _clearAuthzCache } from '../lib/authz'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    find: vi.fn(),
    list: vi.fn(),
    claim: vi.fn(),
    compareAndSet: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('../repositories/workflow-state.repository', () => ({
  createWorkflowStateRepository: vi.fn(() => mockRepo),
}))

vi.mock('../middleware/dual-auth', () => ({
  dualAuthMiddleware: vi.fn(async (_c, next) => {
    await next()
  }),
}))

import { workflowStateHandler } from './workflow-state'
import { dualAuthMiddleware } from '../middleware/dual-auth'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function buildApp(roleNames: readonly string[] = ['workflow_runtime']) {
  const fakeDb = {} as unknown as PrismaClient
  const tenantId = 'test-tenant-id'
  vi.mocked(dualAuthMiddleware).mockImplementation(async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub: 'test-sub', tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    c.set('db', fakeDb)
    c.set('userId', 'svc-user-1')
    await next()
  })
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.route('/workflow-state', workflowStateHandler)
  return app
}

const now = new Date('2026-09-29T12:00:00Z')
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ws-1',
    tenantId: 'test-tenant-id',
    namespace: 'nw_pulse',
    key: 'pulse:490317:pack',
    state: { status: 'pending' },
    version: 1,
    updatedByUserId: 'svc-user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const BASE = '/workflow-state/nw_pulse'
const KEY_URL = `${BASE}/pulse:490317:pack`

beforeEach(() => {
  vi.clearAllMocks()
  _clearAuthzCache()
})

describe('GET /:namespace/:key', () => {
  it('returns the row for workflow_runtime', async () => {
    mockRepo.find.mockResolvedValue(row())
    const res = await buildApp().request(KEY_URL)
    expect(res.status).toBe(200)
    const data = (await json(res))['data'] as JsonBody
    expect(data).toMatchObject({ namespace: 'nw_pulse', key: 'pulse:490317:pack', version: 1 })
    expect(data).not.toHaveProperty('tenantId')
    expect(mockRepo.find).toHaveBeenCalledWith('nw_pulse', 'pulse:490317:pack')
  })

  it('returns 404 on a miss', async () => {
    mockRepo.find.mockResolvedValue(null)
    const res = await buildApp().request(KEY_URL)
    expect(res.status).toBe(404)
    expect((await json(res))['code']).toBe('NOT_FOUND')
  })

  it('rejects a key outside the segment alphabet', async () => {
    const res = await buildApp().request(`${BASE}/bad%20key`)
    expect(res.status).toBe(400)
  })

  it('denies a persona without ReadWorkflowState', async () => {
    const res = await buildApp(['workflow_developer']).request(KEY_URL)
    expect(res.status).toBe(403)
    expect(mockRepo.find).not.toHaveBeenCalled()
  })
})

describe('GET /:namespace (list)', () => {
  it('passes prefix/cursor/limit through and returns nextCursor on a full page', async () => {
    mockRepo.list.mockResolvedValue([row({ key: 'pulse:1:pack' }), row({ key: 'pulse:2:pack' })])
    const res = await buildApp().request(`${BASE}?prefix=pulse:&limit=2&cursor=pulse:0:pack`)
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['nextCursor']).toBe('pulse:2:pack')
    expect(mockRepo.list).toHaveBeenCalledWith('nw_pulse', {
      limit: 2,
      prefix: 'pulse:',
      cursor: 'pulse:0:pack',
    })
  })

  it('returns a null nextCursor on a short page and defaults the limit', async () => {
    mockRepo.list.mockResolvedValue([row()])
    const res = await buildApp().request(BASE)
    expect((await json(res))['nextCursor']).toBeNull()
    expect(mockRepo.list).toHaveBeenCalledWith('nw_pulse', { limit: 100 })
  })

  it('rejects a limit above the cap', async () => {
    const res = await buildApp().request(`${BASE}?limit=501`)
    expect(res.status).toBe(400)
  })
})

describe('PUT /:namespace/:key', () => {
  it('claims with ifAbsent → 201', async () => {
    mockRepo.claim.mockResolvedValue({ outcome: 'created', row: row() })
    const res = await buildApp().request(
      KEY_URL,
      put({ state: { status: 'pending' }, ifAbsent: true }),
    )
    expect(res.status).toBe(201)
    expect((await json(res))['created']).toBe(true)
    expect(mockRepo.claim).toHaveBeenCalledWith({
      tenantId: 'test-tenant-id',
      namespace: 'nw_pulse',
      key: 'pulse:490317:pack',
      state: { status: 'pending' },
      updatedByUserId: 'svc-user-1',
    })
  })

  it('returns 409 STATE_EXISTS with the existing row when the claim loses', async () => {
    mockRepo.claim.mockResolvedValue({
      outcome: 'exists',
      current: row({ state: { status: 'sent' } }),
    })
    const res = await buildApp().request(KEY_URL, put({ state: {}, ifAbsent: true }))
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body['code']).toBe('STATE_EXISTS')
    expect((body['data'] as JsonBody)['current']).toMatchObject({ state: { status: 'sent' } })
  })

  it('compare-and-sets with expectedVersion → 200', async () => {
    mockRepo.compareAndSet.mockResolvedValue({ outcome: 'updated', row: row({ version: 2 }) })
    const res = await buildApp().request(
      KEY_URL,
      put({ state: { status: 'sent' }, expectedVersion: 1 }),
    )
    expect(res.status).toBe(200)
    expect(((await json(res))['data'] as JsonBody)['version']).toBe(2)
    expect(mockRepo.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 1 }),
    )
  })

  it('returns 409 STATE_VERSION_CONFLICT on a stale version, current may be null', async () => {
    mockRepo.compareAndSet.mockResolvedValue({ outcome: 'conflict', current: null })
    const res = await buildApp().request(KEY_URL, put({ state: {}, expectedVersion: 3 }))
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body['code']).toBe('STATE_VERSION_CONFLICT')
    expect(body['data']).toEqual({ current: null })
  })

  it('upserts unconditionally: 201 on create, 200 on overwrite', async () => {
    mockRepo.put.mockResolvedValueOnce({ row: row(), created: true })
    expect((await buildApp().request(KEY_URL, put({ state: {} }))).status).toBe(201)
    mockRepo.put.mockResolvedValueOnce({ row: row({ version: 2 }), created: false })
    expect((await buildApp().request(KEY_URL, put({ state: {} }))).status).toBe(200)
  })

  it('rejects ifAbsent together with expectedVersion', async () => {
    const res = await buildApp().request(
      KEY_URL,
      put({ state: {}, ifAbsent: true, expectedVersion: 1 }),
    )
    expect(res.status).toBe(400)
    expect(mockRepo.claim).not.toHaveBeenCalled()
    expect(mockRepo.compareAndSet).not.toHaveBeenCalled()
  })

  it('rejects a missing state, unknown fields, and oversize state', async () => {
    expect((await buildApp().request(KEY_URL, put({}))).status).toBe(400)
    expect((await buildApp().request(KEY_URL, put({ state: {}, extra: 1 }))).status).toBe(400)
    const big = { blob: 'x'.repeat(256 * 1024 + 1) }
    expect((await buildApp().request(KEY_URL, put({ state: big }))).status).toBe(413)
    expect(mockRepo.put).not.toHaveBeenCalled()
  })

  it('denies a persona without WriteWorkflowState', async () => {
    const res = await buildApp(['workflow_developer']).request(KEY_URL, put({ state: {} }))
    expect(res.status).toBe(403)
    expect(mockRepo.put).not.toHaveBeenCalled()
  })
})

describe('DELETE /:namespace/:key', () => {
  it('returns 204 on delete and passes expectedVersion through', async () => {
    mockRepo.remove.mockResolvedValue({ outcome: 'deleted' })
    const res = await buildApp().request(`${KEY_URL}?expectedVersion=2`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockRepo.remove).toHaveBeenCalledWith('nw_pulse', 'pulse:490317:pack', 2)
  })

  it('returns 404 when absent and 409 on a stale version', async () => {
    mockRepo.remove.mockResolvedValueOnce({ outcome: 'not_found' })
    expect((await buildApp().request(KEY_URL, { method: 'DELETE' })).status).toBe(404)
    mockRepo.remove.mockResolvedValueOnce({ outcome: 'conflict', current: row({ version: 5 }) })
    const res = await buildApp().request(`${KEY_URL}?expectedVersion=1`, { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect((await json(res))['code']).toBe('STATE_VERSION_CONFLICT')
  })
})
