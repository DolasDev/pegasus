import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LandingPage } from '@/routes/landing'
import { LoginPage } from '@/routes/login'
import { LoginCallbackPage } from '@/routes/login.callback'
import { AuthLayout } from '@/routes/_auth'
import { authGuard } from '@/auth/guard'
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

const ssoConfigRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/sso',
  component: SsoConfigPage,
})

const usersRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/users',
  component: UsersPage,
})

const developerSettingsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/settings/developer',
  component: DeveloperSettingsPage,
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
    ssoConfigRoute,
    usersRoute,
    developerSettingsRoute,
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
