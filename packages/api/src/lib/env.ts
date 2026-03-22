// ---------------------------------------------------------------------------
// Environment variable validation
//
// Call validateEnv() at startup (server.ts / lambda.ts cold start) so any
// misconfiguration is caught immediately with a clear error message rather
// than causing a silent runtime failure deep inside a request handler.
//
// Schema:
//   DATABASE_URL              — always required
//   COGNITO_JWKS_URL          — required unless SKIP_AUTH=true
//   COGNITO_TENANT_CLIENT_ID  — required unless SKIP_AUTH=true
//   COGNITO_USER_POOL_ID      — required unless SKIP_AUTH=true
//   SKIP_AUTH                 — optional; when "true" relaxes Cognito checks
// ---------------------------------------------------------------------------

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Non-empty string — rejects undefined AND empty strings. */
const nonEmptyString = z.string().min(1)

/**
 * Build the appropriate Zod schema based on whether SKIP_AUTH mode is active.
 * The schema is constructed at call time so it reflects the current value of
 * process.env['SKIP_AUTH'] rather than the value at module import time.
 */
function buildSchema(skipAuth: boolean) {
  const cognitoField = skipAuth
    ? z.string().optional()
    : nonEmptyString

  return z.object({
    DATABASE_URL: nonEmptyString,
    COGNITO_JWKS_URL: cognitoField,
    COGNITO_TENANT_CLIENT_ID: cognitoField,
    COGNITO_USER_POOL_ID: cognitoField,
    SKIP_AUTH: z.string().optional(),
  })
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** The validated, typed representation of the API's required env vars. */
export type ValidatedEnv = {
  DATABASE_URL: string
  COGNITO_JWKS_URL: string | undefined
  COGNITO_TENANT_CLIENT_ID: string | undefined
  COGNITO_USER_POOL_ID: string | undefined
  SKIP_AUTH: string | undefined
}

// ---------------------------------------------------------------------------
// validateEnv()
// ---------------------------------------------------------------------------

/**
 * Validates required environment variables and returns a typed env object.
 *
 * Throws a descriptive Error listing every missing/invalid variable if
 * validation fails so the process fails fast at startup instead of silently
 * misbehaving during request handling.
 *
 * Call this once from the entry point (server.ts `startServer()` or
 * lambda.ts module initialisation) — not during import.
 */
export function validateEnv(): ValidatedEnv {
  const skipAuth = process.env['SKIP_AUTH'] === 'true'
  const schema = buildSchema(skipAuth)

  const result = schema.safeParse({
    DATABASE_URL: process.env['DATABASE_URL'],
    COGNITO_JWKS_URL: process.env['COGNITO_JWKS_URL'],
    COGNITO_TENANT_CLIENT_ID: process.env['COGNITO_TENANT_CLIENT_ID'],
    COGNITO_USER_POOL_ID: process.env['COGNITO_USER_POOL_ID'],
    SKIP_AUTH: process.env['SKIP_AUTH'],
  })

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join('.'))
      .filter(Boolean)
      .join(', ')
    throw new Error(
      `[env] Missing or invalid environment variables: ${missing}. ` +
        `Set SKIP_AUTH=true to bypass Cognito requirements in non-production environments.`,
    )
  }

  return result.data as ValidatedEnv
}
