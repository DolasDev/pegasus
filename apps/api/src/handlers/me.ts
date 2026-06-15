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
//
// GET /driver
//   Returns the longhaul driver id this login is mapped to (set by a tenant
//   admin in the Users settings UI), or null when unmapped. The mobile "My
//   Trips" screen reads this to scope the longhaul trips list to the logged-in
//   driver. Deliberately separate from /onprem/longhaul/users/me — that route
//   requires a v_longhaul_salesman row and 422s for users without one, whereas
//   a driver may have no salesman mapping at all.
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

// No requirePermission gate — every authenticated principal may read their own
// driver mapping. Scoped to the calling user via c.get('userId'); cross-user
// disclosure is structurally impossible. Returns null for service accounts /
// M2M principals (no TenantUser row resolved).
meHandler.get('/driver', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')

  if (!userId) {
    return c.json({ data: { longhaulDriverId: null } })
  }

  const user = await db.tenantUser.findUnique({
    where: { id: userId },
    select: { longhaulDriverId: true },
  })

  return c.json({ data: { longhaulDriverId: user?.longhaulDriverId ?? null } })
})
