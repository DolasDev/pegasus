// ---------------------------------------------------------------------------
// pegII API client — reads the legacy pegII team's on-prem "true domain layer"
// HTTP API by round-tripping through the WireGuard tunnel.
//
// The main API Lambda runs in the public Lambda egress environment with no VPC
// attachment, so it cannot reach a tenant's on-prem overlay IP (10.200.x.x)
// directly. This client sends every request through tunnelFetch() — the in-VPC
// tunnel-proxy Lambda — exactly the way the deleted /onprem proxy did.
//
// Auth: every data call carries a cloud-issued token for the calling principal
// (pegii-token.ts); a 401 drops the cached token, re-mints and retries once. A
// site that can't take a cloud token — no caller, the site's cloudAuthEnabled
// switch off, or /version without `pegii.cloud-auth.v1` — fails fast with
// PEGII_API_CAPABILITY_MISSING before anything is sent. The hub service-user
// login (`pegii.auth.v1`) and the raw-bearer credential are retired.
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
import { getPegiiVersionInfo, PegiiCapabilities } from './pegii-capabilities'
import { createCloudTokenProvider, type PegiiTokenProvider } from './pegii-token'
import type { PegiiCaller } from './pegii-request-context'

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
   * Who is calling and for which company (lib/pegii-request-context.ts). Every
   * data call carries a cloud-issued token for this principal, and
   * `x-correlation-id` is forwarded on every request. Without a caller, data
   * calls fail fast with PEGII_API_CAPABILITY_MISSING; only `getHealth()` works.
   */
  caller?: PegiiCaller
  /** Test seam: supply the token provider instead of minting cloud tokens for `caller`. */
  auth?: PegiiTokenProvider
  /** Per-request timeout in ms enforced by the proxy Lambda. Default 15s. */
  timeoutMs?: number
}

export type PegiiQuery = Record<string, string | number | undefined>

/** An unwrapped `data` plus the response headers, keyed by lower-cased name. */
export interface PegiiResponse<T> {
  data: T
  headers: Record<string, string>
}

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
   * PATCH a JSON body and return the unwrapped `data` together with the response
   * headers (lower-cased names), for endpoints that report an outcome in a header
   * (the order write-back's `x-pegasus-applied`). Same error contract as `get`.
   */
  patch<T>(path: string, body: unknown): Promise<PegiiResponse<T>>

  /**
   * GET `/health` and return the parsed status body as-is. Unlike `get()`,
   * this does NOT require (or unwrap) a `data` envelope — the pegII team's
   * health endpoint returns a bare `{"status":"healthy"}`. The endpoint is
   * unauthenticated, so no Authorization header is sent and no caller is
   * needed. Throws PegiiApiError on transport failure, non-2xx, or a
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
  const correlationHeader: Record<string, string> = config.caller
    ? { 'x-correlation-id': config.caller.correlationId }
    : {}

  /** The site can't take a cloud token; thrown before any data request goes out. */
  const cannotAuthenticate = (why: string) =>
    new PegiiApiError(
      'PEGII_API_CAPABILITY_MISSING',
      `this pegII site cannot be called with a cloud-issued token: ${why}`,
    )

  // Chosen once per client, lazily (it may probe /version). There is no
  // fallback credential: a site that can't verify a cloud token is refused.
  let authChoice: Promise<PegiiTokenProvider> | null = null
  function resolveAuth(): Promise<PegiiTokenProvider> {
    if (config.auth) return Promise.resolve(config.auth)
    authChoice ??= (async () => {
      const caller = config.caller
      if (!caller) throw cannotAuthenticate('no calling principal was supplied')
      // The operator switch gates the cloud path; the unauthenticated /version
      // probe can only CONFIRM it (the site's build supports it), never initiate
      // it — so a spoofed or stale /version can't make us mint a token for
      // whatever answers on the overlay.
      if (!caller.site.cloudAuthEnabled) {
        throw cannotAuthenticate(`cloud auth is not enabled for site ${caller.site.id}`)
      }
      // A failed probe propagates as-is: there is nothing to fall back to.
      const info = await getPegiiVersionInfo(config.baseUrl, {
        correlationId: caller.correlationId,
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      })
      if (!info.capabilities.includes(PegiiCapabilities.CloudAuth)) {
        throw cannotAuthenticate(
          `the site's API (${info.version ?? 'unknown version'}) does not advertise ${PegiiCapabilities.CloudAuth}`,
        )
      }
      return createCloudTokenProvider({
        tenantId: caller.tenantId,
        siteId: caller.site.id,
        company: caller.company,
        principal: caller.principal,
      })
    })()
    // Don't pin a failure (e.g. a transient probe error) for the client's lifetime.
    authChoice.catch(() => {
      authChoice = null
    })
    return authChoice
  }

  async function send(
    method: string,
    url: string,
    body: string | undefined,
    token: string,
  ): Promise<TunnelFetchResponse> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...correlationHeader,
      authorization: `Bearer ${token}`,
    }
    if (body !== undefined) headers['content-type'] = 'application/json'
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
    return (await requestWithHeaders<T>(method, path, query, payload)).data
  }

  async function requestWithHeaders<T>(
    method: string,
    path: string,
    query?: PegiiQuery,
    payload?: unknown,
  ): Promise<PegiiResponse<T>> {
    if (!config.baseUrl) {
      throw new PegiiApiError(
        'PEGII_API_NOT_CONFIGURED',
        `pegII API base URL is not configured for tenant ${config.tenantId}`,
      )
    }
    const url = buildUrl(config.baseUrl, path, query)
    const body = payload !== undefined ? JSON.stringify(payload) : undefined

    const auth = await resolveAuth()
    let res = await send(method, url, body, await auth.getToken())
    if (res.status === 401) {
      // Expired or revoked token: get a fresh one and retry exactly once.
      auth.invalidate()
      res = await send(method, url, body, await auth.getToken())
      if (res.status === 401) {
        throw new PegiiApiError(
          'PEGII_API_AUTH_FAILED',
          'pegII rejected a freshly issued token',
          401,
        )
      }
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

    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(res.headers ?? {}))
      headers[name.toLowerCase()] = value
    return { data: (json as { data: T }).data, headers }
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

    patch<T>(path: string, body: unknown): Promise<PegiiResponse<T>> {
      return requestWithHeaders<T>('PATCH', path, undefined, body)
    },

    async getHealth(): Promise<PegiiHealth> {
      if (!config.baseUrl) {
        throw new PegiiApiError(
          'PEGII_API_NOT_CONFIGURED',
          `pegII API base URL is not configured for tenant ${config.tenantId}`,
        )
      }

      // Health is an open endpoint — never an Authorization header.
      const url = `${config.baseUrl}/health`
      let res: TunnelFetchResponse
      try {
        res = await tunnelFetch(url, {
          method: 'GET',
          headers: { accept: 'application/json', ...correlationHeader },
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
  return (
    err instanceof PegiiApiError &&
    err.code === 'PEGII_API_HTTP_ERROR' &&
    err.status === 404 &&
    // The site has no database for the token's `cid` — a site configuration
    // problem, not "no such record". Never null-mapped into a not-found.
    err.upstreamCode !== PEGII_COMPANY_NOT_FOUND
  )
}

/** pegII: the token's `cid` names no `SpokeConnections` entry on this site (I2). */
export const PEGII_COMPANY_NOT_FOUND = 'COMPANY_NOT_FOUND'
/** pegII: the company's database failed its startup migration (I2). */
export const PEGII_COMPANY_SCHEMA_UNAVAILABLE = 'COMPANY_SCHEMA_UNAVAILABLE'

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
 * - capability missing  → 503 (the site's API build lacks this feature, or
 *                         can't take a cloud-issued token)
 * - auth failed         → 502 (the site rejected a fresh cloud token)
 * - tunnel error        → 502 (couldn't complete the upstream hop — firewall/timeout/refused)
 * - bad envelope        → 502 (source answered with something unusable)
 * - company not on site → 404 COMPANY_NOT_FOUND (the `cid` isn't in SpokeConnections)
 * - company DB unmigrated → 503 COMPANY_SCHEMA_UNAVAILABLE
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
    case 'PEGII_API_CAPABILITY_MISSING':
      return {
        status: 503,
        code: 'PEGII_CAPABILITY_MISSING',
        message: err.message,
      }
    case 'PEGII_PRINCIPAL_UNRESOLVED':
      return {
        status: 503,
        code: 'PEGII_PRINCIPAL_UNRESOLVED',
        message: err.message,
      }
    case 'PEGII_TOKEN_NOT_CONFIGURED':
      return {
        status: 503,
        code: 'PEGII_TOKEN_NOT_CONFIGURED',
        message: 'pegII token issuing is not configured on this platform',
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
      if (err.upstreamCode === PEGII_COMPANY_NOT_FOUND) {
        return {
          status: 404,
          code: PEGII_COMPANY_NOT_FOUND,
          message:
            "the pegII site has no database configured for this company (check the site's SpokeConnections)",
        }
      }
      if (err.upstreamCode === PEGII_COMPANY_SCHEMA_UNAVAILABLE) {
        return {
          status: 503,
          code: PEGII_COMPANY_SCHEMA_UNAVAILABLE,
          message:
            "this company's database failed its schema migration on the pegII site; restart the site's API after fixing it",
        }
      }
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
