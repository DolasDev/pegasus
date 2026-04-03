// ---------------------------------------------------------------------------
// Scope utility — reusable permission check for API client (M2M) auth
// ---------------------------------------------------------------------------

import type { Context, MiddlewareHandler, Next } from 'hono'
import type { ApiClientEnv } from '../types'

/**
 * Check whether a required scope is present in a scopes array.
 * Exact string match — no prefix/wildcard logic.
 */
export function hasScope(requiredScope: string, scopes: string[]): boolean {
  return scopes.includes(requiredScope)
}

/**
 * Hono middleware factory that requires the API client to hold a specific scope.
 * Must be applied AFTER apiClientAuthMiddleware so that c.get('apiClient') is set.
 *
 * Returns 403 FORBIDDEN if the scope is absent or the apiClient is not set.
 */
export function requireScope(scope: string): MiddlewareHandler {
  return async (c: Context<ApiClientEnv>, next: Next): Promise<Response | void> => {
    const apiClient = c.get('apiClient')
    if (!apiClient || !hasScope(scope, apiClient.scopes)) {
      return c.json(
        { error: `Forbidden: missing required scope "${scope}"`, code: 'FORBIDDEN' },
        403,
      )
    }
    await next()
  }
}
