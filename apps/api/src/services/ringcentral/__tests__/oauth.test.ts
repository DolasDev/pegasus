import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  readOAuthConfig,
  signState,
  verifyState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchExtensionInfo,
  type RingCentralOAuthConfig,
  type OAuthState,
} from '../oauth'

const config: RingCentralOAuthConfig = {
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  redirectUri: 'https://api.example/api/integrations/ringcentral/oauth/callback',
  apiBase: 'https://platform.devtest.ringcentral.com',
  stateSecret: 'state-signing-secret',
}

const state: OAuthState = {
  tenantId: 'tnt-1',
  ownerNumber: '+19085760908',
  nonce: 'nonce-1',
  iat: Date.now(),
}

// ---------------------------------------------------------------------------
// readOAuthConfig
// ---------------------------------------------------------------------------

describe('readOAuthConfig', () => {
  const base = {
    RINGCENTRAL_ENABLED: 'true',
    RINGCENTRAL_CLIENT_ID: 'cid',
    RINGCENTRAL_CLIENT_SECRET: 'csec',
    RINGCENTRAL_OAUTH_REDIRECT_URI: 'https://api/cb',
    RINGCENTRAL_OAUTH_STATE_SECRET: 'ssec',
  }

  it('returns null when the flag is off', () => {
    expect(readOAuthConfig({ ...base, RINGCENTRAL_ENABLED: 'false' })).toBeNull()
  })

  it('returns null when a required var is missing', () => {
    const { RINGCENTRAL_CLIENT_SECRET: _omit, ...partial } = base
    expect(readOAuthConfig(partial as NodeJS.ProcessEnv)).toBeNull()
  })

  it('returns config and defaults the api base when all present', () => {
    const cfg = readOAuthConfig(base as NodeJS.ProcessEnv)
    expect(cfg?.clientId).toBe('cid')
    expect(cfg?.apiBase).toBe('https://platform.ringcentral.com')
  })
})

// ---------------------------------------------------------------------------
// State signing
// ---------------------------------------------------------------------------

describe('signState / verifyState', () => {
  it('round-trips a valid state', () => {
    const token = signState(state, config.stateSecret)
    expect(verifyState(token, config.stateSecret)).toEqual(state)
  })

  it('rejects a tampered body', () => {
    const token = signState(state, config.stateSecret)
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...state, tenantId: 'evil' }), 'utf8').toString(
      'base64url',
    )
    expect(verifyState(`${forged}.${sig}`, config.stateSecret)).toBeNull()
    expect(body).toBeTruthy()
  })

  it('rejects a wrong signing secret', () => {
    const token = signState(state, config.stateSecret)
    expect(verifyState(token, 'different-secret')).toBeNull()
  })

  it('rejects a malformed token', () => {
    expect(verifyState('garbage', config.stateSecret)).toBeNull()
    expect(verifyState('', config.stateSecret)).toBeNull()
  })

  it('rejects a stale state (replay protection)', () => {
    const old: OAuthState = { ...state, iat: Date.now() - 20 * 60 * 1000 }
    const token = signState(old, config.stateSecret)
    expect(verifyState(token, config.stateSecret)).toBeNull()
  })

  it('rejects an implausibly future-dated state', () => {
    const future: OAuthState = { ...state, iat: Date.now() + 5 * 60 * 1000 }
    const token = signState(future, config.stateSecret)
    expect(verifyState(token, config.stateSecret)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Authorize URL
// ---------------------------------------------------------------------------

describe('buildAuthorizeUrl', () => {
  it('includes the OAuth query params', () => {
    const token = signState(state, config.stateSecret)
    const url = new URL(buildAuthorizeUrl(config, token))
    expect(url.origin).toBe('https://platform.devtest.ringcentral.com')
    expect(url.pathname).toBe('/restapi/oauth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-abc')
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(url.searchParams.get('state')).toBe(token)
  })
})

// ---------------------------------------------------------------------------
// Token exchange + extension info (fetch-mocked)
// ---------------------------------------------------------------------------

describe('exchangeCodeForToken / fetchExtensionInfo', () => {
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

  it('exchanges a code with Basic auth + form body', async () => {
    fetchMock.mockResolvedValue(
      ok({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        refresh_token_expires_in: 604800,
        scope: 'SMS ReadMessages',
        owner_id: 'ext-101',
      }),
    )
    const res = await exchangeCodeForToken(config, 'the-code')
    expect(res.refresh_token).toBe('rt')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://platform.devtest.ringcentral.com/restapi/oauth/token')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('client-abc:secret-xyz').toString('base64')}`,
    )
    expect((init.body as URLSearchParams).get('grant_type')).toBe('authorization_code')
    expect((init.body as URLSearchParams).get('code')).toBe('the-code')
  })

  it('throws on a non-2xx token response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
      json: () => Promise.resolve({}),
    })
    await expect(exchangeCodeForToken(config, 'bad')).rejects.toThrow(/400/)
  })

  it('reads account + extension ids from extension-info', async () => {
    fetchMock.mockResolvedValue(ok({ id: 808080, account: { id: 707070 } }))
    const info = await fetchExtensionInfo(config, 'at')
    expect(info).toEqual({ rcExtensionId: '808080', rcAccountId: '707070' })
  })

  it('throws when extension-info is missing ids', async () => {
    fetchMock.mockResolvedValue(ok({ id: 1 }))
    await expect(fetchExtensionInfo(config, 'at')).rejects.toThrow(/missing/)
  })
})
