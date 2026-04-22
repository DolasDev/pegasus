// ---------------------------------------------------------------------------
// Tunnel client — fetch-like wrapper that routes HTTPS calls through the
// in-VPC tunnel-proxy Lambda (apps/tunnel-proxy).
//
// The main API Lambda runs in the public Lambda egress environment (no VPC
// attachment, full public internet). That's the right shape for ~99% of
// requests (Cognito, Neon, S3). A small number of handlers need to reach
// tenant overlay IPs through the WireGuard tunnel; those handlers call
// tunnelFetch() instead of the native fetch().
//
// This is pure data-plane: auth, retries, telemetry are the caller's job.
// We do surface the proxy's network errors as a distinct TunnelError so
// callers can translate them into HTTP 502 / 504 shapes.
// ---------------------------------------------------------------------------

import { LambdaClient, InvokeCommand, type LambdaClientConfig } from '@aws-sdk/client-lambda'

export class TunnelError extends Error {
  readonly code: 'TUNNEL_NOT_CONFIGURED' | 'TUNNEL_INVOKE_FAILED' | 'TUNNEL_PROXY_ERROR'
  constructor(
    code: 'TUNNEL_NOT_CONFIGURED' | 'TUNNEL_INVOKE_FAILED' | 'TUNNEL_PROXY_ERROR',
    message: string,
  ) {
    super(message)
    this.code = code
    this.name = 'TunnelError'
  }
}

interface ProxyRequestPayload {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string | null
  timeoutMs?: number
}

interface ProxyResponsePayload {
  status: number
  headers: Record<string, string>
  body: string
}

interface TunnelFetchOptions {
  /** HTTP method. Default GET. */
  method?: string
  /** HTTP headers (flat string-to-string map). */
  headers?: Record<string, string>
  /** Already-serialised request body — caller owns stringification. */
  body?: string | null
  /**
   * Timeout enforced by the proxy Lambda itself (AbortController on its
   * own fetch call). Hard ceiling is the proxy's Lambda timeout (30s).
   * Default 15s.
   */
  timeoutMs?: number
}

let _client: LambdaClient | null = null
function getClient(): LambdaClient {
  if (_client === null) {
    const config: LambdaClientConfig = {}
    _client = new LambdaClient(config)
  }
  return _client
}

/**
 * Override the LambdaClient instance. Tests inject a stubbed client with
 * a `send` mock so they don't hit the real AWS SDK.
 */
export function setTunnelLambdaClient(client: LambdaClient | null): void {
  _client = client
}

/**
 * Invoke the tunnel-proxy Lambda synchronously. Returns an object shaped
 * like a minimal `Response` (status, headers, text/json accessors).
 */
export async function tunnelFetch(
  url: string,
  init: TunnelFetchOptions = {},
): Promise<TunnelFetchResponse> {
  const fnName = process.env['TUNNEL_PROXY_FUNCTION_NAME']
  if (!fnName) {
    throw new TunnelError(
      'TUNNEL_NOT_CONFIGURED',
      'TUNNEL_PROXY_FUNCTION_NAME env var is not set — cannot route tunnel request',
    )
  }

  const payload: ProxyRequestPayload = {
    method: init.method ?? 'GET',
    url,
    ...(init.headers !== undefined ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.timeoutMs !== undefined ? { timeoutMs: init.timeoutMs } : {}),
  }

  const client = getClient()
  const res = await client.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'RequestResponse',
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  )

  if (res.FunctionError) {
    const errBody = res.Payload ? new TextDecoder().decode(res.Payload) : '<empty>'
    throw new TunnelError(
      'TUNNEL_PROXY_ERROR',
      `tunnel-proxy raised ${res.FunctionError}: ${errBody}`,
    )
  }
  if (!res.Payload) {
    throw new TunnelError('TUNNEL_INVOKE_FAILED', 'tunnel-proxy returned empty payload')
  }

  const decoded = JSON.parse(new TextDecoder().decode(res.Payload)) as ProxyResponsePayload
  return new TunnelFetchResponse(decoded)
}

/**
 * Response wrapper. Mirrors the bits of the DOM `Response` shape that most
 * callers care about: `status`, `headers`, `text()`, `json()`. Not a full
 * Response — no streaming, no ReadableBody.
 */
export class TunnelFetchResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string

  constructor(payload: ProxyResponsePayload) {
    this.status = payload.status
    this.headers = payload.headers
    this.body = payload.body
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }

  text(): Promise<string> {
    return Promise.resolve(this.body)
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(this.body) as T
  }
}
