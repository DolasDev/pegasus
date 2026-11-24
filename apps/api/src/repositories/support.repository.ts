// ---------------------------------------------------------------------------
// Support threads — persistence shared by the tenant side (handlers/support.ts,
// on the tenant-scoped client) and the operator side (handlers/admin/support.ts,
// on the base client across tenants).
//
// Every write that changes a thread's conversation goes through
// `appendMessage`, so the status / lastAuthorKind / lastMessageAt bookkeeping
// lives in one place. Callers pass their own client or transaction.
// ---------------------------------------------------------------------------

import { Prisma, type PrismaClient } from '@prisma/client'
import {
  statusAfterMessage,
  isSupportThreadStatus,
  type SupportAuthorKind,
  type SupportThreadStatus,
} from '@pegasus/domain'
import { AUTHOR_SELECT } from './chat.repository'

type Db = PrismaClient | Prisma.TransactionClient

export const THREAD_SELECT = {
  id: true,
  tenantId: true,
  openedByUserId: true,
  subject: true,
  status: true,
  lastMessageAt: true,
  lastAuthorKind: true,
  lastOperatorAlertAt: true,
  customerLastReadAt: true,
  operatorLastReadAt: true,
  pageUrl: true,
  userAgent: true,
  appVersion: true,
  createdAt: true,
} as const satisfies Prisma.SupportThreadSelect

export type SupportThreadRow = Prisma.SupportThreadGetPayload<{ select: typeof THREAD_SELECT }>

export const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  authorKind: true,
  authorUserId: true,
  operatorSub: true,
  operatorEmail: true,
  clientMessageId: true,
  body: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
} as const satisfies Prisma.SupportMessageSelect

export type SupportMessageRow = Prisma.SupportMessageGetPayload<{ select: typeof MESSAGE_SELECT }>

/** The stored status, narrowed. A row that fails the CHECK can't exist. */
export function statusOf(row: { status: string }): SupportThreadStatus {
  return isSupportThreadStatus(row.status) ? row.status : 'awaiting_operator'
}

/** Whether the other side wrote after `reader` last read the thread. */
export function isUnreadFor(
  reader: SupportAuthorKind,
  t: Pick<
    SupportThreadRow,
    'lastAuthorKind' | 'lastMessageAt' | 'customerLastReadAt' | 'operatorLastReadAt'
  >,
): boolean {
  if (t.lastAuthorKind === reader) return false
  const readAt = reader === 'customer' ? t.customerLastReadAt : t.operatorLastReadAt
  return !readAt || t.lastMessageAt > readAt
}

export function findThread(db: Db, id: string): Promise<SupportThreadRow | null> {
  return db.supportThread.findUnique({ where: { id }, select: THREAD_SELECT })
}

/** Every message on a thread, oldest first. Threads are short; no paging in v1. */
export function listMessages(db: Db, threadId: string): Promise<SupportMessageRow[]> {
  return db.supportMessage.findMany({
    where: { threadId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: MESSAGE_SELECT,
  })
}

export function findMessageByClientId(
  db: Db,
  threadId: string,
  authorKind: SupportAuthorKind,
  clientMessageId: string,
): Promise<SupportMessageRow | null> {
  return db.supportMessage.findUnique({
    where: { threadId_authorKind_clientMessageId: { threadId, authorKind, clientMessageId } },
    select: MESSAGE_SELECT,
  })
}

export type MessageAuthor =
  { kind: 'customer'; userId: string } | { kind: 'operator'; sub: string; email: string }

/**
 * Writes a message and moves the thread on: status per the domain rule, the
 * last-author / last-message pointers, and the writer's own read cursor (you
 * have read what you just wrote). Returns the message and the thread's status
 * before the write. Throws P2002 on a duplicate clientMessageId.
 */
export async function appendMessage(
  tx: Prisma.TransactionClient,
  thread: Pick<SupportThreadRow, 'id' | 'tenantId' | 'status'>,
  author: MessageAuthor,
  clientMessageId: string,
  body: string,
): Promise<{ message: SupportMessageRow; previousStatus: SupportThreadStatus }> {
  const previousStatus = statusOf(thread)
  const message = await tx.supportMessage.create({
    data: {
      tenantId: thread.tenantId,
      threadId: thread.id,
      authorKind: author.kind,
      ...(author.kind === 'customer'
        ? { authorUserId: author.userId }
        : { operatorSub: author.sub, operatorEmail: author.email }),
      clientMessageId,
      body,
    },
    select: MESSAGE_SELECT,
  })
  await tx.supportThread.update({
    where: { id: thread.id },
    data: {
      status: statusAfterMessage(previousStatus, author.kind),
      lastAuthorKind: author.kind,
      lastMessageAt: message.createdAt,
      ...(author.kind === 'customer'
        ? { customerLastReadAt: message.createdAt }
        : { operatorLastReadAt: message.createdAt }),
    },
  })
  return { message, previousStatus }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
