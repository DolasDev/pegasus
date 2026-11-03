// ---------------------------------------------------------------------------
// Driver itinerary — the third source: work assigned on the ORDER
// (`sales.driver_id`), for orders that have no longhaul activity rows.
//
// QMM and RVS never write LongDistanceDispatchActivity, so for them the order's
// own driver is the only record of the longhaul driver; NW has a few hundred
// such orders too (audit, plans/completed/*-order-assigned-source.md). The rule
// (Steve, 2026-11-03) — an order is order-assigned to longhaul driver D when:
//
//   1. it has NO LongDistanceDispatchActivity rows (where it has them, the
//      activities are the record and sales.driver_id is at best a copy);
//   2. sales.driver_id is not a copy of a local job's driver on the order.
//      TriggerLocalDispatchUpdate copies a confirmed job's driver_id1 (crew
//      space) into sales.driver_id — this is the ONE deliberate comparison
//      across the two numbering spaces, and it exists to detect that copy;
//   3. sales.driver_name names D: it is a copy of the longhaul driver's name
//      (`LAST, FIRST # phone` vs the view's `LAST, FIRST` / `LAST, FIRST (id)`),
//      compared upper-case with spaces removed. Ids collide across the two
//      spaces at NW and QMM, so the name is what says which person this is.
//
// `orderAssignedTo` is the SQL for that rule and is shared by this source and
// the shipment order scope (handlers/longhaul-cloud/shipments-list.ts), so an
// order-assigned item always opens its shipment screen. Read from
// v_longhaul_shipments_v2 (its driver_id / driver_name are sales' own).
//
// The acts are the canonical required acts trip save would create
// (lib/longhaul-build-activities.ts): PACK, LOAD or R19O, RDEL, with the same
// planned dates. READ-ONLY — there is no row to post an ETA against.
// ---------------------------------------------------------------------------

import { buildShipmentActivities } from '../longhaul-build-activities'
import type { ActivityTypeEntry, ItineraryItem, ItineraryPlace, ItinerarySide } from './types'
import { UNKNOWN_SEQUENCE, day, text } from './values'

/** Upper-case, spaces removed, cut at `cut` — the name's comparable core. */
function nameCore(col: string, cut: string): string {
  return (
    `REPLACE(UPPER(CASE WHEN CHARINDEX('${cut}', ISNULL(${col}, '')) > 0` +
    ` THEN LEFT(${col}, CHARINDEX('${cut}', ${col}) - 1) ELSE ISNULL(${col}, '') END), ' ', '')`
  )
}

/**
 * The rule above as a WHERE condition on a `v_longhaul_shipments_v2` row
 * aliased `v`, for the longhaul driver id bound as `param` (e.g. `@lh`).
 * `v` and `param` are code constants, never input.
 */
export function orderAssignedTo(v: string, param: string): string {
  return (
    `(${v}.driver_id = ${param}` +
    ` AND NOT EXISTS (SELECT 1 FROM LongDistanceDispatchActivity oa_a WHERE oa_a.order_num = ${v}.order_num)` +
    // Rule 2 — the deliberate cross-space comparison: detects the trigger's copy.
    ` AND NOT EXISTS (SELECT 1 FROM LocalDispatchJobs oa_j WHERE oa_j.order_num = ${v}.order_num` +
    `   AND (oa_j.driver_id1 = ${v}.driver_id OR oa_j.driver_id2 = ${v}.driver_id))` +
    // A blank name on both sides is not a match: the guard must name someone.
    ` AND ${nameCore(`${v}.driver_name`, ' #')} <> ''` +
    ` AND EXISTS (SELECT 1 FROM v_longhaul_drivers oa_d WHERE oa_d.DRIVER_ID = ${v}.driver_id` +
    `   AND ${nameCore('oa_d.DRIVER_NAME', ' (')} = ${nameCore(`${v}.driver_name`, ' #')}))`
  )
}

/** An act's day: its actual, else its planned date (the view has no estimate). */
const actDay = (actual: string, ...planned: string[]) =>
  `COALESCE(v.${actual}, ${planned.map((p) => `v.${p}`).join(', ')}) BETWEEN @from AND @to`

/**
 * The order-assigned orders with an act in `[@from, @to]`. Destination street
 * is `consignee_name1/2` (#569 — the legacy column names lie).
 */
export function orderAssignedSql(cap: number): string {
  return (
    `SELECT TOP (${cap}) v.order_num, v.shipper_name,` +
    ' v.pack_date2, v.plan_pack, v.pack_actual, v.load_date2, v.plan_load, v.load_actual,' +
    ' v.del_date2, v.plan_del, v.del_actual, v.rule19_id, v.rule19_out_date,' +
    ' v.shipper_add1, v.shipper_add2, v.shipper_city, v.shipper_state, v.shipper_zip,' +
    ' v.consignee_name1, v.consignee_name2, v.consignee_city, v.consignee_state, v.consignee_zip' +
    ' FROM v_longhaul_shipments_v2 v' +
    ` WHERE ${orderAssignedTo('v', '@lh')}` +
    ` AND (${actDay('pack_actual', 'pack_date2', 'plan_pack')}` +
    ` OR ${actDay('load_actual', 'load_date2', 'plan_load')}` +
    ` OR ${actDay('rule19_out_date', 'load_date2', 'plan_load')}` +
    ` OR ${actDay('del_actual', 'del_date2', 'plan_del')})` +
    ' ORDER BY v.order_num'
  )
}

export type OrderAssignedRow = Record<string, unknown> & { order_num: number }

/** Each required act's actual. The view carries no R19O actual. */
const ACTUAL_COLUMN: Record<string, string | undefined> = {
  PACK: 'pack_actual',
  LOAD: 'load_actual',
  RDEL: 'del_actual',
}

/** Sides when the tenant's catalog doesn't say (R19O is a dock pickup). */
const DEFAULT_SIDE: Record<string, ItinerarySide> = {
  PACK: 'origin',
  LOAD: 'origin',
  RDEL: 'destination',
  R19O: 'neither',
}

function placeOf(
  row: OrderAssignedRow,
  cols: [string, string, string, string, string],
): ItineraryPlace | null {
  const [street, unit, city, state, zip] = cols.map((c) => text(row[c]))
  const p = {
    street: street ?? null,
    unit: unit ?? null,
    city: city ?? null,
    state: state ?? null,
    zip: zip ?? null,
  }
  return Object.values(p).some((v) => v !== null) ? p : null
}

function catalogSide(entry: ActivityTypeEntry | undefined, code: string): ItinerarySide {
  if (entry) {
    if (entry.isPerformedAtOrigin && !entry.isPerformedAtDestination) return 'origin'
    if (entry.isPerformedAtDestination && !entry.isPerformedAtOrigin) return 'destination'
    if (entry.isPerformedAtOrigin || entry.isPerformedAtDestination) return 'neither'
  }
  return DEFAULT_SIDE[code] ?? 'neither'
}

/**
 * The items for one order-assigned order, limited to acts whose day falls in
 * `[from, to]` (an order matches the SQL when ANY of its acts does). The
 * driver id is the caller's — the SQL already bound it.
 */
export function orderAssignedItems(
  row: OrderAssignedRow,
  longhaulDriverId: number,
  catalog: ReadonlyMap<string, ActivityTypeEntry>,
  from: string,
  to: string,
): ItineraryItem[] {
  const origin = placeOf(row, [
    'shipper_add1',
    'shipper_add2',
    'shipper_city',
    'shipper_state',
    'shipper_zip',
  ])
  const destination = placeOf(row, [
    'consignee_name1',
    'consignee_name2',
    'consignee_city',
    'consignee_state',
    'consignee_zip',
  ])

  const items: ItineraryItem[] = []
  for (const act of buildShipmentActivities(row)) {
    const code = text(act['ActivityType_code'])?.toUpperCase()
    if (!code) continue
    const plannedStart = day(act['planned_start'])
    const actualCol = ACTUAL_COLUMN[code]
    const actual = actualCol ? day(row[actualCol]) : null
    const itemDay = actual ?? plannedStart
    if (!itemDay || itemDay < from || itemDay > to) continue

    const entry = catalog.get(code)
    const side = catalogSide(entry, code)
    items.push({
      key: `order-assigned:${row.order_num}:${code}`,
      source: { kind: 'order-assigned', orderNum: row.order_num, actCode: code },
      orderNum: row.order_num,
      shipperName: text(row['shipper_name']),
      actCode: code,
      actName: entry?.name ?? entry?.abbreviation ?? code,
      known: entry !== undefined,
      kind: 'act',
      side,
      place: side === 'origin' ? origin : side === 'destination' ? destination : null,
      placeNote: null,
      day: itemDay,
      plannedStart,
      plannedEnd: day(act['planned_end']),
      estimated: null,
      actual,
      arrivalWindow: null,
      committed: false,
      confirmed: false,
      sequence: entry?.sequencePriority ?? UNKNOWN_SEQUENCE,
      tripId: null,
      tripStatus: null,
      drivers: { longhaul: [longhaulDriverId], local: [] },
    })
  }
  return items
}
