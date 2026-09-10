// ---------------------------------------------------------------------------
// forgotRefusalMessage — which explanation we are entitled to give.
//
// Boundary: pure copy selection. The regression it guards is #673's follow-up —
// the login page used to tell every refused reset that the account was
// federated, which stranded invitees whose 7-day temporary password had expired.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  forgotRefusalMessage,
  FORGOT_REFUSED_GENERIC,
  FORGOT_REFUSED_INVITE,
  FORGOT_REFUSED_INVITE_OR_SSO,
} from './forgot-password-message'
import type { TenantResolution } from './tenant-resolver'

function tenant(overrides?: Partial<TenantResolution>): TenantResolution {
  return {
    tenantId: 't1',
    tenantName: 'Acme Movers',
    cognitoAuthEnabled: true,
    providers: [],
    ...overrides,
  }
}

const ssoProvider = { id: 'acme-okta', name: 'Okta', type: 'oidc' as const }

describe('forgotRefusalMessage', () => {
  it('never claims SSO when no tenant has a provider configured', () => {
    // The bug: an expired invitee on a password-only tenant was told they sign
    // in through an identity provider that does not exist.
    const msg = forgotRefusalMessage([tenant(), tenant({ tenantId: 't2' })])

    expect(msg).toBe(FORGOT_REFUSED_INVITE)
    expect(msg).not.toMatch(/identity provider/i)
    expect(msg).toMatch(/resend your invitation/i)
  })

  it('offers both explanations when some tenant does have SSO', () => {
    // Both remain possible here, and we refuse to guess from the exception code.
    const msg = forgotRefusalMessage([tenant({ providers: [ssoProvider] })])

    expect(msg).toBe(FORGOT_REFUSED_INVITE_OR_SSO)
    expect(msg).toMatch(/identity provider/i)
    expect(msg).toMatch(/resend your invitation/i)
  })

  it('offers both when only one of several tenants has SSO', () => {
    const msg = forgotRefusalMessage([
      tenant(),
      tenant({ tenantId: 't2', providers: [ssoProvider] }),
    ])

    expect(msg).toBe(FORGOT_REFUSED_INVITE_OR_SSO)
  })

  it('falls back to generic copy for an unknown address', () => {
    // Also the resolution-failed path — the caller passes [] on error.
    const msg = forgotRefusalMessage([])

    expect(msg).toBe(FORGOT_REFUSED_GENERIC)
    expect(msg).not.toMatch(/identity provider/i)
    expect(msg).not.toMatch(/invitation/i)
  })

  it('never asserts the account has no password to reset', () => {
    // True only for a federated account; false for an expired invitation, where
    // there is a password-shaped account that simply cannot be reset this way.
    for (const msg of [
      FORGOT_REFUSED_GENERIC,
      FORGOT_REFUSED_INVITE,
      FORGOT_REFUSED_INVITE_OR_SSO,
    ]) {
      expect(msg).not.toMatch(/no password to reset/i)
    }
  })
})
