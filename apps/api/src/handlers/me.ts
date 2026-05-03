// ---------------------------------------------------------------------------
// /api/v1/me — introspection endpoints for the authenticated principal.
//
// GET /permissions
//   Returns the principal's role-group memberships and the list of every
//   action they're allowed to perform, expressed as `resource:verb`. Designed
//   to be consumable by:
//     - the SPA's permission gates (hide/show buttons)
//     - external integrations that need to know what their user can do
//   The shape is the public contract — keep it human-readable.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { listAllowedPermissions } from '../lib/authz'

export const meHandler = new Hono<AppEnv>()

// No requirePermission gate — every authenticated principal may read their
// own permission set. The principal is sourced from the request JWT (or the
// SKIP_AUTH synthesised one), so cross-principal disclosure is structurally
// impossible.
meHandler.get('/permissions', async (c) => {
  const principal = c.get('principal')
  const idToken = c.get('idToken')
  const policyStoreId = c.get('policyStoreId')

  const permissions = await listAllowedPermissions(principal, idToken, policyStoreId)

  return c.json({
    roles: principal.roleNames,
    permissions,
  })
})
