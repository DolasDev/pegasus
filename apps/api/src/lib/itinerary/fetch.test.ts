import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

vi.mock('../mssql-executor-client', () => ({ executeSql: vi.fn() }))

import { executeSql } from '../mssql-executor-client'
import { fetchItinerary, ITINERARY_ROW_CAP } from './fetch'

const exec = executeSql as unknown as Mock
const CS = 'Server=a,1433'
const RANGE = { from: '2026-10-19', to: '2026-10-25' }

const ACTIVITY = {
  id: 9001,
  order_num: 100,
  TripMaster_id: 16426,
  ActivityType_code: 'RDEL',
  planned_start: '2026-10-21T00:00:00.000Z',
  planned_end: null,
  estimated_date: null,
  actual_date: null,
  street: '2 DEST AVE',
  unit: null,
  city: 'PETOSKEY',
  state: 'MI',
  zip: '49770',
  is_committed: false,
  is_confirmed: false,
  assigned_driver_id: 1203,
  trip_driver_id: 1203,
  it_type_name: 'Del',
  it_type_abbreviation: 'Deliver',
  it_type_at_origin: false,
  it_type_at_destination: true,
  it_type_sequence: 90,
  it_shipper_name: 'SMITH',
}

const JOB = {
  id: 7001,
  order_num: 200,
  service_date: '2026-10-20T00:00:00.000Z',
  services: 'PACK LOAD',
  active: 'Y',
  is_final: 'N',
  is_confirmed: 'Y',
  eta_minimum: null,
  eta_maximum: null,
  service_at_orig: 'Y',
  service_at_dest: 'N',
  OriginLocation1: null,
  DestinationLocation1: null,
  driver_id1: 412,
  driver_id2: 0,
  it_shipper_name: 'JONES',
  it_origin_street: '1 ORIGIN ST',
  it_origin_unit: null,
  it_origin_city: 'CANTON',
  it_origin_state: 'MI',
  it_origin_zip: '48187',
  it_dest_street: null,
  it_dest_unit: null,
  it_dest_city: 'TROY',
  it_dest_state: 'MI',
  it_dest_zip: null,
}

const CATALOG = [
  {
    code: 'PACK',
    name: 'Pack',
    abbreviation: 'Pack',
    isPerformedAtOrigin: true,
    isPerformedAtDestination: false,
    sequencePriority: 10,
  },
  {
    code: 'LOAD',
    name: 'Load',
    abbreviation: 'Load',
    isPerformedAtOrigin: true,
    isPerformedAtDestination: false,
    sequencePriority: 20,
  },
]

function sqlOf(call: number): string {
  return exec.mock.calls[call]?.[1] as string
}
function paramsOf(call: number): Array<{ name: string; value: unknown }> {
  return (exec.mock.calls[call]?.[2] as { params: Array<{ name: string; value: unknown }> }).params
}

beforeEach(() => {
  exec.mockReset()
})

describe('fetchItinerary', () => {
  it('reads nothing for a caller mapped to no driver (0 is unassigned)', async () => {
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: 0,
      localDriverEmployeeId: null,
    })
    expect(r).toEqual({ items: [], failed: [], overCap: [] })
    expect(exec).not.toHaveBeenCalled()
  })

  it('reads both sources in ONE executor call and merges them by day', async () => {
    exec.mockResolvedValue({
      recordset: [],
      recordsets: [[ACTIVITY], CATALOG, [JOB]],
      rowsAffected: [],
    })
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: 1203,
      localDriverEmployeeId: 412,
    })

    expect(exec).toHaveBeenCalledTimes(1)
    expect(r.failed).toEqual([])
    expect(r.items.map((i) => i.key)).toEqual([
      'local-job-token:7001:PACK', // the 20th
      'local-job-token:7001:LOAD',
      'longhaul-activity:9001', // the 21st
    ])
    expect(r.items[0]?.place).toMatchObject({ street: '1 ORIGIN ST', city: 'CANTON' })
  })

  it('orders a day by act sequence, so a local PACK does not sink under a trip delivery', async () => {
    const sameDayActivity = { ...ACTIVITY, planned_start: '2026-10-20T00:00:00.000Z' }
    exec.mockResolvedValue({
      recordset: [],
      recordsets: [[sameDayActivity], CATALOG, [JOB]],
      rowsAffected: [],
    })
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: 1203,
      localDriverEmployeeId: 412,
    })
    expect(r.items.map((i) => i.actCode)).toEqual(['PACK', 'LOAD', 'RDEL'])
  })

  it('leaves out Pending and cancelled trips, the way the driver app does, and keeps Offered', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [] })
    await fetchItinerary(CS, { ...RANGE, longhaulDriverId: 1203, localDriverEmployeeId: null })
    const sql = sqlOf(0)
    expect(sql).toContain("<> 'pending'")
    expect(sql).toContain("ISNULL(t.internal_status, '')))) <> 'canceled'")
    // A trip-less activity is not filtered by trip state.
    expect(sql).toContain('t.id IS NULL OR')
    expect(sql).not.toMatch(/'offered'/i)
  })

  it('binds the two driver ids separately and never across spaces', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [[], [], []], rowsAffected: [] })
    await fetchItinerary(CS, { ...RANGE, longhaulDriverId: 1203, localDriverEmployeeId: 412 })
    const sql = sqlOf(0)
    expect(paramsOf(0)).toEqual(
      expect.arrayContaining([
        { name: 'lh', value: 1203 },
        { name: 'ld', value: 412 },
        { name: 'from', value: '2026-10-19' },
        { name: 'to', value: '2026-10-25' },
      ]),
    )
    expect(sql).toContain('a.assigned_driver_id = @lh')
    expect(sql).toContain('j.driver_id1 = @ld OR j.driver_id2 = @ld')
    expect(sql).not.toMatch(/j\.driver_id[12] = @lh/)
    expect(sql).not.toMatch(/assigned_driver_id = @ld|t\.driver_id = @ld/)
  })

  it('gives an unassigned activity to the trip driver only, like the ETA editor', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [] })
    await fetchItinerary(CS, { ...RANGE, longhaulDriverId: 1203, localDriverEmployeeId: null })
    expect(sqlOf(0)).toContain('ISNULL(a.assigned_driver_id, 0) = 0 AND t.driver_id = @lh')
  })

  it('reads only the source the caller is mapped to', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [CATALOG, [JOB]], rowsAffected: [] })
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: null,
      localDriverEmployeeId: 412,
    })
    expect(sqlOf(0)).not.toContain('LongDistanceDispatchActivity')
    expect(r.items).toHaveLength(2)
  })

  it('reads the street of the destination from consignee_name1 (#569), never del_address1', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [CATALOG, []], rowsAffected: [] })
    await fetchItinerary(CS, { ...RANGE, longhaulDriverId: null, localDriverEmployeeId: 412 })
    expect(sqlOf(0)).toContain('consignee_name1 AS it_dest_street')
    expect(sqlOf(0)).not.toContain('del_address')
  })

  it('keeps the projection safe from #575 and #629', async () => {
    exec.mockResolvedValue({ recordset: [], recordsets: [[], [], []], rowsAffected: [] })
    await fetchItinerary(CS, { ...RANGE, longhaulDriverId: 1, localDriverEmployeeId: 2 })
    const sql = sqlOf(0)
    expect(sql).not.toMatch(/\bj\.\*|\bs\.\*|\bt\.\*/)
    expect(sql).not.toMatch(/FOR JSON/i)
  })

  it('isolates a failing source by retrying statement by statement', async () => {
    exec
      .mockRejectedValueOnce(new Error("Invalid object name 'LocalDispatchJobs'"))
      .mockResolvedValueOnce({ recordset: [ACTIVITY], recordsets: [[ACTIVITY]], rowsAffected: [] })
      .mockResolvedValueOnce({ recordset: CATALOG, recordsets: [CATALOG], rowsAffected: [] })
      .mockRejectedValueOnce(new Error("Invalid object name 'LocalDispatchJobs'"))
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: 1203,
      localDriverEmployeeId: 412,
    })
    expect(r.failed).toEqual(['local'])
    expect(r.items.map((i) => i.key)).toEqual(['longhaul-activity:9001'])
  })

  it('still shows local jobs when only the catalog fails', async () => {
    exec
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error("Invalid object name 'Longhaul_ActivityType'"))
      .mockResolvedValueOnce({ recordset: [JOB], recordsets: [[JOB]], rowsAffected: [] })
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: null,
      localDriverEmployeeId: 412,
    })
    expect(r.failed).toEqual([])
    expect(r.items.map((i) => i.actCode)).toEqual(['PACK', 'LOAD'])
    // Without the catalog PACK and LOAD are unknown, but they are not dropped.
    expect(r.items.every((i) => i.known === false)).toBe(true)
  })

  it('reports a source that hit the row cap', async () => {
    const many = Array.from({ length: ITINERARY_ROW_CAP + 1 }, (_, i) => ({
      ...ACTIVITY,
      id: i + 1,
    }))
    exec.mockResolvedValue({ recordset: [], recordsets: [many], rowsAffected: [] })
    const r = await fetchItinerary(CS, {
      ...RANGE,
      longhaulDriverId: 1203,
      localDriverEmployeeId: null,
    })
    expect(r.overCap).toEqual(['longhaul'])
  })
})
