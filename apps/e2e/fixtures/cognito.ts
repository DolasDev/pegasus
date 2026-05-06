import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const REQUIRED_ENV = [
  'E2E_COGNITO_TENANT_CLIENT_ID',
  'E2E_STAGING_ADMIN_USERNAME',
  'E2E_STAGING_ADMIN_PASSWORD',
] as const

let cachedToken: string | null = null
let client: CognitoIdentityProviderClient | null = null

function getClient(): CognitoIdentityProviderClient {
  if (client) return client
  client = new CognitoIdentityProviderClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  })
  return client
}

export function hasAuthEnv(): boolean {
  return REQUIRED_ENV.every((k) => !!process.env[k])
}

/**
 * Fetch an ID token for the staging E2E admin via USER_PASSWORD_AUTH and
 * cache it for the duration of the test run. Tokens are valid 8h; the suite
 * runs for ~1m, so a single mint is sufficient.
 */
export async function getAdminIdToken(): Promise<string> {
  if (cachedToken) return cachedToken

  for (const k of REQUIRED_ENV) {
    if (!process.env[k]) {
      throw new Error(
        `remote-mode auth not configured: missing ${k}. ` +
          `See apps/e2e/REMOTE.md for the required env vars.`,
      )
    }
  }

  const res = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: process.env['E2E_COGNITO_TENANT_CLIENT_ID'],
      AuthParameters: {
        USERNAME: process.env['E2E_STAGING_ADMIN_USERNAME']!,
        PASSWORD: process.env['E2E_STAGING_ADMIN_PASSWORD']!,
      },
    }),
  )

  const token = res.AuthenticationResult?.IdToken
  if (!token) {
    throw new Error(
      `Cognito InitiateAuth returned no IdToken (ChallengeName=${res.ChallengeName ?? 'none'}). ` +
        `Confirm the staging admin user has a permanent password set via AdminSetUserPassword.`,
    )
  }

  cachedToken = token
  return token
}
