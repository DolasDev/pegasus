import { describe, it, expect } from 'vitest'
import { compareSemver } from '../semver'

describe('compareSemver', () => {
  it('orders by numeric core fields', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0) // numeric, not lexical
    expect(compareSemver('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('ranks a release above any prerelease of the same core', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
  })

  it('orders prereleases per semver §11', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0)
    // numeric identifiers rank below alphanumeric ones
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0)
    // a longer prerelease outranks its own prefix
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
  })
})

describe('compareSemver — degenerate input', () => {
  it('treats missing or non-numeric core fields as 0 instead of throwing', () => {
    expect(compareSemver('1', '1.0.0')).toBe(0)
    expect(compareSemver('1.x.0', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0-alpha.beta', '1.0.0-alpha.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBeLessThan(0)
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha')).toBe(0)
  })

  it('is antisymmetric across every prerelease rule', () => {
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0) // longer wins
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0) // lexical
    expect(compareSemver('1.0.0-alpha.10', '1.0.0-alpha.2')).toBeGreaterThan(0) // numeric
    expect(compareSemver('1.0.0-alpha', '1.0.0-1')).toBeGreaterThan(0) // alnum > numeric
    expect(compareSemver('1.0.0-01', '1.0.0-1')).toBe(0) // same numeric value
    expect(compareSemver('1.0', '1.0.1')).toBeLessThan(0) // a missing patch is 0
  })
})
