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
// On network failure the proxy throws — the caller sees the invoke as a
// Lambda function error (FunctionError: "Unhandled") and can translate that
// to whatever upstream shape it wants.
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
  const timer = setTimeout(() => controller.abort(), timeoutMs)

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

    return {
      status: res.status,
      headers: responseHeaders,
      body,
    }
  } finally {
    clearTimeout(timer)
  }
}
