import { ApiError, createApiClient, type PaginationMeta } from '@pegasus/api-http'
import { getConfig } from '../config'
import { getSession } from '../auth/session'

export { ApiError }
export type { PaginationMeta }

const client = createApiClient({
  getBaseUrl: () => getConfig().apiUrl,
  getToken: () => getSession()?.token ?? null,
})

/**
 * Typed fetch wrapper. Unwraps `{ data }` envelopes and throws `ApiError` on
 * error responses. All calls go through here so the base URL and headers are
 * applied consistently.
 */
export const apiFetch: <T>(path: string, init?: RequestInit) => Promise<T> =
  client.fetch.bind(client)

/**
 * Typed fetch wrapper for paginated list endpoints. Returns both `data` and
 * `meta` (including `total` count) without discarding the envelope.
 */
export const apiFetchPaginated: <T>(
  path: string,
  init?: RequestInit,
) => Promise<{ data: T[]; meta: PaginationMeta }> = client.fetchPaginated.bind(client)
