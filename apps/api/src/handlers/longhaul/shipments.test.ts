// ---------------------------------------------------------------------------
// Unit tests for the longhaul shipments handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { PrismaClient } from '@prisma/client'

const mockDb = {}
vi.mock('../../lib/longhaul-db', () => ({
  getLonghaulDb: vi.fn(() => mockDb),
  longhaulDbConfigured: vi.fn(() => true),
}))

vi.mock('../../repositories/longhaul/shipments.repository', () => ({
  findShipmentsWithQuery: vi.fn(),
  findShipmentsByIds: vi.fn(),
  saveCoverage: vi.fn(),
  patchWeight: vi.fn(),
  patchShipmentShadow: vi.fn(),
}))

import {
  findShipmentsWithQuery,
  saveCoverage,
  patchWeight,
  patchShipmentShadow,
} from '../../repositories/longhaul/shipments.repository'
import { shipmentsRouter } from './shipments'

const MOCK_USER = {
  code: 42,
  first_name: 'Test',
  last_name: 'User',
  active: 'Y',
  win_username: 'testuser',
}

function buildApp() {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', MOCK_USER)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', shipmentsRouter)
  return app
}

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

// ---------------------------------------------------------------------------
// GET /shipments
// ---------------------------------------------------------------------------

describe('GET /shipments', () => {
  beforeEach(() => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([])
  })

  it('returns 200 with empty data list', async () => {
    const app = buildApp()
    const res = await app.request('/shipments')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual([])
  })

  it('returns 400 for invalid filters JSON', async () => {
    const app = buildApp()
    const res = await app.request('/shipments?filters=bad-json')
    expect(res.status).toBe(400)
  })

  it('passes filters to repository when valid', async () => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([{ order_num: 100 }])
    const app = buildApp()
    const filters = JSON.stringify({ filters: { Is_Trip_Planning: true } })
    const res = await app.request(`/shipments?filters=${encodeURIComponent(filters)}`)
    expect(res.status).toBe(200)
    expect(findShipmentsWithQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filters: expect.objectContaining({ Is_Trip_Planning: true }) }),
    )
  })
})

// ---------------------------------------------------------------------------
// POST /shipments/:id/coverage
// ---------------------------------------------------------------------------

describe('POST /shipments/:id/coverage', () => {
  it('returns 400 for invalid body', async () => {
    const app = buildApp()
    const res = await app.request('/shipments/100/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_num: 100 }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 201 on success', async () => {
    vi.mocked(saveCoverage).mockResolvedValue({ id: 1, order_num: 100 })
    const app = buildApp()
    const res = await app.request('/shipments/100/coverage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_num: 100,
        activity_code: 'PACK',
        coverage_agent_id: 'AGENT1',
        created_by_id: 42,
      }),
    })
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// PATCH /shipments/:id/weight
// ---------------------------------------------------------------------------

describe('PATCH /shipments/:id/weight', () => {
  it('returns 200 on success', async () => {
    vi.mocked(patchWeight).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/shipments/100/weight', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_num: 100, weight: 5000 }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 400 for non-numeric shipment id', async () => {
    const app = buildApp()
    const res = await app.request('/shipments/abc/weight', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 5000 }),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PATCH /shipments/:id/shadow
// ---------------------------------------------------------------------------

describe('PATCH /shipments/:id/shadow', () => {
  it('returns 200 on success', async () => {
    vi.mocked(patchShipmentShadow).mockResolvedValue(true)
    const app = buildApp()
    const res = await app.request('/shipments/100/shadow', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_num: 100, operations_id: 'OPS1' }),
    })
    expect(res.status).toBe(200)
  })
})
