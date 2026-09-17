// ---------------------------------------------------------------------------
// Client crash reporting.
//
// A render crash replaces the whole page with ErrorBoundary's "Something went
// wrong" and, before this existed, left no trace on the server at all: the
// boundary only wrote to the browser console. On 2026-09-17 a user reported
// that message on the Operations screens and there was nothing in CloudWatch
// to look at — the crash was, by construction, invisible.
//
// This sends one POST to /api/v1/client-errors so the next one is searchable.
//
// Two rules matter more than completeness here:
//
//   1. It must NEVER throw. This runs from an error boundary and from global
//      error listeners — a reporter that throws turns one crash into a loop.
//      Every path is wrapped, and the promise is explicitly swallowed.
//   2. It must not flood. A render loop can fire the same error hundreds of
//      times a second; identical messages are dropped inside a short window.
// ---------------------------------------------------------------------------

import { apiFetch } from '@/api/client'

/** Field caps mirror the server's. Truncating here keeps the request small. */
const MAX = { message: 500, stack: 4000, componentStack: 4000, url: 500, userAgent: 300 } as const

/** Identical messages inside this window are reported once. */
const DEDUPE_MS = 10_000

const lastReportedAt = new Map<string, number>()

/** Exported for tests — the module-level dedupe cache outlives a single case. */
export function _resetClientErrorDedupe(): void {
  lastReportedAt.clear()
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.slice(0, max)
}

function shouldReport(message: string, now: number): boolean {
  const previous = lastReportedAt.get(message)
  if (previous !== undefined && now - previous < DEDUPE_MS) return false
  lastReportedAt.set(message, now)
  // Bound the cache — a page churning unique messages must not grow it forever.
  if (lastReportedAt.size > 50) {
    for (const [key, at] of lastReportedAt) {
      if (now - at >= DEDUPE_MS) lastReportedAt.delete(key)
    }
  }
  return true
}

export interface ClientErrorContext {
  /** React's component stack, when reporting from an error boundary. */
  componentStack?: string | undefined
}

/**
 * Reports a browser-side crash. Fire-and-forget: returns nothing, never throws,
 * never retries. A failed report is not worth a second failure.
 */
export function reportClientError(error: unknown, context: ClientErrorContext = {}): void {
  try {
    const err = error instanceof Error ? error : undefined
    const rawMessage = err?.message ?? (typeof error === 'string' ? error : String(error))
    const message = truncate(rawMessage, MAX.message)
    // Nothing useful to say — don't spend a log line on it.
    if (message === undefined) return

    if (!shouldReport(message, Date.now())) return

    const body = {
      message,
      ...(truncate(err?.stack, MAX.stack) ? { stack: truncate(err?.stack, MAX.stack) } : {}),
      ...(truncate(context.componentStack, MAX.componentStack)
        ? { componentStack: truncate(context.componentStack, MAX.componentStack) }
        : {}),
      ...(truncate(globalThis.location?.href, MAX.url)
        ? { url: truncate(globalThis.location?.href, MAX.url) }
        : {}),
      ...(truncate(globalThis.navigator?.userAgent, MAX.userAgent)
        ? { userAgent: truncate(globalThis.navigator?.userAgent, MAX.userAgent) }
        : {}),
    }

    void apiFetch<void>('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // The page is already broken; do not let a hanging report hold it open.
      keepalive: true,
    }).catch(() => {
      // Swallowed on purpose. The user is already looking at a crash screen —
      // a failed report must not produce a second one.
    })
  } catch {
    // Same reasoning: reporting is best-effort and strictly subordinate to the
    // crash it describes.
  }
}

/**
 * Installs global listeners for crashes React never sees — errors thrown outside
 * the component tree, and rejected promises with no handler. Safe to call once
 * at startup; repeated calls would double-report, so callers must not.
 */
export function installGlobalErrorReporting(): void {
  globalThis.addEventListener?.('error', (event) => {
    reportClientError((event as ErrorEvent).error ?? (event as ErrorEvent).message)
  })
  globalThis.addEventListener?.('unhandledrejection', (event) => {
    reportClientError((event as PromiseRejectionEvent).reason)
  })
}
