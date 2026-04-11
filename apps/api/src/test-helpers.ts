// ---------------------------------------------------------------------------
// Shared test helpers for handler tests
//
// Provides the global onError handler that mirrors app.ts behaviour so that
// DomainError → 422 routing works in test apps without repeating the logic
// in every test file.
// ---------------------------------------------------------------------------

import type { Hono } from 'hono'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from './types'

/**
 * Registers the global onError handler on a test Hono app instance.
 * Mirrors the production handler in app.ts: DomainError → 422, everything
 * else → 500 INTERNAL_ERROR.
 */
export function registerTestErrorHandler(app: Hono<AppEnv>): void {
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: err.message, code: err.code }, 422)
    }
    return c.json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' }, 500)
  })
}
