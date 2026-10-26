// ---------------------------------------------------------------------------
// Driver itinerary — the legacy reads.
//
// ONE executor round trip in the common case: the catalog, the driver's
// longhaul activities and their local jobs go as one multi-statement batch and
// come back as `recordsets`. Every executor call holds a Lambda slot, and both
// accounts cap concurrency at 10 (project memory, "Lambda concurrency throttle
// = 10"), so three parallel invokes per screen load is a cost worth avoiding.
//
// If the batch fails, each statement is re-run on its own so one bad source
// (a tenant missing a table) degrades to "that source failed" instead of an
// empty itinerary. The response says which sources failed.
//
// Ownership rules, each in its own numbering space (GOTCHAS, "Crew number ≠
// driver number is tenant-specific") — the two ids are bound separately and
// never compared across:
//   • longhaul — the ETA editor's owner: assigned driver, else the trip driver
//     when the activity is unassigned (lib/longhaul-driver-activity.ts);
//   • local — either driver slot on an active job (chat-access.ts's rule;
//     helper slots are out of scope, as there).
//
// READ-ONLY. Explicit columns everywhere except `a.*`, which is how activity
// readers tolerate the lazily-provisioned arrival-window columns
// (lib/longhaul-arrival-window-schema.ts); the joined extras carry an `it_`
// prefix so no output name can repeat (#575). No FOR JSON (#629/#634).
// ---------------------------------------------------------------------------

import { executeSql, type SqlParam } from '../mssql-executor-client'
import { logger } from '../logger'
import { localJobItems, type LocalJobRow } from './local-job-tokens'
import { longhaulActivityItem, type LonghaulActivityRow } from './longhaul-activity-rows'
import type { ActivityTypeEntry, ItineraryItem, OrderPlaces } from './types'
import { flag, realId, text } from './values'

/** Per source. One driver over the longest range the API allows is far below it. */
export const ITINERARY_ROW_CAP = 1000

export type ItinerarySourceName = 'longhaul' | 'local'

export interface ItineraryQuery {
  /** Inclusive `YYYY-MM-DD` bounds. */
  from: string
  to: string
  longhaulDriverId: number | null
  localDriverEmployeeId: number | null
}

export interface ItineraryResult {
  items: ItineraryItem[]
  /** Sources that could not be read; their items are absent, not empty. */
  failed: ItinerarySourceName[]
  /** Sources that hit ITINERARY_ROW_CAP — the caller turns this into a 400. */
  overCap: ItinerarySourceName[]
}

/** The activity's day — the same rule longhaulActivityItem applies. */
const ACTIVITY_DAY = 'COALESCE(a.actual_date, a.estimated_date, a.planned_start)'

export const CATALOG_SQL =
  'SELECT code, name, abbreviation, isPerformedAtOrigin, isPerformedAtDestination, sequencePriority' +
  ' FROM Longhaul_ActivityType'

const ACTIVITIES_SQL =
  `SELECT TOP (${ITINERARY_ROW_CAP + 1}) a.*,` +
  ' t.driver_id AS trip_driver_id, ts.status AS it_trip_status,' +
  ' at.name AS it_type_name, at.abbreviation AS it_type_abbreviation,' +
  ' at.isPerformedAtOrigin AS it_type_at_origin, at.isPerformedAtDestination AS it_type_at_destination,' +
  ' at.sequencePriority AS it_type_sequence,' +
  ' so.shipper_name AS it_shipper_name' +
  ' FROM LongDistanceDispatchActivity a' +
  ' LEFT JOIN TripMaster t ON a.TripMaster_id = t.id' +
  ' LEFT JOIN MasterTripStatus ts ON t.TripStatus_id = ts.status_id' +
  ' LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code' +
  // `sales` is 1:1 with an order by convention only — TOP 1 so a stray
  // duplicate can't duplicate the activity.
  ' OUTER APPLY (SELECT TOP 1 s.shipper_name FROM sales s WHERE s.order_num = a.order_num) so' +
  ' WHERE (a.assigned_driver_id = @lh' +
  '   OR (ISNULL(a.assigned_driver_id, 0) = 0 AND t.driver_id = @lh))' +
  // The trips the driver app shows (mobile tripService.isVisibleTrip): not a
  // Pending trip still being planned, not a cancelled one. An Offered trip IS
  // shown — the item carries `tripStatus` so the client can mark it.
  " AND (t.id IS NULL OR (LOWER(LTRIM(RTRIM(ISNULL(ts.status, '')))) <> 'pending'" +
  "   AND LOWER(LTRIM(RTRIM(ISNULL(t.internal_status, '')))) <> 'canceled'))" +
  // Upper bound is `< @to + 1 day`: pre-#534 rows carry times like 05:00.
  ` AND ${ACTIVITY_DAY} >= @from AND ${ACTIVITY_DAY} < DATEADD(day, 1, @to)` +
  ` ORDER BY ${ACTIVITY_DAY}, a.id`

/**
 * Destination street is `consignee_name1/2` — the legacy column names lie
 * (#569; LoHiConverters_Sale.vb maps HomeAddress.StreetAddress from it).
 */
const LOCAL_JOBS_SQL =
  `SELECT TOP (${ITINERARY_ROW_CAP + 1}) j.id, j.order_num, j.service_date, j.services,` +
  ' j.active, j.is_final, j.is_confirmed, j.eta_minimum, j.eta_maximum,' +
  ' j.service_at_orig, j.service_at_dest, j.OriginLocation1, j.DestinationLocation1,' +
  ' j.driver_id1, j.driver_id2,' +
  ' so.shipper_name AS it_shipper_name,' +
  ' so.shipper_add1 AS it_origin_street, so.shipper_add2 AS it_origin_unit,' +
  ' so.shipper_city AS it_origin_city, so.shipper_state AS it_origin_state,' +
  ' so.shipper_zip AS it_origin_zip,' +
  ' so.consignee_name1 AS it_dest_street, so.consignee_name2 AS it_dest_unit,' +
  ' so.consignee_city AS it_dest_city, so.consignee_state AS it_dest_state,' +
  ' so.consignee_zip AS it_dest_zip' +
  ' FROM LocalDispatchJobs j' +
  ' OUTER APPLY (SELECT TOP 1 s.shipper_name, s.shipper_add1, s.shipper_add2, s.shipper_city,' +
  '   s.shipper_state, s.shipper_zip, s.consignee_name1, s.consignee_name2, s.consignee_city,' +
  '   s.consignee_state, s.consignee_zip FROM sales s WHERE s.order_num = j.order_num) so' +
  " WHERE ISNULL(j.active, 'Y') <> 'N'" +
  ' AND (j.driver_id1 = @ld OR j.driver_id2 = @ld)' +
  ' AND j.service_date >= @from AND j.service_date <= @to' +
  ' ORDER BY j.service_date, j.id'

type LocalJobWithOrder = LocalJobRow & Record<string, unknown>

function place(row: Record<string, unknown>, prefix: 'it_origin' | 'it_dest') {
  const p = {
    street: text(row[`${prefix}_street`]),
    unit: text(row[`${prefix}_unit`]),
    city: text(row[`${prefix}_city`]),
    state: text(row[`${prefix}_state`]),
    zip: text(row[`${prefix}_zip`]),
  }
  return Object.values(p).some((v) => v !== null) ? p : null
}

function orderPlaces(row: LocalJobWithOrder): OrderPlaces {
  return {
    shipperName: text(row['it_shipper_name']),
    origin: place(row, 'it_origin'),
    destination: place(row, 'it_dest'),
  }
}

export function catalogFrom(rows: unknown[]): Map<string, ActivityTypeEntry> {
  const out = new Map<string, ActivityTypeEntry>()
  for (const r of rows as Array<Record<string, unknown>>) {
    const code = text(r['code'])?.toUpperCase()
    if (!code) continue
    const seq = Number(r['sequencePriority'])
    out.set(code, {
      code,
      name: text(r['name']),
      abbreviation: text(r['abbreviation']),
      isPerformedAtOrigin: flag(r['isPerformedAtOrigin']),
      isPerformedAtDestination: flag(r['isPerformedAtDestination']),
      sequencePriority: r['sequencePriority'] != null && Number.isFinite(seq) ? seq : null,
    })
  }
  return out
}

interface Statement {
  name: 'catalog' | ItinerarySourceName
  sql: string
}

/**
 * Run the statements as one batch; on failure, one at a time so a single bad
 * source is isolated. Returns each statement's rows, or null where it failed.
 */
async function runBatch(
  connectionString: string,
  statements: Statement[],
  params: SqlParam[],
): Promise<Map<Statement['name'], unknown[] | null>> {
  const out = new Map<Statement['name'], unknown[] | null>()
  try {
    const { recordsets } = await executeSql(
      connectionString,
      statements.map((s) => s.sql).join(';\n'),
      { params },
    )
    statements.forEach((s, i) => out.set(s.name, recordsets[i] ?? []))
    return out
  } catch (err) {
    logger.warn('itinerary batch failed; retrying per source', { error: String(err) })
  }
  for (const s of statements) {
    try {
      const { recordset } = await executeSql(connectionString, s.sql, { params })
      out.set(s.name, recordset)
    } catch (err) {
      logger.warn('itinerary source failed', { source: s.name, error: String(err) })
      out.set(s.name, null)
    }
  }
  return out
}

/**
 * Order the merged list top to bottom the way a day is worked: by day, then by
 * act sequence (pack before load before deliver), then order. Trips are NOT a
 * sort key — a local 8 am PACK must not sink under a longhaul RDEL just for
 * being trip-less; grouping by trip is the client's chip. Ties keep their input
 * order (the sort is stable, and the SQL and the token split are both
 * deterministic), so two unsequenced tokens stay in the order they were typed.
 */
export function compareItems(a: ItineraryItem, b: ItineraryItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.sequence !== b.sequence) return a.sequence - b.sequence
  return a.orderNum - b.orderNum
}

/** A driver's itinerary over `[from, to]`, both sources merged. */
export async function fetchItinerary(
  connectionString: string,
  q: ItineraryQuery,
): Promise<ItineraryResult> {
  const lh = realId(q.longhaulDriverId)
  const ld = realId(q.localDriverEmployeeId)
  const result: ItineraryResult = { items: [], failed: [], overCap: [] }
  if (lh === null && ld === null) return result

  const params: SqlParam[] = [
    { name: 'from', value: q.from },
    { name: 'to', value: q.to },
  ]
  const statements: Statement[] = []
  if (lh !== null) {
    params.push({ name: 'lh', value: lh })
    statements.push({ name: 'longhaul', sql: ACTIVITIES_SQL })
  }
  if (ld !== null) {
    params.push({ name: 'ld', value: ld })
    // The catalog names and sequences local tokens; activities join it in SQL.
    statements.push({ name: 'catalog', sql: CATALOG_SQL }, { name: 'local', sql: LOCAL_JOBS_SQL })
  }

  const rows = await runBatch(connectionString, statements, params)

  const activityRows = rows.get('longhaul')
  if (lh !== null) {
    if (activityRows == null) result.failed.push('longhaul')
    else {
      if (activityRows.length > ITINERARY_ROW_CAP) result.overCap.push('longhaul')
      for (const r of activityRows as LonghaulActivityRow[]) {
        const item = longhaulActivityItem(r)
        if (item) result.items.push(item)
      }
    }
  }

  const jobRows = rows.get('local')
  if (ld !== null) {
    if (jobRows == null) result.failed.push('local')
    else {
      if (jobRows.length > ITINERARY_ROW_CAP) result.overCap.push('local')
      // A failed catalog only costs names and sequences; the jobs still show.
      const catalog = catalogFrom(rows.get('catalog') ?? [])
      for (const r of jobRows as LocalJobWithOrder[]) {
        result.items.push(...localJobItems(r, orderPlaces(r), catalog))
      }
    }
  }

  result.items.sort(compareItems)
  return result
}
