import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from './types'
import { correlationMiddleware } from './middleware/correlation'
import { tenantMiddleware } from './middleware/tenant'
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
import { eventsHandler } from './handlers/events'
import { ordersHandler } from './handlers/orders'
import { vpnAgentHandler } from './handlers/vpn-agent'
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
// M2M API — routes accessible only by authenticated API clients (vnd_ keys).
//
// These are mounted BEFORE the Cognito v1 block so that requests carrying a
// vendor API key reach their handler without first hitting tenantMiddleware.
// Each handler applies m2mAppAuthMiddleware internally (not as a wildcard on
// this router) so that non-matching paths fall through cleanly to the Cognito
// v1 block below.
//
// URL mapping from the legacy standalone AWS Lambda API (apps/services/api):
//   POST   /api/v1/events              ← POST /EventEndpointHandler
//   GET    /api/v1/events/:eventType   ← GET  /events/{eventType}
//   DELETE /api/v1/events/:eventId     ← DELETE /events/{eventId}
//   GET    /api/v1/orders              ← GET  /orders
//   POST   /api/v1/orders              ← POST /orders/create[/{customer_app_id}]
//   GET    /api/v1/orders/:orderId     ← (new — single order lookup)
// ---------------------------------------------------------------------------
const m2mV1 = new Hono<AppEnv>()
m2mV1.route('/events', eventsHandler)
m2mV1.route('/orders', ordersHandler)

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
  v1.use('*', async (c, next) => {
    c.set('tenantId', process.env['DEFAULT_TENANT_ID'] ?? 'default-tenant')
    c.set('role', 'tenant_admin')
    c.set('userId', 'skip-auth-user')
    c.set('db', basePrisma as unknown as PrismaClient)
    await next()
  })
} else {
  v1.use('*', tenantMiddleware)
}

// Bounded-context routers
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

app.route('/api/v1', v1)

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

export { app }
