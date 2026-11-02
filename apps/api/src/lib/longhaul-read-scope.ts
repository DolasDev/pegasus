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

// ---------------------------------------------------------------------------
// Order-level reads (the shipment screen: shipment detail, its Labor tab).
//
// A driver works an order either as a longhaul activity (their
// TenantUser.longhaulDriverId) or as a local dispatch job (their
// localDriverEmployeeId, the `crews` numbering space). An order read admits
// both; the trip reads above stay longhaul-only, because a local job has no
// trip. The two ids are separate fields and are never compared to each other
// (GOTCHAS, "Crew number ≠ driver number").
// ---------------------------------------------------------------------------

export type OrderReadScope =
  | { kind: 'all' }
  /** At least one id is set; a null id grants nothing in its space. */
  | { kind: 'driver'; longhaulDriverId: number | null; localDriverEmployeeId: number | null }
  | { kind: 'none' }

/** 0 is the legacy "unassigned" id in both spaces — it never grants a row. */
function realDriverId(id: number | null | undefined): number | null {
  return id == null || id === 0 ? null : id
}

export function orderScopeForIds(
  longhaulDriverId: number | null | undefined,
  localDriverEmployeeId: number | null | undefined,
): OrderReadScope {
  const lh = realDriverId(longhaulDriverId)
  const ld = realDriverId(localDriverEmployeeId)
  return lh === null && ld === null
    ? { kind: 'none' }
    : { kind: 'driver', longhaulDriverId: lh, localDriverEmployeeId: ld }
}

export async function resolveOrderReadScope(c: Context<AppEnv>): Promise<OrderReadScope> {
  const roleNames = c.get('principal')?.roleNames ?? []
  if (hasOperationsRole(roleNames)) return { kind: 'all' }

  const userId = c.get('userId')
  if (!userId) return { kind: 'none' }
  const user = await c.get('db').tenantUser.findUnique({
    where: { id: userId },
    select: { longhaulDriverId: true, localDriverEmployeeId: true },
  })
  return orderScopeForIds(user?.longhaulDriverId, user?.localDriverEmployeeId)
}
