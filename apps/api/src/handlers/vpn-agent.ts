// ---------------------------------------------------------------------------
// Hub agent handler — /api/vpn/**
//
// Called by the WireGuard hub's reconcile agent (apps/vpn-agent). Authenticates
// via an M2M ApiClient key with the `vpn:sync` scope. Not mounted under the
// Cognito-guarded /api/admin namespace; the hub never holds a Cognito token.
//
// The agent treats the API as the source of truth for desired peers and pushes
// kernel-observed state (handshake age, bytes) back via PATCH. Reads support
// `If-None-Match: "<generation>"` so a steady cluster polls at near-zero cost.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { type Prisma } from '@prisma/client'
import { db } from '../db'
import { apiClientAuthMiddleware } from '../middleware/api-client-auth'
import { requireScope } from '../lib/scopes'
import { formatOverlayAddress } from '../lib/vpn-allocator'
import type { ApiClientEnv } from '../types'

// ---------------------------------------------------------------------------
// Scope required on every route in this router.
// ---------------------------------------------------------------------------

/** Scope granted to the hub agent's M2M ApiClient. */
export const VPN_SYNC_SCOPE = 'vpn:sync'

// ---------------------------------------------------------------------------
// Selection + DTO — the agent only needs enough to apply `wg set`.
// ---------------------------------------------------------------------------

const AGENT_PEER_SELECT = {
  id: true,
  tenantId: true,
  assignedOctet1: true,
  assignedOctet2: true,
  publicKey: true,
  status: true,
  lastHandshakeAt: true,
  rxBytes: true,
  txBytes: true,
} as const

type AgentPeerRow = Prisma.VpnPeerGetPayload<{ select: typeof AGENT_PEER_SELECT }>

function toAgentDto(row: AgentPeerRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    assignedIp: formatOverlayAddress({ octet1: row.assignedOctet1, octet2: row.assignedOctet2 }),
    publicKey: row.publicKey,
    status: row.status,
    lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
    rxBytes: row.rxBytes.toString(),
    txBytes: row.txBytes.toString(),
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const vpnAgentHandler = new Hono<ApiClientEnv>()

vpnAgentHandler.use('*', apiClientAuthMiddleware)
vpnAgentHandler.use('*', requireScope(VPN_SYNC_SCOPE))

// ---------------------------------------------------------------------------
// Helpers — VpnState.generation read / format
// ---------------------------------------------------------------------------

async function readGeneration(): Promise<number> {
  const row = await db.vpnState.findUnique({ where: { id: 1 }, select: { generation: true } })
  return row?.generation ?? 1
}

function etagForGeneration(generation: number): string {
  return `"${generation}"`
}

// ---------------------------------------------------------------------------
// GET /peers
//
// Returns the agent's desired state: every non-REVOKED peer. Suspended peers
// are returned with status=SUSPENDED so the agent knows to remove them.
// Supports `If-None-Match: "<gen>"` → 304 when generation hasn't changed.
// ---------------------------------------------------------------------------
vpnAgentHandler.get('/peers', async (c) => {
  const generation = await readGeneration()
  const etag = etagForGeneration(generation)
  c.header('ETag', etag)
  c.header('Cache-Control', 'no-cache')

  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  const peers = await db.vpnPeer.findMany({
    where: { NOT: { status: 'REVOKED' } },
    select: AGENT_PEER_SELECT,
    orderBy: { createdAt: 'asc' },
  })

  return c.json({
    data: peers.map(toAgentDto),
    meta: { generation, count: peers.length },
  })
})

// ---------------------------------------------------------------------------
// PATCH /peers/:id
//
// The agent reports observed kernel state for a peer:
//   - status transitions PENDING → ACTIVE once a handshake is seen
//   - lastHandshakeAt, rxBytes, txBytes counters
//
// Does NOT bump VpnState.generation — agent-pushed telemetry doesn't change
// what the agent should be doing.
// ---------------------------------------------------------------------------

const PatchPeerBody = z.object({
  status: z.enum(['PENDING', 'ACTIVE']).optional(),
  lastHandshakeAt: z.string().datetime().nullable().optional(),
  rxBytes: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  txBytes: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
})

vpnAgentHandler.patch(
  '/peers/:id',
  validator('json', (value, c) => {
    const r = PatchPeerBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const existing = await db.vpnPeer.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) return c.json({ error: 'VPN peer not found', code: 'VPN_NOT_FOUND' }, 404)

    // The agent can move PENDING → ACTIVE but must never override an operator
    // decision (SUSPENDED, REVOKED) — silently drop status updates for those.
    const promoteStatus =
      body.status !== undefined && (existing.status === 'PENDING' || existing.status === 'ACTIVE')

    const updated = await db.vpnPeer.update({
      where: { id },
      data: {
        ...(promoteStatus && body.status !== undefined ? { status: body.status } : {}),
        ...(body.lastHandshakeAt !== undefined
          ? {
              lastHandshakeAt:
                body.lastHandshakeAt === null ? null : new Date(body.lastHandshakeAt),
            }
          : {}),
        ...(body.rxBytes !== undefined ? { rxBytes: BigInt(body.rxBytes) } : {}),
        ...(body.txBytes !== undefined ? { txBytes: BigInt(body.txBytes) } : {}),
      },
      select: AGENT_PEER_SELECT,
    })

    return c.json({ data: toAgentDto(updated) })
  },
)

// ---------------------------------------------------------------------------
// GET /hub
//
// Lightweight health summary for the agent's self-report loop. Returns peer
// counts by status and the current generation so a status panel can
// distinguish "agent is up-to-date" from "agent is lagging".
// ---------------------------------------------------------------------------
vpnAgentHandler.get('/hub', async (c) => {
  const [generation, groups] = await Promise.all([
    readGeneration(),
    db.vpnPeer.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const counts: Record<string, number> = {
    PENDING: 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    REVOKED: 0,
  }
  for (const g of groups) counts[g.status] = g._count._all

  return c.json({
    data: {
      generation,
      peers: counts,
    },
  })
})
