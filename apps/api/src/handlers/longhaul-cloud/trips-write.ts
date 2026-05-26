// ---------------------------------------------------------------------------
// Cloud-direct longhaul trip-write handlers (Phase 4 #7-#9).
//
// On-prem source: handlers/longhaul/trips.ts.
//   #7 PATCH /trips/:id/status  — validated status change. Guards (ported):
//        - 404 if the trip is missing.
//        - 403 if advancing past pending (statusId > current && > 1) without a
//          driver assigned.
//        - 403 if finalizing (statusId >= 5) while any activity lacks an
//          actual_date.
//      Then, in ONE atomic batch: UPDATE TripMaster.TripStatus_id +
//      UPDATE every activity's trip_status_id/status (legacy keeps them in
//      sync), and re-read the trip. The proxy wrapped the two updates in a
//      knex transaction — we use the in-SQL transaction (Unit 0).
//   #9 POST  /trips/:id/cancel  — 404 if missing; 403 if status_id >= 4
//      (== TripStatus_id; cancelling after in-progress is disallowed). Then,
//      atomically: touch + DELETE the trip's activities and set
//      internal_status='canceled'.
//   #8 PATCH /trips/:id/summary — RECOMPUTES the trip's roll-up from its
//      activities (recomputeTripSummaryCloud). This follows the ORIGINAL
//      backend: the legacy function is `updateTripSummaryInfo` (the recompute;
//      see dolas-modules-migration.md) and the UI calls it on trip-detail load
//      to refresh the summary before display (Trip/index.tsx → "await
//      updateTripSummaryInfo(id); fetchTrip(id)"), sending an empty body. The
//      on-prem port wired the wrong repo fn (`updateTripSummary`, a direct
//      field write) — a porting bug we deliberately do NOT replicate here.
//
// Activities carry enabled triggers; none of these statements use an OUTPUT
// clause, so the trigger constraint does not bite.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { recomputeTripSummaryCloud } from '../../lib/longhaul-cloud-trip-summary'
import { logger } from '../../lib/logger'

// --- #7 PATCH /trips/:id/status -------------------------------------------

const PatchTripStatusBody = z.object({
  statusId: z.number(),
  status: z.string().optional(),
})

// RT1: trip header, its activities' actual_date, and the status name — three
// statements in one round trip. recordsets[0]=header, [1]=activities, [2]=status.
const STATUS_READ_SQL = `
SELECT driver_id, TripStatus_id FROM TripMaster WHERE id = @id;
SELECT actual_date FROM LongDistanceDispatchActivity WHERE TripMaster_id = @id;
SELECT status FROM MasterTripStatus WHERE status_id = @statusId;
`

// RT2: atomic status change + activity sync + re-read (trailing SELECT).
const STATUS_WRITE_SQL = `
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  UPDATE TripMaster SET TripStatus_id = @statusId WHERE id = @id;
  UPDATE LongDistanceDispatchActivity
    SET trip_status_id = @statusId, status = @statusName, modified_by = @code, updated_at = GETDATE()
    WHERE TripMaster_id = @id;
  COMMIT TRAN;
  SELECT * FROM TripMaster WHERE id = @id;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
`

export const longhaulTripStatusHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const tripId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(tripId)) {
    return c.json({ error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = PatchTripStatusBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const { statusId, status } = parsed.data

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }
  const { connectionString } = resolved

  try {
    const { recordsets } = await executeSql(connectionString, STATUS_READ_SQL, {
      params: [
        { name: 'id', value: tripId },
        { name: 'statusId', value: statusId },
      ],
    })
    const header = recordsets[0]?.[0] as
      | { driver_id: number | null; TripStatus_id: number | null }
      | undefined
    if (!header) {
      return c.json({ error: 'Trip not found', code: 'NOT_FOUND', correlationId }, 404)
    }
    const activities = (recordsets[1] ?? []) as Array<{ actual_date: string | null }>
    const driverAssigned = header.driver_id != null

    if (!driverAssigned && statusId > (header.TripStatus_id ?? 0) && statusId > 1) {
      return c.json(
        {
          error: 'Advancing trip past pending status without an assigned driver is not allowed',
          code: 'VALIDATION_ERROR',
          correlationId,
        },
        403,
      )
    }
    if (statusId >= 5 && activities.some((a) => a.actual_date == null)) {
      return c.json(
        {
          error:
            'Advancing trip to finalized is not allowed until all activities have actual dates',
          code: 'VALIDATION_ERROR',
          correlationId,
        },
        403,
      )
    }

    const statusName =
      (recordsets[2]?.[0] as { status?: string } | undefined)?.status ?? status ?? ''

    const { recordset } = await executeSql(connectionString, STATUS_WRITE_SQL, {
      params: [
        { name: 'id', value: tripId },
        { name: 'statusId', value: statusId },
        { name: 'statusName', value: statusName },
        { name: 'code', value: resolved.code },
      ],
    })
    return c.json({ data: recordset[0] ?? null })
  } catch (err) {
    logger.error('longhaul cloud change trip status failed', { error: errDetail(err) })
    return c.json(
      { error: 'Failed to change trip status', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

// --- #9 POST /trips/:id/cancel --------------------------------------------

// Atomic: touch + delete the trip's activities, then mark the trip canceled.
const CANCEL_SQL = `
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRAN;
  UPDATE LongDistanceDispatchActivity SET modified_by = @code, updated_at = GETDATE()
    WHERE TripMaster_id = @id;
  DELETE FROM LongDistanceDispatchActivity WHERE TripMaster_id = @id;
  UPDATE TripMaster SET internal_status = 'canceled', updated_date = GETDATE(), updated_by_id = @code
    WHERE id = @id;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
`

export const longhaulTripCancelHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const tripId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(tripId)) {
    return c.json({ error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId }, 400)
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

  try {
    const { recordset } = await executeSql(
      connectionString,
      'SELECT TripStatus_id FROM TripMaster WHERE id = @id',
      { params: [{ name: 'id', value: tripId }] },
    )
    const trip = recordset[0] as { TripStatus_id: number | null } | undefined
    if (!trip) {
      return c.json({ error: 'Trip not found', code: 'NOT_FOUND', correlationId }, 404)
    }
    if ((trip.TripStatus_id ?? 0) >= 4) {
      return c.json(
        {
          error: 'Cancelling trip after in-progress status is not allowed',
          code: 'VALIDATION_ERROR',
          correlationId,
        },
        403,
      )
    }

    await executeSql(connectionString, CANCEL_SQL, {
      params: [
        { name: 'id', value: tripId },
        { name: 'code', value: resolved.code },
      ],
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud cancel trip failed', { error: errDetail(err) })
    return c.json({ error: 'Failed to cancel trip', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}

// --- #8 PATCH /trips/:id/summary (recompute) ------------------------------

export const longhaulTripSummaryHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const tripId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(tripId)) {
    return c.json({ error: 'Invalid trip id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  // Body is ignored — the legacy updateTripSummaryInfo takes only the trip id
  // and recomputes from its activities; the UI sends {}.

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  try {
    await recomputeTripSummaryCloud(resolved.connectionString, tripId)
    return c.json({ data: { success: true } })
  } catch (err) {
    logger.error('longhaul cloud update trip summary failed', { error: errDetail(err) })
    return c.json(
      { error: 'Failed to update trip summary', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}

function errDetail(err: unknown): string {
  return err instanceof MssqlExecError ? err.message : String(err)
}
