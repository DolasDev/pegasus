import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
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
  Zap,
  Phone,
  Blocks,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSession, clearSession } from '@/auth/session'
import { getCognitoConfig, buildLogoutUrl } from '@/auth/cognito'
import { usePermissions } from '@/auth/permissions'

const SIDEBAR_COLLAPSED_KEY = 'pegasus.sidebar.collapsed'

const ADMIN_ONLY = ['tenant_admin'] as const
// Drivers get the Moves nav alongside admins — the list and detail screens are
// read-only and the API scopes a driver to their own assigned trips.
const MOVES_VIEW_ROLES = ['tenant_admin', 'driver'] as const
// Roles that may read published integration configs — mirrors the Cedar grant
// (viewer baseline + integration_publisher; tenant_admin via permit-all).
const INTEGRATION_VIEW_ROLES = ['tenant_admin', 'viewer', 'integration_publisher'] as const
const OPERATIONS_PLANNING_ROLES = [
  'tenant_admin',
  'operations_admin',
  'long_distance_dispatch',
  'central_planning_dispatch',
] as const

const OPERATIONS_CHILDREN = [
  { to: '/driver-planning' as const, label: 'Availability', exact: true },
  { to: '/driver-planning/planning' as const, label: 'Planning', exact: false },
  { to: '/driver-planning/trips' as const, label: 'Trips', exact: false },
  { to: '/driver-planning/shipments' as const, label: 'Shipments', exact: false },
] as const

const NAV_ITEMS = [
  {
    to: '/dashboard' as const,
    label: 'Dashboard',
    icon: LayoutDashboard,
    exact: true,
    roles: null,
    children: null,
  },
  {
    to: '/moves' as const,
    label: 'Moves',
    icon: Truck,
    exact: false,
    roles: MOVES_VIEW_ROLES,
    children: null,
  },
  {
    to: '/quotes' as const,
    label: 'Quotes',
    icon: FileText,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/customers' as const,
    label: 'Customers',
    icon: Users,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/dispatch' as const,
    label: 'Dispatch',
    icon: Calendar,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/invoices' as const,
    label: 'Billing',
    icon: Receipt,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/driver-planning' as const,
    label: 'Operations',
    icon: MapPinned,
    exact: false,
    roles: OPERATIONS_PLANNING_ROLES,
    children: OPERATIONS_CHILDREN,
    // Operations (longhaul driver planning) hits legacy-MSSQL endpoints that
    // 422 without a `mssqlConnectionString`. Hide the whole section on tenants
    // that have no legacy DB — see `hasCapability` (fails open on absence).
    capability: 'longhaul' as const,
  },
  {
    // Read-only mapping/ruleset viewer for published integrations. Shown to the
    // roles that hold ReadIntegrationConfig (viewer/admin/publisher) so the nav
    // matches the API grant and non-granted personas don't hit a dead end.
    to: '/integrations' as const,
    label: 'Integrations',
    icon: Blocks,
    exact: false,
    roles: INTEGRATION_VIEW_ROLES,
    children: null,
  },
] as const

// One submenu entry per main-menu section — mirrors NAV_ITEMS order so the
// rail inside /settings/app and the App Settings group here read the same.
const APP_SETTINGS_CHILDREN = [
  { to: '/settings/app/dashboard' as const, label: 'Dashboard', exact: false },
  { to: '/settings/app/moves' as const, label: 'Moves', exact: false },
  { to: '/settings/app/quotes' as const, label: 'Quotes', exact: false },
  { to: '/settings/app/customers' as const, label: 'Customers', exact: false },
  { to: '/settings/app/dispatch' as const, label: 'Dispatch', exact: false },
  { to: '/settings/app/billing' as const, label: 'Billing', exact: false },
  { to: '/settings/app/operations' as const, label: 'Operations', exact: false },
] as const

// Every page under Settings is tenant-admin-only. The role guard on
// `settingsLayout` in router.tsx is the authoritative enforcement; this list
// just decides which entries the sidebar renders so non-admins don't see
// dead-end links.
//
// Flat entries render via `NavItem`; entries with a `children` array render
// via `NavGroup` — the same component used by the main `Operations` nav above.
const SETTINGS_NAV_ITEMS = [
  {
    to: '/settings/users' as const,
    label: 'Users',
    icon: UserCog,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/sso' as const,
    label: 'SSO Providers',
    icon: ShieldCheck,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/developer' as const,
    label: 'Developer',
    icon: Key,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/workflows' as const,
    label: 'Workflows',
    icon: Workflow,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/event-types' as const,
    label: 'Event Types',
    icon: Zap,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/integrations/ringcentral' as const,
    label: 'RingCentral',
    icon: Phone,
    exact: false,
    roles: ADMIN_ONLY,
    children: null,
  },
  {
    to: '/settings/app' as const,
    label: 'App Settings',
    icon: SlidersHorizontal,
    exact: false,
    roles: ADMIN_ONLY,
    children: APP_SETTINGS_CHILDREN,
  },
] as const

type NavItemProps = {
  to: string
  label: string
  icon: LucideIcon
  exact: boolean
  collapsed: boolean
}

function NavItem({ to, label, icon: Icon, exact, collapsed }: NavItemProps) {
  // Subscribe to the location reactively — `useRouter().state` is a non-reactive
  // read (plain context), so this layout-level component wouldn't re-render on
  // client-side navigation and the active highlight would stick.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
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

type NavChild = { to: string; label: string; exact: boolean }

type NavGroupProps = {
  to: string
  label: string
  icon: LucideIcon
  exact: boolean
  collapsed: boolean
  items: readonly NavChild[]
}

function NavGroup({ to, label, icon: Icon, exact, collapsed, items }: NavGroupProps) {
  // Reactive location subscription (see NavItem) — also drives `isInSection`,
  // which the expander open-state below depends on.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isInSection = pathname === to || pathname.startsWith(to + '/')
  const isParentActive = exact ? pathname === to : isInSection
  const [open, setOpen] = useState<boolean>(isInSection)

  // Re-open the group whenever the user navigates into it (e.g. from another
  // section). Manual close still works while the user stays inside.
  useEffect(() => {
    if (isInSection) setOpen(true)
  }, [isInSection])

  // Collapsed sidebar — fall back to a single icon link; the sub-items live
  // inside the section page once the user navigates in.
  if (collapsed) {
    return <NavItem to={to} label={label} icon={Icon} exact={exact} collapsed={collapsed} />
  }

  return (
    <div>
      <div className="flex items-center">
        <Link
          to={to}
          className={cn(
            'flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            isParentActive
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
          )}
        >
          <Icon size={16} />
          {label}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={open}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
        >
          <ChevronDown
            size={14}
            className={cn('transition-transform', open ? 'rotate-0' : '-rotate-90')}
          />
        </button>
      </div>
      {open && (
        <div className="mt-1 ml-7 space-y-1 border-l pl-2">
          {items.map((child) => {
            const childActive = child.exact
              ? pathname === child.to
              : pathname === child.to || pathname.startsWith(child.to + '/')
            return (
              <Link
                key={child.to}
                to={child.to}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  childActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                {child.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

type AppShellProps = {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const session = getSession()
  const perms = usePermissions()
  const userRoles = new Set(perms.roles)
  const visibleNavItems = perms.isLoading
    ? []
    : NAV_ITEMS.filter((item) => {
        const roleOk = item.roles === null || item.roles.some((r) => userRoles.has(r))
        // Capability gate is independent of roles: a capability-tagged item
        // (only Operations today) is hidden when the tenant lacks it, even for
        // an admin. `hasCapability` fails open, so untagged items are unaffected.
        const capOk = !('capability' in item) || perms.hasCapability(item.capability)
        return roleOk && capOk
      })
  const visibleSettingsItems = perms.isLoading
    ? []
    : SETTINGS_NAV_ITEMS.filter((item) => item.roles.some((r) => userRoles.has(r)))
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    } catch {
      // localStorage may be unavailable (private mode, SSR, restricted
      // sandboxes) — fall back to the expanded sidebar. Matches the
      // try/catch around the setItem call below.
      return false
    }
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
            {visibleNavItems.map((item) =>
              item.children ? (
                <NavGroup
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  exact={item.exact}
                  collapsed={collapsed}
                  items={item.children}
                />
              ) : (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  exact={item.exact}
                  collapsed={collapsed}
                />
              ),
            )}
          </nav>
          {visibleSettingsItems.length > 0 && (
            <>
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
                {visibleSettingsItems.map((item) =>
                  item.children ? (
                    <NavGroup
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      exact={item.exact}
                      collapsed={collapsed}
                      items={item.children}
                    />
                  ) : (
                    <NavItem
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      exact={item.exact}
                      collapsed={collapsed}
                    />
                  ),
                )}
              </nav>
            </>
          )}
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
