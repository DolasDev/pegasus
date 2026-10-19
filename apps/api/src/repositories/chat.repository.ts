// ---------------------------------------------------------------------------
// Move chat — persistence for rooms, messages and member rows.
//
// Every function takes the tenant-scoped client (`c.get('db')`): reads and
// updates are filtered to the tenant by the Prisma extension, and creates pass
// tenantId explicitly. Access decisions are NOT made here (handlers/chat.ts).
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'
import type { ChatRoomRef } from '@pegasus/domain'

type Db = PrismaClient | Prisma.TransactionClient

export const AUTHOR_SELECT = {
  id: true,
  email: true,
  crewMember: { select: { name: true } },
} as const

/** A user's display name: their linked crew member's name, else their email. */
export function displayName(user: { email: string; crewMember: { name: string } | null }): string {
  return user.crewMember?.name ?? user.email
}

const MESSAGE_INCLUDE = { author: { select: AUTHOR_SELECT } } as const
export type ChatMessageRow = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>

export function findRoom(db: Db, ref: ChatRoomRef) {
  return db.chatRoom.findFirst({ where: { entityType: ref.entityType, entityId: ref.entityId } })
}

/**
 * The room for `ref`, created if missing. Two first posts can race to create
 * it; the loser's unique violation is answered by re-reading the winner's row.
 */
export async function ensureRoom(db: Db, tenantId: string, ref: ChatRoomRef) {
  const existing = await findRoom(db, ref)
  if (existing) return existing
  try {
    return await db.chatRoom.create({
      data: { tenantId, entityType: ref.entityType, entityId: ref.entityId },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findRoom(db, ref)
      if (winner) return winner
    }
    throw err
  }
}

export function findMember(db: Db, roomId: string, userId: string) {
  return db.chatRoomMember.findFirst({ where: { roomId, userId } })
}

export function upsertMember(
  db: Db,
  tenantId: string,
  roomId: string,
  userId: string,
  data: {
    create?: Partial<Pick<Prisma.ChatRoomMemberUncheckedCreateInput, 'following' | 'muted'>>
    set: Prisma.ChatRoomMemberUncheckedUpdateInput
  },
) {
  return db.chatRoomMember.upsert({
    where: { roomId_userId: { roomId, userId } },
    create: { tenantId, roomId, userId, ...data.create, ...(data.set as object) },
    update: data.set,
  })
}

export function findMessageByClientId(db: Db, authorUserId: string, clientMessageId: string) {
  return db.chatMessage.findFirst({
    where: { authorUserId, clientMessageId },
    include: MESSAGE_INCLUDE,
  })
}

export function findMessage(db: Db, id: string) {
  return db.chatMessage.findFirst({ where: { id }, include: MESSAGE_INCLUDE })
}

/**
 * A page of a room's messages, oldest first.
 *   • `after`  — messages newer than that message (the poll).
 *   • `before` — the `limit` messages older than that message (scroll-back).
 *   • neither  — the newest `limit` messages.
 * Ordered by (createdAt, id) so messages sharing a timestamp never skip.
 */
export async function listMessages(
  db: Db,
  roomId: string,
  opts: {
    after?: { createdAt: Date; id: string }
    before?: { createdAt: Date; id: string }
    limit: number
  },
): Promise<ChatMessageRow[]> {
  if (opts.after) {
    const { createdAt, id } = opts.after
    return db.chatMessage.findMany({
      where: { roomId, OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: id } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: opts.limit,
      include: MESSAGE_INCLUDE,
    })
  }
  const where: Prisma.ChatMessageWhereInput = { roomId }
  if (opts.before) {
    const { createdAt, id } = opts.before
    where.OR = [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }]
  }
  const newestFirst = await db.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit,
    include: MESSAGE_INCLUDE,
  })
  return newestFirst.reverse()
}

/** Messages after `since` that `userId` didn't write and that aren't deleted. */
export function countUnread(db: Db, roomId: string, userId: string, since: Date | null) {
  return db.chatMessage.count({
    where: {
      roomId,
      deletedAt: null,
      authorUserId: { not: userId },
      ...(since ? { createdAt: { gt: since } } : {}),
    },
  })
}

/**
 * Unread and unread-mention counts for many rooms in two queries. Each room
 * has its own read cursor, expressed as one OR branch per room.
 */
export async function unreadCountsByRoom(
  db: Db,
  userId: string,
  cursors: ReadonlyArray<{ roomId: string; lastReadAt: Date | null }>,
): Promise<Map<string, { unread: number; mentions: number }>> {
  const out = new Map<string, { unread: number; mentions: number }>()
  if (cursors.length === 0) return out
  const branches = cursors.map(({ roomId, lastReadAt }) => ({
    roomId,
    ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
  }))
  const base = { deletedAt: null, authorUserId: { not: userId }, OR: branches }
  const [unread, mentions] = await Promise.all([
    db.chatMessage.groupBy({ by: ['roomId'], where: base, _count: { _all: true } }),
    db.chatMessage.groupBy({
      by: ['roomId'],
      where: { ...base, mentionedUserIds: { has: userId } },
      _count: { _all: true },
    }),
  ])
  for (const c of cursors) out.set(c.roomId, { unread: 0, mentions: 0 })
  for (const r of unread) out.get(r.roomId)!.unread = r._count._all
  for (const r of mentions) out.get(r.roomId)!.mentions = r._count._all
  return out
}
