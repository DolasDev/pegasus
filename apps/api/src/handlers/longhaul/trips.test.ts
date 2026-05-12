// ---------------------------------------------------------------------------
// Unit tests for the longhaul trips handler
// All DB calls are mocked. No MSSQL connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { Knex } from 'knex'
import type { PrismaClient } from '@prisma/client'

// `db.transaction(cb)` just runs the callback with the same mock instance —
// the repository functions are all mocked so the transactional guarantees
// don't matter here; what we want to verify is that the handler invokes
// `transaction` (we can spy on it) and that any throw aborts the work.
type TxFn = (cb: (trx: Knex) => Promise<unknown>) => Promise<unknown>
const transactionMock = vi.fn<TxFn>(async (cb) => cb(mockDb))
const mockDb = { transaction: transactionMock } as unknown as Knex

vi.mock('../../repositories/longhaul/trips.repository', () => ({
  findTripsWithQuery: vi.fn(),
  findTripById: vi.fn(),
  saveTrip: vi.fn(),
  updateTripStatus: vi.fn(),
  cancelTrip: vi.fn(),
  updateTripSummary: vi.fn(),
  getTripStatuses: vi.fn(),
  getTripStatusById: vi.fn(),
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
  getTripStatusById,
  createNote,
  patchNote,
  updateTripSummary,
} from '../../repositories/longhaul/trips.repository'
import {
  findActivitiesByTripId,
  insertActivity,
  updateActivitiesStatus,
  cancelTripActivities,
} from '../../repositories/longhaul/activities.repository'
import { findShipmentsByIds } from '../../repositories/longhaul/shipments.repository'
import { buildShipmentActivities } from '../../lib/longhaul-build-activities'
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

  it('returns 200 with updated trip and looks up TripStatus name', async () => {
    const updatedTrip = {
      id: 1,
      TripStatus_id: 2,
      driver_id: 5,
      activities: [],
    }
    vi.mocked(findTripById)
      // first call inside handler (load trip)
      .mockResolvedValueOnce({ id: 1, TripStatus_id: 1, driver_id: 5, activities: [] })
      // second call (re-fetch after update)
      .mockResolvedValueOnce(updatedTrip)
    vi.mocked(getTripStatusById).mockResolvedValue({ status_id: 2, status: 'Dispatched' })
    vi.mocked(updateTripStatus).mockResolvedValue(1)
    vi.mocked(updateActivitiesStatus).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request('/trips/1/status', patch({ statusId: 2 }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual(updatedTrip)
    // Status name from the lookup table should be passed to updateActivitiesStatus,
    // NOT the empty fallback or the client-supplied label.
    expect(updateActivitiesStatus).toHaveBeenCalledWith(
      expect.anything(),
      1,
      2,
      'Dispatched',
      MOCK_USER.code,
    )
  })

  it('falls back to client-supplied status name when lookup row missing', async () => {
    vi.mocked(findTripById)
      .mockResolvedValueOnce({ id: 1, TripStatus_id: 1, driver_id: 5, activities: [] })
      .mockResolvedValueOnce({ id: 1, TripStatus_id: 99, driver_id: 5, activities: [] })
    vi.mocked(getTripStatusById).mockResolvedValue(undefined)
    vi.mocked(updateTripStatus).mockResolvedValue(1)
    vi.mocked(updateActivitiesStatus).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips/1/status',
      patch({ statusId: 99, status: 'Client-Provided' }),
    )
    expect(res.status).toBe(200)
    expect(updateActivitiesStatus).toHaveBeenCalledWith(
      expect.anything(),
      1,
      99,
      'Client-Provided',
      MOCK_USER.code,
    )
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

// ---------------------------------------------------------------------------
// Transaction wrapping — POST /trips, PATCH /trips/:id/status, /cancel
// ---------------------------------------------------------------------------

describe('save/status/cancel run inside a db.transaction', () => {
  it('POST /trips wraps the save in db.transaction', async () => {
    transactionMock.mockClear()
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 5, TripStatus_id: 1 })
    vi.mocked(findActivitiesByTripId).mockResolvedValue([])
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    vi.mocked(updateTripSummary).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({ TripStatus_id: 1, shipments: [{ order_num: 100, activities: [] }] }),
    )
    expect(res.status).toBe(201)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('rolls back when an inner activity insert throws', async () => {
    transactionMock.mockClear()
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 5, TripStatus_id: 1 })
    vi.mocked(insertActivity).mockRejectedValueOnce(new Error('boom'))
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({
        TripStatus_id: 1,
        // Shipment has no activities + no dates, so buildShipmentActivities will
        // emit at least a delivery activity that triggers insertActivity.
        shipments: [{ order_num: 100, activities: [] }],
      }),
    )
    expect(res.status).toBe(500)
    // transaction() was invoked; the rejection from insertActivity propagates
    // out and the catch block converts it into a 500.
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('POST /trips/:id/cancel wraps activity-delete + trip-update in db.transaction', async () => {
    transactionMock.mockClear()
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
    expect(transactionMock).toHaveBeenCalledTimes(1)
    // cancelTrip repo sets internal_status='canceled' — verify it was called.
    expect(cancelTripRepo).toHaveBeenCalledWith(expect.anything(), 1, MOCK_USER.code)
  })
})

// ---------------------------------------------------------------------------
// buildShipmentActivities — auto-fills required activity templates
// ---------------------------------------------------------------------------

describe('POST /trips auto-creates missing required activities (buildShipmentActivities)', () => {
  beforeEach(() => {
    // Clear .mock.calls accumulated by earlier tests so per-test assertions
    // about insertActivity invocation count are accurate.
    vi.mocked(insertActivity).mockClear()
  })

  it('inserts a delivery activity when shipment has none', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 10, TripStatus_id: 1 })
    vi.mocked(findActivitiesByTripId).mockResolvedValue([])
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    vi.mocked(updateTripSummary).mockResolvedValue(1)
    vi.mocked(insertActivity).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({
        TripStatus_id: 1,
        shipments: [
          {
            order_num: 100,
            del_date2: '2026-05-01',
            consignee_city: 'Boston',
            activities: [],
          },
        ],
      }),
    )
    expect(res.status).toBe(201)
    // A delivery (RDEL) activity should have been inserted for the shipment.
    const inserted = vi.mocked(insertActivity).mock.calls.map(([, act]) => act)
    expect(inserted.some((a) => a['ActivityType_code'] === 'RDEL')).toBe(true)
  })

  it('inserts R19O instead of LOAD when rule19_id is set', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 11, TripStatus_id: 1 })
    vi.mocked(findActivitiesByTripId).mockResolvedValue([])
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    vi.mocked(updateTripSummary).mockResolvedValue(1)
    vi.mocked(insertActivity).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({
        TripStatus_id: 1,
        shipments: [
          {
            order_num: 101,
            rule19_id: 7,
            load_date2: '2026-05-02',
            del_date2: '2026-05-04',
            activities: [],
          },
        ],
      }),
    )
    expect(res.status).toBe(201)
    const inserted = vi.mocked(insertActivity).mock.calls.map(([, act]) => act)
    const codes = inserted.map((a) => a['ActivityType_code'])
    expect(codes).toContain('R19O')
    expect(codes).not.toContain('LOAD')
    expect(codes).toContain('RDEL')
  })

  it('skips a required activity that the shipment already contains', async () => {
    vi.mocked(findTripById).mockResolvedValue(null)
    vi.mocked(saveTrip).mockResolvedValue({ id: 12, TripStatus_id: 1 })
    vi.mocked(findActivitiesByTripId).mockResolvedValue([])
    vi.mocked(findShipmentsByIds).mockResolvedValue([])
    vi.mocked(updateTripSummary).mockResolvedValue(1)
    vi.mocked(insertActivity).mockResolvedValue(1)
    const app = buildApp()
    const res = await app.request(
      '/trips',
      post({
        TripStatus_id: 1,
        shipments: [
          {
            order_num: 102,
            del_date2: '2026-05-05',
            activities: [
              {
                order_num: 102,
                activityType: { code: 'RDEL' },
                planned_start: '2026-05-05',
              },
            ],
          },
        ],
      }),
    )
    expect(res.status).toBe(201)
    // The provided delivery activity should be inserted, but only once
    // (buildShipmentActivities sees the existing RDEL and skips auto-creating
    // a second one).
    const inserted = vi.mocked(insertActivity).mock.calls.map(([, act]) => act)
    const rdelCount = inserted.filter((a) => a['ActivityType_code'] === 'RDEL').length
    expect(rdelCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// buildShipmentActivities — pure unit tests
// ---------------------------------------------------------------------------

describe('buildShipmentActivities (unit)', () => {
  it('generates PACK, LOAD, RDEL when shipment has all dates and no rule19', () => {
    const activities = buildShipmentActivities({
      order_num: 1,
      pack_date2: '2026-05-01',
      load_date2: '2026-05-02',
      del_date2: '2026-05-04',
      activities: [],
    })
    const codes = activities.map((a) => a['ActivityType_code'])
    expect(codes).toEqual(['PACK', 'LOAD', 'RDEL'])
  })

  it('substitutes R19O for LOAD/PACK when rule19_id is set', () => {
    const activities = buildShipmentActivities({
      order_num: 2,
      pack_date2: '2026-05-01',
      load_date2: '2026-05-02',
      del_date2: '2026-05-04',
      rule19_id: 99,
      activities: [],
    })
    const codes = activities.map((a) => a['ActivityType_code'])
    expect(codes).toContain('R19O')
    expect(codes).not.toContain('LOAD')
    expect(codes).not.toContain('PACK')
    expect(codes).toContain('RDEL')
  })

  it('preserves untripped existing activities and skips duplicates', () => {
    const existing = {
      order_num: 3,
      activityType: { code: 'PACK' },
      TripMaster_id: null,
      planned_start: '2026-05-01',
    }
    const activities = buildShipmentActivities({
      order_num: 3,
      pack_date2: '2026-05-01',
      del_date2: '2026-05-04',
      activities: [existing],
    })
    // Existing activities use the nested `activityType.code` shape; auto-
    // generated ones use the flat `ActivityType_code` column. Normalise both
    // when counting so we exercise the same key buildShipmentActivities uses.
    const codes = activities.map(
      (a) =>
        (a['activityType'] as Record<string, unknown> | undefined)?.['code'] ??
        a['ActivityType_code'],
    )
    expect(codes.filter((c) => c === 'PACK').length).toBe(1)
    expect(codes).toContain('RDEL')
  })

  it('drops existing activities that are already on a trip', () => {
    const onAnotherTrip = {
      order_num: 4,
      activityType: { code: 'RDEL' },
      TripMaster_id: 42,
    }
    const activities = buildShipmentActivities({
      order_num: 4,
      del_date2: '2026-05-04',
      activities: [onAnotherTrip],
    })
    // The on-another-trip RDEL should be filtered out, and a fresh untripped
    // RDEL re-generated for this trip.
    expect(activities.length).toBe(1)
    expect(activities[0]?.['ActivityType_code']).toBe('RDEL')
    expect(activities[0]?.['TripMaster_id']).toBeNull()
  })
})
