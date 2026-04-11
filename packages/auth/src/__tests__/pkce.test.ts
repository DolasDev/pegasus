import { describe, it, expect } from 'vitest'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  base64UrlEncode,
} from '../pkce'

describe('base64UrlEncode', () => {
  it('produces only URL-safe characters (no +, /, =)', () => {
    // Use bytes that would produce +, /, = in standard base64
    const bytes = new Uint8Array([251, 239, 190, 253, 239, 190]) // 0xFBEFBEFDEFBE
    const encoded = base64UrlEncode(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('returns empty string for empty buffer', () => {
    expect(base64UrlEncode(new Uint8Array(0))).toBe('')
  })
})

describe('generateCodeVerifier', () => {
  it('returns a base64url string of at least 43 characters', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })

  it('returns a string no longer than 128 characters', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('contains only URL-safe base64url characters', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces different values on successive calls', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })
})

describe('generateCodeChallenge', () => {
  it('returns a non-empty base64url string', async () => {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge.length).toBeGreaterThan(0)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is deterministic: same verifier produces same challenge', async () => {
    const verifier = generateCodeVerifier()
    const c1 = await generateCodeChallenge(verifier)
    const c2 = await generateCodeChallenge(verifier)
    expect(c1).toBe(c2)
  })

  it('produces different challenges for different verifiers', async () => {
    const v1 = generateCodeVerifier()
    const v2 = generateCodeVerifier()
    const c1 = await generateCodeChallenge(v1)
    const c2 = await generateCodeChallenge(v2)
    expect(c1).not.toBe(c2)
  })
})

describe('generateState', () => {
  it('returns a non-empty base64url string', () => {
    const state = generateState()
    expect(state.length).toBeGreaterThan(0)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces different values on successive calls', () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toBe(b)
  })
})
