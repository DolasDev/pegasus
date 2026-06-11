// ---------------------------------------------------------------------------
// IdpSetupHints tests — environment-specific IdP registration values shown
// inside the SSO provider add/edit form.
//
// Tests cover:
//   - OIDC: Cognito /oauth2/idpresponse redirect URI + authorize scopes
//   - SAML: ACS URL + SP entity ID derived from the user pool ID
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IdpSetupHints } from '../routes/sso-config'

vi.mock('@/config', () => ({
  getConfig: () => ({
    apiUrl: 'https://api.test',
    cognito: {
      region: 'us-east-1',
      userPoolId: 'us-east-1_TESTPOOL',
      clientId: 'test-client-id',
      domain: 'https://pegasus-123456789.auth.us-east-1.amazoncognito.com',
      redirectUri: 'https://app.test/login/callback',
    },
  }),
}))

describe('IdpSetupHints', () => {
  it('shows the Cognito redirect URI and scopes for OIDC providers', () => {
    render(<IdpSetupHints type="OIDC" />)

    expect(
      screen.getByDisplayValue(
        'https://pegasus-123456789.auth.us-east-1.amazoncognito.com/oauth2/idpresponse',
      ),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('openid email profile')).toBeInTheDocument()
    expect(screen.getByText(/release the/i)).toBeInTheDocument()
  })

  it('shows the ACS URL and SP entity ID for SAML providers', () => {
    render(<IdpSetupHints type="SAML" />)

    expect(
      screen.getByDisplayValue(
        'https://pegasus-123456789.auth.us-east-1.amazoncognito.com/saml2/idpresponse',
      ),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('urn:amazon:cognito:sp:us-east-1_TESTPOOL')).toBeInTheDocument()
  })
})
