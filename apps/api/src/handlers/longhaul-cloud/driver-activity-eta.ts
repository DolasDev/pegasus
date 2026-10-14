// ---------------------------------------------------------------------------
// Driver-scoped ETA write — PATCH /onprem/longhaul/driver/activities/:id/eta.
//
// The mobile driver app lets a driver set the ETA (estimated_date + arrival
// window) on their own Delivery (RDEL) and Delivery to Storage (SITIN)
// activities, and mark it "Confirmed" — meaning the driver AND the shipper have
// both committed to that date. "Confirmed" is `is_committed` (dispatch reads it
// as "Driver committed" on the Gantt and Availability); `is_confirmed` is the
// dispatcher's own flag and this route can never write it.
//
// Why not POST /activities/:id: that route resolves a v_longhaul_salesman row
// via resolveLonghaulUser (drivers usually have none → 422), and it accepts
// every column. This route is the narrow driver surface instead:
//
//   - identity is TenantUser.longhaulDriverId (same mapping as GET /me/driver);
//   - ownership is checked server-side — the activity's assigned driver, or its
//     trip's driver, must be the caller. The /onprem/longhaul reads are not
//     driver-scoped; this write must not inherit that;
//   - only RDEL / SITIN, matched by ActivityType_code — SITIN and SITOUT share
//     the `SIT` abbreviation;
//   - types whose Longhaul_ActivityType.isHasETA is false take an arrival
//     window only (it anchors to planned_start), never an estimated_date;
//   - once the activity has an actual_date the delivery has happened, and its
//     ETA and commitment are history — the driver can no longer change them.
//
// `modified_by` is a salesman code; a driver has none, so it is stamped NULL
// (same as the M2M path) and the driver id is logged for audit.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { recomputeTripSummaryCloud } from '../../lib/longhaul-cloud-trip-summary'
import { pickColumns, assignments } from '../../lib/longhaul-cloud-write'
import { normalizeDateOnlyColumns, findImplausibleDateColumn } from '../../lib/longhaul-date-only'
import {
  validateArrivalWindow,
  enrichActivityArrivalWindow,
} from '../../lib/longhaul-arrival-window'
import {
  ensureArrivalWindowColumns,
  patchTouchesArrivalWindow,
} from '../../lib/longhaul-arrival-window-schema'
import { logger } from '../../lib/logger'

/** Activity types a driver may set an ETA on: Delivery and Delivery to Storage (SIT-IN). */
export const DRIVER_ETA_ACTIVITY_CODES = ['RDEL', 'SITIN'] as const

const DriverEtaBody = z
  .object({
    estimated_date: z.string().nullable().optional(),
    arrival_window_start: z.string().nullable().optional(),
    arrival_window_end: z.string().nullable().optional(),
    arrival_window_tz: z.string().nullable().optional(),
    // Required: every save states the commitment explicitly, so editing a
    // confirmed ETA can never silently keep (or drop) "Confirmed".
    committed: z.boolean(),
  })
  .strict()

const DRIVER_ETA_COLUMNS = [
  'estimated_date',
  'arrival_window_start',
  'arrival_window_end',
  'arrival_window_tz',
  'is_committed',
] as const

const ACTIVITY_OWNERSHIP_SQL = `
SELECT a.id,
       a.TripMaster_id,
       a.assigned_driver_id,
       a.ActivityType_code,
       a.actual_date,
       at.isHasETA,
       t.driver_id AS trip_driver_id
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
LEFT JOIN TripMaster t ON a.TripMaster_id = t.id
WHERE a.id = @id`

const ACTIVITY_READBACK_SQL = `
SELECT a.*,
       at.code AS activityType_code,
       at.name AS activityType_name,
       at.abbreviation AS activityType_abbreviation,
       at.isHasETA AS activityType_isHasETA
FROM LongDistanceDispatchActivity a
LEFT JOIN Longhaul_ActivityType at ON a.ActivityType_code = at.code
WHERE a.id = @id`

/**
 * A real driver id, or null. `v_longhaul_drivers` carries a placeholder driver
 * 0 (other queries exclude it with `driver_id <> 0`), so 0 means "unassigned"
 * on an activity or trip — and must never match a login mapped to 0.
 */
function realDriverId(id: number | null | undefined): number | null {
  return id == null || id === 0 ? null : id
}

interface OwnershipRow {
  id: number
  TripMaster_id: number | null
  assigned_driver_id: number | null
  ActivityType_code: string | null
  actual_date: Date | string | null
  isHasETA: boolean | number | null
  trip_driver_id: number | null
}

export const driverActivityEtaHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const activityId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(activityId)) {
    return c.json({ error: 'Invalid activity id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = DriverEtaBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const { committed, ...eta } = parsed.data

  // Calendar day only — see lib/longhaul-date-only.
  const patch: Record<string, unknown> = {
    ...normalizeDateOnlyColumns(eta as Record<string, unknown>, { activityId, correlationId }),
    is_committed: committed,
  }
  const implausible = findImplausibleDateColumn(patch)
  if (implausible) {
    return c.json(
      { error: `${implausible} year is out of range`, code: 'VALIDATION_ERROR', correlationId },
      400,
    )
  }
  const arrivalWindowError = validateArrivalWindow(patch)
  if (arrivalWindowError) {
    return c.json({ error: arrivalWindowError, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  // --- Identity: the caller's longhaul driver mapping. ---
  const db = c.get('db')
  const userId = c.get('userId')
  const tenantUser = userId
    ? await db.tenantUser.findUnique({
        where: { id: userId },
        select: { longhaulDriverId: true },
      })
    : null
  const driverId = realDriverId(tenantUser?.longhaulDriverId)
  if (driverId == null) {
    return c.json(
      {
        error:
          'This login is not linked to a driver. Ask a tenant administrator to set the driver on the Users settings page.',
        code: 'DRIVER_NOT_MAPPED',
        correlationId,
      },
      403,
    )
  }

  const tenantId = c.get('tenantId')
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  if (!tenant?.mssqlConnectionString) {
    logger.warn('Tenant has no mssqlConnectionString configured', { tenantId })
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }
  const connectionString = tenant.mssqlConnectionString

  try {
    const { recordset } = await executeSql(connectionString, ACTIVITY_OWNERSHIP_SQL, {
      params: [{ name: 'id', value: activityId }],
    })
    const activity = recordset[0] as OwnershipRow | undefined
    if (!activity) {
      return c.json({ error: 'Activity not found', code: 'NOT_FOUND', correlationId }, 404)
    }

    // The assigned driver wins when set; an unassigned (NULL or 0) activity
    // belongs to the trip's driver.
    const owner = realDriverId(activity.assigned_driver_id) ?? realDriverId(activity.trip_driver_id)
    if (owner !== driverId) {
      logger.warn('driver ETA write rejected — activity belongs to another driver', {
        activityId,
        driverId,
        correlationId,
      })
      return c.json(
        { error: 'This activity is not assigned to you', code: 'NOT_YOUR_ACTIVITY', correlationId },
        403,
      )
    }

    const typeCode = activity.ActivityType_code?.trim() ?? ''
    if (!(DRIVER_ETA_ACTIVITY_CODES as readonly string[]).includes(typeCode)) {
      return c.json(
        {
          error: 'ETAs can only be set on Delivery and Delivery to Storage (SIT-IN) activities',
          code: 'ACTIVITY_TYPE_NOT_SUPPORTED',
          correlationId,
        },
        422,
      )
    }
    if (activity.actual_date != null) {
      return c.json(
        {
          error: 'This delivery is already done — ask dispatch if its ETA needs to change',
          code: 'ACTIVITY_COMPLETED',
          correlationId,
        },
        409,
      )
    }
    if (!activity.isHasETA && patch['estimated_date'] !== undefined) {
      return c.json(
        {
          error: 'This activity type has no ETA date — set its arrival window instead',
          code: 'ETA_NOT_SUPPORTED',
          correlationId,
        },
        422,
      )
    }

    // Separate round trip, before anything names the columns — see
    // lib/longhaul-arrival-window-schema.
    if (patchTouchesArrivalWindow(patch)) {
      await ensureArrivalWindowColumns(connectionString)
    }

    const { columns, params } = pickColumns(patch, DRIVER_ETA_COLUMNS)
    const setClause = [
      assignments([...columns]),
      'modified_by = @modified_by',
      'updated_at = GETDATE()',
    ].join(', ')
    await executeSql(
      connectionString,
      `UPDATE LongDistanceDispatchActivity SET ${setClause} WHERE id = @id`,
      {
        params: [
          ...params,
          { name: 'modified_by', value: null },
          { name: 'id', value: activityId },
        ],
      },
    )

    // estimated_date feeds the trip roll-up.
    if (activity.TripMaster_id != null) {
      await recomputeTripSummaryCloud(connectionString, activity.TripMaster_id)
    }

    logger.info('driver ETA saved', {
      activityId,
      driverId,
      committed,
      columns,
      correlationId,
    })

    const { recordset: updated } = await executeSql(connectionString, ACTIVITY_READBACK_SQL, {
      params: [{ name: 'id', value: activityId }],
    })
    const row = (updated[0] as Record<string, unknown> | undefined) ?? { id: activityId }
    return c.json({ data: enrichActivityArrivalWindow(row) })
  } catch (err) {
    const detail = err instanceof MssqlExecError ? err.message : String(err)
    logger.error('driver ETA save failed', { error: detail, activityId, correlationId })
    return c.json({ error: 'Failed to save ETA', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}
