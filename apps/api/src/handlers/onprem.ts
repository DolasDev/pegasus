// ---------------------------------------------------------------------------
// On-prem proxy handler — cloud-side routes that round-trip through the
// WireGuard tunnel to the tenant's on-prem API server.
//
// Flow:
//   tenant browser → cloud API Lambda → tunnelFetch() → tunnel-proxy Lambda
//     (in WG VPC) → WG hub EC2 → tenant overlay IP (10.200.<o1>.<o2>)
//     → on-prem API server (apps/api running app.server.ts)
//
// This file mounts a wildcard proxy at /longhaul/* that forwards method,
// path, query string, and request body verbatim to the on-prem server.
// The on-prem server already validates and authorises every endpoint, so
// the cloud Lambda is intentionally a dumb pipe.
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
// Auth: synthesises `Authorization: Bearer ${ONPREM_API_KEY}` cloud-side
// (does not forward the caller's auth). The on-prem server treats this as
// an M2M apiClient. If ONPREM_API_KEY is unset, no auth header is sent —
// useful for connectivity-only checks against unauthenticated routes.
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

onpremHandler.all('/longhaul/*', async (c) => {
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

  // Slice the path after the /onprem prefix and prepend /api/v1 so it lines
  // up with the on-prem server's mount point. /api/v1/onprem/longhaul/trips
  // becomes /api/v1/longhaul/trips on the upstream.
  const incoming = new URL(c.req.url)
  const onpremPath = incoming.pathname.replace(/^.*?\/onprem/, '')
  const url = `${resolved.target.base}/api/v1${onpremPath}${incoming.search}`

  // Whitelist headers we forward. We intentionally do NOT forward the
  // caller's Authorization, Cookie, X-Forwarded-*, or Host headers — the
  // bridge synthesises its own bearer token below, and inbound headers
  // could leak cloud-internal state to the on-prem server.
  const headers: Record<string, string> = {
    accept: c.req.header('accept') ?? 'application/json',
  }
  const incomingContentType = c.req.header('content-type')
  if (incomingContentType) {
    headers['content-type'] = incomingContentType
  }
  const apiKey = process.env['ONPREM_API_KEY']
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`
  }

  const method = c.req.method.toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? null : await c.req.text()

  try {
    const upstream = await tunnelFetch(url, { method, headers, body })
    const contentType = upstream.headers['content-type'] ?? 'application/json'
    // Web Response constructor rejects a non-null body for null-body statuses
    // (204, 205, 304) — collapse empty strings to null so those pass through.
    const responseBody = upstream.body === '' ? null : upstream.body
    return new Response(responseBody, {
      status: upstream.status,
      headers: { 'content-type': contentType },
    })
  } catch (err) {
    if (err instanceof TunnelError) {
      const status = err.code === 'TUNNEL_NOT_CONFIGURED' ? 503 : 502
      logger.error('onprem proxy tunnel error', {
        tenantId,
        method,
        path: onpremPath,
        code: err.code,
        reason: err.message,
      })
      return c.json({ error: err.message, code: err.code, correlationId }, status)
    }
    throw err
  }
})
