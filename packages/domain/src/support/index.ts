// ---------------------------------------------------------------------------
// Support bounded context
//
// A tenant user's conversation with the platform operator (Steve): a thread per
// question, messages from the customer or the operator. These are the pure
// rules — what a valid subject/body is, which status a thread lands in after a
// message, when the operator gets alerted, and how the browser context that
// rides along with a new thread is cleaned. Persistence, the SNS alert and
// access checks live in the API layer.
//
// Not move chat (`chat`): those rooms belong to one tenant and every author is
// a tenant user. Support threads are read and answered across tenants by a
// platform admin. Plan: plans/in-progress/support-channel.md (Phase 1a).
// ---------------------------------------------------------------------------

import { DomainError } from '../shared/errors'

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * `awaiting_operator` — new, or the customer wrote last.
 * `awaiting_customer` — the operator wrote last.
 * `resolved`          — the operator closed it; a customer message reopens it.
 */
export const SUPPORT_THREAD_STATUSES = [
  'awaiting_operator',
  'awaiting_customer',
  'resolved',
] as const
export type SupportThreadStatus = (typeof SUPPORT_THREAD_STATUSES)[number]

export const SUPPORT_AUTHOR_KINDS = ['customer', 'operator'] as const
export type SupportAuthorKind = (typeof SUPPORT_AUTHOR_KINDS)[number]

export function isSupportThreadStatus(v: unknown): v is SupportThreadStatus {
  return typeof v === 'string' && (SUPPORT_THREAD_STATUSES as readonly string[]).includes(v)
}

/** The status a thread is in after `author` posts, whatever it was before. */
export function statusAfterMessage(
  _current: SupportThreadStatus,
  author: SupportAuthorKind,
): SupportThreadStatus {
  return author === 'customer' ? 'awaiting_operator' : 'awaiting_customer'
}

// ---------------------------------------------------------------------------
// Subject + body
// ---------------------------------------------------------------------------

export const MAX_SUPPORT_SUBJECT_LENGTH = 200
export const MAX_SUPPORT_BODY_LENGTH = 4000

/** One line, whitespace collapsed, 1–200 characters. */
export function validateSupportSubject(raw: unknown): string {
  const subject = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (subject.length === 0) {
    throw new DomainError('Subject cannot be empty', 'SUPPORT_SUBJECT_EMPTY')
  }
  if (subject.length > MAX_SUPPORT_SUBJECT_LENGTH) {
    throw new DomainError(
      `Subject is longer than ${MAX_SUPPORT_SUBJECT_LENGTH} characters`,
      'SUPPORT_SUBJECT_TOO_LONG',
    )
  }
  return subject
}

/** Trims, normalizes line endings and enforces 1–4000 characters. */
export function validateSupportBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : ''
  if (body.length === 0) {
    throw new DomainError('Message cannot be empty', 'SUPPORT_BODY_EMPTY')
  }
  if (body.length > MAX_SUPPORT_BODY_LENGTH) {
    throw new DomainError(
      `Message is longer than ${MAX_SUPPORT_BODY_LENGTH} characters`,
      'SUPPORT_BODY_TOO_LONG',
    )
  }
  return body
}

/**
 * A subject for a thread opened without one: the body's first line, cut to the
 * subject limit. `body` must already be valid (non-empty).
 */
export function subjectFromBody(body: string): string {
  const firstLine = body.split('\n', 1).join('').replace(/\s+/g, ' ').trim()
  if (firstLine.length <= MAX_SUPPORT_SUBJECT_LENGTH) return firstLine
  return `${firstLine.slice(0, MAX_SUPPORT_SUBJECT_LENGTH - 1)}…`
}

// ---------------------------------------------------------------------------
// Operator alerts
// ---------------------------------------------------------------------------

/** A customer typing several messages in a row pages the operator at most this often. */
export const OPERATOR_ALERT_INTERVAL_MS = 30 * 60_000

export interface AlertDecisionInput {
  /** The thread's status before this customer message; null for a new thread. */
  previousStatus: SupportThreadStatus | null
  /** When the operator was last alerted about this thread. */
  lastAlertAt: Date | null
  now: Date
}

/**
 * Whether a customer message should alert the operator. Yes when it is the
 * first message, when it moves the thread into `awaiting_operator` (the ball
 * just came back to the operator), or when the last alert is older than the
 * interval. Otherwise the operator already has an unanswered alert for it.
 */
export function shouldAlertOperator(input: AlertDecisionInput): boolean {
  if (input.previousStatus === null) return true
  if (input.previousStatus !== 'awaiting_operator') return true
  if (!input.lastAlertAt) return true
  return input.now.getTime() - input.lastAlertAt.getTime() >= OPERATOR_ALERT_INTERVAL_MS
}

// ---------------------------------------------------------------------------
// Browser context attached to a new thread
// ---------------------------------------------------------------------------

export interface SupportContext {
  pageUrl: string | null
  userAgent: string | null
  appVersion: string | null
}

const MAX_PAGE_URL = 2000
const MAX_USER_AGENT = 500
const MAX_APP_VERSION = 50

function cut(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length === 0 ? null : s.slice(0, max)
}

/**
 * Cleans the context the SPA attaches to a new thread. It is diagnostic
 * metadata, so a bad value is dropped rather than failing the customer's
 * message. A page URL must be http(s): it is rendered as a link for the
 * operator.
 */
export function sanitizeSupportContext(raw: unknown): SupportContext {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let pageUrl = cut(r['pageUrl'], MAX_PAGE_URL)
  // No URL global here (the domain package has no DOM/Node lib): a scheme +
  // host + no whitespace check is enough for a link the operator taps.
  if (pageUrl && !/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(pageUrl)) pageUrl = null
  return {
    pageUrl,
    userAgent: cut(r['userAgent'], MAX_USER_AGENT),
    appVersion: cut(r['appVersion'], MAX_APP_VERSION),
  }
}

// ---------------------------------------------------------------------------
// Triage drafts (Phase 2a) — see ./triage.ts
// ---------------------------------------------------------------------------

export type { SupportDraftStatus, SupportWorkItemKind, SupportSeverity } from './triage'
export {
  SUPPORT_DRAFT_STATUSES,
  SUPPORT_WORK_ITEM_KINDS,
  SUPPORT_SEVERITIES,
  TRIAGE_STALE_AFTER_MS,
  isSupportDraftStatus,
  effectiveDraftStatus,
  isDraftInFlight,
  redactContactDetails,
} from './triage'
