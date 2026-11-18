import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  getConnectionCredentials: vi.fn(),
  exchangeJwtForToken: vi.fn(),
}))

vi.mock('../../../lib/ringcentral-secrets', () => ({
  getConnectionCredentials: h.getConnectionCredentials,
}))
vi.mock('../oauth', async (importActual) => {
  const actual = await importActual<typeof OAuthModule>()
  return { ...actual, exchangeJwtForToken: h.exchangeJwtForToken }
})

import {
  acquireAccessToken,
  adoptMintedToken,
  invalidateToken,
  isSharedTokenTierEnabled,
  makeClient,
  RateLimitError,
  REUSE_MARGIN_MS,
  withRingCentralToken,
  __resetTokenCacheForTests,
  __setSharedTokenStoreForTests,
} from '../client'
import { RingCentralOAuthError, DEFAULT_API_BASE } from '../oauth'
import type * as OAuthModule from '../oauth'
import type { SharedToken, SharedTokenStore } from '../shared-token-store'

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  __resetTokenCacheForTests()
  // Default: L1 only. The shared-tier suites below inject a store.
  __setSharedTokenStoreForTests(null)
})

/**
 * An in-memory SharedTokenStore with the real store's contract: `mintOnce`
 * re-checks, then calls `mint` only if the row is stale. Its methods are spies,
 * so tests can make any step fail.
 */
function fakeStore(initial?: SharedToken) {
  let row: SharedToken | undefined = initial
  const store = {
    read: vi.fn(async (_id: string, notExpiringBefore: number) =>
      row && row.expiresAt > notExpiringBefore ? row : null,
    ),
    mintOnce: vi.fn(
      async (_id: string, notExpiringBefore: number, mint: () => Promise<SharedToken>) => {
        if (row && row.expiresAt > notExpiringBefore) return { token: row, minted: false }
        row = await mint()
        return { token: row, minted: true }
      },
    ),
    discard: vi.fn(async (_id: string, accessToken: string) => {
      if (row?.accessToken === accessToken) row = undefined
    }),
    put: vi.fn(async (_id: string, token: SharedToken) => {
      row = token
    }),
    get row() {
      return row
    },
    set row(next: SharedToken | undefined) {
      row = next
    },
  }
  return store satisfies SharedTokenStore & { row: SharedToken | undefined }
}

// ---------------------------------------------------------------------------
// acquireAccessToken (jwt-bearer)
// ---------------------------------------------------------------------------

describe('acquireAccessToken', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }

  beforeEach(() => {
    h.getConnectionCredentials.mockResolvedValue({ clientId: 'c', clientSecret: 's', jwt: 'j' })
    h.exchangeJwtForToken.mockResolvedValue({ access_token: 'at', expires_in: 3600 })
  })

  it('exchanges the JWT on first call and returns the token + default api base', async () => {
    const res = await acquireAccessToken(conn, 1_000_000)
    expect(res).toEqual({ accessToken: 'at', apiBase: DEFAULT_API_BASE })
    expect(h.getConnectionCredentials).toHaveBeenCalledWith('arn:1')
    expect(h.exchangeJwtForToken).toHaveBeenCalledWith(
      { clientId: 'c', clientSecret: 's', jwt: 'j' },
      DEFAULT_API_BASE,
    )
  })

  it('returns the cached token without re-exchanging while it is valid', async () => {
    await acquireAccessToken(conn, 1_000_000)
    await acquireAccessToken(conn, 1_000_000 + 1000)
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1) // cache hit
  })

  it('re-exchanges once the cached token is near expiry', async () => {
    await acquireAccessToken(conn, 1_000_000)
    await acquireAccessToken(conn, 1_000_000 + 3_600_000)
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(2)
  })

  it('honors a per-connection apiBase override', async () => {
    h.getConnectionCredentials.mockResolvedValue({
      clientId: 'c',
      clientSecret: 's',
      jwt: 'j',
      apiBase: 'https://platform.devtest.ringcentral.com',
    })
    const res = await acquireAccessToken(conn, 1_000_000)
    expect(res.apiBase).toBe('https://platform.devtest.ringcentral.com')
    expect(h.exchangeJwtForToken).toHaveBeenCalledWith(
      expect.objectContaining({ apiBase: 'https://platform.devtest.ringcentral.com' }),
      'https://platform.devtest.ringcentral.com',
    )
  })

  it('throws when the connection has no stored credentials', async () => {
    await expect(acquireAccessToken({ id: 'c2', tokenSecretArn: null })).rejects.toThrow(
      /no stored credentials/,
    )
  })

  it('re-mints a token that has less than the reuse margin left', async () => {
    h.exchangeJwtForToken.mockResolvedValue({ access_token: 'at', expires_in: 3600 })
    await acquireAccessToken(conn, 1_000_000)
    // 1 s inside the margin: reusing it could let it die mid-sync.
    await acquireAccessToken(conn, 1_000_000 + 3_600_000 - REUSE_MARGIN_MS + 1000)
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Shared (L2) tier: one token per connection across Lambdas
// ---------------------------------------------------------------------------

describe('acquireAccessToken with the shared tier', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }
  const NOW = 1_000_000
  const live = (accessToken: string): SharedToken => ({
    accessToken,
    apiBase: DEFAULT_API_BASE,
    expiresAt: NOW + 3_600_000,
  })

  beforeEach(() => {
    h.getConnectionCredentials.mockResolvedValue({ clientId: 'c', clientSecret: 's', jwt: 'j' })
    h.exchangeJwtForToken.mockResolvedValue({ access_token: 'minted', expires_in: 3600 })
  })

  it('reuses another container’s token from L2 without minting (no new RC session)', async () => {
    const store = fakeStore(live('shared'))
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res).toEqual({ accessToken: 'shared', apiBase: DEFAULT_API_BASE })
    expect(h.exchangeJwtForToken).not.toHaveBeenCalled()
    expect(store.mintOnce).not.toHaveBeenCalled()
  })

  it('promotes an L2 hit into L1 so the next call skips the database', async () => {
    const store = fakeStore(live('shared'))
    __setSharedTokenStoreForTests(store)

    await acquireAccessToken(conn, NOW)
    await acquireAccessToken(conn, NOW + 1000)

    expect(store.read).toHaveBeenCalledTimes(1)
  })

  it('on an L2 miss, mints exactly once through the lock and stores the token', async () => {
    const store = fakeStore()
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res.accessToken).toBe('minted')
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
    expect(store.mintOnce).toHaveBeenCalledWith(
      'conn-1',
      NOW + REUSE_MARGIN_MS,
      expect.any(Function),
    )
    expect(store.row?.accessToken).toBe('minted')
  })

  it('does not mint when a concurrent container refreshed the row while we waited on the lock', async () => {
    const store = fakeStore()
    store.mintOnce.mockResolvedValueOnce({ token: live('theirs'), minted: false })
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res.accessToken).toBe('theirs')
    expect(h.exchangeJwtForToken).not.toHaveBeenCalled()
  })

  it('treats an L2 read failure as a miss and still mints only once', async () => {
    const store = fakeStore()
    store.read.mockRejectedValueOnce(new Error('KMS AccessDenied'))
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res.accessToken).toBe('minted')
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
  })

  it('keeps the token it already minted when storing it fails (no second session)', async () => {
    const store = fakeStore()
    store.mintOnce.mockImplementationOnce(async (_id, _nb, mint) => {
      await mint()
      throw new Error('upsert failed')
    })
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res.accessToken).toBe('minted')
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
  })

  it('mints without the shared tier when the lock itself fails before any mint', async () => {
    const store = fakeStore()
    store.mintOnce.mockRejectedValueOnce(new Error('connection pool timeout'))
    __setSharedTokenStoreForTests(store)

    const res = await acquireAccessToken(conn, NOW)

    expect(res.accessToken).toBe('minted')
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected credential from the mint without trying again', async () => {
    const store = fakeStore()
    __setSharedTokenStoreForTests(store)
    h.exchangeJwtForToken.mockRejectedValue(new RingCentralOAuthError('invalid_grant', 400))

    await expect(acquireAccessToken(conn, NOW)).rejects.toMatchObject({ status: 400 })
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
  })
})

describe('invalidateToken', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }

  it('compare-and-deletes the rejected token in L2 and clears L1', async () => {
    const store = fakeStore({ accessToken: 'dead', apiBase: DEFAULT_API_BASE, expiresAt: 9e15 })
    __setSharedTokenStoreForTests(store)
    await acquireAccessToken(conn) // L1 now holds 'dead'

    await invalidateToken('conn-1', 'dead')

    expect(store.discard).toHaveBeenCalledWith('conn-1', 'dead')
    expect(store.row).toBeUndefined()
    h.getConnectionCredentials.mockResolvedValue({ clientId: 'c', clientSecret: 's', jwt: 'j' })
    h.exchangeJwtForToken.mockResolvedValue({ access_token: 'fresh', expires_in: 3600 })
    expect((await acquireAccessToken(conn)).accessToken).toBe('fresh')
  })

  it('swallows a shared-tier failure (the caller is mid-recovery from a 401)', async () => {
    const store = fakeStore()
    store.discard.mockRejectedValueOnce(new Error('db down'))
    __setSharedTokenStoreForTests(store)

    await expect(invalidateToken('conn-1', 'dead')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// withRingCentralToken: 401 → discard that token → retry once
// ---------------------------------------------------------------------------

describe('withRingCentralToken', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    h.getConnectionCredentials.mockResolvedValue({ clientId: 'c', clientSecret: 's', jwt: 'j' })
    h.exchangeJwtForToken
      .mockResolvedValueOnce({ access_token: 'first', expires_in: 3600 })
      .mockResolvedValueOnce({ access_token: 'second', expires_in: 3600 })
  })
  afterEach(() => vi.unstubAllGlobals())

  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  const unauthorized = () =>
    new Response(JSON.stringify({ errorCode: 'TokenInvalid', message: 'Token not found' }), {
      status: 401,
    })
  const bearerOf = (call: number) =>
    (fetchMock.mock.calls[call]![1] as RequestInit & { headers: Record<string, string> }).headers
      .Authorization

  it('on a 401, discards exactly the rejected token, re-acquires and retries once', async () => {
    const store = fakeStore()
    __setSharedTokenStoreForTests(store)
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok())

    const res = await withRingCentralToken(conn, (client) => client.get('/x'))

    expect(res).toEqual({ ok: true })
    expect(store.discard).toHaveBeenCalledWith('conn-1', 'first')
    expect(bearerOf(0)).toBe('Bearer first')
    expect(bearerOf(1)).toBe('Bearer second')
  })

  it('retries at most once: a second 401 propagates', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized())

    await expect(withRingCentralToken(conn, (client) => client.get('/x'))).rejects.toMatchObject({
      status: 401,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry or discard on a non-401 error', async () => {
    const store = fakeStore()
    __setSharedTokenStoreForTests(store)
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))

    await expect(withRingCentralToken(conn, (client) => client.get('/x'))).rejects.toMatchObject({
      status: 404,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.discard).not.toHaveBeenCalled()
  })

  it('does not discard the retry’s fresh token when it is rejected too', async () => {
    const store = fakeStore()
    __setSharedTokenStoreForTests(store)
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized())

    await expect(withRingCentralToken(conn, (client) => client.get('/x'))).rejects.toMatchObject({
      status: 401,
    })
    expect(store.discard).toHaveBeenCalledTimes(1)
    expect(store.discard).toHaveBeenCalledWith('conn-1', 'first')
    expect(store.row?.accessToken).toBe('second') // kept for the next caller
  })

  it('does not retry when acquiring the token itself fails (no extra mint)', async () => {
    h.exchangeJwtForToken.mockReset()
    h.exchangeJwtForToken.mockRejectedValue(new RingCentralOAuthError('invalid_client', 401))

    await expect(withRingCentralToken(conn, (client) => client.get('/x'))).rejects.toMatchObject({
      status: 401,
    })
    expect(h.exchangeJwtForToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('adoptMintedToken', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }
  const adopted: SharedToken = {
    accessToken: 'from-connect',
    apiBase: DEFAULT_API_BASE,
    expiresAt: Date.now() + 3_600_000,
  }

  it('replaces the shared token (e.g. one from old credentials) and serves it without minting', async () => {
    const store = fakeStore({
      accessToken: 'old-creds',
      apiBase: DEFAULT_API_BASE,
      expiresAt: 9e15,
    })
    __setSharedTokenStoreForTests(store)

    await adoptMintedToken('conn-1', adopted)

    expect(store.row?.accessToken).toBe('from-connect')
    expect((await acquireAccessToken(conn)).accessToken).toBe('from-connect')
    expect(h.exchangeJwtForToken).not.toHaveBeenCalled()
  })

  it('swallows a shared-tier failure (the connect already succeeded)', async () => {
    const store = fakeStore()
    store.put.mockRejectedValueOnce(new Error('KMS AccessDenied'))
    __setSharedTokenStoreForTests(store)

    await expect(adoptMintedToken('conn-1', adopted)).resolves.toBeUndefined()
  })
})

describe('isSharedTokenTierEnabled', () => {
  it('is on when the KMS key id is configured', () => {
    expect(isSharedTokenTierEnabled({ WORKFLOW_TOKEN_KMS_KEY_ID: 'key-1' })).toBe(true)
  })

  it('is off without the KMS key id (falls back to per-container minting)', () => {
    expect(isSharedTokenTierEnabled({})).toBe(false)
    expect(isSharedTokenTierEnabled({ WORKFLOW_TOKEN_KMS_KEY_ID: '' })).toBe(false)
  })

  it('is off when the kill switch is set, even with the key', () => {
    expect(
      isSharedTokenTierEnabled({
        WORKFLOW_TOKEN_KMS_KEY_ID: 'key-1',
        RINGCENTRAL_SHARED_TOKEN_DISABLED: 'true',
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// makeClient
// ---------------------------------------------------------------------------

describe('makeClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('GETs with bearer auth + query params and returns parsed JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ records: [1, 2] }),
      text: () => Promise.resolve(''),
    })
    const client = makeClient('https://platform.devtest.ringcentral.com', 'tok')
    const res = await client.get<{ records: number[] }>(
      '/restapi/v1.0/account/~/extension/~/message-store',
      {
        messageType: 'SMS',
      },
    )
    expect(res.records).toEqual([1, 2])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('messageType=SMS')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('throws RateLimitError on 429 with the Retry-After delay', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('rate limited'),
    })
    const client = makeClient('https://x', 'tok')
    await expect(client.get('/y')).rejects.toMatchObject({
      constructor: RateLimitError,
      retryAfterMs: 30_000,
    })
  })

  it('throws RingCentralOAuthError with the status on other non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('unauthorized'),
    })
    const client = makeClient('https://x', 'tok')
    await expect(client.get('/y')).rejects.toBeInstanceOf(RingCentralOAuthError)
  })

  it('carries the rejected parameter name on a 400', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      json: () => Promise.resolve({}),
      text: () =>
        Promise.resolve(
          '{"errorCode":"InvalidParameter","errors":[{"errorCode":"CMN-101","parameterName":"messageType"}],"parameterName":"messageType"}',
        ),
    })
    const client = makeClient('https://x', 'tok')
    await expect(client.get('/y')).rejects.toMatchObject({
      status: 400,
      errorCode: 'InvalidParameter',
      parameterName: 'messageType',
    })
  })
})

describe('rcParameterName', () => {
  it('reads a top-level or first nested parameterName, and tolerates non-JSON', async () => {
    const { rcParameterName } = await import('../client')
    expect(rcParameterName('{"parameterName":"messageType"}')).toBe('messageType')
    expect(
      rcParameterName('{"errors":[{"errorCode":"CMN-101","parameterName":"syncToken"}]}'),
    ).toBe('syncToken')
    expect(rcParameterName('{"errorCode":"CMN-428"}')).toBeUndefined()
    expect(rcParameterName('not json')).toBeUndefined()
  })
})

describe('rcErrorCode', () => {
  it('reads a top-level or first nested errorCode, and tolerates non-JSON', async () => {
    const { rcErrorCode } = await import('../client')
    expect(rcErrorCode('{"errorCode":"SMS-RC-413","message":"opted out"}')).toBe('SMS-RC-413')
    expect(rcErrorCode('{"errors":[{"errorCode":"SMS-CAR-413"}]}')).toBe('SMS-CAR-413')
    expect(rcErrorCode('<html>bad gateway</html>')).toBeUndefined()
    expect(rcErrorCode('{"message":"no code"}')).toBeUndefined()
  })
})
