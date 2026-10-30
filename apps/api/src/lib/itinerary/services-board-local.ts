// ---------------------------------------------------------------------------
// Local dispatch jobs on the Services board (`GET /activities?include=local`).
//
// The board's unit is one act on one date, which a local job is once its
// `services` string is split — the same split the driver itinerary uses
// (local-job-tokens.ts). This module builds the extra statement and maps each
// token to the board's ActivityRow shape, so the card renders it with no
// branch beyond a "Local" badge where a longhaul row has its trip link.
//
// Filters apply the same way they do to activities:
//   • date range — on `service_date` (a DATE; no time-of-day trap);
//   • short haul / dispatcher — through the same `v_longhaul_shipments_v2`
//     join, so a local-only order that is not in the view drops out when one
//     of them is set (it has no dispatcher or haul mode to match);
//   • office — on the job's own `service_branch_id`, the office sending the
//     crew (what legacy Local Dispatch filters on). It differs from the
//     managing branch on about half of NW/QMM jobs, so this is a choice, not
//     an equivalent of the longhaul rows' order-branch match;
//   • activity type — the board sends ABBREVIATIONS (see activities-list.ts),
//     and a token's abbreviation is only known after the split, so this one is
//     applied in JS.
// ---------------------------------------------------------------------------

import { localJobItems, type LocalJobRow } from './local-job-tokens'
import type { ActivityTypeEntry, OrderPlaces } from './types'
import { text } from './values'

/** Same cap as the activities statement; the merged total is checked by the handler. */
const LOCAL_JOB_ROW_CAP = 1001

export interface LocalBoardFilters {
  date_range?: [string | null, string | null]
  short_haul?: Array<{ value: string }>
  operations_id?: Array<{ value: string }>
  office?: Array<{ value: string }>
  activity_type?: Array<{ value: string }>
}

/**
 * The shipment-view columns the board shows, aliased exactly as
 * activities-list.ts aliases them so a local row has the same keys.
 */
const VIEW_COLUMNS =
  ' s.shipper_name AS shipper_name, s.shipper_city AS origin_city, s.shipper_state AS origin_state,' +
  ' s.consignee_city AS destination_city, s.consignee_state AS destination_state,' +
  ' s.haul_mode AS haul_mode, s.shaul AS shaul, s.operations_id AS operations_id,' +
  ' s.last_name AS dispatcher_last_name, s.total_est_wt AS total_est_wt'

/**
 * The statement, for the handler's batch. `bind` is the handler's param bag,
 * so names never collide with the activities statement's.
 */
export function buildLocalBoardSql(
  filters: LocalBoardFilters,
  bind: (value: unknown) => string,
): string {
  const where = ["ISNULL(j.active, 'Y') <> 'N'"]
  const [from, to] = filters.date_range ?? [null, null]
  if (from) where.push(`j.service_date >= ${bind(from)}`)
  if (to) where.push(`j.service_date <= ${bind(to)}`)
  const shortHaul = (filters.short_haul ?? []).map((v) => v.value).filter(Boolean)
  if (shortHaul.length) where.push(`s.haul_mode IN (${shortHaul.map(bind).join(', ')})`)
  const ops = (filters.operations_id ?? []).map((v) => v.value).filter(Boolean)
  if (ops.length) where.push(`s.operations_id IN (${ops.map(bind).join(', ')})`)
  const offices = (filters.office ?? []).map((v) => v.value).filter(Boolean)
  if (offices.length) where.push(`j.service_branch_id IN (${offices.map(bind).join(', ')})`)

  return (
    `SELECT TOP (${LOCAL_JOB_ROW_CAP}) j.id, j.order_num, j.service_date, j.services,` +
    ' j.active, j.is_final, j.is_confirmed, j.eta_minimum, j.eta_maximum, j.start_time, j.end_time,' +
    ' j.service_at_orig, j.service_at_dest, j.OriginLocation1, j.DestinationLocation1,' +
    ' j.driver_id1, j.driver_id2,' +
    " LTRIM(RTRIM(ISNULL(c1.employee_first, '') + ' ' + ISNULL(c1.employee_last, ''))) AS it_driver1_name," +
    " LTRIM(RTRIM(ISNULL(c2.employee_first, '') + ' ' + ISNULL(c2.employee_last, ''))) AS it_driver2_name," +
    ' so.shipper_name AS it_sales_shipper_name,' +
    ' so.shipper_add1 AS it_origin_street, so.shipper_add2 AS it_origin_unit,' +
    ' so.shipper_city AS it_origin_city, so.shipper_state AS it_origin_state,' +
    ' so.shipper_zip AS it_origin_zip,' +
    ' so.consignee_name1 AS it_dest_street, so.consignee_name2 AS it_dest_unit,' +
    ' so.consignee_city AS it_dest_city, so.consignee_state AS it_dest_state,' +
    ' so.consignee_zip AS it_dest_zip,' +
    VIEW_COLUMNS +
    ' FROM LocalDispatchJobs j' +
    // `crews.employee_id` is unique per tenant by convention only; TOP 1 keeps
    // a duplicate from multiplying the job.
    ' OUTER APPLY (SELECT TOP 1 c.employee_first, c.employee_last FROM crews c' +
    '   WHERE c.employee_id = j.driver_id1 AND j.driver_id1 <> 0) c1' +
    ' OUTER APPLY (SELECT TOP 1 c.employee_first, c.employee_last FROM crews c' +
    '   WHERE c.employee_id = j.driver_id2 AND j.driver_id2 <> 0) c2' +
    ' OUTER APPLY (SELECT TOP 1 x.shipper_name, x.shipper_add1, x.shipper_add2, x.shipper_city,' +
    '   x.shipper_state, x.shipper_zip, x.consignee_name1, x.consignee_name2, x.consignee_city,' +
    '   x.consignee_state, x.consignee_zip FROM sales x WHERE x.order_num = j.order_num) so' +
    ' LEFT JOIN v_longhaul_shipments_v2 AS s ON j.order_num = s.order_num' +
    ` WHERE ${where.join(' AND ')}` +
    ' ORDER BY j.service_date, j.id'
  )
}

type Row = Record<string, unknown>

function place(row: Row, prefix: 'it_origin' | 'it_dest') {
  const p = {
    street: text(row[`${prefix}_street`]),
    unit: text(row[`${prefix}_unit`]),
    city: text(row[`${prefix}_city`]),
    state: text(row[`${prefix}_state`]),
    zip: text(row[`${prefix}_zip`]),
  }
  return Object.values(p).some((v) => v !== null) ? p : null
}

function status(row: Row): string | null {
  const final = text(row['is_final'])?.toUpperCase() === 'Y'
  if (final) return 'Final'
  return text(row['is_confirmed'])?.toUpperCase() === 'Y' ? 'Confirmed' : null
}

/**
 * Board rows for the local jobs `rows` holds, one per distinct token, with the
 * activity-type filter applied. Keys match activities-list's projection, plus
 * `row_key` and `source`, which every board row carries.
 */
export function localBoardRows(
  rows: unknown[],
  catalog: ReadonlyMap<string, ActivityTypeEntry>,
  filters: LocalBoardFilters,
): Row[] {
  const wanted = new Set((filters.activity_type ?? []).map((t) => t.value).filter(Boolean))
  const out: Row[] = []
  for (const row of rows as Array<LocalJobRow & Row>) {
    const places: OrderPlaces = {
      shipperName: text(row['shipper_name']) ?? text(row['it_sales_shipper_name']),
      origin: place(row, 'it_origin'),
      destination: place(row, 'it_dest'),
    }
    const driverName =
      [text(row['it_driver1_name']), text(row['it_driver2_name'])]
        .filter((n): n is string => n !== null)
        .join(' / ') || null
    for (const item of localJobItems(row, places, catalog)) {
      const abbreviation =
        (item.actCode !== null ? catalog.get(item.actCode)?.abbreviation : null) ??
        item.actCode ??
        item.actName
      if (wanted.size > 0 && !wanted.has(abbreviation)) continue
      // The executor's DATE serialization, so the card's date formatting and
      // the merged sort treat both sources alike.
      const scheduled = `${item.day}T00:00:00.000Z`
      out.push({
        row_key: item.key,
        source: 'local',
        id: row.id,
        order_num: item.orderNum,
        TripMaster_id: null,
        ActivityType_code: item.actCode,
        estimated_date: null,
        actual_date: item.actual ? `${item.actual}T00:00:00.000Z` : null,
        planned_start: scheduled,
        planned_end: scheduled,
        scheduled_date: scheduled,
        status: status(row),
        street: item.place?.street ?? null,
        unit: item.place?.unit ?? null,
        city: item.place?.city ?? null,
        state: item.place?.state ?? null,
        zip: item.place?.zip ?? null,
        is_active: null,
        is_confirmed: item.confirmed,
        is_committed: false,
        assigned_driver_id: null,
        assigned_agent_code: null,
        activity_type_name: item.actName,
        activity_type_abbreviation: abbreviation,
        driver_name: driverName,
        shipper_name: item.shipperName,
        origin_city: row['origin_city'] ?? places.origin?.city ?? null,
        origin_state: row['origin_state'] ?? places.origin?.state ?? null,
        destination_city: row['destination_city'] ?? places.destination?.city ?? null,
        destination_state: row['destination_state'] ?? places.destination?.state ?? null,
        haul_mode: row['haul_mode'] ?? null,
        shaul: row['shaul'] ?? null,
        operations_id: row['operations_id'] ?? null,
        dispatcher_last_name: row['dispatcher_last_name'] ?? null,
        total_est_wt: row['total_est_wt'] ?? null,
      })
    }
  }
  return out
}

/**
 * Board sort keys → the row field each sorts on. Must cover activities-list's
 * SORTABLE_COLUMNS exactly (a test pins it to ACTIVITY_SORT_KEYS).
 */
export const BOARD_SORT_FIELDS: Record<string, string> = {
  scheduled_date: 'scheduled_date',
  actual_date: 'actual_date',
  activity_type: 'activity_type_abbreviation',
  order_num: 'order_num',
  status: 'status',
  driver_name: 'driver_name',
  city: 'city',
  state: 'state',
  shipper_name: 'shipper_name',
  dispatcher: 'dispatcher_last_name',
}

function compareValues(a: unknown, b: unknown): number {
  // SQL Server puts NULL first in ASC; so does this, to match a longhaul-only board.
  if (a == null || a === '') return b == null || b === '' ? 0 : -1
  if (b == null || b === '') return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a).trim().toLowerCase()
  const sb = String(b).trim().toLowerCase()
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/**
 * Sort the merged board the way the SQL sorts a longhaul-only one: the
 * requested key (default the scheduled date), ascending unless `desc`, with
 * longhaul before local and then `id` as tie-breaks so the order is total.
 */
export function sortBoardRows(rows: Row[], sortBy?: { value?: string; order?: string }): Row[] {
  // Object.hasOwn, not a bare index — the activities-list (#736) guard.
  const requested = sortBy?.value
  const known = typeof requested === 'string' && Object.hasOwn(BOARD_SORT_FIELDS, requested)
  const field = known ? BOARD_SORT_FIELDS[requested]! : 'scheduled_date'
  // As in SQL: `desc` applies only to a whitelisted key; the default is ascending.
  const dir = known && sortBy?.order === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const primary = compareValues(a[field], b[field]) * dir
    if (primary !== 0) return primary
    if (a['source'] !== b['source']) return a['source'] === 'local' ? 1 : -1
    return compareValues(a['id'], b['id'])
  })
}
