// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /driver-planning handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda.
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
    act_actual_date: null,
    act_estimated_date: null,
    act_planned_end: null,
    act_city: null,
    act_state: null,
    ...overrides,
  }
}

describe('GET longhaul/driver-planning (cloud-direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { data, meta } and derives estimated availability from the last activity', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    // Round trip 1: planning rows. Round trip 2: confirmed availability.
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [
          planningRow({
            act_actual_date: '2026-06-15',
            act_city: 'Dallas',
            act_state: 'TX',
          }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: [
        {
          driverId: 1,
          driverName: 'Alice Hauler',
          agentCode: 'AG1',
          currentTripId: 10,
          currentTripTitle: 'Trip Ten',
          // last activity actual_date wins over trip planned_last_day
          estimatedAvailableDate: '2026-06-15',
          // city + state combine
          estimatedAvailableLocation: 'Dallas, TX',
          confirmedAvailableDate: null,
          confirmedAvailableLocation: null,
          confirmedNotes: null,
        },
      ],
      meta: { count: 1 },
    })
    // Target: 2 round trips (planning + confirmed).
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to trip fields when there is no last activity', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [planningRow({ planned_last_day: '2026-07-01' })],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    expect(body.data[0]!.estimatedAvailableDate).toBe('2026-07-01')
    // No activity city/state → trip destination_geo_name.
    expect(body.data[0]!.estimatedAvailableLocation).toBe('Texas')
  })

  it('applies confirmed-availability overrides from the second round trip', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
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
