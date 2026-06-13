// ---------------------------------------------------------------------------
// Expo push delivery adapter.
//
// Thin wrapper over the Expo Push Service (expo-server-sdk). The mobile app
// registers an ExpoPushToken; we POST notifications to Expo and Expo relays to
// APNs/FCM — so no Apple cert / FCM service-account lives in our infra. The
// forwarder (lambda-push-forward) is the only caller.
//
// Two concerns this module owns:
//   • chunking — Expo accepts batches; chunkPushNotifications splits them.
//   • token hygiene — Expo flags dead tokens two ways: synchronously in a ticket
//     ('DeviceNotRegistered' error on send) and asynchronously in a receipt
//     (same code, polled later). Both are surfaced as `invalidTokens` so the
//     caller can deactivate the DeviceToken rows. Other errors are reported as
//     retryable failures.
//
// Auth: Expo push works unauthenticated for development. If EXPO_ACCESS_TOKEN is
// set (recommended for production "enhanced push security"), it is forwarded.
// The CDK stack reads it from Secrets Manager; locally it is simply unset.
// ---------------------------------------------------------------------------

import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type ExpoPushReceiptId,
} from 'expo-server-sdk'
import { logger } from './logger'

let _expo: Expo | null = null
function client(): Expo {
  return (_expo ??= new Expo({
    ...(process.env['EXPO_ACCESS_TOKEN'] ? { accessToken: process.env['EXPO_ACCESS_TOKEN'] } : {}),
  }))
}

/** A platform-agnostic notification envelope. Content/actions live in `data`. */
export interface PushPayload {
  title: string
  body: string
  /** Arbitrary key/values carried to the device — e.g. a deep-link target. */
  data?: Record<string, unknown>
}

/** Outcome of a send to one logical notification's set of device tokens. */
export interface SendResult {
  /** Expo ticket ids for accepted messages — poll these for receipts. */
  ticketIds: string[]
  /** Tokens Expo rejected as permanently dead (DeviceNotRegistered). */
  invalidTokens: string[]
  /** True if at least one message was accepted (a ticket id was returned). */
  anyAccepted: boolean
  /** Human-readable error from the first hard failure, if nothing was accepted. */
  error?: string
}

/** Filters out tokens Expo can immediately tell are malformed (not deactivation-worthy — just skipped). */
export function partitionValidTokens(tokens: string[]): { valid: string[]; malformed: string[] } {
  const valid: string[] = []
  const malformed: string[] = []
  for (const t of tokens) {
    if (Expo.isExpoPushToken(t)) valid.push(t)
    else malformed.push(t)
  }
  return { valid, malformed }
}

/**
 * Sends one notification to many device tokens. Returns ticket ids for accepted
 * messages and the subset of tokens Expo reported as DeviceNotRegistered so the
 * caller can deactivate them. Throws only on a total transport failure (network
 * to Expo) — per-message rejections are returned, not thrown.
 */
export async function sendToTokens(tokens: string[], payload: PushPayload): Promise<SendResult> {
  const { valid, malformed } = partitionValidTokens(tokens)
  if (malformed.length > 0) {
    logger.warn('Skipping malformed Expo push tokens', { count: malformed.length })
  }
  if (valid.length === 0) {
    return { ticketIds: [], invalidTokens: malformed, anyAccepted: false, error: 'no valid tokens' }
  }

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  }))

  const chunks = client().chunkPushNotifications(messages)
  const tickets: ExpoPushTicket[] = []
  for (const chunk of chunks) {
    const chunkTickets = await client().sendPushNotificationsAsync(chunk)
    tickets.push(...chunkTickets)
  }

  // Tickets line up 1:1 with `valid` (chunking preserves order).
  const ticketIds: string[] = []
  const invalidTokens: string[] = [...malformed]
  let firstError: string | undefined
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'ok') {
      ticketIds.push(ticket.id)
      return
    }
    const code = ticket.details?.error
    firstError ??= ticket.message
    if (code === 'DeviceNotRegistered') {
      const token = valid[i]
      if (token) invalidTokens.push(token)
    }
  })

  return {
    ticketIds,
    invalidTokens,
    anyAccepted: ticketIds.length > 0,
    ...(ticketIds.length === 0 && firstError ? { error: firstError } : {}),
  }
}

/** A receipt verdict for a previously-sent ticket. */
export interface ReceiptResult {
  ticketId: string
  ok: boolean
  /** Set when Expo reports DeviceNotRegistered in the receipt. */
  deviceNotRegistered: boolean
  error?: string
}

/**
 * Polls delivery receipts for previously-returned ticket ids. Expo recommends
 * checking receipts 15+ minutes after send. Unknown/not-yet-ready ticket ids are
 * simply absent from the result (caller treats them as "check again later").
 */
export async function getReceipts(ticketIds: string[]): Promise<ReceiptResult[]> {
  if (ticketIds.length === 0) return []
  const out: ReceiptResult[] = []
  const chunks = client().chunkPushNotificationReceiptIds(ticketIds as ExpoPushReceiptId[])
  for (const chunk of chunks) {
    const receipts = await client().getPushNotificationReceiptsAsync(chunk)
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'ok') {
        out.push({ ticketId, ok: true, deviceNotRegistered: false })
      } else {
        out.push({
          ticketId,
          ok: false,
          deviceNotRegistered: receipt.details?.error === 'DeviceNotRegistered',
          ...(receipt.message ? { error: receipt.message } : {}),
        })
      }
    }
  }
  return out
}

/** Test-only: reset the memoised client so a mock can be installed per test. */
export function __resetExpoClientForTests(): void {
  _expo = null
}
