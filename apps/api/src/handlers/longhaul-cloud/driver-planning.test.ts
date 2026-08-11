// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul /driver-planning handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda.
//
// The handler does up to 3 round trips: (1) planning rows (drivers + latest
// trip), (2) a 2-statement batch returning RDEL deliveries [recordset 0] +
// one-row-per-shipment final activities [recordset 1] for every trip in the
// planning set — skipped when no driver has a current trip, (3)
// DriverConfirmedAvailability overrides — soft-fails when the table is absent.
// Mocks below queue executeSql responses in that order, with `recordsets:
// [deliveries, shipments]` on the batch call.
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
    is_local_drv: 'Y',
    is_long_dist_drv: 'Y',
    is_shorthaul_driver: 'Y',
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

/** A shipment row (final-activity-per-shipment) as the batch returns it. */
function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    trip_id: 10,
    order_num: 5000,
    activity_id: 200,
    planned_start: '2026-06-08',
    planned_end: '2026-06-12',
    estimated_date: '2026-06-11',
    actual_date: null,
    is_committed: 0,
    is_confirmed: 0,
    city: 'Houston',
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
    // Round trip 1: planning. Round trip 2: RDEL deliveries. Round trip 3:
    // schema-ensure (no rows read). Round trip 4: confirmed SELECT.
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
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>>; meta: unknown }

    expect(res.status).toBe(200)
    expect(executeSqlMock).toHaveBeenCalledTimes(4)
    expect(body.meta).toEqual({ count: 1 })

    // Planning query (round trip 1) filters to active drivers AND excludes the
    // 99994-99999 placeholder range. That exclusion is Availability-only — the
    // /drivers typeahead deliberately keeps those rows (see ./driver-filter).
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

  // Ready Date / State / City are read off whichever trip the planning query
  // picks, so an Unplanned/Pending/Offered trip must not be picked at all — the
  // driver hasn't committed to it. MasterTripStatus.status_id is ordered
  // (0 Unplanned … 3 Accepted, 4 In-Progress, 5 Completed), so the predicate is
  // `>= 3`, on top of (not instead of) the internal_status cancellation check.
  it('picks the latest trip at Accepted or greater, still excluding cancelled', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // deliveries
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

    await buildApp().request('/onprem/longhaul/driver-planning')

    const planningSql = executeSqlMock.mock.calls[0]![1] as string
    // NULL TripStatus_id (never planned) coerces to 0 → excluded.
    expect(planningSql).toContain('ISNULL(tm.TripStatus_id, 0) >= 3')
    expect(planningSql).toContain("ISNULL(tm.internal_status, '') <> 'canceled'")
  })

  it('returns one row per shipment from the batch recordset[1], with orderNum', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({
        // Batch returns deliveries [0] + shipments [1]. The handler uses
        // recordsets directly when present, falling back to `recordset` for
        // legacy single-statement responses.
        recordset: [],
        recordsets: [
          [],
          [
            shipmentRow({ order_num: 5001, actual_date: '2026-06-20', city: 'El Paso' }),
            shipmentRow({ order_num: 5002, estimated_date: '2026-06-25', city: 'Houston' }),
          ],
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

    // The handler builds a batch with TWO statements separated by `;` and a
    // ROW_NUMBER() OVER PARTITION BY ... ORDER BY effective-date DESC selection
    // for one-row-per-shipment. Assert both shape signals are present in the
    // generated SQL.
    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{ shipments: Array<Record<string, unknown>> }>
    }

    const batchSql = executeSqlMock.mock.calls[1]![1] as string
    expect(batchSql).toContain('ROW_NUMBER() OVER')
    expect(batchSql).toContain('PARTITION BY la.TripMaster_id, la.order_num')

    expect(res.status).toBe(200)
    const shipments = body.data[0]!.shipments
    expect(shipments).toHaveLength(2)
    // Sorted by effective date asc (sortDeliveries) — El Paso 06/20 before Houston 06/25.
    expect(shipments[0]).toMatchObject({ orderNum: 5001, city: 'El Paso' })
    expect(shipments[1]).toMatchObject({ orderNum: 5002, city: 'Houston' })
  })

  it('falls back to trip fields when the driver has a trip but no deliveries', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [planningRow({ planned_last_day: '2026-07-01' })],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no RDELs
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
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
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed (no deliveries query)

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(res.status).toBe(200)
    // 3 round trips when no trip ids — deliveries SELECT is skipped, but
    // ensure-schema and confirmed SELECT still run.
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
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
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

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
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{ driverId: number; deliveries: Array<{ activityId: number }> }>
    }

    const alice = body.data.find((d) => d.driverId === 1)!
    const bob = body.data.find((d) => d.driverId === 2)!
    expect(alice.deliveries.map((d) => d.activityId).sort()).toEqual([100, 101])
    expect(bob.deliveries.map((d) => d.activityId)).toEqual([200])
  })

  it('normalizes MSSQL bit booleans (0/1/null) to boolean in deliveries', async () => {
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
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

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

  it('selects and maps the Y/N move-type flags to booleans', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [
          // 'Y' -> true, 'N' -> false.
          planningRow({
            driver_id: 1,
            is_local_drv: 'Y',
            is_long_dist_drv: 'N',
            is_shorthaul_driver: 'N',
          }),
          // Lowercase 'y' still true; NULL treated as false. No trip so the
          // deliveries round trip is still driven by driver 1's trip_id.
          planningRow({
            driver_id: 2,
            trip_id: null,
            is_local_drv: null,
            is_long_dist_drv: 'y',
            is_shorthaul_driver: 'y',
          }),
          // NULL shorthaul flag -> false, same as the other two flags.
          planningRow({ driver_id: 3, trip_id: null, is_shorthaul_driver: null }),
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // deliveries (driver 1 has a trip)
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // confirmed

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as {
      data: Array<{
        driverId: number
        isLocal: boolean
        isLongDistance: boolean
        isShorthaul: boolean
      }>
    }

    // The flags are pulled straight off v_longhaul_drivers in the planning SQL.
    const planningSql = executeSqlMock.mock.calls[0]![1] as string
    expect(planningSql).toContain('d.is_local_drv')
    expect(planningSql).toContain('d.is_long_dist_drv')
    expect(planningSql).toContain('d.is_shorthaul_driver')

    const d1 = body.data.find((d) => d.driverId === 1)!
    expect(d1).toMatchObject({ isLocal: true, isLongDistance: false, isShorthaul: false })
    const d2 = body.data.find((d) => d.driverId === 2)!
    expect(d2).toMatchObject({ isLocal: false, isLongDistance: true, isShorthaul: true })
    const d3 = body.data.find((d) => d.driverId === 3)!
    expect(d3).toMatchObject({ isShorthaul: false })
  })

  it('applies confirmed-availability overrides from the third round trip', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no deliveries
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({
        recordset: [
          {
            driver_id: 1,
            confirmed_date: '2026-06-20',
            confirmed_location: 'Austin, TX',
            notes: 'driver confirmed',
            canada: 1,
            california: 0,
            rating: 4.8,
            equipment: 'Straight Truck',
            home_city: 'Austin',
            home_state: 'TX',
            wgs: 1,
          },
        ],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }

    expect(body.data[0]!.confirmedAvailableDate).toBe('2026-06-20')
    expect(body.data[0]!.confirmedAvailableLocation).toBe('Austin, TX')
    expect(body.data[0]!.confirmedNotes).toBe('driver confirmed')
    // Variant-B roster overrides — bit columns normalized to boolean.
    expect(body.data[0]!.canada).toBe(true)
    expect(body.data[0]!.california).toBe(false)
    expect(body.data[0]!.rating).toBe(4.8)
    expect(body.data[0]!.equipment).toBe('Straight Truck')
    expect(body.data[0]!.homeCity).toBe('Austin')
    expect(body.data[0]!.homeState).toBe('TX')
    // WGS is tri-state: 1 -> Yes (true).
    expect(body.data[0]!.wgs).toBe(true)
  })

  it('maps a NULL wgs override to the Maybe state (null)', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no deliveries
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
      .mockResolvedValueOnce({
        recordset: [{ driver_id: 1, wgs: null }],
        rowsAffected: [],
      })

    const res = await buildApp().request('/onprem/longhaul/driver-planning')
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    expect(body.data[0]!.wgs).toBeNull()
  })

  it('soft-fails when the DriverConfirmedAvailability table is missing', async () => {
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock
      .mockResolvedValueOnce({ recordset: [planningRow()], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // no deliveries
      .mockResolvedValueOnce({ recordset: [], rowsAffected: [] }) // ensure
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
