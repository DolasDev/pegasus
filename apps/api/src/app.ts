import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { swaggerUI } from '@hono/swagger-ui'
import type { AppEnv } from './types'
import { correlationMiddleware } from './middleware/correlation'
import { requestTimingMiddleware } from './middleware/request-timing'
import { tenantMiddleware } from './middleware/tenant'
import { skipAuthMiddleware } from './middleware/skip-auth'
import { adminRouter } from './handlers/admin'
import { authHandler } from './handlers/auth'
import { ssoHandler } from './handlers/sso'
import { usersHandler } from './handlers/users'
import { customersHandler } from './handlers/customers'
import { quotesHandler } from './handlers/quotes'
import { ratingHandler } from './handlers/rating'
import { movesHandler } from './handlers/moves'
import { crewHandler } from './handlers/crew'
import { inventoryHandler } from './handlers/inventory'
import { billingHandler } from './handlers/billing'
import { apiClientsHandler } from './handlers/api-clients'
import { settingsHandler } from './handlers/settings'
import { settingsPegiiHandler } from './handlers/settings-pegii'
import { documentsHandler } from './handlers/documents'
import { workflowsHandler } from './handlers/workflows'
import { workflowInternalHandler } from './handlers/workflow-internal'
import { eventsHandler } from './handlers/events'
import { eventTypesHandler } from './handlers/event-types'
import { ordersHandler } from './handlers/orders'
import { pegiiRuntimeHandler } from './handlers/pegii-runtime'
import { runtimeReadsHandler } from './handlers/runtime-reads'
import { vpnAgentHandler } from './handlers/vpn-agent'
import { dashboardPegiiHandler } from './handlers/dashboard-pegii'
import { longhaulVersionHandler } from './handlers/longhaul-cloud/version'
import { longhaulStatesHandler } from './handlers/longhaul-cloud/states'
import { longhaulDriversHandler } from './handlers/longhaul-cloud/drivers'
import { longhaulZonesHandler } from './handlers/longhaul-cloud/zones'
import { longhaulTripStatusesHandler } from './handlers/longhaul-cloud/trip-statuses'
import { longhaulPlannersHandler } from './handlers/longhaul-cloud/planners'
import { longhaulActivityTypesHandler } from './handlers/longhaul-cloud/activity-types'
import { longhaulFilterOptionsHandler } from './handlers/longhaul-cloud/filter-options'
import { longhaulDispatchersHandler } from './handlers/longhaul-cloud/dispatchers'
import { longhaulReferenceDataHandler } from './handlers/longhaul-cloud/reference-data'
import { longhaulShipmentsListHandler } from './handlers/longhaul-cloud/shipments-list'
import { longhaulUsersMeHandler } from './handlers/longhaul-cloud/users-me'
import { longhaulShipmentFiltersDefaultHandler } from './handlers/longhaul-cloud/shipment-filters-default'
import { longhaulShipmentFiltersHandler } from './handlers/longhaul-cloud/shipment-filters'
import { longhaulTripsListHandler } from './handlers/longhaul-cloud/trips-list'
import { longhaulDriverPlanningHandler } from './handlers/longhaul-cloud/driver-planning'
import { longhaulTripDetailHandler } from './handlers/longhaul-cloud/trip-detail'
import {
  createRejectedTripHandler,
  listRejectedTripsHandler,
  getRejectedTripHandler,
} from './handlers/longhaul-cloud/rejected-trips'
import { longhaulDriverPlanningPatchHandler } from './handlers/longhaul-cloud/driver-planning-patch'
import {
  longhaulShipmentShadowHandler,
  longhaulShipmentCoverageHandler,
} from './handlers/longhaul-cloud/shipments-write'
import {
  longhaulCreateTripNoteHandler,
  longhaulPatchTripNoteHandler,
} from './handlers/longhaul-cloud/trip-notes'
import { longhaulSaveActivityHandler } from './handlers/longhaul-cloud/activities-write'
import {
  longhaulTripStatusHandler,
  longhaulTripCancelHandler,
  longhaulTripSummaryHandler,
} from './handlers/longhaul-cloud/trips-write'
import {
  longhaulSaveShipmentFilterHandler,
  longhaulSetDefaultShipmentFilterHandler,
  longhaulDeleteShipmentFilterHandler,
} from './handlers/longhaul-cloud/shipment-filters-write'
import {
  longhaulCreateTripHandler,
  longhaulUpdateTripHandler,
} from './handlers/longhaul-cloud/trip-save'
import { integrationValidationHandler } from './handlers/integration-validation/validate'
import { integrationConfigHandler } from './handlers/integration-validation/config'
import { integrationDeliveryHandler } from './handlers/integration-delivery'
import { integrationCallHandler } from './handlers/integration-call'
import { blobsHandler } from './handlers/blobs'
import { meHandler } from './handlers/me'
import { deviceTokensHandler } from './handlers/device-tokens'
import { notificationsHandler } from './handlers/notifications'
import { smsHandler } from './handlers/sms'
import { workflowSecretsConfigsHandler } from './handlers/workflow-secrets-configs'
import {
  integrationProjectionsHandler,
  integrationProjectionReadHandler,
} from './handlers/integration-projections'
import { ringcentralOauthHandler } from './handlers/integrations/ringcentral-oauth'
import { ringcentralWebhookHandler } from './handlers/integrations/ringcentral-webhook'
import { ingressHandler, ingressManagementHandler } from './handlers/ingress'
import { feedbackFormsHandler } from './handlers/feedback-forms'
import { feedbackRequestsHandler } from './handlers/feedback-requests'
import { feedbackPublicHandler } from './handlers/feedback-public'
import { integrationsHandler } from './handlers/integrations/list'
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
// Per-request timing — registered right after correlation so its structured
// completion log inherits the correlationId/method/path keys, and early enough
// that durationMs spans the whole middleware + handler chain. Emits the one
// log line that makes a latency spike attributable to a specific downstream.
app.use('*', requestTimingMiddleware)
// CORS allowlist — driven by CORS_ALLOWED_ORIGINS (comma-separated, injected by
// the CDK ApiStack per environment). Empty/unset (local dev, E2E, on-prem) →
// reflect any origin, preserving the previous permissive behavior. In deployed
// environments API Gateway's corsPreflight is authoritative for OPTIONS; this
// Hono layer is defense in depth for the direct-served path.
const allowedOrigins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
app.use(
  '*',
  cors({
    origin: (origin) =>
      allowedOrigins.length === 0 || allowedOrigins.includes(origin) ? origin : '',
    allowHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'X-Tenant-Slug'],
    exposeHeaders: ['x-correlation-id'],
  }),
)

// ---------------------------------------------------------------------------
// Global error handler
//
// Catches any unhandled exception thrown from a route handler or middleware.
// Logs the full error server-side (including stack) and returns a sanitized
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
// RingCentral webhook — pre-tenant; the RingCentral delivery carries no Cognito
// session or tenant subdomain, so the tenant is resolved from the payload's
// subscriptionId. Mounted BEFORE the tenant-protected /api/v1 block.
// ---------------------------------------------------------------------------
app.route('/api/integrations/ringcentral', ringcentralWebhookHandler)

// ---------------------------------------------------------------------------
// Inbound integration ingress — pre-tenant (sdk-feedback 0021). A partner POSTs
// with a platform-issued bearer that resolves the tenant; no Cognito session.
// Mounted BEFORE the tenant-protected /api/v1 block. See handlers/ingress.ts.
// ---------------------------------------------------------------------------
app.route('/api/ingress/v1', ingressHandler)

// ---------------------------------------------------------------------------
// Public feedback endpoint — pre-tenant (feedback surveys). A respondent opens
// a capability link carrying only an opaque token in the path; the tenant is
// resolved FROM the token. No Cognito session. Mounted BEFORE the tenant-
// protected /api/v1 block. See handlers/feedback-public.ts.
// ---------------------------------------------------------------------------
app.route('/api/public/v1', feedbackPublicHandler)

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
// the legacy standalone AWS Lambda API, decommissioned in the Pegasus-Services
// migration (plans/done/pegasus-services-migration.md):
//   POST   /api/v1/events              ← POST /EventEndpointHandler
//   GET    /api/v1/events/:eventType   ← GET  /events/{eventType}
//   DELETE /api/v1/events/:eventId     ← DELETE /events/{eventId}
//   GET    /api/v1/orders              ← GET  /orders
//   POST   /api/v1/orders              ← POST /orders/create[/{customer_app_id}]
//   GET    /api/v1/orders/:orderId     ← (new — single order lookup)
//   GET    /api/v1/pegii/orders        ← workflow-runtime pegII order reads (ReadOrder)
//   GET    /api/v1/pegii/tasks         ← workflow-runtime pegII task reads (ReadTask)
//   POST   /api/v1/pegii/tasks/close   ← workflow-runtime pegII task close (CloseTask)
//
// Dual-auth routes — reached by BOTH Cognito sessions and vnd_ keys:
//   /api/v1/workflows  — tenant SPA reads + Python SDK CLI uploads. The handler
//                        applies dualAuthMiddleware, which dispatches a vnd_
//                        token to m2mAppAuthMiddleware and everything else to
//                        tenantMiddleware (see middleware/dual-auth.ts).
// ---------------------------------------------------------------------------
const m2mV1 = new Hono<AppEnv>()
// Worker-only internal endpoints — gated by the shared-secret header
// X-Workflow-Broker-Secret or a per-tenant X-Workflow-Broker-Token (see
// handlers/workflow-internal.ts, requireBrokerAuth). No tenant/dual-auth
// middleware involvement; tenant scope is derived from the WorkflowExecution
// row each call references.
//
// MUST be registered FIRST on m2mV1: several later handlers are mounted at
// root ('/') and apply `.use('*', dualAuthMiddleware)`, whose wildcard would
// otherwise run BEFORE this handler for `/internal/*` and reject the worker's
// broker-token request with a generic "Missing or malformed Authorization
// header" 401 (dualAuth/tenant), never reaching requireBrokerAuth. That
// exact shadowing shipped in #447 (a root '/' projection-read handler landed
// one line above this mount) and crash-looped every tenant runner for a week.
// Keeping /internal first makes the broker routes immune to catch-all order.
m2mV1.route('/internal', workflowInternalHandler)
m2mV1.route('/events', eventsHandler)
m2mV1.route('/event-types', eventTypesHandler)
m2mV1.route('/orders', ordersHandler)
// Workflow-runtime reads of legacy pegII operational records (orders + tasks):
// ReadOrder / ReadTask / CloseTask on the workflow_runtime `vnd_` key. A
// namespaced legacy-bridge surface like the retired `/onprem/longhaul/*`;
// dual-auth applied inside the handler; pegII bridge stubbed today — see
// handlers/pegii-runtime.ts. Distinct from the M2M `/orders` above.
m2mV1.route('/pegii', pegiiRuntimeHandler)
// Workflow-runtime reads of core operational entities (customers/quotes/moves/
// invoices) on the workflow_runtime `vnd_` key (ReadCustomer/ReadQuote/ReadMove/
// ReadInvoice — already granted). Read-only mirrors of the browser CRUD handlers,
// under a DISTINCT `/runtime` prefix so they don't shadow the Cognito `v1` routes.
m2mV1.route('/runtime', runtimeReadsHandler)
m2mV1.route('/workflows', workflowsHandler)
// Outbound SMS — called by the workflow runtime's `vnd_` key (SendSms), so it
// must accept API-key auth, not Cognito-JWT only. Dual-auth is applied inside
// smsHandler (see handlers/sms.ts). Was previously mis-mounted on the JWT-only
// `v1` router, which 401'd every workflow `send_sms`.
m2mV1.route('/sms', smsHandler)
// Per-tenant workflow secrets & config. Management routes use Cognito (tenant
// admin / workflow developer); the /runtime/* reads use the workflow runtime's
// `vnd_` key. Dual-auth is applied inside the handler — same pattern as
// /workflows and /event-types. See handlers/workflow-secrets-configs.ts.
m2mV1.route('/workflow-secrets-configs', workflowSecretsConfigsHandler)
// Per-record integration projections — the external-state cache that running
// workflows maintain via the `vnd_` runtime key and the integration validator
// reads back as `prior`. Runtime-only surface; dual-auth applied inside the
// handler. See handlers/integration-projections.ts.
m2mV1.route('/integration-projections', integrationProjectionsHandler)
// Read-model surface for the entities workflows land in projections
// (sdk-feedback/0026): GET /integrations/:id/projections/:entityType[/:key] with
// filter + paging, for the tenant web app / API keys. Dual-auth + RBAC
// (ReadIntegrationProjection, now granted to viewer). Mounted at root so it lives
// under /integrations. See handlers/integration-projections.ts.
m2mV1.route('/', integrationProjectionReadHandler)
// Declarative integration validation (POC) — synchronous, STATELESS order
// validation against a global declarative definition. Mounted on the pre-tenant
// m2m router because the caller (the legacy desktop / an M2M client) has no
// Cognito tenant session. Auth is API-key (any valid vnd_ key, any tenant),
// applied route-level inside the handler so other /integrations/* paths still
// fall through to the tenant routes below. See src/integration-validation/.
m2mV1.route('/', integrationValidationHandler)
// Integration-validator config authoring (publish/validate/versions/rollback).
// Uses dualAuthMiddleware internally (RBAC-gated) — distinct from the stateless
// validate route above. See src/handlers/integration-validation/config.ts.
m2mV1.route('/', integrationConfigHandler)
// Outbound delivery: a workflow POSTs a mapped body to a partner endpoint,
// performed server-side so it is dry-run-interceptable. Dual-auth + RBAC
// (DeliverToExternal). See src/handlers/integration-delivery.ts.
m2mV1.route('/', integrationDeliveryHandler)
// Outbound authenticated caller: a workflow names a method + path and the
// platform performs the call server-side, minting/caching an OAuth2
// client-credentials token for the integration. Dual-auth + RBAC (CallExternal).
// See src/handlers/integration-call.ts.
m2mV1.route('/', integrationCallHandler)
// Workflow blob storage: presigned S3 upload/download so a workflow can stage or
// land binary files (e.g. ADE documents) without proxying bytes through the
// Lambda. Dual-auth + RBAC (Read/WriteBlob). See handlers/blobs.ts.
m2mV1.route('/', blobsHandler)
// Ingress credential management: provision/rotate/inspect the bearer a partner
// POSTs to the pre-tenant ingress endpoint. Dual-auth + RBAC (ManageIngress).
// See handlers/ingress.ts.
m2mV1.route('/', ingressManagementHandler)
// Feedback surveys: author versioned forms (ManageFeedbackForms / ReadFeedbackForms)
// and mint capability links (CreateFeedbackRequest, granted to workflow_runtime).
// Dual-auth + RBAC applied inside each handler; feature-gated by FEEDBACK_ENABLED.
// The public respond endpoint is mounted pre-tenant above. See handlers/feedback-*.ts.
m2mV1.route('/feedback-forms', feedbackFormsHandler)
m2mV1.route('/feedback-requests', feedbackRequestsHandler)

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

// Fail-fast guard: SKIP_AUTH must never reach a production runtime. The Lambda
// always sets NODE_ENV=production (see packages/infra api-stack.ts), so a
// mis-set SKIP_AUTH env var fails closed at cold start instead of silently
// opening the entire API.
if (process.env['SKIP_AUTH'] === 'true' && process.env['NODE_ENV'] === 'production') {
  throw new Error('SKIP_AUTH=true is forbidden when NODE_ENV=production')
}

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
// Push notifications: device-tokens is self-service (driver registers their own
// device, no permission gate); notifications/send is staff-gated (SendNotification).
v1.route('/device-tokens', deviceTokensHandler)
v1.route('/notifications', notificationsHandler)
// /sms moved to the m2mV1 (dual-auth) router above — see note there.
v1.route('/sso', ssoHandler)
v1.route('/users', usersHandler)
v1.route('/customers', customersHandler)
v1.route('/quotes', quotesHandler)
v1.route('/rating', ratingHandler)
v1.route('/moves', movesHandler)
// Inventory routes are nested under /moves (e.g. /moves/:moveId/rooms)
v1.route('/moves', inventoryHandler)
v1.route('/crew', crewHandler)
v1.route('/invoices', billingHandler)
v1.route('/api-clients', apiClientsHandler)
v1.route('/settings', settingsHandler)
// pegII on-prem domain API config (customerSource flag, base URL, credential).
// Shares the /settings prefix; routes resolve across both routers.
v1.route('/settings', settingsPegiiHandler)
// RingCentral connections (tenant-authenticated, admin). Bring-your-own JWT:
// the tenant pastes their RingCentral app's client id/secret + JWT credential,
// which connect validates with a live jwt-bearer exchange. No platform OAuth app
// and no consent redirect. The webhook is mounted pre-tenant above. Connect is
// flag-gated inside the handler; list/disconnect are not.
v1.route('/integrations/ringcentral', ringcentralOauthHandler)
// Read-only list of integration-validator integrations for the Developer page's
// Integrations card. Mounted AFTER the more-specific /integrations/ringcentral
// route; this sub-app only registers GET /, so it never shadows ringcentral.
v1.route('/integrations', integrationsHandler)
v1.route('/documents', documentsHandler)
// PegII dashboard: served cloud-direct from three on-prem MSSQL views
// (v_dashboard1/2/3) via the in-VPC mssql-executor Lambda. Same pattern as the
// longhaul-cloud reference handlers; powers the tenant dashboard's "Use PegII
// Data" toggle. See handlers/dashboard-pegii.ts.
v1.get('/dashboard/pegii', dashboardPegiiHandler)
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
// Migration gap fix: /trip-statuses (MasterTripStatus) is served cloud-direct.
// It was never ported in Phase 3 and the /onprem proxy that served it was
// removed in Phase 5, so it had been 404ing on AppGuard bootstrap. Same
// reference-data pattern as /states and /zones above.
v1.get('/onprem/longhaul/trip-statuses', longhaulTripStatusesHandler)
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
// Batched bootstrap: /reference-data collapses the seven reference-data fetches
// (drivers, trip-statuses, states, zones, planners, dispatchers, filter-options)
// into one multi-statement MSSQL batch — dropping AppGuard bootstrap from ~9
// to ~3 api Lambda invocations and removing the self-throttle risk. The seven
// standalone endpoints above are retained for non-bootstrap callers. See
// handlers/longhaul-cloud/reference-data.ts.
v1.get('/onprem/longhaul/reference-data', longhaulReferenceDataHandler)
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
// Rejected-trip snapshots — stored cloud-side in Postgres (NOT MSSQL) so the
// activity table's enabled triggers never re-fire when a trip is copied. The
// create handler reads the live trip via the shared lib/longhaul-trip-fetch and
// persists an immutable snapshot + per-driver rejection rows. List/detail are
// pure Postgres reads. Registered before the /onprem wildcard proxy. See
// handlers/longhaul-cloud/rejected-trips.ts.
v1.post('/onprem/longhaul/rejected-trips', createRejectedTripHandler)
v1.get('/onprem/longhaul/rejected-trips', listRejectedTripsHandler)
v1.get('/onprem/longhaul/rejected-trips/:id', getRejectedTripHandler)
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
// Phase 4 (Unit 2): trip notes + activity save served cloud-direct. The
// activity save recomputes the trip summary (lib/longhaul-cloud-trip-summary).
// POST /activities (CREATE) is intentionally left on the proxy — no tenant-web
// caller; trip-save (Unit 5) handles activity inserts. See handlers/
// longhaul-cloud/{trip-notes,activities-write}.ts.
v1.post('/onprem/longhaul/trips/:id/notes', longhaulCreateTripNoteHandler)
v1.patch('/onprem/longhaul/notes/:id', longhaulPatchTripNoteHandler)
v1.post('/onprem/longhaul/activities/:id', longhaulSaveActivityHandler)
// Phase 4 (Unit 3): trip status / cancel / summary served cloud-direct. status
// + cancel author the multi-table mutation as one in-SQL transaction (Unit 0
// pattern); summary is a faithful direct field-touch (NOT a recompute — see
// handlers/longhaul-cloud/trips-write.ts). Registered before the /onprem mount;
// POST /trips and PUT /trips/:id (trip save) still fall through to the proxy.
v1.patch('/onprem/longhaul/trips/:id/status', longhaulTripStatusHandler)
v1.post('/onprem/longhaul/trips/:id/cancel', longhaulTripCancelHandler)
v1.patch('/onprem/longhaul/trips/:id/summary', longhaulTripSummaryHandler)
// Phase 4 (Unit 4): saved-shipment-filter CRUD served cloud-direct (user-pref
// writes). GET /shipment-filters[/default] already cloud-direct above; these
// add the writes. Registered before the /onprem mount.
v1.post('/onprem/longhaul/shipment-filters', longhaulSaveShipmentFilterHandler)
v1.put('/onprem/longhaul/shipment-filters/default', longhaulSetDefaultShipmentFilterHandler)
v1.delete('/onprem/longhaul/shipment-filters/:id', longhaulDeleteShipmentFilterHandler)
// Phase 4 (Unit 5): TRIP SAVE — POST /trips (create) + PUT /trips/:id (update)
// served cloud-direct. RT1 reads current state; RT2 is one atomic in-SQL
// transaction (trip upsert + activity diff + summary). The 16-18-round-trip WAN
// write the whole phase targets. See handlers/longhaul-cloud/trip-save.ts.
v1.post('/onprem/longhaul/trips', longhaulCreateTripHandler)
v1.put('/onprem/longhaul/trips/:id', longhaulUpdateTripHandler)

app.route('/api/v1', v1)

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

// `m2mV1` (mounted at /api/v1) is exported for the OpenAPI route-coverage test
// (lib/openapi-spec.coverage.test.ts): every vnd_-reachable GET route it carries
// must be documented in the served spec, so the api_get catalog stays complete.
export { app, m2mV1 }
