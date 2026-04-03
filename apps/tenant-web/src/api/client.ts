import { ApiError, createApiClient } from '@pegasus/api-http'
import { getConfig } from '../config'
import { getSession } from '../auth/session'

export { ApiError }

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
