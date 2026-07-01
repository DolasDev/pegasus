// ---------------------------------------------------------------------------
// pegII API client — reads the legacy pegII team's on-prem "true domain layer"
// HTTP API by round-tripping through the WireGuard tunnel.
//
// The main API Lambda runs in the public Lambda egress environment with no VPC
// attachment, so it cannot reach a tenant's on-prem overlay IP (10.200.x.x)
// directly. This client sends every request through tunnelFetch() — the in-VPC
// tunnel-proxy Lambda — exactly the way the deleted /onprem proxy did. It is a
// thin, GET-only client for the reads-first Customer slice.
//
// It reuses the platform's { data } / { error, code } response envelope shape
// (the same one packages/api-http unwraps) but cannot import that package: its
// transport is globalThis.fetch, which has no route to the overlay network from
// the Lambda. The unwrap logic is small and duplicated here on purpose.
//
// Structure mirrors lib/mssql-executor-client.ts and lib/tunnel-client.ts: a
// typed error with a closed code union, and a test-injection seam. Telemetry is
// inherited for free — tunnelFetch already wraps recordDownstream('tunnel').
// ---------------------------------------------------------------------------

import { tunnelFetch, TunnelError, type TunnelFetchResponse } from './tunnel-client'

export class PegiiApiError extends Error {
  readonly code:
    | 'PEGII_API_NOT_CONFIGURED'
    | 'PEGII_API_TUNNEL_ERROR'
    | 'PEGII_API_HTTP_ERROR'
    | 'PEGII_API_BAD_ENVELOPE'
  /** Upstream HTTP status, when the failure came from a non-2xx response. */
  readonly status?: number
  constructor(
    code:
      | 'PEGII_API_NOT_CONFIGURED'
      | 'PEGII_API_TUNNEL_ERROR'
      | 'PEGII_API_HTTP_ERROR'
      | 'PEGII_API_BAD_ENVELOPE',
    message: string,
    status?: number,
  ) {
    super(message)
    this.code = code
    this.name = 'PegiiApiError'
    if (status !== undefined) this.status = status
  }
}

export interface PegiiApiClientConfig {
  /** Owning tenant — carried for logging/telemetry, not sent on the wire. */
  tenantId: string
  /**
   * Fully-resolved base URL, e.g. "https://10.200.7.1:8443". An empty string
   * means the tenant is not configured — every call fails fast with
   * PEGII_API_NOT_CONFIGURED rather than issuing a doomed tunnel hop.
   */
  baseUrl: string
  /** Bearer credential value. Null/undefined ⇒ no Authorization header. */
  apiKey?: string | null
  /** Per-request timeout in ms enforced by the proxy Lambda. Default 15s. */
  timeoutMs?: number
}

export type PegiiQuery = Record<string, string | number | undefined>

export interface PegiiApiClient {
  /**
   * GET `path` (optionally with a query object) and return the unwrapped
   * `data` field. Throws PegiiApiError on any transport, HTTP, or envelope
   * failure. A 404 is surfaced as a PEGII_API_HTTP_ERROR with status 404 so
   * callers can translate it to a domain-appropriate null.
   */
  get<T>(path: string, query?: PegiiQuery): Promise<T>
}

function buildUrl(baseUrl: string, path: string, query?: PegiiQuery): string {
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter((entry): entry is [string, string | number] => entry[1] != null)
          .map(([k, v]): [string, string] => [k, String(v)]),
      ).toString()
    : ''
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`
}

/**
 * Construct a pegII API client bound to one tenant's resolved base URL.
 * Pure factory — no network I/O until a method is called.
 */
export function createPegiiApiClient(config: PegiiApiClientConfig): PegiiApiClient {
  return {
    async get<T>(path: string, query?: PegiiQuery): Promise<T> {
      if (!config.baseUrl) {
        throw new PegiiApiError(
          'PEGII_API_NOT_CONFIGURED',
          `pegII API base URL is not configured for tenant ${config.tenantId}`,
        )
      }

      const url = buildUrl(config.baseUrl, path, query)
      const headers: Record<string, string> = { accept: 'application/json' }
      if (config.apiKey) headers['authorization'] = `Bearer ${config.apiKey}`

      let res: TunnelFetchResponse
      try {
        res = await tunnelFetch(url, {
          method: 'GET',
          headers,
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        })
      } catch (err) {
        if (err instanceof TunnelError) {
          throw new PegiiApiError('PEGII_API_TUNNEL_ERROR', `${err.code}: ${err.message}`)
        }
        throw err
      }

      let json: unknown
      try {
        json = await res.json()
      } catch {
        throw new PegiiApiError(
          'PEGII_API_BAD_ENVELOPE',
          `pegII API returned a non-JSON body (status ${res.status})`,
          res.status,
        )
      }

      if (!res.ok) {
        const errBody = (json ?? {}) as { error?: string; code?: string }
        throw new PegiiApiError(
          'PEGII_API_HTTP_ERROR',
          `pegII API ${res.status}: ${errBody.code ?? 'UNKNOWN'} — ${errBody.error ?? res.body.slice(0, 200)}`,
          res.status,
        )
      }

      if (typeof json !== 'object' || json === null || !('data' in json)) {
        throw new PegiiApiError(
          'PEGII_API_BAD_ENVELOPE',
          'pegII API response is missing the `data` field',
          res.status,
        )
      }

      return (json as { data: T }).data
    },
  }
}

/** True when an error is a pegII 404 (upstream resource not found). */
export function isPegiiNotFound(err: unknown): boolean {
  return err instanceof PegiiApiError && err.code === 'PEGII_API_HTTP_ERROR' && err.status === 404
}
