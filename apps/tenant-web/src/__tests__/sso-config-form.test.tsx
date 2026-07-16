// ---------------------------------------------------------------------------
// ProviderForm tests — the OIDC client secret is the field that makes SSO work.
//
// Without it, POST /providers registers a Cognito IdP with no client_secret; the
// browser redirect and IdP login both succeed and only the final token exchange
// fails, as a 400 at /oauth2/idpresponse. These tests pin the field's presence and
// its write-only semantics (never pre-filled; blank on edit = leave unchanged).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderForm } from '../routes/sso-config'
import type { SsoProvider } from '@/api/queries/sso'

const createMutate = vi.fn()
const updateMutate = vi.fn()

vi.mock('@/api/queries/sso', () => ({
  useCreateSsoProvider: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSsoProvider: () => ({ mutateAsync: updateMutate, isPending: false }),
}))

vi.mock('@/config', () => ({
  getConfig: () => ({
    cognito: {
      userPoolId: 'us-east-1_TESTPOOL',
      domain: 'https://pegasus-123456789.auth.us-east-1.amazoncognito.com',
    },
  }),
}))

const oidcProvider: SsoProvider = {
  id: 'provider-1',
  name: 'Microsoft',
  type: 'OIDC',
  cognitoProviderName: 'Microsoft',
  metadataUrl: 'https://login.microsoftonline.com/tenant-id/v2.0/.well-known/openid-configuration',
  oidcClientId: 'existing-client-id',
  isEnabled: true,
  createdAt: '2026-07-16T14:56:02Z',
  updatedAt: '2026-07-16T14:56:02Z',
}

const secretLabel = /OIDC client secret/i

describe('ProviderForm — OIDC client secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMutate.mockResolvedValue(undefined)
    updateMutate.mockResolvedValue(undefined)
  })

  it('renders a masked secret field for OIDC providers', () => {
    render(<ProviderForm mode={{ kind: 'add' }} onDone={vi.fn()} />)

    const secret = screen.getByLabelText(secretLabel)
    expect(secret).toBeInTheDocument()
    expect(secret).toHaveAttribute('type', 'password')
    expect(secret).toBeRequired()
  })

  it('does not render the secret field for SAML providers', async () => {
    const user = userEvent.setup()
    render(<ProviderForm mode={{ kind: 'add' }} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'SAML' }))

    expect(screen.queryByLabelText(secretLabel)).not.toBeInTheDocument()
  })

  it('sends the secret when creating an OIDC provider', async () => {
    const user = userEvent.setup()
    render(<ProviderForm mode={{ kind: 'add' }} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(/display name/i), 'Microsoft')
    await user.type(screen.getByLabelText(/cognito provider name/i), 'Microsoft')
    await user.type(
      screen.getByLabelText(/discovery url/i),
      'https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration',
    )
    await user.type(screen.getByLabelText(/client id/i), 'client-abc')
    await user.type(screen.getByLabelText(secretLabel), 'super-secret')
    await user.click(screen.getByRole('button', { name: /add provider/i }))

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OIDC', oidcClientSecret: 'super-secret' }),
    )
  })

  // The API never returns the secret, so an untouched edit form has nothing to send.
  // Sending an empty string would wipe the working secret in Cognito.
  it('omits the secret from an edit that left the field blank', async () => {
    const user = userEvent.setup()
    render(<ProviderForm mode={{ kind: 'edit', provider: oidcProvider }} onDone={vi.fn()} />)

    expect(screen.getByLabelText(secretLabel)).toHaveValue('')

    await user.clear(screen.getByLabelText(/display name/i))
    await user.type(screen.getByLabelText(/display name/i), 'Microsoft Entra')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'provider-1',
      input: { name: 'Microsoft Entra' },
    })
  })

  it('sends the secret on edit when one is entered, to rotate it', async () => {
    const user = userEvent.setup()
    render(<ProviderForm mode={{ kind: 'edit', provider: oidcProvider }} onDone={vi.fn()} />)

    await user.type(screen.getByLabelText(secretLabel), 'rotated-secret')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'provider-1',
      input: { oidcClientSecret: 'rotated-secret' },
    })
  })

  // Changing a Cognito-stored field re-registers the provider, and the API holds no
  // copy of the secret to re-send — so the form must demand it rather than let the
  // API 400 (or worse, let a resync drop the secret).
  it('requires the secret once the client ID is changed on edit', async () => {
    const user = userEvent.setup()
    render(<ProviderForm mode={{ kind: 'edit', provider: oidcProvider }} onDone={vi.fn()} />)

    expect(screen.getByLabelText(secretLabel)).not.toBeRequired()

    await user.clear(screen.getByLabelText(/client id/i))
    await user.type(screen.getByLabelText(/client id/i), 'new-client-id')

    expect(screen.getByLabelText(secretLabel)).toBeRequired()
  })
})
