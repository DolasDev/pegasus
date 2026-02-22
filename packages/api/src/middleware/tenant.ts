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
import type { AppEnv } from '../types'
import { db as basePrisma } from '../db'
import { createTenantDb } from '../lib/prisma'

// Root-level subdomains that do not represent a tenant (e.g. the marketing
// site or API gateway health checks).
const NON_TENANT_SUBDOMAINS = new Set(['www', 'api', 'app', 'mail'])

/**
 * Extracts the subdomain segment from a Host header value.
 *
 * Examples:
 *   acme.pegasusapp.com  → "acme"
 *   www.pegasusapp.com   → null  (reserved subdomain)
 *   pegasusapp.com       → null  (no subdomain)
 *   localhost            → null  (local without X-Tenant-Slug)
 *
 * For local development where there is no real subdomain, callers can set the
 * `X-Tenant-Slug` header to simulate a tenant.
 */
function extractSubdomain(host: string): string | null {
  // Strip port number if present (e.g. "acme.pegasusapp.com:3000")
  const hostname = host.split(':')[0] ?? ''
  const parts = hostname.split('.')

  // A real subdomain requires at least 3 dot-separated segments.
  if (parts.length >= 3) {
    const sub = parts[0] ?? ''
    if (!sub || NON_TENANT_SUBDOMAINS.has(sub)) return null
    return sub
  }

  return null
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
  const host = c.req.header('host') ?? ''
  const slug = extractSubdomain(host) ?? c.req.header('x-tenant-slug') ?? null

  if (!slug) {
    return c.json({ error: 'Tenant slug could not be determined from Host header', code: 'TENANT_REQUIRED' }, 400)
  }

  const tenant = await basePrisma.tenant.findUnique({ where: { slug } })
  if (!tenant) {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  // Enforce tenant lifecycle status before routing the request any further.
  // SUSPENDED  → 403: the tenant's users should know their account is blocked.
  // OFFBOARDED → 404: deliberately indistinguishable from an unknown slug so
  //              offboarded tenants appear non-existent to their former users.
  if (tenant.status === 'SUSPENDED') {
    return c.json(
      { error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' },
      403,
    )
  }
  if (tenant.status === 'OFFBOARDED') {
    return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  const tenantDb = createTenantDb(basePrisma, tenant.id)

  c.set('tenantId', tenant.id)
  // Cast required because TenantDb is a Prisma extension subtype of PrismaClient.
  // The runtime instance IS the extension; the type annotation in AppVariables
  // uses PrismaClient for ergonomics across handler and repository code.
  c.set('db', tenantDb as unknown as import('@prisma/client').PrismaClient)

  await next()
}
