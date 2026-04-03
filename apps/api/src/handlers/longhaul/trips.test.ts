// ---------------------------------------------------------------------------
// Unit tests for the longhaul trips handler
// All DB calls are mocked. No MSSQL connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import type { ConnectionPool } from 'mssql'
import type { PrismaClient } from '@prisma/client'

const mockDb = {}
vi.mock('../../lib/longhaul-db', () => ({
  getLonghaulDb: vi.fn(() => mockDb),
  longhaulDbConfigured: vi.fn(() => true),
}))

vi.mock('../../repositories/longhaul/trips.repository', () => ({
  findTripsWithQuery: vi.fn(),
  findTripById: vi.fn(),
  saveTrip: vi.fn(),
  updateTripStatus: vi.fn(),
  cancelTrip: vi.fn(),
  updateTripSummary: vi.fn(),
  getTripStatuses: vi.fn(),
  createNote: vi.fn(),
  patchNote: vi.fn(),
}))

vi.mock('../../repositories/longhaul/activities.repository', () => ({
  findActivitiesByTripId: vi.fn(),
  saveActivity: vi.fn(),
  insertActivity: vi.fn(),
  removeActivities: vi.fn(),
  updateActivitiesStatus: vi.fn(),
  cancelTripActivities: vi.fn(),
}))

vi.mock('../../repositories/longhaul/shipments.repository', () => ({
  findShipmentsByIds: vi.fn(),
  patchShipmentShadow: vi.fn(),
}))

import {
  findTripsWithQuery,
  findTripById,
  saveTrip,
  updateTripStatus,
  cancelTrip as cancelTripRepo,
  getTripStatuses,
  createNote,
  patchNote,
  updateTripSummary,
} from '../../repositories/longhaul/trips.repository'
import {
  findActivitiesByTripId,
  updateActivitiesStatus,
  cancelTripActivities,
} from '../../repositories/longhaul/activities.repository'
import { findShipmentsByIds } from '../../repositories/longhaul/shipments.repository'
import { tripsRouter } from './trips'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function patch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

const MOCK_USER = {
  code: 42,
  first_name: 'Test',
  last_name: 'User',
  active: 'Y',
  win_username: 'testuser',
}

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', MOCK_USER)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', tripsRouter)
  return app
}

// ---------------------------------------------------------------------------
// GET /trips
// ---------------------------------------------------------------------------

describe('GET /trips', () => {
  beforeEach(() => {
    vi.mocked(findTripsWithQuery).mockResolvedValue([])
  })

  it('returns 200 with empty data when no trips found', async () => {
    const app = buildApp()
    const res = await app.request('/trips')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual([])
  })

  it('passes filters query param as parsed JSON to repository', async () => {
    vi.mocked(findTripsWithQuery).mockResolvedValue([{ id: 1, TripStatus_id: 1 }])
    const app = buildApp()
    const filters = JSON.stringify({ filters: { TripStatus_id: [{ value: '1' }] } })
    const res = await app.request(`/trips?filters=${encodeURIComponent(filters)}`)
    expect(res.status).toBe(200)
    expect(findTripsWithQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: expect.objectContaining({ TripStatus_id: expect.any(Array) }),
      }),
    )
  })

  it('returns 400 for malformed filters JSON', async () => {
    const app = buildApp()
    const res = await app.request('/trips?filters=not-valid-json')
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// GET /trips/:id
// ---------------------------------------------------------------------------

describe('GET /trips/:id', () => {
  it('returns 404 when trip not found', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/trips/999')
    expect(res.status).toBe(404)
  })

  it('returns 200 with trip data when found', async () => {
    vi.mocked(findTripById).mockResolvedValue({ id: 1, TripStatus_id: 1, activities: [] })
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    const app = buildApp()
    const res = await app.request('/trips/1')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body['data'] as Record<string, unknown>)?.['id']).toBe(1)
  })

  it('returns 400 for non-numeric id', async () => {
    const app = buildApp()
    const res = await app.request('/trips/abc')
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /trips
// ---------------------------------------------------------------------------

describe('POST /trips', () => {
  it('returns 403 when no shipments provided', async () => {
    const app = buildApp()
    const res = await app.request('/trips', post({ driver_id: 1, TripStatus_id: 1, shipments: [] }))
    expect(res.status).toBe(403)
  })

  it('returns 201 on success', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 5, TripStatus_id: 1 })
    vi.mocked(findActivitiesByTripId).mockResolvedValue([])
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    vi.mocked(updateTripSummary).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({
        TripStatus_id: 1,
        shipments: [{ order_num: 100, activities: [] }],
      }),
    )
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// PATCH /trips/:id/status
// ---------------------------------------------------------------------------

describe('PATCH /trips/:id/status', () => {
  it('returns 404 when trip not found', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/trips/99/status', patch({ statusId: 2 }))
    expect(res.status).toBe(404)
  })

  it('returns 200 on successful status update', async () => {
    vi.mocked(findTripById).mockResolvedValue({
      id: 1,
      TripStatus_id: 1,
      driver_id: 5,
      activities: [],
    })
    vi.mocked(updateTripStatus).mockResolvedValue(1)
    vi.mocked(updateActivitiesStatus).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/trips/1/status', patch({ statusId: 2, status: 'In Transit' }))
    expect(res.status).toBe(200)
  })

  it('rejects advancing past pending without a driver', async () => {
    vi.mocked(findTripById).mockResolvedValue({
      id: 1,
      TripStatus_id: 1,
      driver_id: null,
      activities: [],
    })
    const app = buildApp()
    const res = await app.request('/trips/1/status', patch({ statusId: 2 }))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// POST /trips/:id/cancel
// ---------------------------------------------------------------------------

describe('POST /trips/:id/cancel', () => {
  it('returns 404 when trip not found', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/trips/99/cancel', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 403 when trip is already in-progress (status >= 4)', async () => {
    vi.mocked(findTripById).mockResolvedValue({
      id: 1,
      TripStatus_id: 4,
      status_id: 4,
      driver_id: 1,
      activities: [],
    })
    const app = buildApp()
    const res = await app.request('/trips/1/cancel', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('returns 200 on successful cancel', async () => {
    vi.mocked(findTripById).mockResolvedValue({
      id: 1,
      TripStatus_id: 1,
      status_id: 1,
      driver_id: 1,
      activities: [],
    })
    vi.mocked(cancelTripActivities).mockResolvedValue(1)
    vi.mocked(cancelTripRepo).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/trips/1/cancel', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// GET /trip-statuses
// ---------------------------------------------------------------------------

describe('GET /trip-statuses', () => {
  it('returns 200 with trip statuses', async () => {
    vi.mocked(getTripStatuses).mockResolvedValue([{ id: 1, status: 'Pending' }])
    const app = buildApp()
    const res = await app.request('/trip-statuses')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(Array.isArray(body['data'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// POST /trips/:id/notes
// ---------------------------------------------------------------------------

describe('POST /trips/:id/notes', () => {
  it('returns 201 on successful note creation', async () => {
    vi.mocked(createNote).mockResolvedValue([1])
    const app = buildApp()
    const res = await app.request('/trips/1/notes', post({ note: 'Test note' }))
    expect(res.status).toBe(201)
  })

  it('returns 400 for empty note', async () => {
    const app = buildApp()
    const res = await app.request('/trips/1/notes', post({ note: '' }))
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PATCH /notes/:id
// ---------------------------------------------------------------------------

describe('PATCH /notes/:id', () => {
  it('returns 200 on successful note patch', async () => {
    vi.mocked(patchNote).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/notes/5', patch({ note: 'Updated note', tripId: 1 }))
    expect(res.status).toBe(200)
  })
})
