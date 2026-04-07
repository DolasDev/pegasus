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

const ResolveTenantsBody = z.object({
  /** Full email address — backend extracts domain for fallback lookup. */
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
// Used by all three endpoints that return provider lists to the login UI.
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
          ssoProviders: enabledSsoProvidersSelect,
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
        providers: mapProviders(tenant.ssoProviders),
      },
    })
  },
)

// ---------------------------------------------------------------------------
// POST /api/auth/resolve-tenants
//
// Returns ALL tenants the given email address is invited to, for use in the
// multi-tenant login picker. Called before any session exists.
//
// Resolution order:
//   1. Find TenantUser records for email where status != DEACTIVATED and
//      tenant.status = ACTIVE. If found, return as array.
//   2. If none found, fall back to domain-based lookup (backward compat for
//      domain-only tenants who have no TenantUser records for this email).
//   3. If still nothing, return empty array — UI shows "not registered".
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

    try {
      // Step 1: look up all TenantUser entries for this email.
      const tenantUsers = await db.tenantUser.findMany({
        where: {
          email,
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

      if (tenantUsers.length > 0) {
        return c.json({
          data: tenantUsers.map((tu) => ({
            tenantId: tu.tenant.id,
            tenantName: tu.tenant.name,
            cognitoAuthEnabled: tu.tenant.cognitoAuthEnabled,
            providers: mapProviders(tu.tenant.ssoProviders),
          })),
        })
      }

      // Step 2: domain-based fallback for tenants not using the TenantUser roster flow.
      const domain = email.split('@')[1]?.toLowerCase()
      const tenant = domain
        ? await db.tenant.findFirst({
            where: { emailDomains: { has: domain }, status: 'ACTIVE' },
            select: {
              id: true,
              name: true,
              cognitoAuthEnabled: true,
              ssoProviders: enabledSsoProvidersSelect,
            },
          })
        : null

      return c.json({
        data: tenant
          ? [
              {
                tenantId: tenant.id,
                tenantName: tenant.name,
                cognitoAuthEnabled: tenant.cognitoAuthEnabled,
                providers: mapProviders(tenant.ssoProviders),
              },
            ]
          : [],
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
// during Cognito authentication. Creates a short-lived AuthSession that the
// Lambda reads and deletes in one step.
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

    try {
      // Validate TenantUser is invited and not deactivated.
      const tenantUser = await db.tenantUser.findUnique({
        where: { tenantId_email: { tenantId, email } },
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
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
      await db.authSession.create({ data: { email, tenantId, expiresAt } })

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
