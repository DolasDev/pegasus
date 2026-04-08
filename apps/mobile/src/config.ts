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

export function getMobileConfig(): MobileConfig {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL
  const region = process.env.EXPO_PUBLIC_COGNITO_REGION
  const userPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID
  const clientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID
  const domain = process.env.EXPO_PUBLIC_COGNITO_DOMAIN || null
  const redirectUri = process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI

  if (!apiUrl || !region || !userPoolId || !clientId || !redirectUri) {
    throw new Error(
      'Missing required EXPO_PUBLIC_COGNITO_* env vars. ' + 'Check .env or eas.json build profile.',
    )
  }

  return {
    apiUrl,
    cognito: { region, userPoolId, clientId, domain, redirectUri },
  }
}
