// ---------------------------------------------------------------------------
// Unit tests for the billing handler
//
// All database calls are isolated via vi.mock('../repositories').
// calculateInvoiceBalance is overridden from the partial domain mock so
// the spread into the response shape is predictable.
// No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { billingHandler } from './billing'

vi.mock('../repositories', () => ({
  findMoveById: vi.fn(),
  findAcceptedQuoteByMoveId: vi.fn(),
  findInvoiceByMoveId: vi.fn(),
  findInvoiceById: vi.fn(),
  listInvoices: vi.fn(),
  createInvoice: vi.fn(),
  recordPayment: vi.fn(),
}))

import type * as Domain from '@pegasus/domain'

vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>()
  return { ...actual, calculateInvoiceBalance: vi.fn() }
})

import {
  findMoveById,
  findAcceptedQuoteByMoveId,
  findInvoiceByMoveId,
  findInvoiceById,
  listInvoices,
  createInvoice,
  recordPayment,
} from '../repositories'
import { calculateInvoiceBalance } from '@pegasus/domain'

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
  app.route('/', billingHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBalance = { amount: 1000, currency: 'USD' }

const mockMove = { id: 'move-1', tenantId: 'test-tenant-id', status: 'COMPLETED' }

const mockAcceptedQuote = {
  id: 'quote-1',
  moveId: 'move-1',
  status: 'ACCEPTED',
  price: { amount: 1000, currency: 'USD' },
}

const mockInvoice = {
  id: 'inv-1',
  moveId: 'move-1',
  tenantId: 'test-tenant-id',
  status: 'ISSUED',
  total: { amount: 1000, currency: 'USD' },
  payments: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('billing handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(calculateInvoiceBalance).mockReturnValue(mockBalance as never)
  })

  // ── POST / (generate invoice) ─────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 404 NOT_FOUND when move does not exist', async () => {
      vi.mocked(findMoveById).mockResolvedValue(null)
      const res = await buildApp().request('/', post({ moveId: 'move-1' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 409 CONFLICT when invoice already exists for the move', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findInvoiceByMoveId).mockResolvedValue(mockInvoice as never)
      const res = await buildApp().request('/', post({ moveId: 'move-1' }))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 422 PRECONDITION_FAILED when no accepted quote found', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findInvoiceByMoveId).mockResolvedValue(null)
      vi.mocked(findAcceptedQuoteByMoveId).mockResolvedValue(null)
      const res = await buildApp().request('/', post({ moveId: 'move-1' }))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('PRECONDITION_FAILED')
    })

    it('returns 422 with DomainError code when repository throws DomainError', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findInvoiceByMoveId).mockResolvedValue(null)
      vi.mocked(findAcceptedQuoteByMoveId).mockResolvedValue(mockAcceptedQuote as never)
      vi.mocked(createInvoice).mockRejectedValue(new DomainError('Invoice total mismatch', 'TOTAL_MISMATCH'))
      const res = await buildApp().request('/', post({ moveId: 'move-1' }))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('TOTAL_MISMATCH')
      expect(body.error).toBe('Invoice total mismatch')
    })

    it('returns 201 with invoice and balance on success', async () => {
      vi.mocked(findMoveById).mockResolvedValue(mockMove as never)
      vi.mocked(findInvoiceByMoveId).mockResolvedValue(null)
      vi.mocked(findAcceptedQuoteByMoveId).mockResolvedValue(mockAcceptedQuote as never)
      vi.mocked(createInvoice).mockResolvedValue(mockInvoice as never)
      const res = await buildApp().request('/', post({ moveId: 'move-1' }))
      expect(res.status).toBe(201)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['id']).toBe('inv-1')
      expect(data['balance']).toEqual(mockBalance)
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with invoice list', async () => {
      vi.mocked(listInvoices).mockResolvedValue([mockInvoice] as never)
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      expect((await json(res)).data).toBeTruthy()
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 with invoice and balance', async () => {
      vi.mocked(findInvoiceById).mockResolvedValue(mockInvoice as never)
      const res = await buildApp().request('/inv-1')
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody
      expect(data['balance']).toEqual(mockBalance)
    })

    it('returns 404 NOT_FOUND when invoice does not exist', async () => {
      vi.mocked(findInvoiceById).mockResolvedValue(null)
      const res = await buildApp().request('/inv-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST /:id/payments ────────────────────────────────────────────────────

  describe('POST /:id/payments', () => {
    const validPayment = { amount: 500, method: 'CARD' }
    const mockUpdatedInvoice = {
      ...mockInvoice,
      payments: [
        {
          id: 'pay-1',
          amount: { amount: 500, currency: 'USD' },
          method: 'CARD',
          paidAt: new Date(),
        },
      ],
    }

    it('returns 201 with updated invoice and balance', async () => {
      vi.mocked(findInvoiceById).mockResolvedValue(mockInvoice as never)
      vi.mocked(recordPayment).mockResolvedValue(mockUpdatedInvoice as never)
      const res = await buildApp().request('/inv-1/payments', post(validPayment))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['balance']).toEqual(mockBalance)
    })

    it('returns 404 NOT_FOUND when invoice does not exist', async () => {
      vi.mocked(findInvoiceById).mockResolvedValue(null)
      const res = await buildApp().request('/inv-1/payments', post(validPayment))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when method is invalid', async () => {
      const res = await buildApp().request(
        '/inv-1/payments',
        post({ amount: 500, method: 'CRYPTO' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })
})
