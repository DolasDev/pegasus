// ---------------------------------------------------------------------------
// Role-based access control middleware
//
// Restricts access to routes based on the user's role within their tenant.
// Must be mounted AFTER the tenant middleware so that `c.get('role')` is
// populated from the validated JWT claims.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import { authorize } from '../lib/authz'
import type { ActionDef, ResourceRef } from '../lib/authz.types'

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

/**
 * Cedar/AVP-based authorization middleware. The replacement for `requireRole`
 * in handlers that have been migrated to the per-action permission model.
 *
 * @param action      Action catalog entry (e.g. `Actions.InviteUser`).
 * @param resourceFn  Optional builder that maps the request context to a
 *                    specific resource — handy for future per-instance ABAC
 *                    rules (e.g. "the move you're updating must be in your
 *                    region"). Omit for coarse-grained "can I list users?"
 *                    checks.
 */
export function requirePermission(
  action: ActionDef,
  resourceFn?: (c: Context<AppEnv>) => ResourceRef,
) {
  return async (c: Context<AppEnv>, next: Next): Promise<Response | void> => {
    const principal = c.get('principal')
    if (!principal) {
      return c.json(
        { error: 'Forbidden: insufficient permissions for this action', code: 'FORBIDDEN' },
        403,
      )
    }

    const decision = await authorize({
      principal,
      action,
      ...(resourceFn ? { resource: resourceFn(c) } : {}),
      idToken: c.get('idToken'),
      policyStoreId: c.get('policyStoreId'),
    })

    if (!decision.allowed) {
      return c.json(
        { error: 'Forbidden: insufficient permissions for this action', code: 'FORBIDDEN' },
        403,
      )
    }

    await next()
  }
}
