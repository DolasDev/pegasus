// ---------------------------------------------------------------------------
// Admin authentication middleware
//
// Verifies the Cognito JWT supplied in the Authorization: Bearer header and
// enforces that the caller is a member of the PLATFORM_ADMIN Cognito group.
//
// On success, sets `adminSub` and `adminEmail` in the Hono context.
// On failure, returns 401 (missing/invalid/expired token) or 403 (valid token
// but wrong group). Error responses never leak internal details.
//
// JWT verification uses the user pool's public JWKS endpoint — no shared
// secret is required. Keys are cached in-process after the first fetch, so
// warm Lambda invocations incur no additional network round-trips.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { AdminEnv } from '../types'

const PLATFORM_ADMIN_GROUP = 'PLATFORM_ADMIN'

// ---------------------------------------------------------------------------
// Module-level JWKS cache
//
// Created once on the first request and reused across warm Lambda invocations.
// jose internally caches individual key objects; the RemoteJWKSet also handles
// key rotation by re-fetching when it encounters an unknown `kid`.
// ---------------------------------------------------------------------------
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

/** Returns the cached JWKS resolver, initialising it on first call. */
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks === null) {
    const url = process.env['COGNITO_JWKS_URL']
    if (!url) {
      throw new Error('COGNITO_JWKS_URL environment variable is not set')
    }
    _jwks = createRemoteJWKSet(new URL(url))
  }
  return _jwks
}

/**
 * Derives the Cognito issuer URL from the JWKS URL.
 *
 * Example:
 *   https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx/.well-known/jwks.json
 *   → https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
 */
function deriveIssuer(jwksUrl: string): string {
  return jwksUrl.replace('/.well-known/jwks.json', '')
}

/**
 * Hono middleware that authenticates platform administrator requests.
 *
 * Guards every route in the /api/admin namespace. A request passes only when:
 *  1. A valid `Authorization: Bearer <id_token>` header is present.
 *  2. The JWT is signed by the Cognito User Pool (RS256, verified via JWKS).
 *  3. The JWT is not expired and the `iss` claim matches the user pool.
 *  4. The `cognito:groups` claim includes "PLATFORM_ADMIN".
 *
 * On success, `adminSub` (Cognito sub) and `adminEmail` are available in the
 * Hono context for downstream handlers.
 */
export async function adminAuthMiddleware(
  c: Context<AdminEnv>,
  next: Next,
): Promise<Response | void> {
  // -------------------------------------------------------------------------
  // Step 1 — Extract the bearer token
  // -------------------------------------------------------------------------
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { error: 'Missing or malformed Authorization header', code: 'UNAUTHORIZED' },
      401,
    )
  }

  const token = authHeader.slice(7) // strip "Bearer "

  // -------------------------------------------------------------------------
  // Step 2 — Verify JWT signature, expiry, and issuer
  // -------------------------------------------------------------------------
  const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, getJwks(), {
      issuer: deriveIssuer(jwksUrl),
      algorithms: ['RS256'],
    })
    payload = result.payload as Record<string, unknown>
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      return c.json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' }, 401)
    }
    // Covers: JWSInvalid, JWTInvalid, JWTClaimValidationFailed, and others.
    // Do not surface internal error details to callers.
    return c.json({ error: 'Invalid or unverifiable token', code: 'UNAUTHORIZED' }, 401)
  }

  // -------------------------------------------------------------------------
  // Step 3 — Verify token_use claim
  //
  // Cognito issues two JWT types: access tokens (token_use: "access") and ID
  // tokens (token_use: "id"). The API must only accept access tokens — ID
  // tokens are for the client application to read user identity and must not
  // be used as API credentials.
  // -------------------------------------------------------------------------
  const tokenUse = payload['token_use'] as string | undefined
  if (tokenUse !== 'access') {
    return c.json({ error: 'Invalid token: access token required', code: 'UNAUTHORIZED' }, 401)
  }

  // -------------------------------------------------------------------------
  // Step 4 — Enforce PLATFORM_ADMIN group membership
  // -------------------------------------------------------------------------
  const groups = payload['cognito:groups'] as string[] | undefined
  if (!groups?.includes(PLATFORM_ADMIN_GROUP)) {
    return c.json(
      { error: 'Forbidden: platform administrator access required', code: 'FORBIDDEN' },
      403,
    )
  }

  // -------------------------------------------------------------------------
  // Step 5 — Extract identity claims and populate context
  // -------------------------------------------------------------------------
  const sub = payload['sub'] as string | undefined
  if (!sub) {
    // A well-formed Cognito JWT always has a `sub`; this branch is a safeguard.
    return c.json({ error: 'Invalid token: missing sub claim', code: 'UNAUTHORIZED' }, 401)
  }

  // `email` is present in Cognito ID tokens when the `email` scope is requested.
  // Fall back to empty string rather than blocking — the email is used for
  // display only; `adminSub` is the durable identity key.
  const email = (payload['email'] as string | undefined) ?? ''

  c.set('adminSub', sub)
  c.set('adminEmail', email)

  await next()
}
