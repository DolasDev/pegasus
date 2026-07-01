import { describe, it, expect } from 'vitest'
import { normalizeCustomerSource } from '../customer-source-config'

describe('normalizeCustomerSource', () => {
  it('defaults null/undefined to prisma', () => {
    expect(normalizeCustomerSource(null)).toBe('prisma')
    expect(normalizeCustomerSource(undefined)).toBe('prisma')
  })

  it('accepts prisma and pegii case-insensitively with surrounding whitespace', () => {
    expect(normalizeCustomerSource('prisma')).toBe('prisma')
    expect(normalizeCustomerSource(' PEGII ')).toBe('pegii')
  })

  it('throws on any unrecognised value (no silent default)', () => {
    expect(() => normalizeCustomerSource('mssql')).toThrow(/Unknown customerSource/)
    expect(() => normalizeCustomerSource('')).toThrow(/Unknown customerSource/)
  })
})
