import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const DOMAIN = 'https://auth.eu-west-1.amazoncognito.com'
const CLIENT_ID = 'test-client-id'
const REDIRECT_URI = 'http://localhost:5174/auth/callback'

function stubCognitoEnv() {
  vi.stubEnv('VITE_COGNITO_DOMAIN', DOMAIN)
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', CLIENT_ID)
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', REDIRECT_URI)
}

describe('getAuthorizationUrl', () => {
  beforeEach(() => {
    stubCognitoEnv()
    vi.resetModules()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    stubCognitoEnv()
    vi.resetModules()
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
