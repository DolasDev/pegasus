// ---------------------------------------------------------------------------
// RingCentral wire-JSON → domain adapters.
//
// Isolates the RingCentral API JSON shape from the domain. Each function maps a
// raw RC record onto the domain input contract and delegates validation/coercion
// to the pure domain normalizers (packages/domain messaging). RC API shape drift
// is absorbed here, not in the domain or the sync service.
// ---------------------------------------------------------------------------

import {
  normalizeThreadEntry,
  normalizeV1Message,
  type NormalizedMessage,
  type ThreadEntryInput,
  type ThreadPhonePair,
  type V1MessageInput,
  type RcDirection,
} from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Raw RingCentral payload shapes (only the fields we read)
// ---------------------------------------------------------------------------

/** A v1.0 message-store record (GET …/message-store, …/sync). */
export interface RawV1Message {
  id: number | string
  type?: string
  direction?: RcDirection
  creationTime?: string
  lastModifiedTime?: string
  subject?: string
  from?: { phoneNumber?: string }
  to?: Array<{ phoneNumber?: string }>
}

/** A Thread Messaging entry (…/message-threads/entries/sync). */
export interface RawThreadEntry {
  id: number | string
  type?: string
  direction?: RcDirection
  creationTime?: string
  lastModifiedTime?: string
  // The thread entries API returns the SMS body under `text`; tolerate `subject`.
  text?: string
  subject?: string
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Maps a v1.0 message-store record to a NormalizedMessage. Throws the same
 * DomainErrors as the domain normalizer (UNSUPPORTED_MESSAGE_TYPE,
 * INVALID_PHONE_NUMBER, INVALID_TIMESTAMP) on records the caller should skip.
 */
export function normalizeV1Json(raw: RawV1Message): NormalizedMessage {
  const input: V1MessageInput = {
    id: raw.id,
    ...(raw.type !== undefined ? { type: raw.type } : {}),
    direction: raw.direction ?? 'Outbound',
    creationTime: raw.creationTime ?? '',
    ...(raw.lastModifiedTime !== undefined ? { lastModifiedTime: raw.lastModifiedTime } : {}),
    ...(raw.subject !== undefined ? { subject: raw.subject } : {}),
    ...(raw.from !== undefined ? { from: raw.from } : {}),
    ...(raw.to !== undefined ? { to: raw.to } : {}),
  }
  return normalizeV1Message(input)
}

/**
 * Maps a Thread Messaging entry plus its thread id and resolved phone pair (from
 * Read Thread — thread entries omit numbers) to a NormalizedMessage.
 */
export function normalizeThreadJson(
  raw: RawThreadEntry,
  threadId: string,
  phones: ThreadPhonePair,
): NormalizedMessage {
  const input: ThreadEntryInput = {
    id: String(raw.id),
    threadId,
    direction: raw.direction ?? 'Inbound',
    creationTime: raw.creationTime ?? '',
    ...(raw.lastModifiedTime !== undefined ? { lastModifiedTime: raw.lastModifiedTime } : {}),
    ...(raw.text !== undefined ? { text: raw.text } : {}),
    ...(raw.subject !== undefined ? { subject: raw.subject } : {}),
    ...(raw.type !== undefined ? { type: raw.type } : {}),
  }
  return normalizeThreadEntry(input, phones)
}
