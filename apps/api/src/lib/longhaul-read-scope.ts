// ---------------------------------------------------------------------------
// Who may read which driver's rows on the /onprem/longhaul/* reads.
//
// Operations users (OPERATIONS_ROLES) read everything — the dispatcher screens.
// Everyone else is scoped to their own TenantUser.longhaulDriverId, and a caller
// with no mapping reads nothing (fail closed). A user holding both `driver` and
// an Operations role is an Operations user.
//
// Not Cedar: no Action covers longhaul reads and the dispatcher personas grant
// nothing (they are deliberate placeholders), so `requirePermission` would lock
// dispatchers out. This is the handler-level row scoping moves.ts and
// driver-activity-eta.ts already use (PATTERNS.md, "Longhaul reads are
// driver-scoped server-side").
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { AppEnv } from '../types'

/**
 * Roles with the full longhaul read surface. Must agree with the shared
 * OPERATIONS_ROLES (packages/auth/src/roles.ts), which gates the
 * Operations screens client-side; this copy is the one that is enforced.
 */
export const OPERATIONS_ROLES: readonly string[] = [
  'tenant_admin',
  'operations_admin',
  'long_distance_dispatch',
  'central_planning_dispatch',
]

export type LonghaulReadScope =
  | { kind: 'all' }
  | { kind: 'driver'; driverId: number }
  /** Restricted caller with no usable driver mapping — sees nothing. */
  | { kind: 'none' }

export function hasOperationsRole(roleNames: readonly string[]): boolean {
  return roleNames.some((r) => OPERATIONS_ROLES.includes(r))
}

/**
 * Driver 0 is the placeholder "unassigned" driver in the legacy tables, so a
 * login mapped to 0 must match nothing (see driver-activity-eta.ts).
 */
export function scopeForDriverId(driverId: number | null | undefined): LonghaulReadScope {
  return driverId == null || driverId === 0 ? { kind: 'none' } : { kind: 'driver', driverId }
}

export async function resolveLonghaulReadScope(c: Context<AppEnv>): Promise<LonghaulReadScope> {
  const roleNames = c.get('principal')?.roleNames ?? []
  if (hasOperationsRole(roleNames)) return { kind: 'all' }

  const userId = c.get('userId')
  if (!userId) return { kind: 'none' }
  const user = await c.get('db').tenantUser.findUnique({
    where: { id: userId },
    select: { longhaulDriverId: true },
  })
  return scopeForDriverId(user?.longhaulDriverId)
}
