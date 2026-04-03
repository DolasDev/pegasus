import { generateCodeVerifier, generateCodeChallenge } from '../auth/pkce'

describe('generateCodeVerifier', () => {
  it('returns a string of appropriate length (43-128 chars per RFC 7636)', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  it('contains only URL-safe base64url characters', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('generateCodeChallenge', () => {
  it('returns a non-empty string (SHA-256 base64url of verifier)', async () => {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    expect(typeof challenge).toBe('string')
    expect(challenge.length).toBeGreaterThan(0)
  })

  it('is deterministic: same verifier produces same challenge', async () => {
    const verifier = generateCodeVerifier()
    const c1 = await generateCodeChallenge(verifier)
    const c2 = await generateCodeChallenge(verifier)
    expect(c1).toBe(c2)
  })
})
