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
   * Fully-resolved base URL, e.g. "http://10.200.7.1:65274". An empty string
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

/**
 * Body shape of the pegII team's `GET /health` probe. It is a bare status
 * object (e.g. `{"status":"healthy"}`) — deliberately NOT the platform
 * `{ data }` envelope the domain read endpoints use, so it is parsed by
 * `getHealth()` rather than `get()`.
 */
export interface PegiiHealth {
  status?: string
  [key: string]: unknown
}

export interface PegiiApiClient {
  /**
   * GET `path` (optionally with a query object) and return the unwrapped
   * `data` field. Throws PegiiApiError on any transport, HTTP, or envelope
   * failure. A 404 is surfaced as a PEGII_API_HTTP_ERROR with status 404 so
   * callers can translate it to a domain-appropriate null.
   */
  get<T>(path: string, query?: PegiiQuery): Promise<T>

  /**
   * GET `/health` and return the parsed status body as-is. Unlike `get()`,
   * this does NOT require (or unwrap) a `data` envelope — the pegII team's
   * health endpoint returns a bare `{"status":"healthy"}`. The endpoint is
   * unauthenticated, so no Authorization header is sent even when an apiKey is
   * configured. Throws PegiiApiError on transport failure, non-2xx, or a
   * non-JSON body.
   */
  getHealth(): Promise<PegiiHealth>
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

    async getHealth(): Promise<PegiiHealth> {
      if (!config.baseUrl) {
        throw new PegiiApiError(
          'PEGII_API_NOT_CONFIGURED',
          `pegII API base URL is not configured for tenant ${config.tenantId}`,
        )
      }

      // Health is an open endpoint — no Authorization header even when an
      // apiKey is configured.
      const url = `${config.baseUrl}/health`
      let res: TunnelFetchResponse
      try {
        res = await tunnelFetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        })
      } catch (err) {
        if (err instanceof TunnelError) {
          throw new PegiiApiError('PEGII_API_TUNNEL_ERROR', `${err.code}: ${err.message}`)
        }
        throw err
      }

      if (!res.ok) {
        throw new PegiiApiError(
          'PEGII_API_HTTP_ERROR',
          `pegII API /health returned ${res.status}: ${res.body.slice(0, 200)}`,
          res.status,
        )
      }

      let json: unknown
      try {
        json = await res.json()
      } catch {
        throw new PegiiApiError(
          'PEGII_API_BAD_ENVELOPE',
          `pegII API /health returned a non-JSON body (status ${res.status})`,
          res.status,
        )
      }

      if (typeof json !== 'object' || json === null) {
        throw new PegiiApiError(
          'PEGII_API_BAD_ENVELOPE',
          `pegII API /health returned a non-object body (status ${res.status})`,
          res.status,
        )
      }

      return json as PegiiHealth
    },
  }
}

/** True when an error is a pegII 404 (upstream resource not found). */
export function isPegiiNotFound(err: unknown): boolean {
  return err instanceof PegiiApiError && err.code === 'PEGII_API_HTTP_ERROR' && err.status === 404
}

/** Client-facing HTTP shape a pegII-bridge route returns for a PegiiApiError. */
export interface PegiiHttpError {
  status: 404 | 502 | 503
  code: string
  message: string
}

/**
 * Map a PegiiApiError to a client-facing HTTP status that names the dependency,
 * so a pegII-bridge route distinguishes "upstream unreachable" (502/503) and
 * "not found" (404) from a genuine bridge bug (500, reserved for anything that
 * is NOT a PegiiApiError). Used by the pegII runtime router's error boundary.
 *
 * - not configured   → 503 (nothing to reach for this tenant)
 * - tunnel error      → 502 (couldn't complete the upstream hop — firewall/timeout/refused)
 * - bad envelope      → 502 (source answered with something unusable)
 * - upstream 404      → 404 (no such order/task)
 * - other upstream    → 502 (source rejected/failed the request)
 */
export function pegiiApiErrorToHttp(err: PegiiApiError): PegiiHttpError {
  switch (err.code) {
    case 'PEGII_API_NOT_CONFIGURED':
      return {
        status: 503,
        code: 'PEGII_SOURCE_UNAVAILABLE',
        message: 'pegII order source is not configured for this tenant',
      }
    case 'PEGII_API_TUNNEL_ERROR':
      return {
        status: 502,
        code: 'PEGII_SOURCE_UNREACHABLE',
        message: `pegII source unreachable: ${err.message}`,
      }
    case 'PEGII_API_BAD_ENVELOPE':
      return {
        status: 502,
        code: 'PEGII_SOURCE_BAD_RESPONSE',
        message: `pegII source returned an invalid response: ${err.message}`,
      }
    case 'PEGII_API_HTTP_ERROR':
      if (err.status === 404) {
        return { status: 404, code: 'NOT_FOUND', message: 'not found' }
      }
      return {
        status: 502,
        code: 'PEGII_SOURCE_BAD_RESPONSE',
        message: `pegII source returned an error: ${err.message}`,
      }
  }
}
