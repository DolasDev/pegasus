export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: 'MISSING_ENV_VARS',
  ) {
    super(message)
    this.name = 'ConfigError'
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
