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
  countMoves: vi.fn(),
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
  countMoves,
  updateMoveStatus,
  assignCrewMember,
  assignVehicle,
  listQuotesByMoveId,
} from '../repositories'
import { canDispatch, canTransition } from '@pegasus/domain'
import { _clearAuthzCache } from '../lib/authz'

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

type TestPrincipal = {
  sub: string
  tenantId: string
  roleNames: string[]
  crewMemberId?: string
}

const ADMIN_PRINCIPAL: TestPrincipal = {
  sub: 'test-sub',
  tenantId: 'test-tenant-id',
  roleNames: ['tenant_admin'],
}

function buildApp(principal: TestPrincipal = ADMIN_PRINCIPAL) {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {} as unknown as PrismaClient)
    // requirePermission + the in-handler ReadMove ABAC check evaluate via the
    // offline Cedar backend (no policyStoreId set).
    c.set('principal', principal)
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
  beforeEach(() => {
    vi.clearAllMocks()
    // The authz decision cache keys on (sub, roles, action, resource) — clear
    // it between cases so an allow/deny for the same move id never bleeds across.
    _clearAuthzCache()
  })

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
    it('returns 200 with move list and meta.total', async () => {
      vi.mocked(listMoves).mockResolvedValue([mockMove] as never)
      vi.mocked(countMoves).mockResolvedValue(25 as never)
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as unknown[]).length).toBe(1)
      const meta = body.meta as { total: number; count: number; limit: number; offset: number }
      expect(meta.total).toBe(25)
      expect(meta.count).toBe(1)
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

  // ── driver persona — crew-scoped access ───────────────────────────────────

  describe('driver persona', () => {
    const linkedDriver: TestPrincipal = {
      sub: 'driver-sub',
      tenantId: 'test-tenant-id',
      roleNames: ['driver'],
      crewMemberId: 'crew-1',
    }
    const unlinkedDriver: TestPrincipal = {
      sub: 'driver-sub-2',
      tenantId: 'test-tenant-id',
      roleNames: ['driver'],
    }

    it('GET / scopes the list to the driver crew member', async () => {
      vi.mocked(listMoves).mockResolvedValue([] as never)
      vi.mocked(countMoves).mockResolvedValue(0 as never)
      const res = await buildApp(linkedDriver).request('/')
      expect(res.status).toBe(200)
      expect(listMoves).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ crewMemberId: 'crew-1' }),
      )
      expect(countMoves).toHaveBeenCalledWith(expect.anything(), 'crew-1')
    })

    it('GET / fails closed with a sentinel for an unlinked driver', async () => {
      vi.mocked(listMoves).mockResolvedValue([] as never)
      vi.mocked(countMoves).mockResolvedValue(0 as never)
      const res = await buildApp(unlinkedDriver).request('/')
      expect(res.status).toBe(200)
      expect(countMoves).toHaveBeenCalledWith(expect.anything(), '__none__')
    })

    it('GET /:id returns 200 for a move the driver is assigned to', async () => {
      vi.mocked(findMoveById).mockResolvedValue({
        ...mockMove,
        assignedCrewIds: ['crew-1'],
      } as never)
      const res = await buildApp(linkedDriver).request('/move-1')
      expect(res.status).toBe(200)
    })

    it('GET /:id returns 404 for a move the driver is not assigned to', async () => {
      vi.mocked(findMoveById).mockResolvedValue({
        ...mockMove,
        assignedCrewIds: ['crew-x'],
      } as never)
      const res = await buildApp(linkedDriver).request('/move-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('GET /:id returns 404 for an unlinked driver', async () => {
      vi.mocked(findMoveById).mockResolvedValue({
        ...mockMove,
        assignedCrewIds: ['crew-1'],
      } as never)
      const res = await buildApp(unlinkedDriver).request('/move-1')
      expect(res.status).toBe(404)
    })

    it('POST / is forbidden for a driver (no CreateMove)', async () => {
      const res = await buildApp(linkedDriver).request('/', post(validCreateBody))
      expect(res.status).toBe(403)
    })

    it('PUT /:id/status is forbidden for a driver (no UpdateMove)', async () => {
      const res = await buildApp(linkedDriver).request(
        '/move-1/status',
        put({ status: 'SCHEDULED' }),
      )
      expect(res.status).toBe(403)
    })
  })
})
