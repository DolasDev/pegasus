// ---------------------------------------------------------------------------
// Support triage (plan: support-channel.md, Phase 2a, D11)
//
// For each customer thread an AI drafts a work item and a suggested reply,
// privately, for the operator. These are the pure rules around such a draft:
// its vocabularies (mirrored by CHECKs in the migration), when an unfinished
// draft counts as lost, and the contact-detail redaction applied to the fields
// that may later leave Pegasus as a GitHub issue (Phase 2b).
// ---------------------------------------------------------------------------

/**
 * `pending`   — created, waiting for the worker.
 * `running`   — claimed by the worker, model call in progress.
 * `ready`     — drafted; the operator can use it.
 * `failed`    — the model call or its output failed; `error` says why.
 * `dismissed` — the operator threw it away.
 */
export const SUPPORT_DRAFT_STATUSES = [
  'pending',
  'running',
  'ready',
  'failed',
  'dismissed',
] as const
export type SupportDraftStatus = (typeof SUPPORT_DRAFT_STATUSES)[number]

/** `question` = a how-to with no work behind it: the suggested reply is the whole answer. */
export const SUPPORT_WORK_ITEM_KINDS = ['bug', 'investigation', 'feature', 'question'] as const
export type SupportWorkItemKind = (typeof SUPPORT_WORK_ITEM_KINDS)[number]

export const SUPPORT_SEVERITIES = ['low', 'medium', 'high'] as const
export type SupportSeverity = (typeof SUPPORT_SEVERITIES)[number]

export function isSupportDraftStatus(v: unknown): v is SupportDraftStatus {
  return typeof v === 'string' && (SUPPORT_DRAFT_STATUSES as readonly string[]).includes(v)
}

/**
 * How long a draft may sit in `pending`/`running`. The worker's own timeout is
 * well under this, so a draft still unfinished past it was lost (an async
 * invoke that never ran, or a worker that died) and reads as `failed`.
 */
export const TRIAGE_STALE_AFTER_MS = 5 * 60_000

/** The status to show and act on: a lost in-flight draft reads as `failed`. */
export function effectiveDraftStatus(
  status: SupportDraftStatus,
  createdAt: Date,
  now: Date,
): SupportDraftStatus {
  if (status !== 'pending' && status !== 'running') return status
  return now.getTime() - createdAt.getTime() >= TRIAGE_STALE_AFTER_MS ? 'failed' : status
}

/** Whether a draft is still being produced, so a new one should not be started. */
export function isDraftInFlight(status: SupportDraftStatus, createdAt: Date, now: Date): boolean {
  const s = effectiveDraftStatus(status, createdAt, now)
  return s === 'pending' || s === 'running'
}

// The leading group pins a match to the start of a local part, so a long run of
// local-part characters is scanned once, not retried from every position
// (quadratic). Lengths are capped at the RFC 5321 limits.
const EMAIL = /(^|[^A-Z0-9._%+-])([A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,63})/gi
// North American numbers with separators: 555-867-5309, (312) 555 0147,
// +1 312.555.0147. Separators are required so plain order numbers and ISO
// dates are left alone. The leading group stands in for a lookbehind, which
// this package avoids: tenant-web and mobile import it, and a regex an older
// engine can't compile fails the whole module at load.
const PHONE = /(^|[^\w+])((?:\+?1[\s.-])?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4})(?!\w)/g

/**
 * Replaces email addresses and phone numbers. A belt to the triage prompt's
 * own instruction to leave contact details out; it does not catch names or
 * addresses, which is why the operator reviews every draft before it leaves.
 */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL, '$1[email]').replace(PHONE, '$1[phone]')
}
