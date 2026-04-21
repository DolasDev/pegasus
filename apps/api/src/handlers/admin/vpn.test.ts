// ---------------------------------------------------------------------------
// Unit tests for admin VPN handler
//
// db, audit, wireguard and wireguard-config are mocked via vi.hoisted so the
// tests do not touch Postgres, Cognito, or the audit log table.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AdminEnv } from '../../types'
import type * as VpnAllocatorModule from '../../lib/vpn-allocator'

const { mockDb, mockGenerateKeypair, mockRenderClientConfig, mockAllocateNextOctet } = vi.hoisted(
  () => ({
    mockDb: {
      tenant: { findUnique: vi.fn() },
      vpnPeer: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
      },
      vpnState: {
        upsert: vi.fn(),
      },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn(),
    },
    mockGenerateKeypair: vi.fn(),
    mockRenderClientConfig: vi.fn(),
    mockAllocateNextOctet: vi.fn(),
  }),
)

vi.mock('../../db', () => ({ db: mockDb }))
vi.mock('./audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('../../lib/wireguard', () => ({ generateWgKeypair: mockGenerateKeypair }))
vi.mock('../../lib/wireguard-config', () => ({ renderClientConfig: mockRenderClientConfig }))
vi.mock('../../lib/vpn-allocator', async (importOriginal) => {
  const actual = await importOriginal<typeof VpnAllocatorModule>()
  return {
    ...actual,
    allocateNextOctet: mockAllocateNextOctet,
  }
})

import { adminVpnRouter } from './vpn'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>
}

function buildApp() {
  const app = new Hono<AdminEnv>()
  app.use('*', async (c, next) => {
    c.set('adminSub', 'admin-sub-123')
    c.set('adminEmail', 'admin@platform.com')
    await next()
  })
  app.route('/tenants/:tenantId/vpn', adminVpnRouter)
  return app
}

const now = new Date('2026-04-20T12:00:00Z')

const basePeer = {
  id: 'vpn_1',
  tenantId: 'tnt_1',
  assignedOctet1: 0,
  assignedOctet2: 2,
  publicKey: 'PUBLICKEY',
  status: 'PENDING' as const,
  lastHandshakeAt: null as Date | null,
  rxBytes: 0n,
  txBytes: 0n,
  createdAt: now,
  updatedAt: now,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateKeypair.mockResolvedValue({ publicKey: 'NEWPUB', privateKey: 'NEWPRIV' })
  mockRenderClientConfig.mockReturnValue('[Interface]\nPrivateKey = NEWPRIV\n')
  mockAllocateNextOctet.mockResolvedValue({ octet1: 0, octet2: 2 })
  // The handler uses db.$transaction(async (tx) => ...); surface the same tx to the callback.
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) =>
    fn(mockDb),
  )
  process.env['WIREGUARD_HUB_PUBLIC_KEY'] = 'HUBPUB'
  process.env['WIREGUARD_HUB_ENDPOINT'] = 'vpn.pegasus.internal:51820'
})

// ---------------------------------------------------------------------------
// POST /:tenantId/vpn
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/vpn', () => {
  it('creates a new peer and returns 201 with clientConfig', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: 'tnt_1', vpnPeer: null })
    mockDb.vpnPeer.create.mockResolvedValue(basePeer)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['tenantId']).toBe('tnt_1')
    expect(data['assignedIp']).toBe('10.200.0.2')
    expect(data['status']).toBe('PENDING')
    expect(body['clientConfig']).toContain('NEWPRIV')
    expect(mockGenerateKeypair).toHaveBeenCalledOnce()
    expect(mockDb.vpnState.upsert).toHaveBeenCalledOnce()
  })

  it('returns 200 with the existing peer when called twice (idempotent, no private key)', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: 'tnt_1', vpnPeer: basePeer })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['clientConfig']).toBeNull()
    expect(body['keyAvailable']).toBe(false)
    expect(mockGenerateKeypair).not.toHaveBeenCalled()
  })

  it('returns 404 when the tenant does not exist', async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_missing/vpn', { method: 'POST' })
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('NOT_FOUND')
  })

  it('returns 503 when the hub env vars are missing', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: 'tnt_1', vpnPeer: null })
    delete process.env['WIREGUARD_HUB_PUBLIC_KEY']

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'POST' })
    expect(res.status).toBe(503)
    const body = await json(res)
    expect(body['code']).toBe('VPN_HUB_UNCONFIGURED')
  })

  it('returns 507 when the octet pool is exhausted', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: 'tnt_1', vpnPeer: null })
    const { VpnPoolExhaustedError } = await import('../../lib/vpn-allocator')
    mockAllocateNextOctet.mockRejectedValue(new VpnPoolExhaustedError())

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'POST' })
    expect(res.status).toBe(507)
    const body = await json(res)
    expect(body['code']).toBe('VPN_POOL_EXHAUSTED')
  })
})

// ---------------------------------------------------------------------------
// GET /:tenantId/vpn
// ---------------------------------------------------------------------------

describe('GET /tenants/:tenantId/vpn', () => {
  it('returns the peer DTO without any key material', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(basePeer)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['publicKey']).toBe('PUBLICKEY')
    expect(JSON.stringify(body)).not.toContain('PrivateKey')
  })

  it('returns 404 when there is no peer for the tenant', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn')
    expect(res.status).toBe(404)
    const body = await json(res)
    expect(body['code']).toBe('VPN_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// POST /:tenantId/vpn/suspend
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/vpn/suspend', () => {
  it('transitions ACTIVE → SUSPENDED', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ ...basePeer, status: 'ACTIVE' })
    mockDb.vpnPeer.update.mockResolvedValue({ ...basePeer, status: 'SUSPENDED' })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/suspend', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['status']).toBe('SUSPENDED')
  })

  it('returns 422 when the peer is already SUSPENDED', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ ...basePeer, status: 'SUSPENDED' })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/suspend', { method: 'POST' })
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body['code']).toBe('VPN_INVALID_STATE')
  })
})

// ---------------------------------------------------------------------------
// POST /:tenantId/vpn/resume
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/vpn/resume', () => {
  it('transitions SUSPENDED → PENDING', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ ...basePeer, status: 'SUSPENDED' })
    mockDb.vpnPeer.update.mockResolvedValue({ ...basePeer, status: 'PENDING' })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/resume', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['status']).toBe('PENDING')
  })

  it('returns 422 when the peer is ACTIVE', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ ...basePeer, status: 'ACTIVE' })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/resume', { method: 'POST' })
    expect(res.status).toBe(422)
  })
})

// ---------------------------------------------------------------------------
// POST /:tenantId/vpn/rotate
// ---------------------------------------------------------------------------

describe('POST /tenants/:tenantId/vpn/rotate', () => {
  it('generates a new keypair and returns a new client.conf', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ ...basePeer, status: 'ACTIVE' })
    mockDb.vpnPeer.update.mockResolvedValue({
      ...basePeer,
      publicKey: 'NEWPUB',
      status: 'PENDING',
    })

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/rotate', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['publicKey']).toBe('NEWPUB')
    expect(data['status']).toBe('PENDING')
    expect(body['clientConfig']).toContain('NEWPRIV')
    expect(mockGenerateKeypair).toHaveBeenCalledOnce()
  })

  it('returns 404 when there is no peer for the tenant', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn/rotate', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// DELETE /:tenantId/vpn
// ---------------------------------------------------------------------------

describe('DELETE /tenants/:tenantId/vpn', () => {
  it('hard-deletes the peer and returns 204', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(basePeer)
    mockDb.vpnPeer.delete.mockResolvedValue(basePeer)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockDb.vpnPeer.delete).toHaveBeenCalledOnce()
  })

  it('is idempotent — 204 even when no peer exists', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/tenants/tnt_1/vpn', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(mockDb.vpnPeer.delete).not.toHaveBeenCalled()
  })
})
