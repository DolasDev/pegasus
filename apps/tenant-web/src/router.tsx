import { lazy } from 'react'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LandingPage } from '@/routes/landing'
import { LoginPage } from '@/routes/login'
import { LoginCallbackPage } from '@/routes/login.callback'
import { AuthLayout } from '@/routes/_auth'
import { authGuard } from '@/auth/guard'
import { requireRole } from '@/auth/role-guard'
import { DashboardPage } from '@/routes/index'
import { MovesPage } from '@/routes/moves.index'
import { MoveDetailPage } from '@/routes/moves.$moveId'
import { QuotesPage } from '@/routes/quotes.index'
import { QuoteDetailPage } from '@/routes/quotes.$quoteId'
import { CustomersPage } from '@/routes/customers.index'
import { CustomerDetailPage } from '@/routes/customers.$customerId'
import { DispatchPage } from '@/routes/dispatch.index'
import { InvoicesPage } from '@/routes/invoices.index'
import { SsoConfigPage } from '@/routes/sso-config'
import { UsersPage } from '@/routes/users'
import { DeveloperSettingsPage } from '@/routes/settings.developer'
import { WorkflowsSettingsPage } from '@/routes/settings.workflows'
import { AppSettingsLayout } from '@/features/settings/app/AppSettingsLayout'
import { AppSettingsIndexPage } from '@/routes/settings.app.index'
import { AppSettingsDashboardPage } from '@/routes/settings.app.dashboard'
import { AppSettingsMovesPage } from '@/routes/settings.app.moves'
import { AppSettingsQuotesPage } from '@/routes/settings.app.quotes'
import { AppSettingsCustomersPage } from '@/routes/settings.app.customers'
import { AppSettingsDispatchPage } from '@/routes/settings.app.dispatch'
import { AppSettingsBillingPage } from '@/routes/settings.app.billing'
import { AppSettingsOperationsPage } from '@/routes/settings.app.operations'
import { DriverPlanningPage } from '@/routes/driver-planning.index'
import { DriverPlanningLayout } from '@/features/driver-planning/DriverPlanningLayout'

// Lazy-loaded sub-pages — the longhaul Redux/react-datepicker/react-select
// bundle only loads when a user navigates to one of these.
const PlanningModuleLazy = lazy(() =>
  import('@/features/driver-planning/routes/PlanningModule').then((m) => ({
    default: m.PlanningModule,
  })),
)
const TripsModuleLazy = lazy(() =>
  import('@/features/driver-planning/routes/TripsModule').then((m) => ({
    default: m.TripsModule,
  })),
)
const ShipmentModuleLazy = lazy(() =>
  import('@/features/driver-planning/routes/ShipmentModule').then((m) => ({
    default: m.ShipmentModule,
  })),
)
const TripDetailLazy = lazy(() =>
  import('@/features/driver-planning/containers/Trip').then((m) => ({ default: m.Trip })),
)

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const rootRoute = createRootRoute({ component: RootLayout })

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const loginCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/callback',
  component: LoginCallbackPage,
})

// ---------------------------------------------------------------------------
// Auth-guarded layout — all protected routes nest inside this
// ---------------------------------------------------------------------------
const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: '_auth',
  beforeLoad: authGuard,
  component: AuthLayout,
})

// ---------------------------------------------------------------------------
// Protected routes (children of authLayout)
// ---------------------------------------------------------------------------
const indexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/dashboard',
  component: DashboardPage,
})

const movesIndexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/moves',
  component: MovesPage,
})

const movesDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/moves/$moveId',
  component: MoveDetailPage,
})

const quotesIndexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/quotes',
  component: QuotesPage,
})

const quotesDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/quotes/$quoteId',
  component: QuoteDetailPage,
})

const customersIndexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/customers',
  component: CustomersPage,
})

const customersDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/customers/$customerId',
  component: CustomerDetailPage,
})

const dispatchRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/dispatch',
  component: DispatchPage,
})

const invoicesRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/invoices',
  component: InvoicesPage,
})

// ---------------------------------------------------------------------------
// Settings subtree — pathless layout that restricts every `/settings/*` route
// to tenant_admin. New settings pages should hang off `settingsLayout` so they
// inherit the role guard without each route having to remember `beforeLoad`.
// ---------------------------------------------------------------------------
const settingsLayout = createRoute({
  getParentRoute: () => authLayout,
  id: '_settings',
  beforeLoad: requireRole('tenant_admin'),
})

const ssoConfigRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/sso',
  component: SsoConfigPage,
})

const usersRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/users',
  component: UsersPage,
})

const developerSettingsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/developer',
  component: DeveloperSettingsPage,
})

const workflowsSettingsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/workflows',
  component: WorkflowsSettingsPage,
})

// ---------------------------------------------------------------------------
// /settings/app — tenant-wide UI preferences. One landing route hosting the
// shared left-rail layout, plus seven children (one per main-menu section).
// Each child is a thin route component reading/writing /api/v1/settings/app.
// New sections: add a route below + register on this layout's addChildren.
// ---------------------------------------------------------------------------
const appSettingsLayoutRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/app',
  component: AppSettingsLayout,
})

const appSettingsIndexRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: '/',
  component: AppSettingsIndexPage,
})

const appSettingsDashboardRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'dashboard',
  component: AppSettingsDashboardPage,
})

const appSettingsMovesRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'moves',
  component: AppSettingsMovesPage,
})

const appSettingsQuotesRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'quotes',
  component: AppSettingsQuotesPage,
})

const appSettingsCustomersRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'customers',
  component: AppSettingsCustomersPage,
})

const appSettingsDispatchRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'dispatch',
  component: AppSettingsDispatchPage,
})

const appSettingsBillingRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'billing',
  component: AppSettingsBillingPage,
})

const appSettingsOperationsRoute = createRoute({
  getParentRoute: () => appSettingsLayoutRoute,
  path: 'operations',
  component: AppSettingsOperationsPage,
})

const driverPlanningRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/driver-planning',
  component: DriverPlanningLayout,
})

const dpAvailabilityRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: '/',
  component: DriverPlanningPage,
})

const dpPlanningRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'planning',
  component: PlanningModuleLazy,
})

const dpTripsIndexRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'trips',
  component: TripsModuleLazy,
})

const dpTripDetailRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'trips/$tripId',
  component: TripDetailLazy,
})

const dpShipmentsRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'shipments',
  component: ShipmentModuleLazy,
})

// ---------------------------------------------------------------------------
// Route tree + router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  landingRoute,
  loginRoute,
  loginCallbackRoute,
  authLayout.addChildren([
    indexRoute,
    movesIndexRoute,
    movesDetailRoute,
    quotesIndexRoute,
    quotesDetailRoute,
    customersIndexRoute,
    customersDetailRoute,
    dispatchRoute,
    invoicesRoute,
    driverPlanningRoute.addChildren([
      dpAvailabilityRoute,
      dpPlanningRoute,
      dpTripsIndexRoute,
      dpTripDetailRoute,
      dpShipmentsRoute,
    ]),
    settingsLayout.addChildren([
      ssoConfigRoute,
      usersRoute,
      developerSettingsRoute,
      workflowsSettingsRoute,
      appSettingsLayoutRoute.addChildren([
        appSettingsIndexRoute,
        appSettingsDashboardRoute,
        appSettingsMovesRoute,
        appSettingsQuotesRoute,
        appSettingsCustomersRoute,
        appSettingsDispatchRoute,
        appSettingsBillingRoute,
        appSettingsOperationsRoute,
      ]),
    ]),
  ]),
])

export const router = createRouter({ routeTree })

/**
 * Register the router type globally so TanStack Router can provide full type
 * safety for `<Link to="...">`, `useNavigate`, `useParams`, etc.
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
