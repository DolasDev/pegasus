// ---------------------------------------------------------------------------
// Unit tests for the shared opaque-token helper (mint / hash / timing-safe
// compare). Pure crypto, no I/O.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { generateOpaqueToken, hashToken, tokenPrefixOf, tokenMatches } from './opaque-token'

describe('generateOpaqueToken', () => {
  it('mints `<prefix>_<48 hex>` with a 12-char lookup prefix and matching hash', () => {
    const t = generateOpaqueToken('fbk')
    expect(t.plainToken).toMatch(/^fbk_[0-9a-f]{48}$/)
    expect(t.tokenPrefix).toBe(t.plainToken.slice(0, 12))
    expect(tokenPrefixOf(t.plainToken)).toBe(t.tokenPrefix)
    expect(t.tokenHash).toBe(hashToken(t.plainToken))
  })

  it('produces distinct tokens each call', () => {
    expect(generateOpaqueToken('fbk').plainToken).not.toBe(generateOpaqueToken('fbk').plainToken)
  })
})

describe('tokenMatches', () => {
  it('accepts the right token and rejects the wrong one', () => {
    const t = generateOpaqueToken('ing')
    expect(tokenMatches(t.plainToken, t.tokenHash)).toBe(true)
    expect(tokenMatches('ing_deadbeef', t.tokenHash)).toBe(false)
  })

  it('is false (not a throw) on a length-mismatched hash', () => {
    expect(tokenMatches('anything', 'short')).toBe(false)
  })
})
