// ---------------------------------------------------------------------------
// Shared RingCentral access-token store: the tier every Lambda shares.
//
// Why it exists: RingCentral keeps only ~5 live sessions per user per app and
// revokes the oldest when a new one is minted. The sync/renew/health-check
// crons and the capture worker cold-start on almost every run, so a
// per-container cache never helped them. In prod (Nov 2026) one connection
// minted ~190 sessions/day, which kept evicting the legacy movemanager
// desktops' shared token (they then got 401 OAU-213 "Token not found").
//
// With this store, a connection's token lives in one Postgres row
// (ringcentral_access_tokens, KMS-encrypted). A stale token is replaced under a
// per-connection advisory lock, so containers that go cold together mint once,
// not once each.
//
// The store only encrypts, decrypts and serializes mints. Callers decide
// freshness (`notExpiringBefore`) and supply `mint`.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import type { RingCentralAccessTokenRepository } from '../../repositories/ringcentral-access-token.repository'

/** A usable token plus where it is valid. */
export interface SharedToken {
  accessToken: string
  apiBase: string
  /** Epoch ms. */
  expiresAt: number
}

export interface SharedTokenStore {
  /** The stored token if it outlives `notExpiringBefore` (epoch ms), else null. */
  read(connectionId: string, notExpiringBefore: number): Promise<SharedToken | null>
  /**
   * Under the connection's lock: return the stored token if a concurrent caller
   * already refreshed it, otherwise call `mint` once and store the result.
   */
  mintOnce(
    connectionId: string,
    notExpiringBefore: number,
    mint: () => Promise<SharedToken>,
  ): Promise<{ token: SharedToken; minted: boolean }>
  /** Delete the stored token only if it is still `accessToken` (compare-and-delete). */
  discard(connectionId: string, accessToken: string): Promise<void>
  /** Replace the stored token unconditionally (a token minted from new credentials). */
  put(connectionId: string, token: SharedToken): Promise<void>
}

export interface TokenCrypto {
  encrypt(plaintext: string, connectionId: string): Promise<string>
  decrypt(ciphertext: string, connectionId: string): Promise<string>
}

export function tokenHash(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex')
}

export function createSharedTokenStore(
  repo: RingCentralAccessTokenRepository,
  crypto: TokenCrypto,
): SharedTokenStore {
  const open = async (
    connectionId: string,
    row: { tokenCiphertext: string; apiBase: string; expiresAt: Date },
  ): Promise<SharedToken> => ({
    accessToken: await crypto.decrypt(row.tokenCiphertext, connectionId),
    apiBase: row.apiBase,
    expiresAt: row.expiresAt.getTime(),
  })

  const seal = async (connectionId: string, token: SharedToken) => ({
    tokenCiphertext: await crypto.encrypt(token.accessToken, connectionId),
    tokenHash: tokenHash(token.accessToken),
    apiBase: token.apiBase,
    expiresAt: new Date(token.expiresAt),
  })

  return {
    async read(connectionId, notExpiringBefore) {
      const row = await repo.findFresh(connectionId, new Date(notExpiringBefore))
      return row ? open(connectionId, row) : null
    },

    async mintOnce(connectionId, notExpiringBefore, mint) {
      return repo.withConnectionLock(connectionId, async (ops) => {
        const row = await ops.findFresh(connectionId, new Date(notExpiringBefore))
        if (row) {
          try {
            return { token: await open(connectionId, row), minted: false }
          } catch {
            // Undecryptable row (key or context mismatch): replace it below.
          }
        }
        const token = await mint()
        await ops.upsert(connectionId, await seal(connectionId, token))
        return { token, minted: true }
      })
    },

    async discard(connectionId, accessToken) {
      await repo.deleteIfHash(connectionId, tokenHash(accessToken))
    },

    async put(connectionId, token) {
      await repo.upsert(connectionId, await seal(connectionId, token))
    },
  }
}
