import { describe, it, expect } from 'vitest'

import {
  LONGHAUL_SHIPMENT_VIEW_COLUMNS,
  type LonghaulShipmentRow,
  type LonghaulShipmentViewColumn,
} from '../index'

describe('LONGHAUL_SHIPMENT_VIEW_COLUMNS', () => {
  it('has the 91 columns the view projects', () => {
    expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).toHaveLength(91)
  })

  it('has no duplicates', () => {
    // A duplicate here would quietly weaken the collision check that callers run
    // against this list.
    expect(new Set(LONGHAUL_SHIPMENT_VIEW_COLUMNS).size).toBe(LONGHAUL_SHIPMENT_VIEW_COLUMNS.length)
  })

  it('carries the columns the four shipped bugs were about', () => {
    // Each pair is (what a ported accessor read) → (the real column). The
    // right-hand side must be on the view; the left-hand side must not be a
    // column at all, or the bug would not have been a bug.
    const real = ['consignee_name1', 'consignee_name2', 'last_name', 'idc_break', 'driver2_id']
    const notColumns = ['OpsLastName', 'supervip', 'storage_driver_id', 'del_address2']

    for (const col of real) {
      expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).toContain(col)
    }
    for (const name of notColumns) {
      expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).not.toContain(name)
    }
  })

  it('does not contain the shadow aliases, so they cannot collide with `s.*`', () => {
    // shipments-list.ts adds these alongside `SELECT s.*`. If the view ever
    // gains a column of one of these names, the mssql driver starts returning an
    // array for that key (see #575) and this test is the tripwire.
    for (const alias of ['shadow_weight', 'shadow_comments', 'operations_name']) {
      expect(LONGHAUL_SHIPMENT_VIEW_COLUMNS).not.toContain(alias)
    }
  })
})

describe('LonghaulShipmentRow', () => {
  it('accepts a partial row of view columns plus the enrichment keys', () => {
    // The real prod row for order 489808, trimmed — the one that exercised all
    // four bugs at once.
    const row: LonghaulShipmentRow = {
      order_num: 489808,
      shipper_add1: '2230 PLYMOUTH RD',
      shipper_add2: '',
      consignee_name1: 'LARKSPUR POINTE APARTMENTS',
      consignee_name2: '10205 VANDA STREET',
      last_name: 'POBUTA',
      idc_break: 'N',
      driver2_id: null,
      activities: [],
      extraActivities: [],
      operations_name: 'SABRINA POBUTA',
      pegasus_shadow: { weight: 5000, lng_dis_comments: null },
      stateIdx: 0,
    }

    expect(row.shipper_add1).toBe('2230 PLYMOUTH RD')
    expect(row.pegasus_shadow?.weight).toBe(5000)
  })

  it('rejects WRITING a key that is not a column', () => {
    // The four names the shipped bugs read. Each must be an excess-property
    // error — and because every real column is optional, an excess key is the
    // ONLY thing these literals can be wrong about, so the directives cannot
    // pass for the wrong reason. If the row type ever grows an index signature,
    // these become unused directives and the build fails.
    // @ts-expect-error - `OpsLastName` is a legacy entity alias for last_name
    const a: LonghaulShipmentRow = { OpsLastName: 'POBUTA' }
    // @ts-expect-error - `supervip` is a legacy entity alias for idc_break
    const b: LonghaulShipmentRow = { supervip: 'Y' }
    // @ts-expect-error - `storage_driver_id` is not a column; driver2_id is
    const c: LonghaulShipmentRow = { storage_driver_id: 7 }
    // @ts-expect-error - `del_address2` has never existed on the view
    const d: LonghaulShipmentRow = { del_address2: 'Suite 4' }

    expect([a, b, c, d]).toHaveLength(4)
  })

  it('rejects READING a key that is not a column', () => {
    // This is the direction that actually bit us: the pane read these off an
    // `any` row and rendered the resulting undefined as an empty cell.
    const row: LonghaulShipmentRow = { order_num: 489808 }

    // @ts-expect-error - #570: really `last_name`
    expect(row.OpsLastName).toBeUndefined()
    // @ts-expect-error - #571: really `idc_break`
    expect(row.supervip).toBeUndefined()
    // @ts-expect-error - the SIT indicator bug: really `driver2_id`
    expect(row.storage_driver_id).toBeUndefined()
    // @ts-expect-error - #569: destination street is consignee_name1/2
    expect(row.del_address2).toBeUndefined()
  })

  it('types a column name as a member of the manifest', () => {
    const col: LonghaulShipmentViewColumn = 'shipper_add1'
    // @ts-expect-error - not a column on the view
    const bad: LonghaulShipmentViewColumn = 'OpsLastName'

    expect([col, bad]).toHaveLength(2)
  })
})
