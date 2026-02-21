// ---------------------------------------------------------------------------
// Hono application types
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'

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
  /** The UUID of the resolved tenant for this request. */
  tenantId: string
  /**
   * A tenant-scoped Prisma client. All reads/writes are automatically
   * filtered/stamped with tenantId by the query extension in lib/prisma.ts.
   */
  db: PrismaClient
}

/** Hono environment type used when constructing the app and all sub-routers. */
export type AppEnv = { Variables: AppVariables }
