// ---------------------------------------------------------------------------
// Hono application types
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { ApiClientRow } from './repositories/api-client.repository'

/**
 * API client record without the keyHash — set for M2M-authenticated requests.
 *
 * `tenantId` and `createdById` are nullable to accommodate the platform-key
 * path in apiClientAuthMiddleware: a platform daemon (e.g. the WireGuard
 * reconcile agent) authenticates without a row in `api_clients`, has no
 * tenant scope, and no human creator.
 */
export type ApiClientContext = Omit<ApiClientRow, 'keyHash' | 'tenantId' | 'createdById'> & {
  tenantId: string | null
  createdById: string | null
}

/**
 * Variables injected into Hono context by the tenant middleware.
 * Every handler mounted under the /api/v1/* prefix can rely on these being
 * present — the middleware aborts with 4xx before reaching the handler if
 * the tenant cannot be resolved.
 *
 * `db` is typed as PrismaClient for ergonomics; at runtime it is always a
 * TenantDb (Prisma client extension) that automatically scopes all queries to
 * the resolved tenant. Developers never need to pass tenantId to Prisma calls.
 */
export type AppVariables = {
  /**
   * Correlation ID for this request — either forwarded from the `x-correlation-id`
   * request header or generated as a UUID by the correlation middleware.
   * Present on every request including /health and unauthenticated routes.
   */
  correlationId: string
  /** The UUID of the resolved tenant for this request. */
  tenantId: string
  /** The specific role the authenticated user holds in this tenant. */
  role: string
  /**
   * The TenantUser.id of the authenticated Cognito user. Set by tenantMiddleware
   * after resolving the TenantUser record by cognitoSub. Used for audit trails
   * (e.g. recording who created an API client). Undefined when the user's
   * TenantUser record cannot be found (e.g. race condition on first login).
   */
  userId: string | undefined
  /**
   * A tenant-scoped Prisma client. All reads/writes are automatically
   * filtered/stamped with tenantId by the query extension in lib/prisma.ts.
   */
  db: PrismaClient
  /**
   * The authenticated API client for M2M (machine-to-machine) requests.
   * Set by m2mAppAuthMiddleware. Undefined for Cognito-authenticated requests.
   * Handlers that require scope enforcement read scopes from this field.
   */
  apiClient: ApiClientContext | undefined
}

/** Hono environment type used when constructing the app and all sub-routers. */
export type AppEnv = { Variables: AppVariables }

/**
 * Variables injected into Hono context by the admin auth middleware.
 * Every handler mounted under the /api/admin/* prefix can rely on these being
 * present — the middleware aborts with 401/403 before reaching the handler if
 * the token is missing, invalid, or lacks the PLATFORM_ADMIN group claim.
 */
export type AdminVariables = {
  /** Stable Cognito user identifier (`sub` JWT claim). Never changes even if
   *  the admin updates their email. Use this as the durable identity key. */
  adminSub: string
  /** Admin user's email address (`email` JWT claim from the Cognito ID token). */
  adminEmail: string
}

/** Hono environment type used when constructing the admin sub-router. */
export type AdminEnv = { Variables: AdminVariables }

/**
 * Variables injected into Hono context by apiClientAuthMiddleware.
 * Routes protected by API key auth (M2M) can rely on these being present.
 *
 * `tenantId` is nullable: platform-scoped tokens (e.g. the WireGuard
 * reconcile agent) authenticate without a tenant scope. Tenant-scoped
 * handlers must guard against null and reject with 403.
 */
export type ApiClientVariables = {
  /**
   * The authenticated API client record — excludes keyHash. Synthetic for
   * platform-scoped clients (no row in `api_clients`).
   */
  apiClient: ApiClientContext
  /** The UUID of the resolved tenant. Null when the token is platform-scoped. */
  tenantId: string | null
}

/** Hono environment type for routes protected by API key auth. */
export type ApiClientEnv = { Variables: ApiClientVariables }
