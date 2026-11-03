import { getApiClient } from '../api/client'
import type { DriverMapping } from '../types/longhaul'

// ---------------------------------------------------------------------------
// Move chat — /api/v1/chat. A room per move (v1: a legacy order, keyed by
// `order_num`). The API scopes everything: a driver login only sees the moves
// it is assigned to, so this app never filters for access itself. Plan:
// plans/in-progress/move-chat-api.md. Mirrors tenant-web's
// src/api/queries/chat.ts, without TanStack Query (this app has none).
// ---------------------------------------------------------------------------

export const CHAT_ENTITY = 'shipment' as const

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

export type ChatRoomRef = {
  id: string | null
  entityType: string
  entityId: string
  lastMessageAt: string | null
}

export type ChatRoomInfo = {
  room: ChatRoomRef
  membership: { following: boolean; muted: boolean; lastReadAt: string | null } | null
  unreadCount: number
}

export type ChatInboxEntry = {
  room: ChatRoomRef
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

export type ChatSummary = {
  orderNum: number
  shipperName: string | null
  origin: string | null
  destination: string | null
  packDate: string | null
  loadDate: string | null
  deliveryDate: string | null
}

const roomPath = (orderNum: number) => `/api/v1/chat/rooms/${CHAT_ENTITY}/${orderNum}`

/** The API caps a summaries batch at 100 ids. */
const SUMMARY_BATCH = 100

export class ChatService {
  /**
   * Rooms the driver follows plus rooms with an unread mention, newest first.
   * `filter=all` is employee-only, so the driver app always asks for
   * `following`.
   */
  static async getInbox(): Promise<ChatInboxEntry[]> {
    const rows = await getApiClient().fetch<ChatInboxEntry[]>('/api/v1/chat/inbox?filter=following')
    return rows ?? []
  }

  static getRoom(orderNum: number): Promise<ChatRoomInfo> {
    return getApiClient().fetch<ChatRoomInfo>(roomPath(orderNum))
  }

  static async getMessages(
    orderNum: number,
    cursor: { after?: string; before?: string; limit?: number } = {},
  ): Promise<ChatMessage[]> {
    const q: string[] = []
    if (cursor.after) q.push(`after=${encodeURIComponent(cursor.after)}`)
    if (cursor.before) q.push(`before=${encodeURIComponent(cursor.before)}`)
    if (cursor.limit) q.push(`limit=${cursor.limit}`)
    const qs = q.length > 0 ? `?${q.join('&')}` : ''
    const rows = await getApiClient().fetch<ChatMessage[]>(`${roomPath(orderNum)}/messages${qs}`)
    return rows ?? []
  }

  /** Idempotent on `clientMessageId`: a replay returns the row already stored. */
  static postMessage(
    orderNum: number,
    input: { clientMessageId: string; body: string },
  ): Promise<ChatMessage> {
    return getApiClient().fetch<ChatMessage>(`${roomPath(orderNum)}/messages`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  static markRead(orderNum: number, at: string): Promise<{ lastReadAt: string | null }> {
    return getApiClient().fetch(`${roomPath(orderNum)}/read`, {
      method: 'POST',
      body: JSON.stringify({ at }),
    })
  }

  static deleteMessage(messageId: string): Promise<ChatMessage> {
    return getApiClient().fetch<ChatMessage>(
      `/api/v1/chat/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    )
  }

  static setMembership(
    orderNum: number,
    input: { following?: boolean; muted?: boolean },
  ): Promise<{ following: boolean; muted: boolean }> {
    return getApiClient().fetch(`${roomPath(orderNum)}/membership`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  }

  /**
   * Shipper and route for a batch of orders. One legacy read per call, so the
   * caller caches it (see useChatInbox) and never fetches it on a poll tick.
   */
  static async getSummaries(orderNums: readonly number[]): Promise<ChatSummary[]> {
    const ids = [...new Set(orderNums)].slice(0, SUMMARY_BATCH)
    if (ids.length === 0) return []
    const rows = await getApiClient().fetch<ChatSummary[]>(
      `/api/v1/chat/summaries?entityType=${CHAT_ENTITY}&ids=${ids.join(',')}`,
    )
    return rows ?? []
  }

  /** The caller's TenantUser id — tells the thread which messages are "mine". */
  static async getMyUserId(): Promise<string | null> {
    const res = await getApiClient().fetch<DriverMapping>('/api/v1/me/driver')
    return res?.userId ?? null
  }
}
