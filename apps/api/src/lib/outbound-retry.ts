// ---------------------------------------------------------------------------
// Outbound retry + timeout policy — shared by call-external and
// deliver-to-external.
//
// Why (docs/atlas-world-group-api): Azure API Management throttles per
// subscription by policy, so 429 with a `Retry-After` is a NORMAL response on a
// polling integration, not an exception. Before this module the outbound path
// had no retry, no backoff, and — worse — no timeout at all: `fetch` was called
// with no AbortSignal, so a partner that accepted the connection and then went
// quiet burned the API Lambda's entire execution budget.
//
// The load-bearing decision here is `isIdempotent`. Retrying a non-idempotent
// call double-writes at the partner. The predicate therefore defaults to NOT
// retrying anything it is not certain is safe, and only an explicit
// `mutating: false` from the caller can widen that.
//
// Everything in this module is pure — no I/O, no clock reads (the caller passes
// `now`) — so the policy is exhaustively testable without a network.
// ---------------------------------------------------------------------------

/** Statuses worth retrying: transient by definition, and the partner says so. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503])

/**
 * Never sleep longer than this between attempts, whatever `Retry-After` says.
 * APIM can legitimately return a 60s+ delay on a quota reset; honoring it
 * verbatim inside a Lambda invocation just converts a fast failure into a
 * timeout. Above this we give up and return the 429 to the workflow, which can
 * reschedule far more cheaply than we can block.
 */
export const MAX_RETRY_AFTER_MS = 10_000

/** Request timeout bounds. The Lambda's own ceiling bounds anything larger. */
export const DEFAULT_TIMEOUT_MS = 30_000
const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 60_000

/** Retry-count bounds. */
const DEFAULT_MAX_RETRIES = 2
const MAX_MAX_RETRIES = 5

/** Base for exponential backoff when the partner sends no `Retry-After`. */
const BACKOFF_BASE_MS = 250

/** True when a response status should be retried (given an idempotent request). */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

/**
 * Is this request safe to repeat?
 *
 * GET/HEAD/OPTIONS are safe by definition. Everything else is assumed unsafe
 * unless the caller explicitly asserts `mutating: false` — which exists because
 * partners overload POST for reads (Atlas's asset-management report endpoints
 * do exactly this). An explicit `mutating: true` also wins over a safe method,
 * on the principle that the caller knows their partner better than we do.
 */
export function isIdempotent(method: string, mutating: boolean | undefined): boolean {
  if (mutating !== undefined) return !mutating
  const m = method.toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
}

/**
 * Parse a `Retry-After` header into a delay in ms, capped at
 * {@link MAX_RETRY_AFTER_MS}. Accepts both RFC 7231 forms — delta-seconds and
 * HTTP-date. Returns null when the header is absent or unparseable (the caller
 * then falls back to {@link backoffMs}); returns 0 for a delay already elapsed.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number): number | null {
  if (!value) return null
  const raw = value.trim()
  if (raw === '') return null

  // delta-seconds: a non-negative integer. `3.7` is not valid per the RFC, and
  // accepting it would mask a partner sending something we don't understand.
  if (/^-?\d+$/.test(raw)) {
    const seconds = Number(raw)
    if (!Number.isFinite(seconds)) return null
    return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS)
  }

  // HTTP-date. Gate on the shape FIRST: all three RFC 7231 date forms begin
  // with a weekday name, and `Date.parse` is loose enough to accept things like
  // "3.7" as a date — which would silently turn a malformed header into a
  // multi-month delay clamped to 0.
  if (!/^[A-Za-z]{3,9},?\s/.test(raw)) return null
  const when = Date.parse(raw)
  if (Number.isNaN(when)) return null
  return Math.min(Math.max(when - now, 0), MAX_RETRY_AFTER_MS)
}

/** Exponential backoff for attempt N (0-based), capped. */
export function backoffMs(attempt: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt)
  return Math.min(exp, MAX_RETRY_AFTER_MS)
}

/** The delay before the next attempt: `Retry-After` when usable, else backoff. */
export function retryDelayMs(
  retryAfter: string | null | undefined,
  attempt: number,
  now: number,
): number {
  const fromHeader = parseRetryAfterMs(retryAfter, now)
  return fromHeader ?? backoffMs(attempt)
}

/** Read `MAX_RETRIES` from config, clamped to [0, 5]; default 2. */
export function clampMaxRetries(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_MAX_RETRIES
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MAX_RETRIES
  return Math.min(Math.max(Math.trunc(n), 0), MAX_MAX_RETRIES)
}

/** Read `REQUEST_TIMEOUT_MS` from config, clamped to [1000, 60000]; default 30s. */
export function clampTimeoutMs(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.trunc(n), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}
