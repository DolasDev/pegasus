import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Truck,
  FileText,
  Users,
  Calendar,
  Receipt,
  MapPinned,
  LogOut,
  ShieldCheck,
  UserCog,
  Key,
  Workflow,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSession, clearSession } from '@/auth/session'
import { getCognitoConfig, buildLogoutUrl } from '@/auth/cognito'

const SIDEBAR_COLLAPSED_KEY = 'pegasus.sidebar.collapsed'

const NAV_ITEMS = [
  { to: '/dashboard' as const, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/moves' as const, label: 'Moves', icon: Truck, exact: false },
  { to: '/quotes' as const, label: 'Quotes', icon: FileText, exact: false },
  { to: '/customers' as const, label: 'Customers', icon: Users, exact: false },
  { to: '/dispatch' as const, label: 'Dispatch', icon: Calendar, exact: false },
  { to: '/invoices' as const, label: 'Billing', icon: Receipt, exact: false },
  { to: '/driver-planning' as const, label: 'Operations', icon: MapPinned, exact: false },
] as const

const SETTINGS_NAV_ITEMS = [
  { to: '/settings/users' as const, label: 'Users', icon: UserCog, exact: false },
  { to: '/settings/sso' as const, label: 'SSO Providers', icon: ShieldCheck, exact: false },
  { to: '/settings/developer' as const, label: 'Developer Settings', icon: Key, exact: false },
  { to: '/settings/workflows' as const, label: 'Workflows', icon: Workflow, exact: false },
] as const

type NavItemProps = {
  to: string
  label: string
  icon: LucideIcon
  exact: boolean
  collapsed: boolean
}

function NavItem({ to, label, icon: Icon, exact, collapsed }: NavItemProps) {
  const router = useRouter()
  const pathname = router.state.location.pathname
  const isActive = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/')

  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md text-sm transition-colors',
        collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
        isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
      )}
    >
      <Icon size={16} />
      {!collapsed && label}
    </Link>
  )
}

type AppShellProps = {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const session = getSession()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  })

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // localStorage may be unavailable (private mode) — ignore.
      }
      return next
    })
  }

  function handleLogout() {
    clearSession()
    // Redirect to the Cognito logout endpoint, which clears the Cognito SSO
    // cookie so the next login requires re-authentication with the IdP.
    // Falls back to /login if Cognito env vars are not configured (local dev).
    try {
      const config = getCognitoConfig()
      window.location.href = buildLogoutUrl(config)
    } catch {
      window.location.href = '/login'
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r bg-card transition-[width] duration-200 ease-out',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center',
            collapsed ? 'justify-center px-0' : 'justify-between px-4',
          )}
        >
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-foreground">Pegasus</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1 py-2">
          <nav className={cn('space-y-1', collapsed ? 'px-1' : 'px-2')}>
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
          </nav>
          {collapsed ? (
            <div className="px-2 py-3">
              <Separator />
            </div>
          ) : (
            <div className="px-4 pb-1 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Settings
              </p>
            </div>
          )}
          <nav className={cn('space-y-1', collapsed ? 'px-1' : 'px-2')}>
            {SETTINGS_NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm text-muted-foreground">{session?.tenantName ?? ''}</span>
          {session && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{session.email}</span>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleLogout}>
                <LogOut size={14} />
                Sign out
              </Button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
