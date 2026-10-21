// ---------------------------------------------------------------------------
// Move chat — /api/v1/chat
//
// A chat room per move (v1: a legacy order, `shipment/:orderNum`). Every tenant
// employee can read and post in every room; a driver-scoped login (a login
// whose only role is `driver`, employee or contractor alike) only in the moves
// they are assigned to — longhaul trips or local dispatch driver slots. Plan:
// plans/in-progress/move-chat-api.md (D1–D6).
//
// Mounted on the Cognito-only tenant router, so API clients and service
// accounts can't reach it; the handler also refuses an `apiClient` caller.
//
// Access for driver-scoped callers needs the legacy database (lib/chat-access).
// The 3-second poll must not go there each time, so a passing check is stamped
// on the caller's ChatRoomMember row (`accessCheckedAt`) and trusted for
// ACCESS_CACHE_MS. Employees never touch the legacy database to read.
//
// Posting writes the message, the room's last-message pointer, the author's and
// any mentioned users' follow rows and one push outbox row per recipient in a
// single transaction, then kicks the push forwarder Lambda asynchronously
// (lib/push-forward-invoke) so they arrive in seconds rather than on the next
// minute's cron tick. The API never calls Expo itself: its SDK is ESM-only and
// would crash this CommonJS Lambda at INIT.
// ---------------------------------------------------------------------------

import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  DomainError,
  parseChatRoomRef,
  validateChatBody,
  isValidClientMessageId,
  parseMentions,
  resolveChatScope,
  resolveRecipients,
  type ChatRoomRef,
} from '@pegasus/domain'
import type { AppEnv } from '../types'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import {
  legacyConnectionString,
  driverCanReadOrder,
  driverReadableOrders,
  assignedDriverIds,
  orderExists,
  orderSummaries,
  type DriverIds,
} from '../lib/chat-access'
import { logger } from '../lib/logger'
import { enqueueChatMessagePush } from '../lib/push-triggers'
import { kickPushForwarder } from '../lib/push-forward-invoke'
import {
  AUTHOR_SELECT,
  displayName,
  findRoom,
  ensureRoom,
  findMember,
  upsertMember,
  findMessage,
  findMessageByClientId,
  listMessages,
  countUnread,
  unreadCountsByRoom,
  type ChatMessageRow,
} from '../repositories/chat.repository'

/** How long a passing driver access check is trusted (ChatRoomMember.accessCheckedAt). */
export const ACCESS_CACHE_MS = 5 * 60_000
const DEFAULT_PAGE = 50
const MAX_PAGE = 100
const INBOX_LIMIT = 100
const PREVIEW_CHARS = 140
const SUMMARY_LIMIT = 100

type C = Context<AppEnv>

// ---------------------------------------------------------------------------
// Caller + access
// ---------------------------------------------------------------------------

type Caller =
  { scope: 'employee'; userId: string } | ({ scope: 'driver'; userId: string } & DriverIds)

class ChatHttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function resolveCaller(c: C): Promise<Caller> {
  if (c.get('apiClient')) {
    throw new ChatHttpError(403, 'CHAT_HUMANS_ONLY', 'Move chat is for signed-in users only')
  }
  const userId = c.get('userId')
  if (!userId) throw new ChatHttpError(403, 'USER_NOT_FOUND', 'No user record for this login')
  const roleNames = c.get('principal')?.roleNames ?? []
  if (resolveChatScope(roleNames) === 'employee') return { scope: 'employee', userId }
  // TenantUser is not auto-scoped by the tenant client — name the tenant.
  const user = await c.get('db').tenantUser.findFirst({
    where: { id: userId, tenantId: c.get('tenantId') },
    select: { longhaulDriverId: true, localDriverEmployeeId: true },
  })
  return {
    scope: 'driver',
    userId,
    longhaulDriverId: user?.longhaulDriverId ?? null,
    localDriverEmployeeId: user?.localDriverEmployeeId ?? null,
  }
}

function parseRef(c: C): ChatRoomRef {
  try {
    return parseChatRoomRef(c.req.param('entityType') ?? '', c.req.param('entityId') ?? '')
  } catch (err) {
    if (err instanceof DomainError) throw new ChatHttpError(400, err.code, err.message)
    throw err
  }
}

const orderNumOf = (ref: ChatRoomRef): number => Number(ref.entityId)

/**
 * Throws 403 unless `caller` may use the room. A driver's check is served from
 * their member row when it is fresh; otherwise it goes to the legacy database
 * and, when the room exists, stamps the row (creating it as a follow — assigned
 * drivers follow their moves' rooms).
 */
async function assertAccess(
  c: C,
  caller: Caller,
  ref: ChatRoomRef,
  room: { id: string } | null,
): Promise<void> {
  if (caller.scope === 'employee') return
  const db = c.get('db')
  if (room) {
    const member = await findMember(db, room.id, caller.userId)
    if (
      member?.accessCheckedAt &&
      Date.now() - member.accessCheckedAt.getTime() < ACCESS_CACHE_MS
    ) {
      return
    }
  }
  const cs = await legacyConnectionString(c.get('tenantId'))
  if (!cs || !(await driverCanReadOrder(cs, orderNumOf(ref), caller))) {
    throw new ChatHttpError(403, 'CHAT_FORBIDDEN', 'You are not assigned to this move')
  }
  if (room) {
    await upsertMember(db, c.get('tenantId'), room.id, caller.userId, {
      create: { following: true },
      set: { accessCheckedAt: new Date() },
    })
  }
}

/** Runs a route body, mapping ChatHttpError to its JSON response. */
async function guarded(c: C, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ChatHttpError) {
      return c.json(
        { error: err.message, code: err.code, correlationId: c.get('correlationId') },
        err.status,
      )
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function messageDto(m: ChatMessageRow) {
  return {
    id: m.id,
    clientMessageId: m.clientMessageId,
    body: m.deletedAt ? null : m.body,
    author: { id: m.author.id, name: displayName(m.author) },
    mentionedUserIds: m.mentionedUserIds,
    createdAt: m.createdAt.toISOString(),
    deletedAt: m.deletedAt?.toISOString() ?? null,
  }
}

function roomDto(ref: ChatRoomRef, room: { id: string; lastMessageAt: Date | null } | null) {
  return {
    id: room?.id ?? null,
    entityType: ref.entityType,
    entityId: ref.entityId,
    lastMessageAt: room?.lastMessageAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const chatHandler = new Hono<AppEnv>()

const ROOM = '/rooms/:entityType/:entityId'

// GET /rooms/:entityType/:entityId — the room (or an empty one) + my membership.
chatHandler.get(ROOM, requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const room = await findRoom(db, ref)
    await assertAccess(c, caller, ref, room)
    const member = room ? await findMember(db, room.id, caller.userId) : null
    const unreadCount = room
      ? await countUnread(db, room.id, caller.userId, member?.lastReadAt ?? null)
      : 0
    return c.json({
      data: {
        room: roomDto(ref, room),
        membership: member
          ? {
              following: member.following,
              muted: member.muted,
              lastReadAt: member.lastReadAt?.toISOString() ?? null,
            }
          : null,
        unreadCount,
      },
    })
  }),
)

const ListQuery = z.object({
  after: z.string().min(1).optional(),
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
})

// GET /rooms/:entityType/:entityId/messages?after=&before=&limit=
chatHandler.get(`${ROOM}/messages`, requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const q = ListQuery.safeParse(c.req.query())
    if (!q.success || (q.data.after && q.data.before)) {
      throw new ChatHttpError(400, 'VALIDATION_ERROR', 'Pass at most one of after / before')
    }
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const room = await findRoom(db, ref)
    // No room yet means no messages to protect — answer empty BEFORE the access
    // check. A driver's check on a room-less order can't be cached (there is
    // no member row to stamp), so checking first would send every 3-second
    // poll to the legacy database. The room summary still 403s an unassigned
    // driver; all this reveals is that nobody has posted on the order yet.
    if (!room) return c.json({ data: [] })
    await assertAccess(c, caller, ref, room)

    const cursorOf = async (id: string | undefined) => {
      if (!id) return undefined
      const m = await db.chatMessage.findFirst({
        where: { id, roomId: room.id },
        select: { id: true, createdAt: true },
      })
      if (!m) throw new ChatHttpError(400, 'CHAT_BAD_CURSOR', 'Unknown message cursor')
      return m
    }
    const after = await cursorOf(q.data.after)
    const before = await cursorOf(q.data.before)
    const rows = await listMessages(db, room.id, {
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      limit: q.data.limit ?? DEFAULT_PAGE,
    })
    return c.json({ data: rows.map(messageDto) })
  }),
)

const PostBody = z.object({ clientMessageId: z.unknown(), body: z.unknown() })

// POST /rooms/:entityType/:entityId/messages { clientMessageId, body }
chatHandler.post(`${ROOM}/messages`, requirePermission(Actions.PostChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const parsed = PostBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || !isValidClientMessageId(parsed.data.clientMessageId)) {
      throw new ChatHttpError(
        400,
        'VALIDATION_ERROR',
        'clientMessageId must be 8–64 letters, digits, "_" or "-"',
      )
    }
    const clientMessageId = parsed.data.clientMessageId
    let body: string
    try {
      body = validateChatBody(parsed.data.body)
    } catch (err) {
      if (err instanceof DomainError) throw new ChatHttpError(400, err.code, err.message)
      throw err
    }

    const caller = await resolveCaller(c)
    const db = c.get('db')
    const tenantId = c.get('tenantId')

    // Idempotent replay: the same clientMessageId from the same author is
    // answered with the stored message, never a second one.
    const replay = await findMessageByClientId(db, caller.userId, clientMessageId)
    if (replay) return replayResponse(c, replay, ref)

    let room = await findRoom(db, ref)
    await assertAccess(c, caller, ref, room)

    const cs = await legacyConnectionString(tenantId)
    if (!room) {
      // The first post creates the room — only for an order that exists.
      if (!cs) {
        throw new ChatHttpError(422, 'MSSQL_NOT_CONFIGURED', 'Legacy database not configured')
      }
      if (!(await orderExists(cs, orderNumOf(ref)))) {
        throw new ChatHttpError(404, 'ORDER_NOT_FOUND', `Order ${ref.entityId} not found`)
      }
      room = await ensureRoom(db, tenantId, ref)
    }

    // Who the move's drivers are right now: they can be mentioned and they
    // are notified. Best effort — a legacy outage never blocks the post.
    const assignedUsers = cs ? await assignedDriverUsers(db, tenantId, cs, orderNumOf(ref)) : []
    const employees = await activeEmployees(db, tenantId)
    const mentionable = new Set([...employees.map((u) => u.id), ...assignedUsers.map((u) => u.id)])
    const mentionedIds = parseMentions(body, mentionable)
    const roomId = room.id

    let created: ChatMessageRow
    let pushIds: string[]
    try {
      ;({ created, pushIds } = await (db as PrismaClient).$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            tenantId,
            roomId,
            authorUserId: caller.userId,
            clientMessageId,
            body,
            mentionedUserIds: mentionedIds,
          },
          include: { author: { select: AUTHOR_SELECT } },
        })
        await tx.chatRoom.update({
          where: { id: roomId },
          data: { lastMessageAt: created.createdAt, lastMessageId: created.id },
        })
        // The author follows and has read up to their own message; anyone
        // mentioned starts following.
        await upsertMember(tx, tenantId, roomId, caller.userId, {
          set: { following: true, lastReadAt: created.createdAt },
        })
        for (const id of mentionedIds) {
          await upsertMember(tx, tenantId, roomId, id, { set: { following: true } })
        }

        const members = await tx.chatRoomMember.findMany({
          where: { roomId },
          select: {
            userId: true,
            following: true,
            muted: true,
            user: { select: { roleNames: true, status: true } },
          },
        })
        const assignedIds = new Set(assignedUsers.map((u) => u.id))
        // A follower who is no longer assigned to the move (a driver taken off
        // the trip) or is deactivated stops getting pushes.
        const followerIds = members
          .filter(
            (m) =>
              m.following &&
              m.user.status !== 'DEACTIVATED' &&
              (resolveChatScope(m.user.roleNames) === 'employee' || assignedIds.has(m.userId)),
          )
          .map((m) => m.userId)
        const recipients = resolveRecipients({
          authorId: caller.userId,
          followerIds,
          mutedIds: members.filter((m) => m.muted).map((m) => m.userId),
          mentionedIds,
          assignedUserIds: [...assignedIds],
        })
        const authorName = displayName(created.author)
        const pushIds: string[] = []
        for (const recipientUserId of recipients) {
          pushIds.push(
            await enqueueChatMessagePush(tx, tenantId, {
              messageId: created.id,
              orderNum: ref.entityId,
              authorName,
              recipientUserId,
              mentioned: mentionedIds.includes(recipientUserId),
            }),
          )
        }
        return { created, pushIds }
      }))
    } catch (err) {
      // A concurrent resend of the same clientMessageId lost the race.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await findMessageByClientId(db, caller.userId, clientMessageId)
        if (winner) return replayResponse(c, winner, ref)
      }
      throw err
    }

    if (pushIds.length > 0) await kickPushForwarder()
    return c.json({ data: messageDto(created) }, 201)
  }),
)

async function replayResponse(c: C, m: ChatMessageRow, ref: ChatRoomRef): Promise<Response> {
  const room = await findRoom(c.get('db'), ref)
  if (!room || room.id !== m.roomId) {
    throw new ChatHttpError(
      409,
      'CHAT_CLIENT_ID_REUSED',
      'clientMessageId was already used for a different room',
    )
  }
  return c.json({ data: messageDto(m) }, 200)
}

/**
 * Active, human tenant users with employee scope (D1). TenantUser is NOT in the
 * tenant client's auto-scoped models, so every user query here names tenantId.
 */
async function activeEmployees(db: PrismaClient, tenantId: string) {
  const users = await db.tenantUser.findMany({
    where: { tenantId, isServiceAccount: false, status: { not: 'DEACTIVATED' } },
    select: { id: true, email: true, roleNames: true, crewMember: { select: { name: true } } },
  })
  return users.filter((u) => resolveChatScope(u.roleNames) === 'employee')
}

/** Logins currently assigned to the order as a longhaul or local driver. */
async function assignedDriverUsers(
  db: PrismaClient,
  tenantId: string,
  cs: string,
  orderNum: number,
) {
  const ids = await assignedDriverIds(cs, orderNum)
  if (ids.longhaul.length === 0 && ids.local.length === 0) return []
  return db.tenantUser.findMany({
    where: {
      tenantId,
      isServiceAccount: false,
      status: { not: 'DEACTIVATED' },
      OR: [
        ...(ids.longhaul.length ? [{ longhaulDriverId: { in: ids.longhaul } }] : []),
        ...(ids.local.length ? [{ localDriverEmployeeId: { in: ids.local } }] : []),
      ],
    },
    select: { id: true, email: true, crewMember: { select: { name: true } } },
  })
}

// DELETE /messages/:id — soft-delete your own message (tenant_admin: any).
chatHandler.delete('/messages/:id', requirePermission(Actions.PostChat), (c) =>
  guarded(c, async () => {
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const m = await findMessage(db, c.req.param('id') ?? '')
    if (!m) throw new ChatHttpError(404, 'NOT_FOUND', 'Message not found')
    const isAdmin = (c.get('principal')?.roleNames ?? []).includes('tenant_admin')
    if (m.authorUserId !== caller.userId && !isAdmin) {
      throw new ChatHttpError(403, 'CHAT_FORBIDDEN', 'You can only delete your own messages')
    }
    if (!m.deletedAt) {
      await db.chatMessage.update({
        where: { id: m.id },
        data: { body: '', deletedAt: new Date() },
      })
    }
    const updated = await findMessage(db, m.id)
    return c.json({ data: messageDto(updated!) })
  }),
)

const ReadBody = z.object({ at: z.string().datetime({ offset: true }).optional() })

// POST /rooms/:entityType/:entityId/read { at? } — advance my read cursor.
chatHandler.post(`${ROOM}/read`, requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const parsed = ReadBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success)
      throw new ChatHttpError(400, 'VALIDATION_ERROR', 'at must be an ISO timestamp')
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const room = await findRoom(db, ref)
    await assertAccess(c, caller, ref, room)
    if (!room) return c.json({ data: { lastReadAt: null } })

    const now = new Date()
    const requested = parsed.data.at ? new Date(parsed.data.at) : now
    const target = requested > now ? now : requested
    const member = await findMember(db, room.id, caller.userId)
    // The cursor only moves forward.
    const lastReadAt = member?.lastReadAt && member.lastReadAt > target ? member.lastReadAt : target
    await upsertMember(db, c.get('tenantId'), room.id, caller.userId, {
      create: { following: caller.scope === 'driver' },
      set: { lastReadAt },
    })
    return c.json({ data: { lastReadAt: lastReadAt.toISOString() } })
  }),
)

const MembershipBody = z
  .object({ following: z.boolean().optional(), muted: z.boolean().optional() })
  .refine((b) => b.following !== undefined || b.muted !== undefined, {
    message: 'Pass following and/or muted',
  })

// PUT /rooms/:entityType/:entityId/membership { following?, muted? }
chatHandler.put(`${ROOM}/membership`, requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const parsed = MembershipBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      throw new ChatHttpError(400, 'VALIDATION_ERROR', 'Pass following and/or muted (booleans)')
    }
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    let room = await findRoom(db, ref)
    await assertAccess(c, caller, ref, room)
    if (!room) {
      const cs = await legacyConnectionString(tenantId)
      if (!cs || !(await orderExists(cs, orderNumOf(ref)))) {
        throw new ChatHttpError(404, 'ORDER_NOT_FOUND', `Order ${ref.entityId} not found`)
      }
      room = await ensureRoom(db, tenantId, ref)
    }
    const set: Prisma.ChatRoomMemberUncheckedUpdateInput = {}
    if (parsed.data.following !== undefined) set.following = parsed.data.following
    if (parsed.data.muted !== undefined) set.muted = parsed.data.muted
    const member = await upsertMember(db, tenantId, room.id, caller.userId, { set })
    return c.json({ data: { following: member.following, muted: member.muted } })
  }),
)

// GET /rooms/:entityType/:entityId/mentionable — @-autocomplete candidates.
chatHandler.get(`${ROOM}/mentionable`, requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const ref = parseRef(c)
    const caller = await resolveCaller(c)
    const db = c.get('db')
    await assertAccess(c, caller, ref, await findRoom(db, ref))
    const tenantId = c.get('tenantId')
    const cs = await legacyConnectionString(tenantId)
    const [employees, drivers] = await Promise.all([
      activeEmployees(db, tenantId),
      cs ? assignedDriverUsers(db, tenantId, cs, orderNumOf(ref)) : Promise.resolve([]),
    ])
    const seen = new Set<string>()
    const data: Array<{ userId: string; name: string; kind: 'employee' | 'driver' }> = []
    for (const u of drivers) {
      seen.add(u.id)
      data.push({ userId: u.id, name: displayName(u), kind: 'driver' })
    }
    for (const u of employees) {
      if (!seen.has(u.id)) data.push({ userId: u.id, name: displayName(u), kind: 'employee' })
    }
    data.sort((a, b) => a.name.localeCompare(b.name))
    return c.json({ data })
  }),
)

const InboxQuery = z.object({ filter: z.enum(['following', 'all']).optional() })

// GET /inbox?filter=following|all — my conversations, newest activity first.
// `all` (employees only) lists every room with a message; drivers always get
// the rooms they follow, re-checked against their current assignments.
chatHandler.get('/inbox', requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const q = InboxQuery.safeParse(c.req.query())
    if (!q.success) throw new ChatHttpError(400, 'VALIDATION_ERROR', 'filter is following or all')
    const caller = await resolveCaller(c)
    const db = c.get('db')
    const all = q.data.filter === 'all' && caller.scope === 'employee'

    const rooms = all
      ? await db.chatRoom.findMany({
          where: { lastMessageAt: { not: null } },
          orderBy: { lastMessageAt: 'desc' },
          take: INBOX_LIMIT,
        })
      : (
          await db.chatRoomMember.findMany({
            where: { userId: caller.userId, following: true },
            include: { room: true },
            orderBy: { room: { lastMessageAt: { sort: 'desc', nulls: 'last' } } },
            take: INBOX_LIMIT,
          })
        ).map((m) => m.room)

    const members = new Map(
      (
        await db.chatRoomMember.findMany({
          where: { userId: caller.userId, roomId: { in: rooms.map((r) => r.id) } },
        })
      ).map((m) => [m.roomId, m]),
    )

    const visible =
      caller.scope === 'driver' ? await driverVisibleRooms(c, caller, rooms, members) : rooms

    const [counts, lastMessages] = await Promise.all([
      unreadCountsByRoom(
        db,
        caller.userId,
        visible.map((r) => ({ roomId: r.id, lastReadAt: members.get(r.id)?.lastReadAt ?? null })),
      ),
      db.chatMessage.findMany({
        where: { id: { in: visible.map((r) => r.lastMessageId).filter((x): x is string => !!x) } },
        include: { author: { select: AUTHOR_SELECT } },
      }),
    ])
    const lastById = new Map(lastMessages.map((m) => [m.id, m]))

    return c.json({
      data: visible.map((r) => {
        const member = members.get(r.id)
        const last = r.lastMessageId ? lastById.get(r.lastMessageId) : undefined
        const count = counts.get(r.id) ?? { unread: 0, mentions: 0 }
        return {
          room: roomDto(
            { entityType: r.entityType as ChatRoomRef['entityType'], entityId: r.entityId },
            r,
          ),
          lastMessage: last
            ? {
                id: last.id,
                authorName: displayName(last.author),
                preview: last.deletedAt ? null : last.body.slice(0, PREVIEW_CHARS),
                createdAt: last.createdAt.toISOString(),
              }
            : null,
          unreadCount: count.unread,
          unreadMentionCount: count.mentions,
          following: member?.following ?? false,
          muted: member?.muted ?? false,
        }
      }),
    })
  }),
)

const SummariesQuery = z.object({
  entityType: z.string(),
  ids: z.string().min(1),
})

// GET /summaries?entityType=shipment&ids=1,2,3 — header details (shipper,
// origin → destination, dates) for the chat page's list and room header, in one
// legacy round trip. Not on any poll path: clients cache it per order. A driver
// gets only the orders they can read; the rest are simply absent.
chatHandler.get('/summaries', requirePermission(Actions.ReadChat), (c) =>
  guarded(c, async () => {
    const q = SummariesQuery.safeParse(c.req.query())
    if (!q.success) {
      throw new ChatHttpError(400, 'VALIDATION_ERROR', 'Pass entityType and ids (comma-separated)')
    }
    const raw = q.data.ids.split(',').map((s) => s.trim())
    if (raw.length > SUMMARY_LIMIT) {
      throw new ChatHttpError(400, 'VALIDATION_ERROR', `At most ${SUMMARY_LIMIT} ids`)
    }
    const refs = raw.map((id) => {
      try {
        return parseChatRoomRef(q.data.entityType, id)
      } catch (err) {
        if (err instanceof DomainError) throw new ChatHttpError(400, err.code, err.message)
        throw err
      }
    })
    const caller = await resolveCaller(c)
    const cs = await legacyConnectionString(c.get('tenantId'))
    if (!cs) {
      throw new ChatHttpError(422, 'MSSQL_NOT_CONFIGURED', 'No legacy database is configured')
    }
    const orderNums = [...new Set(refs.map(orderNumOf))]
    try {
      const data = await orderSummaries(cs, orderNums, caller.scope === 'driver' ? caller : null)
      return c.json({ data })
    } catch (err) {
      logger.warn('chat summaries read failed', { error: String(err) })
      throw new ChatHttpError(503, 'LEGACY_UNAVAILABLE', 'Move details are unavailable right now')
    }
  }),
)

/**
 * The rooms a driver may still see. Fresh `accessCheckedAt` stamps are trusted;
 * the rest are re-checked in ONE legacy query and re-stamped when they pass.
 */
async function driverVisibleRooms<R extends { id: string; entityType: string; entityId: string }>(
  c: C,
  caller: Extract<Caller, { scope: 'driver' }>,
  rooms: R[],
  members: Map<string, { accessCheckedAt: Date | null }>,
): Promise<R[]> {
  const now = Date.now()
  const fresh = (r: R) => {
    const at = members.get(r.id)?.accessCheckedAt
    return !!at && now - at.getTime() < ACCESS_CACHE_MS
  }
  const stale = rooms.filter((r) => !fresh(r) && r.entityType === 'shipment')
  let passed = new Set<number>()
  if (stale.length > 0) {
    const cs = await legacyConnectionString(c.get('tenantId'))
    if (cs) {
      passed = await driverReadableOrders(
        cs,
        stale.map((r) => Number(r.entityId)),
        caller,
      )
    }
    const stamp = stale.filter((r) => passed.has(Number(r.entityId))).map((r) => r.id)
    if (stamp.length > 0) {
      await c.get('db').chatRoomMember.updateMany({
        where: { userId: caller.userId, roomId: { in: stamp } },
        data: { accessCheckedAt: new Date(now) },
      })
    }
  }
  return rooms.filter((r) => fresh(r) || passed.has(Number(r.entityId)))
}
