// ---------------------------------------------------------------------------
// pegII API client — reads the legacy pegII team's on-prem "true domain layer"
// HTTP API by round-tripping through the WireGuard tunnel.
//
// The main API Lambda runs in the public Lambda egress environment with no VPC
// attachment, so it cannot reach a tenant's on-prem overlay IP (10.200.x.x)
// directly. This client sends every request through tunnelFetch() — the in-VPC
// tunnel-proxy Lambda — exactly the way the deleted /onprem proxy did.
//
// Auth: when the tenant's credential reference is a Secrets Manager ARN, calls
// carry a bearer token for the tenant's pegII service user (pegii-auth.ts); a
// 401 drops the cached token, logs in again and retries once. Any other
// credential value is sent as a raw bearer, as before.
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
import { PegiiApiError } from './pegii-api-error'
import {
  createPegiiTokenProvider,
  isPegiiCredentialSecretRef,
  type PegiiTokenProvider,
} from './pegii-auth'

export { PegiiApiError } from './pegii-api-error'
export type { PegiiApiErrorCode } from './pegii-api-error'

export interface PegiiApiClientConfig {
  /** Owning tenant — carried for logging/telemetry, not sent on the wire. */
  tenantId: string
  /**
   * Fully-resolved base URL, e.g. "http://10.200.7.1:65274". An empty string
   * means the tenant is not configured — every call fails fast with
   * PEGII_API_NOT_CONFIGURED rather than issuing a doomed tunnel hop.
   */
  baseUrl: string
  /**
   * The tenant's pegII credential reference (`Tenant.pegiiApiKeyRef`). A Secrets
   * Manager ARN ⇒ service-user JWT login (pegii-auth.ts); any other non-empty
   * value ⇒ sent as a raw bearer; null/undefined ⇒ no Authorization header.
   */
  apiKey?: string | null
  /** Test seam: supply the token provider instead of building one from `apiKey`. */
  auth?: PegiiTokenProvider
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

  /** POST a JSON body and return the unwrapped `data`. Same error contract as `get`. */
  post<T>(path: string, body: unknown): Promise<T>

  /** PUT a JSON body and return the unwrapped `data`. Same error contract as `get`. */
  put<T>(path: string, body: unknown): Promise<T>

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
  const auth: PegiiTokenProvider | null =
    config.auth ??
    (isPegiiCredentialSecretRef(config.apiKey)
      ? createPegiiTokenProvider({
          tenantId: config.tenantId,
          baseUrl: config.baseUrl,
          secretArn: config.apiKey,
          ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        })
      : null)

  async function send(
    method: string,
    url: string,
    body: string | undefined,
    token: string | null,
  ): Promise<TunnelFetchResponse> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (token) headers['authorization'] = `Bearer ${token}`
    try {
      return await tunnelFetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      })
    } catch (err) {
      if (err instanceof TunnelError) {
        throw new PegiiApiError('PEGII_API_TUNNEL_ERROR', `${err.code}: ${err.message}`)
      }
      throw err
    }
  }

  async function request<T>(
    method: string,
    path: string,
    query?: PegiiQuery,
    payload?: unknown,
  ): Promise<T> {
    if (!config.baseUrl) {
      throw new PegiiApiError(
        'PEGII_API_NOT_CONFIGURED',
        `pegII API base URL is not configured for tenant ${config.tenantId}`,
      )
    }
    const url = buildUrl(config.baseUrl, path, query)
    const body = payload !== undefined ? JSON.stringify(payload) : undefined

    let res: TunnelFetchResponse
    if (auth) {
      res = await send(method, url, body, await auth.getToken())
      if (res.status === 401) {
        // Expired or revoked token: log in again and retry exactly once.
        auth.invalidate()
        res = await send(method, url, body, await auth.getToken())
        if (res.status === 401) {
          throw new PegiiApiError(
            'PEGII_API_AUTH_FAILED',
            'pegII rejected a freshly issued service-user token',
            401,
          )
        }
      }
    } else {
      res = await send(method, url, body, config.apiKey || null)
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
        errBody.code ?? undefined,
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
  }

  return {
    get<T>(path: string, query?: PegiiQuery): Promise<T> {
      return request<T>('GET', path, query)
    },

    post<T>(path: string, body: unknown): Promise<T> {
      return request<T>('POST', path, undefined, body)
    },

    put<T>(path: string, body: unknown): Promise<T> {
      return request<T>('PUT', path, undefined, body)
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
  status: 400 | 404 | 409 | 422 | 502 | 503
  code: string
  message: string
}

/**
 * Map a PegiiApiError to a client-facing HTTP status that names the dependency,
 * so a pegII-bridge route distinguishes "upstream unreachable" (502/503) and
 * "not found" (404) from a genuine bridge bug (500, reserved for anything that
 * is NOT a PegiiApiError). Used by the pegII runtime router's error boundary.
 *
 * - not configured      → 503 (nothing to reach for this tenant)
 * - login unavailable   → 503 (the site has no auth configured yet)
 * - capability missing  → 503 (the site's API build lacks this feature)
 * - auth failed         → 502 (the site rejected our service user)
 * - tunnel error        → 502 (couldn't complete the upstream hop — firewall/timeout/refused)
 * - bad envelope        → 502 (source answered with something unusable)
 * - upstream 404        → 404 (no such order/task)
 * - upstream 400/409/422 → passed through with pegII's own code: the caller's
 *   request was wrong or conflicted, not the source broken
 * - other upstream      → 502 (source rejected/failed the request)
 */
export function pegiiApiErrorToHttp(err: PegiiApiError): PegiiHttpError {
  switch (err.code) {
    case 'PEGII_API_NOT_CONFIGURED':
      return {
        status: 503,
        code: 'PEGII_SOURCE_UNAVAILABLE',
        message: 'pegII order source is not configured for this tenant',
      }
    case 'PEGII_API_AUTH_UNAVAILABLE':
      return {
        status: 503,
        code: 'PEGII_AUTH_UNAVAILABLE',
        message: `pegII source has no login configured: ${err.message}`,
      }
    case 'PEGII_API_CAPABILITY_MISSING':
      return {
        status: 503,
        code: 'PEGII_CAPABILITY_MISSING',
        message: err.message,
      }
    case 'PEGII_API_AUTH_FAILED':
      return {
        status: 502,
        code: 'PEGII_SOURCE_AUTH_FAILED',
        message: `pegII source rejected the platform's credentials: ${err.message}`,
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
      if (err.status === 400 || err.status === 409 || err.status === 422) {
        return {
          status: err.status,
          code: err.upstreamCode ?? (err.status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT'),
          message: err.message,
        }
      }
      return {
        status: 502,
        code: 'PEGII_SOURCE_BAD_RESPONSE',
        message: `pegII source returned an error: ${err.message}`,
      }
  }
}
