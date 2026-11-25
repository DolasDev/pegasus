import { adminFetch } from './client'

// ---------------------------------------------------------------------------
// Support inbox: /api/admin/support (apps/api/src/handlers/admin/support.ts).
// Every tenant's threads, PLATFORM_ADMIN only. Answers 404 NOT_FOUND on every
// route when SUPPORT_ENABLED is off for the environment.
//
// Types mirror the API's inboxDto / detailDto / messageDto (admin-web does not
// depend on @pegasus/domain).
// ---------------------------------------------------------------------------

export const SUPPORT_STATUSES = ['awaiting_operator', 'awaiting_customer', 'resolved'] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]
/** `open` = anything not resolved. */
export type SupportInboxFilter = SupportStatus | 'open' | 'all'

/** Same limit as the API (MAX_SUPPORT_BODY_LENGTH in packages/domain). */
export const MAX_SUPPORT_BODY_LENGTH = 4000

export const INBOX_POLL_MS = 30_000
export const THREAD_POLL_MS = 10_000

export interface SupportInboxThread {
  id: string
  subject: string
  status: SupportStatus
  lastMessageAt: string
  lastAuthorKind: 'customer' | 'operator'
  createdAt: string
  /** The customer wrote after the operator last opened the thread. */
  unread: boolean
  tenant: { id: string; name: string }
  openedBy: { id: string; name: string; email: string | null }
}

export interface SupportThreadDetail extends SupportInboxThread {
  pageUrl: string | null
  userAgent: string | null
  appVersion: string | null
}

export interface SupportMessage {
  id: string
  clientMessageId: string
  authorKind: 'customer' | 'operator'
  authorName: string
  body: string
  createdAt: string
}

export const supportKeys = {
  all: ['support'] as const,
  inbox: (filter: SupportInboxFilter) => [...supportKeys.all, 'inbox', filter] as const,
  thread: (id: string) => [...supportKeys.all, 'thread', id] as const,
}

export function listSupportThreads(filter: SupportInboxFilter): Promise<SupportInboxThread[]> {
  const qs = filter === 'all' ? '' : `?status=${filter}`
  return adminFetch<SupportInboxThread[]>(`/api/admin/support/threads${qs}`)
}

/** Reading a thread also marks it read for the operator. */
export function getSupportThread(
  id: string,
): Promise<{ thread: SupportThreadDetail; messages: SupportMessage[] }> {
  return adminFetch(`/api/admin/support/threads/${encodeURIComponent(id)}`)
}

export function replyToSupportThread(
  id: string,
  input: { clientMessageId: string; body: string },
): Promise<SupportMessage> {
  return adminFetch<SupportMessage>(
    `/api/admin/support/threads/${encodeURIComponent(id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function setSupportThreadStatus(id: string, status: SupportStatus): Promise<unknown> {
  return adminFetch(`/api/admin/support/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export function newClientMessageId(): string {
  return crypto.randomUUID()
}
