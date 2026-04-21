// ---------------------------------------------------------------------------
// Unit tests for hub agent handler (/api/vpn/**)
//
// The apiClientAuthMiddleware is replaced by a no-op that seeds apiClient
// with the right scope so tests focus on routing + handler logic rather
// than auth internals (which are covered by api-client-auth.test.ts).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { ApiClientEnv } from '../types'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vpnPeer: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    vpnState: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('../db', () => ({ db: mockDb }))

// Replace auth middleware with a stub that pretends auth already ran.
vi.mock('../middleware/api-client-auth', () => ({
  apiClientAuthMiddleware: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('apiClient', {
      id: 'ac_1',
      tenantId: 'tnt_platform',
      name: 'hub-agent',
      keyPrefix: 'vnd_test000',
      scopes: ['vpn:sync'],
      lastUsedAt: null,
      revokedAt: null,
      createdById: 'platform',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    c.set('tenantId', 'tnt_platform')
    await next()
  },
}))

import { vpnAgentHandler } from './vpn-agent'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp() {
  const app = new Hono<ApiClientEnv>()
  app.route('/api/vpn', vpnAgentHandler)
  return app
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>
}

const peerA = {
  id: 'vpn_A',
  tenantId: 'tnt_A',
  assignedOctet1: 0,
  assignedOctet2: 2,
  publicKey: 'PUB_A',
  status: 'PENDING',
  lastHandshakeAt: null,
  rxBytes: 0n,
  txBytes: 0n,
}

const peerB = {
  id: 'vpn_B',
  tenantId: 'tnt_B',
  assignedOctet1: 0,
  assignedOctet2: 3,
  publicKey: 'PUB_B',
  status: 'ACTIVE',
  lastHandshakeAt: new Date('2026-04-20T12:00:00Z'),
  rxBytes: 123n,
  txBytes: 456n,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /peers
// ---------------------------------------------------------------------------

describe('GET /api/vpn/peers', () => {
  it('returns the peers list with ETag header matching generation', async () => {
    mockDb.vpnState.findUnique.mockResolvedValue({ generation: 42 })
    mockDb.vpnPeer.findMany.mockResolvedValue([peerA, peerB])

    const app = buildApp()
    const res = await app.request('/api/vpn/peers')
    expect(res.status).toBe(200)
    expect(res.headers.get('ETag')).toBe('"42"')
    const body = await json(res)
    const data = body['data'] as Array<Record<string, unknown>>
    expect(data).toHaveLength(2)
    expect(data[0]?.['assignedIp']).toBe('10.200.0.2')
    expect(data[1]?.['rxBytes']).toBe('123')
    const meta = body['meta'] as Record<string, unknown>
    expect(meta['generation']).toBe(42)
  })

  it('returns 304 when If-None-Match matches the current generation', async () => {
    mockDb.vpnState.findUnique.mockResolvedValue({ generation: 7 })

    const app = buildApp()
    const res = await app.request('/api/vpn/peers', {
      headers: { 'If-None-Match': '"7"' },
    })
    expect(res.status).toBe(304)
    expect(res.headers.get('ETag')).toBe('"7"')
    expect(mockDb.vpnPeer.findMany).not.toHaveBeenCalled()
  })

  it('excludes REVOKED peers from the feed', async () => {
    mockDb.vpnState.findUnique.mockResolvedValue({ generation: 1 })
    mockDb.vpnPeer.findMany.mockResolvedValue([])

    const app = buildApp()
    await app.request('/api/vpn/peers')
    const callArgs = mockDb.vpnPeer.findMany.mock.calls[0]?.[0] as { where: unknown }
    expect(JSON.stringify(callArgs.where)).toContain('REVOKED')
  })
})

// ---------------------------------------------------------------------------
// PATCH /peers/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/vpn/peers/:id', () => {
  it('updates handshake and byte counters and PENDING → ACTIVE', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ id: 'vpn_A', status: 'PENDING' })
    mockDb.vpnPeer.update.mockResolvedValue({
      ...peerA,
      status: 'ACTIVE',
      lastHandshakeAt: new Date('2026-04-20T12:00:30Z'),
      rxBytes: 10n,
      txBytes: 20n,
    })

    const app = buildApp()
    const res = await app.request('/api/vpn/peers/vpn_A', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ACTIVE',
        lastHandshakeAt: '2026-04-20T12:00:30.000Z',
        rxBytes: 10,
        txBytes: 20,
      }),
    })
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as Record<string, unknown>
    expect(data['status']).toBe('ACTIVE')
    expect(data['rxBytes']).toBe('10')
  })

  it('ignores status updates for SUSPENDED peers (operator overrides agent)', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue({ id: 'vpn_A', status: 'SUSPENDED' })
    mockDb.vpnPeer.update.mockResolvedValue({ ...peerA, status: 'SUSPENDED' })

    const app = buildApp()
    const res = await app.request('/api/vpn/peers/vpn_A', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    })
    expect(res.status).toBe(200)
    const updateArgs = mockDb.vpnPeer.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(updateArgs.data).not.toHaveProperty('status')
  })

  it('returns 404 for unknown peer id', async () => {
    mockDb.vpnPeer.findUnique.mockResolvedValue(null)

    const app = buildApp()
    const res = await app.request('/api/vpn/peers/vpn_missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /hub
// ---------------------------------------------------------------------------

describe('GET /api/vpn/hub', () => {
  it('returns generation + peer counts by status', async () => {
    mockDb.vpnState.findUnique.mockResolvedValue({ generation: 12 })
    mockDb.vpnPeer.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 3 } },
      { status: 'PENDING', _count: { _all: 1 } },
    ])

    const app = buildApp()
    const res = await app.request('/api/vpn/hub')
    expect(res.status).toBe(200)
    const body = await json(res)
    const data = body['data'] as { generation: number; peers: Record<string, number> }
    expect(data.generation).toBe(12)
    expect(data.peers['ACTIVE']).toBe(3)
    expect(data.peers['PENDING']).toBe(1)
    expect(data.peers['SUSPENDED']).toBe(0)
  })
})
