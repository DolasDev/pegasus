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
  buildStateIdByGeoCode,
  computeTripSummary,
  recomputeTripSummaryCloud,
  SUMMARY_SHIPMENT_COLUMNS,
  type SummaryActivityRow,
} from './longhaul-cloud-trip-summary'
import { LONGHAUL_SHIPMENT_VIEW_COLUMNS } from '@pegasus/longhaul-contracts'
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
      { order_num: 1, vip: 'Y', total_est_wt: 100, weight: 120, line_haul: 500 },
      { order_num: 2, vip: 'N', total_est_wt: 200, weight: 180, line_haul: 700 },
      { order_num: 3, vip: 'N', total_est_wt: 999, weight: 999, line_haul: 999 },
    ]

    const s = computeTripSummary(activities, shipments)

    expect(s.load_activity_count).toBe(2)
    expect(s.total_estimated_lbs).toBe(300) // 100 + 200 (loads only)
    expect(s.total_actual_lbs).toBe(300) // 120 + 180 — `weight`, loads only
    expect(s.total_estimated_linehaul_usd).toBe(1200) // 500 + 700
    expect(s.total_actual_linehaul_usd).toBe(1200) // also line_haul
    expect(s.vip_count).toBe(1) // order 1
    expect(s.supervip_count).toBe(0) // no idc_break = 'Y'
    expect(s.planned_first_day).toBe('2026-06-01')
    expect(s.planned_last_day).toBe('2026-06-04')
    expect(s.total_days).toBe(4) // inclusive day span
    expect(s.origin_state_id).toBeNull() // no state codes supplied
    expect(s.destination_state_id).toBeNull()
  })

  // Regression: `total_actual_wt` is not a column on v_longhaul_shipments_v2, so
  // the roll-up summed undefined and wrote 0 over correct legacy values — 337 NWI
  // trips (4,289,839 lbs) before it was caught. The real column is `weight`.
  it('sums total_actual_lbs from `weight`, the column the view actually projects', () => {
    // Prod trip 16575: three load shipments, stored total_actual_lbs = 7900.
    const activities = [1, 2, 3].map((order_num) =>
      act({ order_num, ActivityType_code: 'R19O', planned_start: '2026-06-01' }),
    )
    const shipments = [
      { order_num: 1, total_est_wt: 1738, weight: 2480 },
      { order_num: 2, total_est_wt: 1539, weight: 1540 },
      { order_num: 3, total_est_wt: 5035, weight: 3880 },
    ]

    const s = computeTripSummary(activities, shipments)

    expect(s.total_actual_lbs).toBe(7900) // 2480 + 1540 + 3880
    expect(s.total_estimated_lbs).toBe(8312)
    expect(s.total_actual_lbs).not.toBe(0)
  })

  it('treats a missing or non-numeric weight as 0 rather than NaN', () => {
    const activities = [1, 2, 3].map((order_num) =>
      act({ order_num, ActivityType_code: 'LOAD', planned_start: '2026-06-01' }),
    )
    const s = computeTripSummary(activities, [
      { order_num: 1, weight: 500 },
      { order_num: 2, weight: null }, // never weighed
      { order_num: 3 }, // tenant on an older view — key absent entirely
    ])
    expect(s.total_actual_lbs).toBe(500)
  })

  it('counts super-VIPs via the configured field (idc_break for trip-save)', () => {
    const activities = [
      act({
        order_num: 1,
        ActivityType_code: 'LOAD',
        planned_start: '2026-06-01',
        planned_end: '2026-06-01',
      }),
      act({
        order_num: 2,
        ActivityType_code: 'LOAD',
        planned_start: '2026-06-02',
        planned_end: '2026-06-02',
      }),
    ]
    const shipments = [
      { order_num: 1, vip: 'Y', idc_break: 'N' }, // plain VIP
      { order_num: 2, vip: 'Y', idc_break: 'Y' }, // super VIP → excluded from vip_count
    ]
    const s = computeTripSummary(activities, shipments, { superVipField: 'idc_break' })
    expect(s.vip_count).toBe(1) // only order 1
    expect(s.supervip_count).toBe(1) // order 2

    // Regression: the default used to be `supervip`, which is not a column on the
    // view (#571) — so supervip_count was always 0 on the activity-save and
    // /summary paths. The default is now idc_break, matching explicit callers.
    expect(computeTripSummary(activities, shipments)).toEqual(s)
  })

  // Regression: origin/destination were read as nested `origin_state.state_id`
  // objects the view never projects, so both always wrote null.
  it('resolves state ids from the shipments 2-char geo codes', () => {
    const activities = [
      act({
        order_num: 1,
        ActivityType_code: 'LOAD',
        planned_start: '2026-06-01',
        planned_end: '2026-06-02',
      }),
      act({
        order_num: 2,
        ActivityType_code: 'LOAD',
        planned_start: '2026-06-05',
        planned_end: '2026-06-06',
      }),
    ]
    // Prod trip 16622: CA → PA, stored origin_state_id 7 / destination_state_id 47.
    const shipments = [
      { order_num: 1, shipper_state: 'CA', consignee_state: 'IL' },
      { order_num: 2, shipper_state: 'IL', consignee_state: 'PA' },
    ]
    const stateIdByGeoCode = { CA: 7, IL: 17, PA: 47 }

    const s = computeTripSummary(activities, shipments, { stateIdByGeoCode })

    expect(s.origin_state_id).toBe(7) // shipper_state of the earliest activity
    expect(s.destination_state_id).toBe(47) // consignee_state of the latest
  })

  it('leaves a state id null for a blank, unknown, or non-state code', () => {
    const activities = [act({ order_num: 1, ActivityType_code: 'LOAD' })]
    const stateIdByGeoCode = { NJ: 37 }

    for (const code of ['', '  ', 'XX', null, undefined]) {
      const s = computeTripSummary(
        activities,
        [{ order_num: 1, shipper_state: code as string | null, consignee_state: code as null }],
        { stateIdByGeoCode },
      )
      expect(s.origin_state_id).toBeNull()
      expect(s.destination_state_id).toBeNull()
    }

    // …and matches case/padding-insensitively, which the legacy data needs.
    const padded = computeTripSummary(
      activities,
      [{ order_num: 1, shipper_state: ' nj ', consignee_state: 'NJ' }],
      { stateIdByGeoCode },
    )
    expect(padded.origin_state_id).toBe(37)
    expect(padded.destination_state_id).toBe(37)
  })
})

describe('SUMMARY_SHIPMENT_COLUMNS', () => {
  // The `satisfies` clause enforces this at compile time; this asserts it again at
  // runtime so the manifest and the query cannot drift apart silently. Every bug
  // this file has had was a name that looked like a column and was not one.
  it('only names columns v_longhaul_shipments_v2 actually projects', () => {
    for (const col of SUMMARY_SHIPMENT_COLUMNS) {
      expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).toContain(col)
    }
  })

  it('does not name the fields that silently resolved to 0/null', () => {
    for (const ghost of ['total_actual_wt', 'supervip', 'origin_state', 'destination_state']) {
      expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).not.toContain(ghost)
      expect(SUMMARY_SHIPMENT_COLUMNS).not.toContain(ghost)
    }
  })
})

describe('buildStateIdByGeoCode', () => {
  it('maps geo_code to id, normalizing case and padding', () => {
    expect(
      buildStateIdByGeoCode([
        { id: 7, geo_code: 'CA' },
        { id: 37, geo_code: ' nj ' },
      ]),
    ).toEqual({ CA: 7, NJ: 37 })
  })

  it('keeps the first id when a geo_code repeats and skips unusable rows', () => {
    // Real data: v_longhaul_states has several CANADA rows; ids ascend.
    expect(
      buildStateIdByGeoCode([
        { id: 1, geo_code: 'AB' },
        { id: 6, geo_code: 'AB' },
        { id: 9, geo_code: '' },
        { id: null, geo_code: 'ZZ' },
        { geo_code: 'YY' },
        null,
        'not-a-row',
      ]),
    ).toEqual({ AB: 1 })
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
        recordset: [],
        // One round trip, two statements: shipments, then the states table.
        recordsets: [
          [
            {
              order_num: 1,
              vip: 'N',
              total_est_wt: 50,
              weight: 70,
              line_haul: 250,
              shipper_state: 'CA',
              consignee_state: 'PA',
            },
          ],
          [
            { id: 7, geo_code: 'CA' },
            { id: 47, geo_code: 'PA' },
          ],
        ],
        rowsAffected: [],
      })
      .mockResolvedValueOnce({ recordset: [], recordsets: [[]], rowsAffected: [1] })

    const n = await recomputeTripSummaryCloud('Server=a,1433', 42)

    expect(n).toBe(1)
    expect(executeSqlMock).toHaveBeenCalledTimes(3)
    const [, shipSql, shipOpts] = executeSqlMock.mock.calls[1]!
    expect(shipSql).toContain('FROM v_longhaul_shipments_v2 WHERE order_num IN (@o0)')
    expect(shipSql).toContain('FROM v_longhaul_states')
    // The columns the roll-up reads must actually be selected — the bug was a
    // field name that was neither selected nor a column.
    for (const col of ['weight', 'idc_break', 'shipper_state', 'consignee_state']) {
      expect(shipSql).toContain(col)
    }
    expect(shipOpts.params).toEqual([{ name: 'o0', value: 1 }])
    const [, updSql, updOpts] = executeSqlMock.mock.calls[2]!
    expect(updSql).toContain('UPDATE TripMaster SET')
    expect(updOpts.params).toContainEqual({ name: 'tripId', value: 42 })
    expect(updOpts.params).toContainEqual({ name: 'total_estimated_lbs', value: 50 })
    expect(updOpts.params).toContainEqual({ name: 'total_actual_lbs', value: 70 })
    expect(updOpts.params).toContainEqual({ name: 'origin_state_id', value: 7 })
    expect(updOpts.params).toContainEqual({ name: 'destination_state_id', value: 47 })
    expect(updOpts.params).toContainEqual({ name: 'load_activity_count', value: 1 })
  })
})
