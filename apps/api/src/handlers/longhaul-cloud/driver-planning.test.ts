// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /driver-planning handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda.
//
// The handler does up to 3 round trips: (1) planning rows (drivers + latest
// trip), (2) RDEL deliveries for every trip in the planning set — skipped when
// no driver has a current trip, (3) DriverConfirmedAvailability overrides —
// soft-fails when the table is absent. Mocks below queue executeSql responses
// in that order.
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

import { longhaulDriverPlanningHandler } from './driver-planning'
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
  app.get('/onprem/longhaul/driver-planning', longhaulDriverPlanningHandler)
  return app
}

/** A planning row as the OUTER APPLY query returns it (already lowercase). */
function planningRow(overrides: Record<string, unknown> = {}) {
  return {
    driver_id: 1,
    driver_name: 'Alice Hauler',
    agent_code: 'AG1',
    trip_id: 10,
    trip_title: 'Trip Ten',
    planned_last_day: '2026-06-10',
    actual_last_day: null,
    destination_geo_name: 'Texas',
    ...overrides,
  }
}

/** A delivery row as the RDEL query returns it (already lowercase). */
function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    trip_id: 10,
    activity_id: 100,
    planned_start: '2026-06-08',
    planned_end: '2026-06-10',
    estimated_date: '2026-06-09',
    actual_date: null,
    is_committed: 0,
    is_confirmed: 0,
    city: 'Dallas',
    state: 'TX',
    ...overrides,
  }
}

describe('GET longhaul/driver-planning (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { data, meta } with a deliveries array and back-compat summary', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    // Round trip 1: planning. Round trip 2: RDEL deliveries. Round trip 3: confirmed.
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [
          deliveryRow({
            activity_id: 100,
            actual_date: '2026-06-15',
            city: 'Dallas',
            state: 'TX',
            is_confirmed: 1,
          }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; meta: unknown }

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
    expect(body.meta).toEqual({ count: 1 })

    // Planning query (round trip 1) filters to active, real drivers — kept in
    // lockstep with the /drivers planning dropdown.
    const planningSql = executeSqlMock.mock.calls[0]![1] as string
    expect(planningSql).toContain("d.ACTIVE = 'Y'")
    expect(planningSql).toContain('d.DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)')

    const row = body.data[0]!
    expect(row.driverId).toBe(1)
    expect(row.driverName).toBe('Alice Hauler')
    expect(row.currentTripId).toBe(10)
    // Last delivery actual_date wins for the back-compat summary.
    expect(row.estimatedAvailableDate).toBe('2026-06-15')
    expect(row.estimatedAvailableLocation).toBe('Dallas, TX')
    expect(row.deliveries).toEqual([
      {
        activityId: 100,
        plannedStart: '2026-06-08',
        plannedEnd: '2026-06-10',
        estimatedDate: '2026-06-09',
        actualDate: '2026-06-15',
        isCommitted: false,
        isConfirmed: true,
        city: 'Dallas',
        state: 'TX',
      },
    ])
  })

  it('falls back to trip fields when the driver has a trip but no deliveries', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [planningRow({ planned_last_day: '2026-07-01' })],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no RDELs
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no confirmed

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(body.data[0]!.estimatedAvailableDate).toBe('2026-07-01')
    // No activity city/state → trip destination_geo_name.
    expect(body.data[0]!.estimatedAvailableLocation).toBe('Texas')
    expect(body.data[0]!.deliveries).toEqual([])
  })

  it('skips the deliveries round trip entirely when no driver has a current trip', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [
          planningRow({
            trip_id: null,
            trip_title: null,
            planned_last_day: null,
            destination_geo_name: null,
          }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed (no deliveries query)

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    // Only 2 round trips when no trip ids — deliveries SELECT is skipped.
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    expect(body.data[0]!.currentTripId).toBeNull()
    expect(body.data[0]!.deliveries).toEqual([])
  })

  it('sorts deliveries by effective date (actual ?? estimated ?? planned_start)', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [
          deliveryRow({
            activity_id: 3,
            planned_start: '2026-06-20',
            planned_end: '2026-06-22',
            estimated_date: '2026-06-21',
            actual_date: null,
          }),
          deliveryRow({
            activity_id: 1,
            planned_start: '2026-06-05',
            planned_end: '2026-06-07',
            estimated_date: null,
            actual_date: '2026-06-06',
          }),
          deliveryRow({
            activity_id: 2,
            planned_start: '2026-06-12',
            planned_end: '2026-06-14',
            estimated_date: '2026-06-13',
            actual_date: null,
          }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{ deliveries: Array<{ activityId: number }> }>
    }

    expect(body.data[0]!.deliveries.map((d) => d.activityId)).toEqual([1, 2, 3])
  })

  it('groups deliveries by trip when multiple drivers are present', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [
          planningRow({ driver_id: 1, driver_name: 'Alice', trip_id: 10 }),
          planningRow({ driver_id: 2, driver_name: 'Bob', trip_id: 20 }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({
        recordset: [
          deliveryRow({ trip_id: 10, activity_id: 100 }),
          deliveryRow({ trip_id: 20, activity_id: 200 }),
          deliveryRow({ trip_id: 10, activity_id: 101, planned_start: '2026-06-09' }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{ driverId: number; deliveries: Array<{ activityId: number }> }>
    }

    const alice = body.data.find((d) => d.driverId === 1)!
    const bob = body.data.find((d) => d.driverId === 2)!
    expect(alice.deliveries.map((d) => d.activityId).sort()).toEqual([100, 101])
    expect(bob.deliveries.map((d) => d.activityId)).toEqual([200])
  })

  it('normalises MSSQL bit booleans (0/1/null) to boolean in deliveries', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({
        recordset: [
          deliveryRow({ activity_id: 1, is_committed: 1, is_confirmed: 0 }),
          deliveryRow({ activity_id: 2, is_committed: 0, is_confirmed: 1 }),
          deliveryRow({ activity_id: 3, is_committed: null, is_confirmed: null }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{
        deliveries: Array<{ activityId: number; isCommitted: boolean; isConfirmed: boolean }>
      }>
    }

    const deliveries = body.data[0]!.deliveries
    expect(deliveries.find((d) => d.activityId === 1)).toMatchObject({
      isCommitted: true,
      isConfirmed: false,
    })
    expect(deliveries.find((d) => d.activityId === 2)).toMatchObject({
      isCommitted: false,
      isConfirmed: true,
    })
    expect(deliveries.find((d) => d.activityId === 3)).toMatchObject({
      isCommitted: false,
      isConfirmed: false,
    })
  })

  it('applies confirmed-availability overrides from the third round trip', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no deliveries
      .mockResolvedValueOnce({
        recordset: [
          {
            driver_id: 1,
            confirmed_date: '2026-06-20',
            confirmed_location: 'Austin, TX',
            notes: 'driver confirmed',
          },
        ],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(body.data[0]!.confirmedAvailableDate).toBe('2026-06-20')
    expect(body.data[0]!.confirmedAvailableLocation).toBe('Austin, TX')
    expect(body.data[0]!.confirmedNotes).toBe('driver confirmed')
  })

  it('soft-fails when the DriverConfirmedAvailability table is missing', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no deliveries
      .mockRejectedValueOnce(
        new Error("QUERY_FAILED: Invalid object name 'DriverConfirmedAvailability'"),
      )

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; meta: unknown }

    // Missing confirmed table is not fatal — rows still return, overrides null.
    expect(res.status).toBe(200)
    expect(body.meta).toEqual({ count: 1 })
    expect(body.data[0]!.confirmedAvailableDate).toBeNull()
    expect(body.data[0]!.confirmedNotes).toBeNull()
  })

  it('returns 422 MSSQL_NOT_CONFIGURED when the tenant has no connection string', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: null })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')

    expect(res.status).toBe(422)
    expect(((await res.json()) as { code: string }).code).toBe('MSSQL_NOT_CONFIGURED')
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the planning query fails', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockRejectedValueOnce(new Error('executor down'))

    const res = await buildApp().request('/onprem/longhaul/driver-planning')

    expect(res.status).toBe(500)
    expect(((await res.json()) as { code: string }).code).toBe('INTERNAL_ERROR')
  })
})
