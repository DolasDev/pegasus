// ---------------------------------------------------------------------------
// Cedar/AVP-based authorization middleware.
//
// Mounted AFTER the tenant middleware so that `principal` is populated from
// the validated JWT claims.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import { authorize } from '../lib/authz'
import type { ActionDef, ResourceRef } from '../lib/authz.types'

/**
 * Per-action permission middleware backed by Cedar/AVP.
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
