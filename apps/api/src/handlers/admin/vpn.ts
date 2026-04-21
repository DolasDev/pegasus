// ---------------------------------------------------------------------------
// Admin VPN handler — /api/admin/tenants/:tenantId/vpn/**
//
// Per-tenant WireGuard peer management, operated by a Cognito PLATFORM_ADMIN.
// Mounted as a sub-router on adminTenantsRouter, so `:tenantId` is visible
// via c.req.param('tenantId').
//
// Auth: enforced by adminAuthMiddleware on the parent router.
// DB:   basePrisma (unscoped) — never the tenant-scoped extension.
//
// The private key returned in `clientConfig` is generated here and never
// persisted server-side. Only the public key is stored on VpnPeer.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { Context } from 'hono'
import { Prisma } from '@prisma/client'
import type { AdminEnv } from '../../types'
import { db } from '../../db'
import { writeAuditLog } from './audit'
import { generateWgKeypair } from '../../lib/wireguard'
import { renderClientConfig } from '../../lib/wireguard-config'
import {
  allocateNextOctet,
  formatOverlayAddress,
  VpnPoolExhaustedError,
  type AllocatedOctet,
} from '../../lib/vpn-allocator'

// ---------------------------------------------------------------------------
// Shape returned to admin callers — never includes the private key.
// ---------------------------------------------------------------------------

const PEER_SELECT = {
  id: true,
  tenantId: true,
  assignedOctet1: true,
  assignedOctet2: true,
  publicKey: true,
  status: true,
  lastHandshakeAt: true,
  rxBytes: true,
  txBytes: true,
  createdAt: true,
  updatedAt: true,
} as const

type PeerRow = Prisma.VpnPeerGetPayload<{ select: typeof PEER_SELECT }>

function toDto(row: PeerRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    assignedIp: formatOverlayAddress({ octet1: row.assignedOctet1, octet2: row.assignedOctet2 }),
    publicKey: row.publicKey,
    status: row.status,
    lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
    // BigInt → string so the response JSON-serialises safely.
    rxBytes: row.rxBytes.toString(),
    txBytes: row.txBytes.toString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toSnapshot(row: PeerRow): Prisma.InputJsonValue {
  return toDto(row) as unknown as Prisma.InputJsonValue
}

// ---------------------------------------------------------------------------
// Hub config — read from env at call time so dev environments without the
// VPN infrastructure can still boot. Handler responds 503 if the platform
// hasn't provisioned the hub yet.
// ---------------------------------------------------------------------------

interface HubConfig {
  publicKey: string
  endpoint: string
}

function readHubConfig(): HubConfig | null {
  const publicKey = process.env['WIREGUARD_HUB_PUBLIC_KEY']
  const endpoint = process.env['WIREGUARD_HUB_ENDPOINT']
  if (!publicKey || !endpoint) return null
  return { publicKey, endpoint }
}

function renderConfigForPeer(hub: HubConfig, octet: AllocatedOctet, privateKey: string): string {
  return renderClientConfig({
    privateKey,
    address: formatOverlayAddress(octet, '/32'),
    hubPublicKey: hub.publicKey,
    endpoint: hub.endpoint,
  })
}

// ---------------------------------------------------------------------------
// Shared helpers — request metadata + tenant existence check.
// ---------------------------------------------------------------------------

function reqMeta(c: Context<AdminEnv>) {
  return {
    adminSub: c.get('adminSub'),
    adminEmail: c.get('adminEmail'),
    ipAddress: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  }
}

async function bumpGeneration(tx: Prisma.TransactionClient): Promise<void> {
  // VpnState is a singleton (id = 1); upsert so the first write works even if
  // the seed row is missing in a test environment.
  await tx.vpnState.upsert({
    where: { id: 1 },
    create: { id: 1, generation: 2 },
    update: { generation: { increment: 1 } },
  })
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminVpnRouter = new Hono<AdminEnv>()

// ---------------------------------------------------------------------------
// POST /
//
// Provision a VPN peer for the tenant. Idempotent on tenantId:
//   - First call:  allocates octet, generates keypair, inserts PENDING peer,
//                  bumps VpnState.generation, returns { data, clientConfig } (201).
//                  `clientConfig` contains the freshly generated private key
//                  and is the ONLY opportunity to download it.
//   - Repeat call: returns 200 with { data, clientConfig: null, keyAvailable: false }.
//                  Operator must POST /rotate to receive a new private key.
// ---------------------------------------------------------------------------
adminVpnRouter.post('/', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const meta = reqMeta(c)

  // Single round-trip: existence of the tenant AND any existing peer row.
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, vpnPeer: { select: PEER_SELECT } },
  })
  if (!tenant) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404)
  }
  if (tenant.vpnPeer) {
    return c.json({ data: toDto(tenant.vpnPeer), clientConfig: null, keyAvailable: false })
  }

  const hub = readHubConfig()
  if (!hub) {
    return c.json(
      {
        error:
          'WireGuard hub is not configured (WIREGUARD_HUB_PUBLIC_KEY / WIREGUARD_HUB_ENDPOINT).',
        code: 'VPN_HUB_UNCONFIGURED',
      },
      503,
    )
  }

  const { publicKey, privateKey } = await generateWgKeypair()

  try {
    const { created, octet } = await db.$transaction(async (tx) => {
      const o = await allocateNextOctet(tx)
      const c2 = await tx.vpnPeer.create({
        data: {
          tenantId,
          assignedOctet1: o.octet1,
          assignedOctet2: o.octet2,
          publicKey,
          status: 'PENDING',
        },
        select: PEER_SELECT,
      })
      await bumpGeneration(tx)
      await writeAuditLog(
        tx,
        meta.adminSub,
        meta.adminEmail,
        'VPN_ENABLE',
        'VPN_PEER',
        c2.id,
        null,
        toSnapshot(c2),
        meta.ipAddress,
        meta.userAgent,
      )
      return { created: c2, octet: o }
    })

    const clientConfig = renderConfigForPeer(hub, octet, privateKey)
    return c.json({ data: toDto(created), clientConfig }, 201)
  } catch (err) {
    if (err instanceof VpnPoolExhaustedError) {
      return c.json({ error: err.message, code: 'VPN_POOL_EXHAUSTED' }, 507)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Race: concurrent allocation or duplicate tenantId. Retry is safe.
      return c.json({ error: 'Conflict — please retry', code: 'CONFLICT' }, 409)
    }
    throw err
  }
})

// ---------------------------------------------------------------------------
// GET /
//
// Return the tenant's current peer record (no key material). 404 if absent.
// ---------------------------------------------------------------------------
adminVpnRouter.get('/', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const row = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!row) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)
  return c.json({ data: toDto(row) })
})

// ---------------------------------------------------------------------------
// GET /status
//
// Alias for GET / — reserved for an eventual live-stats variant that aggregates
// handshake / byte counters differently. Today it returns the same shape.
// ---------------------------------------------------------------------------
adminVpnRouter.get('/status', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const row = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!row) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)
  const handshakeAgeSec =
    row.lastHandshakeAt === null
      ? null
      : Math.max(0, Math.floor((Date.now() - row.lastHandshakeAt.getTime()) / 1000))
  return c.json({ data: { ...toDto(row), handshakeAgeSec } })
})

// ---------------------------------------------------------------------------
// POST /suspend
//
// Transition ACTIVE | PENDING → SUSPENDED. The hub agent removes the peer
// from the kernel on its next reconcile (≤30s). Idempotent? No — returns 422
// INVALID_STATE if the peer is not ACTIVE or PENDING.
// ---------------------------------------------------------------------------
adminVpnRouter.post('/suspend', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const meta = reqMeta(c)

  const current = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!current) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)
  if (current.status !== 'ACTIVE' && current.status !== 'PENDING') {
    return c.json(
      {
        error: `Cannot suspend a peer in status ${current.status}`,
        code: 'VPN_INVALID_STATE',
      },
      422,
    )
  }

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.vpnPeer.update({
      where: { id: current.id },
      data: { status: 'SUSPENDED' },
      select: PEER_SELECT,
    })
    await bumpGeneration(tx)
    await writeAuditLog(
      tx,
      meta.adminSub,
      meta.adminEmail,
      'VPN_SUSPEND',
      'VPN_PEER',
      u.id,
      toSnapshot(current),
      toSnapshot(u),
      meta.ipAddress,
      meta.userAgent,
    )
    return u
  })

  return c.json({ data: toDto(updated) })
})

// ---------------------------------------------------------------------------
// POST /resume
//
// Transition SUSPENDED → PENDING. The peer must rehandshake before becoming
// ACTIVE, which the hub agent records on its next poll.
// ---------------------------------------------------------------------------
adminVpnRouter.post('/resume', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const meta = reqMeta(c)

  const current = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!current) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)
  if (current.status !== 'SUSPENDED') {
    return c.json(
      {
        error: `Cannot resume a peer in status ${current.status}`,
        code: 'VPN_INVALID_STATE',
      },
      422,
    )
  }

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.vpnPeer.update({
      where: { id: current.id },
      data: { status: 'PENDING', lastHandshakeAt: null },
      select: PEER_SELECT,
    })
    await bumpGeneration(tx)
    await writeAuditLog(
      tx,
      meta.adminSub,
      meta.adminEmail,
      'VPN_RESUME',
      'VPN_PEER',
      u.id,
      toSnapshot(current),
      toSnapshot(u),
      meta.ipAddress,
      meta.userAgent,
    )
    return u
  })

  return c.json({ data: toDto(updated) })
})

// ---------------------------------------------------------------------------
// POST /rotate
//
// Generate a fresh keypair and return a new client.conf. The previous public
// key is replaced in place; the old tunnel stops handshaking once the tenant
// installs the new config. Audit log records before/after public keys.
// ---------------------------------------------------------------------------
adminVpnRouter.post('/rotate', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const meta = reqMeta(c)

  const current = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!current) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)

  const hub = readHubConfig()
  if (!hub) {
    return c.json(
      {
        error:
          'WireGuard hub is not configured (WIREGUARD_HUB_PUBLIC_KEY / WIREGUARD_HUB_ENDPOINT).',
        code: 'VPN_HUB_UNCONFIGURED',
      },
      503,
    )
  }

  const { publicKey, privateKey } = await generateWgKeypair()

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.vpnPeer.update({
      where: { id: current.id },
      data: {
        publicKey,
        status: 'PENDING',
        lastHandshakeAt: null,
      },
      select: PEER_SELECT,
    })
    await bumpGeneration(tx)
    await writeAuditLog(
      tx,
      meta.adminSub,
      meta.adminEmail,
      'VPN_ROTATE',
      'VPN_PEER',
      u.id,
      toSnapshot(current),
      toSnapshot(u),
      meta.ipAddress,
      meta.userAgent,
    )
    return u
  })

  const clientConfig = renderConfigForPeer(
    hub,
    { octet1: updated.assignedOctet1, octet2: updated.assignedOctet2 },
    privateKey,
  )
  return c.json({ data: toDto(updated), clientConfig })
})

// ---------------------------------------------------------------------------
// DELETE /
//
// Hard-delete the peer row. The octet it occupied becomes available for the
// next allocation. Idempotent — 204 whether the row existed or not.
// ---------------------------------------------------------------------------
adminVpnRouter.delete('/', async (c) => {
  const tenantId = c.req.param('tenantId')!
  const meta = reqMeta(c)

  const current = await db.vpnPeer.findUnique({ where: { tenantId }, select: PEER_SELECT })
  if (!current) return new Response(null, { status: 204 })

  await db.$transaction(async (tx) => {
    await tx.vpnPeer.delete({ where: { id: current.id } })
    await bumpGeneration(tx)
    await writeAuditLog(
      tx,
      meta.adminSub,
      meta.adminEmail,
      'VPN_DELETE',
      'VPN_PEER',
      current.id,
      toSnapshot(current),
      null,
      meta.ipAddress,
      meta.userAgent,
    )
  })

  return new Response(null, { status: 204 })
})
