// ---------------------------------------------------------------------------
// Cloud-direct longhaul activity-save handler (Phase 4 #6).
//
// On-prem source: handlers/longhaul/activities.ts (POST /activities/:id) →
// saveActivity (activities.repository.ts) + updateTripSummaryInfo. Updates an
// existing activity, then recomputes the summary for the trip(s) it touches:
// if the activity moved between trips (TripMaster_id changed), BOTH the new and
// previous trip are recomputed (the proxy reads the pre-update TripMaster_id to
// detect the cascade).
//
// NOTE: the inventory's POST /activities (CREATE) is intentionally NOT migrated
// — no tenant-web caller invokes it (activity creation happens server-side in
// trip-save; ActivityGantt only calls saveActivity for in-place edits). It
// stays on the /onprem proxy. Trip-save (Unit 5) handles activity inserts in
// its own atomic batch.
//
// LongDistanceDispatchActivity carries enabled triggers — the UPDATE here has
// no OUTPUT clause so that is fine (the trigger constraint only bites OUTPUT
// without INTO, which the create path would need).
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { recomputeTripSummaryCloud } from '../../lib/longhaul-cloud-trip-summary'
import { pickColumns, assignments } from '../../lib/longhaul-cloud-write'
import { normalizeDateOnlyColumns, findImplausibleDateColumn } from '../../lib/longhaul-date-only'
import { logger } from '../../lib/logger'

const PatchActivityBody = z.object({
  estimated_date: z.string().nullable().optional(),
  actual_date: z.string().nullable().optional(),
  status: z.string().optional(),
  planned_start: z.string().nullable().optional(),
  planned_end: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  is_confirmed: z.boolean().optional(),
  is_committed: z.boolean().optional(),
  trip_status_id: z.number().nullable().optional(),
  assigned_driver_id: z.number().nullable().optional(),
  assigned_agent_code: z.string().nullable().optional(),
  location_id: z.number().nullable().optional(),
  TripMaster_id: z.number().nullable().optional(),
})

// The activity columns a PATCH may set (knex .update({...patch}) parity — only
// provided keys are written so omitted optional columns are preserved).
const ACTIVITY_PATCH_COLUMNS = [
  'estimated_date',
  'actual_date',
  'status',
  'planned_start',
  'planned_end',
  'street',
  'unit',
  'city',
  'state',
  'zip',
  'is_active',
  'is_confirmed',
  'is_committed',
  'trip_status_id',
  'assigned_driver_id',
  'assigned_agent_code',
  'location_id',
  'TripMaster_id',
] as const

export const longhaulSaveActivityHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const activityId = Number.parseInt(c.req.param('id') ?? '', 10)
  if (Number.isNaN(activityId)) {
    return c.json({ error: 'Invalid activity id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = PatchActivityBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  // The four date columns are CALENDAR DAYS — collapse any time-of-day the
  // client sent before it reaches MSSQL. See lib/longhaul-date-only.
  const patch = normalizeDateOnlyColumns(parsed.data as Record<string, unknown>, {
    activityId,
    correlationId,
  })

  // Sentinel / mistyped years are the real defect class — NOT an inverted span,
  // which is legitimate (see isImplausibleDateOnly). Checked on the patch alone
  // so a stored bad value can still be corrected through this endpoint.
  const implausible = findImplausibleDateColumn(patch)
  if (implausible) {
    return c.json(
      {
        error: `${implausible} year is out of range`,
        code: 'VALIDATION_ERROR',
        correlationId,
      },
      400,
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

  try {
    // RT1: capture the pre-update TripMaster_id so we can detect a cascade
    // (activity moved between trips) and recompute both summaries.
    const { recordset: existingRows } = await executeSql(
      connectionString,
      'SELECT TripMaster_id FROM LongDistanceDispatchActivity WHERE id = @id',
      { params: [{ name: 'id', value: activityId }] },
    )
    const existing = existingRows[0] as { TripMaster_id: number | null } | undefined
    if (!existing) {
      return c.json({ error: 'Activity not found', code: 'NOT_FOUND', correlationId }, 404)
    }
    const previousTripId = existing.TripMaster_id ?? null

    // RT2: UPDATE only the provided columns + audit/timestamp.
    const { columns, params } = pickColumns(patch, ACTIVITY_PATCH_COLUMNS)
    const setClause = [
      assignments([...columns]),
      'modified_by = @modified_by',
      'updated_at = GETDATE()',
    ]
      .filter(Boolean)
      .join(', ')
    await executeSql(
      connectionString,
      `UPDATE LongDistanceDispatchActivity SET ${setClause} WHERE id = @id`,
      {
        params: [
          ...params,
          { name: 'modified_by', value: resolved.code },
          { name: 'id', value: activityId },
        ],
      },
    )

    // Recompute summary for the new and previous trip (Set dedupes the common
    // in-place-update case where they match).
    const nextTripId =
      parsed.data.TripMaster_id !== undefined ? (parsed.data.TripMaster_id ?? null) : previousTripId
    const recompute = new Set<number>()
    if (nextTripId != null) recompute.add(nextTripId)
    if (previousTripId != null) recompute.add(previousTripId)
    for (const tripId of recompute) {
      await recomputeTripSummaryCloud(connectionString, tripId)
    }

    return c.json({ data: { success: true } })
  } catch (err) {
    const detail = err instanceof MssqlExecError ? err.message : String(err)
    logger.error('longhaul cloud save activity failed', { error: detail })
    return c.json({ error: 'Failed to save activity', code: 'INTERNAL_ERROR', correlationId }, 500)
  }
}
