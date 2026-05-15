// ---------------------------------------------------------------------------
// Test helper — synthesise a principal in the Hono context.
//
// Handler tests historically did `c.set('role', 'tenant_admin')` on a fake
// middleware. With the Cedar/AVP migration, handlers go through
// `requirePermission`, which reads `principal`, `idToken`, and
// `policyStoreId`. This helper centralises the seeding so individual test
// files don't drift on the shape.
//
// Set AUTHZ_OFFLINE=true in the test environment (vitest setupFiles or
// per-suite beforeEach) so the offline wasm backend evaluates the same
// .cedar policies that production pushes into AVP.
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'

export interface PrincipalSeedOptions {
  /** Cedar role-group memberships. Defaults to ['tenant_admin']. */
  readonly roleNames?: readonly string[]
  /** Cognito sub. Defaults to 'test-sub'. */
  readonly sub?: string
  /** Tenant UUID. Defaults to 'test-tenant-id'. */
  readonly tenantId?: string
}

/**
 * Returns a Hono middleware that seeds the principal context the way
 * tenantMiddleware would in production. Mount it before the handler under
 * test.
 */
export function seedPrincipal(opts: PrincipalSeedOptions = {}) {
  const roleNames = opts.roleNames ?? ['tenant_admin']
  const sub = opts.sub ?? 'test-sub'
  const tenantId = opts.tenantId ?? 'test-tenant-id'

  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    c.set('tenantId', tenantId)
    c.set('principal', { sub, tenantId, roleNames: [...roleNames] })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    await next()
  }
}

/**
 * Convenience for handler tests that still drive their fixtures off the
 * legacy `'tenant_admin' | 'tenant_user' | null` shape. Translates that
 * string into Cedar role-group memberships and delegates to seedPrincipal.
 * The legacy `'tenant_user'` token is translated to `'viewer'` — the new
 * read-only baseline group that replaced it.
 */
export function seedPrincipalForRole(role: string | null, tenantId = 'test-tenant-id') {
  const roleNames = role === null ? [] : role === 'tenant_admin' ? ['tenant_admin'] : ['viewer']
  return seedPrincipal({ tenantId, roleNames })
}
