// ---------------------------------------------------------------------------
// Unit tests for the inventory handler
//
// All database calls are isolated via vi.mock('../repositories').
// roomTotalValue is overridden from the partial domain mock.
// No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { inventoryHandler } from './inventory'

vi.mock('../repositories', () => ({
  findMoveById: vi.fn(),
  createRoom: vi.fn(),
  findRoomById: vi.fn(),
  listRoomsByMoveId: vi.fn(),
  countRoomsByMoveId: vi.fn(),
  addItem: vi.fn(),
}))

import type * as Domain from '@pegasus/domain'

vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>()
  return { ...actual, roomTotalValue: vi.fn() }
})

import {
  findMoveById,
  createRoom,
  findRoomById,
  listRoomsByMoveId,
  countRoomsByMoveId,
  addItem,
} from '../repositories'
import { roomTotalValue } from '@pegasus/domain'

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

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {} as unknown as PrismaClient)
    await next()
  })
  app.route('/', inventoryHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockMove = { id: 'move-1', tenantId: 'test-tenant-id', status: 'IN_PROGRESS' }

const mockRoom = {
  id: 'room-1',
  moveId: 'move-1',
  tenantId: 'test-tenant-id',
  name: 'Living Room',
  items: [],
}

const mockItem = {
  id: 'item-1',
  roomId: 'room-1',
  name: 'Sofa',
  quantity: 1,
}

const mockTotalValue = { amount: 0, currency: 'USD' }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('inventory handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(roomTotalValue).mockReturnValue(mockTotalValue as never)
  })

  // ── POST /:moveId/rooms ───────────────────────────────────────────────────

  describe('POST /:moveId/rooms', () => {
    it('returns 201 with the created room', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(createRoom).mockResolvedValue(mockRoom as never)
      const res = await buildApp().request('/move-1/rooms', post({ name: 'Living Room' }))
      expect(res.status).toBe(201)
      expect((await json(res)).data).toBeTruthy()
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/rooms', post({ name: 'Living Room' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when name is missing', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/move-1/rooms', post({}))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 422 with DomainError code when repository throws DomainError', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(createRoom).mockRejectedValue(new DomainError('Room limit exceeded', 'ROOM_LIMIT'))
      const res = await buildApp().request('/move-1/rooms', post({ name: 'Living Room' }))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('ROOM_LIMIT')
      expect(body.error).toBe('Room limit exceeded')
    })
  })

  // ── GET /:moveId/inventory ────────────────────────────────────────────────

  describe('GET /:moveId/inventory', () => {
    it('returns 200 with rooms, totalValue, and meta.total', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(listRoomsByMoveId).mockResolvedValue([mockRoom] as never)
      vi.mocked(countRoomsByMoveId).mockResolvedValue(3 as never)
      const res = await buildApp().request('/move-1/inventory')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['totalValue']).toEqual(mockTotalValue)
      const meta = body.meta as { total: number; count: number }
      expect(meta.total).toBe(3)
      expect(meta.count).toBe(1)
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/inventory')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST /:moveId/rooms/:roomId/items ─────────────────────────────────────

  describe('POST /:moveId/rooms/:roomId/items', () => {
    const validItem = { name: 'Sofa' }

    it('returns 201 with the created item', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findRoomById).mockResolvedValue(mockRoom as never)
      vi.mocked(addItem).mockResolvedValue(mockItem as never)
      const res = await buildApp().request('/move-1/rooms/room-1/items', post(validItem))
      expect(res.status).toBe(201)
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/rooms/room-1/items', post(validItem))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 404 NOT_FOUND when room does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findRoomById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/rooms/room-1/items', post(validItem))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when item name is missing', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/move-1/rooms/room-1/items', post({}))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })
})
