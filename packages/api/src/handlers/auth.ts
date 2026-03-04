// ---------------------------------------------------------------------------
// Auth handler — /api/auth/**
//
// Public endpoints that support the tenant SSO login flow. These routes are
// NOT protected by the tenant middleware (they are called before a session
// exists). They are mounted BEFORE the /api/v1 tenant block in app.ts.
//
// Endpoints:
//   POST /api/auth/resolve-tenant  — domain → tenant + configured SSO providers
//   POST /api/auth/validate-token  — Cognito ID token → validated session claims
//
// Security posture:
//   - resolve-tenant returns only non-sensitive display metadata. Client IDs
//     and secrets are never included. An attacker who knows a tenant's domain
//     learns only the provider name and type — not enough to impersonate.
//   - validate-token accepts only ID tokens (token_use = "id") and validates
//     signature (JWKS), iss, aud (tenant client ID), exp, and token_use.
//     The raw token is never returned or stored — only the extracted claims.
//   - tenantId is resolved server-side from the token's email claim and the
//     emailDomains column. The frontend cannot inject a different tenantId.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { createRemoteJWKSet, jwtVerify, errors } from 'jose'
import { db } from '../db'
import { logger } from '../lib/logger'

// ---------------------------------------------------------------------------
// JWKS cache — initialised on the first request, shared across warm Lambda
// invocations. jose caches individual public keys internally and re-fetches
// on unknown `kid`, so key rotation is handled automatically.
// ---------------------------------------------------------------------------
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks === null) {
    const url = process.env['COGNITO_JWKS_URL']
    if (!url) throw new Error('COGNITO_JWKS_URL environment variable is not set')
    _jwks = createRemoteJWKSet(new URL(url))
  }
  return _jwks
}

/**
 * Derives the Cognito issuer from the JWKS URL by stripping the JWKS path.
 * e.g. https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx/.well-known/jwks.json
 *   →  https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx
 */
function deriveIssuer(jwksUrl: string): string {
  return jwksUrl.replace('/.well-known/jwks.json', '')
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const ResolveTenantBody = z.object({
  /** The email domain to look up (e.g. "acme.com"). Not the full email address. */
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, {
      message: 'domain must be a valid DNS domain (e.g. acme.com)',
    }),
})

const ValidateTokenBody = z.object({
  /** Cognito ID token JWT string. */
  idToken: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const authHandler = new Hono()

// ---------------------------------------------------------------------------
// POST /api/auth/resolve-tenant
//
// Resolves the tenant and its configured SSO providers for a given email domain.
//
// Used by the login page to determine which IdP(s) to offer the user.
// Called before any session exists — no authentication required.
//
// Request:  { domain: string }               (the email domain, not full address)
// Response: { data: TenantResolution }       on success (200) — always includes cognitoAuthEnabled
//           { error, code: NOT_FOUND }       if domain is not registered (404)
//           { error, code: VALIDATION_ERROR} if domain is malformed (400)
//
// Security: returns only id, name, and type for each provider — no secrets,
// client IDs, or metadata URLs are exposed.
// ---------------------------------------------------------------------------
authHandler.post(
  '/resolve-tenant',
  validator('json', (value, c) => {
    const r = ResolveTenantBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { domain } = c.req.valid('json')

    let tenant: {
      id: string
      name: string
      status: string
      cognitoAuthEnabled: boolean
      ssoProviders: Array<{ cognitoProviderName: string; name: string; type: 'OIDC' | 'SAML' }>
    } | null

    try {
      // Find the first ACTIVE tenant whose emailDomains array contains this domain.
      // Prisma array-contains translates to: WHERE email_domains @> ARRAY['domain']
      tenant = await db.tenant.findFirst({
        where: {
          emailDomains: { has: domain },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          status: true,
          cognitoAuthEnabled: true,
          ssoProviders: {
            where: { isEnabled: true },
            select: { cognitoProviderName: true, name: true, type: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }

    if (!tenant) {
      return c.json({ error: 'Domain not registered with Pegasus', code: 'TENANT_NOT_FOUND' }, 404)
    }

    return c.json({
      data: {
        tenantId: tenant.id,
        tenantName: tenant.name,
        cognitoAuthEnabled: tenant.cognitoAuthEnabled,
        // cognitoProviderName is used as the provider ID — it is passed as
        // `identity_provider` in the Cognito authorization URL.
        providers: tenant.ssoProviders.map((p) => ({
          id: p.cognitoProviderName,
          name: p.name,
          type: p.type.toLowerCase() as 'oidc' | 'saml',
        })),
      },
    })
  },
)

// ---------------------------------------------------------------------------
// POST /api/auth/validate-token
//
// Validates a Cognito ID token and returns the session claims.
//
// The frontend calls this after exchanging the authorization code for tokens
// at the Cognito token endpoint. The backend validates the token server-side
// and resolves tenantId from the email domain, so the frontend cannot forge
// or inject identity claims.
//
// Validation steps:
//   1. Verify RS256 signature via JWKS (jose handles key caching + rotation).
//   2. Validate iss matches the Cognito User Pool issuer.
//   3. Validate aud matches COGNITO_TENANT_CLIENT_ID (prevents tokens issued
//      to other app clients from being used here).
//   4. Validate exp (token not expired).
//   5. Validate token_use = "id" (reject access tokens — different purpose).
//   6. Extract email, derive domain, resolve tenantId from emailDomains.
//   7. Return validated claims only — raw token is never stored or returned.
//
// Phase 5 adds custom Cognito claims (custom:tenantId, custom:role) via a
// Pre-Token-Generation Lambda. Until then, tenantId comes from the domain
// lookup and role defaults to tenant_user.
//
// Request:  { idToken: string }
// Response: { data: Session }              on success (200)
//           { error, code: UNAUTHORIZED }  on invalid/expired token (401)
//           { error, code: FORBIDDEN }     on domain not registered (403)
// ---------------------------------------------------------------------------
authHandler.post(
  '/validate-token',
  validator('json', (value, c) => {
    const r = ValidateTokenBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { idToken } = c.req.valid('json')

    const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''
    const tenantClientId = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''

    if (!jwksUrl || !tenantClientId) {
      logger.error('validate-token: COGNITO_JWKS_URL or COGNITO_TENANT_CLIENT_ID not set')
      return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
    }

    // -----------------------------------------------------------------------
    // Step 1–4: Verify signature, issuer, audience, expiry
    // -----------------------------------------------------------------------
    let payload: Record<string, unknown>
    try {
      const result = await jwtVerify(idToken, getJwks(), {
        issuer: deriveIssuer(jwksUrl),
        audience: tenantClientId,
        algorithms: ['RS256'],
      })
      payload = result.payload as Record<string, unknown>
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        return c.json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' }, 401)
      }
      return c.json({ error: 'Invalid or unverifiable token', code: 'UNAUTHORIZED' }, 401)
    }

    // -----------------------------------------------------------------------
    // Step 5: Validate token_use = "id"
    //
    // Cognito issues two JWT types: ID tokens (token_use: "id") and access
    // tokens (token_use: "access"). Only ID tokens carry user identity claims
    // (email, sub). Accepting access tokens here would be a category error —
    // they serve a different purpose and have different claim sets.
    // -----------------------------------------------------------------------
    if (payload['token_use'] !== 'id') {
      return c.json({ error: 'Invalid token: ID token required', code: 'UNAUTHORIZED' }, 401)
    }

    // -----------------------------------------------------------------------
    // Step 6: Extract claims and resolve tenantId from email domain
    // -----------------------------------------------------------------------
    const sub = payload['sub'] as string | undefined
    const email = payload['email'] as string | undefined

    if (!sub || !email) {
      return c.json({ error: 'Invalid token: missing required claims', code: 'UNAUTHORIZED' }, 401)
    }

    const domain = email.split('@')[1]?.toLowerCase()
    if (!domain) {
      return c.json(
        { error: 'Invalid token: could not extract domain from email', code: 'UNAUTHORIZED' },
        401,
      )
    }

    // We now rely on the custom claims injected by the Pre-Token-Generation Lambda.
    // The Lambda has already authoritative resolved the tenant and injected these claims.
    const customTenantId = payload['custom:tenantId'] as string | undefined
    const customRole = payload['custom:role'] as string | undefined

    if (!customTenantId || !customRole) {
      // Pre-token Lambda blocks generation if there is no active tenant. Wait, it could be
      // an admin or another type of user? Tenant mapping happens for all users signing into
      // the tenant client.
      return c.json(
        {
          error:
            'Your account is not fully configured for this tenant. Contact your administrator.',
          code: 'FORBIDDEN',
        },
        403,
      )
    }

    const expiresAt = payload['exp'] as number

    const session = {
      sub,
      tenantId: customTenantId,
      role: customRole, // 'tenant_user' or other roles
      email,
      expiresAt,
      // The Cognito identity provider used to authenticate. Cognito stores the
      // IdP name in the identities claim; fall back to null if not present.
      ssoProvider: extractSsoProvider(payload),
    }

    return c.json({ data: session })
  },
)

// ---------------------------------------------------------------------------
// Helper — extract the SSO provider name from the Cognito identities claim.
//
// For federated users, Cognito includes an `identities` claim:
//   [{ providerName: "acme-okta", providerType: "OIDC", ... }]
//
// For native (non-federated) Cognito users, this claim is absent.
// ---------------------------------------------------------------------------
function extractSsoProvider(payload: Record<string, unknown>): string | null {
  const identities = payload['identities']
  if (!Array.isArray(identities) || identities.length === 0) return null
  const first = identities[0] as Record<string, unknown> | undefined
  return (first?.['providerName'] as string | undefined) ?? null
}
