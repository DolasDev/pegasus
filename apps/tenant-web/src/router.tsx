import { lazy } from 'react'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LandingPage } from '@/routes/landing'
import { LoginPage } from '@/routes/login'
import { LoginCallbackPage } from '@/routes/login.callback'
import { LoginSignedOutPage } from '@/routes/login.signed-out'
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
import { IntegrationsIndexPage } from '@/routes/integrations.index'
import { IntegrationDetailPage } from '@/routes/integrations.$integrationId'
import { SsoConfigPage } from '@/routes/sso-config'
import { UsersPage } from '@/routes/users'
import { DeveloperSettingsPage } from '@/routes/settings.developer'
import { ConfigsSettingsPage } from '@/routes/settings.developer.configs'
import { DeveloperIntegrationsPage } from '@/routes/settings.developer.integrations'
import { WorkflowsSettingsPage } from '@/routes/settings.workflows'
import { WorkflowDetailPage } from '@/routes/settings.workflows.$workflowId'
import { EventTypesSettingsPage } from '@/routes/settings.event-types'
import { FeedbackFormsSettingsPage } from '@/routes/settings.feedback-forms'
import { PublicFeedbackPage } from '@/routes/f.$token'
import { RingCentralIntegrationPage } from '@/routes/settings.integrations.ringcentral'
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

// Landing point for Cognito's /logout during the wrong-account recovery chain.
// Registered as a sign-out URL on the tenant app client (packages/infra).
const loginSignedOutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login/signed-out',
  component: LoginSignedOutPage,
})

// Public feedback form — a customer/driver opens a capability link (`/f/<token>`).
// No auth: it hangs off the root route (not authLayout), and the API resolves the
// tenant from the token in the path. See handlers/feedback-public.ts.
const publicFeedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/f/$token',
  component: PublicFeedbackPage,
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

// Integrations — read-only mapping/ruleset visualization. Hangs off authLayout
// (NOT settingsLayout, so it's not admin-only) but guarded to the roles that
// hold ReadIntegrationConfig (viewer baseline + integration_publisher; admin via
// permit-all), mirroring 20-viewer.cedar. Non-granted users redirect to the
// dashboard instead of loading a page that 403s on its first fetch.
const INTEGRATION_VIEW_ROLES = ['tenant_admin', 'integration_publisher', 'viewer'] as const

const integrationsIndexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/integrations',
  beforeLoad: requireRole(...INTEGRATION_VIEW_ROLES),
  component: IntegrationsIndexPage,
})

const integrationDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/integrations/$integrationId',
  beforeLoad: requireRole(...INTEGRATION_VIEW_ROLES),
  component: IntegrationDetailPage,
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

const developerConfigsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/developer/configs',
  component: ConfigsSettingsPage,
})

const developerIntegrationsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/developer/integrations',
  component: DeveloperIntegrationsPage,
})

const workflowsSettingsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/workflows',
  component: WorkflowsSettingsPage,
})

const workflowDetailRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/workflows/$workflowId',
  component: WorkflowDetailPage,
  // Optional `?tab=executions` deep-links straight to the Executions tab (e.g.
  // the "View executions" link on the workflows list). Anything else is dropped.
  validateSearch: (search: Record<string, unknown>): { tab?: 'executions' } =>
    search.tab === 'executions' ? { tab: 'executions' } : {},
})

const eventTypesSettingsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/event-types',
  component: EventTypesSettingsPage,
})

const feedbackFormsSettingsRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/feedback-forms',
  component: FeedbackFormsSettingsPage,
})

const ringCentralRoute = createRoute({
  getParentRoute: () => settingsLayout,
  path: '/settings/integrations/ringcentral',
  component: RingCentralIntegrationPage,
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

// Planning and Trips are restricted to the operations-manager persona
// (operations_admin) plus tenant_admin. The broader dispatch roles that can see
// the Operations section still reach Availability/Shipments, but not these two
// screens — the sibling nav entries in AppShell carry the matching per-child
// role filter, and server-side Cedar remains the source of truth.
const OPERATIONS_MANAGER_ROLES = ['tenant_admin', 'operations_admin'] as const

const dpAvailabilityRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: '/',
  component: DriverPlanningPage,
})

const dpPlanningRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'planning',
  beforeLoad: requireRole(...OPERATIONS_MANAGER_ROLES),
  component: PlanningModuleLazy,
})

const dpTripsIndexRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'trips',
  beforeLoad: requireRole(...OPERATIONS_MANAGER_ROLES),
  component: TripsModuleLazy,
})

const dpTripDetailRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'trips/$tripId',
  beforeLoad: requireRole(...OPERATIONS_MANAGER_ROLES),
  component: TripDetailLazy,
})

// Read-only view of a rejected-trip snapshot. The static `rejected` segment
// wins over `trips/$tripId` (TanStack prefers literal over param segments), so
// `$rejectedId` never collides with a live trip id. Reuses the Trip component,
// which switches to read-only mode when the `rejectedId` param is present.
const dpRejectedTripRoute = createRoute({
  getParentRoute: () => driverPlanningRoute,
  path: 'trips/rejected/$rejectedId',
  beforeLoad: requireRole(...OPERATIONS_MANAGER_ROLES),
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
  loginSignedOutRoute,
  publicFeedbackRoute,
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
    integrationsIndexRoute,
    integrationDetailRoute,
    driverPlanningRoute.addChildren([
      dpAvailabilityRoute,
      dpPlanningRoute,
      dpTripsIndexRoute,
      dpRejectedTripRoute,
      dpTripDetailRoute,
      dpShipmentsRoute,
    ]),
    settingsLayout.addChildren([
      ssoConfigRoute,
      usersRoute,
      developerSettingsRoute,
      developerConfigsRoute,
      developerIntegrationsRoute,
      workflowsSettingsRoute,
      workflowDetailRoute,
      eventTypesSettingsRoute,
      feedbackFormsSettingsRoute,
      ringCentralRoute,
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
