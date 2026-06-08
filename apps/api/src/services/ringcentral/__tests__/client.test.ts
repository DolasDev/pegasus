import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  getRefreshToken: vi.fn(),
  storeRefreshToken: vi.fn(),
  refreshAccessToken: vi.fn(),
  markTokenRefreshed: vi.fn(),
}))

vi.mock('../../../lib/ringcentral-secrets', () => ({
  getRefreshToken: h.getRefreshToken,
  storeRefreshToken: h.storeRefreshToken,
}))
vi.mock('../../../repositories/messaging.repository', () => ({
  markTokenRefreshed: h.markTokenRefreshed,
}))
vi.mock('../oauth', async (importActual) => {
  const actual = await importActual<typeof OAuthModule>()
  return { ...actual, refreshAccessToken: h.refreshAccessToken }
})

import {
  acquireAccessToken,
  makeClient,
  RateLimitError,
  __resetTokenCacheForTests,
} from '../client'
import { RingCentralOAuthError, type RingCentralOAuthConfig } from '../oauth'
import type * as OAuthModule from '../oauth'

const config = {
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'r',
  apiBase: 'https://platform.devtest.ringcentral.com',
  stateSecret: 'x',
} satisfies RingCentralOAuthConfig

const db = {} as never

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  __resetTokenCacheForTests()
})

// ---------------------------------------------------------------------------
// acquireAccessToken
// ---------------------------------------------------------------------------

describe('acquireAccessToken', () => {
  const conn = { id: 'conn-1', tokenSecretArn: 'arn:1' }

  beforeEach(() => {
    h.getRefreshToken.mockResolvedValue('rt')
    h.refreshAccessToken.mockResolvedValue({
      access_token: 'at',
      refresh_token: 'new-rt',
      expires_in: 3600,
    })
    h.storeRefreshToken.mockResolvedValue('arn:rotated')
  })

  it('refreshes + rotates on first call and caches the access token', async () => {
    const token = await acquireAccessToken(config, db, conn, 1_000_000)
    expect(token).toBe('at')
    expect(h.storeRefreshToken).toHaveBeenCalledWith('conn-1', 'new-rt')
    expect(h.markTokenRefreshed).toHaveBeenCalledWith(db, 'conn-1', expect.any(Date), 'arn:rotated')
  })

  it('returns the cached token without refreshing while it is valid', async () => {
    await acquireAccessToken(config, db, conn, 1_000_000)
    await acquireAccessToken(config, db, conn, 1_000_000 + 1000)
    expect(h.refreshAccessToken).toHaveBeenCalledTimes(1) // cache hit
  })

  it('re-refreshes once the cached token is near expiry', async () => {
    await acquireAccessToken(config, db, conn, 1_000_000)
    // 3600s later — past expiry minus the 60s skew.
    await acquireAccessToken(config, db, conn, 1_000_000 + 3_600_000)
    expect(h.refreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it('throws when the connection has no stored refresh token', async () => {
    await expect(
      acquireAccessToken(config, db, { id: 'c2', tokenSecretArn: null }),
    ).rejects.toThrow(/no stored refresh token/)
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
})
