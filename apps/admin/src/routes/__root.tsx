import { Outlet } from '@tanstack/react-router'

/** Root layout — minimal shell, no chrome. Individual route layouts handle their own structure. */
export function RootLayout() {
  return <Outlet />
}
