import { Suspense } from 'react'
import { Provider } from 'react-redux'
import { Link, Outlet, useRouter } from '@tanstack/react-router'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import store from './redux/store'
import { AppGuard } from './containers/AppGuard'
import './styles.css'

const TABS = [
  { to: '/driver-planning', label: 'Availability', exact: true },
  { to: '/driver-planning/planning', label: 'Planning', exact: false },
  { to: '/driver-planning/trips', label: 'Trips', exact: false },
  { to: '/driver-planning/shipments', label: 'Shipments', exact: false },
] as const

function DriverPlanningTabs() {
  const router = useRouter()
  const pathname = router.state.location.pathname

  return (
    <nav className="flex gap-1 border-b">
      {TABS.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.to
          : pathname === tab.to || pathname.startsWith(tab.to + '/')
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function DriverPlanningLayout() {
  return (
    <Provider store={store}>
      <div className="driver-planning-root space-y-4">
        <PageHeader title="Driver Planning" breadcrumbs={[{ label: 'Driver Planning' }]} />
        <DriverPlanningTabs />
        <AppGuard>
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
            <Outlet />
          </Suspense>
        </AppGuard>
      </div>
    </Provider>
  )
}
