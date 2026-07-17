import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'

import { RootLayout } from '@/routes/__root'
import { LoginPage } from '@/routes/login'
import { AuthCallbackPage } from '@/routes/auth/callback'
import { authGuard, AuthLayout } from '@/routes/_auth'
import { TenantsPage } from '@/routes/_auth/tenants/index'
import { TenantDetailPage } from '@/routes/_auth/tenants/$id'
import { WorkflowsPage } from '@/routes/_auth/workflows/index'
import { TariffsPage } from '@/routes/_auth/tariffs/index'
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
      throw redirect({ to: '/tenants' })
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
