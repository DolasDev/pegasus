// ---------------------------------------------------------------------------
// sso-context — survives the IdP round-trip, and never crashes the callback.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { saveSsoContext, readSsoContext, clearSsoContext } from './sso-context'

const CONTEXT = {
  email: 'user@acme.com',
  tenantId: 'tenant-1',
  providerId: 'AcmeOkta',
  providerName: 'Acme Okta',
}

const KEY = 'pegasus.sso.context'

beforeEach(() => {
  sessionStorage.clear()
})

describe('sso-context', () => {
  it('round-trips what the login form knew', () => {
    saveSsoContext(CONTEXT)

    expect(readSsoContext()).toEqual(CONTEXT)
  })

  it('survives repeated reads — the recovery flow reads it more than once', () => {
    saveSsoContext(CONTEXT)

    expect(readSsoContext()).toEqual(CONTEXT)
    expect(readSsoContext()).toEqual(CONTEXT)
  })

  it('is gone after an explicit clear', () => {
    saveSsoContext(CONTEXT)
    clearSsoContext()

    expect(readSsoContext()).toBeNull()
  })

  it('returns null when nothing was stored', () => {
    expect(readSsoContext()).toBeNull()
  })

  it.each([
    ['unparseable JSON', 'not-json{'],
    ['a JSON primitive', '"just-a-string"'],
    ['null', 'null'],
    ['an array', '[]'],
    ['an object missing fields', JSON.stringify({ email: 'user@acme.com' })],
    ['an object with wrong field types', JSON.stringify({ ...CONTEXT, tenantId: 42 })],
  ])('returns null rather than throwing on %s', (_label, stored) => {
    // This only ever drives an error-recovery affordance. A bad read must
    // degrade to "no recovery offered", never to a crashed callback page.
    sessionStorage.setItem(KEY, stored)

    expect(() => readSsoContext()).not.toThrow()
    expect(readSsoContext()).toBeNull()
  })
})
