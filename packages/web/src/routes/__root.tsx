import { Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'

export function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
