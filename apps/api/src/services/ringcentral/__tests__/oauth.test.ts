import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readOAuthConfig,
  exchangeJwtForToken,
  fetchExtensionInfo,
  RingCentralOAuthError,
  type JwtCredentials,
} from '../oauth'

const API_BASE = 'https://platform.devtest.ringcentral.com'

const creds: JwtCredentials = {
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  jwt: 'the-jwt-assertion',
}

// ---------------------------------------------------------------------------
// readOAuthConfig (platform master switch + default api base)
// ---------------------------------------------------------------------------

describe('readOAuthConfig', () => {
  it('returns null when the flag is off / unset', () => {
    expect(readOAuthConfig({ RINGCENTRAL_ENABLED: 'false' })).toBeNull()
    expect(readOAuthConfig({})).toBeNull()
  })

  it('defaults the api base when enabled', () => {
    const cfg = readOAuthConfig({ RINGCENTRAL_ENABLED: 'true' })
    expect(cfg?.apiBase).toBe('https://platform.ringcentral.com')
  })

  it('respects a RINGCENTRAL_API_BASE override', () => {
    const cfg = readOAuthConfig({ RINGCENTRAL_ENABLED: 'true', RINGCENTRAL_API_BASE: API_BASE })
    expect(cfg?.apiBase).toBe(API_BASE)
  })
})

// ---------------------------------------------------------------------------
// JWT-bearer exchange + extension info (fetch-mocked)
// ---------------------------------------------------------------------------

describe('exchangeJwtForToken / fetchExtensionInfo', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const ok = (json: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(''),
  })

  it('exchanges a JWT with Basic auth + jwt-bearer grant', async () => {
    fetchMock.mockResolvedValue(ok({ access_token: 'at', expires_in: 3600 }))
    const res = await exchangeJwtForToken(creds, API_BASE)
    expect(res.access_token).toBe('at')
    expect(res.expires_in).toBe(3600)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`${API_BASE}/restapi/oauth/token`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`,
    )
    expect((init.body as URLSearchParams).get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    )
    expect((init.body as URLSearchParams).get('assertion')).toBe('the-jwt-assertion')
  })

  it('throws a permanent RingCentralOAuthError on a 400', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
      json: () => Promise.resolve({}),
    })
    await expect(exchangeJwtForToken(creds, API_BASE)).rejects.toThrowError(
      expect.objectContaining({ status: 400, isPermanent: true }),
    )
  })

  it('treats a 5xx as transient (isPermanent false)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('busy'),
      json: () => Promise.resolve({}),
    })
    await expect(exchangeJwtForToken(creds, API_BASE)).rejects.toThrowError(
      expect.objectContaining({ status: 503, isPermanent: false }),
    )
  })

  it('reads account + extension ids from extension-info', async () => {
    fetchMock.mockResolvedValue(ok({ id: 808080, account: { id: 707070 } }))
    const info = await fetchExtensionInfo(API_BASE, 'at')
    expect(info).toEqual({ rcExtensionId: '808080', rcAccountId: '707070' })
  })

  it('throws when extension-info is missing ids', async () => {
    fetchMock.mockResolvedValue(ok({ id: 1 }))
    await expect(fetchExtensionInfo(API_BASE, 'at')).rejects.toThrow(/missing/)
  })

  it('throws a status-carrying RingCentralOAuthError on a non-2xx extension-info', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('insufficient scope'),
      json: () => Promise.resolve({}),
    })
    await expect(fetchExtensionInfo(API_BASE, 'at')).rejects.toThrowError(
      expect.objectContaining({ status: 403, isPermanent: true }),
    )
  })

  it('exposes RingCentralOAuthError.isPermanent by status', () => {
    expect(new RingCentralOAuthError('x', 401).isPermanent).toBe(true)
    expect(new RingCentralOAuthError('x', 500).isPermanent).toBe(false)
    expect(new RingCentralOAuthError('x').isPermanent).toBe(false)
  })
})
