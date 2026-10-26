// ---------------------------------------------------------------------------
// Driver itinerary — `GET /onprem/longhaul/me/itinerary` and
// `GET /onprem/longhaul/drivers/itinerary`.
//
// A driver's work over a date range, whether it sits on a longhaul trip or on a
// local dispatch job, as one list of acts (lib/itinerary/). The trip is a
// grouping on each item, not the way in. Plan:
// plans/in-progress/driver-itinerary.md.
//
//   • /me/itinerary — the caller's own work, through the two legacy ids an
//     admin set on their TenantUser (`longhaulDriverId`, `localDriverEmployeeId`).
//     Neither set ⇒ 403 DRIVER_NOT_MAPPED, as the ETA editor answers.
//   • /drivers/itinerary — any driver's, for an Operations role only. The
//     dispatcher names the driver by either id or both: the two numbering
//     spaces collide on different people at some tenants (GOTCHAS, "Crew
//     number ≠ driver number is tenant-specific"), so this never infers one
//     from the other.
//
// Not Cedar, for the reason lib/longhaul-read-scope.ts gives: longhaul reads are
// gated by role name and scoped by the driver mapping in the handler.
// ---------------------------------------------------------------------------

import type { Context, Handler } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../types'
import { legacyConnectionString } from '../../lib/chat-access'
import { logger } from '../../lib/logger'
import { hasOperationsRole } from '../../lib/longhaul-read-scope'
import { fetchItinerary, type ItineraryQuery } from '../../lib/itinerary/fetch'
import { realId } from '../../lib/itinerary/values'

/** The longest range one request may ask for — a month either side of a screen. */
export const ITINERARY_MAX_DAYS = 31

/** A real calendar day: `Date.parse` rolls Feb 30 over to March, so round-trip it (GOTCHAS). */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
  }, 'not a calendar day')

const driverId = z.coerce.number().int().positive()

const RangeQuery = z
  .object({ from: isoDay, to: isoDay })
  .refine((q) => q.from <= q.to, { message: '`to` is before `from`', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < ITINERARY_MAX_DAYS, {
    message: `at most ${ITINERARY_MAX_DAYS} days`,
    path: ['to'],
  })

const DriverQuery = z
  .object({
    from: isoDay,
    to: isoDay,
    longhaulDriverId: driverId.optional(),
    localDriverEmployeeId: driverId.optional(),
  })
  .refine((q) => q.longhaulDriverId !== undefined || q.localDriverEmployeeId !== undefined, {
    message: 'name the driver by longhaulDriverId, localDriverEmployeeId, or both',
    path: ['longhaulDriverId'],
  })

function validationError(c: Context<AppEnv>, error: z.ZodError) {
  return c.json(
    {
      error: error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '),
      code: 'VALIDATION_ERROR',
      correlationId: c.get('correlationId'),
    },
    400,
  )
}

/** Fetch, then turn the result into the response — shared by both routes. */
async function respond(c: Context<AppEnv>, q: ItineraryQuery) {
  const correlationId = c.get('correlationId')
  // Through lib/, not the unscoped base client (db-access-guard).
  const connectionString = await legacyConnectionString(c.get('tenantId'))
  if (!connectionString) {
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }

  const result = await fetchItinerary(connectionString, q)
  const asked = (q.longhaulDriverId !== null ? 1 : 0) + (q.localDriverEmployeeId !== null ? 1 : 0)
  if (asked > 0 && result.failed.length === asked) {
    logger.error('itinerary: every source failed', { failed: result.failed })
    return c.json(
      { error: 'The order database could not be read', code: 'LEGACY_UNAVAILABLE', correlationId },
      503,
    )
  }
  if (result.overCap.length > 0) {
    return c.json(
      {
        error: 'Too many items — please narrow the date range.',
        code: 'RESULT_LIMIT_EXCEEDED',
        correlationId,
      },
      400,
    )
  }
  return c.json({
    data: result.items,
    meta: { count: result.items.length, from: q.from, to: q.to, failedSources: result.failed },
  })
}

export const myItineraryHandler: Handler<AppEnv> = async (c) => {
  const parsed = RangeQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)

  const userId = c.get('userId')
  const user = userId
    ? await c.get('db').tenantUser.findUnique({
        where: { id: userId },
        select: { longhaulDriverId: true, localDriverEmployeeId: true },
      })
    : null
  const longhaulDriverId = realId(user?.longhaulDriverId)
  const localDriverEmployeeId = realId(user?.localDriverEmployeeId)
  if (longhaulDriverId === null && localDriverEmployeeId === null) {
    return c.json(
      {
        error:
          'This login is not linked to a driver. Ask a tenant administrator to set the driver on the Users settings page.',
        code: 'DRIVER_NOT_MAPPED',
        correlationId: c.get('correlationId'),
      },
      403,
    )
  }
  return respond(c, { ...parsed.data, longhaulDriverId, localDriverEmployeeId })
}

export const driverItineraryHandler: Handler<AppEnv> = async (c) => {
  if (!hasOperationsRole(c.get('principal')?.roleNames ?? [])) {
    return c.json(
      {
        error: "Reading another driver's itinerary needs an Operations role",
        code: 'FORBIDDEN',
        correlationId: c.get('correlationId'),
      },
      403,
    )
  }
  const range = RangeQuery.safeParse(c.req.query())
  if (!range.success) return validationError(c, range.error)
  const parsed = DriverQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)
  return respond(c, {
    from: parsed.data.from,
    to: parsed.data.to,
    longhaulDriverId: parsed.data.longhaulDriverId ?? null,
    localDriverEmployeeId: parsed.data.localDriverEmployeeId ?? null,
  })
}
