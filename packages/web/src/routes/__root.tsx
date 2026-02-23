import { Outlet, useRouter } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'

/** Routes that render without the AppShell sidebar/header. */
function isShellFree(pathname: string): boolean {
  return pathname === '/' || pathname === '/login' || pathname.startsWith('/login/')
}

export function RootLayout() {
  const router = useRouter()
  const pathname = router.state.location.pathname

  if (isShellFree(pathname)) {
    return <Outlet />
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
