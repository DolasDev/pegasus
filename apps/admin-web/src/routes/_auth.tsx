import { Outlet, redirect } from '@tanstack/react-router'
import { getAccessToken, signOut } from '@/auth/cognito'

/**
 * Auth-guard layout route. All protected routes are children of this route.
 * If no access token is present in sessionStorage the user is redirected to
 * the login page before the component even renders.
 *
 * The `beforeLoad` check is synchronous so there is no flash of protected
 * content — TanStack Router aborts the navigation before mounting anything.
 */
export function authGuard() {
  if (!getAccessToken()) {
    throw redirect({ to: '/login' })
  }
}

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-card px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">Pegasus Admin</span>
          <button
            onClick={signOut}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
