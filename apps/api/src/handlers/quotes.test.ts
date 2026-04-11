// ---------------------------------------------------------------------------
// Unit tests for the quotes handler
//
// All database calls are isolated via vi.mock('../repositories').
// canFinalizeQuote is overridden from the partial domain mock.
// No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { quotesHandler } from './quotes'

vi.mock('../repositories', () => ({
  createQuote: vi.fn(),
  findQuoteById: vi.fn(),
  listQuotes: vi.fn(),
  addLineItem: vi.fn(),
  finalizeQuote: vi.fn(),
}))

import type * as Domain from '@pegasus/domain'

vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>()
  return { ...actual, canFinalizeQuote: vi.fn() }
})

import { createQuote, findQuoteById, listQuotes, addLineItem, finalizeQuote } from '../repositories'
import { canFinalizeQuote } from '@pegasus/domain'

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
  app.route('/', quotesHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockDraftQuote = {
  id: 'quote-1',
  moveId: 'move-1',
  tenantId: 'test-tenant-id',
  status: 'DRAFT',
  price: { amount: 1500, currency: 'USD' },
  validUntil: new Date(Date.now() + 86_400_000),
  lineItems: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockLineItem = {
  id: 'li-1',
  quoteId: 'quote-1',
  description: 'Standard move service',
  quantity: 1,
  unitPrice: { amount: 1500, currency: 'USD' },
}

const validCreateBody = {
  moveId: 'move-1',
  priceAmount: 1500,
  validUntil: '2027-01-01T00:00:00.000Z',
}

const validLineItemBody = {
  description: 'Standard move service',
  quantity: 1,
  unitPrice: 1500,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('quotes handler', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 201 with the created quote', async () => {
      vi.mocked(createQuote).mockResolvedValue(mockDraftQuote as never)
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(201)
      expect((await json(res)).data).toBeTruthy()
    })

    it('returns 400 VALIDATION_ERROR when moveId is missing', async () => {
      const { moveId: _m, ...body } = validCreateBody
      const res = await buildApp().request('/', post(body))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(createQuote).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })

    it('returns 422 with DomainError code when repository throws DomainError', async () => {
      vi.mocked(createQuote).mockRejectedValue(new DomainError('Quote exceeds limit', 'QUOTE_LIMIT_EXCEEDED'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('QUOTE_LIMIT_EXCEEDED')
      expect(body.error).toBe('Quote exceeds limit')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with quote list', async () => {
      vi.mocked(listQuotes).mockResolvedValue([mockDraftQuote] as never)
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as unknown[]).length).toBe(1)
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 when found', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(mockDraftQuote as never)
      const res = await buildApp().request('/quote-1')
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when quote does not exist', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(null)
      const res = await buildApp().request('/quote-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST /:id/line-items ──────────────────────────────────────────────────

  describe('POST /:id/line-items', () => {
    it('returns 201 with the new line item', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(mockDraftQuote as never)
      vi.mocked(addLineItem).mockResolvedValue(mockLineItem as never)
      const res = await buildApp().request('/quote-1/line-items', post(validLineItemBody))
      expect(res.status).toBe(201)
    })

    it('returns 404 NOT_FOUND when quote does not exist', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(null)
      const res = await buildApp().request('/quote-1/line-items', post(validLineItemBody))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when quote is not DRAFT', async () => {
      vi.mocked(findQuoteById).mockResolvedValue({ ...mockDraftQuote, status: 'SENT' } as never)
      const res = await buildApp().request('/quote-1/line-items', post(validLineItemBody))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 400 VALIDATION_ERROR when description is missing', async () => {
      const res = await buildApp().request(
        '/quote-1/line-items',
        post({ quantity: 1, unitPrice: 100 }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })

  // ── POST /:id/finalize ────────────────────────────────────────────────────

  describe('POST /:id/finalize', () => {
    it('returns 200 with the finalized quote', async () => {
      const draftWithItems = { ...mockDraftQuote, lineItems: [mockLineItem] }
      vi.mocked(findQuoteById).mockResolvedValue(draftWithItems as never)
      vi.mocked(canFinalizeQuote).mockReturnValue(true)
      vi.mocked(finalizeQuote).mockResolvedValue({ ...draftWithItems, status: 'SENT' } as never)
      const res = await buildApp().request('/quote-1/finalize', post(null))
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when quote does not exist', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(null)
      const res = await buildApp().request('/quote-1/finalize', post(null))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when quote is not DRAFT', async () => {
      vi.mocked(findQuoteById).mockResolvedValue({ ...mockDraftQuote, status: 'SENT' } as never)
      const res = await buildApp().request('/quote-1/finalize', post(null))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 INVALID_STATE when canFinalizeQuote is false (no line items)', async () => {
      vi.mocked(findQuoteById).mockResolvedValue(mockDraftQuote as never)
      vi.mocked(canFinalizeQuote).mockReturnValue(false)
      const res = await buildApp().request('/quote-1/finalize', post(null))
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })
  })
})
