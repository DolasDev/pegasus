// ---------------------------------------------------------------------------
// Messaging bounded context
// Captures RingCentral SMS (inbound + outbound) from both the Thread Messaging
// store and the legacy v1.0 message-store, normalizes them into a single
// Message aggregate, and tracks forwarding to the on-prem system of record.
//
// Pure domain — zero I/O. Normalization functions translate loosely-typed
// RingCentral payloads (mapped by the service layer) into NormalizedMessage
// values that the repository persists. The on-prem store is authoritative;
// the cloud Message row is a transient, idempotency-keyed buffer.
// ---------------------------------------------------------------------------

import type { Brand } from '../shared/types'
import { DomainError } from '../shared/errors'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies a captured Message aggregate. */
export type MessageId = Brand<string, 'MessageId'>

/** Uniquely identifies a RingCentralConnection (one connected RC account per tenant). */
export type RingCentralConnectionId = Brand<string, 'RingCentralConnectionId'>

/** Uniquely identifies a managed webhook Subscription. */
export type SubscriptionId = Brand<string, 'SubscriptionId'>

/** Uniquely identifies an SMS thread in the RingCentral Thread Messaging store. */
export type SmsThreadId = Brand<string, 'SmsThreadId'>

export const toMessageId = (raw: string): MessageId => raw as MessageId
export const toRingCentralConnectionId = (raw: string): RingCentralConnectionId =>
  raw as RingCentralConnectionId
export const toSubscriptionId = (raw: string): SubscriptionId => raw as SubscriptionId
export const toSmsThreadId = (raw: string): SmsThreadId => raw as SmsThreadId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/** Direction of an SMS relative to the connected account. */
export type MessageDirection = 'INBOUND' | 'OUTBOUND'

/**
 * Which RingCentral store a message was captured from.
 *
 *  - `THREAD_STORE` — the new Thread Messaging (Shared Inbox) store; holds
 *    inbound to common-resource numbers and threaded outbound.
 *  - `V1_STORE` — the legacy v1.0 message-store; holds API outbound.
 */
export type MessageSource = 'THREAD_STORE' | 'V1_STORE'

/** Capture-side lifecycle status of a Message. */
export type MessageStatus = 'CAPTURED' | 'FORWARDED' | 'FAILED'

export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  'CAPTURED',
  'FORWARDED',
  'FAILED',
] as const

/** Delivery status of a Message's on-prem forward attempt (the outbox row). */
export type ForwardStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD'

export const FORWARD_STATUSES: readonly ForwardStatus[] = [
  'PENDING',
  'SENT',
  'FAILED',
  'DEAD',
] as const

/**
 * An E.164-validated phone number.
 *
 * @invariant Matches `+` followed by 7–15 digits, first digit 1–9.
 */
export type PhoneNumber = Brand<string, 'PhoneNumber'>

/** E.164 format: leading `+`, country-code digit 1–9, then up to 14 more digits. */
const E164 = /^\+[1-9]\d{6,14}$/

/** Returns true when `raw` is a syntactically valid E.164 phone number. */
export function isValidE164(raw: string): boolean {
  return E164.test(raw)
}

/**
 * Factory that enforces the PhoneNumber invariant.
 *
 * @throws {DomainError} `INVALID_PHONE_NUMBER` if `raw` is not valid E.164.
 */
export function toPhoneNumber(raw: string): PhoneNumber {
  if (!isValidE164(raw)) {
    throw new DomainError(`Invalid E.164 phone number: ${raw}`, 'INVALID_PHONE_NUMBER')
  }
  return raw as PhoneNumber
}

/**
 * The text content of an SMS. SMS-only — no attachments in v1.
 *
 * Body may be absent once purged from the cloud buffer (on-prem stays authoritative).
 */
export interface MessageContent {
  readonly body?: string
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * The Message aggregate root — a single captured SMS.
 *
 * The cloud copy is a transient idempotency buffer: `body` is nulled 72h after
 * the on-prem forward succeeds, and the whole row is hard-deleted after 30 days.
 * The durable system of record is the on-prem SQL Server.
 *
 * @invariant `(source, externalId)` is unique per tenant — the dedupe key on
 *            which webhook-path and sync-path upserts converge.
 */
export interface Message {
  readonly id: MessageId
  readonly source: MessageSource
  /** The RingCentral message id within its store. */
  readonly externalId: string
  readonly threadId?: SmsThreadId
  readonly direction: MessageDirection
  readonly fromNumber: PhoneNumber
  readonly toNumber: PhoneNumber
  readonly body?: string
  readonly rcCreationTime: Date
  readonly rcLastModifiedTime?: Date
  readonly status: MessageStatus
  readonly forwardStatus: ForwardStatus
}

/**
 * The output of normalizing a raw RingCentral record — the shape the repository
 * idempotently upserts. Excludes capture-side lifecycle fields (status,
 * forwardStatus) which are owned by the persistence layer.
 */
export interface NormalizedMessage {
  readonly source: MessageSource
  readonly externalId: string
  readonly threadId?: SmsThreadId
  readonly direction: MessageDirection
  readonly fromNumber: PhoneNumber
  readonly toNumber: PhoneNumber
  readonly body?: string
  readonly rcCreationTime: Date
  readonly rcLastModifiedTime?: Date
}

// ---------------------------------------------------------------------------
// Raw RingCentral input contracts
//
// The service layer maps RingCentral JSON onto these; the domain depends only
// on the fields it needs, isolating it from the full RC API surface.
// ---------------------------------------------------------------------------

/** RingCentral message direction as it appears on the wire. */
export type RcDirection = 'Inbound' | 'Outbound'

/**
 * A Thread Messaging store entry (from the entries sync API).
 *
 * Thread entries omit phone numbers, so the caller resolves the from/to pair
 * (via Read Thread) and passes it alongside the entry.
 */
export interface ThreadEntryInput {
  /** RingCentral message id. */
  readonly id: string
  readonly threadId: string
  readonly creationTime: string
  readonly lastModifiedTime?: string
  readonly direction: RcDirection
  /**
   * SMS text. The Thread Messaging entries API returns the body under `text`;
   * the legacy message-store calls it `subject`. We accept either so the Unit 6
   * mapper can pass whichever the API surfaces (`text` preferred).
   */
  readonly text?: string
  readonly subject?: string
  /** Message type; only `SMS` is captured in v1. */
  readonly type?: string
}

/** The from/to phone pair resolved from a thread, as raw strings. */
export interface ThreadPhonePair {
  readonly from: string
  readonly to: string
}

/** A v1.0 message-store record (from the message-store sync/read API). */
export interface V1MessageInput {
  readonly id: string | number
  readonly creationTime: string
  readonly lastModifiedTime?: string
  readonly direction: RcDirection
  readonly type?: string
  /** SMS text. */
  readonly subject?: string
  readonly from?: { readonly phoneNumber?: string }
  readonly to?: ReadonlyArray<{ readonly phoneNumber?: string }>
}

// ---------------------------------------------------------------------------
// Domain functions
// ---------------------------------------------------------------------------

/**
 * The idempotency key for a message: the tuple that is unique per tenant and on
 * which webhook-path and sync-path upserts converge. Stable, store-scoped so the
 * same RC id in different stores never collides.
 */
export function dedupeKey(source: MessageSource, externalId: string): string {
  return `${source}:${externalId}`
}

/**
 * Maps a RingCentral wire direction onto the domain MessageDirection.
 *
 * Strict at the runtime boundary: an unexpected value (casing drift, an
 * unmapped enum) throws rather than silently defaulting to OUTBOUND, which
 * would invert the from/to interpretation of the persisted record.
 *
 * @throws {DomainError} `INVALID_DIRECTION` for anything but `Inbound`/`Outbound`.
 */
function toDirection(raw: RcDirection): MessageDirection {
  if (raw === 'Inbound') return 'INBOUND'
  if (raw === 'Outbound') return 'OUTBOUND'
  throw new DomainError(`Unexpected RingCentral direction: ${String(raw)}`, 'INVALID_DIRECTION')
}

/**
 * Parses a RingCentral ISO timestamp, rejecting unparseable values.
 *
 * `new Date(bad)` yields an `Invalid Date` object rather than throwing, which
 * would silently persist as a null/NaN `rcCreationTime` and corrupt the purge
 * and ordering logic. Validate like we validate phone numbers.
 *
 * @throws {DomainError} `INVALID_TIMESTAMP` if `raw` does not parse to a date.
 */
function toRcDate(raw: string, field: string): Date {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new DomainError(`Invalid RingCentral ${field}: ${raw}`, 'INVALID_TIMESTAMP')
  }
  return d
}

/**
 * Returns true when a raw RingCentral record is an SMS (the only captured type).
 *
 * The thread store is SMS-centric, so an absent `type` is treated as SMS. The
 * v1.0 message-store also holds Fax/VoiceMail/Pager records, so callers
 * normalizing v1 records should require an explicit `type === 'SMS'` (see
 * `normalizeV1Message`) rather than relying on this permissive default.
 */
export function isSms(type: string | undefined): boolean {
  return type === undefined || type === 'SMS'
}

/**
 * Normalizes a Thread Messaging entry plus its resolved phone pair into a
 * NormalizedMessage.
 *
 * @throws {DomainError} `INVALID_PHONE_NUMBER` if a resolved number is not E.164.
 * @throws {DomainError} `UNSUPPORTED_MESSAGE_TYPE` if the entry is not an SMS.
 */
export function normalizeThreadEntry(
  entry: ThreadEntryInput,
  phones: ThreadPhonePair,
): NormalizedMessage {
  if (!isSms(entry.type)) {
    throw new DomainError(
      `Unsupported message type for thread entry ${entry.id}: ${entry.type}`,
      'UNSUPPORTED_MESSAGE_TYPE',
    )
  }
  const body = entry.text ?? entry.subject
  return {
    source: 'THREAD_STORE',
    externalId: String(entry.id),
    threadId: toSmsThreadId(entry.threadId),
    direction: toDirection(entry.direction),
    fromNumber: toPhoneNumber(phones.from),
    toNumber: toPhoneNumber(phones.to),
    ...(body !== undefined ? { body } : {}),
    rcCreationTime: toRcDate(entry.creationTime, 'creationTime'),
    ...(entry.lastModifiedTime !== undefined
      ? { rcLastModifiedTime: toRcDate(entry.lastModifiedTime, 'lastModifiedTime') }
      : {}),
  }
}

/**
 * Normalizes a v1.0 message-store record into a NormalizedMessage.
 *
 * @throws {DomainError} `INVALID_PHONE_NUMBER` if from/to is missing or not E.164.
 * @throws {DomainError} `UNSUPPORTED_MESSAGE_TYPE` if the record is not an SMS.
 */
export function normalizeV1Message(msg: V1MessageInput): NormalizedMessage {
  // Strict: the v1.0 message-store also holds Fax/VoiceMail/Pager records, so
  // require an explicit SMS type rather than the permissive `isSms` default.
  if (msg.type !== 'SMS') {
    throw new DomainError(
      `Unsupported message type for v1 message ${msg.id}: ${msg.type}`,
      'UNSUPPORTED_MESSAGE_TYPE',
    )
  }
  const fromRaw = msg.from?.phoneNumber
  // The `to` array can carry non-phone entries (e.g. extensionId only); pick the
  // first recipient that actually has a phone number. SMS-only v1 = one recipient.
  const toRaw = msg.to?.find((t) => t.phoneNumber !== undefined)?.phoneNumber
  if (fromRaw === undefined || toRaw === undefined) {
    throw new DomainError(`Missing phone numbers on v1 message ${msg.id}`, 'INVALID_PHONE_NUMBER')
  }
  return {
    source: 'V1_STORE',
    externalId: String(msg.id),
    direction: toDirection(msg.direction),
    fromNumber: toPhoneNumber(fromRaw),
    toNumber: toPhoneNumber(toRaw),
    ...(msg.subject !== undefined ? { body: msg.subject } : {}),
    rcCreationTime: toRcDate(msg.creationTime, 'creationTime'),
    ...(msg.lastModifiedTime !== undefined
      ? { rcLastModifiedTime: toRcDate(msg.lastModifiedTime, 'lastModifiedTime') }
      : {}),
  }
}

/**
 * Returns true when a message is eligible to be forwarded on-prem: it has a
 * body present (not yet purged) and is not already delivered or dead-lettered.
 */
export function canForward(message: Pick<Message, 'forwardStatus' | 'body'>): boolean {
  if (message.body === undefined) return false
  return message.forwardStatus === 'PENDING' || message.forwardStatus === 'FAILED'
}

/**
 * Returns true when a forward-status transition from `current` to `next` is legal.
 *
 * Non-terminal states permit an idempotent self-transition (`PENDING→PENDING`,
 * `FAILED→FAILED`) so an at-least-once forwarder re-recording the same status on
 * a retry is not rejected. `SENT` is terminal; `DEAD` only re-opens via an
 * explicit manual redrive to `PENDING`.
 */
export function canTransitionForward(current: ForwardStatus, next: ForwardStatus): boolean {
  const allowed: Record<ForwardStatus, readonly ForwardStatus[]> = {
    PENDING: ['PENDING', 'SENT', 'FAILED', 'DEAD'],
    FAILED: ['FAILED', 'PENDING', 'SENT', 'DEAD'],
    SENT: [],
    DEAD: ['PENDING'],
  }
  return allowed[current].includes(next)
}

/**
 * Derives the capture-side MessageStatus from the on-prem ForwardStatus, keeping
 * the two lifecycles consistent (a SENT forward is a FORWARDED message; a DEAD
 * forward is FAILED; otherwise the message is merely CAPTURED). Callers should
 * use this rather than setting `status` independently, so the fields cannot drift.
 */
export function deriveMessageStatus(forwardStatus: ForwardStatus): MessageStatus {
  switch (forwardStatus) {
    case 'SENT':
      return 'FORWARDED'
    case 'DEAD':
      return 'FAILED'
    case 'PENDING':
    case 'FAILED':
      return 'CAPTURED'
  }
}

// ---------------------------------------------------------------------------
// Webhook validation handshake
// ---------------------------------------------------------------------------

/**
 * The header RingCentral sends on a subscription create/renew handshake. Its
 * value must be echoed back verbatim in the response with a 200.
 */
export const VALIDATION_TOKEN_HEADER = 'validation-token'

/**
 * Returns the validation token when the request is a RingCentral subscription
 * handshake, or `undefined` for a normal event delivery.
 *
 * Header lookup is case-insensitive (Hono/HTTP headers are not case-stable).
 */
export function isWebhookValidationHandshake(
  headers: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === VALIDATION_TOKEN_HEADER && value !== undefined && value !== '') {
      return value
    }
  }
  return undefined
}
