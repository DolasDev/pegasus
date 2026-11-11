export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface PaginationMeta {
  total: number
  count: number
  limit: number
  offset: number
}

type SuccessEnvelope<T> = { data: T }
type ErrorEnvelope = { error: string; code: string }
type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope
type PaginatedEnvelope<T> = { data: T; meta: PaginationMeta }

export interface ApiClientOptions {
  /** Called on every request to get the base URL (deferred so config is read lazily). */
  getBaseUrl: () => string
  /** Called on every request; return null/undefined to omit the Authorization header. */
  getToken: () => string | null | undefined
}

export interface ApiClient {
  /**
   * Typed fetch wrapper. Unwraps `{ data }` envelopes and throws `ApiError` on
   * error responses. Returns null for 204 No Content.
   */
  fetch<T>(path: string, init?: RequestInit): Promise<T>
  /**
   * Like `fetch` but for paginated list endpoints that return
   * `{ data: T[], meta: PaginationMeta }`.
   */
  fetchPaginated<T>(path: string, init?: RequestInit): Promise<{ data: T[]; meta: PaginationMeta }>
}

/**
 * Correlation id for the `x-correlation-id` header. Prefers the platform
 * `crypto.randomUUID()` when present (browsers, Node), but falls back to a
 * Math.random v4 UUID otherwise — React Native's Hermes runtime has no global
 * `crypto.randomUUID`, and calling it there throws before the request is sent,
 * silently killing every request. A correlation id is not security-sensitive,
 * so the non-crypto fallback is acceptable.
 */
export function randomCorrelationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ---------------------------------------------------------------------------
// Streaming (server-sent events over POST).
//
// `EventSource` can't POST or send an Authorization header, so streaming
// endpoints (the AI assistant's /chat and /evals/run) are read with fetch +
// `response.body.getReader()`. A sibling of `apiFetch`, not a mode of it: the
// response is a stream of events, not a `{ data }` envelope.
// ---------------------------------------------------------------------------

/** One server-sent event. `data` is parsed JSON when it parses, else the raw string. */
export interface SseEvent {
  event: string
  data: unknown
}

/** Parse an SSE byte stream into events, yielding each as soon as it completes. */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function* drain(final: boolean): Generator<SseEvent> {
    buffer = buffer.replace(/\r\n?/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0 || (final && buffer.trim())) {
      const block = idx >= 0 ? buffer.slice(0, idx) : buffer
      buffer = idx >= 0 ? buffer.slice(idx + 2) : ''
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }
      if (data.length === 0) continue
      const raw = data.join('\n')
      let parsed: unknown = raw
      try {
        parsed = JSON.parse(raw)
      } catch {
        // not JSON — keep the string
      }
      yield { event, data: parsed }
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* drain(false)
    }
    buffer += decoder.decode()
    yield* drain(true)
  } finally {
    reader.releaseLock()
  }
}

export interface StreamClient {
  /**
   * POST `body` as JSON to a streaming endpoint and yield its events. Throws
   * `ApiError` when the server answers with a JSON error envelope instead of a
   * stream (auth, validation, feature off).
   */
  stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<SseEvent>
}

export function createStreamClient(options: ApiClientOptions): StreamClient {
  return {
    async *stream(path, body, signal) {
      const headers = new Headers({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-correlation-id': randomCorrelationId(),
      })
      const token = options.getToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)
      const base = options.getBaseUrl().replace(/\/+$/, '')
      const res = await globalThis.fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      })
      const type = res.headers.get('Content-Type') ?? ''
      if (!res.ok || !type.includes('text/event-stream')) {
        let message = `Request failed (${res.status})`
        let code = 'UNKNOWN'
        try {
          const json = (await res.json()) as Partial<ErrorEnvelope>
          message = json.error ?? message
          code = json.code ?? code
        } catch {
          // not JSON
        }
        throw new ApiError(message, code, res.status)
      }
      if (!res.body) return
      yield* parseSseStream(res.body)
    },
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { getBaseUrl, getToken } = options

  function buildHeaders(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers)
    headers.set('Content-Type', 'application/json')
    headers.set('x-correlation-id', randomCorrelationId())
    const token = getToken()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return headers
  }

  return {
    async fetch<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await globalThis.fetch(`${getBaseUrl()}${path}`, {
        ...init,
        headers: buildHeaders(init),
      })

      if (res.status === 204) return null as T

      const json = (await res.json()) as ApiEnvelope<T>

      if ('error' in json) {
        throw new ApiError(json.error, json.code, res.status)
      }

      return json.data
    },

    async fetchPaginated<T>(
      path: string,
      init?: RequestInit,
    ): Promise<{ data: T[]; meta: PaginationMeta }> {
      const res = await globalThis.fetch(`${getBaseUrl()}${path}`, {
        ...init,
        headers: buildHeaders(init),
      })

      const json = (await res.json()) as PaginatedEnvelope<T[]> | ErrorEnvelope

      if ('error' in json) {
        throw new ApiError(json.error, json.code, res.status)
      }

      return json
    },
  }
}
