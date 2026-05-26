import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { swaggerUI } from '@hono/swagger-ui'
import type { AppEnv } from './types'
import { correlationMiddleware } from './middleware/correlation'
import { tenantMiddleware } from './middleware/tenant'
import { skipAuthMiddleware } from './middleware/skip-auth'
import { adminRouter } from './handlers/admin'
import { authHandler } from './handlers/auth'
import { ssoHandler } from './handlers/sso'
import { usersHandler } from './handlers/users'
import { customersHandler } from './handlers/customers'
import { quotesHandler } from './handlers/quotes'
import { movesHandler } from './handlers/moves'
import { inventoryHandler } from './handlers/inventory'
import { billingHandler } from './handlers/billing'
import { apiClientsHandler } from './handlers/api-clients'
import { settingsHandler } from './handlers/settings'
import { documentsHandler } from './handlers/documents'
import { workflowsHandler } from './handlers/workflows'
import { eventsHandler } from './handlers/events'
import { ordersHandler } from './handlers/orders'
import { vpnAgentHandler } from './handlers/vpn-agent'
import { onpremHandler } from './handlers/onprem'
import { longhaulVersionHandler } from './handlers/longhaul-cloud/version'
import { longhaulStatesHandler } from './handlers/longhaul-cloud/states'
import { longhaulDriversHandler } from './handlers/longhaul-cloud/drivers'
import { longhaulZonesHandler } from './handlers/longhaul-cloud/zones'
import { longhaulPlannersHandler } from './handlers/longhaul-cloud/planners'
import { longhaulActivityTypesHandler } from './handlers/longhaul-cloud/activity-types'
import { longhaulFilterOptionsHandler } from './handlers/longhaul-cloud/filter-options'
import { longhaulDispatchersHandler } from './handlers/longhaul-cloud/dispatchers'
import { longhaulShipmentsListHandler } from './handlers/longhaul-cloud/shipments-list'
import { longhaulUsersMeHandler } from './handlers/longhaul-cloud/users-me'
import { longhaulShipmentFiltersDefaultHandler } from './handlers/longhaul-cloud/shipment-filters-default'
import { longhaulShipmentFiltersHandler } from './handlers/longhaul-cloud/shipment-filters'
import { longhaulTripsListHandler } from './handlers/longhaul-cloud/trips-list'
import { longhaulDriverPlanningHandler } from './handlers/longhaul-cloud/driver-planning'
import { longhaulTripDetailHandler } from './handlers/longhaul-cloud/trip-detail'
import { longhaulDriverPlanningPatchHandler } from './handlers/longhaul-cloud/driver-planning-patch'
import {
  longhaulShipmentShadowHandler,
  longhaulShipmentCoverageHandler,
} from './handlers/longhaul-cloud/shipments-write'
import { meHandler } from './handlers/me'
import { logger } from './lib/logger'
import { getOpenApiSpec } from './lib/openapi-spec'
import { DomainError } from '@pegasus/domain'
import { db as basePrisma } from './db'

const app = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// Global middleware (applies to all routes including /health)
// ---------------------------------------------------------------------------
// Correlation ID must be first so every subsequent log line and error response
// carries the request-scoped trace identifier.
app.use('*', correlationMiddleware)
app.use('*', cors())

// ---------------------------------------------------------------------------
// Global error handler
//
// Catches any unhandled exception thrown from a route handler or middleware.
// Logs the full error server-side (including stack) and returns a sanitised
// JSON payload — never leaking internal stack traces to the client.
// ---------------------------------------------------------------------------
app.onError((err, c) => {
  const correlationId = c.get('correlationId') ?? 'unknown'

  if (err instanceof DomainError) {
    logger.warn('Domain rule violation', { code: err.code, message: err.message })
    return c.json({ error: err.message, code: err.code, correlationId }, 422)
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    correlationId,
  })
  return c.json(
    { error: 'An unexpected error occurred', code: 'INTERNAL_ERROR', correlationId },
    500,
  )
})

app.get('/openapi.json', (c) => c.json(getOpenApiSpec()))
app.get('/docs', swaggerUI({ url: '/openapi.json' }))

// ---------------------------------------------------------------------------
// Public routes — no tenant required
// ---------------------------------------------------------------------------
app.get('/health', async (c) => {
  const deep = c.req.query('deep') === 'true'
  if (deep) {
    try {
      await basePrisma.$queryRaw`SELECT 1`
      return c.json({
        status: 'ok' as const,
        db: 'ok' as const,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      logger.error('Deep health check failed', { error: message })
      return c.json(
        { status: 'degraded' as const, db: 'error' as const, timestamp: new Date().toISOString() },
        503,
      )
    }
  }
  return c.json({ status: 'ok' as const, timestamp: new Date().toISOString() })
})

// ---------------------------------------------------------------------------
// SSO auth API — public endpoints supporting the tenant login flow.
//
// These routes are intentionally unauthenticated: they are called before any
// session exists. They expose only non-sensitive information (tenant name,
// provider display names) and validate Cognito tokens server-side.
// Must be mounted BEFORE the tenant-protected /api/v1 block.
// ---------------------------------------------------------------------------
app.route('/api/auth', authHandler)

// ---------------------------------------------------------------------------
// Platform admin API — all routes under /api/admin require a valid
// PLATFORM_ADMIN Cognito JWT. Auth is enforced inside the adminRouter itself
// so there is no risk of a misconfigured mount bypassing the middleware.
// Must be mounted BEFORE the tenant-protected /api/v1 block.
// ---------------------------------------------------------------------------
app.route('/api/admin', adminRouter)

// ---------------------------------------------------------------------------
// Hub agent API — /api/vpn/**
//
// M2M endpoints for the WireGuard hub's reconcile agent. The router applies
// apiClientAuthMiddleware + requireScope('vpn:sync') internally, so routes
// under /api/vpn are reachable only with a valid vpn:sync-scoped ApiClient.
// ---------------------------------------------------------------------------
app.route('/api/vpn', vpnAgentHandler)

// ---------------------------------------------------------------------------
// Pre-tenant-middleware /api/v1 routes — mounted BEFORE the Cognito v1 block
// so that requests NOT carrying a Cognito ID token reach their handler without
// first hitting tenantMiddleware (which would reject them as unauthorized).
// Each handler applies its own auth middleware internally (not as a wildcard
// on this router) so that non-matching paths fall through cleanly to the
// Cognito v1 block below.
//
// M2M-only routes — authenticated API clients (vnd_ keys). URL mapping from
// the legacy standalone AWS Lambda API (apps/services/api):
//   POST   /api/v1/events              ← POST /EventEndpointHandler
//   GET    /api/v1/events/:eventType   ← GET  /events/{eventType}
//   DELETE /api/v1/events/:eventId     ← DELETE /events/{eventId}
//   GET    /api/v1/orders              ← GET  /orders
//   POST   /api/v1/orders              ← POST /orders/create[/{customer_app_id}]
//   GET    /api/v1/orders/:orderId     ← (new — single order lookup)
//
// Dual-auth routes — reached by BOTH Cognito sessions and vnd_ keys:
//   /api/v1/workflows  — tenant SPA reads + Python SDK CLI uploads. The handler
//                        applies dualAuthMiddleware, which dispatches a vnd_
//                        token to m2mAppAuthMiddleware and everything else to
//                        tenantMiddleware (see middleware/dual-auth.ts).
// ---------------------------------------------------------------------------
const m2mV1 = new Hono<AppEnv>()
m2mV1.route('/events', eventsHandler)
m2mV1.route('/orders', ordersHandler)
m2mV1.route('/workflows', workflowsHandler)

app.route('/api/v1', m2mV1)

// ---------------------------------------------------------------------------
// Tenant-protected API — all routes under /api/v1 require a resolved tenant.
//
// The tenant middleware extracts the subdomain from the Host header (or the
// X-Tenant-Slug header for local development) and populates:
//   - c.get('tenantId')  — the tenant's UUID
//   - c.get('db')        — a Prisma client whose queries are automatically
//                          scoped to that tenant via a query extension
//
// Example usage in a handler (no tenantId needed in Prisma calls):
//
//   app.get('/api/v1/customers', async (c) => {
//     const db = c.get('db')
//     // db.customer.findMany() automatically adds WHERE tenantId = <current>
//     const customers = await db.customer.findMany()
//     return c.json({ data: customers })
//   })
// ---------------------------------------------------------------------------
const v1 = new Hono<AppEnv>()

if (process.env['SKIP_AUTH'] === 'true') {
  logger.warn('SKIP_AUTH is enabled — all authentication is bypassed. Do NOT use in production.')
  // Force the offline (wasm) authz backend so synthesised principals never
  // attempt to call AVP without an ID token. Setting the env var here keeps
  // the per-request path branch-free.
  process.env['AUTHZ_OFFLINE'] = 'true'
  // skipAuthMiddleware is shared with dualAuthMiddleware so the bypass behaves
  // identically on the pre-tenant-middleware routes mounted above.
  v1.use('*', skipAuthMiddleware)
} else {
  v1.use('*', tenantMiddleware)
}

// Bounded-context routers
v1.route('/me', meHandler)
v1.route('/sso', ssoHandler)
v1.route('/users', usersHandler)
v1.route('/customers', customersHandler)
v1.route('/quotes', quotesHandler)
v1.route('/moves', movesHandler)
// Inventory routes are nested under /moves (e.g. /moves/:moveId/rooms)
v1.route('/moves', inventoryHandler)
v1.route('/invoices', billingHandler)
v1.route('/api-clients', apiClientsHandler)
v1.route('/settings', settingsHandler)
v1.route('/documents', documentsHandler)
// Note: /workflows is mounted on the m2mV1 router above (dual-auth: Cognito
// sessions + vnd_ vendor keys) — it must be matched before tenantMiddleware.
// Longhaul strangler-fig migration (Phase 1): /version is served cloud-direct
// via the in-VPC mssql-executor Lambda. Registered before the /onprem mount so
// this specific route wins over the /onprem/longhaul/* wildcard proxy; every
// un-migrated longhaul endpoint still falls through to the on-prem server.
v1.get('/onprem/longhaul/version', longhaulVersionHandler)
// Phase 3: /states is served cloud-direct alongside /version.
v1.get('/onprem/longhaul/states', longhaulStatesHandler)
// Longhaul strangler-fig migration (Phase 3): /drivers is served cloud-direct,
// querying the Dolios `v_longhaul_drivers` view through the mssql-executor
// Lambda. Registered before the /onprem mount for the same route-precedence
// reason as /version above.
v1.get('/onprem/longhaul/drivers', longhaulDriversHandler)
// Phase 3: /zones is served cloud-direct, same pattern as /version above.
v1.get('/onprem/longhaul/zones', longhaulZonesHandler)
// Phase 3: /planners is served cloud-direct via the same in-VPC mssql-executor
// path — likewise registered before the /onprem mount so it wins over the
// wildcard proxy.
v1.get('/onprem/longhaul/planners', longhaulPlannersHandler)
// Phase 3: /activity-types is served cloud-direct alongside /version.
v1.get('/onprem/longhaul/activity-types', longhaulActivityTypesHandler)
// Phase 3: /filter-options and /dispatchers are served cloud-direct. Their
// per-client query config (MoveType filter, dispatcher SQL) is resolved from
// the tenant's longhaulClient column — see lib/longhaul-client-config.ts.
v1.get('/onprem/longhaul/filter-options', longhaulFilterOptionsHandler)
v1.get('/onprem/longhaul/dispatchers', longhaulDispatchersHandler)
// Phase 3: /users/me is served cloud-direct — the cloud Hono Lambda resolves
// the caller's legacy identity (TenantUser.legacyWindowsUsername →
// v_longhaul_salesman) via the mssql-executor Lambda. Same `{ data }` shape.
v1.get('/onprem/longhaul/users/me', longhaulUsersMeHandler)
// Longhaul strangler-fig migration (Phase 3): the current user's default
// shipment filter is served cloud-direct. Registered before the /onprem mount
// for the same route-precedence reason as /version above.
v1.get('/onprem/longhaul/shipment-filters/default', longhaulShipmentFiltersDefaultHandler)
// Phase 3: /shipment-filters is served cloud-direct — same strangler-fig
// pattern as /version, but user-scoped (resolves the caller's legacy longhaul
// identity and filters saved filters by that user's owner code).
v1.get('/onprem/longhaul/shipment-filters', longhaulShipmentFiltersHandler)
// Phase 3.1: GET /trips (LIST) is served cloud-direct. The on-prem repo made
// two MSSQL round trips (trips list + a separate TripNotes fetch); this
// handler collapses the notes fetch into the main query via FOR JSON PATH, so
// it makes just one. Originally landed in #126, reverted in #137 because the
// handler read filters from a flat shape but the UI URL-encodes the WHOLE
// TripQuery into `?filters=` (so `filters.id` lived at `parsed.filters.id`).
// Fixed: the handler now JSON.parses the param into a TripQuery and reads
// `query.filters` / `query.sortBy` — matching the on-prem handler.
v1.get('/onprem/longhaul/trips', longhaulTripsListHandler)
// Phase 3: /driver-planning is served cloud-direct — one OUTER APPLY query
// collapses the on-prem repo's ~5 MSSQL round trips into 1-2.
v1.get('/onprem/longhaul/driver-planning', longhaulDriverPlanningHandler)
// Phase 3.1: GET /trips/:id served cloud-direct — collapses the on-prem
// handler's ~8-query trip+shipment fan-out into batched mssql-executor round
// trips. Root cause of the prior 500s (a79f14e, e2e-qa-longhaul run
// 26370258587): the handler batched the OPTIONAL `pegasus_extra_location`
// lookup into the mandatory shipment statement batch, so on tenants whose DB
// lacks that table ("Invalid object name 'pegasus_extra_location'") the whole
// batch aborted → 500 on every trip. Fixed: extra-locations now runs as a
// separate soft-failing query (→ []), mirroring the on-prem repo and the cloud
// shipments-list handler. See handlers/longhaul-cloud/trip-detail.ts.
v1.get('/onprem/longhaul/trips/:id', longhaulTripDetailHandler)
// Phase 3: GET /shipments LIST is served cloud-direct. Its Is_Trip_Planning
// filter uses per-client import/export codes resolved from the tenant's
// longhaulClient column. Write routes (POST/PATCH /shipments/*) still proxy.
v1.get('/onprem/longhaul/shipments', longhaulShipmentsListHandler)
// Phase 4 (write migration, Unit 1): single-row writes served cloud-direct via
// the mssql-executor Lambda instead of the on-prem proxy. Each is registered
// before the /onprem mount so it wins over the wildcard; un-migrated write
// routes (notes, activities, trip status/save) still fall through to the proxy.
// resolveLonghaulUser enforces the same 401/403/422 auth parity as the proxy's
// longhaul-user middleware. See handlers/longhaul-cloud/{driver-planning-patch,
// shipments-write}.ts.
// (PATCH /shipments/:id/weight is intentionally left on the proxy — dead route
// against an incompatible schema; see handlers/longhaul-cloud/shipments-write.ts.)
v1.patch('/onprem/longhaul/driver-planning/:driverId', longhaulDriverPlanningPatchHandler)
v1.patch('/onprem/longhaul/shipments/:id/shadow', longhaulShipmentShadowHandler)
v1.post('/onprem/longhaul/shipments/:id/coverage', longhaulShipmentCoverageHandler)
// On-prem proxy — round-trips through the WireGuard tunnel to the tenant's
// on-prem API server. Routes are tenant-scoped; URL is derived from the
// tenant's VpnPeer overlay IP. See handlers/onprem.ts.
v1.route('/onprem', onpremHandler)

app.route('/api/v1', v1)

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

export { app }
