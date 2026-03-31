// ---------------------------------------------------------------------------
// Unit tests for m2mAppAuthMiddleware
//
// basePrisma (db) and createApiClientRepository are mocked so no DB required.
// createTenantDb is mocked to return a stub so tenant-scoped Prisma client
// construction doesn't touch the real Prisma client.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import crypto from 'node:crypto'
import type { AppEnv } from '../types'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRepo, mockBasePrisma } = vi.hoisted(() => ({
  mockRepo: {
    findByPrefix: vi.fn(),
    touchLastUsed: vi.fn(),
  },
  mockBasePrisma: {
    tenant: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../repositories/api-client.repository', () => ({
  createApiClientRepository: vi.fn(() => mockRepo),
}))

vi.mock('../db', () => ({
  db: mockBasePrisma,
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({ /* stub tenant-scoped client */ })),
}))

import { m2mAppAuthMiddleware } from './m2m-app-auth'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', m2mAppAuthMiddleware)
  app.get('/test', (c) => {
    return c.json({
      tenantId: c.get('tenantId'),
      role: c.get('role'),
      userId: c.get('userId'),
      hasDb: c.get('db') !== undefined,
      hasApiClient: c.get('apiClient') !== undefined,
      scopes: c.get('apiClient')?.scopes,
    })
  })
  return app
}

function makeKey(): { plainKey: string; keyHash: string; keyPrefix: string } {
  const plainKey = 'vnd_' + crypto.randomBytes(24).toString('hex')
  const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex')
  const keyPrefix = plainKey.slice(0, 12)
  return { plainKey, keyHash, keyPrefix }
}

const now = new Date('2024-06-01T00:00:00Z')

function makeCandidateRow(plainKey: string) {
  const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex')
  return {
    id: 'client-1',
    tenantId: 'tenant-uuid',
    name: 'Test Client',
    keyPrefix: plainKey.slice(0, 12),
    keyHash,
    scopes: ['events:read', 'events:write'],
    lastUsedAt: null,
    revokedAt: null as Date | null,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
  }
}

const activeTenant = { id: 'tenant-uuid', status: 'ACTIVE' }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('m2mAppAuthMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.touchLastUsed.mockResolvedValue(undefined)
  })

  // ── Missing / malformed auth ───────────────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp()
    const res = await app.request('/test')
    expect(res.status).toBe(401)
    expect((await res.json() as Record<string, unknown>).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when Bearer token does not start with vnd_', async () => {
    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.cognito-jwt' },
    })
    expect(res.status).toBe(401)
    expect((await res.json() as Record<string, unknown>).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when no Bearer prefix (raw key only)', async () => {
    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: 'vnd_test000000abcdef' },
    })
    expect(res.status).toBe(401)
  })

  // ── Key not found ─────────────────────────────────────────────────────────

  it('returns 401 when key prefix is not found in the database', async () => {
    mockRepo.findByPrefix.mockResolvedValue(null)
    const { plainKey } = makeKey()
    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(401)
  })

  // ── Hash mismatch ─────────────────────────────────────────────────────────

  it('returns 401 when key is found but hash does not match', async () => {
    const { plainKey } = makeKey()
    // Store hash for a DIFFERENT key
    const { plainKey: differentKey } = makeKey()
    const candidateWithWrongHash = makeCandidateRow(differentKey)
    candidateWithWrongHash.keyPrefix = plainKey.slice(0, 12) // same prefix, wrong hash
    mockRepo.findByPrefix.mockResolvedValue(candidateWithWrongHash)

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(401)
  })

  // ── Revoked key ───────────────────────────────────────────────────────────

  it('returns 403 FORBIDDEN when key is found but revoked', async () => {
    const { plainKey } = makeKey()
    const candidate = makeCandidateRow(plainKey)
    candidate.revokedAt = new Date()
    mockRepo.findByPrefix.mockResolvedValue(candidate)

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(403)
    expect((await res.json() as Record<string, unknown>).code).toBe('FORBIDDEN')
  })

  // ── Tenant lifecycle ──────────────────────────────────────────────────────

  it('returns 404 when tenant is not found', async () => {
    const { plainKey } = makeKey()
    mockRepo.findByPrefix.mockResolvedValue(makeCandidateRow(plainKey))
    mockBasePrisma.tenant.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(404)
    expect((await res.json() as Record<string, unknown>).code).toBe('TENANT_NOT_FOUND')
  })

  it('returns 404 when tenant is OFFBOARDED', async () => {
    const { plainKey } = makeKey()
    mockRepo.findByPrefix.mockResolvedValue(makeCandidateRow(plainKey))
    mockBasePrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-uuid', status: 'OFFBOARDED' })

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 when tenant is SUSPENDED', async () => {
    const { plainKey } = makeKey()
    mockRepo.findByPrefix.mockResolvedValue(makeCandidateRow(plainKey))
    mockBasePrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-uuid', status: 'SUSPENDED' })

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(403)
    expect((await res.json() as Record<string, unknown>).code).toBe('TENANT_SUSPENDED')
  })

  // ── Successful authentication ─────────────────────────────────────────────

  it('passes through and sets context on valid key + active tenant', async () => {
    const { plainKey } = makeKey()
    mockRepo.findByPrefix.mockResolvedValue(makeCandidateRow(plainKey))
    mockBasePrisma.tenant.findUnique.mockResolvedValue(activeTenant)

    const app = buildApp()
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body['tenantId']).toBe('tenant-uuid')
    expect(body['role']).toBe('api_client')
    expect(body['userId']).toBeUndefined()
    expect(body['hasDb']).toBe(true)
    expect(body['hasApiClient']).toBe(true)
    expect(body['scopes']).toEqual(['events:read', 'events:write'])
  })

  it('does not expose keyHash in the apiClient context variable', async () => {
    const { plainKey } = makeKey()
    const candidate = makeCandidateRow(plainKey)
    mockRepo.findByPrefix.mockResolvedValue(candidate)
    mockBasePrisma.tenant.findUnique.mockResolvedValue(activeTenant)

    // Mount a handler that inspects the raw apiClient object
    const app = new Hono<AppEnv>()
    app.use('*', m2mAppAuthMiddleware)
    app.get('/inspect', (c) => {
      const apiClient = c.get('apiClient') as Record<string, unknown>
      return c.json({ hasKeyHash: 'keyHash' in apiClient })
    })

    const res = await app.request('/inspect', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(res.status).toBe(200)
    expect((await res.json() as Record<string, unknown>)['hasKeyHash']).toBe(false)
  })

  // ── Fire-and-forget touchLastUsed ─────────────────────────────────────────

  it('calls touchLastUsed after successful auth', async () => {
    const { plainKey } = makeKey()
    mockRepo.findByPrefix.mockResolvedValue(makeCandidateRow(plainKey))
    mockBasePrisma.tenant.findUnique.mockResolvedValue(activeTenant)

    const app = buildApp()
    await app.request('/test', {
      headers: { Authorization: `Bearer ${plainKey}` },
    })
    expect(mockRepo.touchLastUsed).toHaveBeenCalledWith('client-1')
  })
})
