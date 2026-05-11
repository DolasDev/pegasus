// ---------------------------------------------------------------------------
// Unit tests for the longhaul shipments handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { Knex } from 'knex'
import type { PrismaClient } from '@prisma/client'
import type * as EnrichModule from '../../lib/longhaul-shipment-enrich'

const mockDb = {} as unknown as Knex

vi.mock('../../repositories/longhaul/shipments.repository', () => ({
  findShipmentsWithQuery: vi.fn(),
  findShipmentsByIds: vi.fn(),
  saveCoverage: vi.fn(),
  patchWeight: vi.fn(),
  patchShipmentShadow: vi.fn(),
}))

vi.mock('../../lib/longhaul-shipment-enrich', async () => {
  const actual = await vi.importActual<typeof EnrichModule>('../../lib/longhaul-shipment-enrich')
  return {
    ...actual,
    loadActivityTypesMap: vi.fn().mockResolvedValue({}),
  }
})

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
    c.set('longhaulDb', mockDb)
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

  // ----- enrichment -----

  it('enriches shipments with trip info from their latest unfinished activity', async () => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([
      {
        order_num: 200,
        driver_name: 'fallback-driver',
        activities: [
          {
            id: 1,
            TripMaster_id: 77,
            trip_status_id: 3,
            actual_date: null,
            planned_start: '2026-05-10T09:00:00Z',
            driver_name: 'Alice',
            activityType_abbreviation: 'PK',
          },
          {
            id: 2,
            TripMaster_id: 77,
            trip_status_id: 3,
            actual_date: null,
            planned_start: '2026-05-12T09:00:00Z',
            driver_name: 'Alice',
            activityType_abbreviation: 'LD',
          },
        ],
      },
    ])
    const app = buildApp()
    const res = await app.request('/shipments')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data).toHaveLength(1)
    expect(data[0]!['driver_name']).toBe('Alice')
    expect(data[0]!['TripMaster_id']).toBe(77)
    expect(data[0]!['TripStatus_id']).toBe(3)
    expect(data[0]!['latest_activity_abbr']).toBe('PK')
    expect(new Date(data[0]!['latest_activity_date'] as string).toISOString()).toBe(
      '2026-05-10T09:00:00.000Z',
    )
  })

  it('falls back to shipment driver_name when no activity has a driver', async () => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([
      {
        order_num: 201,
        driver_name: 'fallback-driver',
        activities: [],
      },
    ])
    const app = buildApp()
    const res = await app.request('/shipments')
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data[0]!['driver_name']).toBe('fallback-driver')
    expect(data[0]!['TripMaster_id']).toBeNull()
  })

  it('attaches extraActivities templates derived from shipment dates', async () => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([
      {
        order_num: 202,
        pack_date2: '2026-05-01',
        load_date2: '2026-05-02',
        del_date2: '2026-05-03',
        shipper_add1: '1 A St',
        shipper_city: 'Origin',
        shipper_state: 'OR',
        shipper_zip: '00000',
        del_address1: '2 B St',
        consignee_city: 'Dest',
        consignee_state: 'DE',
        consignee_zip: '11111',
        activities: [],
        extra_locations: [],
      },
    ])
    const app = buildApp()
    const res = await app.request('/shipments')
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    const extras = data[0]!['extraActivities'] as Array<{ ActivityType_code: string }>
    const codes = extras.map((e) => e.ActivityType_code)
    // Required core extras (no existing activities → all suggested)
    expect(codes).toEqual(expect.arrayContaining(['PACK', 'LOAD', 'RDEL']))
  })

  // ----- post-fetch TripStatus_id filter -----

  it('filters shipments by TripStatus_id after enrichment', async () => {
    vi.mocked(findShipmentsWithQuery).mockResolvedValue([
      { order_num: 1, activities: [{ id: 1, trip_status_id: 1, planned_start: '2026-05-01' }] },
      { order_num: 2, activities: [{ id: 2, trip_status_id: 2, planned_start: '2026-05-01' }] },
      { order_num: 3, activities: [{ id: 3, trip_status_id: 3, planned_start: '2026-05-01' }] },
    ])
    const app = buildApp()
    const filters = JSON.stringify({
      filters: { TripStatus_id: [{ value: '2' }, { value: 3 }] },
    })
    const res = await app.request(`/shipments?filters=${encodeURIComponent(filters)}`)
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data.map((d) => d['order_num']).sort()).toEqual([2, 3])
  })

  // ----- 1000-result cap -----

  it('returns 400 RESULT_LIMIT_EXCEEDED when enriched count exceeds 1000', async () => {
    const big = Array.from({ length: 1001 }, (_, i) => ({ order_num: i, activities: [] }))
    vi.mocked(findShipmentsWithQuery).mockResolvedValue(big)
    const app = buildApp()
    const res = await app.request('/shipments')
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body['code']).toBe('RESULT_LIMIT_EXCEEDED')
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
