// ---------------------------------------------------------------------------
// Unit tests for admin tenants handler
//
// db is mocked via vi.hoisted so the same mock functions are shared across
// both the vi.mock factory and test bodies.
//
// provisionCognitoUser is mocked to avoid real Cognito calls.
// writeAuditLog is mocked to avoid touching the audit table.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across vi.mock factories and test bodies
// ---------------------------------------------------------------------------

const { mockDb, mockProvision } = vi.hoisted(() => ({
  mockDb: {
    tenant: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    tenantUser: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockProvision: vi.fn(),
}))

vi.mock('../../db', () => ({ db: mockDb }))

vi.mock('./cognito', () => ({
  provisionCognitoUser: mockProvision,
  disableCognitoUser: vi.fn(),
  getCognito: vi.fn(),
}))

vi.mock('./audit', () => ({ writeAuditLog: vi.fn() }))

import { adminTenantsRouter } from './tenants'

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

function patch(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/tenants', adminTenantsRouter)
  return app
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date('2024-01-15T12:00:00Z')

const mockTenant = {
  id: 'tenant-1',
  name: 'Acme Moving',
  slug: 'acme',
  status: 'ACTIVE',
  plan: 'STARTER',
  contactName: 'Jane Doe',
  contactEmail: 'jane@acme.com',
  emailDomains: ['acme.com'],
  cognitoAuthEnabled: true,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
}

const validCreateBody = {
  name: 'Acme Moving',
  slug: 'acme',
  emailDomains: ['acme.com'],
  adminEmail: 'admin@acme.com',
}

const BASE = '/tenants'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin tenants handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProvision.mockResolvedValue(undefined)
    mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb))
  })

  // ── GET / — list tenants ──────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with paginated tenant list', async () => {
      mockDb.tenant.findMany.mockResolvedValue([mockTenant])
      mockDb.tenant.count.mockResolvedValue(1)

      const res = await buildApp().request(BASE)
      expect(res.status).toBe(200)
      const body = await json(res)
      const data = body.data as JsonBody[]
      expect(data.length).toBe(1)
      expect(data[0]!['name']).toBe('Acme Moving')
      const meta = body.meta as JsonBody
      expect(meta['total']).toBe(1)
      expect(meta['count']).toBe(1)
    })

    it('accepts status query param and returns filtered list', async () => {
      mockDb.tenant.findMany.mockResolvedValue([mockTenant])
      mockDb.tenant.count.mockResolvedValue(1)

      const res = await buildApp().request(`${BASE}?status=ACTIVE`)
      expect(res.status).toBe(200)
    })

    it('returns 400 VALIDATION_ERROR for invalid status query param', async () => {
      const res = await buildApp().request(`${BASE}?status=INVALID`)
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('accepts includeOffboarded=true query param', async () => {
      mockDb.tenant.findMany.mockResolvedValue([])
      mockDb.tenant.count.mockResolvedValue(0)

      const res = await buildApp().request(`${BASE}?includeOffboarded=true`)
      expect(res.status).toBe(200)
    })
  })

  // ── GET /:id — get tenant by id ───────────────────────────────────────────

  describe('GET /:id', () => {
    it('returns 200 with tenant data when found', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)

      const res = await buildApp().request(`${BASE}/tenant-1`)
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['name']).toBe('Acme Moving')
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/unknown-id`)
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })
  })

  // ── POST / — create tenant ────────────────────────────────────────────────

  describe('POST /', () => {
    it('returns 201 with created tenant on success', async () => {
      mockDb.tenant.create.mockResolvedValue(mockTenant)
      mockDb.tenantUser.create.mockResolvedValue({})

      const res = await buildApp().request(BASE, post(validCreateBody))
      expect(res.status).toBe(201)
      const body = await json(res)
      expect((body.data as JsonBody)['slug']).toBe('acme')
    })

    it('returns 409 CONFLICT when slug is already taken', async () => {
      const prismaError = Object.assign(new Error('Unique constraint'), {
        code: 'P2002',
        constructor: { name: 'PrismaClientKnownRequestError' },
      })
      // Make the constructor check work by using the actual Prisma error class
      const { Prisma } = await import('@prisma/client')
      const knownError = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0.0',
      })
      mockDb.$transaction.mockRejectedValue(knownError)

      const res = await buildApp().request(BASE, post(validCreateBody))
      expect(res.status).toBe(409)
      expect((await json(res)).code).toBe('CONFLICT')
    })

    it('returns 500 COGNITO_ERROR when Cognito provisioning fails', async () => {
      mockProvision.mockRejectedValue(new Error('Cognito failure'))

      const res = await buildApp().request(BASE, post(validCreateBody))
      expect(res.status).toBe(500)
      expect((await json(res)).code).toBe('COGNITO_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
      const res = await buildApp().request(BASE, post({ name: 'Acme' }))
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when slug is invalid', async () => {
      const res = await buildApp().request(
        BASE,
        post({ ...validCreateBody, slug: 'INVALID SLUG!' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when emailDomains is empty', async () => {
      const res = await buildApp().request(
        BASE,
        post({ ...validCreateBody, emailDomains: [] }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 VALIDATION_ERROR when adminEmail is not an email', async () => {
      const res = await buildApp().request(
        BASE,
        post({ ...validCreateBody, adminEmail: 'not-an-email' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })
  })

  // ── PATCH /:id — update tenant ────────────────────────────────────────────

  describe('PATCH /:id', () => {
    it('returns 200 with updated tenant on success', async () => {
      const updated = { ...mockTenant, name: 'Acme Updated' }
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockDb.tenant.update.mockResolvedValue(updated)

      const res = await buildApp().request(`${BASE}/tenant-1`, patch({ name: 'Acme Updated' }))
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['name']).toBe('Acme Updated')
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)
      // Transaction returns null when findUnique returns null
      mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb))

      const res = await buildApp().request(`${BASE}/unknown-id`, patch({ name: 'X' }))
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 400 VALIDATION_ERROR for invalid plan value', async () => {
      const res = await buildApp().request(
        `${BASE}/tenant-1`,
        patch({ plan: 'INVALID_PLAN' }),
      )
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe('VALIDATION_ERROR')
    })

    it('accepts cognitoAuthEnabled boolean', async () => {
      const updated = { ...mockTenant, cognitoAuthEnabled: false }
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockDb.tenant.update.mockResolvedValue(updated)

      const res = await buildApp().request(
        `${BASE}/tenant-1`,
        patch({ cognitoAuthEnabled: false }),
      )
      expect(res.status).toBe(200)
      expect((( await json(res)).data as JsonBody)['cognitoAuthEnabled']).toBe(false)
    })
  })

  // ── POST /:id/suspend ─────────────────────────────────────────────────────

  describe('POST /:id/suspend', () => {
    it('returns 200 with suspended tenant on success', async () => {
      const suspended = { ...mockTenant, status: 'SUSPENDED' }
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockDb.tenant.update.mockResolvedValue(suspended)

      const res = await buildApp().request(`${BASE}/tenant-1/suspend`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('SUSPENDED')
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/unknown-id/suspend`, { method: 'POST' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when tenant is already SUSPENDED', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'SUSPENDED' })

      const res = await buildApp().request(`${BASE}/tenant-1/suspend`, { method: 'POST' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 INVALID_STATE when tenant is OFFBOARDED', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'OFFBOARDED' })

      const res = await buildApp().request(`${BASE}/tenant-1/suspend`, { method: 'POST' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })
  })

  // ── POST /:id/reactivate ──────────────────────────────────────────────────

  describe('POST /:id/reactivate', () => {
    it('returns 200 with reactivated tenant on success', async () => {
      const reactivated = { ...mockTenant, status: 'ACTIVE' }
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'SUSPENDED' })
      mockDb.tenant.update.mockResolvedValue(reactivated)

      const res = await buildApp().request(`${BASE}/tenant-1/reactivate`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('ACTIVE')
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/unknown-id/reactivate`, { method: 'POST' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when tenant is ACTIVE', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'ACTIVE' })

      const res = await buildApp().request(`${BASE}/tenant-1/reactivate`, { method: 'POST' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })

    it('returns 422 INVALID_STATE when tenant is OFFBOARDED', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'OFFBOARDED' })

      const res = await buildApp().request(`${BASE}/tenant-1/reactivate`, { method: 'POST' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })
  })

  // ── POST /:id/offboard ────────────────────────────────────────────────────

  describe('POST /:id/offboard', () => {
    it('returns 200 with offboarded tenant when ACTIVE', async () => {
      const offboarded = { ...mockTenant, status: 'OFFBOARDED', deletedAt: now }
      mockDb.tenant.findUnique.mockResolvedValue(mockTenant)
      mockDb.tenant.update.mockResolvedValue(offboarded)

      const res = await buildApp().request(`${BASE}/tenant-1/offboard`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = await json(res)
      expect((body.data as JsonBody)['status']).toBe('OFFBOARDED')
    })

    it('returns 200 with offboarded tenant when SUSPENDED', async () => {
      const offboarded = { ...mockTenant, status: 'OFFBOARDED', deletedAt: now }
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'SUSPENDED' })
      mockDb.tenant.update.mockResolvedValue(offboarded)

      const res = await buildApp().request(`${BASE}/tenant-1/offboard`, { method: 'POST' })
      expect(res.status).toBe(200)
    })

    it('returns 404 NOT_FOUND when tenant does not exist', async () => {
      mockDb.tenant.findUnique.mockResolvedValue(null)

      const res = await buildApp().request(`${BASE}/unknown-id/offboard`, { method: 'POST' })
      expect(res.status).toBe(404)
      expect((await json(res)).code).toBe('NOT_FOUND')
    })

    it('returns 422 INVALID_STATE when tenant is already OFFBOARDED', async () => {
      mockDb.tenant.findUnique.mockResolvedValue({ ...mockTenant, status: 'OFFBOARDED' })

      const res = await buildApp().request(`${BASE}/tenant-1/offboard`, { method: 'POST' })
      expect(res.status).toBe(422)
      expect((await json(res)).code).toBe('INVALID_STATE')
    })
  })
})
