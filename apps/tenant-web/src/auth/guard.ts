import { redirect } from '@tanstack/react-router'
import { getSession } from './session'

/**
 * TanStack Router `beforeLoad` guard that redirects unauthenticated users
 * to `/login`. Expired sessions are already cleared by `getSession()`.
 */
export function authGuard() {
  if (!getSession()) {
    throw redirect({ to: '/login' })
  }
}
