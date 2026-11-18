// Integration tests for the shared RingCentral access-token tier against real
// Postgres: the advisory lock really serializes concurrent mints, and
// compare-and-delete really spares a newer token. Skips without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { db } from '../db'
import { createRingCentralAccessTokenRepository } from './ringcentral-access-token.repository'
import {
  createSharedTokenStore,
  tokenHash,
  type SharedToken,
  type TokenCrypto,
} from '../services/ringcentral/shared-token-store'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG = 'rc-shared-token-test'

// Reversible stand-in for KMS that still binds the connection id, like the
// real encryption context does.
const crypto: TokenCrypto = {
  encrypt: async (plaintext, connectionId) =>
    Buffer.from(`${connectionId}|${plaintext}`).toString('base64'),
  decrypt: async (ciphertext, connectionId) => {
    const [boundTo, plaintext] = Buffer.from(ciphertext, 'base64').toString().split('|')
    if (boundTo !== connectionId) throw new Error('context mismatch')
    return plaintext!
  },
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!hasDb)('ringcentral shared access token (integration)', () => {
  let connectionId: string
  const repo = createRingCentralAccessTokenRepository(db)
  const store = createSharedTokenStore(repo, crypto)
  const NOW = Date.now()
  const token = (accessToken: string, ttlMs = 3_600_000): SharedToken => ({
    accessToken,
    apiBase: 'https://platform.ringcentral.com',
    expiresAt: NOW + ttlMs,
  })

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: SLUG },
      create: { name: SLUG, slug: SLUG },
      update: {},
    })
    await db.ringCentralConnection.deleteMany({ where: { tenantId: tenant.id } })
    connectionId = (
      await db.ringCentralConnection.create({
        data: {
          tenantId: tenant.id,
          rcAccountId: 'acct',
          rcExtensionId: 'ext',
          ownerNumber: '+14045550000',
          tokenSecretArn: 'arn:aws:secretsmanager:fake',
          scopes: [],
        },
      })
    ).id
  })

  beforeEach(async () => {
    await db.ringCentralAccessToken.deleteMany({ where: { connectionId } })
  })

  afterAll(async () => {
    await db.ringCentralConnection.deleteMany({ where: { id: connectionId } })
  })

  it('serializes concurrent cold callers onto ONE mint', async () => {
    let mints = 0
    const mint = async () => {
      mints++
      await sleep(150) // long enough that every caller is waiting on the lock
      return token(`minted-${mints}`)
    }

    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.mintOnce(connectionId, NOW + 300_000, mint)),
    )

    expect(mints).toBe(1)
    expect(results.filter((r) => r.minted)).toHaveLength(1)
    expect(new Set(results.map((r) => r.token.accessToken))).toEqual(new Set(['minted-1']))
    expect((await store.read(connectionId, NOW))?.accessToken).toBe('minted-1')
  })

  it('stores ciphertext + hash, never the plaintext', async () => {
    await store.mintOnce(connectionId, NOW, async () => token('secret-token'))

    const row = await db.ringCentralAccessToken.findUniqueOrThrow({ where: { connectionId } })
    expect(row.tokenCiphertext).not.toContain('secret-token')
    expect(row.tokenHash).toBe(tokenHash('secret-token'))
  })

  it('treats a row inside the freshness window as stale and replaces it', async () => {
    await store.mintOnce(connectionId, NOW, async () => token('old', 60_000))

    expect(await store.read(connectionId, NOW + 300_000)).toBeNull()
    const { token: next, minted } = await store.mintOnce(connectionId, NOW + 300_000, async () =>
      token('new'),
    )
    expect(minted).toBe(true)
    expect(next.accessToken).toBe('new')
  })

  it('discard deletes only the token that failed, never a newer one', async () => {
    await store.mintOnce(connectionId, NOW, async () => token('dead'))
    // Another container already replaced the dead token…
    await repo.upsert(connectionId, {
      tokenCiphertext: await crypto.encrypt('newer', connectionId),
      tokenHash: tokenHash('newer'),
      apiBase: 'https://platform.ringcentral.com',
      expiresAt: new Date(NOW + 3_600_000),
    })

    // …so a late discard of the dead one must leave it alone.
    await store.discard(connectionId, 'dead')
    expect((await store.read(connectionId, NOW))?.accessToken).toBe('newer')

    await store.discard(connectionId, 'newer')
    expect(await store.read(connectionId, NOW)).toBeNull()
  })

  it('re-mints over a row that cannot be decrypted for this connection', async () => {
    await repo.upsert(connectionId, {
      tokenCiphertext: await crypto.encrypt('foreign', 'some-other-connection'),
      tokenHash: tokenHash('foreign'),
      apiBase: 'https://platform.ringcentral.com',
      expiresAt: new Date(NOW + 3_600_000),
    })

    const { token: got, minted } = await store.mintOnce(connectionId, NOW, async () =>
      token('replacement'),
    )
    expect(minted).toBe(true)
    expect(got.accessToken).toBe('replacement')
  })

  it('cascades away with its connection', async () => {
    await store.mintOnce(connectionId, NOW, async () => token('t'))
    const conn = await db.ringCentralConnection.findUniqueOrThrow({ where: { id: connectionId } })
    await db.ringCentralConnection.delete({ where: { id: connectionId } })
    expect(await db.ringCentralAccessToken.count({ where: { connectionId } })).toBe(0)
    // Restore for afterAll symmetry.
    await db.ringCentralConnection.create({ data: { ...conn, scopes: [] } })
  })
})
