import { describe, it, expect } from 'vitest'
import {
  orderAssignedItems,
  orderAssignedSql,
  orderAssignedTo,
  type OrderAssignedRow,
} from './order-assigned'
import type { ActivityTypeEntry } from './types'

const CATALOG = new Map<string, ActivityTypeEntry>([
  [
    'PACK',
    {
      code: 'PACK',
      name: 'Pack',
      abbreviation: 'PK',
      isPerformedAtOrigin: true,
      isPerformedAtDestination: false,
      sequencePriority: 10,
    },
  ],
  [
    'LOAD',
    {
      code: 'LOAD',
      name: 'Load',
      abbreviation: 'LD',
      isPerformedAtOrigin: true,
      isPerformedAtDestination: false,
      sequencePriority: 20,
    },
  ],
  [
    'RDEL',
    {
      code: 'RDEL',
      name: 'Del',
      abbreviation: 'DL',
      isPerformedAtOrigin: false,
      isPerformedAtDestination: true,
      sequencePriority: 90,
    },
  ],
])

function order(overrides: Partial<OrderAssignedRow> = {}): OrderAssignedRow {
  return {
    order_num: 600123,
    shipper_name: 'Smith',
    pack_date2: '2026-11-02T00:00:00.000Z',
    plan_pack: '2026-11-02T00:00:00.000Z',
    pack_actual: null,
    load_date2: '2026-11-03T00:00:00.000Z',
    plan_load: '2026-11-03T00:00:00.000Z',
    load_actual: null,
    del_date2: '2026-11-10T00:00:00.000Z',
    plan_del: '2026-11-12T00:00:00.000Z',
    del_actual: null,
    rule19_id: null,
    rule19_out_date: null,
    shipper_add1: '1 ORIGIN ST',
    shipper_add2: null,
    shipper_city: 'TORONTO',
    shipper_state: 'ON',
    shipper_zip: 'M5V',
    consignee_name1: '9 DEST AVE',
    consignee_name2: 'UNIT 4',
    consignee_city: 'CALGARY',
    consignee_state: 'AB',
    consignee_zip: 'T2P',
    ...overrides,
  }
}

const ALL = ['2026-10-01', '2026-12-31'] as const

describe('orderAssignedTo — the shared rule', () => {
  const sql = orderAssignedTo('v', '@lh')

  it('binds the longhaul id only as a parameter', () => {
    expect(sql).toContain('v.driver_id = @lh')
  })

  it('requires an order with no longhaul activity rows', () => {
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM LongDistanceDispatchActivity oa_a WHERE oa_a.order_num = v.order_num)',
    )
  })

  it("excludes a copy of a local job's driver (the trigger's copy)", () => {
    expect(sql).toContain(
      'NOT EXISTS (SELECT 1 FROM LocalDispatchJobs oa_j WHERE oa_j.order_num = v.order_num' +
        '   AND (oa_j.driver_id1 = v.driver_id OR oa_j.driver_id2 = v.driver_id))',
    )
  })

  it("requires the order's driver_name to name that longhaul driver, spaces and case ignored", () => {
    expect(sql).toContain('FROM v_longhaul_drivers oa_d WHERE oa_d.DRIVER_ID = v.driver_id')
    // The view's `LAST, FIRST (id)` is cut at " (", the order's `LAST, FIRST # phone` at " #".
    expect(sql).toContain("CHARINDEX(' (', ISNULL(oa_d.DRIVER_NAME, ''))")
    expect(sql).toContain("CHARINDEX(' #', ISNULL(v.driver_name, ''))")
    expect(sql.match(/REPLACE\(UPPER\(/g)).toHaveLength(2)
  })

  it('reads the view, by act day, with the cap', () => {
    const q = orderAssignedSql(1001)
    expect(q).toMatch(/^SELECT TOP \(1001\) /)
    expect(q).toContain('FROM v_longhaul_shipments_v2 v WHERE (v.driver_id = @lh')
    expect(q).toContain('COALESCE(v.pack_actual, v.pack_date2, v.plan_pack) BETWEEN @from AND @to')
    expect(q).toContain('COALESCE(v.del_actual, v.del_date2, v.plan_del) BETWEEN @from AND @to')
    expect(q).not.toMatch(/\*|FOR JSON/i)
  })
})

describe('orderAssignedItems', () => {
  it('makes the required acts trip save would, with their planned dates and places', () => {
    const items = orderAssignedItems(order(), 5278, CATALOG, ...ALL)
    expect(items.map((i) => [i.key, i.day, i.side])).toEqual([
      ['order-assigned:600123:PACK', '2026-11-02', 'origin'],
      ['order-assigned:600123:LOAD', '2026-11-03', 'origin'],
      ['order-assigned:600123:RDEL', '2026-11-10', 'destination'],
    ])
    const [pack, , del] = items
    expect(pack).toMatchObject({
      source: { kind: 'order-assigned', orderNum: 600123, actCode: 'PACK' },
      actName: 'Pack',
      known: true,
      shipperName: 'Smith',
      place: { street: '1 ORIGIN ST', city: 'TORONTO' },
      tripId: null,
      estimated: null,
      drivers: { longhaul: [5278], local: [] },
    })
    // Destination street is consignee_name1/2 (#569).
    expect(del?.place).toMatchObject({ street: '9 DEST AVE', unit: 'UNIT 4', city: 'CALGARY' })
    expect(del?.plannedEnd).toBe('2026-11-12')
  })

  it('puts a done act on its actual day', () => {
    const items = orderAssignedItems(
      order({ load_actual: '2026-11-04T00:00:00.000Z' }),
      5278,
      CATALOG,
      ...ALL,
    )
    expect(items.find((i) => i.actCode === 'LOAD')).toMatchObject({
      day: '2026-11-04',
      actual: '2026-11-04',
      plannedStart: '2026-11-03',
    })
  })

  it('keeps only the acts inside the range (the order matched on any one of them)', () => {
    const items = orderAssignedItems(order(), 5278, CATALOG, '2026-11-09', '2026-11-15')
    expect(items.map((i) => i.actCode)).toEqual(['RDEL'])
  })

  it('swaps LOAD for a dock pickup and drops PACK under rule 19', () => {
    const items = orderAssignedItems(
      order({ rule19_id: 7, rule19_out_date: '2026-11-05T00:00:00.000Z' }),
      5278,
      CATALOG,
      ...ALL,
    )
    expect(items.map((i) => [i.actCode, i.day, i.known, i.place])).toEqual([
      ['R19O', '2026-11-05', false, null],
      ['RDEL', '2026-11-10', true, expect.objectContaining({ street: '9 DEST AVE' })],
    ])
  })

  it('makes only the acts the order has dates for', () => {
    const items = orderAssignedItems(
      order({ pack_date2: null, plan_pack: null }),
      5278,
      CATALOG,
      ...ALL,
    )
    expect(items.map((i) => i.actCode)).toEqual(['LOAD', 'RDEL'])
  })
})
