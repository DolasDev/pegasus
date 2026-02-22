/**
 * Handler-layer tests for all Hono routes.
 *
 * The repository layer is fully mocked so no database is required.
 * These tests verify HTTP status codes, response shapes, validation,
 * and business-rule enforcement performed within the handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the repository module — hoisted above imports by vitest
// ---------------------------------------------------------------------------
// Bypass the tenant middleware — repositories are fully mocked so the db value
// passed via context is never used. We just need tenantId and db to be set.
vi.mock('./middleware/tenant', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', {})
    await next()
  },
}))

// Bypass admin JWT verification — sets the admin identity claims directly.
vi.mock('./middleware/admin-auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminAuthMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('adminSub', 'test-admin-sub')
    c.set('adminEmail', 'admin@test.com')
    await next()
  },
}))

// Mock the base Prisma client used by admin routes directly (not via repositories).
// $transaction receives a callback and invokes it with a mock transaction client
// so handler code that uses the interactive transaction form still works.
vi.mock('./db', () => {
  const txClient = {
    tenant: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  }
  return {
    db: {
      tenant: {
        findMany: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(txClient)),
      _txClient: txClient, // exposed so tests can configure tx-level mocks
    },
  }
})

vi.mock('./repositories', () => ({
  // customer
  createCustomer: vi.fn(),
  findCustomerById: vi.fn(),
  findCustomerByEmail: vi.fn(),
  listCustomers: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  createContact: vi.fn(),
  listQuotesByCustomerId: vi.fn(),
  // move
  createMove: vi.fn(),
  findMoveById: vi.fn(),
  listMoves: vi.fn(),
  listMovesByStatus: vi.fn(),
  updateMoveStatus: vi.fn(),
  assignCrewMember: vi.fn(),
  assignVehicle: vi.fn(),
  listQuotesByMoveId: vi.fn(),
  // quote
  createQuote: vi.fn(),
  findQuoteById: vi.fn(),
  addLineItem: vi.fn(),
  finalizeQuote: vi.fn(),
  findAcceptedQuoteByMoveId: vi.fn(),
  // inventory
  createRoom: vi.fn(),
  findRoomById: vi.fn(),
  listRoomsByMoveId: vi.fn(),
  addItem: vi.fn(),
  // billing
  findInvoiceByMoveId: vi.fn(),
  findInvoiceById: vi.fn(),
  createInvoice: vi.fn(),
  recordPayment: vi.fn(),
}))

import { app } from './app'
import * as repos from './repositories'
import { db } from './db'
import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Shared mock fixtures
// ---------------------------------------------------------------------------

const mockAddress = {
  id: 'addr-1',
  line1: '123 Main St',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
}

const mockContact = {
  id: 'contact-1',
  customerId: 'cust-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  isPrimary: true as const,
}

const mockCustomer = {
  id: 'cust-1',
  userId: 'user-1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  contacts: [mockContact],
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

const mockMove = {
  id: 'move-1',
  userId: 'user-1',
  status: 'PENDING' as const,
  origin: { ...mockAddress, id: 'addr-origin' },
  destination: { ...mockAddress, id: 'addr-dest', line1: '456 Oak Ave' },
  scheduledDate: new Date('2025-06-01T10:00:00Z'),
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  stops: [],
  assignedCrewIds: [],
  assignedVehicleIds: [],
}

const mockMoveWithCrew = {
  ...mockMove,
  status: 'SCHEDULED' as const,
  assignedCrewIds: ['crew-1'],
}

const mockQuote = {
  id: 'quote-1',
  moveId: 'move-1',
  status: 'DRAFT' as const,
  price: { amount: 1500, currency: 'USD' },
  validUntil: new Date('2025-07-01T00:00:00Z'),
  createdAt: new Date('2025-01-01T00:00:00Z'),
  lineItems: [] as unknown[],
}

const mockQuoteWithLineItem = {
  ...mockQuote,
  lineItems: [
    {
      id: 'li-1',
      quoteId: 'quote-1',
      description: 'Labor',
      quantity: 2,
      unitPrice: { amount: 750, currency: 'USD' },
    },
  ],
}

const mockAcceptedQuote = {
  ...mockQuoteWithLineItem,
  status: 'ACCEPTED' as const,
}

const mockRoom = {
  id: 'room-1',
  name: 'Living Room',
  items: [],
}

const mockInvoice = {
  id: 'inv-1',
  moveId: 'move-1',
  status: 'UNPAID' as const,
  total: { amount: 1500, currency: 'USD' },
  payments: [],
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
}

// ---------------------------------------------------------------------------
// Reset all mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks()
  // vi.resetAllMocks() clears mockImplementation too, so we must re-establish
  // the $transaction stub after each reset. The handler passes a callback that
  // receives the transaction client; we forward it to the exposed _txClient so
  // individual tests can configure tenant.create / auditLog.create on it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(db.$transaction as any).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn((db as any)._txClient),
  )
})

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns 200 with status ok and a timestamp', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('ok')
    expect(typeof body['timestamp']).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------

describe('Unknown routes', () => {
  it('returns 404 for an unrecognised path', async () => {
    const res = await app.request('/not-a-real-route')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

describe('POST /customers', () => {
  it('returns 201 with the created customer', async () => {
    vi.mocked(repos.createCustomer).mockResolvedValue(mockCustomer as never)

    const res = await app.request('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-1',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        primaryContact: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['id']).toBe('cust-1')
  })

  it('returns 400 for a missing required field', async () => {
    const res = await app.request('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Jane' }), // missing email, lastName, userId, primaryContact
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })
})

describe('GET /customers', () => {
  it('returns 200 with an empty list', async () => {
    vi.mocked(repos.listCustomers).mockResolvedValue([])

    const res = await app.request('/api/v1/customers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
    expect((body['data'] as unknown[]).length).toBe(0)
  })

  it('returns the customer list with pagination meta', async () => {
    vi.mocked(repos.listCustomers).mockResolvedValue([mockCustomer] as never)

    const res = await app.request('/api/v1/customers?limit=10&offset=0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as unknown[]).length).toBe(1)
    expect((body['meta'] as Record<string, unknown>)['count']).toBe(1)
  })
})

describe('GET /customers/:id', () => {
  it('returns 200 with the customer', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(mockCustomer as never)

    const res = await app.request('/api/v1/customers/cust-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['email']).toBe('jane@example.com')
  })

  it('returns 404 when the customer is not found', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(null)

    const res = await app.request('/api/v1/customers/unknown')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('PUT /customers/:id', () => {
  it('returns 200 with the updated customer', async () => {
    const updated = { ...mockCustomer, firstName: 'Janet' }
    vi.mocked(repos.updateCustomer).mockResolvedValue(updated as never)

    const res = await app.request('/api/v1/customers/cust-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Janet' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['firstName']).toBe('Janet')
  })

  it('returns 404 when the customer does not exist', async () => {
    vi.mocked(repos.updateCustomer).mockResolvedValue(null)

    const res = await app.request('/api/v1/customers/unknown', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'X' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /customers/:id', () => {
  it('returns 204 when the customer is deleted', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(mockCustomer as never)
    vi.mocked(repos.deleteCustomer).mockResolvedValue(undefined as never)

    const res = await app.request('/api/v1/customers/cust-1', { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('returns 404 when the customer is not found', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(null)

    const res = await app.request('/api/v1/customers/unknown', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /customers/:id/contacts', () => {
  it('returns 201 with the created contact', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(mockCustomer as never)
    vi.mocked(repos.createContact).mockResolvedValue(mockContact as never)

    const res = await app.request('/api/v1/customers/cust-1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'John', lastName: 'Doe', email: 'john@example.com' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['data']).toBeDefined()
  })

  it('returns 404 when the parent customer is not found', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(null)

    const res = await app.request('/api/v1/customers/unknown/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'John', lastName: 'Doe', email: 'john@example.com' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when the contact body is invalid', async () => {
    const res = await app.request('/api/v1/customers/cust-1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'John' }), // missing lastName and email
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /customers/:customerId/quotes', () => {
  it('returns 200 with the quote list', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(mockCustomer as never)
    vi.mocked(repos.listQuotesByCustomerId).mockResolvedValue([mockQuote] as never)

    const res = await app.request('/api/v1/customers/cust-1/quotes')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
  })

  it('returns 404 when the customer is not found', async () => {
    vi.mocked(repos.findCustomerById).mockResolvedValue(null)

    const res = await app.request('/api/v1/customers/unknown/quotes')
    expect(res.status).toBe(404)
  })

  it('returns 422 when the customer has no primary contact', async () => {
    const noPrimary = { ...mockCustomer, contacts: [{ ...mockContact, isPrimary: false }] }
    vi.mocked(repos.findCustomerById).mockResolvedValue(noPrimary as never)

    const res = await app.request('/api/v1/customers/cust-1/quotes')
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })
})

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

describe('POST /moves', () => {
  it('returns 201 with the created move', async () => {
    vi.mocked(repos.createMove).mockResolvedValue(mockMove as never)

    const res = await app.request('/api/v1/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user-1',
        scheduledDate: '2025-06-01T10:00:00Z',
        origin: mockAddress,
        destination: { ...mockAddress, line1: '456 Oak Ave' },
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['id']).toBe('move-1')
  })

  it('returns 400 for an invalid body', async () => {
    const res = await app.request('/api/v1/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }), // missing scheduledDate, origin, destination
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })
})

describe('GET /moves', () => {
  it('returns 200 with an empty list', async () => {
    vi.mocked(repos.listMoves).mockResolvedValue([])

    const res = await app.request('/api/v1/moves')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
  })

  it('returns moves with pagination meta', async () => {
    vi.mocked(repos.listMoves).mockResolvedValue([mockMove] as never)

    const res = await app.request('/api/v1/moves?limit=20&offset=0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as unknown[]).length).toBe(1)
    expect((body['meta'] as Record<string, unknown>)['limit']).toBe(20)
  })
})

describe('GET /moves/:id', () => {
  it('returns 200 with the move', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)

    const res = await app.request('/api/v1/moves/move-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('PENDING')
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown-id')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('PUT /moves/:id/status', () => {
  it('returns 200 after a valid status transition (PENDING → SCHEDULED)', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    const scheduled = { ...mockMove, status: 'SCHEDULED' as const }
    vi.mocked(repos.updateMoveStatus).mockResolvedValue(scheduled as never)

    const res = await app.request('/api/v1/moves/move-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SCHEDULED' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('SCHEDULED')
  })

  it('returns 422 for an illegal state transition (PENDING → COMPLETED)', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)

    const res = await app.request('/api/v1/moves/move-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETED' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 422 when dispatching without crew (SCHEDULED → IN_PROGRESS)', async () => {
    const scheduledNoCrew = { ...mockMove, status: 'SCHEDULED' as const, assignedCrewIds: [] }
    vi.mocked(repos.findMoveById).mockResolvedValue(scheduledNoCrew as never)

    const res = await app.request('/api/v1/moves/move-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('PRECONDITION_FAILED')
  })

  it('returns 200 when dispatching with crew assigned (SCHEDULED → IN_PROGRESS)', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMoveWithCrew as never)
    const inProgress = { ...mockMoveWithCrew, status: 'IN_PROGRESS' as const }
    vi.mocked(repos.updateMoveStatus).mockResolvedValue(inProgress as never)

    const res = await app.request('/api/v1/moves/move-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SCHEDULED' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for an invalid status value', async () => {
    const res = await app.request('/api/v1/moves/move-1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'INVALID_STATUS' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })
})

describe('POST /moves/:id/crew', () => {
  it('returns 200 with the updated move', async () => {
    vi.mocked(repos.assignCrewMember).mockResolvedValue(mockMoveWithCrew as never)

    const res = await app.request('/api/v1/moves/move-1/crew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crewMemberId: 'crew-1' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['data']).toBeDefined()
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.assignCrewMember).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/crew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crewMemberId: 'crew-1' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /moves/:id/vehicles', () => {
  it('returns 200 with the updated move', async () => {
    const withVehicle = { ...mockMove, assignedVehicleIds: ['vehicle-1'] }
    vi.mocked(repos.assignVehicle).mockResolvedValue(withVehicle as never)

    const res = await app.request('/api/v1/moves/move-1/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId: 'vehicle-1' }),
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.assignVehicle).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleId: 'vehicle-1' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /moves/:moveId/quotes', () => {
  it('returns 200 with the quote list', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.listQuotesByMoveId).mockResolvedValue([mockQuote] as never)

    const res = await app.request('/api/v1/moves/move-1/quotes')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/quotes')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

describe('POST /quotes', () => {
  it('returns 201 with the created quote', async () => {
    vi.mocked(repos.createQuote).mockResolvedValue(mockQuote as never)

    const res = await app.request('/api/v1/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moveId: 'move-1',
        priceAmount: 1500,
        validUntil: '2025-07-01T00:00:00Z',
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['id']).toBe('quote-1')
  })

  it('returns 400 for an invalid body', async () => {
    const res = await app.request('/api/v1/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId: 'move-1' }), // missing priceAmount and validUntil
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })
})

describe('GET /quotes/:id', () => {
  it('returns 200 with the quote', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(mockQuote as never)

    const res = await app.request('/api/v1/quotes/quote-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('DRAFT')
  })

  it('returns 404 when the quote is not found', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(null)

    const res = await app.request('/api/v1/quotes/unknown')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('POST /quotes/:id/line-items', () => {
  it('returns 201 with the updated quote', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(mockQuote as never)
    vi.mocked(repos.addLineItem).mockResolvedValue(mockQuoteWithLineItem as never)

    const res = await app.request('/api/v1/quotes/quote-1/line-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Labor', quantity: 2, unitPrice: 750 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['data']).toBeDefined()
  })

  it('returns 422 when the quote is not in DRAFT status', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue({ ...mockQuote, status: 'SENT' } as never)

    const res = await app.request('/api/v1/quotes/quote-1/line-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Labor', quantity: 2, unitPrice: 750 }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 404 when the quote is not found', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(null)

    const res = await app.request('/api/v1/quotes/unknown/line-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Labor', quantity: 2, unitPrice: 750 }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for an invalid line item body', async () => {
    const res = await app.request('/api/v1/quotes/quote-1/line-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Labor' }), // missing quantity and unitPrice
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /quotes/:id/finalize', () => {
  it('returns 200 with the finalized quote', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(mockQuoteWithLineItem as never)
    vi.mocked(repos.finalizeQuote).mockResolvedValue({ ...mockQuoteWithLineItem, status: 'SENT' } as never)

    const res = await app.request('/api/v1/quotes/quote-1/finalize', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('SENT')
  })

  it('returns 422 when the quote has no line items', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(mockQuote as never) // empty lineItems

    const res = await app.request('/api/v1/quotes/quote-1/finalize', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 422 when the quote is already finalized (not DRAFT)', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue({ ...mockQuoteWithLineItem, status: 'SENT' } as never)

    const res = await app.request('/api/v1/quotes/quote-1/finalize', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 404 when the quote is not found', async () => {
    vi.mocked(repos.findQuoteById).mockResolvedValue(null)

    const res = await app.request('/api/v1/quotes/unknown/finalize', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('GET /moves/:moveId/inventory', () => {
  it('returns 200 with the room list', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.listRoomsByMoveId).mockResolvedValue([mockRoom] as never)

    const res = await app.request('/api/v1/moves/move-1/inventory')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
    expect((body['meta'] as Record<string, unknown>)['count']).toBe(1)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/inventory')
    expect(res.status).toBe(404)
  })
})

describe('POST /moves/:moveId/rooms', () => {
  it('returns 201 with the created room', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.createRoom).mockResolvedValue(mockRoom as never)

    const res = await app.request('/api/v1/moves/move-1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Living Room' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['name']).toBe('Living Room')
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Living Room' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when the room name is missing', async () => {
    const res = await app.request('/api/v1/moves/move-1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /moves/:moveId/rooms/:roomId/items', () => {
  it('returns 201 with the updated room including the new item', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.findRoomById).mockResolvedValue(mockRoom as never)
    const roomWithItem = {
      ...mockRoom,
      items: [{ id: 'item-1', roomId: 'room-1', name: 'Sofa', quantity: 1 }],
    }
    vi.mocked(repos.addItem).mockResolvedValue(roomWithItem as never)

    const res = await app.request('/api/v1/moves/move-1/rooms/room-1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sofa' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    const items = (body['data'] as Record<string, unknown>)['items'] as unknown[]
    expect(items).toHaveLength(1)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/unknown/rooms/room-1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sofa' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 when the room is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.findRoomById).mockResolvedValue(null)

    const res = await app.request('/api/v1/moves/move-1/rooms/unknown/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sofa' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when the item name is missing', async () => {
    const res = await app.request('/api/v1/moves/move-1/rooms/room-1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

describe('POST /invoices', () => {
  it('returns 201 with the created invoice and balance', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.findInvoiceByMoveId).mockResolvedValue(null)
    vi.mocked(repos.findAcceptedQuoteByMoveId).mockResolvedValue(mockAcceptedQuote as never)
    vi.mocked(repos.createInvoice).mockResolvedValue(mockInvoice as never)

    const res = await app.request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId: 'move-1' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect(data['id']).toBe('inv-1')
    expect((data['balance'] as Record<string, unknown>)['amount']).toBe(1500)
  })

  it('returns 404 when the move is not found', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(null)

    const res = await app.request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId: 'unknown' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 409 when an invoice already exists for the move', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.findInvoiceByMoveId).mockResolvedValue(mockInvoice as never)

    const res = await app.request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId: 'move-1' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('CONFLICT')
  })

  it('returns 422 when no accepted quote exists for the move', async () => {
    vi.mocked(repos.findMoveById).mockResolvedValue(mockMove as never)
    vi.mocked(repos.findInvoiceByMoveId).mockResolvedValue(null)
    vi.mocked(repos.findAcceptedQuoteByMoveId).mockResolvedValue(null)

    const res = await app.request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moveId: 'move-1' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('PRECONDITION_FAILED')
  })

  it('returns 400 for an invalid body', async () => {
    const res = await app.request('/api/v1/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // missing moveId
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /invoices/:id', () => {
  it('returns 200 with the invoice and balance', async () => {
    vi.mocked(repos.findInvoiceById).mockResolvedValue(mockInvoice as never)

    const res = await app.request('/api/v1/invoices/inv-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect(data['id']).toBe('inv-1')
    expect(data['balance']).toBeDefined()
  })

  it('returns 404 when the invoice is not found', async () => {
    vi.mocked(repos.findInvoiceById).mockResolvedValue(null)

    const res = await app.request('/api/v1/invoices/unknown')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

describe('POST /invoices/:id/payments', () => {
  it('returns 201 with the updated invoice and remaining balance', async () => {
    vi.mocked(repos.findInvoiceById).mockResolvedValue(mockInvoice as never)
    const paid = {
      ...mockInvoice,
      payments: [{ id: 'pay-1', invoiceId: 'inv-1', amount: { amount: 1500, currency: 'USD' }, method: 'CARD', paidAt: new Date() }],
    }
    vi.mocked(repos.recordPayment).mockResolvedValue(paid as never)

    const res = await app.request('/api/v1/invoices/inv-1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1500, method: 'CARD' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect((data['balance'] as Record<string, unknown>)['amount']).toBe(0)
  })

  it('returns 404 when the invoice is not found', async () => {
    vi.mocked(repos.findInvoiceById).mockResolvedValue(null)

    const res = await app.request('/api/v1/invoices/unknown/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500, method: 'CASH' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for an invalid payment body', async () => {
    const res = await app.request('/api/v1/invoices/inv-1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -100, method: 'INVALID_METHOD' }),
    })
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Admin — GET /api/admin/me
// ---------------------------------------------------------------------------

describe('GET /api/admin/me', () => {
  it('returns the admin identity from JWT claims', async () => {
    const res = await app.request('/api/admin/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect(data['sub']).toBe('test-admin-sub')
    expect(data['email']).toBe('admin@test.com')
  })
})

// ---------------------------------------------------------------------------
// Admin — POST /api/admin/tenants
// ---------------------------------------------------------------------------

const mockCreatedTenant = {
  id: 'tenant-new',
  name: 'Beta Movers',
  slug: 'beta',
  status: 'ACTIVE' as const,
  plan: 'STARTER' as const,
  contactName: null,
  contactEmail: null,
  ssoProviderConfig: null,
  createdAt: new Date('2025-06-01T00:00:00Z'),
  updatedAt: new Date('2025-06-01T00:00:00Z'),
  deletedAt: null,
}

// Typed accessor for the transaction-level mock client exposed by the db mock.
function getTxClient() {
  return (
    db as unknown as {
      _txClient: {
        tenant: {
          create: ReturnType<typeof vi.fn>
          update: ReturnType<typeof vi.fn>
          findUnique: ReturnType<typeof vi.fn>
        }
        auditLog: { create: ReturnType<typeof vi.fn> }
      }
    }
  )._txClient
}

describe('POST /api/admin/tenants', () => {
  it('returns 201 with the created tenant', async () => {
    // The handler uses db.$transaction which invokes its callback with _txClient.
    const tx = getTxClient()
    tx.tenant.create.mockResolvedValue(mockCreatedTenant)
    tx.auditLog.create.mockResolvedValue(undefined)

    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta Movers', slug: 'beta' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect(data['id']).toBe('tenant-new')
    expect(data['slug']).toBe('beta')
    expect('ssoProviderConfig' in data).toBe(true)
  })

  it('returns 400 when name is missing', async () => {
    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'beta' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when slug is missing', async () => {
    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta Movers' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when slug has invalid format (uppercase)', async () => {
    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta', slug: 'Beta' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when slug has invalid format (too short)', async () => {
    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Beta', slug: 'ab' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 409 when the slug is already taken', async () => {
    getTxClient().tenant.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    )

    const res = await app.request('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicate', slug: 'acme' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('CONFLICT')
  })
})

// ---------------------------------------------------------------------------
// Admin — GET /api/admin/tenants
// ---------------------------------------------------------------------------

const mockTenant = {
  id: 'tenant-1',
  name: 'Acme Movers',
  slug: 'acme',
  status: 'ACTIVE' as const,
  plan: 'STARTER' as const,
  contactName: 'Alice Admin',
  contactEmail: 'alice@acme.com',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  deletedAt: null,
}

describe('GET /api/admin/tenants', () => {
  it('returns 200 with an empty list when no tenants exist', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([])
    vi.mocked(db.tenant.count).mockResolvedValue(0)

    const res = await app.request('/api/admin/tenants')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(Array.isArray(body['data'])).toBe(true)
    expect((body['data'] as unknown[]).length).toBe(0)
    const meta = body['meta'] as Record<string, unknown>
    expect(meta['total']).toBe(0)
    expect(meta['limit']).toBe(50)
    expect(meta['offset']).toBe(0)
  })

  it('returns the tenant list with pagination meta', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([mockTenant] as never)
    vi.mocked(db.tenant.count).mockResolvedValue(1)

    const res = await app.request('/api/admin/tenants?limit=10&offset=0')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as unknown[]).length).toBe(1)
    const meta = body['meta'] as Record<string, unknown>
    expect(meta['total']).toBe(1)
    expect(meta['count']).toBe(1)
    expect(meta['limit']).toBe(10)
  })

  it('caps limit at 100', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([])
    vi.mocked(db.tenant.count).mockResolvedValue(0)

    const res = await app.request('/api/admin/tenants?limit=9999')
    expect(res.status).toBe(200)
    const meta = ((await res.json()) as Record<string, unknown>)['meta'] as Record<string, unknown>
    expect(meta['limit']).toBe(100)
  })

  it('filters by status when ?status= is provided', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([])
    vi.mocked(db.tenant.count).mockResolvedValue(0)

    const res = await app.request('/api/admin/tenants?status=SUSPENDED')
    expect(res.status).toBe(200)
    // Verify findMany was called with the status filter
    expect(vi.mocked(db.tenant.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'SUSPENDED' } }),
    )
  })

  it('returns 400 for an invalid status value', async () => {
    const res = await app.request('/api/admin/tenants?status=INVALID')
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('includes OFFBOARDED tenants when ?includeOffboarded=true', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([])
    vi.mocked(db.tenant.count).mockResolvedValue(0)

    const res = await app.request('/api/admin/tenants?includeOffboarded=true')
    expect(res.status).toBe(200)
    expect(vi.mocked(db.tenant.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    )
  })
})

// ---------------------------------------------------------------------------
// Admin — GET /api/admin/tenants/:id
// ---------------------------------------------------------------------------

describe('GET /api/admin/tenants/:id', () => {
  it('returns 200 with the tenant detail', async () => {
    const detail = { ...mockTenant, ssoProviderConfig: null }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(detail as never)

    const res = await app.request('/api/admin/tenants/tenant-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    const data = body['data'] as Record<string, unknown>
    expect(data['id']).toBe('tenant-1')
    expect(data['slug']).toBe('acme')
    expect('ssoProviderConfig' in data).toBe(true)
  })

  it('returns 404 when the tenant is not found', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)

    const res = await app.request('/api/admin/tenants/unknown-id')
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Admin — PATCH /api/admin/tenants/:id
// ---------------------------------------------------------------------------

const mockTenantDetail = { ...mockTenant, ssoProviderConfig: null }

describe('PATCH /api/admin/tenants/:id', () => {
  it('returns 200 with the updated tenant', async () => {
    const tx = getTxClient()
    tx.tenant.findUnique.mockResolvedValue(mockTenantDetail)
    const updated = { ...mockTenantDetail, name: 'Acme Movers LLC' }
    tx.tenant.update.mockResolvedValue(updated)
    tx.auditLog.create.mockResolvedValue(undefined)

    const res = await app.request('/api/admin/tenants/tenant-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Movers LLC' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['name']).toBe('Acme Movers LLC')
  })

  it('returns 200 and clears contactEmail when passed null', async () => {
    const tx = getTxClient()
    tx.tenant.findUnique.mockResolvedValue(mockTenantDetail)
    const updated = { ...mockTenantDetail, contactEmail: null }
    tx.tenant.update.mockResolvedValue(updated)
    tx.auditLog.create.mockResolvedValue(undefined)

    const res = await app.request('/api/admin/tenants/tenant-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactEmail: null }),
    })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(data['contactEmail']).toBeNull()
  })

  it('returns 400 for an invalid email in contactEmail', async () => {
    const res = await app.request('/api/admin/tenants/tenant-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactEmail: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('VALIDATION_ERROR')
  })

  it('returns 404 when the tenant does not exist', async () => {
    getTxClient().tenant.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/admin/tenants/unknown-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// Admin — POST /api/admin/tenants/:id/suspend
// ---------------------------------------------------------------------------

describe('POST /api/admin/tenants/:id/suspend', () => {
  it('returns 200 with the suspended tenant when currently ACTIVE', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(mockTenantDetail as never)
    const suspended = { ...mockTenantDetail, status: 'SUSPENDED' as const }
    getTxClient().tenant.update.mockResolvedValue(suspended)
    getTxClient().auditLog.create.mockResolvedValue(undefined)

    const res = await app.request('/api/admin/tenants/tenant-1/suspend', { method: 'POST' })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(data['status']).toBe('SUSPENDED')
  })

  it('returns 404 when the tenant does not exist', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)

    const res = await app.request('/api/admin/tenants/unknown/suspend', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 422 when the tenant is already SUSPENDED', async () => {
    const alreadySuspended = { ...mockTenantDetail, status: 'SUSPENDED' as const }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(alreadySuspended as never)

    const res = await app.request('/api/admin/tenants/tenant-1/suspend', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 422 when the tenant is OFFBOARDED', async () => {
    const offboarded = { ...mockTenantDetail, status: 'OFFBOARDED' as const }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(offboarded as never)

    const res = await app.request('/api/admin/tenants/tenant-1/suspend', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })
})

// ---------------------------------------------------------------------------
// Admin — POST /api/admin/tenants/:id/reactivate
// ---------------------------------------------------------------------------

describe('POST /api/admin/tenants/:id/reactivate', () => {
  it('returns 200 with the reactivated tenant when currently SUSPENDED', async () => {
    const suspended = { ...mockTenantDetail, status: 'SUSPENDED' as const }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(suspended as never)
    const reactivated = { ...mockTenantDetail, status: 'ACTIVE' as const }
    getTxClient().tenant.update.mockResolvedValue(reactivated)
    getTxClient().auditLog.create.mockResolvedValue(undefined)

    const res = await app.request('/api/admin/tenants/tenant-1/reactivate', { method: 'POST' })
    expect(res.status).toBe(200)
    const data = ((await res.json()) as Record<string, unknown>)['data'] as Record<string, unknown>
    expect(data['status']).toBe('ACTIVE')
  })

  it('returns 404 when the tenant does not exist', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)

    const res = await app.request('/api/admin/tenants/unknown/reactivate', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('returns 422 when the tenant is already ACTIVE', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(mockTenantDetail as never)

    const res = await app.request('/api/admin/tenants/tenant-1/reactivate', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })

  it('returns 422 when the tenant is OFFBOARDED', async () => {
    const offboarded = { ...mockTenantDetail, status: 'OFFBOARDED' as const }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(offboarded as never)

    const res = await app.request('/api/admin/tenants/tenant-1/reactivate', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })
})

// Admin — POST /api/admin/tenants/:id/offboard
// -----------------------------------------------------------------------
describe('POST /api/admin/tenants/:id/offboard', () => {
  it('returns 200 with the offboarded tenant when currently ACTIVE', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(mockTenantDetail as never)
    const offboarded = { ...mockTenantDetail, status: 'OFFBOARDED' as const, deletedAt: new Date() }
    getTxClient().tenant.update.mockResolvedValue(offboarded)

    const res = await app.request('/api/admin/tenants/tenant-1/offboard', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('OFFBOARDED')
  })

  it('returns 200 with the offboarded tenant when currently SUSPENDED', async () => {
    const suspended = { ...mockTenantDetail, status: 'SUSPENDED' as const }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(suspended as never)
    const offboarded = { ...mockTenantDetail, status: 'OFFBOARDED' as const, deletedAt: new Date() }
    getTxClient().tenant.update.mockResolvedValue(offboarded)

    const res = await app.request('/api/admin/tenants/tenant-1/offboard', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect((body['data'] as Record<string, unknown>)['status']).toBe('OFFBOARDED')
  })

  it('returns 404 when the tenant does not exist', async () => {
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null)

    const res = await app.request('/api/admin/tenants/unknown/offboard', { method: 'POST' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('NOT_FOUND')
  })

  it('returns 422 when the tenant is already OFFBOARDED', async () => {
    const offboarded = { ...mockTenantDetail, status: 'OFFBOARDED' as const, deletedAt: new Date() }
    vi.mocked(db.tenant.findUnique).mockResolvedValue(offboarded as never)

    const res = await app.request('/api/admin/tenants/tenant-1/offboard', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['code']).toBe('INVALID_STATE')
  })
})
