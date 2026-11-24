import { createApiClient, type ApiClient } from '@pegasus/api-http'
import { getMobileConfig } from '../config'

let clientInstance: ApiClient | null = null
let getTokenFn: () => string | null = () => null
let onUnauthorizedFn: () => Promise<string | null> = async () => null

/**
 * Set the token provider for the API client.
 * Called by AuthContext once the session is available.
 */
export function setTokenProvider(fn: () => string | null): void {
  getTokenFn = fn
}

/**
 * Set what the API client does on a 401: refresh the session and resolve the
 * new token (the request is retried once with it), or null to let the 401
 * through. Called by AuthContext, which wires it to its single-flight refresh.
 */
export function setUnauthorizedHandler(fn: () => Promise<string | null>): void {
  onUnauthorizedFn = fn
}

/**
 * Returns a lazy singleton ApiClient backed by @pegasus/api-http.
 * Uses getMobileConfig() for the base URL, the token provider set by
 * setTokenProvider() for Authorization headers, and the handler set by
 * setUnauthorizedHandler() to refresh-and-retry on a 401.
 */
export function getApiClient(): ApiClient {
  if (clientInstance) return clientInstance

  clientInstance = createApiClient({
    getBaseUrl: () => getMobileConfig().apiUrl,
    getToken: () => getTokenFn(),
    onUnauthorized: () => onUnauthorizedFn(),
  })

  return clientInstance
}

/** @internal — exposed only for testing */
export function _resetApiClient(): void {
  clientInstance = null
  getTokenFn = () => null
  onUnauthorizedFn = async () => null
}
