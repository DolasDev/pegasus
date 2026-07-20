import { describe, it, expect } from 'vitest'
import { normalizeEmail } from '../email'

describe('normalizeEmail', () => {
  it('lower-cases mixed-case addresses', () => {
    expect(normalizeEmail('Steve@Acme.com')).toBe('steve@acme.com')
    expect(normalizeEmail('USER@EXAMPLE.COM')).toBe('user@example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com')
    expect(normalizeEmail('\tUser@Example.com\n')).toBe('user@example.com')
  })

  it('leaves an already-normalized address unchanged', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com')
  })
})
