import { ApiError, createApiClient, type PaginationMeta } from '@pegasus/api-http'
import { getAccessToken } from '@/auth/cognito'
import { getConfig } from '@/config'

export { ApiError, type PaginationMeta }

const client = createApiClient({
  getBaseUrl: () => getConfig().apiUrl,
  getToken: () => getAccessToken(),
})

/**
 * Typed fetch wrapper for the admin API. Attaches the Cognito access token as
 * a Bearer token and unwraps `{ data }` envelopes. Throws `ApiError` on error
 * responses so TanStack Query can surface them correctly.
 */
export const adminFetch: <T>(path: string, init?: RequestInit) => Promise<T> =
  client.fetch.bind(client)

/**
 * Like `adminFetch` but for paginated list endpoints that return
 * `{ data: T[], meta: PaginationMeta }` at the top level (not nested).
 */
export const adminFetchPaginated: <T>(
  path: string,
  init?: RequestInit,
) => Promise<{ data: T[]; meta: PaginationMeta }> = client.fetchPaginated.bind(client)
