// ---------------------------------------------------------------------------
// VPC tunnel proxy Lambda.
//
// Lives in the WireGuard VPC's private-lambda subnet. Its only outbound path
// is the route `10.200.0.0/16 → hub ENI`, so it can only talk to tenant
// overlay IPs. The main (public) API Lambda synchronously invokes this
// function whenever a handler needs to call a tenant web API.
//
// Payload (the invoke body):
//   {
//     method:  "GET" | "POST" | ...
//     url:     "https://10.200.7.1/some/path?query=1"
//     headers: Record<string,string>
//     body:    string (already serialised by caller) | null
//     timeoutMs?: number   // default 15_000
//   }
//
// Response:
//   {
//     status: number
//     headers: Record<string,string>
//     body:    string
//   }
//
// On network failure the proxy returns a synthetic response (504 for timeout,
// 502 for other fetch errors) with a JSON body and `x-tunnel-proxy-error`
// header, so the caller sees a normal ProxyResponse instead of a Lambda
// FunctionError. Argument-validation errors still throw — those are bugs in
// the caller, not transient network conditions.
// ---------------------------------------------------------------------------

export interface ProxyRequest {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string | null
  /** Default 15_000 ms. Hard ceiling is the Lambda timeout. */
  timeoutMs?: number
}

export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const DEFAULT_TIMEOUT_MS = 15_000

export async function handler(event: ProxyRequest): Promise<ProxyResponse> {
  return proxy(event, globalThis.fetch)
}

/**
 * Core proxy function — exported with an injectable fetch so tests can
 * exercise it without hitting the network.
 */
export async function proxy(event: ProxyRequest, fetchImpl: typeof fetch): Promise<ProxyResponse> {
  if (!event?.method || !event?.url) {
    throw new Error('Proxy request missing required `method` or `url`')
  }

  const controller = new AbortController()
  const timeoutMs = event.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const startedAt = Date.now()
  log('info', 'tunnel_proxy_request_start', {
    method: event.method,
    url: event.url,
    timeoutMs,
    headerKeys: Object.keys(event.headers ?? {}),
    bodyBytes: event.body != null ? event.body.length : 0,
  })

  try {
    const res = await fetchImpl(event.url, {
      method: event.method,
      headers: event.headers ?? {},
      ...(event.body != null ? { body: event.body } : {}),
      signal: controller.signal,
    })

    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    const body = await res.text()

    log('info', 'tunnel_proxy_request_ok', {
      method: event.method,
      url: event.url,
      status: res.status,
      durationMs: Date.now() - startedAt,
      bodyBytes: body.length,
    })

    return {
      status: res.status,
      headers: responseHeaders,
      body,
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
      log('error', 'tunnel_proxy_request_timeout', {
        method: event.method,
        url: event.url,
        timeoutMs,
        durationMs,
      })
      return synthError(504, 'TUNNEL_TIMEOUT', `tunnel proxy timed out after ${timeoutMs}ms`, {
        url: event.url,
        method: event.method,
      })
    }
    const errName = err instanceof Error ? err.name : 'UnknownError'
    const errMessage = err instanceof Error ? err.message : String(err)
    const errCause =
      err instanceof Error && 'cause' in err && err.cause instanceof Error
        ? `${err.cause.name}: ${err.cause.message}`
        : undefined
    log('error', 'tunnel_proxy_request_failed', {
      method: event.method,
      url: event.url,
      durationMs,
      errName,
      errMessage,
      ...(errCause !== undefined ? { errCause } : {}),
    })
    return synthError(
      502,
      'TUNNEL_NETWORK_ERROR',
      `tunnel proxy fetch failed — ${errName}: ${errMessage}`,
      { url: event.url, method: event.method },
    )
  } finally {
    clearTimeout(timer)
  }
}

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields })
  if (level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }
}

function synthError(
  status: number,
  code: string,
  message: string,
  detail: Record<string, unknown>,
): ProxyResponse {
  return {
    status,
    headers: {
      'content-type': 'application/json',
      'x-tunnel-proxy-error': code,
    },
    body: JSON.stringify({ error: message, code, ...detail }),
  }
}
