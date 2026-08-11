// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct longhaul `GET /trips/:id` handler.
//
// Prisma and the mssql-executor client are mocked so the test never touches
// Postgres or the executor Lambda. The handler issues up to THREE executor
// round trips — the trip bundle, then (in parallel) the shipment bundle and a
// separate soft-failing extra-locations query — these tests assert the call
// count alongside the response shape.
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
    // RT2: shipment bundle (3 statements) → recordsets[0..2] = shipments /
    // activities / coverage. Extra locations come from a SEPARATE query.
    const shipmentRow = { order_num: 1001, shipper_name: 'Acme' }
    const shipActivityThisTrip = { id: 9, TripMaster_id: 42, order_num: 1001 }
    const shipActivityOtherTrip = { id: 9, TripMaster_id: 99, order_num: 1001 }
    const coverageRow = { order_num: 1001, activity_code: 'LOAD', coverage_agent_id: 'X' }
    const extraLocationRow = { order_num: 1001, location_type: 'EXTRA_STOP' }
    executeSqlMock.mockResolvedValueOnce({
      recordset: [shipmentRow],
      recordsets: [[shipmentRow], [shipActivityThisTrip, shipActivityOtherTrip], [coverageRow]],
      rowsAffected: [],
    })
    // Separate extra-locations query → single recordset.
    executeSqlMock.mockResolvedValueOnce({
      recordset: [extraLocationRow],
      recordsets: [[extraLocationRow]],
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

    // Three round trips: trip bundle + shipment bundle + extra-locations.
    expect(executeSqlMock).toHaveBeenCalledTimes(3)

    // The shipment bundle must not join `sales`. It projected nothing from that
    // table (only `s.*`), but an order with two `sales` rows duplicated the
    // shipment — and with it every Gantt row the shipment contributes.
    const shipmentBundleSql = executeSqlMock.mock.calls[1]![1] as string
    expect(shipmentBundleSql).toContain('FROM v_longhaul_shipments_v2 s')
    expect(shipmentBundleSql).not.toMatch(/JOIN\s+sales/)
  })

  it('collapses a duplicated order_num from the view to one shipment', async () => {
    // v_longhaul_shipments_v2 returns 617 rows for 307 order_nums in NWI prod
    // (three orders return three rows), and assembleShipments maps 1:1 over
    // whatever the view hands back — so the trip screen rendered the same
    // shipment twice. #534 added this backstop to shipments-list but not here.
    // Affected orders sit on live trips: 16646, 16498, 16442, 16385, 16317, …
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [],
    })
    const first = { order_num: 1001, shipper_name: 'Acme' }
    const duplicate = { order_num: 1001, shipper_name: 'Acme' }
    executeSqlMock.mockResolvedValueOnce({
      recordset: [first],
      recordsets: [[first, duplicate], [], [], []],
      rowsAffected: [],
    })
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    const shipments = body.data.shipments as Array<Record<string, unknown>>
    expect(shipments).toHaveLength(1)
    expect(shipments[0]!['order_num']).toBe(1001)
  })

  it('soft-fails when pegasus_extra_location is absent — extra_locations is [] and the trip still returns 200', async () => {
    // Regression (Phase 3.1 re-mount): pegasus_extra_location does not exist on
    // every tenant's DB. It is queried SEPARATELY from the mandatory
    // shipment/activity/coverage batch precisely so its absence cannot 500 the
    // whole trip. The first re-mount batched it in and 500'd on every trip in
    // QA ("Invalid object name 'pegasus_extra_location'"). The on-prem repo and
    // the cloud shipments-list handler both soft-fail this same lookup.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    const shipmentRow = { order_num: 1001, shipper_name: 'Acme' }
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [],
    })
    // Shipment bundle succeeds (mandatory data present)…
    executeSqlMock.mockResolvedValueOnce({
      recordset: [shipmentRow],
      recordsets: [[shipmentRow], [], []],
      rowsAffected: [],
    })
    // …but the extra-locations query fails because the table is absent.
    executeSqlMock.mockRejectedValueOnce(new Error("Invalid object name 'pegasus_extra_location'."))

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    const shipments = body.data.shipments as Array<Record<string, unknown>>
    expect(shipments).toHaveLength(1)
    expect(shipments[0]!['order_num']).toBe(1001)
    // The absent optional table degrades to an empty list — not a 500.
    expect(shipments[0]!['extra_locations']).toEqual([])
    // Mandatory trip data is unaffected.
    expect(body.data.activities).toEqual([activityRow])
    expect(body.data.notes).toEqual([noteRow])
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
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

  it('joins the Longhaul_ActivityType edit flags onto trip + shipment activities', async () => {
    // Regression: the activity queries selected only code/name/abbreviation from
    // Longhaul_ActivityType, so `isCanEditDates` / `isHasETA` never reached the
    // client and the driver-planning date pickers stayed locked. Both the RT1
    // trip-activities query and the RT2 shipment-activities query must alias them.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [],
    })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [{ order_num: 1001 }],
      recordsets: [[{ order_num: 1001 }], [], []],
      rowsAffected: [],
    })
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [] })

    await buildApp().request('/onprem/longhaul/trips/42')

    // executeSql(connectionString, sql, opts) — the SQL is the second argument.
    const tripBundleSql = executeSqlMock.mock.calls[0]![1] as string
    const shipmentBundleSql = executeSqlMock.mock.calls[1]![1] as string
    for (const sql of [tripBundleSql, shipmentBundleSql]) {
      expect(sql).toContain('at.isCanEditDates AS activityType_isCanEditDates')
      expect(sql).toContain('at.isHasETA AS activityType_isHasETA')
    }
  })

  it('attaches extraActivities (add-activity templates) with a full activityType to each shipment', async () => {
    // Regression: the cloud trip-detail port dropped the legacy
    // getShipmentsByShipmentIds → buildExtraShipmentActivities step, so trip
    // shipments arrived with no `extraActivities` and the AddActivity menu in
    // the planning screen rendered empty. The RT2 batch now also fetches the
    // activity-types map (recordsets[3]) to populate the templates.
    findUnique.mockResolvedValue({ mssqlConnectionString: 'Server=a,1433' })
    executeSqlMock.mockResolvedValueOnce({
      recordset: [tripRow],
      recordsets: [[tripRow], [activityRow], [noteRow]],
      rowsAffected: [],
    })
    // A shipment with a delivery date but no existing RDEL activity → the
    // builder should offer an RDEL "add activity" template.
    const shipmentRow = { order_num: 1001, shipper_name: 'Acme', del_date2: '2026-06-01' }
    const rdelType = {
      code: 'RDEL',
      name: 'Delivery',
      abbreviation: 'DEL',
      isHasETA: true,
      isCanEditDates: true,
    }
    executeSqlMock.mockResolvedValueOnce({
      recordset: [shipmentRow],
      // shipments / activities / coverage / activity-types
      recordsets: [[shipmentRow], [], [], [rdelType]],
      rowsAffected: [],
    })
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [] })

    const res = await buildApp().request('/onprem/longhaul/trips/42')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown> }
    const shipments = body.data.shipments as Array<Record<string, unknown>>
    const extras = shipments[0]!['extraActivities'] as Array<Record<string, unknown>>
    expect(Array.isArray(extras)).toBe(true)
    const rdel = extras.find((e) => e['ActivityType_code'] === 'RDEL')
    expect(rdel).toBeDefined()
    // The template carries the full activity type — abbreviation for the menu
    // label, isHasETA / isCanEditDates for downstream date editing.
    expect(rdel!['activityType']).toMatchObject({ abbreviation: 'DEL', isHasETA: true })
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
