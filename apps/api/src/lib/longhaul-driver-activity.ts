// ---------------------------------------------------------------------------
// Driver ownership of legacy longhaul activities.
//
// One rule, shared by every driver-scoped activity surface (the ETA write and
// activity labor): the activity's assigned driver wins when set; an unassigned
// activity belongs to its trip's driver. Driver 0 is the legacy "unassigned"
// placeholder and never matches.
// ---------------------------------------------------------------------------

import { executeSql } from './mssql-executor-client'

/**
 * A real driver id, or null. `v_longhaul_drivers` carries a placeholder driver
 * 0 (other queries exclude it with `driver_id <> 0`), so 0 means "unassigned"
 * on an activity or trip — and must never match a login mapped to 0.
 */
export function realDriverId(id: number | null | undefined): number | null {
  return id == null || id === 0 ? null : id
}

/** The driver an activity belongs to, or null when nobody is on it. */
export function activityOwnerDriverId(row: {
  assigned_driver_id: number | null
  trip_driver_id: number | null
}): number | null {
  return realDriverId(row.assigned_driver_id) ?? realDriverId(row.trip_driver_id)
}

/** An activity as the labor surfaces read it. */
export interface DriverActivityRow {
  id: number
  order_num: number
  ActivityType_code: string | null
  activityType_name: string | null
  activityType_abbreviation: string | null
  planned_start: Date | string | null
  estimated_date: Date | string | null
  actual_date: Date | string | null
  assigned_driver_id: number | null
  trip_driver_id: number | null
}

const ACTIVITY_SELECT = `
SELECT a.id,
       a.order_num,
       a.ActivityType_code,
       at.name AS activityType_name,
       at.abbreviation AS activityType_abbreviation,
       a.planned_start,
       a.estimated_date,
       a.actual_date,
       a.assigned_driver_id,
       t.driver_id AS trip_driver_id
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
LEFT JOIN TripMaster t ON a.TripMaster_id = t.id`

/** Every activity on an order, in schedule order. Throws on a legacy error. */
export async function orderActivities(
  connectionString: string,
  orderNum: number,
): Promise<DriverActivityRow[]> {
  const { recordset } = await executeSql(
    connectionString,
    `${ACTIVITY_SELECT}
WHERE a.order_num = @orderNum
ORDER BY COALESCE(a.estimated_date, a.planned_start), a.id`,
    { params: [{ name: 'orderNum', value: orderNum }] },
  )
  return recordset as DriverActivityRow[]
}

/** One activity, or null. Throws on a legacy error. */
export async function activityById(
  connectionString: string,
  id: number,
): Promise<DriverActivityRow | null> {
  const { recordset } = await executeSql(connectionString, `${ACTIVITY_SELECT}\nWHERE a.id = @id`, {
    params: [{ name: 'id', value: id }],
  })
  return (recordset[0] as DriverActivityRow | undefined) ?? null
}

/** Every activity on a trip, in schedule order. Throws on a legacy error. */
export async function tripActivities(
  connectionString: string,
  tripId: number,
): Promise<DriverActivityRow[]> {
  const { recordset } = await executeSql(
    connectionString,
    `${ACTIVITY_SELECT}
WHERE a.TripMaster_id = @tripId
ORDER BY COALESCE(a.estimated_date, a.planned_start), a.id`,
    { params: [{ name: 'tripId', value: tripId }] },
  )
  return recordset as DriverActivityRow[]
}
