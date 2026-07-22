// ---------------------------------------------------------------------------
// Unit tests for the generic outbound OAuth2 client-credentials token cache.
// No network: `fetchImpl` and `now` are injected. Covers JSON + XML token
// parsing, the 60s-skew cache, re-mint on expiry / invalidate, and errors.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  acquireOutboundToken,
  invalidateOutboundToken,
  invalidateOutboundTokenEverywhere,
  outboundTokenCacheKey,
  parseAccessToken,
  OutboundOAuthError,
  __resetOutboundTokenCacheForTests,
  type SharedTokenTier,
} from './index'

const CFG = {
  tokenUrl: 'https://partner.example.com/oauth2/accessrequest',
  clientId: 'id',
  clientSecret: 'sec',
}
const KEY = outboundTokenCacheKey('t1', 'sirva_ade_shipment', CFG.tokenUrl)

const okRes = (body: string, contentType = 'application/json'): Response =>
  ({
    ok: true,
    status: 200,
    text: async () => body,
    headers: new Headers({ 'content-type': contentType }),
  }) as unknown as Response

beforeEach(() => {
  __resetOutboundTokenCacheForTests()
})

describe('parseAccessToken', () => {
  it('parses a JSON token body', () => {
    const p = parseAccessToken(
      JSON.stringify({ access_token: 'AAA', expires_in: 600, token_type: 'Bearer' }),
      'application/json',
    )
    expect(p).toEqual({ accessToken: 'AAA', expiresIn: 600, tokenType: 'Bearer' })
  })

  it('parses the ADE XML <Access> body (token is not JSON)', () => {
    const xml =
      '<Access xmlns="http://schemas.datacontract.org/2004/07/OAuth2.Models">' +
      '<access_token>XML-TOK</access_token><expires_in>600</expires_in><token_type>Bearer</token_type></Access>'
    const p = parseAccessToken(xml, 'application/xml')
    expect(p).toEqual({ accessToken: 'XML-TOK', expiresIn: 600, tokenType: 'Bearer' })
  })

  it('returns null when there is no access_token', () => {
    expect(parseAccessToken('<Access></Access>', 'application/xml')).toBeNull()
    expect(parseAccessToken('{}', 'application/json')).toBeNull()
  })
})

describe('acquireOutboundToken', () => {
  it('mints via Basic base64(id:secret) + grant_type=client_credentials and caches', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    const tok = await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl })
    expect(tok).toBe('TOK1')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CFG.tokenUrl)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('id:sec').toString('base64')}`,
    )
    expect(init.body).toBe('grant_type=client_credentials')

    // Second call inside the token's life → served from cache, no new mint.
    const tok2 = await acquireOutboundToken(KEY, CFG, { now: 2_000, fetchImpl })
    expect(tok2).toBe('TOK1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-mints once the cached token is within 60s of expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK2', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl }) // expiresAt = 600_000
    const again = await acquireOutboundToken(KEY, CFG, { now: 600_000 - 30_000, fetchImpl }) // within 60s skew
    expect(again).toBe('TOK2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('invalidateOutboundToken forces a re-mint (the 401 recovery path)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK2', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })
    invalidateOutboundToken(KEY)
    const fresh = await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl })
    expect(fresh).toBe('TOK2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('parses an XML token response end-to-end', async () => {
    const xml =
      '<Access><access_token>XT</access_token><expires_in>600</expires_in><token_type>Bearer</token_type></Access>'
    const fetchImpl = vi.fn().mockResolvedValue(okRes(xml, 'application/xml'))
    expect(await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).toBe('XT')
  })

  it('throws OutboundOAuthError on a non-2xx token endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad creds',
      headers: new Headers(),
    } as unknown as Response)
    await expect(acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('throws OutboundOAuthError(502) when the token endpoint is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).rejects.toBeInstanceOf(
      OutboundOAuthError,
    )
  })
})

// ---------------------------------------------------------------------------
// Shared (L2) tier — sdk-feedback 0027.
//
// The scenario 0027 filed is CROSS-container: the in-memory Map is per-process,
// so two sequential call_external requests served by different Lambda containers
// each mint. `__resetOutboundTokenCacheForTests()` between calls is exactly that
// — a fresh container with an empty L1 — while the fake repo persists, standing
// in for the shared table.
// ---------------------------------------------------------------------------

describe('acquireOutboundToken — shared tier', () => {
  /** An in-memory stand-in for the outbound_oauth_tokens table. */
  function fakeRepo() {
    const rows = new Map<string, { tokenCiphertext: string; expiresAt: Date }>()
    const id = (k: { tenantId: string; integrationId: string; tokenUrl: string }): string =>
      `${k.tenantId}:${k.integrationId}:${k.tokenUrl}`
    return {
      rows,
      findFresh: vi.fn(async (k, notExpiringBefore: Date) => {
        const row = rows.get(id(k))
        if (!row || row.expiresAt <= notExpiringBefore) return null
        return row
      }),
      upsert: vi.fn(async (k, tokenCiphertext: string, expiresAt: Date) => {
        rows.set(id(k), { tokenCiphertext, expiresAt })
      }),
      deleteKey: vi.fn(async (k) => (rows.delete(id(k)) ? 1 : 0)),
    }
  }

  const KEYPARTS = { tenantId: 't1', integrationId: 'sirva_ade_shipment', tokenUrl: CFG.tokenUrl }
  // Reversible stand-ins for KMS — asserting on the "ciphertext" proves the token
  // is encrypted before it reaches the store and decrypted on the way back.
  const enc = async (p: string): Promise<string> => `enc(${p})`
  const dec = async (c: string): Promise<string> => c.replace(/^enc\(|\)$/g, '')

  const sharedWith = (repo: ReturnType<typeof fakeRepo>): SharedTokenTier =>
    ({ key: KEYPARTS, repo, encrypt: enc, decrypt: dec }) as unknown as SharedTokenTier

  it('two calls on DIFFERENT containers mint once — 0027 acceptance criterion', async () => {
    const repo = fakeRepo()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))

    const first = await acquireOutboundToken(KEY, CFG, {
      now: 1_000,
      fetchImpl,
      shared: sharedWith(repo),
    })
    expect(first).toBe('TOK1')

    // A different container: empty L1, same shared store.
    __resetOutboundTokenCacheForTests()

    const second = await acquireOutboundToken(KEY, CFG, {
      now: 2_000,
      fetchImpl,
      shared: sharedWith(repo),
    })
    expect(second).toBe('TOK1')
    // The whole point: ONE token-endpoint hit across two containers.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(repo.findFresh).toHaveBeenCalledTimes(2)
  })

  it('stores the token encrypted and never in plaintext', async () => {
    const repo = fakeRepo()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'SECRET-TOK', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl, shared: sharedWith(repo) })
    const stored = [...repo.rows.values()][0]!
    expect(stored.tokenCiphertext).toBe('enc(SECRET-TOK)')
    expect(stored.tokenCiphertext).not.toContain('SECRET-TOK'.slice(0, 6) + '"')
  })

  it('an L1 hit never touches the shared tier', async () => {
    const repo = fakeRepo()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl, shared: sharedWith(repo) })
    repo.findFresh.mockClear()
    // Same container, still warm → the DB must stay untouched (the fast path).
    await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl, shared: sharedWith(repo) })
    expect(repo.findFresh).not.toHaveBeenCalled()
  })

  it('does not serve a shared token inside the 60s skew', async () => {
    const repo = fakeRepo()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK2', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl, shared: sharedWith(repo) })
    __resetOutboundTokenCacheForTests()
    const again = await acquireOutboundToken(KEY, CFG, {
      now: 600_000 - 30_000,
      fetchImpl,
      shared: sharedWith(repo),
    })
    expect(again).toBe('TOK2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('degrades to a mint when the shared read fails (cache is never fatal)', async () => {
    const repo = fakeRepo()
    repo.findFresh.mockRejectedValue(new Error('neon: connection terminated'))
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    const tok = await acquireOutboundToken(KEY, CFG, {
      now: 0,
      fetchImpl,
      shared: sharedWith(repo),
    })
    expect(tok).toBe('TOK1')
  })

  it('degrades when the shared WRITE fails — the caller still gets its token', async () => {
    const repo = fakeRepo()
    repo.upsert.mockRejectedValue(new Error('kms: throttled'))
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    await expect(
      acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl, shared: sharedWith(repo) }),
    ).resolves.toBe('TOK1')
  })

  it('invalidateOutboundTokenEverywhere clears BOTH tiers after a 401', async () => {
    const repo = fakeRepo()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'DEAD', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'FRESH', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl, shared: sharedWith(repo) })

    await invalidateOutboundTokenEverywhere(KEY, sharedWith(repo))
    expect(repo.rows.size).toBe(0)

    // Another container must NOT be able to resurrect the rejected token.
    __resetOutboundTokenCacheForTests()
    const fresh = await acquireOutboundToken(KEY, CFG, {
      now: 1_000,
      fetchImpl,
      shared: sharedWith(repo),
    })
    expect(fresh).toBe('FRESH')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('swallows a shared-tier invalidation failure (a 401 must stay recoverable)', async () => {
    const repo = fakeRepo()
    repo.deleteKey.mockRejectedValue(new Error('neon: timeout'))
    await expect(invalidateOutboundTokenEverywhere(KEY, sharedWith(repo))).resolves.toBeUndefined()
  })

  it('is byte-for-byte the old behavior when no shared tier is supplied', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })
    // Flag off ⇒ a new container re-mints, exactly as before this change.
    __resetOutboundTokenCacheForTests()
    await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
