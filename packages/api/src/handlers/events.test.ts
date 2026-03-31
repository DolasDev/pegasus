// ---------------------------------------------------------------------------
// Unit tests for the events handler (/api/v1/events)
//
// m2mAppAuthMiddleware is mocked to inject context without real key verification.
// Repository functions are mocked so no DB is required.
// Scope enforcement (requireScope) is tested via the mocked apiClient.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv, ApiClientContext } from '../types'

// ---------------------------------------------------------------------------
// Mock m2mAppAuthMiddleware — replaced with a context-injecting stub
// ---------------------------------------------------------------------------

const mockApiClient: ApiClientContext = {
  id: 'client-1',
  tenantId: 'test-tenant-id',
  name: 'Test Integration',
  keyPrefix: 'vnd_test000000',
  scopes: ['events:read', 'events:write'],
  lastUsedAt: null,
  revokedAt: null,
  createdById: 'user-1',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

vi.mock('../middleware/m2m-app-auth', () => ({
  m2mAppAuthMiddleware: vi.fn(async (c: ReturnType<Hono<AppEnv>['use']>, next: () => Promise<void>) => {
    // Injected per test via buildApp — this mock is overridden there
    await next()
  }),
}))

// ---------------------------------------------------------------------------
// Mock the events repository
// ---------------------------------------------------------------------------

const { mockEventsRepo } = vi.hoisted(() => ({
  mockEventsRepo: {
    createEvent: vi.fn(),
    listEventsByType: vi.fn(),
    findEventById: vi.fn(),
    deleteEvent: vi.fn(),
  },
}))

vi.mock('../repositories/events.repository', () => ({
  createEvent: (...args: unknown[]) => mockEventsRepo.createEvent(...args),
  listEventsByType: (...args: unknown[]) => mockEventsRepo.listEventsByType(...args),
  findEventById: (...args: unknown[]) => mockEventsRepo.findEventById(...args),
  deleteEvent: (...args: unknown[]) => mockEventsRepo.deleteEvent(...args),
}))

import { eventsHandler } from './events'
import { m2mAppAuthMiddleware } from '../middleware/m2m-app-auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonBody = Record<string, unknown>

async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * Builds a test app wrapping eventsHandler.
 * The mocked m2mAppAuthMiddleware is overridden to inject context
 * based on the provided apiClient (null = unauthenticated/wrong key).
 */
function buildApp(apiClient: ApiClientContext | null = mockApiClient) {
  // Override the mock to inject context
  vi.mocked(m2mAppAuthMiddleware).mockImplementation(async (c, next) => {
    if (apiClient === null) {
      return c.json({ error: 'Missing or invalid API key', code: 'UNAUTHORIZED' }, 401)
    }
    c.set('tenantId', apiClient.tenantId)
    c.set('db', {} as unknown as PrismaClient)
    c.set('role', 'api_client')
    c.set('userId', undefined)
    c.set('apiClient', apiClient)
    await next()
  })

  const app = new Hono<AppEnv>()
  app.route('/', eventsHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-06-01T12:00:00Z')

const mockEventRow = {
  id: 'evt-cuid-1',
  tenantId: 'test-tenant-id',
  eventApiId: 'ext-event-abc123',
  eventType: 'LEAD_CREATED',
  eventDatetime: now,
  eventStatus: 'NEW',
  eventPublisher: 'legacy-system',
  eventData: { leadId: '10x123' },
  receivedAt: now,
  processedAt: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('events handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  describe('auth (m2mAppAuthMiddleware)', () => {
    it('returns 401 when no valid API key is present', async () => {
      const app = buildApp(null)
      const res = await app.request('/', { method: 'GET' })
      // The eventsHandler doesn't have a route at /, but auth runs first
      expect(res.status).toBe(401)
      expect((await json(res)).code).toBe('UNAUTHORIZED')
    })
  })

  // ── Scope enforcement ─────────────────────────────────────────────────────

  describe('scope enforcement', () => {
    it('returns 403 FORBIDDEN when apiClient lacks events:write scope on POST', async () => {
      const readOnlyClient: ApiClientContext = { ...mockApiClient, scopes: ['events:read'] }
      const app = buildApp(readOnlyClient)
      const res = await app.request(
        '/',
        post({
          eventApiId: 'ext-123',
          eventType: 'LEAD_CREATED',
        }),
      )
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when apiClient lacks events:read scope on GET', async () => {
      const writeOnlyClient: ApiClientContext = { ...mockApiClient, scopes: ['events:write'] }
      const app = buildApp(writeOnlyClient)
      const res = await app.request('/LEAD_CREATED')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when apiClient lacks events:write scope on DELETE', async () => {
      const readOnlyClient: ApiClientContext = { ...mockApiClient, scopes: ['events:read'] }
      const app = buildApp(readOnlyClient)
      const res = await app.request('/evt-cuid-1', { method: 'DELETE' })
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })
  })

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST / — create event', () => {
    it('returns 400 VALIDATION_ERROR when eventApiId is missing', async () => {
      const app = buildApp()
      const res = await app.request('/', post({ eventType: 'LEAD_CREATED' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when eventType is missing', async () => {
      const app = buildApp()
      const res = await app.request('/', post({ eventApiId: 'ext-123' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when eventDatetime is not ISO datetime', async () => {
      const app = buildApp()
      const res = await app.request(
        '/',
        post({ eventApiId: 'ext-123', eventType: 'LEAD_CREATED', eventDatetime: 'not-a-date' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 201 with event data on success', async () => {
      mockEventsRepo.createEvent.mockResolvedValue(mockEventRow)
      const app = buildApp()
      const res = await app.request(
        '/',
        post({
          eventApiId: 'ext-event-abc123',
          eventType: 'LEAD_CREATED',
          eventPublisher: 'legacy-system',
          eventData: { leadId: '10x123' },
        }),
      )
      expect(res.status).toBe(201)
      const body = await json(res)
      expect(body.data).toMatchObject({
        id: 'evt-cuid-1',
        eventApiId: 'ext-event-abc123',
        eventType: 'LEAD_CREATED',
        eventStatus: 'NEW',
      })
    })

    it('passes tenantId and eventApiId to the repository', async () => {
      mockEventsRepo.createEvent.mockResolvedValue(mockEventRow)
      const app = buildApp()
      await app.request(
        '/',
        post({ eventApiId: 'ext-event-abc123', eventType: 'LEAD_CREATED' }),
      )
      expect(mockEventsRepo.createEvent).toHaveBeenCalledWith(
        expect.anything(),
        'test-tenant-id',
        expect.objectContaining({ eventApiId: 'ext-event-abc123', eventType: 'LEAD_CREATED' }),
      )
    })

    it('returns 409 CONFLICT on duplicate eventApiId', async () => {
      mockEventsRepo.createEvent.mockRejectedValue(
        new Error('Unique constraint failed on the fields: (`event_api_id`)'),
      )
      const app = buildApp()
      const res = await app.request(
        '/',
        post({ eventApiId: 'ext-event-abc123', eventType: 'LEAD_CREATED' }),
      )
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 500 INTERNAL_ERROR on unexpected repository error', async () => {
      mockEventsRepo.createEvent.mockRejectedValue(new Error('database unavailable'))
      const app = buildApp()
      const res = await app.request(
        '/',
        post({ eventApiId: 'ext-123', eventType: 'LEAD_CREATED' }),
      )
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET /:eventType ───────────────────────────────────────────────────────

  describe('GET /:eventType — list events by type', () => {
    it('returns 200 with empty data array when no events found', async () => {
      mockEventsRepo.listEventsByType.mockResolvedValue([])
      const app = buildApp()
      const res = await app.request('/LEAD_CREATED')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.data).toEqual([])
      expect(body.meta).toMatchObject({ count: 0 })
    })

    it('returns 200 with events and correct meta', async () => {
      mockEventsRepo.listEventsByType.mockResolvedValue([mockEventRow, mockEventRow])
      const app = buildApp()
      const res = await app.request('/LEAD_CREATED?limit=10&offset=0')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as unknown[]).length).toBe(2)
      expect(body.meta).toMatchObject({ count: 2, limit: 10, offset: 0 })
    })

    it('serialises eventDatetime as ISO string', async () => {
      mockEventsRepo.listEventsByType.mockResolvedValue([mockEventRow])
      const app = buildApp()
      const res = await app.request('/LEAD_CREATED')
      const body = await json(res)
      const event = (body.data as JsonBody[])[0]
      expect(event['eventDatetime']).toBe(now.toISOString())
    })

    it('passes eventType and pagination opts to the repository', async () => {
      mockEventsRepo.listEventsByType.mockResolvedValue([])
      const app = buildApp()
      await app.request('/MOVE_UPDATED?limit=20&offset=5')
      expect(mockEventsRepo.listEventsByType).toHaveBeenCalledWith(
        expect.anything(),
        'MOVE_UPDATED',
        { limit: 20, offset: 5 },
      )
    })

    it('caps limit at 500', async () => {
      mockEventsRepo.listEventsByType.mockResolvedValue([])
      const app = buildApp()
      await app.request('/LEAD_CREATED?limit=9999')
      expect(mockEventsRepo.listEventsByType).toHaveBeenCalledWith(
        expect.anything(),
        'LEAD_CREATED',
        { limit: 500, offset: 0 },
      )
    })

    it('returns 500 on repository error', async () => {
      mockEventsRepo.listEventsByType.mockRejectedValue(new Error('db error'))
      const app = buildApp()
      const res = await app.request('/LEAD_CREATED')
      expect(res.status).toBe(500)
    })
  })

  // ── DELETE /:eventId ──────────────────────────────────────────────────────

  describe('DELETE /:eventId — acknowledge event', () => {
    it('returns 404 NOT_FOUND when event does not exist', async () => {
      mockEventsRepo.findEventById.mockResolvedValue(null)
      const app = buildApp()
      const res = await app.request('/evt-missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 204 No Content on successful deletion', async () => {
      mockEventsRepo.findEventById.mockResolvedValue(mockEventRow)
      mockEventsRepo.deleteEvent.mockResolvedValue(undefined)
      const app = buildApp()
      const res = await app.request('/evt-cuid-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
    })

    it('calls deleteEvent with the correct event id', async () => {
      mockEventsRepo.findEventById.mockResolvedValue(mockEventRow)
      mockEventsRepo.deleteEvent.mockResolvedValue(undefined)
      const app = buildApp()
      await app.request('/evt-cuid-1', { method: 'DELETE' })
      expect(mockEventsRepo.deleteEvent).toHaveBeenCalledWith(expect.anything(), 'evt-cuid-1')
    })

    it('returns 500 on repository error', async () => {
      mockEventsRepo.findEventById.mockResolvedValue(mockEventRow)
      mockEventsRepo.deleteEvent.mockRejectedValue(new Error('db error'))
      const app = buildApp()
      const res = await app.request('/evt-cuid-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
    })
  })
})
