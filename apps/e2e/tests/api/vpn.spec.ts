// ---------------------------------------------------------------------------
// E2E coverage for the WireGuard hub agent feed (/api/vpn/**).
//
// The /api/admin/tenants/:id/vpn routes require a real Cognito JWT and are
// covered by apps/api/src/handlers/admin/vpn.test.ts integration tests; here
// we exercise the M2M surface the hub agent (apps/vpn-agent) will poll.
//
// Test setup seeds a fresh ApiClient with scope vpn:sync and a PENDING
// VpnPeer so the feed has something to return. Cleans up afterwards so the
// tests are re-runnable.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
const DATABASE_URL = process.env['DATABASE_URL']
const TENANT_ID = process.env['TEST_TENANT_ID'] ?? 'e2e00000-0000-0000-0000-000000000001'
const TENANT_USER_ID = process.env['TEST_TENANT_USER_ID'] ?? 'e2e00000-0000-0000-0000-000000000002'

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
  $disconnect: () => Promise<void>
}

async function getPrisma(): Promise<PrismaLike> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma 7 ESM export compat (matches global-setup.ts pattern).
  const mod: Record<string, any> = await import('@prisma/client')
  const PrismaClient = mod['PrismaClient'] ?? mod['default']?.PrismaClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter ESM export compat
  const adapterMod: Record<string, any> = await import('@prisma/adapter-pg')
  const PrismaPg = adapterMod['PrismaPg'] ?? adapterMod['default']?.PrismaPg
  const adapter = new PrismaPg({ connectionString: DATABASE_URL })
  return new PrismaClient({ adapter }) as PrismaLike
}

function buildApiKey(): { plainKey: string; keyPrefix: string; keyHash: string } {
  const hex = crypto.randomBytes(24).toString('hex')
  const plainKey = `vnd_${hex}`
  return {
    plainKey,
    keyPrefix: plainKey.slice(0, 12),
    keyHash: crypto.createHash('sha256').update(plainKey).digest('hex'),
  }
}

interface Seeded {
  plainKey: string
  apiClientId: string
  peerId: string
}

async function seedAgentAndPeer(): Promise<Seeded> {
  const prisma = await getPrisma()
  const { plainKey, keyPrefix, keyHash } = buildApiKey()
  const apiClientId = `e2e_ac_${Date.now().toString(36)}`
  const peerId = `e2e_vpn_${Date.now().toString(36)}`

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.api_clients
       (id, tenant_id, name, key_prefix, key_hash, scopes, created_by, created_at, updated_at)
     VALUES ($1, $2, 'e2e-vpn-agent', $3, $4, ARRAY['vpn:sync'], $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    apiClientId,
    TENANT_ID,
    keyPrefix,
    keyHash,
    TENANT_USER_ID,
  )

  // Clean any leftover peer for this tenant before creating a fresh PENDING one.
  await prisma.$executeRawUnsafe(`DELETE FROM public."VpnPeer" WHERE "tenantId" = $1`, TENANT_ID)
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."VpnPeer"
       (id, "tenantId", "assignedOctet1", "assignedOctet2", "publicKey", status,
        "rxBytes", "txBytes", "createdAt", "updatedAt")
     VALUES ($1, $2, 0, 2, 'E2E_PUBLIC_KEY', 'PENDING', 0, 0, NOW(), NOW())`,
    peerId,
    TENANT_ID,
  )

  // Make sure the VpnState singleton exists (first migration may not have seeded).
  await prisma.$executeRawUnsafe(
    `INSERT INTO public."VpnState" (id, generation) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET generation = public."VpnState".generation + 1`,
  )

  await prisma.$disconnect()
  return { plainKey, apiClientId, peerId }
}

async function cleanup(seeded: Seeded): Promise<void> {
  const prisma = await getPrisma()
  await prisma.$executeRawUnsafe(`DELETE FROM public."VpnPeer" WHERE id = $1`, seeded.peerId)
  await prisma.$executeRawUnsafe(`DELETE FROM public.api_clients WHERE id = $1`, seeded.apiClientId)
  await prisma.$disconnect()
}

function agentFetch(plainKey: string) {
  return async (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial('VPN hub agent feed', () => {
  let seeded: Seeded

  test.beforeAll(async () => {
    seeded = await seedAgentAndPeer()
  })

  test.afterAll(async () => {
    if (seeded) await cleanup(seeded)
  })

  test('GET /api/vpn/peers returns the seeded peer with ETag + generation', async () => {
    const res = await agentFetch(seeded.plainKey)('/api/vpn/peers')
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toMatch(/^"\d+"$/)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    const seededPeer = body.data.find((p: { id: string }) => p.id === seeded.peerId)
    expect(seededPeer).toBeTruthy()
    expect(seededPeer.status).toBe('PENDING')
    expect(seededPeer.assignedIp).toBe('10.200.0.2')
    expect(typeof body.meta.generation).toBe('number')
  })

  test('GET /api/vpn/peers with If-None-Match matching generation returns 304', async () => {
    const first = await agentFetch(seeded.plainKey)('/api/vpn/peers')
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()

    const second = await agentFetch(seeded.plainKey)('/api/vpn/peers', {
      headers: { 'If-None-Match': etag! },
    })
    expect(second.status).toBe(304)
  })

  test('PATCH /api/vpn/peers/:id promotes PENDING → ACTIVE and records handshake', async () => {
    const res = await agentFetch(seeded.plainKey)(`/api/vpn/peers/${seeded.peerId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'ACTIVE',
        lastHandshakeAt: new Date().toISOString(),
        rxBytes: 1024,
        txBytes: 2048,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.status).toBe('ACTIVE')
    expect(body.data.rxBytes).toBe('1024')
    expect(body.data.txBytes).toBe('2048')
    expect(body.data.lastHandshakeAt).toBeTruthy()
  })

  test('GET /api/vpn/hub returns generation and per-status peer counts', async () => {
    const res = await agentFetch(seeded.plainKey)('/api/vpn/hub')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.data.generation).toBe('number')
    expect(body.data.peers).toEqual(
      expect.objectContaining({
        PENDING: expect.any(Number),
        ACTIVE: expect.any(Number),
        SUSPENDED: expect.any(Number),
        REVOKED: expect.any(Number),
      }),
    )
    // The peer we PATCHed to ACTIVE in the previous test counts here.
    expect(body.data.peers.ACTIVE).toBeGreaterThanOrEqual(1)
  })

  test('requests without the vpn:sync scope are rejected 401/403', async () => {
    // Any token that doesn't start with vnd_ is rejected 401 by apiClientAuthMiddleware.
    const res = await fetch(`${API_BASE}/api/vpn/peers`, {
      headers: { Authorization: 'Bearer not-a-vendor-key' },
    })
    expect([401, 403]).toContain(res.status)
  })
})
