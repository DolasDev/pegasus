// ---------------------------------------------------------------------------
// Driver To Do — `GET /api/v1/me/tasks` and `PUT /api/v1/me/tasks/state`.
//
// The caller's open tasks, computed on read from their itinerary, their act
// facts and the order documents by the tenant's enabled built-in rules
// (@pegasus/domain tasks). Nothing is stored except each user's snooze /
// dismiss (TaskState). Plan: plans/todo/task-queue-and-activity-feed.md
// Phase 1.
//
// Same gate as /onprem/longhaul/me/itinerary — not Cedar: the caller reads
// only their own work, through the driver ids an admin mapped on their
// TenantUser (403 DRIVER_NOT_MAPPED otherwise).
//
// ONE legacy read per load (the itinerary batch), and none at all when the
// tenant has no rule enabled.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { evaluateDriverTasks, taskBucket, type DriverTaskRuleId } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { getAppSettings } from '../lib/app-settings'
import { legacyConnectionString } from '../lib/chat-access'
import { fetchItinerary } from '../lib/itinerary/fetch'
import { driverTaskFacts } from '../lib/tasks/driver-task-facts'
import { logger } from '../lib/logger'
import { callerDriverIds, driverNotMapped } from './longhaul-cloud/itinerary'

/** How far back an unfinished act still asks to be finished. Older ones drop off. */
export const TASK_LOOKBACK_DAYS = 14

const DAY_MS = 86_400_000

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
  }, 'not a calendar day')

/** The driver's local day must be within a day of the server's (time zones, not time travel). */
const TasksQuery = z.object({
  today: isoDay.refine(
    (v) =>
      Math.abs(Date.parse(`${v}T00:00:00Z`) - Date.parse(new Date().toISOString().slice(0, 10))) <=
      DAY_MS,
    'must be within a day of today',
  ),
})

const TaskKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^task:[a-z-]+:\d+:.+$/, 'not a task key')

const StateBody = z
  .object({
    key: TaskKey,
    /** ISO instant to hide until, or null to un-snooze. */
    snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
    dismissed: z.boolean().optional(),
  })
  .refine((b) => b.snoozedUntil !== undefined || b.dismissed !== undefined, {
    message: 'set snoozedUntil, dismissed, or both',
  })

function validationError(c: Context<AppEnv>, error: z.ZodError) {
  return c.json(
    {
      error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      code: 'VALIDATION_ERROR',
      correlationId: c.get('correlationId'),
    },
    400,
  )
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

export const meTasksHandler = new Hono<AppEnv>()

meTasksHandler.get('/', async (c) => {
  const parsed = TasksQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)
  const { today } = parsed.data
  const correlationId = c.get('correlationId')
  const db = c.get('db')
  const userId = c.get('userId')

  const ids = await callerDriverIds(c)
  if (!ids || !userId) return driverNotMapped(c)

  const settings = await getAppSettings(db, c.get('tenantId'))
  const enabled = new Set<DriverTaskRuleId>(settings.operations.driverTaskRules ?? [])
  const from = addDays(today, -TASK_LOOKBACK_DAYS)
  const meta = {
    today,
    from,
    to: today,
    enabledRules: [...enabled],
    failedSources: [] as string[],
    unavailable: [] as string[],
    hidden: 0,
  }
  if (enabled.size === 0) return c.json({ data: [], meta })

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

  const itinerary = await fetchItinerary(cs, { from, to: today, ...ids })
  const asked =
    (ids.longhaulDriverId !== null ? 2 : 0) + (ids.localDriverEmployeeId !== null ? 1 : 0)
  if (itinerary.failed.length === asked) {
    logger.error('driver tasks: every itinerary source failed', { failed: itinerary.failed })
    return c.json(
      { error: 'The order database could not be read', code: 'LEGACY_UNAVAILABLE', correlationId },
      503,
    )
  }
  // An over-cap source is partial, never silently complete.
  const failedSources = [...new Set([...itinerary.failed, ...itinerary.overCap])]

  const { facts, unavailable } = await driverTaskFacts(db, itinerary.items, today, enabled)
  const tasks = evaluateDriverTasks(facts)

  const now = new Date()
  const states =
    tasks.length === 0
      ? []
      : await db.taskState.findMany({
          where: { userId, taskKey: { in: tasks.map((t) => t.key) } },
          select: { taskKey: true, snoozedUntil: true, dismissedAt: true },
        })
  const hiddenKeys = new Set(
    states
      .filter((s) => s.dismissedAt !== null || (s.snoozedUntil !== null && s.snoozedUntil > now))
      .map((s) => s.taskKey),
  )
  const visible = tasks.filter((t) => !hiddenKeys.has(t.key))

  return c.json({
    data: visible.map((t) => ({ ...t, bucket: taskBucket(t.due, today) })),
    meta: { ...meta, failedSources, unavailable, hidden: tasks.length - visible.length },
  })
})

meTasksHandler.put('/state', async (c) => {
  const parsed = StateBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return validationError(c, parsed.error)
  const userId = c.get('userId')
  if (!userId) return driverNotMapped(c)
  const tenantId = c.get('tenantId')
  const { key, snoozedUntil, dismissed } = parsed.data

  const data = {
    ...(snoozedUntil !== undefined
      ? { snoozedUntil: snoozedUntil === null ? null : new Date(snoozedUntil) }
      : {}),
    ...(dismissed !== undefined ? { dismissedAt: dismissed ? new Date() : null } : {}),
  }
  const row = await c.get('db').taskState.upsert({
    where: { tenantId_userId_taskKey: { tenantId, userId, taskKey: key } },
    create: { tenantId, userId, taskKey: key, ...data },
    update: data,
    select: { taskKey: true, snoozedUntil: true, dismissedAt: true },
  })
  return c.json({
    data: {
      key: row.taskKey,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
    },
  })
})
