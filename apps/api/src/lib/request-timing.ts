// ---------------------------------------------------------------------------
// Per-request downstream timing
//
// A request-scoped accumulator that records how long each external downstream
// (Neon Postgres, the mssql-executor Lambda invoke, the tunnel-proxy Lambda
// invoke) took during a single API request. The requestTimingMiddleware runs
// the whole request inside `runWithTiming`, and the downstream clients call
// `recordDownstream` around their network call. On request completion the
// middleware emits one structured log line carrying the breakdown keyed by
// correlationId — so the *next* p99 spike (see plans/.../api-p99-latency-
// remediation.md) is attributable to a specific downstream from CloudWatch
// Logs alone, independent of X-Ray trace sampling.
//
// Implemented with AsyncLocalStorage so callers never thread a context object
// through every layer. Outside a `runWithTiming` scope (standalone Lambdas,
// unit tests) `recordDownstream` still runs the wrapped call — it just has no
// store to record into, so it is a transparent pass-through.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from 'node:async_hooks'

/** A downstream dependency whose per-request time is tracked. */
export type Downstream = 'db' | 'mssql' | 'tunnel'

export interface DownstreamTiming {
  /** Cumulative milliseconds spent on each downstream this request. */
  ms: Record<Downstream, number>
  /** Number of calls made to each downstream this request. */
  calls: Record<Downstream, number>
}

function emptyTiming(): DownstreamTiming {
  return {
    ms: { db: 0, mssql: 0, tunnel: 0 },
    calls: { db: 0, mssql: 0, tunnel: 0 },
  }
}

const storage = new AsyncLocalStorage<DownstreamTiming>()

/** Run `fn` inside a fresh per-request timing scope. */
export function runWithTiming<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(emptyTiming(), fn)
}

/** The current request's timing accumulator, or undefined outside a scope. */
export function getTiming(): DownstreamTiming | undefined {
  return storage.getStore()
}

/**
 * Time the wrapped downstream call and add its duration to the current
 * request's accumulator. Always returns/propagates exactly what `fn` does —
 * timing is recorded in a `finally`, so failed calls are still counted (a slow
 * call that ultimately throws is exactly what we want to see in the breakdown).
 */
export async function recordDownstream<T>(kind: Downstream, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    const store = storage.getStore()
    if (store) {
      store.ms[kind] += performance.now() - start
      store.calls[kind] += 1
    }
  }
}
