// ---------------------------------------------------------------------------
// Role-based access control middleware
//
// Restricts access to routes based on the user's role within their tenant.
// Must be mounted AFTER the tenant middleware so that `c.get('role')` is
// populated from the validated JWT claims.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'

/**
 * Creates a middleware that requires the user to have one of the specified roles.
 *
 * @param allowedRoles Array of acceptable roles (e.g. ['tenant_admin'])
 */
export function requireRole(allowedRoles: string[]) {
  return async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
    const role = c.get('role')

    if (!role || !allowedRoles.includes(role)) {
      return c.json(
        { error: 'Forbidden: insufficient permissions for this action', code: 'FORBIDDEN' },
        403,
      )
    }

    await next()
  }
}
