// ---------------------------------------------------------------------------
// Unit tests for the rejected-trip (archived trip) handlers.
//
// Prisma and the shared trip-fetch lib are mocked so the test never touches
// Postgres or the mssql-executor Lambda. Coverage:
//   - create: reads the live trip, persists a snapshot + per-driver rejection
//     rows, denormalizes the card columns, returns 201 { data: { id } }.
//   - create: 422 when the tenant has no MSSQL connection, 404 when the trip is
//     missing, 400 on an invalid body.
//   - list: filters by driverId via the link table, strips collections from the
//     card header, attaches rejection_drivers.
//   - get: returns the full snapshot + rejection.drivers; 404 when missing.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    archivedTrip: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('../../lib/longhaul-trip-fetch', () => ({
  fetchTripDetail: vi.fn(),
}))

import {
  createRejectedTripHandler,
  listRejectedTripsHandler,
  getRejectedTripHandler,
} from './rejected-trips'
import { db } from '../../db'
import { fetchTripDetail } from '../../lib/longhaul-trip-fetch'

const findUnique = db.tenant.findUnique as unknown as Mock
const createMock = db.archivedTrip.create as unknown as Mock
const findManyMock = db.archivedTrip.findMany as unknown as Mock
const findFirstMock = db.archivedTrip.findFirst as unknown as Mock
const fetchTripDetailMock = fetchTripDetail as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('userId', 'user-9')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.post('/onprem/longhaul/rejected-trips', createRejectedTripHandler)
  app.get('/onprem/longhaul/rejected-trips', listRejectedTripsHandler)
  app.get('/onprem/longhaul/rejected-trips/:id', getRejectedTripHandler)
  return app
}

const tripDetail = {
  id: 42,
  trip_title: 'Trip 42',
  driver_id: 7,
  driver_name: 'Jane Doe',
  planned_first_day: '2026-06-01T00:00:00.000Z',
  planned_last_day: '2026-06-05T00:00:00.000Z',
  origin_geo_code: 'TX',
  destination_geo_code: 'CA',
  total_estimated_lbs: 12000,
  total_estimated_linehaul_usd: 3400.5,
  status_status: 'Offered',
  status_id: 2,
  activities: [{ id: 9, TripMaster_id: 42, order_num: 1001 }],
  notes: [{ id: 7, tripId: 42, note: 'careful' }],
  shipments: [{ order_num: 1001, shipper_name: 'Acme' }],
}

describe('rejected-trip handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /rejected-trips', () => {
    it('snapshots the live trip and persists driver rejection rows', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      fetchTripDetailMock.mockResolvedValue(tripDetail)
      createMock.mockResolvedValue({ id: 'archived-1' })

      const res = await buildApp().request('/onprem/longhaul/rejected-trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tripId: 42,
          rejections: [
            { driverId: 7, driverName: 'Jane Doe', reason: 'too far' },
            { driverId: 8, driverName: 'Bob' },
          ],
        }),
      })

      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ data: { id: 'archived-1' } })

      expect(fetchTripDetailMock).toHaveBeenCalledWith('Server=a,1433', 42)
      const arg = createMock.mock.calls[0]![0] as { data: Record<string, unknown> }
      expect(arg.data).toMatchObject({
        tenantId: 'tenant-1',
        kind: 'rejected',
        originalTripId: 42,
        tripTitle: 'Trip 42',
        originalDriverId: 7,
        originalDriverName: 'Jane Doe',
        originStateCode: 'TX',
        destStateCode: 'CA',
        totalEstimatedLbs: 12000,
        totalEstimatedLinehaulUsd: '3400.5',
        createdById: 'user-9',
      })
      expect(arg.data.snapshot).toEqual(tripDetail)
      expect((arg.data.drivers as { create: unknown }).create).toEqual([
        { driverId: 7, driverName: 'Jane Doe', reason: 'too far' },
        { driverId: 8, driverName: 'Bob', reason: null },
      ])
    })

    it('returns 422 when the tenant has no MSSQL connection', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: null })
      const res = await buildApp().request('/onprem/longhaul/rejected-trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId: 42, rejections: [{ driverId: 7 }] }),
      })
      expect(res.status).toBe(422)
      expect(createMock).not.toHaveBeenCalled()
    })

    it('returns 404 when the live trip is missing', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      fetchTripDetailMock.mockResolvedValue(null)
      const res = await buildApp().request('/onprem/longhaul/rejected-trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId: 42, rejections: [{ driverId: 7 }] }),
      })
      expect(res.status).toBe(404)
      expect(createMock).not.toHaveBeenCalled()
    })

    it('returns 400 when rejections is empty', async () => {
      findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
      const res = await buildApp().request('/onprem/longhaul/rejected-trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tripId: 42, rejections: [] }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /rejected-trips', () => {
    it('filters by driverId and returns card-shaped rows without collections', async () => {
      findManyMock.mockResolvedValue([
        {
          id: 'archived-1',
          kind: 'rejected',
          createdAt: new Date('2026-06-10T00:00:00.000Z'),
          snapshot: { ...tripDetail },
          drivers: [{ driverId: 7, driverName: 'Jane Doe', reason: 'too far' }],
        },
      ])

      const res = await buildApp().request('/onprem/longhaul/rejected-trips?driverId=7')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        meta: { count: number }
        data: Array<Record<string, unknown>>
      }

      // The link-table filter is applied.
      expect(
        (findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where,
      ).toMatchObject({
        tenantId: 'tenant-1',
        kind: 'rejected',
        drivers: { some: { driverId: 7 } },
      })

      expect(body.meta.count).toBe(1)
      const card = body.data[0]!
      expect(card.id).toBe(42)
      expect(card.trip_title).toBe('Trip 42')
      expect(card.isRejected).toBe(true)
      expect(card.archivedTripId).toBe('archived-1')
      expect(card.rejection_drivers).toEqual([
        { driverId: 7, driverName: 'Jane Doe', reason: 'too far' },
      ])
      // Heavy collections are stripped from the list card.
      expect(card.activities).toBeUndefined()
      expect(card.shipments).toBeUndefined()
      expect(card.notes).toBeUndefined()
    })

    it('omits the driver filter when driverId is absent', async () => {
      findManyMock.mockResolvedValue([])
      await buildApp().request('/onprem/longhaul/rejected-trips')
      expect(
        (findManyMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where,
      ).not.toHaveProperty('drivers')
    })
  })

  describe('GET /rejected-trips/:id', () => {
    it('returns the full snapshot with rejection drivers', async () => {
      findFirstMock.mockResolvedValue({
        id: 'archived-1',
        kind: 'rejected',
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
        snapshot: { ...tripDetail },
        drivers: [{ driverId: 7, driverName: 'Jane Doe', reason: 'too far' }],
      })

      const res = await buildApp().request('/onprem/longhaul/rejected-trips/archived-1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: Record<string, unknown> }
      expect((findFirstMock.mock.calls[0]![0] as { where: Record<string, unknown> }).where).toEqual(
        {
          id: 'archived-1',
          tenantId: 'tenant-1',
        },
      )
      expect(body.data.id).toBe(42)
      expect(body.data.activities).toHaveLength(1)
      expect(body.data.isRejected).toBe(true)
      expect((body.data.rejection as { drivers: unknown }).drivers).toEqual([
        { driverId: 7, driverName: 'Jane Doe', reason: 'too far' },
      ])
    })

    it('returns 404 when not found', async () => {
      findFirstMock.mockResolvedValue(null)
      const res = await buildApp().request('/onprem/longhaul/rejected-trips/missing')
      expect(res.status).toBe(404)
    })
  })
})
