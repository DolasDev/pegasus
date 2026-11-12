// ---------------------------------------------------------------------------
// IntegrationFetchCache repository — the SHARED read-through tier behind
// POST /integrations/:id/fetch/:operation (vanline-source-binding C4/C5).
//
// Two operations, no more: read whatever is stored, and write one through. Rows
// are pure cache — losing any of them only costs a re-fetch, so there is
// deliberately no update-in-place, no versioning and no history. Modelled on
// outbound-oauth-token.repository, which is the precedent for "a Lambda-scaled
// cache tier has to live in Postgres, not in a per-container Map"
// (#521/#532/#535).
//
// ONE DELIBERATE DIVERGENCE from that precedent: the token repository evaluates
// freshness in SQL (`findFresh(key, notExpiringBefore)`), and this one does not.
// It cannot. C5 defers single-flight and the Risks section makes the
// duplicate-fetch METRIC non-optional in exchange; detecting a duplicate without
// any coordination means knowing the row's PRIOR `fetchedAt` before the partner
// call, and a freshness-filtered read collapses "no row" and "stale row" into
// the same `null`, destroying exactly that signal. So this returns the row at any
// age and the handler decides. It is also one read on the hit path instead of two,
// and comparing an app-written `fetchedAt` against an app-computed horizon keeps
// both sides of the comparison on one clock.
//
// `IntegrationFetchCache` IS in TENANT_SCOPED_MODELS (lib/prisma.ts), so a
// tenant-scoped client auto-scopes the reads. The extension deliberately does
// NOT rewrite `upsert` (see its own note on OutboundOAuthToken, which makes the
// identical compound-unique write through the same scoped client), so the write
// below passes tenantId explicitly in both the `where` and the `create` — and
// so does every read, which keeps the repository correct when handed the root
// client too. Belt and braces on a table holding partner answers obtained with
// one tenant's credentials.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'

/** Identity of a cached fetch: which tenant, which integration, which resolved request. */
export interface FetchCacheKey {
  tenantId: string
  integrationId: string
  operation: string
  /** sha256 of the fully resolved request — see `fetchRequestHash`. */
  requestHash: string
}

/** A fetch result as the handler stores and serves it. */
export interface FetchCacheResult {
  records: unknown[]
  recordCount: number
  pages: number
  attempts: number
  status: number
  truncated: boolean
  /** When the partner was actually called — what `maxAge` is measured against. */
  fetchedAt: Date
}

export function createIntegrationFetchCacheRepository(db: PrismaClient) {
  const select = {
    records: true,
    recordCount: true,
    pages: true,
    attempts: true,
    status: true,
    truncated: true,
    fetchedAt: true,
  } as const

  /** Prisma's `records` column is Json; the handler's contract is an array. */
  const toResult = (row: {
    records: Prisma.JsonValue
    recordCount: number
    pages: number
    attempts: number
    status: number
    truncated: boolean
    fetchedAt: Date
  }): FetchCacheResult => ({
    ...row,
    records: Array.isArray(row.records) ? (row.records as unknown[]) : [],
  })

  return {
    /**
     * Whatever is stored for a key, at ANY age — see the divergence note above
     * for why age is not filtered here. The handler compares `fetchedAt` against
     * its own horizon to decide hit vs miss, and keeps the value either way so a
     * concurrent duplicate fetch stays detectable.
     */
    async find(key: FetchCacheKey): Promise<FetchCacheResult | null> {
      const row = await db.integrationFetchCache.findFirst({ where: key, select })
      return row ? toResult(row) : null
    },

    /**
     * Write a freshly fetched result through to the shared tier.
     *
     * Upsert, last-write-wins: several containers can fetch concurrently when
     * the cache is cold, and that race is benign — each asked the partner the
     * same idempotent question, so whichever lands last is as good as any other.
     * A lock would cost more (and add a failure mode) than the duplicate GETs it
     * prevents, which is exactly the C5 decision.
     */
    async upsert(key: FetchCacheKey, result: FetchCacheResult): Promise<void> {
      const stored = {
        records: result.records as Prisma.InputJsonValue,
        recordCount: result.recordCount,
        pages: result.pages,
        attempts: result.attempts,
        status: result.status,
        truncated: result.truncated,
        fetchedAt: result.fetchedAt,
      }
      await db.integrationFetchCache.upsert({
        where: {
          tenantId_integrationId_operation_requestHash: {
            tenantId: key.tenantId,
            integrationId: key.integrationId,
            operation: key.operation,
            requestHash: key.requestHash,
          },
        },
        create: { ...key, ...stored },
        update: stored,
      })
    },
  }
}

export type IntegrationFetchCacheRepository = ReturnType<
  typeof createIntegrationFetchCacheRepository
>
