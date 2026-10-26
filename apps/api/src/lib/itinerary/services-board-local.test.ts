import { describe, it, expect } from 'vitest'
import {
  buildLocalBoardSql,
  localBoardRows,
  sortBoardRows,
  BOARD_SORT_FIELDS,
} from './services-board-local'
import { ACTIVITY_SORT_KEYS } from '../../handlers/longhaul-cloud/activities-list'
import type { ActivityTypeEntry } from './types'

const CATALOG = new Map<string, ActivityTypeEntry>([
  [
    'PACK',
    {
      code: 'PACK',
      name: 'Pack',
      abbreviation: 'Pack',
      isPerformedAtOrigin: true,
      isPerformedAtDestination: false,
      sequencePriority: 10,
    },
  ],
  [
    'RDEL',
    {
      code: 'RDEL',
      name: 'Del',
      abbreviation: 'Deliver',
      isPerformedAtOrigin: false,
      isPerformedAtDestination: true,
      sequencePriority: 90,
    },
  ],
])

const JOB = {
  id: 7001,
  order_num: 200,
  service_date: '2026-10-20T00:00:00.000Z',
  services: 'PACK RDEL',
  active: 'Y',
  is_final: 'N',
  is_confirmed: 'Y',
  eta_minimum: null,
  eta_maximum: null,
  service_at_orig: 'Y',
  service_at_dest: 'Y',
  OriginLocation1: null,
  DestinationLocation1: null,
  driver_id1: 412,
  driver_id2: 77,
  it_driver1_name: 'JOE SMITH',
  it_driver2_name: '',
  it_sales_shipper_name: 'JONES, AL',
  it_origin_street: '1 ORIGIN ST',
  it_origin_unit: null,
  it_origin_city: 'CANTON',
  it_origin_state: 'MI',
  it_origin_zip: '48187',
  it_dest_street: '9 DEST RD',
  it_dest_unit: null,
  it_dest_city: 'TROY',
  it_dest_state: 'MI',
  it_dest_zip: '48083',
  // A local-only order: not in v_longhaul_shipments_v2, so every view column is null.
  shipper_name: null,
  origin_city: null,
  origin_state: null,
  destination_city: null,
  destination_state: null,
  haul_mode: null,
  shaul: null,
  operations_id: null,
  dispatcher_last_name: null,
  total_est_wt: null,
}

describe('buildLocalBoardSql', () => {
  function build(filters: Parameters<typeof buildLocalBoardSql>[0]) {
    const params: unknown[] = []
    const sql = buildLocalBoardSql(filters, (v) => {
      params.push(v)
      return `@p${params.length - 1}`
    })
    return { sql, params }
  }

  it('filters active jobs on the service date, inclusively, with bound params', () => {
    const { sql, params } = build({ date_range: ['2026-10-19', '2026-10-25'] })
    expect(sql).toContain("ISNULL(j.active, 'Y') <> 'N'")
    expect(sql).toContain('j.service_date >= @p0 AND j.service_date <= @p1')
    expect(params).toEqual(['2026-10-19', '2026-10-25'])
  })

  it('applies short haul and dispatcher through the shipments view, as activities do', () => {
    const { sql, params } = build({
      short_haul: [{ value: 'Y' }],
      operations_id: [{ value: '17' }, { value: '22' }],
    })
    expect(sql).toContain('LEFT JOIN v_longhaul_shipments_v2 AS s ON j.order_num = s.order_num')
    expect(sql).toContain('s.haul_mode IN (@p0)')
    expect(sql).toContain('s.operations_id IN (@p1, @p2)')
    expect(params).toEqual(['Y', '17', '22'])
  })

  it('never interpolates a filter value', () => {
    const { sql } = build({ operations_id: [{ value: "1'; DROP TABLE sales --" }] })
    expect(sql).not.toContain('DROP TABLE')
  })

  it('has no duplicate output column names (#575) and no FOR JSON (#629)', () => {
    const { sql } = build({})
    const select = sql.slice(0, sql.indexOf(' FROM LocalDispatchJobs'))
    const names = [...select.matchAll(/(?:AS (\w+)|j\.(\w+))(?=,|$)/g)].map((m) => m[1] ?? m[2])
    expect(names.length).toBeGreaterThan(30)
    expect(new Set(names).size).toBe(names.length)
    expect(sql).not.toMatch(/FOR JSON/i)
  })
})

describe('localBoardRows', () => {
  it('makes one board row per token, keyed apart from activity ids', () => {
    const rows = localBoardRows([JOB], CATALOG, {})
    expect(rows.map((r) => r['row_key'])).toEqual([
      'local-job-token:7001:PACK',
      'local-job-token:7001:RDEL',
    ])
    expect(rows[0]).toMatchObject({
      source: 'local',
      id: 7001,
      order_num: 200,
      TripMaster_id: null,
      ActivityType_code: 'PACK',
      activity_type_abbreviation: 'Pack',
      scheduled_date: '2026-10-20T00:00:00.000Z',
      city: 'CANTON',
      driver_name: 'JOE SMITH',
      status: 'Confirmed',
      shipper_name: 'JONES, AL',
      origin_city: 'CANTON',
      destination_city: 'TROY',
    })
    expect(rows[1]).toMatchObject({ city: 'TROY', activity_type_abbreviation: 'Deliver' })
  })

  it('filters by abbreviation, the token the board sends', () => {
    const rows = localBoardRows([JOB], CATALOG, { activity_type: [{ value: 'Deliver' }] })
    expect(rows.map((r) => r['ActivityType_code'])).toEqual(['RDEL'])
  })

  it('shows a final job as Final with its service date as the actual', () => {
    const [row] = localBoardRows([{ ...JOB, services: 'PACK', is_final: 'Y' }], CATALOG, {})
    expect(row).toMatchObject({ status: 'Final', actual_date: '2026-10-20T00:00:00.000Z' })
  })
})

describe('sortBoardRows', () => {
  const rows = [
    { source: 'local', id: 5, scheduled_date: '2026-10-21T00:00:00.000Z', driver_name: 'B' },
    { source: 'longhaul', id: 9, scheduled_date: '2026-10-21T00:00:00.000Z', driver_name: null },
    { source: 'longhaul', id: 3, scheduled_date: '2026-10-20T00:00:00.000Z', driver_name: 'A' },
  ]

  it('defaults to scheduled date ascending, longhaul before local on a tie', () => {
    expect(sortBoardRows(rows).map((r) => r.id)).toEqual([3, 9, 5])
  })

  it('sorts by a whitelisted key either way, NULL first ascending like SQL Server', () => {
    expect(sortBoardRows(rows, { value: 'driver_name' }).map((r) => r.id)).toEqual([9, 3, 5])
    expect(sortBoardRows(rows, { value: 'driver_name', order: 'desc' }).map((r) => r.id)).toEqual([
      5, 3, 9,
    ])
  })

  it('ignores a key that is not whitelisted, including inherited ones', () => {
    expect(sortBoardRows(rows, { value: 'constructor', order: 'desc' }).map((r) => r.id)).toEqual([
      3, 9, 5,
    ])
  })

  it('covers exactly the sort keys activities-list whitelists', () => {
    expect(Object.keys(BOARD_SORT_FIELDS).sort()).toEqual([...ACTIVITY_SORT_KEYS].sort())
  })
})
