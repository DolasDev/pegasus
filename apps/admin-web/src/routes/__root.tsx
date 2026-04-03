import { Outlet } from '@tanstack/react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** Root layout — minimal shell, no chrome. Individual route layouts handle their own structure. */
export function RootLayout() {
  return (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  )
}
