// ---------------------------------------------------------------------------
// On-prem proxy handler — cloud-side routes that round-trip through the
// WireGuard tunnel to the tenant's on-prem API server.
//
// Flow:
//   tenant browser → cloud API Lambda → tunnelFetch() → tunnel-proxy Lambda
//     (in WG VPC) → WG hub EC2 → tenant overlay IP (10.200.<o1>.<o2>)
//     → on-prem API server (apps/api running app.server.ts)
//
// This file is the cloud-side smoke target. It currently exposes one route
// (GET /longhaul/version) so we can prove the full path end-to-end before
// migrating the rest of the longhaul / pegii / efwk surfaces over.
//
// URL resolution:
//   - Default: look up the tenant's VpnPeer row, build
//     `http://10.200.<o1>.<o2>:<port>` (scheme from ONPREM_TUNNEL_SCHEME,
//     port from ONPREM_TUNNEL_PORT — defaults http/3000 because the WG
//     tunnel already provides confidentiality + peer auth, and the on-prem
//     Hono server defaults to plain HTTP on :3000).
//   - Override: if ONPREM_TUNNEL_BASE_OVERRIDE is set, use it verbatim as
//     the base. Used for smoke-testing a single tenant.
//
// Auth: forwards `Authorization: Bearer ${ONPREM_API_KEY}` when set. If
// unset, no auth header is sent (works against unauthenticated routes like
// the on-prem /health for connectivity-only checks).
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { tunnelFetch, TunnelError } from '../lib/tunnel-client'
import { logger } from '../lib/logger'

export const onpremHandler = new Hono<AppEnv>()

interface OverlayTarget {
  base: string
}

async function resolveOverlayTarget(
  db: ReturnType<(c: { get: (k: 'db') => unknown }) => unknown> & {
    vpnPeer: {
      findUnique: (args: {
        where: { tenantId: string }
        select: { assignedOctet1: true; assignedOctet2: true; status: true }
      }) => Promise<{ assignedOctet1: number; assignedOctet2: number; status: string } | null>
    }
  },
  tenantId: string,
): Promise<{ ok: true; target: OverlayTarget } | { ok: false; code: string; message: string }> {
  const override = process.env['ONPREM_TUNNEL_BASE_OVERRIDE']
  if (override) {
    return { ok: true, target: { base: override.replace(/\/$/, '') } }
  }

  const peer = await db.vpnPeer.findUnique({
    where: { tenantId },
    select: { assignedOctet1: true, assignedOctet2: true, status: true },
  })
  if (!peer) {
    return { ok: false, code: 'TUNNEL_NO_PEER', message: 'tenant has no WireGuard peer' }
  }
  if (peer.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'TUNNEL_PEER_INACTIVE',
      message: `tenant peer is ${peer.status}, not ACTIVE`,
    }
  }

  const port = process.env['ONPREM_TUNNEL_PORT'] ?? '3000'
  const scheme = process.env['ONPREM_TUNNEL_SCHEME'] ?? 'http'
  return {
    ok: true,
    target: {
      base: `${scheme}://10.200.${peer.assignedOctet1}.${peer.assignedOctet2}:${port}`,
    },
  }
}

onpremHandler.get('/longhaul/version', async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId')
  const db = c.get('db') as unknown as Parameters<typeof resolveOverlayTarget>[0]

  const resolved = await resolveOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('onprem proxy unavailable', {
      tenantId,
      code: resolved.code,
      reason: resolved.message,
    })
    return c.json({ error: resolved.message, code: resolved.code, correlationId }, 503)
  }

  const url = `${resolved.target.base}/api/v1/longhaul/version`
  const headers: Record<string, string> = { accept: 'application/json' }
  const apiKey = process.env['ONPREM_API_KEY']
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`
  }

  try {
    const upstream = await tunnelFetch(url, { method: 'GET', headers, timeoutMs: 10_000 })
    const contentType = upstream.headers['content-type'] ?? 'application/json'
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': contentType },
    })
  } catch (err) {
    if (err instanceof TunnelError) {
      const status = err.code === 'TUNNEL_NOT_CONFIGURED' ? 503 : 502
      logger.error('onprem proxy tunnel error', {
        tenantId,
        code: err.code,
        reason: err.message,
      })
      return c.json({ error: err.message, code: err.code, correlationId }, status)
    }
    throw err
  }
})
