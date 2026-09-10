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
 * Planning, Trips, and the two trip-detail screens.
 *
 * Lives here because it is enforced in two places that must agree: the route
 * `beforeLoad` guards in router.tsx and the nav entries in AppShell.tsx. Those
 * each held their own copy, and a grant applied to one but not the other either
 * hides a reachable screen or advertises an unreachable one.
 *
 * Planning and Trips were once narrowed further, to tenant_admin +
 * operations_admin, while the dispatch roles got only Availability/Shipments.
 * That narrowing was lifted: every role here reaches the whole section.
 *
 * Server-side Cedar policies remain the source of truth; this is client-side
 * hardening and UX.
 */
/**
 * Roles that can reach **Dispatch Activities** — a strict subset of
 * OPERATIONS_ROLES.
 *
 * The board is scoped to operations admins by request: it is shaping up to be
 * the dispatcher workstation, and until it is one, a half-built surface should
 * not be the first thing the dispatch personas see under Operations.
 *
 * `tenant_admin` is included because it is the permit-all persona server-side —
 * omitting it here would hide the screen from the tenant's own administrator
 * while Cedar happily authorized every call it makes.
 *
 * Enforced in the two places that must agree: the route `beforeLoad` guard in
 * router.tsx and the nav child in AppShell.tsx. Same reason OPERATIONS_ROLES
 * lives here rather than in either file.
 */
export const DISPATCH_ACTIVITIES_ROLES = ['tenant_admin', 'operations_admin'] as const

export const OPERATIONS_ROLES = [
  'tenant_admin',
  'operations_admin',
  'long_distance_dispatch',
  'central_planning_dispatch',
] as const

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
