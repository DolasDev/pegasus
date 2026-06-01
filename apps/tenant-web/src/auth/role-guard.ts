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
