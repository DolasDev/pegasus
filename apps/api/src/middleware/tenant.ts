// ---------------------------------------------------------------------------
// Multi-tenant middleware
//
// Extracts the tenant slug from the incoming Host header subdomain, resolves
// the Tenant record from the database, then populates the Hono context with:
//   - tenantId  (string UUID)
//   - db        (tenant-scoped Prisma client extension)
//
// Routes protected by this middleware will abort with 400/404 if the tenant
// cannot be resolved, so downstream handlers are guaranteed a valid context.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db as basePrisma } from '../db'
import { createTenantDb } from '../lib/prisma'

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (_jwks === null) {
    const url = process.env['COGNITO_JWKS_URL']
    if (!url) throw new Error('COGNITO_JWKS_URL environment variable is not set')
    _jwks = createRemoteJWKSet(new URL(url))
  }
  return _jwks
}

function deriveIssuer(jwksUrl: string): string {
  return jwksUrl.replace('/.well-known/jwks.json', '')
}

/**
 * Hono middleware that resolves the tenant for the current request.
 *
 * Resolution order:
 *   1. Host header subdomain (production)
 *   2. X-Tenant-Slug header (local development / testing convenience)
 *
 * On success, sets `tenantId` and `db` (tenant-scoped) in context.
 * On failure, returns 400 (no slug) or 404 (unknown slug).
 */
export async function tenantMiddleware(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or malformed Authorization header', code: 'UNAUTHORIZED' }, 401)
  }

  const token = authHeader.slice(7)
  const jwksUrl = process.env['COGNITO_JWKS_URL'] ?? ''
  const tenantClientId = process.env['COGNITO_TENANT_CLIENT_ID'] ?? ''

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, getJwks(), {
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

  if (payload['token_use'] !== 'id') {
    return c.json({ error: 'Invalid token: ID token required', code: 'UNAUTHORIZED' }, 401)
  }

  const customTenantId = payload['custom:tenantId'] as string | undefined
  const customRole = payload['custom:role'] as string | undefined
  const cognitoSub = payload['sub'] as string | undefined

  if (!customTenantId || !customRole) {
    return c.json({ error: 'Forbidden: incomplete tenant configuration', code: 'FORBIDDEN' }, 403)
  }

  const tenant = await basePrisma.tenant.findUnique({ where: { id: customTenantId } })
  if (!tenant) {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  // Enforce tenant lifecycle status before routing the request any further.
  // SUSPENDED  → 403: the tenant's users should know their account is blocked.
  // OFFBOARDED → 404: deliberately indistinguishable from an unknown slug so
  //              offboarded tenants appear non-existent to their former users.
  if (tenant.status === 'SUSPENDED') {
    return c.json({ error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' }, 403)
  }
  if (tenant.status === 'OFFBOARDED') {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  const tenantDb = createTenantDb(basePrisma, tenant.id)

  c.set('tenantId', tenant.id)
  c.set('role', customRole)
  // Cast required because TenantDb is a Prisma extension subtype of PrismaClient.
  // The runtime instance IS the extension; the type annotation in AppVariables
  // uses PrismaClient for ergonomics across handler and repository code.
  c.set('db', tenantDb as unknown as PrismaClient)

  // Resolve the TenantUser.id so handlers can use it for audit trails (e.g.
  // recording who created an API client). Fail-open: if the user record is not
  // found (shouldn't happen for valid authenticated sessions), userId is unset.
  if (cognitoSub) {
    const tenantUser = await basePrisma.tenantUser.findFirst({
      where: { tenantId: tenant.id, cognitoSub },
      select: { id: true },
    })
    if (tenantUser) {
      c.set('userId', tenantUser.id)
    }
  }

  await next()
}
