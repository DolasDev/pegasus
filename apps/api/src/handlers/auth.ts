// ---------------------------------------------------------------------------
// Auth handler — /api/auth/**
//
// Public endpoints that support the tenant SSO login flow. These routes are
// NOT protected by the tenant middleware (they are called before a session
// exists). They are mounted BEFORE the /api/v1 tenant block in app.ts.
//
// Endpoints:
//   POST /api/auth/resolve-tenants — email → all tenants the user is invited to
//   POST /api/auth/select-tenant   — record the user's tenant pick (AuthSession)
//   POST /api/auth/validate-token  — Cognito ID token → validated session claims
//
// Security posture:
//   - resolve-tenants returns only non-sensitive display metadata. Client IDs
//     and secrets are never included.
//   - validate-token accepts only ID tokens (token_use = "id") and validates
//     signature (JWKS), iss, aud (tenant client ID), exp, and token_use.
//     The raw token is never returned or stored — only the extracted claims.
//   - tenantId is taken from the custom:tenantId claim that the Pre-Token
//     Lambda injects after resolving the tenant from the user's roster. The
//     frontend cannot inject a different tenantId.
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
const ResolveTenantsBody = z.object({
  /** Full email address — the backend looks up the user's tenant roster. */
  email: z.string().email(),
})

const SelectTenantBody = z.object({
  /** Full email address of the user selecting a tenant. */
  email: z.string().email(),
  /** ID of the tenant the user selected. */
  tenantId: z.string().min(1),
})

const ValidateTokenBody = z.object({
  /** Cognito ID token JWT string. */
  idToken: z.string().min(1),
})

const MobileConfigQuery = z.object({
  tenantId: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Shared Prisma select fragment and mapper for login-facing SSO provider data.
//
// Used by the endpoints that return provider lists to the login UI.
// Secrets, client IDs, and metadata URLs are intentionally excluded.
// ---------------------------------------------------------------------------
const enabledSsoProvidersSelect = {
  where: { isEnabled: true },
  select: { cognitoProviderName: true, name: true, type: true },
  orderBy: { createdAt: 'asc' },
} as const

function mapProviders(
  providers: Array<{ cognitoProviderName: string; name: string; type: 'OIDC' | 'SAML' }>,
) {
  return providers.map((p) => ({
    id: p.cognitoProviderName,
    name: p.name,
    type: p.type.toLowerCase() as 'oidc' | 'saml',
  }))
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export const authHandler = new Hono()

// ---------------------------------------------------------------------------
// POST /api/auth/resolve-tenants
//
// Returns ALL tenants the given email address is invited to, for use in the
// multi-tenant login picker. Called before any session exists.
//
// Resolution: find TenantUser roster rows for the email where status !=
// DEACTIVATED and tenant.status = ACTIVE. Roster membership is the only
// source of truth — there is no domain-based fallback. No rows → empty
// array, and the UI shows "not registered".
//
// Request:  { email: string }
// Response: { data: TenantResolution[] }   always 200; empty array = unknown
//           { error, code: VALIDATION_ERROR } if email is malformed (400)
// ---------------------------------------------------------------------------
authHandler.post(
  '/resolve-tenants',
  validator('json', (value, c) => {
    const r = ResolveTenantsBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { email } = c.req.valid('json')
    const normalizedEmail = email.toLowerCase()

    try {
      // Look up all TenantUser roster entries for this email.
      // Use case-insensitive matching so "John@Acme.com" matches "john@acme.com".
      const tenantUsers = await db.tenantUser.findMany({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          status: { not: 'DEACTIVATED' },
          tenant: { status: 'ACTIVE' },
        },
        select: {
          tenant: {
            select: {
              id: true,
              name: true,
              cognitoAuthEnabled: true,
              ssoProviders: enabledSsoProvidersSelect,
            },
          },
        },
      })

      return c.json({
        data: tenantUsers.map((tu) => ({
          tenantId: tu.tenant.id,
          tenantName: tu.tenant.name,
          cognitoAuthEnabled: tu.tenant.cognitoAuthEnabled,
          providers: mapProviders(tu.tenant.ssoProviders),
        })),
      })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /api/auth/select-tenant
//
// Records the tenant the user has chosen so the pre-token Lambda can use it
// during Cognito authentication. Creates a short-lived AuthSession (10-minute
// window) that the Lambda reads; it expires naturally rather than being
// consumed, so it survives the multiple invocations of one login.
//
// Validation:
//   - TenantUser must exist for (tenantId, email) with status != DEACTIVATED
//   - Tenant must have status ACTIVE
//
// Request:  { email: string, tenantId: string }
// Response: { data: TenantResolution }      on success (200) — same shape as resolve-tenants item
//           { error, code: FORBIDDEN }      if user not invited or deactivated (403)
//           { error, code: NOT_FOUND }      if tenant not found or not ACTIVE (404)
//           { error, code: VALIDATION_ERROR } if body is malformed (400)
// ---------------------------------------------------------------------------
authHandler.post(
  '/select-tenant',
  validator('json', (value, c) => {
    const r = SelectTenantBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { email, tenantId } = c.req.valid('json')
    const normalizedEmail = email.toLowerCase()

    try {
      // Validate TenantUser is invited and not deactivated.
      // Use case-insensitive lookup — findFirst instead of findUnique because
      // Prisma's compound unique where clause does not support mode:'insensitive'.
      const tenantUser = await db.tenantUser.findFirst({
        where: {
          tenantId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
        },
        select: { status: true },
      })

      if (!tenantUser) {
        return c.json({ error: 'You are not invited to this tenant', code: 'FORBIDDEN' }, 403)
      }

      if (tenantUser.status === 'DEACTIVATED') {
        return c.json({ error: 'Your account has been deactivated', code: 'FORBIDDEN' }, 403)
      }

      // Validate tenant is active and fetch provider config.
      const tenant = await db.tenant.findFirst({
        where: { id: tenantId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          cognitoAuthEnabled: true,
          ssoProviders: enabledSsoProvidersSelect,
        },
      })

      if (!tenant) {
        return c.json({ error: 'Tenant not found or not active', code: 'NOT_FOUND' }, 404)
      }

      // Create the short-lived auth session (10-minute window).
      // Store the normalized (lowercase) email so the pre-token Lambda can
      // match it reliably regardless of how the user typed it.
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
      await db.authSession.create({ data: { email: normalizedEmail, tenantId, expiresAt } })

      return c.json({
        data: {
          tenantId: tenant.id,
          tenantName: tenant.name,
          cognitoAuthEnabled: tenant.cognitoAuthEnabled,
          providers: mapProviders(tenant.ssoProviders),
        },
      })
    } catch {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /api/auth/validate-token
//
// Validates a Cognito ID token and returns the session claims.
//
// The frontend calls this after exchanging the authorization code for tokens
// at the Cognito token endpoint. The backend validates the token server-side
// and reads tenantId from the custom:tenantId claim, so the frontend cannot
// forge or inject identity claims.
//
// Validation steps:
//   1. Verify RS256 signature via JWKS (jose handles key caching + rotation).
//   2. Validate iss matches the Cognito User Pool issuer.
//   3. Validate aud matches COGNITO_TENANT_CLIENT_ID (prevents tokens issued
//      to other app clients from being used here).
//   4. Validate exp (token not expired).
//   5. Validate token_use = "id" (reject access tokens — different purpose).
//   6. Extract email/sub and read tenantId + roles from the custom claims
//      that the Pre-Token-Generation Lambda injected.
//   7. Return validated claims only — raw token is never stored or returned.
//
// Request:  { idToken: string }
// Response: { data: Session }              on success (200)
//           { error, code: UNAUTHORIZED }  on invalid/expired token (401)
//           { error, code: FORBIDDEN }     when the token carries no tenant claim (403)
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
    const mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''

    if (!jwksUrl || !tenantClientId || !mobileClientId) {
      logger.error(
        'validate-token: COGNITO_JWKS_URL, COGNITO_TENANT_CLIENT_ID, or COGNITO_MOBILE_CLIENT_ID not set',
      )
      return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
    }

    // -----------------------------------------------------------------------
    // Step 1–4: Verify signature, issuer, audience, expiry
    // -----------------------------------------------------------------------
    let payload: Record<string, unknown>
    try {
      const result = await jwtVerify(idToken, getJwks(), {
        issuer: deriveIssuer(jwksUrl),
        audience: [tenantClientId, mobileClientId],
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
    // Step 6: Extract identity claims and read the tenant/roles the
    // Pre-Token-Generation Lambda resolved from the user's roster.
    // -----------------------------------------------------------------------
    const sub = payload['sub'] as string | undefined
    const email = payload['email'] as string | undefined

    if (!sub || !email) {
      return c.json({ error: 'Invalid token: missing required claims', code: 'UNAUTHORIZED' }, 401)
    }

    // tenantId and roles come from the custom claims the Pre-Token Lambda
    // injects after resolving the tenant. They are absent only for tokens
    // issued to a non-tenant client (e.g. the admin app).
    const customTenantId = payload['custom:tenantId'] as string | undefined
    const customRolesRaw = payload['custom:roles'] as string | undefined

    if (!customTenantId || !customRolesRaw) {
      return c.json(
        {
          error:
            'Your account is not fully configured for this tenant. Contact your administrator.',
          code: 'FORBIDDEN',
        },
        403,
      )
    }

    // Parse the Cedar role-group memberships. Pre-token emits a JSON-encoded
    // string array. A malformed/empty claim is treated as a no-roles session
    // (login proceeds; permission checks later return DENY).
    let roleNames: string[] = []
    try {
      const parsed = JSON.parse(customRolesRaw) as unknown
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        roleNames = parsed as string[]
      }
    } catch {
      // Keep roleNames = [] on malformed input.
    }

    // Derived `role` string for backward-compat consumers (mobile UI badge,
    // legacy tenant-web guards). Authoritative source is `roleNames`.
    const derivedRole = roleNames.includes('tenant_admin')
      ? 'tenant_admin'
      : (roleNames[0] ?? 'viewer')

    const expiresAt = payload['exp'] as number

    const tenantRow = await db.tenant.findUnique({
      where: { id: customTenantId },
      select: { name: true },
    })

    if (!tenantRow) {
      return c.json(
        {
          error:
            'Your account is not fully configured for this tenant. Contact your administrator.',
          code: 'FORBIDDEN',
        },
        403,
      )
    }

    const session = {
      sub,
      tenantId: customTenantId,
      tenantName: tenantRow.name,
      roleNames,
      role: derivedRole,
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
// GET /api/auth/mobile-config
//
// Returns the Cognito user pool ID and mobile app client ID for the given
// tenant. Called by the mobile app after tenant selection to obtain Cognito
// credentials at runtime — credentials are never baked into the app bundle.
//
// The tenant existence check ensures callers cannot probe for arbitrary pool
// IDs using fabricated tenant IDs. Unknown tenants receive a 400.
//
// Request:  ?tenantId=<uuid>
// Response: { data: { userPoolId: string, clientId: string } }   200
//           { error, code: TENANT_NOT_FOUND }                     400
//           { error, code: VALIDATION_ERROR }                     400
//           { error, code: INTERNAL_ERROR }                       500
//
// Public — no auth middleware. Called before any session exists.
// ---------------------------------------------------------------------------
authHandler.get(
  '/mobile-config',
  validator('query', (value, c) => {
    const r = MobileConfigQuery.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { tenantId } = c.req.valid('query')
    logger.info('mobile-config: DEPRECATED — mobile app should use baked-in config')

    const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? ''
    const clientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''

    if (!userPoolId || !clientId) {
      logger.error('mobile-config: COGNITO_USER_POOL_ID or COGNITO_MOBILE_CLIENT_ID not set')
      return c.json({ error: 'Authentication service misconfigured', code: 'INTERNAL_ERROR' }, 500)
    }

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    })

    if (!tenant) {
      return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 400)
    }

    // hostedUiDomain is optional — null when not configured (e.g. CI, local dev
    // without Cognito). The mobile app uses it to build OAuth authorize URLs for
    // SSO flows. When null, only password (SRP) auth is available.
    const hostedUiDomain = process.env['COGNITO_HOSTED_UI_DOMAIN'] || null

    return c.json({
      data: {
        userPoolId,
        clientId,
        hostedUiDomain,
        redirectUri: 'movingapp://auth/callback',
      },
    })
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
