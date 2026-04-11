import { createAuthService } from './authService'
import { getMobileConfig, isConfigValid } from '../config'
import * as cognitoService from './cognitoService'
import * as oauthService from './oauthService'

/**
 * Lazy singleton for the authService instance.
 * Auth screens import this instead of the _layout module export (which no longer exists).
 * Lazily initialised so config env vars are only read when first needed.
 */
let instance: ReturnType<typeof createAuthService> | null = null

export function getAuthService(): ReturnType<typeof createAuthService> {
  if (instance) return instance
  if (!isConfigValid()) {
    throw new Error('Cannot create authService: config is invalid')
  }
  const config = getMobileConfig()
  instance = createAuthService({ config, cognitoService, oauthService })
  return instance
}

/** @internal — exposed only for testing */
export function _resetAuthServiceInstance(): void {
  instance = null
}
