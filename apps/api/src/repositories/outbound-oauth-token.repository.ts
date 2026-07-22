// ---------------------------------------------------------------------------
// OutboundOAuthToken repository — the SHARED (L2) tier of the outbound OAuth2
// token cache (sdk-feedback 0027).
//
// Three operations, no more: read a still-fresh token, write one through, and
// drop one. Rows are pure cache — losing any of them only costs a re-mint, so
// there is deliberately no update-in-place, no versioning and no history.
//
// Not in TENANT_SCOPED_MODELS (lib/prisma.ts): these reads happen on the
// call_external path where the tenant is already resolved from the authenticated
// principal, and every query below scopes explicitly on tenantId. Adding it to
// the auto-scoping set would be harmless but redundant.
//
// The ciphertext never leaves this layer in plaintext — encryption/decryption is
// the service's job (services/outbound-oauth), so the repository stays a dumb,
// mockable store.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'

/** Identity of a cached token: which tenant, which integration, which endpoint. */
export interface OutboundTokenKey {
  tenantId: string
  integrationId: string
  tokenUrl: string
}

/** A cached row as the service consumes it (ciphertext still encrypted). */
export interface OutboundTokenRow {
  tokenCiphertext: string
  expiresAt: Date
}

export function createOutboundOAuthTokenRepository(db: PrismaClient) {
  return {
    /**
     * The cached token for a key, but ONLY if it is still valid at
     * `notExpiringBefore` — the caller passes `now + skew` so a token about to
     * expire mid-flight is treated as absent rather than handed out.
     * Returns null when there is no row or the row is too close to expiry.
     */
    async findFresh(
      key: OutboundTokenKey,
      notExpiringBefore: Date,
    ): Promise<OutboundTokenRow | null> {
      const row = await db.outboundOAuthToken.findFirst({
        where: {
          tenantId: key.tenantId,
          integrationId: key.integrationId,
          tokenUrl: key.tokenUrl,
          expiresAt: { gt: notExpiringBefore },
        },
        select: { tokenCiphertext: true, expiresAt: true },
      })
      return row
    },

    /**
     * Write a freshly minted token through to the shared tier.
     *
     * Upsert, last-write-wins: several containers can mint concurrently when the
     * cache is cold, and that race is benign — each minted a valid token, so
     * whichever lands last is as good as any other. A lock would cost more (and
     * add a failure mode) than the duplicate mints it prevents.
     */
    async upsert(key: OutboundTokenKey, tokenCiphertext: string, expiresAt: Date): Promise<void> {
      await db.outboundOAuthToken.upsert({
        where: {
          tenantId_integrationId_tokenUrl: {
            tenantId: key.tenantId,
            integrationId: key.integrationId,
            tokenUrl: key.tokenUrl,
          },
        },
        create: { ...key, tokenCiphertext, expiresAt },
        update: { tokenCiphertext, expiresAt },
      })
    },

    /**
     * Drop the shared row so every container re-mints. Called when a partner
     * rejects the token with a 401 — without this, the container that hit the
     * 401 would clear only its own memory while the others keep serving the
     * dead token from L2 until it expires on paper.
     *
     * `deleteMany` (not `delete`) so a concurrent invalidation is a no-op rather
     * than a P2025 throw.
     */
    async deleteKey(key: OutboundTokenKey): Promise<number> {
      const { count } = await db.outboundOAuthToken.deleteMany({
        where: {
          tenantId: key.tenantId,
          integrationId: key.integrationId,
          tokenUrl: key.tokenUrl,
        },
      })
      return count
    },
  }
}

export type OutboundOAuthTokenRepository = ReturnType<typeof createOutboundOAuthTokenRepository>
