// ---------------------------------------------------------------------------
// Cloud-direct longhaul TRIP SAVE — POST /trips (create) + PUT /trips/:id
// (update). Phase 4 #11, the marquee write: the on-prem proxy made 16-18 MSSQL
// round trips over the WAN; this does TWO (RT1 reads current state, RT2 is one
// atomic batch).
//
// On-prem source: handlers/longhaul/trips.ts saveTripLogic.
//   RT1 (one multi-statement read): existing trip header + activities (updates
//        only, for the diff + driver-change guard) and the shipment summary
//        fields (vip/total_est_wt/line_haul) for the DTO's order_nums.
//   JS:  computeTripSavePlan does the buildShipmentActivities auto-fill +
//        sameSlot add/update/remove diff + guards; computeTripSummary rolls up
//        the final activity set.
//   RT2 (one in-SQL transaction): trip upsert (UPDATE, or INSERT + SCOPE_IDENTITY
//        into @tripId) → dispatcher-change shadow cascade → DELETE removed
//        activities → INSERT added → UPDATE changed → UPDATE TripMaster with the
//        computed summary → COMMIT → trailing SELECT of the saved trip.
//
// Activity inserts use no OUTPUT clause, so the table's enabled triggers don't
// bite. TripMaster has no triggers (the on-prem saveTrip uses plain OUTPUT id).
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError, type SqlParam } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import {
  computeTripSavePlan,
  type ExistingActivity,
  type TripSavePlan,
} from '../../lib/longhaul-trip-save'
import {
  buildStateIdByGeoCode,
  computeTripSummary,
  STATES_SQL,
  SUMMARY_SHIPMENT_COLUMNS,
  type StateIdByGeoCode,
  type SummaryActivityRow,
  type SummaryShipmentRow,
  type TripSummary,
} from '../../lib/longhaul-cloud-trip-summary'
import { enqueueTripAssignmentPush } from '../../lib/push-triggers'
import { logger } from '../../lib/logger'

const TripBody = z
  .object({
    id: z.number().optional(),
    shipments: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()

// The summary roll-up's columns (see SUMMARY_SHIPMENT_COLUMNS — typed against
// the view manifest), plus the state reference table in the same round trip.
const SHIPMENT_SUMMARY_SQL = (inList: string) =>
  `SELECT ${SUMMARY_SHIPMENT_COLUMNS.join(', ')} FROM v_longhaul_shipments_v2 WHERE order_num IN (${inList});\n${STATES_SQL}`

// Existing trip header + activities (update only); aliases ActivityType_code to
// the joined-alias name the sameSlot diff compares against.
const EXISTING_READ_SQL = `
SELECT driver_id, dispatcher_id FROM TripMaster WHERE id = @id;
SELECT id, order_num, ActivityType_code AS activityType_code, actual_date, TripMaster_id
  FROM LongDistanceDispatchActivity WHERE TripMaster_id = @id;
`

async function handleSave(c: Parameters<Handler<AppEnv>>[0], tripId: number | undefined) {
  const correlationId = c.get('correlationId')

  const parsed = TripBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const tripDto: Record<string, unknown> = { ...parsed.data }
  if (tripId != null) tripDto['id'] = tripId

  const shipments = (tripDto['shipments'] as Array<Record<string, unknown>> | undefined) ?? []
  if (shipments.length === 0) {
    return c.json(
      { error: 'Trip must have shipments', code: 'VALIDATION_ERROR', correlationId },
      403,
    )
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }
  const { connectionString } = resolved
  const isUpdate = tripId != null

  try {
    // --- RT1: current state (existing trip + activities for updates) + shipments.
    const orderNums = [
      ...new Set(shipments.map((s) => s['order_num'] as number).filter((n) => n != null)),
    ]
    const shipParams: SqlParam[] = orderNums.map((n, i) => ({ name: `o${i}`, value: n }))
    const inList = shipParams.map((p) => `@${p.name}`).join(', ') || 'NULL'

    let existingTrip: Record<string, unknown> | null = null
    let existingActivities: ExistingActivity[] = []
    let summaryShipments: SummaryShipmentRow[] = []
    let stateIdByGeoCode: StateIdByGeoCode = {}

    if (isUpdate) {
      // EXISTING_READ_SQL is 2 statements, SHIPMENT_SUMMARY_SQL another 2:
      // [0] trip header, [1] existing activities, [2] shipments, [3] states.
      const { recordsets } = await executeSql(
        connectionString,
        `${EXISTING_READ_SQL}\n${SHIPMENT_SUMMARY_SQL(inList)}`,
        { params: [{ name: 'id', value: tripId }, ...shipParams] },
      )
      existingTrip = (recordsets[0]?.[0] as Record<string, unknown> | undefined) ?? null
      if (!existingTrip) {
        return c.json({ error: 'Trip not found', code: 'NOT_FOUND', correlationId }, 404)
      }
      existingActivities = (recordsets[1] ?? []) as ExistingActivity[]
      summaryShipments = (recordsets[2] ?? []) as SummaryShipmentRow[]
      stateIdByGeoCode = buildStateIdByGeoCode(recordsets[3] ?? [])
    } else {
      const { recordsets } = await executeSql(connectionString, SHIPMENT_SUMMARY_SQL(inList), {
        params: shipParams,
      })
      summaryShipments = (recordsets[0] ?? []) as SummaryShipmentRow[]
      stateIdByGeoCode = buildStateIdByGeoCode(recordsets[1] ?? [])
    }

    // --- JS: diff + guards.
    const plan = computeTripSavePlan(tripDto, existingTrip, existingActivities)
    if (plan.kind === 'error') {
      return c.json({ error: plan.error, code: plan.code, correlationId }, 403)
    }

    // --- JS: summary from the final activity set.
    const summaryActivities: SummaryActivityRow[] = plan.finalActivities.map((a) => ({
      order_num: (a['order_num'] as number | null) ?? null,
      actual_date: (a['actual_date'] as string | null) ?? null,
      estimated_date: (a['estimated_date'] as string | null) ?? null,
      planned_start: (a['planned_start'] as string | null) ?? null,
      planned_end: (a['planned_end'] as string | null) ?? null,
      ActivityType_code: (a['ActivityType_code'] as string | null) ?? null,
    }))
    // `idc_break` is now the default too (the `supervip` the other path named is
    // not a column at all), but keep it explicit — saveTripLogic names it.
    const summary = computeTripSummary(summaryActivities, summaryShipments, {
      superVipField: 'idc_break',
      stateIdByGeoCode,
    })

    // --- RT2: one atomic batch.
    const { sql, params } = buildSaveBatch(plan, summary, tripId)
    const { recordset } = await executeSql(connectionString, sql, { params })
    const saved = (recordset[0] as Record<string, unknown> | undefined) ?? null

    // --- Post-commit: notify a newly assigned driver. Deliberately AFTER the
    // write and never able to fail it (see notifyDriverAssignment).
    await notifyDriverAssignment(c, {
      tripId: tripId ?? asDriverId(saved?.['id']),
      previousDriverId: asDriverId(existingTrip?.['driver_id']),
      newDriverId: asDriverId(plan.tripRow['driver_id']),
    })

    return c.json({ data: saved }, isUpdate ? 200 : 201)
  } catch (err) {
    const detail = err instanceof MssqlExecError ? err.message : String(err)
    logger.error('longhaul cloud trip save failed', { error: detail, isUpdate })
    return c.json({ error: 'Failed to save trip', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

/**
 * Coerces a legacy id (which reaches us as a number, a numeric string, or the
 * "None" sentinel 0) to a positive number, else null.
 */
function asDriverId(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Queues a push to the driver when a save ASSIGNS a driver the trip didn't
 * already have (create-with-driver, or a change on update). Unchanged drivers
 * are skipped, so the routine trip edit — which re-saves the header every time
 * — stays silent.
 *
 * Best-effort by design: the trip is already committed on-prem by the time we
 * get here, so a notification problem must never turn a successful save into a
 * 500. Everything is caught and logged. (This is the one place the outbox's
 * atomic-with-the-state-change property can't hold — the state lives in MSSQL,
 * the outbox in Postgres, so there is no shared transaction to enlist in.)
 */
async function notifyDriverAssignment(
  c: Parameters<Handler<AppEnv>>[0],
  args: { tripId: number | null; previousDriverId: number | null; newDriverId: number | null },
): Promise<void> {
  const { tripId, previousDriverId, newDriverId } = args
  if (tripId == null || newDriverId == null || newDriverId === previousDriverId) return

  try {
    const db = c.get('db')
    if (!db) return
    const enqueued = await enqueueTripAssignmentPush(db, c.get('tenantId'), {
      tripId,
      longhaulDriverId: newDriverId,
    })
    if (!enqueued) {
      logger.info('No tenant user mapped to assigned driver — push skipped', {
        tripId,
        driverId: newDriverId,
      })
    }
  } catch (err) {
    logger.warn('Trip assignment push enqueue failed', {
      error: String(err),
      tripId,
      driverId: newDriverId,
    })
  }
}

/** Build the single atomic write batch + its bound params. */
function buildSaveBatch(
  plan: TripSavePlan,
  summary: TripSummary,
  tripId: number | undefined,
): { sql: string; params: SqlParam[] } {
  const params: SqlParam[] = []
  const stmts: string[] = []

  // 1. Trip header upsert → @tripId.
  const tripCols = Object.keys(plan.tripRow)
  for (const col of tripCols) params.push({ name: `t_${col}`, value: plan.tripRow[col] })
  if (plan.isUpdate) {
    params.push({ name: 'tripIdParam', value: tripId })
    const setClause = tripCols.map((c) => `${c} = @t_${c}`).join(', ')
    stmts.push(
      `SET @tripId = @tripIdParam;`,
      `UPDATE TripMaster SET ${setClause}, updated_date = GETDATE() WHERE id = @tripId;`,
    )
  } else {
    const colList = tripCols.join(', ')
    const valList = tripCols.map((c) => `@t_${c}`).join(', ')
    stmts.push(
      `INSERT INTO TripMaster (${colList}, created_date, updated_date) ` +
        `VALUES (${valList}, GETDATE(), GETDATE());`,
      `SET @tripId = SCOPE_IDENTITY();`,
    )
  }

  // 2. Dispatcher-change shadow cascade (upsert `sales` per affected order_num).
  if (plan.dispatcherCascade) {
    params.push({ name: 'disp_id', value: plan.dispatcherCascade.operations_id })
    params.push({ name: 'disp_name', value: plan.dispatcherCascade.operations_name })
    plan.dispatcherCascade.orderNums.forEach((on, i) => {
      params.push({ name: `cc${i}`, value: on })
      stmts.push(
        `IF EXISTS (SELECT 1 FROM sales WHERE order_num = @cc${i}) ` +
          `UPDATE sales SET operations_id = @disp_id, operations_name = @disp_name WHERE order_num = @cc${i}; ` +
          `ELSE INSERT INTO sales (order_num, operations_id, operations_name) VALUES (@cc${i}, @disp_id, @disp_name);`,
      )
    })
  }

  // 3. Remove activities (audit touch with the acting user, then delete).
  if (plan.removeIds.length) {
    const rList = plan.removeIds.map((id, i) => {
      params.push({ name: `r${i}`, value: id })
      return `@r${i}`
    })
    params.push({ name: 'rmBy', value: plan.modifiedBy })
    stmts.push(
      `UPDATE LongDistanceDispatchActivity SET modified_by = @rmBy, updated_at = GETDATE() WHERE id IN (${rList.join(', ')});`,
      `DELETE FROM LongDistanceDispatchActivity WHERE id IN (${rList.join(', ')});`,
    )
  }

  // 4. Insert added activities (TripMaster_id = @tripId).
  plan.activitiesToAdd.forEach((act, i) => {
    const cols = Object.keys(act)
    for (const col of cols) params.push({ name: `a${i}_${col}`, value: act[col] })
    const colList = ['TripMaster_id', ...cols, 'created_at', 'updated_at'].join(', ')
    const valList = ['@tripId', ...cols.map((c) => `@a${i}_${c}`), 'GETDATE()', 'GETDATE()'].join(
      ', ',
    )
    stmts.push(`INSERT INTO LongDistanceDispatchActivity (${colList}) VALUES (${valList});`)
  })

  // 5. Update changed activities (by id).
  plan.activitiesToUpdate.forEach((u, i) => {
    const cols = Object.keys(u.fields)
    for (const col of cols) params.push({ name: `u${i}_${col}`, value: u.fields[col] })
    params.push({ name: `u${i}_id`, value: u.id })
    const setClause = [...cols.map((c) => `${c} = @u${i}_${c}`), 'updated_at = GETDATE()'].join(
      ', ',
    )
    stmts.push(`UPDATE LongDistanceDispatchActivity SET ${setClause} WHERE id = @u${i}_id;`)
  })

  // 6. Persist the recomputed summary on the trip.
  const summaryCols = Object.keys(summary) as Array<keyof TripSummary>
  for (const col of summaryCols) params.push({ name: `s_${col}`, value: summary[col] })
  const summarySet = summaryCols.map((c) => `${c} = @s_${c}`).join(', ')
  stmts.push(`UPDATE TripMaster SET ${summarySet}, updated_date = GETDATE() WHERE id = @tripId;`)

  // SET NOCOUNT ON keeps trigger-emitted rowcounts (LongDistanceDispatchActivity
  // carries enabled triggers) out of the executor's `rowsAffected` array, so any
  // future caller that reads it gets only the counts we authored.
  const sql = `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  DECLARE @tripId INT;
${stmts.map((s) => '  ' + s).join('\n')}
  COMMIT TRAN;
  SELECT * FROM TripMaster WHERE id = @tripId;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
`
  return { sql, params }
}

export const longhaulCreateTripHandler: Handler<AppEnv> = async (c) => handleSave(c, undefined)

export const longhaulUpdateTripHandler: Handler<AppEnv> = async (c) => {
  const id = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(id)) {
    return c.json(
      { error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId: c.get('correlationId') },
      400,
    )
  }
  return handleSave(c, id)
}
