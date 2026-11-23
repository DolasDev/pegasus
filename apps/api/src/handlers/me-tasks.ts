// ---------------------------------------------------------------------------
// Driver To Do — `GET /api/v1/me/tasks` and `PUT /api/v1/me/tasks/state`.
//
// The caller's open tasks, computed on read from their itinerary, their act
// facts and the order documents by the tenant's enabled built-in rules
// (@pegasus/domain tasks). Nothing is stored except each user's snooze /
// dismiss / blocked state (TaskState). Plan:
// plans/todo/task-queue-and-activity-feed.md Phases 1 and 2b.
//
// Same gate as /onprem/longhaul/me/itinerary — not Cedar: the caller reads
// only their own work, through the driver ids an admin mapped on their
// TenantUser (403 DRIVER_NOT_MAPPED otherwise).
//
// ONE legacy read per load (the itinerary batch), and none at all when the
// tenant has no rule enabled.
//
// BLOCKED (andon, TQ-D2): a driver can mark a task blocked with a reason. The
// transition not-blocked → blocked notifies the tenant's operations users
// (Steve, 2026-11-18). Because it reaches other people, blocking re-evaluates
// the caller's tasks and refuses a key that isn't one of them (fail closed) —
// snooze/dismiss need no such check, they only touch the caller's own row.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  DRIVER_TASK_RULE_LABELS,
  evaluateDriverTasks,
  isDriverTaskRuleId,
  taskBucket,
  type DriverTaskRuleId,
  type TaskSpec,
} from '@pegasus/domain'
import type { AppEnv } from '../types'
import { getAppSettings } from '../lib/app-settings'
import { legacyConnectionString } from '../lib/chat-access'
import { fetchItinerary } from '../lib/itinerary/fetch'
import { driverTaskFacts } from '../lib/tasks/driver-task-facts'
import { hasOperationsRole } from '../lib/longhaul-read-scope'
import { notify } from '../lib/notify'
import { kickPushForwarder } from '../lib/push-forward-invoke'
import { logger } from '../lib/logger'
import { AUTHOR_SELECT, displayName } from '../repositories/chat.repository'
import { createCompanyRepository } from '../repositories/company.repository'
import { legacyOperationsIdReader, resolveMoveDispatcher } from '../lib/move-dispatcher'
import { callerDriverIds, driverNotMapped } from './longhaul-cloud/itinerary'

/** How far back an unfinished act still asks to be finished. Older ones drop off. */
export const TASK_LOOKBACK_DAYS = 14

/** Longest blocked reason. */
export const BLOCK_REASON_MAX = 500

const DAY_MS = 86_400_000

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`)
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
  }, 'not a calendar day')

/** The driver's local day must be within a day of the server's (time zones, not time travel). */
const driverDay = isoDay.refine(
  (v) =>
    Math.abs(Date.parse(`${v}T00:00:00Z`) - Date.parse(new Date().toISOString().slice(0, 10))) <=
    DAY_MS,
  'must be within a day of today',
)

const TasksQuery = z.object({ today: driverDay })

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
    /** Mark blocked with a reason, or null to unblock. */
    blocked: z
      .object({ reason: z.string().trim().min(1).max(BLOCK_REASON_MAX) })
      .nullable()
      .optional(),
    /** The driver's local day — required when blocking (the task is re-evaluated). */
    today: driverDay.optional(),
  })
  .refine(
    (b) => b.snoozedUntil !== undefined || b.dismissed !== undefined || b.blocked !== undefined,
    { message: 'set snoozedUntil, dismissed, blocked, or a combination' },
  )
  .refine((b) => !b.blocked || b.today !== undefined, {
    message: 'today is required to block a task',
    path: ['today'],
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

interface TasksMeta {
  today: string
  from: string
  to: string
  enabledRules: DriverTaskRuleId[]
  failedSources: string[]
  unavailable: string[]
  hidden: number
}

/**
 * The caller's open tasks for `today` (before snooze / dismiss / blocked), or
 * the error response to return. Shared by GET and by blocking.
 */
async function computeMyTasks(
  c: Context<AppEnv>,
  today: string,
): Promise<{ tasks: TaskSpec[]; meta: TasksMeta } | { response: Response }> {
  const correlationId = c.get('correlationId')
  const db = c.get('db')

  const ids = await callerDriverIds(c)
  if (!ids || !c.get('userId')) return { response: driverNotMapped(c) }

  const settings = await getAppSettings(db, c.get('tenantId'))
  const enabled = new Set<DriverTaskRuleId>(settings.operations.driverTaskRules ?? [])
  const from = addDays(today, -TASK_LOOKBACK_DAYS)
  const meta: TasksMeta = {
    today,
    from,
    to: today,
    enabledRules: [...enabled],
    failedSources: [],
    unavailable: [],
    hidden: 0,
  }
  if (enabled.size === 0) return { tasks: [], meta }

  const cs = await legacyConnectionString(c.get('tenantId'))
  if (!cs) {
    return {
      response: c.json(
        {
          error: 'Legacy database not configured for this tenant',
          code: 'MSSQL_NOT_CONFIGURED',
          correlationId,
        },
        422,
      ),
    }
  }

  const itinerary = await fetchItinerary(cs, { from, to: today, ...ids })
  const asked =
    (ids.longhaulDriverId !== null ? 2 : 0) + (ids.localDriverEmployeeId !== null ? 1 : 0)
  if (itinerary.failed.length === asked) {
    logger.error('driver tasks: every itinerary source failed', { failed: itinerary.failed })
    return {
      response: c.json(
        {
          error: 'The order database could not be read',
          code: 'LEGACY_UNAVAILABLE',
          correlationId,
        },
        503,
      ),
    }
  }
  // An over-cap source is partial, never silently complete.
  meta.failedSources = [...new Set([...itinerary.failed, ...itinerary.overCap])]

  const { facts, unavailable } = await driverTaskFacts(db, itinerary.items, today, enabled)
  meta.unavailable = unavailable
  return { tasks: evaluateDriverTasks(facts), meta }
}

export const meTasksHandler = new Hono<AppEnv>()

meTasksHandler.get('/', async (c) => {
  const parsed = TasksQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)
  const { today } = parsed.data
  const computed = await computeMyTasks(c, today)
  if ('response' in computed) return computed.response
  const { tasks, meta } = computed
  if (tasks.length === 0) return c.json({ data: [], meta })

  const now = new Date()
  const states = await c.get('db').taskState.findMany({
    where: { userId: c.get('userId') as string, taskKey: { in: tasks.map((t) => t.key) } },
    select: {
      taskKey: true,
      snoozedUntil: true,
      dismissedAt: true,
      blockedAt: true,
      blockReason: true,
    },
  })
  const byKey = new Map(states.map((s) => [s.taskKey, s]))
  const rows = []
  let hidden = 0
  for (const t of tasks) {
    const s = byKey.get(t.key)
    const blocked =
      s?.blockedAt != null ? { reason: s.blockReason ?? '', at: s.blockedAt.toISOString() } : null
    // A blocked task stays on the list, whatever its snooze / dismiss.
    const hiddenNow =
      !blocked &&
      s != null &&
      (s.dismissedAt !== null || (s.snoozedUntil !== null && s.snoozedUntil > now))
    if (hiddenNow) {
      hidden += 1
      continue
    }
    rows.push({ ...t, bucket: taskBucket(t.due, today), blocked })
  }
  return c.json({ data: rows, meta: { ...meta, hidden } })
})

/**
 * The tenant's operations users who hear about a blocked task: active,
 * human (not service accounts), holding an operations role — minus the driver.
 * TenantUser is not auto-scoped, so the tenant is bound here.
 */
async function operationsRecipients(c: Context<AppEnv>, exceptUserId: string): Promise<string[]> {
  const users = await c.get('db').tenantUser.findMany({
    where: {
      tenantId: c.get('tenantId'),
      status: { not: 'DEACTIVATED' },
      isServiceAccount: false,
      id: { not: exceptUserId },
    },
    select: { id: true, roleNames: true },
  })
  return users.filter((u) => hasOperationsRole(u.roleNames)).map((u) => u.id)
}

/** Who heard about a block, and how they were chosen. */
type BlockedRecipients = { userIds: string[]; via: 'dispatcher' | 'operations-roles' }

/**
 * A blocked task goes to the move's dispatcher (`sales.operations_id` → their
 * linked cloud user; task queue Phase 3a step 4b, Steve 2026-11-20). It falls
 * back to the operations roles when the order has no dispatcher, the dispatcher
 * has no linked active cloud user, the dispatcher is the driver themselves, or
 * the lookup fails. A stopped driver must always reach someone. One legacy read;
 * run before the transaction, never inside it.
 */
async function blockedRecipients(
  c: Context<AppEnv>,
  orderNum: number,
  driverUserId: string,
): Promise<BlockedRecipients> {
  const tenantId = c.get('tenantId')
  const db = c.get('db')
  try {
    const target = await createCompanyRepository(db).getDefaultTarget()
    if (target) {
      const dispatcher = await resolveMoveDispatcher({
        db,
        tenantId,
        companyId: target.company.id,
        orderNum,
        readOperationsId: legacyOperationsIdReader(tenantId),
      })
      if (
        dispatcher.found &&
        dispatcher.tenantUserId !== null &&
        dispatcher.tenantUserId !== driverUserId
      ) {
        return { userIds: [dispatcher.tenantUserId], via: 'dispatcher' }
      }
    }
  } catch (err) {
    logger.warn("blocked task: the move's dispatcher couldn't be resolved; telling operations", {
      tenantId,
      orderNum,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { userIds: await operationsRecipients(c, driverUserId), via: 'operations-roles' }
}

meTasksHandler.put('/state', async (c) => {
  const parsed = StateBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return validationError(c, parsed.error)
  const userId = c.get('userId')
  if (!userId) return driverNotMapped(c)
  const tenantId = c.get('tenantId')
  const db = c.get('db')
  const { key, snoozedUntil, dismissed, blocked, today } = parsed.data

  // Blocking reaches other people, so the key must be one of the caller's tasks now.
  let task: TaskSpec | undefined
  if (blocked) {
    const computed = await computeMyTasks(c, today as string)
    if ('response' in computed) return computed.response
    task = computed.tasks.find((t) => t.key === key)
    if (!task) {
      return c.json(
        {
          error: 'That task is not on your To Do',
          code: 'NOT_FOUND',
          correlationId: c.get('correlationId'),
        },
        404,
      )
    }
  }

  const existing = await db.taskState.findFirst({
    where: { userId, taskKey: key },
    select: { blockedAt: true },
  })
  const now = new Date()
  const becomesBlocked = blocked != null && existing?.blockedAt == null
  const recipients =
    becomesBlocked && task ? await blockedRecipients(c, task.orderNum, userId) : null

  const data = {
    ...(snoozedUntil !== undefined
      ? { snoozedUntil: snoozedUntil === null ? null : new Date(snoozedUntil) }
      : {}),
    ...(dismissed !== undefined ? { dismissedAt: dismissed ? now : null } : {}),
    ...(blocked === null ? { blockedAt: null, blockReason: null } : {}),
    // Re-blocking keeps the original time (it's still the same stop) but takes the new reason.
    ...(blocked
      ? { blockReason: blocked.reason, ...(becomesBlocked ? { blockedAt: now } : {}) }
      : {}),
  }

  const { row, notified } = await db.$transaction(async (tx) => {
    const row = await tx.taskState.upsert({
      where: { tenantId_userId_taskKey: { tenantId, userId, taskKey: key } },
      create: { tenantId, userId, taskKey: key, ...data },
      update: data,
      select: {
        id: true,
        taskKey: true,
        snoozedUntil: true,
        dismissedAt: true,
        blockedAt: true,
        blockReason: true,
      },
    })
    let notified = 0
    let pushed = 0
    if (becomesBlocked && task && blocked && recipients) {
      const me = await tx.tenantUser.findFirst({
        where: { id: userId, tenantId },
        select: AUTHOR_SELECT,
      })
      const who = me ? displayName(me) : 'A driver'
      const rule = isDriverTaskRuleId(task.rule) ? DRIVER_TASK_RULE_LABELS[task.rule] : task.title
      for (const recipientUserId of recipients.userIds) {
        const r = await notify(tx, tenantId, {
          type: 'task.blocked',
          recipient: { userId: recipientUserId },
          title: `${who} is blocked on #${task.orderNum}`,
          body: `${task.title} (${rule}): ${blocked.reason}`,
          data: { type: 'task.blocked', orderNum: String(task.orderNum), taskKey: key },
          actorUserId: userId,
          entityType: 'order',
          entityId: String(task.orderNum),
          groupKey: `order:${task.orderNum}`,
          dedupeKey: `task.blocked:${row.id}:${now.getTime()}:${recipientUserId}`,
        })
        if (r.notificationId || r.pushId) notified += 1
        if (r.pushId) pushed += 1
      }
    }
    return { row, notified: { count: notified, pushed } }
  })
  if (notified.pushed > 0) await kickPushForwarder()

  return c.json({
    data: {
      key: row.taskKey,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
      blocked:
        row.blockedAt != null
          ? { reason: row.blockReason ?? '', at: row.blockedAt.toISOString() }
          : null,
      /** How many people were told (only on a new block). */
      notified: becomesBlocked ? notified.count : 0,
      /** Who they were: the move's dispatcher, or the operations roles as a fallback. Null when no one was told. */
      notifiedVia: recipients?.via ?? null,
    },
  })
})
