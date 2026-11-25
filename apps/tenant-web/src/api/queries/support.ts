import { queryOptions } from '@tanstack/react-query'
import type { SupportThreadStatus } from '@pegasus/domain'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Support channel: /api/v1/support (apps/api/src/handlers/support.ts). A user
// sees only the threads they opened; anyone else's answers 404. The whole
// surface answers 404 when SUPPORT_ENABLED is off, which the nav already hides
// through the `support` capability.
//
// Polling, as in move chat: the thread list (and so the nav badge) every 30 s,
// the open thread every 10 s. Both pause while the tab is hidden (TanStack's
// default `refetchIntervalInBackground: false`).
// ---------------------------------------------------------------------------

export const SUPPORT_LIST_POLL_MS = 30_000
export const SUPPORT_THREAD_POLL_MS = 10_000

export type SupportThread = {
  id: string
  subject: string
  status: SupportThreadStatus
  lastMessageAt: string
  createdAt: string
  /** Pegasus support wrote after I last opened the thread. */
  unread: boolean
  pageUrl: string | null
}

export type SupportMessage = {
  id: string
  clientMessageId: string
  authorKind: 'customer' | 'operator'
  authorName: string
  body: string
  createdAt: string
}

export type SupportThreadDetail = { thread: SupportThread; messages: SupportMessage[] }

/** Browser context attached to a new thread; the API trims and caps each field. */
export type SupportContext = { pageUrl?: string; userAgent?: string; appVersion?: string }

export const supportKeys = {
  all: ['support'] as const,
  threads: () => [...supportKeys.all, 'threads'] as const,
  thread: (id: string) => [...supportKeys.all, 'thread', id] as const,
}

export const supportThreadsQueryOptions = () =>
  queryOptions({
    queryKey: supportKeys.threads(),
    queryFn: () => apiFetch<SupportThread[]>('/api/v1/support/threads'),
    refetchInterval: SUPPORT_LIST_POLL_MS,
    staleTime: 5_000,
  })

/** Reading a thread also marks it read on the server. */
export const supportThreadQueryOptions = (id: string) =>
  queryOptions({
    queryKey: supportKeys.thread(id),
    queryFn: () =>
      apiFetch<SupportThreadDetail>(`/api/v1/support/threads/${encodeURIComponent(id)}`),
    refetchInterval: SUPPORT_THREAD_POLL_MS,
    // 404 (not yours, or gone) is an answer, not a transient failure.
    retry: false,
  })

export function openSupportThread(input: {
  clientMessageId: string
  subject: string
  body: string
  context: SupportContext
}): Promise<{ thread: SupportThread; message: SupportMessage | null }> {
  return apiFetch('/api/v1/support/threads', { method: 'POST', body: JSON.stringify(input) })
}

export function postSupportMessage(
  threadId: string,
  input: { clientMessageId: string; body: string },
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(
    `/api/v1/support/threads/${encodeURIComponent(threadId)}/messages`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}
