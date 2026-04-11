// ---------------------------------------------------------------------------
// Unit tests for the customers handler
//
// All database calls are isolated via vi.mock('../repositories').
// hasPrimaryContact is overridden from the partial domain mock.
// No database connection required.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import { DomainError } from '@pegasus/domain'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'
import { customersHandler } from './customers'

vi.mock('../repositories', () => ({
  createCustomer: vi.fn(),
  findCustomerById: vi.fn(),
  listCustomers: vi.fn(),
  countCustomers: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  createContact: vi.fn(),
  listQuotesByCustomerId: vi.fn(),
}))

import type * as Domain from '@pegasus/domain'

vi.mock('@pegasus/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof Domain>()
  return { ...actual, hasPrimaryContact: vi.fn() }
})

import {
  createCustomer,
  findCustomerById,
  listCustomers,
  countCustomers,
  updateCustomer,
  deleteCustomer,
  createContact,
  listQuotesByCustomerId,
} from '../repositories'
import { hasPrimaryContact } from '@pegasus/domain'

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
  app.route('/', customersHandler)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockCustomer = {
  id: 'cust-1',
  tenantId: 'test-tenant-id',
  userId: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  contacts: [
    {
      id: 'c-1',
      customerId: 'cust-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      isPrimary: true,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const validCreateBody = {
  userId: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  primaryContact: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('customers handler', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 201 with the created customer', async () => {
      vi.mocked(createCustomer).mockResolvedValue(mockCustomer as never)
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['id']).toBe('cust-1')
    })

    it('returns 400 VALIDATION_ERROR when firstName is missing', async () => {
      const { firstName: _f, ...bodyWithout } = validCreateBody
      const res = await buildApp().request('/', post(bodyWithout))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(createCustomer).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })

    it('returns 422 with DomainError code when repository throws DomainError', async () => {
      vi.mocked(createCustomer).mockRejectedValue(new DomainError('Email already exists', 'DUPLICATE_EMAIL'))
      const res = await buildApp().request('/', post(validCreateBody))
      expect(res.status).toBe(422)
      const body = await json(res)
      expect(body.code).toBe('DUPLICATE_EMAIL')
      expect(body.error).toBe('Email already exists')
    })
  })

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with customer list and meta.total', async () => {
      vi.mocked(listCustomers).mockResolvedValue([mockCustomer] as never)
      vi.mocked(countCustomers).mockResolvedValue(10 as never)
      const res = await buildApp().request('/')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as unknown[]).length).toBe(1)
      const meta = body.meta as { total: number; count: number; limit: number; offset: number }
      expect(meta.total).toBe(10)
      expect(meta.count).toBe(1)
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(listCustomers).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 when found', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(mockCustomer as never)
      const res = await buildApp().request('/cust-1')
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when customer does not exist', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(null)
      const res = await buildApp().request('/cust-1')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(findCustomerById).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/cust-1')
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── PUT /:id ──────────────────────────────────────────────────────────────

  describe('PUT /:id', () => {
    it('returns 200 with updated customer', async () => {
      vi.mocked(updateCustomer).mockResolvedValue(mockCustomer as never)
      const res = await buildApp().request('/cust-1', put({ firstName: 'John' }))
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when updateCustomer returns null', async () => {
      vi.mocked(updateCustomer).mockResolvedValue(null)
      const res = await buildApp().request('/cust-1', put({ firstName: 'John' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when email is invalid', async () => {
      const res = await buildApp().request('/cust-1', put({ email: 'not-an-email' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(updateCustomer).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/cust-1', put({ firstName: 'John' }))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────

  describe('DELETE /:id', () => {
    it('returns 204 on success', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(mockCustomer as never)
      vi.mocked(deleteCustomer).mockResolvedValue(undefined as never)
      const res = await buildApp().request('/cust-1', { method: 'DELETE' })
      expect(res.status).toBe(204)
    })

    it('returns 404 NOT_FOUND when customer does not exist', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(null)
      const res = await buildApp().request('/cust-1', { method: 'DELETE' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 500 INTERNAL_ERROR on DB error', async () => {
      vi.mocked(findCustomerById).mockRejectedValue(new Error('db error'))
      const res = await buildApp().request('/cust-1', { method: 'DELETE' })
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('INTERNAL_ERROR')
    })
  })

  // ── POST /:id/contacts ────────────────────────────────────────────────────

  describe('POST /:id/contacts', () => {
    const validContact = { firstName: 'Bob', lastName: 'Smith', email: 'bob@example.com' }
    const mockContact = { id: 'c-2', customerId: 'cust-1', ...validContact, isPrimary: false }

    it('returns 201 with the new contact', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(mockCustomer as never)
      vi.mocked(createContact).mockResolvedValue(mockContact as never)
      const res = await buildApp().request('/cust-1/contacts', post(validContact))
      expect(res.status).toBe(201)
    })

    it('returns 404 when customer not found', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(null)
      const res = await buildApp().request('/cust-1/contacts', post(validContact))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR when email is missing', async () => {
      const res = await buildApp().request(
        '/cust-1/contacts',
        post({ firstName: 'Bob', lastName: 'Smith' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })

  // ── GET /:customerId/quotes ───────────────────────────────────────────────

  describe('GET /:customerId/quotes', () => {
    it('returns 200 with quote list when customer has primary contact', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(mockCustomer as never)
      vi.mocked(hasPrimaryContact).mockReturnValue(true)
      vi.mocked(listQuotesByCustomerId).mockResolvedValue([] as never)
      const res = await buildApp().request('/cust-1/quotes')
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when customer does not exist', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(null)
      const res = await buildApp().request('/cust-1/quotes')
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when customer has no primary contact', async () => {
      vi.mocked(findCustomerById).mockResolvedValue(mockCustomer as never)
      vi.mocked(hasPrimaryContact).mockReturnValue(false)
      const res = await buildApp().request('/cust-1/quotes')
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })
  })
})
