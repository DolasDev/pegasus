// ---------------------------------------------------------------------------
// AppSettingsLayout — shared shell for /settings/app/*
//
// Renders a left rail of section links (one per main-menu area) and an Outlet
// for the matched child route's content. Visual treatment of the active link
// matches NavItem in components/AppShell.tsx so the rail feels like a
// continuation of the sidebar.
// ---------------------------------------------------------------------------

import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

// One entry per main-menu section. Order matches NAV_ITEMS in AppShell.tsx so
// the rail reads like the sidebar — Dashboard first, Operations last.
const SECTIONS = [
  { to: '/settings/app/dashboard', label: 'Dashboard' },
  { to: '/settings/app/moves', label: 'Moves' },
  { to: '/settings/app/quotes', label: 'Quotes' },
  { to: '/settings/app/customers', label: 'Customers' },
  { to: '/settings/app/dispatch', label: 'Dispatch' },
  { to: '/settings/app/billing', label: 'Billing' },
  { to: '/settings/app/operations', label: 'Operations' },
] as const

export function AppSettingsLayout() {
  // Reactive subscription — this is a layout route whose <Outlet> swaps the
  // child page without re-invoking this component, so a non-reactive
  // `useRouter().state` read would freeze the rail's active highlight.
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title="App Settings" />
        <p className="-mt-4 text-sm text-muted-foreground">
          Tenant-wide UI preferences. Changes apply to every user in this tenant.
        </p>
      </div>
      <div className="flex gap-6">
        <nav
          aria-label="App settings sections"
          data-testid="app-settings-rail"
          className="w-48 shrink-0 space-y-1"
        >
          {SECTIONS.map((s) => {
            // Exact match so /settings/app/dashboard doesn't light up when on
            // /settings/app/dashboard/anything-future. We don't have nested
            // routes today but the SETTINGS sub-pages may grow them.
            const isActive = pathname === s.to
            return (
              <Link
                key={s.to}
                to={s.to}
                data-testid={`app-settings-link-${s.to.split('/').pop()}`}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                {s.label}
              </Link>
            )
          })}
        </nav>
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
