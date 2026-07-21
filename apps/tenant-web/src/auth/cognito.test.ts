// ---------------------------------------------------------------------------
// buildAuthorizeUrl — the parameters that decide WHICH account signs in.
//
// `login_hint` is the whole reason this file exists: without it an IdP with a
// cached browser session silently authenticates whoever it already has, which is
// how a user who typed their own address ended up signed in as someone else in
// prod. See the doc comment on buildAuthorizeUrl.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { buildAuthorizeUrl, type CognitoConfig } from './cognito'

const config: CognitoConfig = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_test',
  clientId: 'test-client-id',
  domain: 'https://auth.test.example.com',
  redirectUri: 'https://app.test/login/callback',
}

/** Parses the built URL back into query params so assertions read by name. */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('buildAuthorizeUrl', () => {
  it('sends the typed email as login_hint', () => {
    const p = params(buildAuthorizeUrl(config, 'AcmeOkta', 'challenge', 'state', 'user@acme.com'))

    expect(p.get('login_hint')).toBe('user@acme.com')
  })

  it('normalizes the hint so IdP matching is not case-sensitive', () => {
    const p = params(buildAuthorizeUrl(config, 'AcmeOkta', 'challenge', 'state', ' User@ACME.com '))

    expect(p.get('login_hint')).toBe('user@acme.com')
  })

  it('URL-encodes the hint rather than splicing it into the query string', () => {
    const url = buildAuthorizeUrl(config, 'AcmeOkta', 'challenge', 'state', 'first+last@acme.com')

    // The raw '+' must not survive into the query string, where it would decode
    // as a space and hint at a different address entirely.
    expect(url).not.toContain('first+last@acme.com')
    expect(params(url).get('login_hint')).toBe('first+last@acme.com')
  })

  it('keeps the rest of the PKCE + IdP parameter set intact', () => {
    const p = params(buildAuthorizeUrl(config, 'AcmeOkta', 'challenge', 'state', 'user@acme.com'))

    expect(Object.fromEntries(p)).toEqual({
      response_type: 'code',
      client_id: 'test-client-id',
      redirect_uri: 'https://app.test/login/callback',
      scope: 'openid email profile',
      state: 'state',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      identity_provider: 'AcmeOkta',
      login_hint: 'user@acme.com',
    })
  })

  it('targets the Cognito authorize endpoint on the configured domain', () => {
    const url = buildAuthorizeUrl(config, 'AcmeOkta', 'challenge', 'state', 'user@acme.com')

    expect(url.startsWith('https://auth.test.example.com/oauth2/authorize?')).toBe(true)
  })
})
