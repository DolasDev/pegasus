import { Outlet, useRouterState } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** Routes that render without the AppShell sidebar/header. */
function isShellFree(pathname: string): boolean {
  return pathname === '/' || pathname === '/login' || pathname.startsWith('/login/')
}

export function RootLayout() {
  // Reactive subscription so the shell/shell-free branch tracks client-side
  // navigation — `useRouter().state` is a non-reactive read of a stable router.
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (isShellFree(pathname)) {
    return (
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <AppShell>
        <Outlet />
      </AppShell>
    </ErrorBoundary>
  )
}
