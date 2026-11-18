// ---------------------------------------------------------------------------
// RingCentralAccessToken repository: the shared, cross-Lambda tier of the
// RingCentral access-token cache.
//
// A dumb store: ciphertext in, ciphertext out. Encryption and the decision of
// when to mint live in services/ringcentral/shared-token-store.ts.
//
// Unlike the outbound OAuth cache (last-write-wins), duplicate mints are the
// bug here. Each RingCentral mint is a new session, and RingCentral revokes
// the oldest once a user/app pair exceeds ~5 sessions. So
// `withConnectionLock` serializes minting per connection with a
// transaction-scoped advisory lock. Neon's pooler runs in transaction mode,
// where a transaction-scoped lock is safe (a session-level lock is not).
//
// Not tenant-scoped: crons and the capture worker run across tenants and
// address rows by connection id, which is unique platform-wide.
// ---------------------------------------------------------------------------

import type { Prisma, PrismaClient } from '@prisma/client'

/** A shared-token row as the service consumes it (ciphertext still encrypted). */
export interface RcAccessTokenRow {
  tokenCiphertext: string
  tokenHash: string
  apiBase: string
  expiresAt: Date
}

type Client = PrismaClient | Prisma.TransactionClient

/**
 * Bound on lock wait + the mint inside it (Secrets Manager + RC + KMS, normally
 * ~1-2 s). Kept well under the API Lambda's 29 s wall (and db.ts's 25 s
 * statement_timeout): on timeout the caller falls back to a plain mint, which
 * must still fit in the request.
 */
const LOCK_TX_TIMEOUT_MS = 10_000

function operations(db: Client) {
  return {
    /** The token for a connection, only if it is still valid at `notExpiringBefore`. */
    async findFresh(
      connectionId: string,
      notExpiringBefore: Date,
    ): Promise<RcAccessTokenRow | null> {
      return db.ringCentralAccessToken.findFirst({
        where: { connectionId, expiresAt: { gt: notExpiringBefore } },
        select: { tokenCiphertext: true, tokenHash: true, apiBase: true, expiresAt: true },
      })
    },

    /** Store a freshly minted token, replacing whatever the connection held. */
    async upsert(connectionId: string, row: RcAccessTokenRow): Promise<void> {
      await db.ringCentralAccessToken.upsert({
        where: { connectionId },
        create: { connectionId, ...row },
        update: row,
      })
    },

    /**
     * Compare-and-delete: drop the row only while it still holds the token whose
     * hash is given (the one RingCentral just rejected). If another container
     * already replaced it with a newer token, that token survives.
     * Returns the number of rows deleted (0 or 1).
     */
    async deleteIfHash(connectionId: string, tokenHash: string): Promise<number> {
      const { count } = await db.ringCentralAccessToken.deleteMany({
        where: { connectionId, tokenHash },
      })
      return count
    },
  }
}

export type RcAccessTokenOperations = ReturnType<typeof operations>

export function createRingCentralAccessTokenRepository(db: PrismaClient) {
  return {
    ...operations(db),

    /**
     * Runs `fn` inside a transaction holding a per-connection advisory lock, so
     * concurrent callers that all found the token stale run one at a time. The
     * second caller re-reads inside the lock and sees the first caller's token.
     * The lock is released at commit/rollback.
     */
    async withConnectionLock<T>(
      connectionId: string,
      fn: (ops: RcAccessTokenOperations) => Promise<T>,
    ): Promise<T> {
      return db.$transaction(
        async (tx) => {
          const key = `ringcentral_access_token:${connectionId}`
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`
          return fn(operations(tx))
        },
        { maxWait: 5_000, timeout: LOCK_TX_TIMEOUT_MS },
      )
    },
  }
}

export type RingCentralAccessTokenRepository = ReturnType<
  typeof createRingCentralAccessTokenRepository
>
