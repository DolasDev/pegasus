// ---------------------------------------------------------------------------
// Correlation ID middleware
//
// Extracts the x-correlation-id header from each incoming request (or
// generates a fresh UUID) and:
//   1. Stores it in the Hono context so error handlers can include it in
//      sanitised error responses.
//   2. Attaches it to the shared logger's persistent keys so every log line
//      emitted during this request includes correlationId, method, and path.
//   3. Echoes it back in the x-correlation-id response header so the frontend
//      can surface it to users when reporting errors.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

export async function correlationMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const correlationId = c.req.header('x-correlation-id') ?? crypto.randomUUID()

  c.set('correlationId', correlationId)
  c.header('x-correlation-id', correlationId)

  // Embed the correlation ID (plus request method/path) in every log line
  // emitted during this request lifecycle.
  logger.appendKeys({ correlationId, method: c.req.method, path: c.req.path })

  await next()

  // Clear per-request keys so they don't bleed into the next warm invocation.
  logger.removeKeys(['correlationId', 'method', 'path'])
}
