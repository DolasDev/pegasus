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
//
// GET /driver/metrics
//   The driver dashboard's trip counts + financials for the caller's linked
//   driver. See the route below for the partial-failure contract.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { listAllowedPermissions } from '../lib/authz'
import { isReportingEnabled } from '../lib/reporting-feature'
import { executeSql } from '../lib/mssql-executor-client'
import { logger } from '../lib/logger'
import { driverWeekFor } from '../lib/driver-week'
import { resolvePegiiCaller } from '../lib/pegii-request-context'
import { resolveDriverGateway } from '../gateways/driver-gateway.factory'
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
    // The caller's TenantUser id (null for M2M / service accounts) — lets a
    // client recognize its own rows, e.g. which chat messages are "mine".
    userId: c.get('userId') ?? null,
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
// GET /driver/metrics — the driver dashboard's numbers.
//
// Scoped like /driver: the driver id comes ONLY from the caller's
// TenantUser.longhaulDriverId — never from the query or body — so a driver can
// read nobody else's trips or money. Trip counts come from one aggregate read of
// the tenant's legacy TripMaster; financials come from on-prem Pegasus.Api via
// the pegII gateway. The two run concurrently and fail independently: a section
// that cannot be served is null with a reason in `unavailable`, and the route
// still returns 200 so e.g. an on-prem site that has not deployed the financials
// endpoint yet still gets trip counts.
//
// "This week" is Monday 00:00 US Central → now (lib/driver-week.ts).
// ---------------------------------------------------------------------------

// Parameterized throughout; nothing the client sends reaches this string.
// COUNT(CASE …) (not SUM) so a driver with no trips gets 0, not NULL.
// Completed = Finalized (5) with its end date in this Monday-start week. NW
// never fills actual_last_day or finalized_date (0 of 1,234 finalized trips,
// 2026-10-15), so the planned end stands in until the actual one is recorded.
const DRIVER_TRIP_COUNTS_SQL = `
SELECT
  COUNT(CASE WHEN TripStatus_id IN (3, 4) THEN 1 END) AS activeShipments,
  COUNT(CASE WHEN TripStatus_id = 5
              AND COALESCE(actual_last_day, planned_last_day) >= CAST(@weekStart AS date)
              AND COALESCE(actual_last_day, planned_last_day) < DATEADD(day, 7, CAST(@weekStart AS date))
             THEN 1 END) AS completedThisWeek
FROM TripMaster
WHERE driver_id = @driverId
  AND (internal_status IS NULL OR internal_status <> 'canceled')`

interface UnavailableSection {
  section: 'trips' | 'financials'
  reason: string
}

function reasonOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'UNAVAILABLE'
}

meHandler.get('/driver/metrics', async (c) => {
  const db = c.get('db')
  const userId = c.get('userId')
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')

  const user = userId
    ? await db.tenantUser.findUnique({
        where: { id: userId },
        select: { longhaulDriverId: true },
      })
    : null
  const driverId = user?.longhaulDriverId ?? null
  if (driverId === null) {
    return c.json({ error: 'This login is not linked to a driver', code: 'DRIVER_NOT_LINKED' }, 404)
  }

  const now = new Date()
  const { weekStartDate, weekStartInstant } = driverWeekFor(now)

  const loadTrips = async (): Promise<{ activeShipments: number; completedThisWeek: number }> => {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { mssqlConnectionString: true },
    })
    if (!tenant?.mssqlConnectionString) {
      throw Object.assign(new Error('Legacy database not configured for this tenant'), {
        code: 'NOT_CONFIGURED',
      })
    }
    const { recordset } = await executeSql(tenant.mssqlConnectionString, DRIVER_TRIP_COUNTS_SQL, {
      params: [
        { name: 'driverId', value: driverId },
        { name: 'weekStart', value: weekStartDate },
      ],
    })
    const row = (recordset[0] ?? {}) as Record<string, unknown>
    return {
      activeShipments: Number(row['activeShipments'] ?? 0),
      completedThisWeek: Number(row['completedThisWeek'] ?? 0),
    }
  }

  const loadFinancials = async () => {
    const gateway = await resolveDriverGateway(db, tenantId, () => resolvePegiiCaller(c))
    return gateway.getFinancials(driverId)
  }

  const [trips, financials] = await Promise.allSettled([loadTrips(), loadFinancials()])

  const unavailable: UnavailableSection[] = []
  const settle = <T>(section: UnavailableSection['section'], r: PromiseSettledResult<T>) => {
    if (r.status === 'fulfilled') return r.value
    const reason = reasonOf(r.reason)
    // Log the code and message only — never the connection string / token.
    logger.warn('driver metrics section unavailable', {
      section,
      reason,
      tenantId,
      correlationId,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    })
    unavailable.push({ section, reason })
    return null
  }

  const tripsData = settle('trips', trips)
  const financialsData = settle('financials', financials)

  return c.json({
    data: {
      driverId,
      asOf: now.toISOString(),
      weekStart: weekStartInstant.toISOString(),
      trips: tripsData,
      financials: financialsData,
      unavailable,
    },
  })
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
