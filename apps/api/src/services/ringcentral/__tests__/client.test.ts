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
  makeClient,
  RateLimitError,
  __resetTokenCacheForTests,
} from '../client'
import { RingCentralOAuthError, DEFAULT_API_BASE } from '../oauth'
import type * as OAuthModule from '../oauth'

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  __resetTokenCacheForTests()
})

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

  it('honours a per-connection apiBase override', async () => {
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
