// ---------------------------------------------------------------------------
// Cloud-direct longhaul `PATCH /driver-planning/:driverId` handler.
//
// Phase 4 write migration (#1). On-prem source:
// handlers/longhaul/driver-planning.ts:41 → repositories upsertConfirmedAvailability.
// Upserts a driver's confirmed-availability override (DriverConfirmedAvailability),
// keyed by driver_id, stamping the acting legacy user's `code` on updated_by.
//
// The on-prem repo lazily CREATEs DriverConfirmedAvailability when absent
// (ensureConfirmedTable). We mirror that with an IF OBJECT_ID … CREATE TABLE
// guard so the first write on a fresh tenant succeeds, then an IF EXISTS
// UPDATE / ELSE INSERT upsert — one round trip, one table, atomic per
// statement. Returns `{ data: { success: true } }` like the proxy.
// ---------------------------------------------------------------------------

import type { Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { executeSql, MssqlExecError } from '../../lib/mssql-executor-client'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { logger } from '../../lib/logger'
import { ENSURE_CONFIRMED_TABLE_SQL } from './driver-confirmed-availability-schema'

const PatchConfirmedBody = z.object({
  confirmedDate: z.string().nullable(),
  confirmedLocation: z.string().nullable(),
  notes: z.string().nullable().optional(),
  // Variant-B roster overrides (planner-maintained, optional on the wire).
  canada: z.boolean().nullable().optional(),
  california: z.boolean().nullable().optional(),
  rating: z.number().nullable().optional(),
  equipment: z.string().nullable().optional(),
  homeCity: z.string().nullable().optional(),
  homeState: z.string().nullable().optional(),
})

// IF EXISTS upsert. ENSURE_CONFIRMED_TABLE_SQL must run in a SEPARATE
// executeSql call before this — concatenating into one batch trips SQL
// Server's parse-time column resolution, which rejects references to
// just-being-ALTERed columns (e.g. `home_state = @home_state`) with
// `Invalid column name 'home_state'` on tenants whose table predates them.
const UPSERT_SQL = `
SET XACT_ABORT ON;
IF EXISTS (SELECT 1 FROM DriverConfirmedAvailability WHERE driver_id = @driver_id)
  UPDATE DriverConfirmedAvailability
  SET confirmed_date = @confirmed_date,
      confirmed_location = @confirmed_location,
      notes = @notes,
      canada = @canada,
      california = @california,
      rating = @rating,
      equipment = @equipment,
      home_city = @home_city,
      home_state = @home_state,
      updated_by = @updated_by,
      updated_at = GETDATE()
  WHERE driver_id = @driver_id;
ELSE
  INSERT INTO DriverConfirmedAvailability
    (driver_id, confirmed_date, confirmed_location, notes,
     canada, california, rating, equipment, home_city, home_state,
     updated_by, updated_at)
  VALUES (@driver_id, @confirmed_date, @confirmed_location, @notes,
     @canada, @california, @rating, @equipment, @home_city, @home_state,
     @updated_by, GETDATE());
`

export const longhaulDriverPlanningPatchHandler: Handler<AppEnv> = async (c) => {
  const correlationId = c.get('correlationId')

  const driverId = Number.parseInt(c.req.param('driverId') ?? '', 10)
  if (Number.isNaN(driverId)) {
    return c.json({ error: 'Invalid driver id', code: 'VALIDATION_ERROR', correlationId }, 400)
  }
  const parsed = PatchConfirmedBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
  }

  const resolved = await resolveLonghaulUser({
    tenantId: c.get('tenantId'),
    userId: c.get('userId'),
    apiClient: c.get('apiClient'),
  })
  if (!resolved.ok) {
    return c.json({ error: resolved.error, code: resolved.code, correlationId }, resolved.status)
  }

  try {
    // Split: ensure-schema first (commits any ALTER TABLE ADD column ...),
    // then upsert. One batch would parse-error on tenants whose table is
    // missing a referenced column. See UPSERT_SQL comment.
    await executeSql(resolved.connectionString, ENSURE_CONFIRMED_TABLE_SQL)
    await executeSql(resolved.connectionString, UPSERT_SQL, {
      params: [
        { name: 'driver_id', value: driverId },
        { name: 'confirmed_date', value: parsed.data.confirmedDate },
        { name: 'confirmed_location', value: parsed.data.confirmedLocation },
        { name: 'notes', value: parsed.data.notes ?? null },
        { name: 'canada', value: parsed.data.canada ?? null },
        { name: 'california', value: parsed.data.california ?? null },
        { name: 'rating', value: parsed.data.rating ?? null },
        { name: 'equipment', value: parsed.data.equipment ?? null },
        { name: 'home_city', value: parsed.data.homeCity ?? null },
        { name: 'home_state', value: parsed.data.homeState ?? null },
        { name: 'updated_by', value: resolved.code },
      ],
    })
    return c.json({ data: { success: true } })
  } catch (err) {
    const detail = err instanceof MssqlExecError ? err.message : String(err)
    logger.error('longhaul cloud driver-planning PATCH failed', { error: detail })
    return c.json(
      { error: 'Failed to update confirmed availability', code: 'INTERNAL_ERROR', correlationId },
      500,
    )
  }
}
