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

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { getBaseUrl, getToken } = options

  function buildHeaders(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers)
    headers.set('Content-Type', 'application/json')
    headers.set('x-correlation-id', crypto.randomUUID())
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
