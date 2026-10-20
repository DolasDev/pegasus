import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// Move chat — /api/v1/chat. A room per move (v1: a legacy order, keyed by
// `order_num`). The API scopes everything: employees see every room, a
// driver-scoped login only the moves they're assigned to. Plan:
// plans/in-progress/move-chat-api.md.
//
// Polling (D4): the open room every 3 s and the conversation list / nav badge
// every 15 s. TanStack's `refetchIntervalInBackground: false` (the default)
// pauses both while the tab is hidden; the thread's own poll does the same in
// features/chat/useChatThread.ts.
// ---------------------------------------------------------------------------

export const CHAT_ENTITY = 'shipment' as const
export const INBOX_POLL_MS = 15_000

export type ChatMessage = {
  id: string
  clientMessageId: string
  /** null once deleted. */
  body: string | null
  author: { id: string; name: string }
  mentionedUserIds: string[]
  createdAt: string
  deletedAt: string | null
}

export type ChatRoomInfo = {
  room: { id: string | null; entityType: string; entityId: string; lastMessageAt: string | null }
  membership: { following: boolean; muted: boolean; lastReadAt: string | null } | null
  unreadCount: number
}

export type ChatInboxEntry = {
  room: { id: string | null; entityType: string; entityId: string; lastMessageAt: string | null }
  lastMessage: {
    id: string
    authorName: string
    /** null when that message was deleted. */
    preview: string | null
    createdAt: string
  } | null
  unreadCount: number
  unreadMentionCount: number
  following: boolean
  muted: boolean
}

export type ChatMentionable = { userId: string; name: string; kind: 'employee' | 'driver' }

export type ChatSummary = {
  orderNum: number
  shipperName: string | null
  origin: string | null
  destination: string | null
  packDate: string | null
  loadDate: string | null
  deliveryDate: string | null
}

/** `following` = rooms I follow; `all` = every room with a message (employees only). */
export type InboxSource = 'following' | 'all'

const roomPath = (orderNum: number) => `/api/v1/chat/rooms/${CHAT_ENTITY}/${orderNum}`

export const chatKeys = {
  all: ['chat'] as const,
  inbox: (source: InboxSource) => [...chatKeys.all, 'inbox', source] as const,
  room: (orderNum: number) => [...chatKeys.all, 'room', orderNum] as const,
  mentionable: (orderNum: number) => [...chatKeys.all, 'mentionable', orderNum] as const,
  summaries: (orderNums: readonly number[]) =>
    [...chatKeys.all, 'summaries', [...orderNums].sort((a, b) => a - b).join(',')] as const,
}

export const chatInboxQueryOptions = (source: InboxSource) =>
  queryOptions({
    queryKey: chatKeys.inbox(source),
    queryFn: () => apiFetch<ChatInboxEntry[]>(`/api/v1/chat/inbox?filter=${source}`),
    refetchInterval: INBOX_POLL_MS,
    staleTime: 5_000,
  })

export const chatRoomQueryOptions = (orderNum: number) =>
  queryOptions({
    queryKey: chatKeys.room(orderNum),
    queryFn: () => apiFetch<ChatRoomInfo>(roomPath(orderNum)),
    // 403 (not your move) and 404 are answers, not transient failures.
    retry: false,
  })

export const chatMentionableQueryOptions = (orderNum: number) =>
  queryOptions({
    queryKey: chatKeys.mentionable(orderNum),
    queryFn: () => apiFetch<ChatMentionable[]>(`${roomPath(orderNum)}/mentionable`),
    staleTime: 5 * 60_000,
    retry: false,
  })

/**
 * Header details (shipper, origin → destination, dates) for a batch of orders.
 * One legacy read per batch, so it is cached long and never polled.
 */
export const chatSummariesQueryOptions = (orderNums: readonly number[]) =>
  queryOptions({
    queryKey: chatKeys.summaries(orderNums),
    queryFn: () =>
      apiFetch<ChatSummary[]>(
        `/api/v1/chat/summaries?entityType=${CHAT_ENTITY}&ids=${[...orderNums].join(',')}`,
      ),
    enabled: orderNums.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  })

// ---------------------------------------------------------------------------
// Plain calls used by the thread hook (it keeps its own message list)
// ---------------------------------------------------------------------------

export function fetchMessages(
  orderNum: number,
  cursor: { after?: string; before?: string; limit?: number } = {},
): Promise<ChatMessage[]> {
  const q = new URLSearchParams()
  if (cursor.after) q.set('after', cursor.after)
  if (cursor.before) q.set('before', cursor.before)
  if (cursor.limit) q.set('limit', String(cursor.limit))
  const qs = q.toString()
  return apiFetch<ChatMessage[]>(`${roomPath(orderNum)}/messages${qs ? `?${qs}` : ''}`)
}

export function postMessage(
  orderNum: number,
  input: { clientMessageId: string; body: string },
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`${roomPath(orderNum)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function markRead(orderNum: number, at: string): Promise<{ lastReadAt: string | null }> {
  return apiFetch(`${roomPath(orderNum)}/read`, { method: 'POST', body: JSON.stringify({ at }) })
}

export function deleteMessage(messageId: string): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/api/v1/chat/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  })
}

/** Follow / unfollow / mute a room; refreshes the room and the inbox. */
export function useUpdateChatMembership(orderNum: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { following?: boolean; muted?: boolean }) =>
      apiFetch<{ following: boolean; muted: boolean }>(`${roomPath(orderNum)}/membership`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.room(orderNum) })
      void qc.invalidateQueries({ queryKey: [...chatKeys.all, 'inbox'] })
    },
  })
}
