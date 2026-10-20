// ---------------------------------------------------------------------------
// Chat bounded context
//
// Internal, per-move chat: every tenant employee and the drivers assigned to a
// move can read and post in that move's room. These are the pure rules — which
// rooms exist, what a valid message is, who counts as an employee, and who gets
// a push when someone posts. Persistence, access checks against the legacy
// database, and delivery live in the API layer.
//
// Not to be confused with the `messaging` context, which buffers RingCentral SMS.
// Plan: plans/in-progress/move-chat-api.md (decisions D1–D6).
// ---------------------------------------------------------------------------

import { DomainError } from '../shared/errors'

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * What a room can be attached to. v1 is legacy orders only (D3); the storage is
 * polymorphic so cloud `move` rooms can be added without a migration.
 */
export const CHAT_ENTITY_TYPES = ['shipment'] as const
export type ChatEntityType = (typeof CHAT_ENTITY_TYPES)[number]

export interface ChatRoomRef {
  entityType: ChatEntityType
  entityId: string
}

/** Largest value a SQL Server `int` order number can hold. */
const MAX_ORDER_NUM = 2_147_483_647

/**
 * Validates a room reference from a URL. A shipment is keyed by its legacy
 * `order_num`: a positive int with no leading zeros, so one order has exactly
 * one spelling and therefore exactly one room.
 */
export function parseChatRoomRef(entityType: string, entityId: string): ChatRoomRef {
  if (!(CHAT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new DomainError(`Chat is not available for "${entityType}"`, 'CHAT_UNSUPPORTED_ENTITY')
  }
  if (!/^[1-9]\d{0,9}$/.test(entityId) || Number(entityId) > MAX_ORDER_NUM) {
    throw new DomainError(`"${entityId}" is not a valid order number`, 'CHAT_INVALID_ENTITY_ID')
  }
  return { entityType: entityType as ChatEntityType, entityId }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const MAX_CHAT_BODY_LENGTH = 4000

/** Trims, normalizes line endings and enforces 1–4000 characters. */
export function validateChatBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : ''
  if (body.length === 0) {
    throw new DomainError('Message cannot be empty', 'CHAT_BODY_EMPTY')
  }
  if (body.length > MAX_CHAT_BODY_LENGTH) {
    throw new DomainError(
      `Message is longer than ${MAX_CHAT_BODY_LENGTH} characters`,
      'CHAT_BODY_TOO_LONG',
    )
  }
  return body
}

/**
 * The client-generated id that makes a send idempotent: an offline queue can
 * resend the same message any number of times and it is stored once. A UUID
 * fits; so does any 8–64 character token of letters, digits, `_` and `-`.
 */
export function isValidClientMessageId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw)
}

/** Composer mention token: `@[Display Name](userId)`. */
const MENTION_TOKEN = /@\[([^\]\n]{1,100})\]\(([A-Za-z0-9-]{1,64})\)/g

/**
 * The user ids a message mentions, in order of first appearance. Ids that are
 * not mentionable in this room are dropped, so a hand-typed token can't page
 * someone who can't see the conversation.
 */
export function parseMentions(body: string, mentionable: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const id = match[2] as string
    if (mentionable.has(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** A message body cut into plain text and mention tokens, for rendering. */
export type ChatBodySegment =
  { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: string }

/** Splits a body at its `@[Name](userId)` tokens, keeping the text between them. */
export function splitMentions(body: string): ChatBodySegment[] {
  const out: ChatBodySegment[] = []
  let last = 0
  for (const match of body.matchAll(MENTION_TOKEN)) {
    const at = match.index as number
    if (at > last) out.push({ kind: 'text', text: body.slice(last, at) })
    out.push({ kind: 'mention', name: match[1] as string, userId: match[2] as string })
    last = at + match[0].length
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) })
  return out
}

/**
 * The composer's token for mentioning `userId`. The display name loses the
 * characters the token can't carry (`]`, newlines) and is cut to 100, so the
 * token always parses back.
 */
export function formatMentionToken(name: string, userId: string): string {
  const safe =
    name
      .replace(/[\]\r\n]/g, ' ')
      .trim()
      .slice(0, 100) || 'user'
  return `@[${safe}](${userId})`
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/** The role a driver (employee or contractor) and a local driver's login carries. */
export const DRIVER_ROLE = 'driver'

/**
 * `employee` reads every room; `driver` reads only the moves they are assigned
 * to. Decided by role, never by employment status (D1): a login whose only role
 * is `driver` — or that has no role at all — is driver-scoped, and any other
 * role makes the caller an employee.
 */
export type ChatScope = 'employee' | 'driver'

export function resolveChatScope(roleNames: readonly string[]): ChatScope {
  return roleNames.some((r) => r !== DRIVER_ROLE) ? 'employee' : 'driver'
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface RecipientInput {
  authorId: string
  /** Members whose `following` flag is set. */
  followerIds: readonly string[]
  mutedIds: readonly string[]
  mentionedIds: readonly string[]
  /** Logins of the drivers currently assigned to the move (always follow it). */
  assignedUserIds: readonly string[]
}

/**
 * Who gets a push for a new message: (followers ∪ mentioned ∪ assigned) minus
 * the author. Muting silences everything except a direct mention. Sorted so the
 * result is deterministic.
 */
export function resolveRecipients(input: RecipientInput): string[] {
  const muted = new Set(input.mutedIds)
  const mentioned = new Set(input.mentionedIds)
  const out = new Set<string>()
  for (const id of [...input.followerIds, ...input.assignedUserIds]) {
    if (!muted.has(id)) out.add(id)
  }
  for (const id of mentioned) out.add(id)
  out.delete(input.authorId)
  return [...out].sort()
}

/**
 * Push copy for a chat message. It never contains the message text (D5): staff
 * type customer details into chat, and a lock screen is not the place for them.
 */
export function chatPushContent(input: {
  orderNum: string
  authorName: string
  mentioned: boolean
}): { title: string; body: string } {
  const author = input.authorName.trim() || 'a teammate'
  return {
    title: `#${input.orderNum}`,
    body: input.mentioned ? `${author} mentioned you` : `New message from ${author}`,
  }
}
