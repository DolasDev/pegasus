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
import { attachAssertions, recordFact, type FactBasis } from '../../lib/itinerary/act-facts'
import type { ItineraryItem } from '../../lib/itinerary/types'

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
  // A longhaul id asks two sources (its activities, and orders assigned to it).
  const asked = (q.longhaulDriverId !== null ? 2 : 0) + (q.localDriverEmployeeId !== null ? 1 : 0)
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
  // The driver's own ETA / done (act-facts.ts). A failed fact read must not
  // cost the dispatcher or the driver the itinerary itself.
  let items = result.items
  try {
    items = await attachAssertions(c.get('db'), result.items)
  } catch (err) {
    logger.warn('itinerary: act facts unavailable', { error: String(err) })
  }
  return c.json({
    data: items,
    meta: { count: items.length, from: q.from, to: q.to, failedSources: result.failed },
  })
}

/** The caller's own two driver ids, each in its own space; null when neither is mapped. */
async function callerDriverIds(
  c: Context<AppEnv>,
): Promise<{ longhaulDriverId: number | null; localDriverEmployeeId: number | null } | null> {
  const userId = c.get('userId')
  const user = userId
    ? await c.get('db').tenantUser.findUnique({
        where: { id: userId },
        select: { longhaulDriverId: true, localDriverEmployeeId: true },
      })
    : null
  const longhaulDriverId = realId(user?.longhaulDriverId)
  const localDriverEmployeeId = realId(user?.localDriverEmployeeId)
  return longhaulDriverId === null && localDriverEmployeeId === null
    ? null
    : { longhaulDriverId, localDriverEmployeeId }
}

const driverNotMapped = (c: Context<AppEnv>) =>
  c.json(
    {
      error:
        'This login is not linked to a driver. Ask a tenant administrator to set the driver on the Users settings page.',
      code: 'DRIVER_NOT_MAPPED',
      correlationId: c.get('correlationId'),
    },
    403,
  )

export const myItineraryHandler: Handler<AppEnv> = async (c) => {
  const parsed = RangeQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)

  const ids = await callerDriverIds(c)
  if (!ids) return driverNotMapped(c)
  return respond(c, { ...parsed.data, ...ids })
}

// ---------------------------------------------------------------------------
// The driver's own ETA / done on one act (act-facts.ts — Pegasus only, never
// legacy). The item is named by its key and its CURRENT legacy day; the
// handler re-reads the caller's own itinerary for that day and refuses unless
// the key is in it, so a driver can only ever assert about their own work.
// ---------------------------------------------------------------------------

const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm')

const ItemRef = z.object({
  key: z.string().min(1).max(120),
  /** The item's day as the itinerary listed it (its legacy day). */
  day: isoDay,
})

const EtaBody = ItemRef.extend({
  eta: z
    .object({
      day: isoDay,
      window: z
        .object({ start: wallTime, end: wallTime })
        .refine((w) => w.start <= w.end, { message: 'window ends before it starts' })
        .nullable()
        .optional(),
    })
    .nullable(),
})

const DoneBody = ItemRef.extend({ done: isoDay.nullable() })

async function assertOnOwnItem(
  c: Context<AppEnv>,
  ref: { key: string; day: string },
  basis: FactBasis,
  value: { day: string | null; window: { start: string; end: string } | null },
) {
  const correlationId = c.get('correlationId')
  const ids = await callerDriverIds(c)
  if (!ids) return driverNotMapped(c)
  const cs = await legacyConnectionString(c.get('tenantId'))
  if (!cs) {
    return c.json(
      {
        error: 'Legacy database not configured for this tenant',
        code: 'MSSQL_NOT_CONFIGURED',
        correlationId,
      },
      422,
    )
  }

  const result = await fetchItinerary(cs, { from: ref.day, to: ref.day, ...ids })
  const item: ItineraryItem | undefined = result.items.find((i) => i.key === ref.key)
  if (!item) {
    // Not in the caller's own work that day — or its source could not be read.
    // Either way nothing is recorded (fail closed).
    if (result.failed.length > 0) {
      return c.json(
        {
          error: 'The order database could not be read',
          code: 'LEGACY_UNAVAILABLE',
          correlationId,
        },
        503,
      )
    }
    return c.json(
      { error: 'That act is not on your itinerary for that day', code: 'NOT_FOUND', correlationId },
      404,
    )
  }
  if (basis === 'ETA' && item.source.kind === 'longhaul-activity') {
    // An activity's ETA already has a legacy editor; a second store would split it.
    return c.json(
      {
        error: "Set a trip activity's ETA from the trip screen",
        code: 'USE_ACTIVITY_ETA',
        correlationId,
      },
      409,
    )
  }

  const db = c.get('db')
  await recordFact(db, {
    tenantId: c.get('tenantId'),
    item,
    basis,
    day: value.day,
    window: value.window,
    userId: c.get('userId') ?? null,
    capturedBy: 'driver-app',
  })
  const [updated] = await attachAssertions(db, [item])
  return c.json({ data: updated })
}

export const myItineraryEtaHandler: Handler<AppEnv> = async (c) => {
  const parsed = EtaBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return validationError(c, parsed.error)
  const { eta } = parsed.data
  return assertOnOwnItem(c, parsed.data, 'ETA', {
    day: eta?.day ?? null,
    window: eta?.window ?? null,
  })
}

export const myItineraryDoneHandler: Handler<AppEnv> = async (c) => {
  const parsed = DoneBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return validationError(c, parsed.error)
  return assertOnOwnItem(c, parsed.data, 'DONE', { day: parsed.data.done, window: null })
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
