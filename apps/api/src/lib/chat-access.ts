// ---------------------------------------------------------------------------
// Move chat — reads against the tenant's legacy (pegII) database.
//
// Who may read a move's chat is decided here for driver-scoped callers (D1/D2
// in plans/in-progress/move-chat-api.md). Employees read every room and never
// reach this file's access checks.
//
// A driver may read an order when EITHER:
//   • longhaul — an activity on it is assigned to them, or sits on a trip they
//     drive: the same EXISTS the driver-scoped shipments list uses
//     (handlers/longhaul-cloud/shipments-list.ts); or
//   • local — an active local dispatch job for it names them in a DRIVER slot
//     (`LocalDispatchJobs.driver_id1/2`, holding crews.employee_id). Helper
//     slots are deliberately out of scope for now.
//
// The two ids come from the caller's own TenantUser row, set by an admin — the
// cloud principal is the source of authority. They are separate fields because
// the numbering spaces collide on different people at some tenants (GOTCHAS,
// "Crew number ≠ driver number is tenant-specific"). Id 0 means "unassigned"
// in the legacy tables and never matches.
//
// Every check fails CLOSED: a legacy query error denies access.
// ---------------------------------------------------------------------------

import { db } from '../db'
import { executeSql, type SqlParam } from './mssql-executor-client'
import { logger } from './logger'

export interface DriverIds {
  longhaulDriverId: number | null
  localDriverEmployeeId: number | null
}

/** Treats 0 (the legacy "unassigned" driver) like null. */
function usable(id: number | null): id is number {
  return id != null && id !== 0
}

/** The tenant's legacy connection string, or null when none is configured. */
export async function legacyConnectionString(tenantId: string): Promise<string | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  return tenant?.mssqlConnectionString ?? null
}

/**
 * The driver-access predicate for the order named by `orderExpr` (a parameter
 * or a column). Pushes its own params; returns null when the caller maps to no
 * driver at all.
 */
function driverPredicate(orderExpr: string, ids: DriverIds, params: SqlParam[]): string | null {
  const parts: string[] = []
  if (usable(ids.longhaulDriverId)) {
    params.push({ name: 'lh', value: ids.longhaulDriverId })
    parts.push(
      `EXISTS (SELECT 1 FROM LongDistanceDispatchActivity a` +
        ` LEFT JOIN TripMaster t ON a.TripMaster_id = t.id` +
        ` WHERE a.order_num = ${orderExpr}` +
        ` AND (a.assigned_driver_id = @lh OR t.driver_id = @lh))`,
    )
  }
  if (usable(ids.localDriverEmployeeId)) {
    params.push({ name: 'ld', value: ids.localDriverEmployeeId })
    parts.push(
      `EXISTS (SELECT 1 FROM LocalDispatchJobs j` +
        ` WHERE j.order_num = ${orderExpr}` +
        ` AND ISNULL(j.active, 'Y') <> 'N'` +
        ` AND (j.driver_id1 = @ld OR j.driver_id2 = @ld))`,
    )
  }
  return parts.length > 0 ? parts.join(' OR ') : null
}

/** Whether a driver-scoped caller may read (and post in) one order's chat. */
export async function driverCanReadOrder(
  connectionString: string,
  orderNum: number,
  ids: DriverIds,
): Promise<boolean> {
  const params: SqlParam[] = [{ name: 'orderNum', value: orderNum }]
  const predicate = driverPredicate('@orderNum', ids, params)
  if (!predicate) return false
  try {
    const { recordset } = await executeSql(
      connectionString,
      `SELECT CASE WHEN ${predicate} THEN 1 ELSE 0 END AS ok`,
      { params },
    )
    return (recordset[0] as { ok?: number } | undefined)?.ok === 1
  } catch (err) {
    logger.warn('chat driver access check failed; denying', { orderNum, error: String(err) })
    return false
  }
}

/**
 * Of `orderNums`, the ones a driver-scoped caller may read — one round trip,
 * for the inbox (a driver taken off a trip must stop seeing its previews).
 */
export async function driverReadableOrders(
  connectionString: string,
  orderNums: readonly number[],
  ids: DriverIds,
): Promise<Set<number>> {
  if (orderNums.length === 0) return new Set()
  const params: SqlParam[] = []
  const predicate = driverPredicate('o.order_num', ids, params)
  if (!predicate) return new Set()
  const values = orderNums.map((n, i) => {
    params.push({ name: `o${i}`, value: n })
    return `(@o${i})`
  })
  try {
    const { recordset } = await executeSql(
      connectionString,
      `SELECT o.order_num FROM (VALUES ${values.join(', ')}) AS o(order_num) WHERE ${predicate}`,
      { params },
    )
    return new Set((recordset as Array<{ order_num: number }>).map((r) => r.order_num))
  } catch (err) {
    logger.warn('chat driver order-set check failed; denying', { error: String(err) })
    return new Set()
  }
}

function uniqueIds(values: unknown[]): number[] {
  const out = new Set<number>()
  for (const v of values) if (typeof v === 'number' && v !== 0) out.add(v)
  return [...out]
}

/**
 * The legacy driver ids currently assigned to an order — longhaul and local —
 * for the push fan-out. Each side is read independently and soft-fails to
 * empty, so a tenant without one of the tables still notifies the other side.
 */
export async function assignedDriverIds(
  connectionString: string,
  orderNum: number,
): Promise<{ longhaul: number[]; local: number[] }> {
  const params: SqlParam[] = [{ name: 'orderNum', value: orderNum }]
  const soft = (what: string) => (err: unknown) => {
    logger.warn('chat assigned-driver lookup failed; treating as none', {
      what,
      orderNum,
      error: String(err),
    })
    return { recordset: [] as unknown[] }
  }
  const [lh, local] = await Promise.all([
    executeSql(
      connectionString,
      `SELECT a.assigned_driver_id, t.driver_id AS trip_driver_id` +
        ` FROM LongDistanceDispatchActivity a` +
        ` LEFT JOIN TripMaster t ON a.TripMaster_id = t.id` +
        ` WHERE a.order_num = @orderNum`,
      { params },
    ).catch(soft('longhaul')),
    executeSql(
      connectionString,
      `SELECT j.driver_id1, j.driver_id2 FROM LocalDispatchJobs j` +
        ` WHERE j.order_num = @orderNum AND ISNULL(j.active, 'Y') <> 'N'`,
      { params },
    ).catch(soft('local')),
  ])
  const lhRows = lh.recordset as Array<{ assigned_driver_id: unknown; trip_driver_id: unknown }>
  const localRows = local.recordset as Array<{ driver_id1: unknown; driver_id2: unknown }>
  return {
    longhaul: uniqueIds(lhRows.flatMap((r) => [r.assigned_driver_id, r.trip_driver_id])),
    local: uniqueIds(localRows.flatMap((r) => [r.driver_id1, r.driver_id2])),
  }
}

/** Whether `order_num` exists — checked before the first post creates a room. */
export async function orderExists(connectionString: string, orderNum: number): Promise<boolean> {
  const { recordset } = await executeSql(
    connectionString,
    'SELECT TOP (1) 1 AS one FROM sales WHERE order_num = @orderNum',
    { params: [{ name: 'orderNum', value: orderNum }] },
  )
  return recordset.length > 0
}

export interface LocalDriverOption {
  employeeId: number
  name: string
}

/**
 * Active local drivers (the desktop's "Local Drivers" crew filter), for the
 * Settings → Users mapping picker.
 */
export async function listLocalDrivers(connectionString: string): Promise<LocalDriverOption[]> {
  const { recordset } = await executeSql(
    connectionString,
    `SELECT employee_id, LTRIM(RTRIM(ISNULL(employee_first, ''))) AS first,` +
      ` LTRIM(RTRIM(ISNULL(employee_last, ''))) AS last` +
      ` FROM crews WHERE active = 'Y' AND is_local_drv = 'Y' AND employee_id > 0` +
      ` ORDER BY employee_last, employee_first`,
  )
  return (recordset as Array<{ employee_id: number; first: string; last: string }>).map((r) => ({
    employeeId: r.employee_id,
    name: r.first ? `${r.last}, ${r.first}` : r.last,
  }))
}

export interface OrderSummary {
  orderNum: number
  shipperName: string | null
  origin: string | null
  destination: string | null
  packDate: string | null
  loadDate: string | null
  deliveryDate: string | null
}

function cityState(city: unknown, state: unknown): string | null {
  const parts = [city, state]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)
  return parts.length > 0 ? parts.join(', ') : null
}

function trimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/** A legacy date column as `YYYY-MM-DD` (they are calendar dates, not instants). */
function dateOnly(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}

/**
 * Header details for a batch of orders, from `sales` — one round trip, for the
 * chat page's conversation list and room header. Not the longhaul shipments
 * view: local-only orders aren't in it, and chat's employee scope is wider
 * than the longhaul read scope.
 *
 * Dates are the PLANNED ones (`pack_date`/`load_date`/`del_date` — the desktop
 * labels them "Pack Planned" etc. in IO_Sale.vb; the `*_date2` columns are the
 * "Earliest" dates the longhaul screens show as the start of a window).
 *
 * Pass `driver` for a driver-scoped caller: orders they can't read are left
 * out, in the same query. Throws on a legacy failure (the caller decides how
 * to degrade); a driver with no mapped ids gets nothing.
 */
export async function orderSummaries(
  connectionString: string,
  orderNums: readonly number[],
  driver: DriverIds | null,
): Promise<OrderSummary[]> {
  if (orderNums.length === 0) return []
  const params: SqlParam[] = []
  let access = ''
  if (driver) {
    const predicate = driverPredicate('s.order_num', driver, params)
    if (!predicate) return []
    access = ` AND (${predicate})`
  }
  const placeholders = orderNums.map((n, i) => {
    params.push({ name: `o${i}`, value: n })
    return `@o${i}`
  })
  const { recordset } = await executeSql(
    connectionString,
    `SELECT s.order_num, s.shipper_name, s.shipper_city, s.shipper_state,` +
      ` s.consignee_city, s.consignee_state, s.pack_date, s.load_date, s.del_date` +
      ` FROM sales s WHERE s.order_num IN (${placeholders.join(', ')})${access}`,
    { params },
  )
  // `sales` is 1:1 with an order by convention only; keep the first row.
  const byOrder = new Map<number, OrderSummary>()
  for (const r of recordset as Array<Record<string, unknown>>) {
    const orderNum = Number(r['order_num'])
    if (!Number.isInteger(orderNum) || byOrder.has(orderNum)) continue
    byOrder.set(orderNum, {
      orderNum,
      shipperName: trimmed(r['shipper_name']),
      origin: cityState(r['shipper_city'], r['shipper_state']),
      destination: cityState(r['consignee_city'], r['consignee_state']),
      packDate: dateOnly(r['pack_date']),
      loadDate: dateOnly(r['load_date']),
      deliveryDate: dateOnly(r['del_date']),
    })
  }
  return [...byOrder.values()]
}
