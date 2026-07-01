// ---------------------------------------------------------------------------
// pegII overlay-target resolver — turns a tenant into a base URL + credential
// for the pegII team's on-prem domain API reached over the WireGuard tunnel.
//
// Mirrors the resolveOverlayTarget() helper from the (deleted) /onprem proxy
// handler, but points at the pegII team's NEW API rather than this repo's own
// app.server.ts on-prem server. It therefore uses a distinct set of env vars
// (PEGII_API_TUNNEL_*) so there is zero collision with the dead ONPREM_* set.
//
// Precedence:
//   1. Tenant.pegiiApiBaseUrl        — explicit per-tenant base URL (wins).
//   2. PEGII_API_TUNNEL_BASE_OVERRIDE — global single-tenant smoke-test base.
//   3. VpnPeer overlay IP            — http(s)://10.200.<o1>.<o2>:<port>.
//
// The credential (Tenant.pegiiApiKeyRef) is returned alongside the base so the
// caller can build a PegiiApiClient. It is stored by reference (a Secrets
// Manager ARN) and is NEVER logged or returned to clients.
// ---------------------------------------------------------------------------

/** Minimal Prisma surface this resolver needs — keeps it unit-testable. */
export interface PegiiOverlayDb {
  tenant: {
    findUnique: (args: {
      where: { id: string }
      select: { pegiiApiBaseUrl: true; pegiiApiKeyRef: true }
    }) => Promise<{ pegiiApiBaseUrl: string | null; pegiiApiKeyRef: string | null } | null>
  }
  vpnPeer: {
    findUnique: (args: {
      where: { tenantId: string }
      select: { assignedOctet1: true; assignedOctet2: true; status: true }
    }) => Promise<{ assignedOctet1: number; assignedOctet2: number; status: string } | null>
  }
}

export interface PegiiOverlayTarget {
  /** Fully-resolved base URL, no trailing slash. */
  base: string
  /** Bearer credential reference, or null when unconfigured. */
  apiKey: string | null
}

export type ResolvePegiiOverlayResult =
  | { ok: true; target: PegiiOverlayTarget }
  | { ok: false; code: 'PEGII_API_NO_PEER' | 'PEGII_API_PEER_INACTIVE'; message: string }

/**
 * Resolve the pegII API base URL + credential for a tenant. Returns a
 * discriminated result so callers can map the failure modes onto stable
 * response codes without try/catch.
 */
export async function resolvePegiiOverlayTarget(
  db: PegiiOverlayDb,
  tenantId: string,
): Promise<ResolvePegiiOverlayResult> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { pegiiApiBaseUrl: true, pegiiApiKeyRef: true },
  })
  const apiKey = tenant?.pegiiApiKeyRef ?? null

  // 1. Explicit per-tenant base URL wins.
  if (tenant?.pegiiApiBaseUrl) {
    return { ok: true, target: { base: tenant.pegiiApiBaseUrl.replace(/\/$/, ''), apiKey } }
  }

  // 2. Global override (single-tenant smoke testing).
  const override = process.env['PEGII_API_TUNNEL_BASE_OVERRIDE']
  if (override) {
    return { ok: true, target: { base: override.replace(/\/$/, ''), apiKey } }
  }

  // 3. Derive from the tenant's WireGuard overlay IP.
  const peer = await db.vpnPeer.findUnique({
    where: { tenantId },
    select: { assignedOctet1: true, assignedOctet2: true, status: true },
  })
  if (!peer) {
    return { ok: false, code: 'PEGII_API_NO_PEER', message: 'tenant has no WireGuard peer' }
  }
  if (peer.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'PEGII_API_PEER_INACTIVE',
      message: `tenant peer is ${peer.status}, not ACTIVE`,
    }
  }

  const scheme = process.env['PEGII_API_TUNNEL_SCHEME'] ?? 'https'
  const port = process.env['PEGII_API_TUNNEL_PORT'] ?? '8443'
  return {
    ok: true,
    target: {
      base: `${scheme}://10.200.${peer.assignedOctet1}.${peer.assignedOctet2}:${port}`,
      apiKey,
    },
  }
}
