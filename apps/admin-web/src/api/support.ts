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

/**
 * AI triage draft (Phase 2a) — mirrors the API's draftDto. For the operator
 * only: the AI never writes to the thread. `status` is already effective (a
 * draft lost in flight reads `failed`); `stale` = messages arrived after it.
 */
export type SupportDraftStatus = 'pending' | 'running' | 'ready' | 'failed' | 'dismissed'
export type SupportWorkItemKind = 'bug' | 'investigation' | 'feature' | 'question'

export interface SupportDraft {
  id: string
  status: SupportDraftStatus
  kind: SupportWorkItemKind | null
  severity: 'low' | 'medium' | 'high' | null
  title: string | null
  summary: string | null
  reproSteps: string | null
  expected: string | null
  actual: string | null
  suggestedReply: string | null
  requestedBy: string
  modelId: string | null
  error: string | null
  createdAt: string
  stale: boolean
}

export interface SupportTriage {
  /** Off = this environment has no triage (prod today): show nothing. */
  enabled: boolean
  draft: SupportDraft | null
}

export interface SupportThreadView {
  thread: SupportThreadDetail
  messages: SupportMessage[]
  /** Absent from an API older than Phase 2a. */
  triage?: SupportTriage
}

/** While a draft is being written, poll faster so it appears soon after it lands. */
export const DRAFTING_POLL_MS = 3_000

export function isDrafting(d: SupportDraft | null | undefined): boolean {
  return d?.status === 'pending' || d?.status === 'running'
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
export function getSupportThread(id: string): Promise<SupportThreadView> {
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

/** Starts an AI draft, or returns the one already being written. */
export function requestSupportDraft(threadId: string): Promise<SupportDraft> {
  return adminFetch<SupportDraft>(
    `/api/admin/support/threads/${encodeURIComponent(threadId)}/drafts`,
    { method: 'POST', body: '{}' },
  )
}

export function dismissSupportDraft(threadId: string, draftId: string): Promise<SupportDraft> {
  return adminFetch<SupportDraft>(
    `/api/admin/support/threads/${encodeURIComponent(threadId)}/drafts/${encodeURIComponent(draftId)}/dismiss`,
    { method: 'POST', body: '{}' },
  )
}

export function newClientMessageId(): string {
  return crypto.randomUUID()
}
