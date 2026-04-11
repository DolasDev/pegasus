// ---------------------------------------------------------------------------
// Unit tests for the moves handler
//
// canTransition and canDispatch are overridden from the partial domain mock
// so each test can control which branch is taken without real domain logic.
// No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { movesHandler } from './moves'

vi.mock('../repositories', () => ({
  createMove: vi.fn(),
  findMoveById: vi.fn(),
  listMoves: vi.fn(),
  updateMoveStatus: vi.fn(),
  assignCrewMember: vi.fn(),
  assignVehicle: vi.fn(),
  listQuotesByMoveId: vi.fn(),
}))

import type * as Domain from '@pegasus/domain'

vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>()
  return { ...actual, canDispatch: vi.fn(), canTransition: vi.fn() }
})

import {
  createMove,
  findMoveById,
  listMoves,
  updateMoveStatus,
  assignCrewMember,
  assignVehicle,
  listQuotesByMoveId,
} from '../repositories'
import { canDispatch, canTransition } from '@pegasus/domain'

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

function put(body: unknown): RequestInit {
  return {
    method: 'PUT',
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
  app.route('/', movesHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockAddress = {
  id: 'addr-1',
  line1: '123 Main St',
  city: 'Portland',
  state: 'OR',
  postalCode: '97201',
  country: 'US',
}

const mockMove = {
  id: 'move-1',
  tenantId: 'test-tenant-id',
  userId: 'user-1',
  status: 'PENDING',
  origin: mockAddress,
  destination: { ...mockAddress, id: 'addr-2', line1: '456 Oak Ave', city: 'Seattle', state: 'WA' },
  scheduledDate: new Date('2026-03-01'),
  assignedCrewIds: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const validCreateBody = {
  userId: 'user-1',
  scheduledDate: '2026-03-01T00:00:00.000Z',
  origin: {
    line1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postalCode: '97201',
    country: 'US',
  },
  destination: {
    line1: '456 Oak Ave',
    city: 'Seattle',
    state: 'WA',
    postalCode: '98101',
    country: 'US',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('moves handler', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 201 with the created move', async () => {
      vi.mocked(createMove).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(201)
      expect((await json(res)).data).toBeTruthy()
    })

    it('returns 400 VALIDATION_ERROR when scheduledDate is missing', async () => {
      const { scheduledDate: _s, ...body } = validCreateBody
      const res = await buildApp().request('/', post(body))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(createMove).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })

    it('returns 422 with DomainError code when repository throws DomainError', async () => {
      vi.mocked(createMove).mockRejectedValue(new DomainError('Invalid move date', 'INVALID_DATE'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('INVALID_DATE')
      expect(body.error).toBe('Invalid move date')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with move list', async () => {
      vi.mocked(listMoves).mockResolvedValue([mockMove] as never)
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      expect((await json(res)).data).toBeTruthy()
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(listMoves).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 when found', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/move-1')
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(findMoveById).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/move-1')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── PUT /:id/status ───────────────────────────────────────────────────────

  describe('PUT /:id/status', () => {
    it('returns 200 on valid transition', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(canTransition).mockReturnValue(true)
      vi.mocked(canDispatch).mockReturnValue(true)
      vi.mocked(updateMoveStatus).mockResolvedValue({ ...mockMove, status: 'SCHEDULED' } as never)
      const res = await buildApp().request('/move-1/status', put({ status: 'SCHEDULED' }))
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/status', put({ status: 'SCHEDULED' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when canTransition returns false', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(canTransition).mockReturnValue(false)
      const res = await buildApp().request('/move-1/status', put({ status: 'COMPLETED' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 PRECONDITION_FAILED when transitioning to IN_PROGRESS without crew', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(canTransition).mockReturnValue(true)
      vi.mocked(canDispatch).mockReturnValue(false)
      const res = await buildApp().request('/move-1/status', put({ status: 'IN_PROGRESS' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('PRECONDITION_FAILED')
    })
  })

  // ── POST /:id/crew ────────────────────────────────────────────────────────

  describe('POST /:id/crew', () => {
    it('returns 200 when crew assigned successfully', async () => {
      vi.mocked(assignCrewMember).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/move-1/crew', post({ crewMemberId: 'crew-1' }))
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when assignCrewMember returns null', async () => {
      vi.mocked(assignCrewMember).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/crew', post({ crewMemberId: 'crew-1' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST /:id/vehicles ────────────────────────────────────────────────────

  describe('POST /:id/vehicles', () => {
    it('returns 200 when vehicle assigned successfully', async () => {
      vi.mocked(assignVehicle).mockResolvedValue(mockMove as never)
      const res = await buildApp().request('/move-1/vehicles', post({ vehicleId: 'vehicle-1' }))
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when assignVehicle returns null', async () => {
      vi.mocked(assignVehicle).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/vehicles', post({ vehicleId: 'vehicle-1' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── GET /:moveId/quotes ───────────────────────────────────────────────────

  describe('GET /:moveId/quotes', () => {
    it('returns 200 with quote list', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(listQuotesByMoveId).mockResolvedValue([] as never)
      const res = await buildApp().request('/move-1/quotes')
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/move-1/quotes')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })
})
