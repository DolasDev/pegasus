// ---------------------------------------------------------------------------
// Unit tests for the orders handler (/api/v1/orders)
//
// m2mAppAuthMiddleware is mocked to inject context without real key verification.
// Move repository functions are mocked so no DB is required.
// Scope enforcement is tested via the mocked apiClient.scopes.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv, ApiClientContext } from '../types'
import type { Move } from '@pegasus/domain'
import { toMoveId, toUserId, toAddressId } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Mock m2mAppAuthMiddleware
// ---------------------------------------------------------------------------

const mockApiClient: ApiClientContext = {
  id: 'client-2',
  tenantId: 'test-tenant-id',
  name: 'Orders Integration',
  keyPrefix: 'vnd_orders0000',
  scopes: ['orders:read', 'orders:write'],
  lastUsedAt: null,
  revokedAt: null,
  createdById: 'user-1',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

vi.mock('../middleware/m2m-app-auth', () => ({
  m2mAppAuthMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next()
  }),
}))

// ---------------------------------------------------------------------------
// Mock the repositories used by the orders handler
// ---------------------------------------------------------------------------

const { mockMovesRepo } = vi.hoisted(() => ({
  mockMovesRepo: {
    createMove: vi.fn(),
    listMoves: vi.fn(),
    findMoveById: vi.fn(),
  },
}))

vi.mock('../repositories', () => ({
  createMove: (...args: unknown[]) => mockMovesRepo.createMove(...args),
  listMoves: (...args: unknown[]) => mockMovesRepo.listMoves(...args),
  findMoveById: (...args: unknown[]) => mockMovesRepo.findMoveById(...args),
}))

import { ordersHandler } from './orders'
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

function toXmlString(obj: Record<string, unknown>, tag = 'order'): string {
  const inner = Object.entries(obj)
    .map(([k, v]) => {
      if (v !== null && v !== undefined && typeof v === 'object') {
        return toXmlString(v as Record<string, unknown>, k)
      }
      return `<${k}>${v}</${k}>`
    })
    .join('')
  return `<${tag}>${inner}</${tag}>`
}

function xmlPost(body: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: toXmlString(body),
  }
}

function buildApp(apiClient: ApiClientContext | null = mockApiClient) {
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
  app.route('/', ordersHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-06-15T10:00:00Z')

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    id: toMoveId('move-id-1'),
    userId: toUserId('user-1'),
    customerId: undefined,
    status: 'PENDING',
    scheduledDate: now,
    origin: {
      id: toAddressId('addr-1'),
      line1: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
    },
    destination: {
      id: toAddressId('addr-2'),
      line1: '456 Oak Ave',
      city: 'Shelbyville',
      state: 'IL',
      postalCode: '62565',
      country: 'US',
    },
    stops: [],
    crewAssignments: [],
    vehicleAssignments: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const validOrderBody = {
  userId: 'user-1',
  scheduledDate: now.toISOString(),
  origin: {
    line1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
  },
  destination: {
    line1: '456 Oak Ave',
    city: 'Shelbyville',
    state: 'IL',
    postalCode: '62565',
    country: 'US',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orders handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  describe('auth (m2mAppAuthMiddleware)', () => {
    it('returns 401 when no valid API key is present', async () => {
      const app = buildApp(null)
      const res = await app.request('/')
      expect(res.status).toBe(401)
      expect((await json(res)).code).toBe('UNAUTHORIZED')
    })
  })

  // ── Scope enforcement ─────────────────────────────────────────────────────

  describe('scope enforcement', () => {
    it('returns 403 FORBIDDEN when apiClient lacks orders:read scope on GET /', async () => {
      const writeOnly: ApiClientContext = { ...mockApiClient, scopes: ['orders:write'] }
      const app = buildApp(writeOnly)
      const res = await app.request('/')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when apiClient lacks orders:read scope on GET /:id', async () => {
      const writeOnly: ApiClientContext = { ...mockApiClient, scopes: ['orders:write'] }
      const app = buildApp(writeOnly)
      const res = await app.request('/move-id-1')
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })

    it('returns 403 FORBIDDEN when apiClient lacks orders:write scope on POST /', async () => {
      const readOnly: ApiClientContext = { ...mockApiClient, scopes: ['orders:read'] }
      const app = buildApp(readOnly)
      const res = await app.request('/', post(validOrderBody))
      expect(res.status).toBe(403)
      expect((await json(res)).code).toBe('FORBIDDEN')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET / — list orders', () => {
    it('returns 200 with empty array when no moves found', async () => {
      mockMovesRepo.listMoves.mockResolvedValue([])
      const app = buildApp()
      const res = await app.request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.data).toEqual([])
      expect(body.meta).toMatchObject({ count: 0 })
    })

    it('returns 200 with serialised moves', async () => {
      const move = makeMove()
      mockMovesRepo.listMoves.mockResolvedValue([move])
      const app = buildApp()
      const res = await app.request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody[])[0]).toMatchObject({
        id: 'move-id-1',
        userId: 'user-1',
        status: 'PENDING',
      })
    })

    it('passes pagination params to the repository', async () => {
      mockMovesRepo.listMoves.mockResolvedValue([])
      const app = buildApp()
      await app.request('/?limit=25&offset=10')
      expect(mockMovesRepo.listMoves).toHaveBeenCalledWith(expect.anything(), {
        limit: 25,
        offset: 10,
      })
    })

    it('caps limit at 100', async () => {
      mockMovesRepo.listMoves.mockResolvedValue([])
      const app = buildApp()
      await app.request('/?limit=999')
      expect(mockMovesRepo.listMoves).toHaveBeenCalledWith(expect.anything(), {
        limit: 100,
        offset: 0,
      })
    })

    it('serialises scheduledDate as ISO string', async () => {
      mockMovesRepo.listMoves.mockResolvedValue([makeMove()])
      const app = buildApp()
      const res = await app.request('/')
      const body = await json(res)
      const order = (body.data as JsonBody[])[0]
      expect(order['scheduledDate']).toBe(now.toISOString())
    })

    it('returns 500 on repository error', async () => {
      mockMovesRepo.listMoves.mockRejectedValue(new Error('db error'))
      const app = buildApp()
      const res = await app.request('/')
      expect(res.status).toBe(500)
    })
  })

  // ── GET /:orderId ─────────────────────────────────────────────────────────

  describe('GET /:orderId — single order', () => {
    it('returns 404 NOT_FOUND when move does not exist', async () => {
      mockMovesRepo.findMoveById.mockResolvedValue(null)
      const app = buildApp()
      const res = await app.request('/missing-id')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 200 with the order on success', async () => {
      mockMovesRepo.findMoveById.mockResolvedValue(makeMove())
      const app = buildApp()
      const res = await app.request('/move-id-1')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('move-id-1')
    })

    it('calls findMoveById with the correct id', async () => {
      mockMovesRepo.findMoveById.mockResolvedValue(makeMove())
      const app = buildApp()
      await app.request('/move-id-1')
      expect(mockMovesRepo.findMoveById).toHaveBeenCalledWith(expect.anything(), 'move-id-1')
    })

    it('returns 500 on repository error', async () => {
      mockMovesRepo.findMoveById.mockRejectedValue(new Error('db error'))
      const app = buildApp()
      const res = await app.request('/move-id-1')
      expect(res.status).toBe(500)
    })
  })

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST / — create order', () => {
    it('returns 400 VALIDATION_ERROR when userId is missing', async () => {
      const app = buildApp()
      const { userId: _u, ...body } = validOrderBody
      const res = await app.request('/', post(body))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when scheduledDate is not ISO datetime', async () => {
      const app = buildApp()
      const res = await app.request('/', post({ ...validOrderBody, scheduledDate: 'June 15 2024' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when origin.line1 is missing', async () => {
      const app = buildApp()
      const res = await app.request(
        '/',
        post({ ...validOrderBody, origin: { ...validOrderBody.origin, line1: undefined } }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when destination is missing', async () => {
      const app = buildApp()
      const { destination: _d, ...body } = validOrderBody
      const res = await app.request('/', post(body))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 201 with order data on success', async () => {
      const move = makeMove()
      mockMovesRepo.createMove.mockResolvedValue(move)
      const app = buildApp()
      const res = await app.request('/', post(validOrderBody))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('move-id-1')
      expect((body.data as JsonBody)['status']).toBe('PENDING')
    })

    it('passes tenantId and body fields to createMove', async () => {
      mockMovesRepo.createMove.mockResolvedValue(makeMove())
      const app = buildApp()
      await app.request('/', post(validOrderBody))
      expect(mockMovesRepo.createMove).toHaveBeenCalledWith(
        expect.anything(),
        'test-tenant-id',
        expect.objectContaining({
          userId: 'user-1',
          scheduledDate: new Date(validOrderBody.scheduledDate),
          origin: expect.objectContaining({ line1: '123 Main St' }),
          destination: expect.objectContaining({ line1: '456 Oak Ave' }),
        }),
      )
    })

    it('includes customerId in createMove call when provided', async () => {
      mockMovesRepo.createMove.mockResolvedValue(makeMove())
      const app = buildApp()
      await app.request('/', post({ ...validOrderBody, customerId: 'cust-abc' }))
      expect(mockMovesRepo.createMove).toHaveBeenCalledWith(
        expect.anything(),
        'test-tenant-id',
        expect.objectContaining({ customerId: 'cust-abc' }),
      )
    })

    it('omits customerId from createMove call when not provided', async () => {
      mockMovesRepo.createMove.mockResolvedValue(makeMove())
      const app = buildApp()
      await app.request('/', post(validOrderBody))
      const args = mockMovesRepo.createMove.mock.calls[0][2] as Record<string, unknown>
      expect(args['customerId']).toBeUndefined()
    })

    it('returns 500 INTERNAL_ERROR on unexpected repository error', async () => {
      mockMovesRepo.createMove.mockRejectedValue(new Error('db error'))
      const app = buildApp()
      const res = await app.request('/', post(validOrderBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── POST / (XML) ──────────────────────────────────────────────────────────

  describe('POST / — create order (XML body)', () => {
    it('returns 201 with order data when a valid XML body is sent', async () => {
      const move = makeMove()
      mockMovesRepo.createMove.mockResolvedValue(move)
      const app = buildApp()
      const res = await app.request('/', xmlPost(validOrderBody))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('move-id-1')
    })

    it('passes parsed XML fields to createMove correctly', async () => {
      mockMovesRepo.createMove.mockResolvedValue(makeMove())
      const app = buildApp()
      await app.request('/', xmlPost(validOrderBody))
      expect(mockMovesRepo.createMove).toHaveBeenCalledWith(
        expect.anything(),
        'test-tenant-id',
        expect.objectContaining({
          userId: 'user-1',
          scheduledDate: new Date(validOrderBody.scheduledDate),
          origin: expect.objectContaining({ line1: '123 Main St' }),
          destination: expect.objectContaining({ line1: '456 Oak Ave' }),
        }),
      )
    })

    it('returns 400 VALIDATION_ERROR when XML body is missing userId', async () => {
      const app = buildApp()
      const { userId: _u, ...body } = validOrderBody
      const res = await app.request('/', xmlPost(body))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when XML body is malformed', async () => {
      const app = buildApp()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<unclosed',
      })
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('accepts text/xml content-type as well as application/xml', async () => {
      mockMovesRepo.createMove.mockResolvedValue(makeMove())
      const app = buildApp()
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: toXmlString(validOrderBody),
      })
      expect(res.status).toBe(201)
    })
  })
})
