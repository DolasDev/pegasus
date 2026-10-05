// ---------------------------------------------------------------------------
// pegII capability probe — what a tenant's on-prem pegII API build supports.
//
// Sites auto-update on their own cadence, and features that need auth are only
// mapped when the site has JWT configured, so "the route 404'd" is ambiguous:
// an old build, an unconfigured site, or a real not-found. `GET
// /api/v1/pegii/version` (deliberately unauthenticated on the pegII side)
// resolves it: it lists the capabilities this site serves right now, e.g.
// `pegii.auth.v1`, `pegii.email.v1`. A bridge call that needs a capability
// asks here first and fails with PEGII_API_CAPABILITY_MISSING (→ 503) instead of
// a confusing 404.
//
// Cached per site for a few minutes; a site without /version (an older build)
// reports no capabilities at all.
// ---------------------------------------------------------------------------

import { tunnelFetch, TunnelError } from './tunnel-client'
import { PegiiApiError } from './pegii-api-error'

/** Capability strings the platform currently depends on (see movemanager VersionEndpoints). */
export const PegiiCapabilities = {
  Version: 'pegii.version.v1',
  Idempotency: 'pegii.idempotency.v1',
  Auth: 'pegii.auth.v1',
  Email: 'pegii.email.v1',
  /** The site verifies cloud-issued tokens (lib/pegii-token.ts) and routes by `cid`. */
  CloudAuth: 'pegii.cloud-auth.v1',
  /** `GET /api/v1/pegii/salesmen` — the paged salesman directory (cloud identity I3). */
  SalesmenList: 'pegii.salesmen.list.v1',
} as const

export interface PegiiVersionInfo {
  version: string | null
  capabilities: string[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { info: PegiiVersionInfo; fetchedAt: number }>()

/** Test seam. */
export function __resetPegiiCapabilityCacheForTests(): void {
  cache.clear()
}

export interface PegiiProbeOptions {
  now?: () => number
  timeoutMs?: number
  /** Forwarded as `x-correlation-id` so the site's logs join back to the cloud request. */
  correlationId?: string
}

export async function getPegiiVersionInfo(
  baseUrl: string,
  opts: PegiiProbeOptions = {},
): Promise<PegiiVersionInfo> {
  const now = opts.now ?? Date.now
  const hit = cache.get(baseUrl)
  if (hit && now() - hit.fetchedAt < CACHE_TTL_MS) return hit.info

  let res
  try {
    res = await tunnelFetch(`${baseUrl}/api/v1/pegii/version`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(opts.correlationId ? { 'x-correlation-id': opts.correlationId } : {}),
      },
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    })
  } catch (err) {
    if (err instanceof TunnelError) {
      throw new PegiiApiError('PEGII_API_TUNNEL_ERROR', `${err.code}: ${err.message}`)
    }
    throw err
  }

  let info: PegiiVersionInfo
  if (res.status === 404) {
    info = { version: null, capabilities: [] }
  } else if (!res.ok) {
    throw new PegiiApiError(
      'PEGII_API_HTTP_ERROR',
      `pegII /version returned ${res.status}`,
      res.status,
    )
  } else {
    let json: { data?: { version?: unknown; capabilities?: unknown } }
    try {
      json = (await res.json()) as typeof json
    } catch {
      throw new PegiiApiError(
        'PEGII_API_BAD_ENVELOPE',
        'pegII /version returned a non-JSON body',
        res.status,
      )
    }
    const caps = json.data?.capabilities
    info = {
      version: typeof json.data?.version === 'string' ? json.data.version : null,
      capabilities: Array.isArray(caps)
        ? caps.filter((c): c is string => typeof c === 'string')
        : [],
    }
  }
  cache.set(baseUrl, { info, fetchedAt: now() })
  return info
}

/** Throws PEGII_API_CAPABILITY_MISSING unless the site advertises every capability given. */
export async function requirePegiiCapabilities(
  baseUrl: string,
  required: readonly string[],
  opts: PegiiProbeOptions = {},
): Promise<void> {
  const info = await getPegiiVersionInfo(baseUrl, opts)
  const missing = required.filter((c) => !info.capabilities.includes(c))
  if (missing.length > 0) {
    throw new PegiiApiError(
      'PEGII_API_CAPABILITY_MISSING',
      `this site's pegII API (${info.version ?? 'unknown version'}) does not support: ${missing.join(', ')}`,
    )
  }
}
