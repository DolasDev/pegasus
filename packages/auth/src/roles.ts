/**
 * Roles that reach the Operations section — tenant-web's Availability,
 * Shipments, Planning, Trips, Services and Labor screens, and the mobile app's
 * company labor list management.
 *
 * Shared by tenant-web (route guards + nav) and mobile (drawer + Labor). The
 * API enforces its own copy in apps/api/src/lib/longhaul-read-scope.ts (it
 * does not depend on this package); a test there asserts the two agree.
 */
export const OPERATIONS_ROLES = [
  'tenant_admin',
  'operations_admin',
  'long_distance_dispatch',
  'central_planning_dispatch',
] as const

export function hasOperationsRole(roleNames: readonly string[] | null | undefined): boolean {
  return (roleNames ?? []).some((r) => (OPERATIONS_ROLES as readonly string[]).includes(r))
}
