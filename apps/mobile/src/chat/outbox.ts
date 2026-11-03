import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@pegasus/api-http'
import { ChatService, type ChatMessage } from '../services/chatService'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// The offline send queue. A message the driver sends is written here before
// the POST and removed once the server confirms it, so a send made with no
// signal survives the app being closed and goes out on the next foreground
// (flushOutbox) or when its conversation is opened again. A resend is safe
// because the API dedupes on clientMessageId.
//
// One AsyncStorage key per signed-in user (their TenantUser id), so a queued
// message can never be posted under a different login on the same phone.
// AsyncStorage, not storage.ts: SecureStore is for secrets and caps item size.
//
// "Reconnect" is approximated by foreground + the next open of the
// conversation — there is no NetInfo dependency, and adding a native module
// for this would need a new store build anyway.
// ---------------------------------------------------------------------------

export type OutboxEntry = {
  orderNum: number
  clientMessageId: string
  body: string
  createdAt: string
  /** The API refused it (4xx): kept for the user to retry or discard, never auto-sent. */
  refused?: boolean
}

const KEY_PREFIX = 'pegasus_chat_outbox.'
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`

// Every read-modify-write goes through this chain, so two writers (the open
// thread and a foreground flush) can't drop each other's changes.
let chain: Promise<unknown> = Promise.resolve()

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

async function read(userId: string): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    // A corrupt record is dropped rather than wedging every send.
    return []
  }
}

async function write(userId: string, entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) await AsyncStorage.removeItem(keyFor(userId))
  else await AsyncStorage.setItem(keyFor(userId), JSON.stringify(entries))
}

function update(userId: string, fn: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<void> {
  return serial(async () => {
    try {
      await write(userId, fn(await read(userId)))
    } catch (error) {
      logger.warn('Chat outbox write failed', error)
    }
  })
}

export function listOutbox(userId: string, orderNum?: number): Promise<OutboxEntry[]> {
  return serial(async () => {
    const all = await read(userId)
    return orderNum == null ? all : all.filter((e) => e.orderNum === orderNum)
  })
}

export function addToOutbox(userId: string, entry: OutboxEntry): Promise<void> {
  return update(userId, (all) =>
    all.some((e) => e.clientMessageId === entry.clientMessageId) ? all : [...all, entry],
  )
}

export function removeFromOutbox(userId: string, clientMessageId: string): Promise<void> {
  return update(userId, (all) => all.filter((e) => e.clientMessageId !== clientMessageId))
}

export function setRefused(
  userId: string,
  clientMessageId: string,
  refused: boolean,
): Promise<void> {
  return update(userId, (all) =>
    all.map((e) => (e.clientMessageId === clientMessageId ? { ...e, refused } : e)),
  )
}

/**
 * True when the API looked at the message and said no (a 4xx): resending the
 * same request won't help. Anything else — no network, a timeout, a 5xx — may
 * pass on its own.
 */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500
}

/**
 * Sends one message and settles its outbox entry: removed on success, marked
 * refused on a 4xx, left queued otherwise. Rethrows so the caller can update
 * its view.
 */
export async function deliver(userId: string, entry: OutboxEntry): Promise<ChatMessage> {
  try {
    const row = await ChatService.postMessage(entry.orderNum, {
      clientMessageId: entry.clientMessageId,
      body: entry.body,
    })
    await removeFromOutbox(userId, entry.clientMessageId)
    return row
  } catch (error) {
    if (isRefusal(error)) await setRefused(userId, entry.clientMessageId, true)
    throw error
  }
}

/**
 * Sends everything still queued for this user, oldest first, and stops at the
 * first transient failure (no signal yet — the rest would fail the same way).
 * Refused entries are left for the user. Returns how many went out.
 */
export async function flushOutbox(userId: string): Promise<number> {
  const queued = (await listOutbox(userId)).filter((e) => !e.refused)
  let sent = 0
  for (const entry of queued) {
    try {
      await deliver(userId, entry)
      sent += 1
    } catch (error) {
      if (!isRefusal(error)) break
    }
  }
  return sent
}
