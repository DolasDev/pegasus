// ---------------------------------------------------------------------------
// Events handler — integration event queue for M2M (API client) access
//
// Implements the inbound event queue previously served by the standalone
// AWS Lambda API (apps/services/api). The Python integration service polls
// these endpoints to receive events and delete them once processed.
//
// All endpoints require a valid API client key (vnd_ prefix) and the
// appropriate scope. Authentication is handled by m2mAppAuthMiddleware,
// which must be applied before this router is reached.
//
// URL mapping from legacy API:
//   POST /EventEndpointHandler          → POST /api/v1/events
//   GET  /events/{eventType}            → GET  /api/v1/events/:eventType
//   DELETE /events/{eventId}            → DELETE /api/v1/events/:eventId
//
// Scopes:
//   events:write — create events (POST /)
//   events:read  — read events (GET /:eventType)
//   events:write — delete/acknowledge events (DELETE /:eventId)
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { m2mAppAuthMiddleware } from '../middleware/m2m-app-auth'
import {
  createEvent,
  listEventsByType,
  findEventById,
  deleteEvent,
} from '../repositories/events.repository'
import type { PegasusEventRow } from '../repositories/events.repository'
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

const CreateEventBody = z.object({
  eventApiId: z.string().min(1),
  eventType: z.string().min(1),
  eventDatetime: z.string().datetime().optional(),
  eventPublisher: z.string().min(1).optional(),
  eventData: z.record(z.unknown()).optional(),
})

// ---------------------------------------------------------------------------
// Response serialiser
// ---------------------------------------------------------------------------

function toResponse(row: PegasusEventRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventApiId: row.eventApiId,
    eventType: row.eventType,
    eventDatetime: row.eventDatetime?.toISOString() ?? null,
    eventStatus: row.eventStatus,
    eventPublisher: row.eventPublisher ?? null,
    eventData: row.eventData ?? null,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  }
}

// ---------------------------------------------------------------------------
// Router — auth applied here so all routes in this handler are M2M-only
// ---------------------------------------------------------------------------

export const eventsHandler = new Hono<AppEnv>()

eventsHandler.use('*', m2mAppAuthMiddleware)

// ---------------------------------------------------------------------------
// POST /
//
// Publishes (creates) a new integration event in the tenant's queue.
// Used by external systems (e.g. legacy Pegasus desktop, third-party vendors)
// to notify the integration service of state changes.
//
// Equivalent to the legacy /EventEndpointHandler Lambda.
//
// Request:  CreateEventBody
// Response: { data: EventResponse } (201) | 409 (duplicate eventApiId)
// ---------------------------------------------------------------------------
eventsHandler.post(
  '/',
  requireScope('events:write'),
  validator('json', (value, c) => {
    const r = CreateEventBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const body = c.req.valid('json')

    try {
      const row = await createEvent(db, tenantId, {
        eventApiId: body.eventApiId,
        eventType: body.eventType,
        ...(body.eventDatetime ? { eventDatetime: new Date(body.eventDatetime) } : {}),
        ...(body.eventPublisher ? { eventPublisher: body.eventPublisher } : {}),
        ...(body.eventData ? { eventData: body.eventData } : {}),
      })
      logger.info('Event created', { id: row.id, eventType: row.eventType, tenantId })
      return c.json({ data: toResponse(row) }, 201)
    } catch (err: unknown) {
      // Unique constraint on eventApiId — treat as conflict
      if (String(err).includes('Unique constraint')) {
        return c.json({ error: 'Event with this ID already exists', code: 'CONFLICT' }, 409)
      }
      logger.error('POST /events: failed to create event', { error: String(err), tenantId })
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// GET /:eventType
//
// Returns NEW events of the given type for the tenant (oldest first).
// The integration service calls this to poll for pending work.
//
// Equivalent to the legacy GET /events/{eventType} Lambda.
//
// Query params: limit (max 500, default 100), offset (default 0)
// Response: { data: EventResponse[], meta: { count, limit, offset } }
// ---------------------------------------------------------------------------
eventsHandler.get('/:eventType', requireScope('events:read'), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const eventType = c.req.param('eventType')
  const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500)
  const offset = Number(c.req.query('offset') ?? '0')

  try {
    const rows = await listEventsByType(db, eventType, { limit, offset })
    logger.info('Events listed', { eventType, count: rows.length, tenantId })
    return c.json({
      data: rows.map(toResponse),
      meta: { count: rows.length, limit, offset },
    })
  } catch (err) {
    logger.error('GET /events/:eventType: failed', { error: String(err), eventType, tenantId })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ---------------------------------------------------------------------------
// DELETE /:eventId
//
// Removes (acknowledges) a processed event from the queue. Called by the
// integration service after the event has been written to the legacy SQL
// Server. The ID is the Pegasus-internal CUID, not the eventApiId.
//
// Equivalent to the legacy DELETE /events/{eventId} Lambda.
//
// Response: 204 No Content | 404 Not Found
// ---------------------------------------------------------------------------
eventsHandler.delete('/:eventId', requireScope('events:write'), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const eventId = c.req.param('eventId')

  try {
    const existing = await findEventById(db, eventId)
    if (!existing) {
      return c.json({ error: 'Event not found', code: 'NOT_FOUND' }, 404)
    }
    await deleteEvent(db, eventId)
    logger.info('Event deleted', { id: eventId, eventType: existing.eventType, tenantId })
    return new Response(null, { status: 204 })
  } catch (err) {
    logger.error('DELETE /events/:eventId: failed', { error: String(err), eventId, tenantId })
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }
})
