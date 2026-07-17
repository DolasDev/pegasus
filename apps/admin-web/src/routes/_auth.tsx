import { Outlet, Link, redirect, useRouter } from '@tanstack/react-router'
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

const NAV_ITEMS = [
  { to: '/tenants' as const, label: 'Tenants' },
  { to: '/workflows' as const, label: 'Workflows' },
  { to: '/tariffs' as const, label: 'Tariffs' },
] as const

function NavLinks() {
  const router = useRouter()
  const pathname = router.state.location.pathname
  return (
    <nav className="flex items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
        return (
          <Link
            key={item.to}
            to={item.to}
            className={
              isActive
                ? 'rounded px-2.5 py-1 text-sm font-medium text-foreground bg-muted'
                : 'rounded px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-card px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-foreground">Pegasus Admin</span>
            <NavLinks />
          </div>
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
