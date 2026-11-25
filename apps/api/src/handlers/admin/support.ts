// ---------------------------------------------------------------------------
// Admin support inbox — /api/admin/support (plan: support-channel.md, 1a)
//
// The platform operator's view of every tenant's support threads. PLATFORM_ADMIN
// only (adminRouter's middleware). Uses the base Prisma singleton across tenants;
// every write takes `tenantId` from the thread row, never from the request.
//
//   GET   /threads?status=      inbox, newest activity first. status is one of
//                               SUPPORT_THREAD_STATUSES or `open` (not resolved)
//   GET   /threads/:id          thread + diagnostics + every message; marks read
//   POST  /threads/:id/messages reply { clientMessageId, body } — notifies the
//                               customer (`support.reply`, feed by default)
//   PATCH /threads/:id          { status } — e.g. resolve, or reopen
//
// Gated by SUPPORT_ENABLED (404 NOT_FOUND when off), same as the tenant side.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import {
  SUPPORT_THREAD_STATUSES,
  isValidClientMessageId,
  validateSupportBody,
} from '@pegasus/domain'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { supportEnabled } from '../../lib/support-alert'
import { notify } from '../../lib/notify'
import { kickPushForwarder } from '../../lib/push-forward-invoke'
import { displayName, AUTHOR_SELECT } from '../../repositories/chat.repository'
import {
  THREAD_SELECT,
  appendMessage,
  findMessageByClientId,
  isUnreadFor,
  isUniqueViolation,
  listMessages,
  statusOf,
  type SupportMessageRow,
  type SupportThreadRow,
} from '../../repositories/support.repository'

type C = Context<AdminEnv>

const MAX_INBOX = 200
const PREVIEW_CHARS = 140

export const adminSupportRouter = new Hono<AdminEnv>()

adminSupportRouter.use('*', async (c, next) => {
  if (!supportEnabled()) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  await next()
})

const INBOX_SELECT = {
  ...THREAD_SELECT,
  tenant: { select: { id: true, name: true } },
  openedBy: { select: AUTHOR_SELECT },
} as const satisfies Prisma.SupportThreadSelect

type InboxRow = Prisma.SupportThreadGetPayload<{ select: typeof INBOX_SELECT }>

function inboxDto(t: InboxRow) {
  return {
    id: t.id,
    subject: t.subject,
    status: statusOf(t),
    lastMessageAt: t.lastMessageAt.toISOString(),
    lastAuthorKind: t.lastAuthorKind,
    createdAt: t.createdAt.toISOString(),
    unread: isUnreadFor('operator', t),
    tenant: t.tenant,
    openedBy: { id: t.openedBy.id, name: displayName(t.openedBy), email: t.openedBy.email },
  }
}

function detailDto(t: InboxRow) {
  return { ...inboxDto(t), pageUrl: t.pageUrl, userAgent: t.userAgent, appVersion: t.appVersion }
}

function messageDto(m: SupportMessageRow) {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    authorKind: m.authorKind,
    authorName:
      m.authorKind === 'operator'
        ? (m.operatorEmail ?? 'Operator')
        : m.author
          ? displayName(m.author)
          : 'Former user',
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }
}

const notFound = (c: C) =>
  c.json({ error: 'Support thread not found', code: 'SUPPORT_THREAD_NOT_FOUND' }, 404)

function findInboxThread(id: string): Promise<InboxRow | null> {
  return db.supportThread.findUnique({ where: { id }, select: INBOX_SELECT })
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const StatusFilter = z.enum([...SUPPORT_THREAD_STATUSES, 'open']).optional()

adminSupportRouter.get('/threads', async (c) => {
  const parsed = StatusFilter.safeParse(c.req.query('status') || undefined)
  if (!parsed.success) {
    return c.json(
      {
        error: `status must be one of ${[...SUPPORT_THREAD_STATUSES, 'open'].join(', ')}`,
        code: 'VALIDATION_ERROR',
      },
      400,
    )
  }
  const status = parsed.data
  const where: Prisma.SupportThreadWhereInput =
    status === undefined ? {} : status === 'open' ? { status: { not: 'resolved' } } : { status }
  const rows = await db.supportThread.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: MAX_INBOX,
    select: INBOX_SELECT,
  })
  return c.json({ data: rows.map(inboxDto) })
})

adminSupportRouter.get('/threads/:id', async (c) => {
  const thread = await findInboxThread(c.req.param('id'))
  if (!thread) return notFound(c)
  const messages = await listMessages(db, thread.id)
  const readAt = new Date()
  await db.supportThread.update({ where: { id: thread.id }, data: { operatorLastReadAt: readAt } })
  return c.json({
    data: {
      thread: detailDto({ ...thread, operatorLastReadAt: readAt }),
      messages: messages.map(messageDto),
    },
  })
})

const ReplyBody = z.object({ clientMessageId: z.unknown(), body: z.unknown() })

adminSupportRouter.post('/threads/:id/messages', async (c) => {
  const parsed = ReplyBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || !isValidClientMessageId(parsed.data.clientMessageId)) {
    return c.json(
      {
        error: 'clientMessageId must be 8–64 letters, digits, "_" or "-"',
        code: 'VALIDATION_ERROR',
      },
      400,
    )
  }
  const clientMessageId = parsed.data.clientMessageId
  // DomainError (empty / too long) bubbles to app.onError → 422.
  const body = validateSupportBody(parsed.data.body)

  const thread = await db.supportThread.findUnique({
    where: { id: c.req.param('id') },
    select: THREAD_SELECT,
  })
  if (!thread) return notFound(c)

  const replay = await findMessageByClientId(db, thread.id, 'operator', clientMessageId)
  if (replay) return c.json({ data: messageDto(replay) }, 200)

  let message: SupportMessageRow
  let pushId: string | null
  try {
    ;({ message, pushId } = await db.$transaction(async (tx) => {
      const { message } = await appendMessage(
        tx,
        thread,
        { kind: 'operator', sub: c.get('adminSub'), email: c.get('adminEmail') },
        clientMessageId,
        body,
      )
      const preview = body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS - 1)}…` : body
      // Same transaction: the customer's feed row commits with the reply.
      const { pushId } = await notify(tx, thread.tenantId, {
        type: 'support.reply',
        recipient: { userId: thread.openedByUserId },
        title: `Pegasus support replied: ${thread.subject}`,
        body: preview,
        data: { type: 'support.reply', route: `/support/${thread.id}`, threadId: thread.id },
        entityType: 'support_thread',
        entityId: thread.id,
        groupKey: `support_thread:${thread.id}`,
        dedupeKey: `support.reply:${message.id}`,
      })
      return { message, pushId }
    }))
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findMessageByClientId(db, thread.id, 'operator', clientMessageId)
      if (winner) return c.json({ data: messageDto(winner) }, 200)
    }
    throw err
  }

  if (pushId) await kickPushForwarder()
  return c.json({ data: messageDto(message) }, 201)
})

const PatchBody = z.object({ status: z.enum(SUPPORT_THREAD_STATUSES) })

adminSupportRouter.patch('/threads/:id', async (c) => {
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json(
      {
        error: `status must be one of ${SUPPORT_THREAD_STATUSES.join(', ')}`,
        code: 'VALIDATION_ERROR',
      },
      400,
    )
  }
  const existing: SupportThreadRow | null = await db.supportThread.findUnique({
    where: { id: c.req.param('id') },
    select: THREAD_SELECT,
  })
  if (!existing) return notFound(c)
  await db.supportThread.update({
    where: { id: existing.id },
    data: { status: parsed.data.status },
  })
  const updated = await findInboxThread(existing.id)
  return c.json({ data: inboxDto(updated!) })
})
