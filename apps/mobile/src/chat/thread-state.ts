import * as Crypto from 'expo-crypto'
import type { ChatMessage } from '../services/chatService'

// ---------------------------------------------------------------------------
// The open conversation's message list — a pure reducer so the merge rules are
// testable without timers or a network. Ported from tenant-web
// (features/chat/thread-state.ts); the differences are the offline queue's
// `restore` action and the transient/permanent split on a failed send.
//
// `messages` holds server rows, oldest first, unique by id. `pending` holds
// what this phone sent and the server hasn't confirmed yet (or refused); each
// is keyed by the clientMessageId the API dedupes on, so a resend — by the
// user, on foreground, or from the persisted outbox — can never post twice. A
// confirmed row replaces its pending entry whichever arrives first: the POST's
// answer or the next poll.
// ---------------------------------------------------------------------------

export type PendingMessage = {
  clientMessageId: string
  body: string
  createdAt: string
  /**
   * `queued` — the last attempt failed for a reason that may pass (no signal,
   * a 5xx); it is resent automatically on foreground. `failed` — the API
   * refused it (4xx); only the user's Retry resends it.
   */
  status: 'sending' | 'queued' | 'failed'
}

export type ThreadState = {
  messages: ChatMessage[]
  pending: PendingMessage[]
  /** False once a page back came up short — nothing older to load. */
  hasOlder: boolean
  loaded: boolean
}

export type ThreadAction =
  | { type: 'loaded'; rows: ChatMessage[]; pageSize: number }
  | { type: 'older'; rows: ChatMessage[]; pageSize: number }
  | { type: 'newer'; rows: ChatMessage[] }
  | { type: 'send'; pending: PendingMessage }
  | { type: 'restore'; pending: PendingMessage[] }
  | { type: 'sent'; row: ChatMessage }
  | { type: 'sendFailed'; clientMessageId: string; permanent: boolean }
  | { type: 'retry'; clientMessageId: string }
  | { type: 'discard'; clientMessageId: string }
  | { type: 'replaced'; row: ChatMessage }

export const initialThreadState: ThreadState = {
  messages: [],
  pending: [],
  hasOlder: false,
  loaded: false,
}

function byTime(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Merges rows into the list: unique by id (the incoming row wins), oldest first. */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return current as ChatMessage[]
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort(byTime)
}

function confirm(pending: PendingMessage[], rows: readonly ChatMessage[]): PendingMessage[] {
  if (pending.length === 0) return pending
  const confirmed = new Set(rows.map((r) => r.clientMessageId))
  return pending.filter((p) => !confirmed.has(p.clientMessageId))
}

function setStatus(
  pending: PendingMessage[],
  clientMessageId: string,
  status: PendingMessage['status'],
): PendingMessage[] {
  return pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status } : p))
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  switch (action.type) {
    case 'loaded':
      return {
        messages: mergeMessages([], action.rows),
        pending: confirm(state.pending, action.rows),
        hasOlder: action.rows.length >= action.pageSize,
        loaded: true,
      }
    case 'older':
      return {
        ...state,
        messages: mergeMessages(state.messages, action.rows),
        hasOlder: action.rows.length >= action.pageSize,
      }
    case 'newer':
      return {
        ...state,
        messages: mergeMessages(state.messages, action.rows),
        pending: confirm(state.pending, action.rows),
      }
    case 'send':
      return { ...state, pending: [...state.pending, action.pending] }
    case 'restore': {
      // Entries from the persisted outbox. Skip any this thread already holds
      // and any the server has already confirmed.
      const known = new Set([
        ...state.pending.map((p) => p.clientMessageId),
        ...state.messages.map((m) => m.clientMessageId),
      ])
      const fresh = action.pending.filter((p) => !known.has(p.clientMessageId))
      if (fresh.length === 0) return state
      return { ...state, pending: [...state.pending, ...fresh] }
    }
    case 'sent':
      return {
        ...state,
        messages: mergeMessages(state.messages, [action.row]),
        pending: confirm(state.pending, [action.row]),
      }
    case 'sendFailed':
      return {
        ...state,
        pending: setStatus(
          state.pending,
          action.clientMessageId,
          action.permanent ? 'failed' : 'queued',
        ),
      }
    case 'retry':
      return { ...state, pending: setStatus(state.pending, action.clientMessageId, 'sending') }
    case 'discard':
      return {
        ...state,
        pending: state.pending.filter((p) => p.clientMessageId !== action.clientMessageId),
      }
    case 'replaced':
      return { ...state, messages: mergeMessages(state.messages, [action.row]) }
  }
}

/** The newest confirmed message — the `after` cursor for the next poll. */
export function newestMessage(state: ThreadState): ChatMessage | undefined {
  return state.messages[state.messages.length - 1]
}

/**
 * A clientMessageId the API accepts (8–64 of `[A-Za-z0-9_-]`). From
 * expo-crypto: Hermes has no global `crypto.randomUUID` (the #542 outage).
 */
export function newClientMessageId(): string {
  return Crypto.randomUUID()
}
