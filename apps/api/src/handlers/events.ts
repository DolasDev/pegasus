// ---------------------------------------------------------------------------
// Events handler — integration event queue for M2M (API client) access
//
// Implements the inbound event queue previously served by the standalone
// AWS Lambda API (apps/services/api). The Python integration service polls
// these endpoints to receive events and delete them once processed.
//
// All endpoints require a valid API client key (vnd_ prefix). Authentication
// runs through m2mAppAuthMiddleware, which resolves the service-account
// TenantUser the key acts as and populates the Cedar principal. Per-route
// authorization runs through requirePermission against the action catalog.
//
// URL mapping from legacy API:
//   POST /EventEndpointHandler          → POST /api/v1/events
//   GET  /events/{eventType}            → GET  /api/v1/events/:eventType
//   DELETE /events/{eventId}            → DELETE /api/v1/events/:eventId
//
// Permissions:
//   CreateEvent — POST /
//   ReadEvent   — GET /:eventType
//   UpdateEvent — PATCH /:eventId
//   DeleteEvent — DELETE /:eventId
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { m2mAppAuthMiddleware } from '../middleware/m2m-app-auth'
import { requirePermission } from '../middleware/rbac'
import { Actions } from '../authz/actions'
import {
  createEvent,
  listEventsByType,
  findEventById,
  updateEvent,
  deleteEvent,
} from '../repositories/events.repository'
import type { PegasusEventRow } from '../repositories/events.repository'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateEventBody = z.object({
  eventApiId: z.string().min(1),
  eventType: z.string().min(1),
  eventDatetime: z.string().datetime().optional(),
  eventPublisher: z.string().min(1).optional(),
  eventData: z.record(z.string(), z.unknown()).optional(),
})

const UpdateEventBody = z.object({
  eventStatus: z.string().min(1),
  processedAt: z.string().datetime().optional(),
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
  requirePermission(Actions.CreateEvent),
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
      throw err
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
eventsHandler.get('/:eventType', requirePermission(Actions.ReadEvent), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const eventType = c.req.param('eventType') ?? ''
  const limit = Math.min(Number(c.req.query('limit') ?? '100'), 500)
  const offset = Number(c.req.query('offset') ?? '0')

  const rows = await listEventsByType(db, eventType, { limit, offset })
  logger.info('Events listed', { eventType, count: rows.length, tenantId })
  return c.json({
    data: rows.map(toResponse),
    meta: { count: rows.length, limit, offset },
  })
})

// ---------------------------------------------------------------------------
// PATCH /:eventId
//
// Updates the status (and optionally processedAt) of an existing event.
// Used by the integration service to transition events through the processing
// pipeline (e.g. NEW → PROCESSING → DONE).
//
// Equivalent to the legacy PATCH_events_update Lambda (previously a stub).
//
// Request:  { eventStatus: string, processedAt?: string (ISO datetime) }
// Response: { data: EventResponse } (200) | 404 Not Found
// ---------------------------------------------------------------------------
eventsHandler.patch(
  '/:eventId',
  requirePermission(Actions.UpdateEvent),
  validator('json', (value, c) => {
    const r = UpdateEventBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const db = c.get('db')
    const tenantId = c.get('tenantId')
    const eventId = c.req.param('eventId') ?? ''
    const body = c.req.valid('json')

    const existing = await findEventById(db, eventId)
    if (!existing) {
      return c.json({ error: 'Event not found', code: 'NOT_FOUND' }, 404)
    }
    const row = await updateEvent(db, eventId, {
      eventStatus: body.eventStatus,
      ...(body.processedAt !== undefined ? { processedAt: new Date(body.processedAt) } : {}),
    })
    logger.info('Event updated', { id: eventId, eventStatus: body.eventStatus, tenantId })
    return c.json({ data: toResponse(row) })
  },
)

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
eventsHandler.delete('/:eventId', requirePermission(Actions.DeleteEvent), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('tenantId')
  const eventId = c.req.param('eventId') ?? ''

  const existing = await findEventById(db, eventId)
  if (!existing) {
    return c.json({ error: 'Event not found', code: 'NOT_FOUND' }, 404)
  }
  await deleteEvent(db, eventId)
  logger.info('Event deleted', { id: eventId, eventType: existing.eventType, tenantId })
  return new Response(null, { status: 204 })
})
