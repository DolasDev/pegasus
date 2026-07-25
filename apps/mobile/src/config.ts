export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: 'MISSING_ENV_VARS' | 'INVALID_API_URL',
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * A present env var only tells us a value was baked in — not that it's usable.
 * A build that baked a malformed apiUrl (empty after trimming, no scheme, or a
 * double-scheme like `https://https://…` from a mis-templated release) would
 * otherwise sail past the presence check and only fail later as a vague
 * "Unable to look up account" at login. Reject it up front so RootLayout shows
 * the Configuration Error screen instead. A valid-but-wrong host (e.g. a dev URL
 * in a release build) still parses here — that case is surfaced at the call site.
 */
function assertValidApiUrl(apiUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw new ConfigError(`EXPO_PUBLIC_API_URL is not a valid URL: "${apiUrl}"`, 'INVALID_API_URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(
      `EXPO_PUBLIC_API_URL must be an http(s) URL, got "${apiUrl}"`,
      'INVALID_API_URL',
    )
  }
  // `https://https://host` parses (hostname becomes "https") but is a
  // mis-templated release URL, not a real origin. Nothing legitimate contains
  // "://" twice, so reject a second scheme separator.
  if (apiUrl.indexOf('://') !== apiUrl.lastIndexOf('://')) {
    throw new ConfigError(
      `EXPO_PUBLIC_API_URL looks double-prefixed: "${apiUrl}"`,
      'INVALID_API_URL',
    )
  }
}

export type MobileConfig = {
  apiUrl: string
  cognito: {
    region: string
    userPoolId: string
    clientId: string
    domain: string | null
    redirectUri: string
  }
}

let cachedConfig: MobileConfig | null = null

export function getMobileConfig(): MobileConfig {
  if (cachedConfig) return cachedConfig

  const apiUrl = process.env.EXPO_PUBLIC_API_URL
  const region = process.env.EXPO_PUBLIC_COGNITO_REGION
  const userPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID
  const clientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID
  const domain = process.env.EXPO_PUBLIC_COGNITO_DOMAIN || null
  const redirectUri = process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI

  if (!apiUrl || !region || !userPoolId || !clientId || !redirectUri) {
    throw new ConfigError(
      'Missing required EXPO_PUBLIC_COGNITO_* env vars. Check .env or eas.json build profile.',
      'MISSING_ENV_VARS',
    )
  }

  assertValidApiUrl(apiUrl)

  cachedConfig = {
    apiUrl,
    cognito: { region, userPoolId, clientId, domain, redirectUri },
  }

  return cachedConfig
}

export function isConfigValid(): boolean {
  try {
    getMobileConfig()
    return true
  } catch {
    return false
  }
}

/** @internal — exposed only for testing */
export function _resetConfigCache(): void {
  cachedConfig = null
}
