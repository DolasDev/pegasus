import { createApiClient, type ApiClient } from '@pegasus/api-http'
import { getMobileConfig } from '../config'

let clientInstance: ApiClient | null = null
let getTokenFn: () => string | null = () => null

/**
 * Set the token provider for the API client.
 * Called by AuthContext once the session is available.
 */
export function setTokenProvider(fn: () => string | null): void {
  getTokenFn = fn
}

/**
 * Returns a lazy singleton ApiClient backed by @pegasus/api-http.
 * Uses getMobileConfig() for the base URL and the token provider
 * set by setTokenProvider() for Authorization headers.
 */
export function getApiClient(): ApiClient {
  if (clientInstance) return clientInstance

  clientInstance = createApiClient({
    getBaseUrl: () => getMobileConfig().apiUrl,
    getToken: () => getTokenFn(),
  })

  return clientInstance
}

/** @internal — exposed only for testing */
export function _resetApiClient(): void {
  clientInstance = null
  getTokenFn = () => null
}
