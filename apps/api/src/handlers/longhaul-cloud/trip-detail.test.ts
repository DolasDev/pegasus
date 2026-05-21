// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul `GET /trips/:id` handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. The handler issues at most TWO executor
// round trips (trip bundle, then shipment bundle) — these tests assert the
// call count alongside the response shape.
//
// Regression coverage (Phase 3.1): the handler now reads `recordsets[i]`
// (per-statement) from the executor instead of partitioning a flattened
// `recordset` by marker columns. The original implementation relied on
// `recordset` alone, which mssql populates with only the FIRST statement's
// rows — so activities, notes, coverage, and extra-locations were silently
// dropped. The "returns the trip ... with embedded activities, notes,
// shipments" test below is the contract that would have caught that bug.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'

vi.mock('../../db', () => ({
  db: { tenant: { findUnique: vi.fn() } },
}))
vi.mock('../../lib/mssql-executor-client', () => ({
  executeSql: vi.fn(),
}))

import { longhaulTripDetailHandler } from './trip-detail'
import { db } from '../../db'
import { executeSql } from '../../lib/mssql-executor-client'

const findUnique = db.tenant.findUnique as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.get('/onprem/longhaul/trips/:id', longhaulTripDetailHandler)
  return app
}

const tripRow = {
  id: 42,
  TripStatus_id: 1,
  trip_title: 'Trip 42',
  status_status: 'Pending',
  driver_name: 'Jane Doe',
}
const activityRow = { id: 9, TripMaster_id: 42, order_num: 1001, ActivityType_code: 'LOAD' }
const noteRow = { id: 7, tripId: 42, note: 'be careful' }

describe('GET longhaul/trips/:id (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the trip in { data } shape with embedded activities, notes, shipments', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    // RT1: 3-statement batch → recordsets[0]=trip, [1]=activities, [2]=notes.
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [],
    })
    // RT2: 4-statement batch → recordsets[0..3] = shipments / activities /
    // coverage / extra-locations.
    const shipmentRow = { order_num: 1001, shipper_name: 'Acme' }
    const shipActivityThisTrip = { id: 9, TripMaster_id: 42, order_num: 1001 }
    const shipActivityOtherTrip = { id: 9, TripMaster_id: 99, order_num: 1001 }
    const coverageRow = { order_num: 1001, activity_code: 'LOAD', coverage_agent_id: 'X' }
    const extraLocationRow = { order_num: 1001, location_type: 'EXTRA_STOP' }
    executeSqlMock.mockResolvedValueOnce({
      recordset: [shipmentRow],
      recordsets: [
        [shipmentRow],
        [shipActivityThisTrip, shipActivityOtherTrip],
        [coverageRow],
        [extraLocationRow],
      ],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data.id).toBe(42)
    expect(body.data.trip_title).toBe('Trip 42')
    // Regression (Phase 3.1): activities + notes were silently dropped because
    // the executor's `recordset` only carries the first statement's rows. The
    // handler now reads each child set from `recordsets[i]`.
    expect(body.data.activities).toEqual([activityRow])
    expect(body.data.notes).toEqual([noteRow])

    const shipments = body.data.shipments as Array<Record<string, unknown>>
    expect(shipments).toHaveLength(1)
    expect(shipments[0]!['order_num']).toBe(1001)
    // Embedded shipment activities filtered to this trip only.
    expect(shipments[0]!['activities']).toHaveLength(1)
    expect(shipments[0]!['packing_coverage']).toMatchObject({ coverage_agent_id: 'X' })
    expect(shipments[0]!['extra_locations']).toHaveLength(1)

    // Exactly two round trips: trip bundle + shipment bundle.
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
  })

  it('skips the shipment round trip when the trip has no shipment-bearing activities', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [], [noteRow]],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data.activities).toEqual([])
    expect(body.data.notes).toEqual([noteRow])
    expect(body.data.shipments).toEqual([])
    // Only one round trip — no order_nums to fan out on.
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 404 NOT_FOUND when the trip does not exist', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [],
      recordsets: [[], [], []],
      rowsAffected: [],
    })

    const res = await buildApp().request('/onprem/longhaul/trips/999999999')

    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND')
    // No shipment round trip after a not-found.
    expect(executeSqlMock).toHaveBeenCalledTimes(1)
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 400 VALIDATION_ERROR for a non-numeric trip id', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })

    const res = await buildApp().request('/onprem/longhaul/trips/not-a-number')

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 INTERNAL_ERROR when the executor call fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValue(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
