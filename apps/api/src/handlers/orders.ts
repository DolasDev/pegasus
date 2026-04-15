// ---------------------------------------------------------------------------
// Orders handler — M2M (API client) view of moves for integration use
//
// Provides a simplified integration interface for creating and listing moves
// (referred to as "orders" in the legacy Pegasus API). Accessible only by
// authenticated API clients — not by Cognito-authenticated tenant users.
//
// URL mapping from legacy API:
//   GET  /orders                          → GET  /api/v1/orders
//   POST /orders/create                   → POST /api/v1/orders
//   POST /orders/create/{customer_app_id} → POST /api/v1/orders (customerId in body)
//
// Scopes:
//   orders:read  — list orders (GET /)
//   orders:write — create orders (POST /)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { m2mAppAuthMiddleware } from '../middleware/m2m-app-auth'
import { createMove, listMoves, findMoveById } from '../repositories'
import type { Move } from '@pegasus/domain'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Scope helper
// ---------------------------------------------------------------------------

function requireScope(required: string) {
  return async (c: Parameters<typeof m2mAppAuthMiddleware>[0], next: () => Promise<void>) => {
    const apiClient = c.get('apiClient')
    if (!apiClient || !apiClient.scopes.includes(required)) {
      return c.json(
        { error: `Forbidden: missing required scope "${required}"`, code: 'FORBIDDEN' },
        403,
      )
    }
    await next()
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
})

const CreateOrderBody = z.object({
  /** The user/agent creating this order (system user ID). */
  userId: z.string().min(1),
  /** Optional Pegasus customer ID to associate with this order. */
  customerId: z.string().min(1).optional(),
  scheduledDate: z.string().datetime(),
  origin: AddressSchema,
  destination: AddressSchema,
})

// ---------------------------------------------------------------------------
// Response serialiser — moves mapped to order-friendly shape
// ---------------------------------------------------------------------------

function toOrderResponse(move: Move) {
  return {
    id: String(move.id),
    userId: String(move.userId),
    customerId: move.customerId ? String(move.customerId) : null,
    status: move.status,
    scheduledDate:
      move.scheduledDate instanceof Date ? move.scheduledDate.toISOString() : move.scheduledDate,
    origin: move.origin,
    destination: move.destination,
    createdAt: move.createdAt instanceof Date ? move.createdAt.toISOString() : move.createdAt,
    updatedAt: move.updatedAt instanceof Date ? move.updatedAt.toISOString() : move.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Router — auth applied here so all routes in this handler are M2M-only
// ---------------------------------------------------------------------------

export const ordersHandler = new Hono<AppEnv>()

ordersHandler.use('*', m2mAppAuthMiddleware)

// ---------------------------------------------------------------------------
// GET /
//
// Lists orders (moves) for the current tenant. Returns paginated results
// ordered by scheduled date descending.
//
// Query params: limit (max 100, default 50), offset (default 0)
// Response: { data: OrderResponse[], meta: { count, limit, offset } }
// ---------------------------------------------------------------------------
ordersHandler.get('/', requireScope('orders:read'), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 100)
  const offset = Number(c.req.query('offset') ?? '0')

  const moves = await listMoves(db, { limit, offset })
  logger.info('Orders listed', { count: moves.length, tenantId })
  return c.json({
    data: moves.map(toOrderResponse),
    meta: { count: moves.length, limit, offset },
  })
})

// ---------------------------------------------------------------------------
// GET /:orderId
//
// Returns a single order (move) by ID.
//
// Response: { data: OrderResponse } (200) | 404
// ---------------------------------------------------------------------------
ordersHandler.get('/:orderId', requireScope('orders:read'), async (c) => {
  const db = c.get('db')
  const orderId = c.req.param('orderId')

  const move = await findMoveById(db, orderId)
  if (!move) {
    return c.json({ error: 'Order not found', code: 'NOT_FOUND' }, 404)
  }
  return c.json({ data: toOrderResponse(move) })
})

// ---------------------------------------------------------------------------
// POST /
//
// Creates a new order (move) for the tenant. Accepts an optional customerId
// to associate the order with a specific customer — this covers both the
// legacy /orders/create and /orders/create/{customer_app_id} variants.
//
// Accepts:  application/json  or  application/xml  /  text/xml
// Response: { data: OrderResponse } (201)
// ---------------------------------------------------------------------------
const xmlParser = new XMLParser({ parseTagValue: false })

ordersHandler.post('/', requireScope('orders:write'), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const contentType = c.req.header('content-type') ?? ''

  let rawBody: unknown
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    try {
      const text = await c.req.text()
      const parsed = xmlParser.parse(text)
      rawBody = Object.values(parsed)[0]
    } catch {
      return c.json({ error: 'Invalid XML body', code: 'VALIDATION_ERROR' }, 400)
    }
  } else {
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, 400)
    }
  }

  const r = CreateOrderBody.safeParse(rawBody)
  if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
  const body = r.data

  const move = await createMove(db, tenantId, {
    userId: body.userId,
    scheduledDate: new Date(body.scheduledDate),
    ...(body.customerId ? { customerId: body.customerId } : {}),
    origin: {
      line1: body.origin.line1,
      city: body.origin.city,
      state: body.origin.state,
      postalCode: body.origin.postalCode,
      country: body.origin.country,
      ...(body.origin.line2 ? { line2: body.origin.line2 } : {}),
    },
    destination: {
      line1: body.destination.line1,
      city: body.destination.city,
      state: body.destination.state,
      postalCode: body.destination.postalCode,
      country: body.destination.country,
      ...(body.destination.line2 ? { line2: body.destination.line2 } : {}),
    },
  })
  logger.info('Order created', { id: String(move.id), tenantId })
  return c.json({ data: toOrderResponse(move) }, 201)
})
