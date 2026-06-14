// ---------------------------------------------------------------------------
// Request-timing middleware
//
// Runs each request inside a per-request downstream-timing scope (see
// lib/request-timing.ts) and, on completion, emits ONE structured log line
// carrying the total request duration plus the per-downstream breakdown
// (Neon DB / mssql-executor invoke / tunnel-proxy invoke). correlationId,
// method, and path are already attached to the logger by correlationMiddleware,
// so this line correlates directly to a request.
//
// Why this exists: a prod p99 spike (16.8s, then 29s on Jun 1) logged nothing
// between START and END — there was no way to tell which downstream stalled.
// This line makes the *next* spike attributable from CloudWatch Logs alone,
// and feeds the saved Logs-Insights queries that rank endpoints by latency.
//
// Must be registered AFTER correlationMiddleware (so the logger keys are set)
// and as early as possible otherwise (so durationMs captures the whole chain).
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'
import { runWithTiming, getTiming } from '../lib/request-timing'

export async function requestTimingMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const start = performance.now()
  await runWithTiming(async () => {
    try {
      await next()
    } finally {
      const t = getTiming()
      const ms = t?.ms ?? { db: 0, mssql: 0, tunnel: 0 }
      const calls = t?.calls ?? { db: 0, mssql: 0, tunnel: 0 }
      const durationMs = Math.round(performance.now() - start)
      const downstreamMs = Math.round(ms.db + ms.mssql + ms.tunnel)

      // Flat fields (not nested objects) so a Logs-Insights query can `stats`
      // and `sort` on durationMs / dbMs / mssqlMs / tunnelMs directly.
      logger.info('request.completed', {
        // The matched route pattern (e.g. /api/v1/customers/:id) — groups
        // requests despite the single ANY /{proxy+} API Gateway route.
        route: c.req.routePath,
        status: c.res.status,
        durationMs,
        downstreamMs,
        // The portion NOT attributable to a tracked downstream — compute time,
        // auth, untracked I/O. A large unattributedMs on a slow request points
        // away from Neon/MSSQL/tunnel.
        unattributedMs: Math.max(0, durationMs - downstreamMs),
        dbMs: Math.round(ms.db),
        dbCalls: calls.db,
        mssqlMs: Math.round(ms.mssql),
        mssqlCalls: calls.mssql,
        tunnelMs: Math.round(ms.tunnel),
        tunnelCalls: calls.tunnel,
      })
    }
  })
}
