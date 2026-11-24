// ---------------------------------------------------------------------------
// Support — /api/v1/support (plan: plans/in-progress/support-channel.md, 1a)
//
// A tenant user's own threads with the platform operator. Every role may open
// one (57-support-shared.cedar); a thread is visible ONLY to the user who
// opened it (D9), and anyone else — same tenant or not — gets 404, never 403,
// so thread ids can't be probed.
//
//   GET  /threads                 the caller's threads, newest activity first
//   POST /threads                 open a thread with its first message
//                                 { clientMessageId, body, subject?, context? }
//   GET  /threads/:id             thread + every message; marks it read
//   POST /threads/:id/messages    follow-up { clientMessageId, body }
//
// Gated by SUPPORT_ENABLED (404 NOT_FOUND when off). Mounted on the
// Cognito-only tenant router, and an apiClient caller is refused, so API
// clients and service accounts never reach it.
//
// A customer message alerts the operator (SNS, lib/support-alert) after the
// commit, debounced by shouldAlertOperator. The alert is best-effort: a failure
// leaves lastOperatorAlertAt unstamped, so the next message tries again.
//
// The operator appears to the customer only as "Pegasus support": their email
// and Cognito sub never leave the API on this side.
// ---------------------------------------------------------------------------

import { Hono, type Context, type Next } from 'hono'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import {
  isValidClientMessageId,
  sanitizeSupportContext,
  shouldAlertOperator,
  subjectFromBody,
  validateSupportBody,
  validateSupportSubject,
} from '@pegasus/domain'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import { alertOperator, supportEnabled } from '../lib/support-alert'
import { displayName } from '../repositories/chat.repository'
import {
  THREAD_SELECT,
  appendMessage,
  findMessageByClientId,
  findThread,
  isUnreadFor,
  isUniqueViolation,
  listMessages,
  statusOf,
  type SupportMessageRow,
  type SupportThreadRow,
} from '../repositories/support.repository'

type C = Context<AppEnv>

export const OPERATOR_DISPLAY_NAME = 'Pegasus support'
const MAX_THREADS = 100

export const supportHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

supportHandler.use('*', async (c: C, next: Next) => {
  if (!supportEnabled()) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  if (c.get('apiClient')) {
    return c.json(
      { error: 'Support is for signed-in users only', code: 'SUPPORT_HUMANS_ONLY' },
      403,
    )
  }
  if (!c.get('userId')) {
    return c.json({ error: 'No user record for this login', code: 'USER_NOT_FOUND' }, 403)
  }
  await next()
})

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function threadDto(t: SupportThreadRow) {
  return {
    id: t.id,
    subject: t.subject,
    status: statusOf(t),
    lastMessageAt: t.lastMessageAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    unread: isUnreadFor('customer', t),
    pageUrl: t.pageUrl,
  }
}

function messageDto(m: SupportMessageRow) {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    authorKind: m.authorKind,
    authorName:
      m.authorKind === 'operator'
        ? OPERATOR_DISPLAY_NAME
        : m.author
          ? displayName(m.author)
          : 'Former user',
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }
}

const notFound = (c: C) =>
  c.json({ error: 'Support thread not found', code: 'SUPPORT_THREAD_NOT_FOUND' }, 404)

const badClientId = (c: C) =>
  c.json(
    {
      error: 'clientMessageId must be 8–64 letters, digits, "_" or "-"',
      code: 'VALIDATION_ERROR',
    },
    400,
  )

/** The caller's TenantUser id. The gate above has already refused a request without one. */
function callerId(c: C): string {
  return c.get('userId') ?? ''
}

/** The caller's own thread, or null — never someone else's. */
async function ownThread(c: C, id: string | undefined): Promise<SupportThreadRow | null> {
  if (!id) return null
  const t = await findThread(c.get('db'), id)
  return t && t.openedByUserId === callerId(c) ? t : null
}

/** Alerts the operator if the debounce allows it, and stamps the thread when sent. */
async function maybeAlert(
  c: C,
  thread: Pick<SupportThreadRow, 'id' | 'subject' | 'lastOperatorAlertAt'>,
  previousStatus: Parameters<typeof shouldAlertOperator>[0]['previousStatus'],
): Promise<void> {
  const now = new Date()
  if (!shouldAlertOperator({ previousStatus, lastAlertAt: thread.lastOperatorAlertAt, now })) {
    return
  }
  // Tenant is not a tenant-scoped model: name it by id.
  const tenant = await c.get('db').tenant.findUnique({
    where: { id: c.get('tenantId') },
    select: { name: true },
  })
  const sent = await alertOperator({
    id: thread.id,
    subject: thread.subject,
    tenantName: tenant?.name ?? c.get('tenantId'),
    isNewThread: previousStatus === null,
  })
  if (sent) {
    await c.get('db').supportThread.update({
      where: { id: thread.id },
      data: { lastOperatorAlertAt: now },
    })
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

supportHandler.get('/threads', requirePermission(Actions.ReadSupport), async (c) => {
  const rows = await c.get('db').supportThread.findMany({
    where: { openedByUserId: callerId(c) },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: MAX_THREADS,
    select: THREAD_SELECT,
  })
  return c.json({ data: rows.map(threadDto) })
})

const OpenBody = z.object({
  clientMessageId: z.unknown(),
  body: z.unknown(),
  subject: z.unknown().optional(),
  context: z.unknown().optional(),
})

supportHandler.post('/threads', requirePermission(Actions.PostSupport), async (c) => {
  const parsed = OpenBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || !isValidClientMessageId(parsed.data.clientMessageId)) {
    return badClientId(c)
  }
  const clientMessageId = parsed.data.clientMessageId
  // DomainError (empty / too long) bubbles to app.onError → 422.
  const body = validateSupportBody(parsed.data.body)
  const subject =
    parsed.data.subject === undefined || parsed.data.subject === null
      ? subjectFromBody(body)
      : validateSupportSubject(parsed.data.subject)
  const context = sanitizeSupportContext(parsed.data.context)

  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const userId = callerId(c)

  // Idempotent replay: the same first-message id from the same user returns
  // the thread it already opened. The unique (openedByUserId,
  // openClientMessageId) makes this hold even when two sends race.
  const replayOf = () =>
    db.supportThread.findUnique({
      where: {
        openedByUserId_openClientMessageId: {
          openedByUserId: userId,
          openClientMessageId: clientMessageId,
        },
      },
      select: { id: true },
    })
  const replay = await replayOf()
  if (replay) return replayThread(c, replay.id)

  let created: { thread: SupportThreadRow; message: SupportMessageRow }
  try {
    created = await (db as PrismaClient).$transaction(async (tx) => {
      const thread = await tx.supportThread.create({
        data: {
          tenantId,
          openedByUserId: userId,
          openClientMessageId: clientMessageId,
          subject,
          pageUrl: context.pageUrl,
          userAgent: context.userAgent,
          appVersion: context.appVersion,
        },
        select: THREAD_SELECT,
      })
      const { message } = await appendMessage(
        tx,
        thread,
        { kind: 'customer', userId },
        clientMessageId,
        body,
      )
      const fresh = await tx.supportThread.findUniqueOrThrow({
        where: { id: thread.id },
        select: THREAD_SELECT,
      })
      return { thread: fresh, message }
    })
  } catch (err) {
    // A concurrent resend lost the race to the unique index.
    if (isUniqueViolation(err)) {
      const winner = await replayOf()
      if (winner) return replayThread(c, winner.id)
    }
    throw err
  }

  await maybeAlert(c, created.thread, null)
  return c.json(
    { data: { thread: threadDto(created.thread), message: messageDto(created.message) } },
    201,
  )
})

async function replayThread(c: C, threadId: string): Promise<Response> {
  const thread = await ownThread(c, threadId)
  if (!thread) return notFound(c)
  const [first] = await listMessages(c.get('db'), threadId)
  return c.json({ data: { thread: threadDto(thread), message: first ? messageDto(first) : null } })
}

supportHandler.get('/threads/:id', requirePermission(Actions.ReadSupport), async (c) => {
  const thread = await ownThread(c, c.req.param('id'))
  if (!thread) return notFound(c)
  const messages = await listMessages(c.get('db'), thread.id)
  const readAt = new Date()
  await c.get('db').supportThread.update({
    where: { id: thread.id },
    data: { customerLastReadAt: readAt },
  })
  return c.json({
    data: {
      thread: threadDto({ ...thread, customerLastReadAt: readAt }),
      messages: messages.map(messageDto),
    },
  })
})

const PostBody = z.object({ clientMessageId: z.unknown(), body: z.unknown() })

supportHandler.post('/threads/:id/messages', requirePermission(Actions.PostSupport), async (c) => {
  const parsed = PostBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success || !isValidClientMessageId(parsed.data.clientMessageId)) {
    return badClientId(c)
  }
  const clientMessageId = parsed.data.clientMessageId
  const body = validateSupportBody(parsed.data.body)

  const thread = await ownThread(c, c.req.param('id'))
  if (!thread) return notFound(c)
  const db = c.get('db')

  const replay = await findMessageByClientId(db, thread.id, 'customer', clientMessageId)
  if (replay) return c.json({ data: messageDto(replay) }, 200)

  let result: Awaited<ReturnType<typeof appendMessage>>
  try {
    result = await (db as PrismaClient).$transaction((tx) =>
      appendMessage(
        tx,
        thread,
        { kind: 'customer', userId: thread.openedByUserId },
        clientMessageId,
        body,
      ),
    )
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findMessageByClientId(db, thread.id, 'customer', clientMessageId)
      if (winner) return c.json({ data: messageDto(winner) }, 200)
    }
    throw err
  }

  await maybeAlert(c, thread, result.previousStatus)
  return c.json({ data: messageDto(result.message) }, 201)
})
