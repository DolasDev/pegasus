import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LoginPage } from '@/routes/login'
import { AuthCallbackPage } from '@/routes/auth/callback'
import { authGuard, AuthLayout } from '@/routes/_auth'
import { TenantsPage } from '@/routes/_auth/tenants/index'
import { TenantDetailPage } from '@/routes/_auth/tenants/$id'
import { WorkflowsPage } from '@/routes/_auth/workflows/index'
import { TariffsPage } from '@/routes/_auth/tariffs/index'
import { SupportInboxPage } from '@/routes/_auth/support/index'
import { SupportThreadPage } from '@/routes/_auth/support/$id'
import { takeReturnTo } from '@/auth/return-to'
import { getAccessToken } from '@/auth/cognito'

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const rootRoute = createRootRoute({ component: RootLayout })

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // If already authenticated, skip the login page.
  beforeLoad: () => {
    if (getAccessToken()) {
      throw redirect({ href: takeReturnTo() })
    }
  },
  component: LoginPage,
})

const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
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
// Protected routes
// ---------------------------------------------------------------------------
const indexRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/tenants' })
  },
  component: () => null,
})

const tenantsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/tenants',
  component: TenantsPage,
})

const tenantDetailRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/tenants/$id',
  component: TenantDetailPage,
})

const workflowsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/workflows',
  component: WorkflowsPage,
})

const tariffsRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/tariffs',
  component: TariffsPage,
})

// Support inbox. The path must match supportThreadAdminUrl() in
// apps/api/src/lib/support-alert.ts: the alert email links to /support/<id>.
const supportRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/support',
  component: SupportInboxPage,
})

const supportThreadRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/support/$id',
  component: SupportThreadPage,
})

// ---------------------------------------------------------------------------
// Route tree + router
// ---------------------------------------------------------------------------
const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  authLayout.addChildren([
    indexRoute,
    tenantsRoute,
    tenantDetailRoute,
    workflowsRoute,
    tariffsRoute,
    supportRoute,
    supportThreadRoute,
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
