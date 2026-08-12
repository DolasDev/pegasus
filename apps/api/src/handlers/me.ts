// ---------------------------------------------------------------------------
// /api/v1/me — introspection endpoints for the authenticated principal.
//
// GET /permissions
//   Returns the principal's role-group memberships, the list of every action
//   they're allowed to perform (expressed as `resource:verb`), and the tenant's
//   capability flags. Designed to be consumable by:
//     - the SPA's permission gates (hide/show buttons) and capability gates
//       (hide/show whole features that depend on tenant configuration)
//     - external integrations that need to know what their user can do
//   The shape is the public contract — keep it human-readable.
//
//   `capabilities` are tenant-configuration facts, NOT Cedar permissions:
//     - longhaul — the tenant has a legacy MSSQL configured
//       (`Tenant.mssqlConnectionString`). The longhaul endpoints 422
//       MSSQL_NOT_CONFIGURED without it, so the SPA uses this to avoid mounting
//       the Operations feature / longhaul-driver picker on tenants that have no
//       legacy DB. Coarse boolean only — the connection string is never exposed.
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
import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { listAllowedPermissions } from '../lib/authz'
import { isReportingEnabled } from '../lib/reporting-feature'
import {
  getUserPreferences,
  updateUserPreferences,
  UserPreferencesPatch,
} from '../lib/user-preferences'

export const meHandler = new Hono<AppEnv>()

/** Tenant-configuration capability flags surfaced to the SPA. */
export interface Capabilities {
  /** Tenant has a legacy MSSQL configured (`Tenant.mssqlConnectionString`). */
  longhaul: boolean
  /**
   * The reporting (dashboards) surface is deployed and enabled. Unlike
   * `longhaul` this is a deployment fact rather than a per-tenant one, but it
   * belongs here for the same reason: the SPA must not mount a feature whose
   * endpoints 404. `report:read` is granted by Cedar regardless of the flag, so
   * the permission alone is not enough to decide whether to show the nav entry.
   */
  reporting: boolean
}

// Resolve tenant capability flags. Defensive: an M2M / service-account
// principal may have no tenant-scoped `db` or `tenantId` in context — treat
// that as "no capabilities" rather than throwing (the endpoint must not 500 for
// principals that legitimately have no tenant row).
async function resolveCapabilities(c: Context<AppEnv>): Promise<Capabilities> {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const reporting = isReportingEnabled()
  if (!db || !tenantId) return { longhaul: false, reporting }

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { mssqlConnectionString: true },
  })
  return { longhaul: tenant?.mssqlConnectionString != null, reporting }
}

// No requirePermission gate — every authenticated principal may read their
// own permission set. The principal is sourced from the request JWT (or the
// SKIP_AUTH synthesised one), so cross-principal disclosure is structurally
// impossible.
meHandler.get('/permissions', async (c) => {
  const principal = c.get('principal')
  const idToken = c.get('idToken')
  const policyStoreId = c.get('policyStoreId')

  const permissions = await listAllowedPermissions(principal, idToken, policyStoreId)
  const capabilities = await resolveCapabilities(c)

  return c.json({
    roles: principal.roleNames,
    permissions,
    capabilities,
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

// ---------------------------------------------------------------------------
// Per-user preferences.
//
// No requirePermission gate, for the same reason as /driver: these are the
// caller's OWN settings, scoped to c.get('userId'), so cross-user disclosure is
// structurally impossible and there is no role that should be denied its own
// profile. A principal with no TenantUser row (service account / M2M) reads
// defaults and cannot write.
// ---------------------------------------------------------------------------

meHandler.get('/preferences', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    // Hydrated defaults, so an M2M caller gets the same shape as a human.
    return c.json({ data: { reporting: {} } })
  }
  return c.json({ data: await getUserPreferences(c.get('db'), userId) })
})

meHandler.patch('/preferences', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'This principal has no user profile', code: 'NO_USER_PROFILE' }, 403)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_BODY' }, 400)
  }

  const parsed = UserPreferencesPatch.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid preferences patch', code: 'INVALID_BODY', details: parsed.error.issues },
      400,
    )
  }

  // NOTE: `defaultDashboardSlug` is deliberately NOT checked against the
  // dashboard table here. A slug that does not resolve falls back to the
  // built-in at render time, and validating on write would (a) fail a user who
  // sets a default for a dashboard published moments later, and (b) turn a
  // harmless dangling preference into a hard error.
  return c.json({ data: await updateUserPreferences(c.get('db'), userId, parsed.data) })
})
