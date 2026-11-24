// ---------------------------------------------------------------------------
// Activity feed — the caller's own notifications (task queue plan, Phase 2).
//
//   GET  /api/v1/me/activity?filter=all|unread&cursor=&limit=
//   GET  /api/v1/me/activity/unseen-count      the bell's number
//   POST /api/v1/me/activity/seen              opening the bell clears it
//   POST /api/v1/me/activity/:id/read
//   POST /api/v1/me/activity/read-all
//   GET  /api/v1/me/notification-preferences
//   PUT  /api/v1/me/notification-preferences   { type, channel }
//
// Self-scoped like the rest of /me: every query filters on the caller's own
// userId, through the tenant-scoped client. Rows are written by lib/notify.ts.
// Postgres only — no legacy read — so the app may refresh the bell freely.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_INFO,
  effectiveChannel,
  isNotificationChannel,
  type NotificationType,
} from '@pegasus/domain'
import type { AppEnv } from '../types'
import { supportEnabled } from '../lib/support-alert'
import { AUTHOR_SELECT, displayName } from '../repositories/chat.repository'

export const ACTIVITY_PAGE_MAX = 50

const ListQuery = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).default(30),
})

const PreferenceBody = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
})

function validationError(c: Context<AppEnv>, error: z.ZodError) {
  return c.json(
    {
      error: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
      code: 'VALIDATION_ERROR',
      correlationId: c.get('correlationId'),
    },
    400,
  )
}

function noUser(c: Context<AppEnv>) {
  return c.json(
    {
      error: 'No user on this request',
      code: 'UNAUTHORIZED',
      correlationId: c.get('correlationId'),
    },
    401,
  )
}

const ROW_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  entityType: true,
  entityId: true,
  groupKey: true,
  createdAt: true,
  seenAt: true,
  readAt: true,
  actor: { select: AUTHOR_SELECT },
} as const satisfies Prisma.NotificationSelect

type Row = Prisma.NotificationGetPayload<{ select: typeof ROW_SELECT }>

function dto(r: Row) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    data: r.data,
    entityType: r.entityType,
    entityId: r.entityId,
    groupKey: r.groupKey,
    actorName: r.actor ? displayName(r.actor) : null,
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt?.toISOString() ?? null,
    readAt: r.readAt?.toISOString() ?? null,
  }
}

export const meActivityHandler = new Hono<AppEnv>()

meActivityHandler.get('/', async (c) => {
  const parsed = ListQuery.safeParse(c.req.query())
  if (!parsed.success) return validationError(c, parsed.error)
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const { filter, cursor, limit } = parsed.data
  const db = c.get('db')

  const where: Prisma.NotificationWhereInput = {
    recipientUserId: userId,
    ...(filter === 'unread' ? { readAt: null } : {}),
  }
  const rows = await db.notification.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: ROW_SELECT,
  })
  const page = rows.slice(0, limit)
  const unseen = await db.notification.count({ where: { recipientUserId: userId, seenAt: null } })
  return c.json({
    data: page.map(dto),
    meta: {
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      unseen,
    },
  })
})

meActivityHandler.get('/unseen-count', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const unseen = await c
    .get('db')
    .notification.count({ where: { recipientUserId: userId, seenAt: null } })
  return c.json({ data: { unseen } })
})

meActivityHandler.post('/seen', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const { count } = await c.get('db').notification.updateMany({
    where: { recipientUserId: userId, seenAt: null },
    data: { seenAt: new Date() },
  })
  return c.json({ data: { updated: count } })
})

meActivityHandler.post('/read-all', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const now = new Date()
  const db = c.get('db')
  await db.notification.updateMany({
    where: { recipientUserId: userId, seenAt: null },
    data: { seenAt: now },
  })
  const { count } = await db.notification.updateMany({
    where: { recipientUserId: userId, readAt: null },
    data: { readAt: now },
  })
  return c.json({ data: { updated: count } })
})

meActivityHandler.post('/:id/read', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const id = c.req.param('id')
  if (!z.string().uuid().safeParse(id).success) {
    return c.json(
      { error: 'Not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
      404,
    )
  }
  const db = c.get('db')
  const row = await db.notification.findFirst({
    where: { id, recipientUserId: userId },
    select: { id: true, seenAt: true, readAt: true },
  })
  if (!row) {
    return c.json(
      { error: 'Not found', code: 'NOT_FOUND', correlationId: c.get('correlationId') },
      404,
    )
  }
  if (row.readAt === null) {
    const now = new Date()
    await db.notification.updateMany({
      where: { id, recipientUserId: userId },
      data: { readAt: now, ...(row.seenAt === null ? { seenAt: now } : {}) },
    })
  }
  return c.json({ data: { id } })
})

export const meNotificationPreferencesHandler = new Hono<AppEnv>()

async function preferenceList(c: Context<AppEnv>, userId: string) {
  const rows = await c.get('db').notificationPreference.findMany({
    where: { userId },
    select: { type: true, channel: true },
  })
  const chosen = new Map(rows.map((r) => [r.type, r.channel]))
  // A feature's type is listed only where the feature is on, so a dark deploy
  // shows nothing new in anyone's settings (web or phone).
  const listed = NOTIFICATION_TYPES.filter((t) => t !== 'support.reply' || supportEnabled())
  return listed.map((type: NotificationType) => {
    const own = chosen.get(type)
    return {
      type,
      label: NOTIFICATION_TYPE_INFO[type].label,
      defaultChannel: NOTIFICATION_TYPE_INFO[type].defaultChannel,
      channel: effectiveChannel(type, isNotificationChannel(own) ? own : null),
    }
  })
}

meNotificationPreferencesHandler.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  return c.json({ data: await preferenceList(c, userId) })
})

meNotificationPreferencesHandler.put('/', async (c) => {
  const parsed = PreferenceBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return validationError(c, parsed.error)
  const userId = c.get('userId')
  if (!userId) return noUser(c)
  const tenantId = c.get('tenantId')
  const { type, channel } = parsed.data
  await c.get('db').notificationPreference.upsert({
    where: { tenantId_userId_type: { tenantId, userId, type } },
    create: { tenantId, userId, type, channel },
    update: { channel },
  })
  return c.json({ data: await preferenceList(c, userId) })
})
