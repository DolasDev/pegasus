// ---------------------------------------------------------------------------
// Runtime entity reads (m2m) — the operational-entity list endpoints a workflow
// runtime reads via its `vnd_` service-account key. The `workflow_runtime` Cedar
// persona already grants ReadCustomer/ReadQuote/ReadMove/ReadInvoice, but the
// browser CRUD handlers (customers/quotes/moves/billing) live on the Cognito-only
// `v1` router, which rejects a vnd_ key. These read-only mirrors are mounted on
// the dual-auth `m2mV1` router under a DISTINCT `/runtime` prefix (like
// /pegii/*), so they don't shadow the browser routes. They reuse the same
// repository list logic + response shape as the v1 handlers.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import {
  listQuotes,
  countQuotes,
  listMoves,
  countMoves,
  listInvoices,
  countInvoices,
} from '../repositories'
import { resolveCustomerGateway } from '../gateways/customer-gateway.factory'

// A driver principal must never see moves outside their assignment; the sentinel
// yields an empty list (fail-closed) — mirrors handlers/moves.ts.
const NO_CREW_MEMBER = '__none__'

/** Shared paging read: `?limit=` (≤100, default 50) + `?offset=` (default 0). */
function paging(c: { req: { query: (k: string) => string | undefined } }): {
  limit: number
  offset: number
} {
  return {
    limit: Math.min(Number(c.req.query('limit') ?? '50'), 100),
    offset: Number(c.req.query('offset') ?? '0'),
  }
}

export const runtimeReadsHandler = new Hono<AppEnv>()

runtimeReadsHandler.use('*', dualAuthMiddleware)

runtimeReadsHandler.get('/customers', requirePermission(Actions.ReadCustomer), async (c) => {
  const { limit, offset } = paging(c)
  const gateway = await resolveCustomerGateway(c.get('db'), c.get('tenantId'))
  const [data, total] = await Promise.all([
    gateway.listCustomers({ limit, offset }),
    gateway.countCustomers(),
  ])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})

runtimeReadsHandler.get('/quotes', requirePermission(Actions.ReadQuote), async (c) => {
  const db = c.get('db')
  const { limit, offset } = paging(c)
  const [data, total] = await Promise.all([listQuotes(db, { limit, offset }), countQuotes(db)])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})

// Gated by ReadMove (single-entity read) — the action the workflow_runtime
// persona is granted. The browser list route uses ListMoves, which the persona
// deliberately lacks; ReadMove keeps this m2m list on the existing grant with no
// Cedar policy change (avoids a cross-tenant AVP re-sync).
runtimeReadsHandler.get('/moves', requirePermission(Actions.ReadMove), async (c) => {
  const db = c.get('db')
  const { limit, offset } = paging(c)
  // Same driver-scoping as the browser handler: a driver sees only their trips.
  const principal = c.get('principal')
  const crewMemberId = principal?.roleNames.includes('driver')
    ? (principal.crewMemberId ?? NO_CREW_MEMBER)
    : undefined
  const [data, total] = await Promise.all([
    listMoves(db, { limit, offset, ...(crewMemberId ? { crewMemberId } : {}) }),
    countMoves(db, crewMemberId),
  ])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})

runtimeReadsHandler.get('/invoices', requirePermission(Actions.ReadInvoice), async (c) => {
  const db = c.get('db')
  const { limit, offset } = paging(c)
  const [data, total] = await Promise.all([listInvoices(db, { limit, offset }), countInvoices(db)])
  return c.json({ data, meta: { total, count: data.length, limit, offset } })
})
