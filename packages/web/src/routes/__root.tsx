import { Outlet, useRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** Routes that render without the AppShell sidebar/header. */
function isShellFree(pathname: string): boolean {
  return pathname === '/' || pathname === '/login' || pathname.startsWith('/login/')
}

export function RootLayout() {
  const router = useRouter()
  const pathname = router.state.location.pathname

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
