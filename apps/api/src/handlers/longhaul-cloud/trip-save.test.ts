// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct trip-save handlers (create + update).
// resolveLonghaulUser and executeSql are mocked.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-user', () => ({ resolveLonghaulUser: vi.fn() }))
vi.mock('../../lib/push-triggers', () => ({ enqueueTripAssignmentPush: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import { longhaulCreateTripHandler, longhaulUpdateTripHandler } from './trip-save'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { executeSql } from '../../lib/mssql-executor-client'
import { enqueueTripAssignmentPush } from '../../lib/push-triggers'

const resolveMock = resolveLonghaulUser as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock
const pushMock = enqueueTripAssignmentPush as unknown as Mock

/** Stand-in for the tenant-scoped Prisma client the tenant middleware sets. */
const dbStub = {} as never

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    c.set('db', dbStub)
    await next()
  })
  app.post('/onprem/longhaul/trips', longhaulCreateTripHandler)
  app.put('/onprem/longhaul/trips/:id', longhaulUpdateTripHandler)
  return app
}

function req(path: string, method: string, body: unknown) {
  return buildApp().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const shipment = { order_num: 100, del_date2: '2026-06-05', plan_del: '2026-06-05' }
const tripBody = (over: Record<string, unknown> = {}) => ({
  trip_title: 'T',
  driver: { id: 9, agent_code: 'AG' },
  dispatcher: { code: 5, first_name: 'Di', last_name: 'P' },
  status: { id: 1, status_id: 1, status: 'Pending' },
  created_by_id: 7,
  updated_by_id: 7,
  shipments: [shipment],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
  pushMock.mockResolvedValue(true)
})

/** The states reference recordset every summary read now trails. */
const STATE_ROWS = [
  { id: 7, geo_code: 'CA' },
  { id: 47, geo_code: 'PA' },
]

/** RT1 (existing header + activities + shipments + states) for an update. */
function mockUpdateReads(existingDriverId: number | null) {
  executeSqlMock.mockResolvedValueOnce({
    recordset: [],
    recordsets: [
      [{ driver_id: existingDriverId, dispatcher_id: 5 }],
      [],
      [{ order_num: 100, vip: 'N', total_est_wt: 0, weight: 0, line_haul: 0 }],
      STATE_ROWS,
    ],
    rowsAffected: [],
  })
}

/** RT2 (the atomic batch) returning the saved trip row. */
function mockSaveBatch(id = 55) {
  executeSqlMock.mockResolvedValueOnce({
    recordset: [{ id, trip_title: 'T' }],
    recordsets: [[]],
    rowsAffected: [1],
  })
}

describe('POST /trips (cloud-direct create)', () => {
  it('reads shipments then runs one atomic insert batch, returns the trip 201', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [],
        recordsets: [
          [
            {
              order_num: 100,
              vip: 'N',
              total_est_wt: 100,
              weight: 140,
              line_haul: 500,
              shipper_state: 'CA',
              consignee_state: 'PA',
            },
          ],
          STATE_ROWS,
        ],
        rowsAffected: [1],
      })
      .mockResolvedValueOnce({
        recordset: [{ id: 77, trip_title: 'T' }],
        recordsets: [[]],
        rowsAffected: [1],
      })

    const res = await req('/onprem/longhaul/trips', 'POST', tripBody())

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { id: 77, trip_title: 'T' } })
    expect(executeSqlMock).toHaveBeenCalledTimes(2)
    const [, batchSql] = executeSqlMock.mock.calls[1]!
    expect(batchSql).toContain('BEGIN TRAN')
    expect(batchSql).toContain('INSERT INTO TripMaster')
    expect(batchSql).toContain('SET @tripId = SCOPE_IDENTITY()')
    expect(batchSql).toContain('INSERT INTO LongDistanceDispatchActivity')
    expect(batchSql).toContain('UPDATE TripMaster SET') // summary persist
    expect(batchSql).toContain('SELECT * FROM TripMaster WHERE id = @tripId')
  })

  // Regression: the summary roll-up wrote 0/null for actual weight, super-VIP
  // count and both state ids because it read field names the shipment view does
  // not project. These values must survive the read into the persisted batch.
  it('persists the roll-up computed from the real view columns', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [],
        recordsets: [
          [
            {
              order_num: 100,
              vip: 'Y',
              idc_break: 'Y', // super VIP
              total_est_wt: 100,
              weight: 140, // the actual weight
              line_haul: 500,
              shipper_state: 'CA',
              consignee_state: 'PA',
            },
          ],
          STATE_ROWS,
        ],
        rowsAffected: [1],
      })
      .mockResolvedValueOnce({
        recordset: [{ id: 77, trip_title: 'T' }],
        recordsets: [[]],
        rowsAffected: [1],
      })

    // `load_date2` is what makes buildShipmentActivities emit the LOAD that the
    // weight roll-up sums over; the default fixture only generates a delivery.
    const res = await req(
      '/onprem/longhaul/trips',
      'POST',
      tripBody({
        shipments: [{ ...shipment, load_date2: '2026-06-01', plan_load: '2026-06-01' }],
      }),
    )

    expect(res.status).toBe(201)
    // buildSaveBatch prefixes the summary params `s_`.
    const [, , batchOpts] = executeSqlMock.mock.calls[1]!
    expect(batchOpts.params).toContainEqual({ name: 's_total_estimated_lbs', value: 100 })
    expect(batchOpts.params).toContainEqual({ name: 's_total_actual_lbs', value: 140 })
    expect(batchOpts.params).toContainEqual({ name: 's_origin_state_id', value: 7 })
    expect(batchOpts.params).toContainEqual({ name: 's_destination_state_id', value: 47 })
    expect(batchOpts.params).toContainEqual({ name: 's_supervip_count', value: 1 })
    expect(batchOpts.params).toContainEqual({ name: 's_vip_count', value: 0 }) // super VIP excluded
  })

  it('rejects a trip with no shipments (403)', async () => {
    const res = await req('/onprem/longhaul/trips', 'POST', tripBody({ shipments: [] }))
    expect(res.status).toBe(403)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('propagates auth errors from resolveLonghaulUser', async () => {
    resolveMock.mockResolvedValue({
      ok: false,
      status: 422,
      error: 'x',
      code: 'LONGHAUL_USER_NOT_MAPPED',
    })
    const res = await req('/onprem/longhaul/trips', 'POST', tripBody())
    expect(res.status).toBe(422)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })
})

describe('PUT /trips/:id (cloud-direct update)', () => {
  it('reads existing state then writes; updates the matched activity', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [],
        recordsets: [
          [{ driver_id: 9, dispatcher_id: 5 }], // header
          [
            {
              id: 1,
              order_num: 100,
              activityType_code: 'RDEL',
              actual_date: null,
              TripMaster_id: 55,
            },
          ], // activities
          [{ order_num: 100, vip: 'N', total_est_wt: 0, weight: 0, line_haul: 0 }], // shipments
          STATE_ROWS, // states
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [{ id: 55 }], recordsets: [[]], rowsAffected: [1] })

    const res = await req('/onprem/longhaul/trips/55', 'PUT', tripBody({ id: 55 }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 55 } })
    const [, batchSql] = executeSqlMock.mock.calls[1]!
    expect(batchSql).toContain('SET @tripId = @tripIdParam')
    expect(batchSql).toContain('UPDATE LongDistanceDispatchActivity SET') // the matched RDEL update
  })

  it('returns 404 when the trip does not exist', async () => {
    executeSqlMock.mockResolvedValueOnce({
      recordset: [],
      recordsets: [[], [], []],
      rowsAffected: [],
    })
    const res = await req('/onprem/longhaul/trips/55', 'PUT', tripBody({ id: 55 }))
    expect(res.status).toBe(404)
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // no write batch
  })

  it('returns 403 for a driver change on an in-progress trip', async () => {
    executeSqlMock.mockResolvedValueOnce({
      recordset: [],
      recordsets: [[{ driver_id: 9, dispatcher_id: 5 }], [], [{ order_num: 100 }]],
      rowsAffected: [],
    })
    const res = await req(
      '/onprem/longhaul/trips/55',
      'PUT',
      tripBody({
        id: 55,
        driver: { id: 10 },
        status: { id: 4, status_id: 4, status: 'In Transit' },
      }),
    )
    expect(res.status).toBe(403)
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // guarded before the write
  })

  it('returns 400 for a non-numeric trip id', async () => {
    const res = await req('/onprem/longhaul/trips/abc', 'PUT', tripBody())
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Driver-assignment push. Fires only when a save ASSIGNS a driver the trip
// didn't already have, and can never fail the (already committed) save.
// ---------------------------------------------------------------------------
describe('driver-assignment push', () => {
  it('enqueues for the assigned driver on create, keyed to the new trip id', async () => {
    executeSqlMock.mockResolvedValueOnce({
      recordset: [],
      recordsets: [
        [{ order_num: 100, vip: 'N', total_est_wt: 100, weight: 140, line_haul: 500 }],
        STATE_ROWS,
      ],
      rowsAffected: [1],
    })
    mockSaveBatch(77)

    const res = await req('/onprem/longhaul/trips', 'POST', tripBody())

    expect(res.status).toBe(201)
    expect(pushMock).toHaveBeenCalledWith(dbStub, 'tenant-1', {
      tripId: 77,
      longhaulDriverId: 9,
    })
  })

  it('enqueues on update when the driver changes', async () => {
    mockUpdateReads(9)
    mockSaveBatch(55)

    const res = await req(
      '/onprem/longhaul/trips/55',
      'PUT',
      tripBody({ id: 55, driver: { id: 12, agent_code: 'AG' } }),
    )

    expect(res.status).toBe(200)
    expect(pushMock).toHaveBeenCalledWith(dbStub, 'tenant-1', {
      tripId: 55,
      longhaulDriverId: 12,
    })
  })

  it('stays silent when the driver is unchanged (the routine trip edit)', async () => {
    mockUpdateReads(9)
    mockSaveBatch(55)

    const res = await req('/onprem/longhaul/trips/55', 'PUT', tripBody({ id: 55 }))

    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('stays silent when the driver is cleared (the "None" sentinel 0)', async () => {
    mockUpdateReads(9)
    mockSaveBatch(55)

    const res = await req(
      '/onprem/longhaul/trips/55',
      'PUT',
      tripBody({ id: 55, driver: { id: 0 } }),
    )

    expect(res.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('still returns the saved trip when the push enqueue throws', async () => {
    mockUpdateReads(9)
    mockSaveBatch(55)
    pushMock.mockRejectedValue(new Error('postgres unreachable'))

    const res = await req(
      '/onprem/longhaul/trips/55',
      'PUT',
      tripBody({ id: 55, driver: { id: 12, agent_code: 'AG' } }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { id: 55, trip_title: 'T' } })
  })
})
