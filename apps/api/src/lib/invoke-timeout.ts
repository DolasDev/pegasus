// ---------------------------------------------------------------------------
// Client-side invoke timeout for downstream Lambda calls
//
// The API Lambda invokes the mssql-executor and tunnel-proxy Lambdas
// synchronously. Those downstreams enforce their OWN query/fetch timeout, but
// if the downstream Lambda itself is hung (cold start under the account
// concurrency cap, throttle, network) the api-side `client.send()` has no
// abort and rides all the way to the 29s Lambda wall — exactly the Jun-1
// timeout in plans/.../api-p99-latency-remediation.md. This adds an
// AbortController-based client-side ceiling so a hung invoke fails fast with a
// typed, logged error instead of a 29s black-box wall.
//
// The ceiling is derived from the call's OWN declared budget plus overhead and
// capped below the wall — it is deliberately never tighter than what the caller
// asked for, so it cannot break a legitimately-slow query. (The aggressive
// 5–8s budget the plan contemplates is a separate, data-driven follow-up that
// tunes the per-call `timeoutMs`, validated in staging first.)
// ---------------------------------------------------------------------------

/** The downstream's own default query/fetch timeout when a call omits one. */
export const DEFAULT_DOWNSTREAM_TIMEOUT_MS = 15_000

/** Slack added over the downstream budget for invoke/network/cold-start cost. */
const INVOKE_OVERHEAD_MS = 4_000

/** Hard ceiling — stays below the 29s API Lambda timeout so the abort wins. */
const MAX_INVOKE_TIMEOUT_MS = 27_000

/**
 * The client-side invoke ceiling for a downstream call: its declared budget
 * (or the downstream default) plus overhead, capped below the Lambda wall.
 */
export function invokeTimeoutMs(downstreamTimeoutMs?: number): number {
  const budget =
    downstreamTimeoutMs && downstreamTimeoutMs > 0
      ? downstreamTimeoutMs
      : DEFAULT_DOWNSTREAM_TIMEOUT_MS
  return Math.min(budget + INVOKE_OVERHEAD_MS, MAX_INVOKE_TIMEOUT_MS)
}

/** Thrown when a downstream invoke exceeds its client-side ceiling. */
export class InvokeTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`downstream invoke aborted after ${timeoutMs}ms client-side timeout`)
    this.name = 'InvokeTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Run `fn(signal)` with an abort timer. If the timer fires before `fn`
 * settles, the signal aborts (the AWS SDK rejects the in-flight send) and this
 * throws `InvokeTimeoutError`. Non-timeout errors propagate unchanged.
 */
export async function withInvokeTimeout<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fn(controller.signal)
  } catch (err) {
    // The abort fired before fn settled → surface a typed timeout regardless of
    // how the underlying client reported the cancellation.
    if (controller.signal.aborted) throw new InvokeTimeoutError(timeoutMs)
    throw err
  } finally {
    clearTimeout(timer)
  }
}
