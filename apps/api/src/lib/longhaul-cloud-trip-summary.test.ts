// ---------------------------------------------------------------------------
// Unit tests for the cloud trip-summary recompute (pure + executor-backed).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type * as MssqlClient from './mssql-executor-client'

vi.mock('./mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import {
  computeTripSummary,
  recomputeTripSummaryCloud,
  type SummaryActivityRow,
} from './longhaul-cloud-trip-summary'
import { executeSql } from './mssql-executor-client'

const executeSqlMock = executeSql as unknown as Mock

const act = (o: Partial<SummaryActivityRow>): SummaryActivityRow => ({
  order_num: 1,
  actual_date: null,
  estimated_date: null,
  planned_start: null,
  planned_end: null,
  ActivityType_code: null,
  ...o,
})

describe('computeTripSummary (pure)', () => {
  it('sums load weights/linehaul and counts loads + VIPs', () => {
    const activities = [
      act({
        order_num: 1,
        ActivityType_code: 'LOAD',
        planned_start: '2026-06-01',
        planned_end: '2026-06-01',
      }),
      act({
        order_num: 2,
        ActivityType_code: 'R19O',
        planned_start: '2026-06-02',
        planned_end: '2026-06-04',
      }),
      act({
        order_num: 3,
        ActivityType_code: 'PACK',
        planned_start: '2026-06-02',
        planned_end: '2026-06-02',
      }), // not a load
    ]
    const shipments = [
      { order_num: 1, vip: 'Y', total_est_wt: 100, line_haul: 500 },
      { order_num: 2, vip: 'N', total_est_wt: 200, line_haul: 700 },
      { order_num: 3, vip: 'N', total_est_wt: 999, line_haul: 999 },
    ]

    const s = computeTripSummary(activities, shipments)

    expect(s.load_activity_count).toBe(2)
    expect(s.total_estimated_lbs).toBe(300) // 100 + 200 (loads only)
    expect(s.total_estimated_linehaul_usd).toBe(1200) // 500 + 700
    expect(s.total_actual_linehaul_usd).toBe(1200) // also line_haul
    expect(s.vip_count).toBe(1) // order 1
    expect(s.supervip_count).toBe(0) // column absent on the view
    expect(s.total_actual_lbs).toBe(0) // total_actual_wt absent on the view
    expect(s.planned_first_day).toBe('2026-06-01')
    expect(s.planned_last_day).toBe('2026-06-04')
    expect(s.total_days).toBe(4) // inclusive day span
    expect(s.origin_state_id).toBeNull()
    expect(s.destination_state_id).toBeNull()
  })
})

describe('recomputeTripSummaryCloud', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 and skips the update when the trip has no activities', async () => {
    executeSqlMock.mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [] })
    const n = await recomputeTripSummaryCloud('Server=a,1433', 42)
    expect(n).toBe(0)
    expect(executeSqlMock).toHaveBeenCalledTimes(1) // only the activities read
  })

  it('reads activities + shipments then UPDATEs TripMaster', async () => {
    executeSqlMock
      .mockResolvedValueOnce({
        recordset: [
          {
            order_num: 1,
            actual_date: null,
            estimated_date: null,
            planned_start: '2026-06-01',
            planned_end: '2026-06-02',
            ActivityType_code: 'LOAD',
          },
        ],
        recordsets: [[]],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({
        recordset: [{ order_num: 1, vip: 'N', total_est_wt: 50, line_haul: 250 }],
        recordsets: [[]],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [1] })

    const n = await recomputeTripSummaryCloud('Server=a,1433', 42)

    expect(n).toBe(1)
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
    const [, shipSql, shipOpts] = executeSqlMock.mock.calls[1]!
    expect(shipSql).toContain('FROM v_longhaul_shipments_v2 WHERE order_num IN (@o0)')
    expect(shipOpts.params).toEqual([{ name: 'o0', value: 1 }])
    const [, updSql, updOpts] = executeSqlMock.mock.calls[2]!
    expect(updSql).toContain('UPDATE TripMaster SET')
    expect(updOpts.params).toContainEqual({ name: 'tripId', value: 42 })
    expect(updOpts.params).toContainEqual({ name: 'total_estimated_lbs', value: 50 })
    expect(updOpts.params).toContainEqual({ name: 'load_activity_count', value: 1 })
  })
})
