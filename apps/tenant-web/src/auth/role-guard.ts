import { redirect } from '@tanstack/react-router'
import { getSession } from './session'

/**
 * Factory for TanStack Router `beforeLoad` guards that restrict a route (or
 * route subtree) to one or more roles.
 *
 * - Unauthenticated callers are redirected to `/login` (mirrors `authGuard`).
 * - Authenticated callers whose `session.roleNames` does not intersect
 *   `allowedRoles` are redirected to `/dashboard`.
 *
 * Reads from `getSession().roleNames` (authoritative — see `session.ts`)
 * synchronously, so the guard fires before the protected route's component
 * mounts and there is no flash of unauthorized content. Server-side Cedar
 * policies remain the source of truth for permission enforcement; this guard
 * is client-side hardening and UX.
 *
 * Usage:
 *   const settingsLayout = createRoute({
 *     getParentRoute: () => authLayout,
 *     id: '_settings',
 *     beforeLoad: requireRole('tenant_admin'),
 *   })
 */
/**
 * Roles that can reach the Operations section — Availability, Shipments,
 * Planning, Trips, Services, Labor, and the two trip-detail screens.
 *
 * Enforced in two places that must agree: the route `beforeLoad` guards in
 * router.tsx and the nav entries in AppShell.tsx. The list itself lives in
 * @pegasus/auth so the mobile app gates its Labor management on the same roles.
 *
 * Server-side Cedar policies remain the source of truth; this is client-side
 * hardening and UX.
 */
export { OPERATIONS_ROLES } from '@pegasus/auth'

export function requireRole(...allowedRoles: string[]): () => void {
  return () => {
    const session = getSession()
    if (!session) {
      throw redirect({ to: '/login' })
    }
    const allowed = session.roleNames.some((r) => allowedRoles.includes(r))
    if (!allowed) {
      throw redirect({ to: '/dashboard' })
    }
  }
}
