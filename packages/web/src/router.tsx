import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LandingPage } from '@/routes/landing'
import { LoginPage } from '@/routes/login'
import { LoginCallbackPage } from '@/routes/login.callback'
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

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const rootRoute = createRootRoute({ component: RootLayout })

// ---------------------------------------------------------------------------
// Top-level routes
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

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardPage,
})

const movesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/moves',
  component: MovesPage,
})

const movesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/moves/$moveId',
  component: MoveDetailPage,
})

const quotesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quotes',
  component: QuotesPage,
})

const quotesDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quotes/$quoteId',
  component: QuoteDetailPage,
})

const customersIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  component: CustomersPage,
})

const customersDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$customerId',
  component: CustomerDetailPage,
})

const dispatchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dispatch',
  component: DispatchPage,
})

const invoicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices',
  component: InvoicesPage,
})

const ssoConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/sso',
  component: SsoConfigPage,
})

// ---------------------------------------------------------------------------
// Route tree + router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  landingRoute,
  loginRoute,
  loginCallbackRoute,
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
