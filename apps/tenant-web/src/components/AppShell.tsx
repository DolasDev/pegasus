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
  type LucideIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSession, clearSession } from '@/auth/session'
import { getCognitoConfig, buildLogoutUrl } from '@/auth/cognito'

const NAV_ITEMS = [
  { to: '/dashboard' as const, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/moves' as const, label: 'Moves', icon: Truck, exact: false },
  { to: '/quotes' as const, label: 'Quotes', icon: FileText, exact: false },
  { to: '/customers' as const, label: 'Customers', icon: Users, exact: false },
  { to: '/dispatch' as const, label: 'Dispatch', icon: Calendar, exact: false },
  { to: '/invoices' as const, label: 'Billing', icon: Receipt, exact: false },
  { to: '/driver-planning' as const, label: 'Driver Planning', icon: MapPinned, exact: false },
] as const

const SETTINGS_NAV_ITEMS = [
  { to: '/settings/users' as const, label: 'Users', icon: UserCog, exact: false },
  { to: '/settings/sso' as const, label: 'SSO Providers', icon: ShieldCheck, exact: false },
  { to: '/settings/developer' as const, label: 'Developer Settings', icon: Key, exact: false },
] as const

type NavItemProps = {
  to: string
  label: string
  icon: LucideIcon
  exact: boolean
}

function NavItem({ to, label, icon: Icon, exact }: NavItemProps) {
  const router = useRouter()
  const pathname = router.state.location.pathname
  const isActive = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/')

  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  )
}

type AppShellProps = {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const session = getSession()

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
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-14 items-center px-4">
          <span className="text-lg font-bold tracking-tight text-foreground">Pegasus</span>
        </div>
        <Separator />
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-2">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
          <div className="px-4 pb-1 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
          </div>
          <nav className="space-y-1 px-2">
            {SETTINGS_NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm text-muted-foreground">Move Management Platform</span>
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
