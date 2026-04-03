import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so constants are available inside the vi.mock factory below.
const { DOMAIN, CLIENT_ID, REDIRECT_URI } = vi.hoisted(() => ({
  DOMAIN: 'https://auth.eu-west-1.amazoncognito.com',
  CLIENT_ID: 'test-client-id',
  REDIRECT_URI: 'http://localhost:5174/auth/callback',
}))

// Mock ../config so getConfig() returns test values without needing loadConfig()
// (which would try to fetch /config.json at runtime).
vi.mock('../config', () => ({
  getConfig: () => ({
    apiUrl: 'http://localhost:3000',
    cognito: {
      domain: DOMAIN,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
    },
  }),
}))

describe('getAuthorizationUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
  })

  it('produces a valid Cognito authorize URL with correct query params', async () => {
    const { getAuthorizationUrl } = await import('../auth/cognito')
    const url = await getAuthorizationUrl()

    expect(url).toContain(`${DOMAIN}/oauth2/authorize`)

    const [, qs] = url.split('?')
    const params = new URLSearchParams(qs)
    expect(params.get('response_type')).toBe('code')
    expect(params.get('client_id')).toBe(CLIENT_ID)
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(params.get('scope')).toBe('openid email profile')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBeTruthy()
    expect(params.get('state')).toBeTruthy()
  })
})

describe('signOut (logout URL builder)', () => {
  let originalLocation: Location

  beforeEach(() => {
    vi.resetModules()
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('produces a valid Cognito logout URL', async () => {
    const { signOut } = await import('../auth/cognito')
    signOut()

    const href = (window.location as { href: string }).href
    expect(href).toContain(`${DOMAIN}/logout`)

    const [, qs] = href.split('?')
    const params = new URLSearchParams(qs)
    expect(params.get('client_id')).toBe(CLIENT_ID)
    expect(params.get('logout_uri')).toBeTruthy()
  })
})
