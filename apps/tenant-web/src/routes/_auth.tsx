import { Outlet } from '@tanstack/react-router'

/** Pass-through layout for auth-guarded routes. AppShell chrome is in `__root.tsx`. */
export function AuthLayout() {
  return <Outlet />
}
