import { describe, it, expect } from 'vitest'
import {
  createMoney,
  addMoney,
  validateAddress,
  dateRangesOverlap,
  toUserId,
  toAddressId,
  type Address,
  type Money,
  type DateRange,
} from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: toAddressId('a-1'),
    line1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postalCode: '97201',
    country: 'US',
    ...overrides,
  }
}

function range(start: string, end: string): DateRange {
  return { start: new Date(start), end: new Date(end) }
}

// ---------------------------------------------------------------------------
// createMoney
// ---------------------------------------------------------------------------

describe('createMoney', () => {
  it('accepts zero amount', () => {
    expect(createMoney(0, 'USD')).toEqual({ amount: 0, currency: 'USD' })
  })

  it('accepts a positive integer amount', () => {
    expect(createMoney(500, 'USD')).toEqual({ amount: 500, currency: 'USD' })
  })

  it('accepts a positive fractional amount', () => {
    expect(createMoney(9.99, 'USD')).toEqual({ amount: 9.99, currency: 'USD' })
  })

  it('throws for a negative integer amount', () => {
    expect(() => createMoney(-1, 'USD')).toThrow('negative')
  })

  it('throws for a negative fractional amount', () => {
    expect(() => createMoney(-0.01, 'USD')).toThrow()
  })

  it('preserves the currency code exactly', () => {
    expect(createMoney(100, 'EUR').currency).toBe('EUR')
    expect(createMoney(100, 'GBP').currency).toBe('GBP')
    expect(createMoney(100, 'JPY').currency).toBe('JPY')
  })

  it('throws with a message referencing the offending amount', () => {
    expect(() => createMoney(-50, 'USD')).toThrow('-50')
  })
})

// ---------------------------------------------------------------------------
// addMoney
// ---------------------------------------------------------------------------

describe('addMoney', () => {
  it('adds two zero-amount values', () => {
    const a: Money = { amount: 0, currency: 'USD' }
    const b: Money = { amount: 0, currency: 'USD' }
    expect(addMoney(a, b)).toEqual({ amount: 0, currency: 'USD' })
  })

  it('adds a zero and a non-zero value', () => {
    const a: Money = { amount: 0, currency: 'USD' }
    const b: Money = { amount: 250, currency: 'USD' }
    expect(addMoney(a, b)).toEqual({ amount: 250, currency: 'USD' })
  })

  it('adds two positive values', () => {
    const a: Money = { amount: 100, currency: 'USD' }
    const b: Money = { amount: 99, currency: 'USD' }
    expect(addMoney(a, b)).toEqual({ amount: 199, currency: 'USD' })
  })

  it('works with EUR currency', () => {
    const a: Money = { amount: 50, currency: 'EUR' }
    const b: Money = { amount: 75, currency: 'EUR' }
    expect(addMoney(a, b)).toEqual({ amount: 125, currency: 'EUR' })
  })

  it('is commutative — a+b equals b+a', () => {
    const a: Money = { amount: 30, currency: 'USD' }
    const b: Money = { amount: 70, currency: 'USD' }
    expect(addMoney(a, b)).toEqual(addMoney(b, a))
  })

  it('throws with a descriptive message when currencies differ', () => {
    const a: Money = { amount: 100, currency: 'USD' }
    const b: Money = { amount: 100, currency: 'EUR' }
    expect(() => addMoney(a, b)).toThrow('Currency mismatch')
  })

  it('throws for USD + GBP mismatch', () => {
    const a: Money = { amount: 1, currency: 'USD' }
    const b: Money = { amount: 1, currency: 'GBP' }
    expect(() => addMoney(a, b)).toThrow()
  })

  it('preserves the currency in the result', () => {
    const a: Money = { amount: 5, currency: 'JPY' }
    const b: Money = { amount: 5, currency: 'JPY' }
    expect(addMoney(a, b).currency).toBe('JPY')
  })
})

// ---------------------------------------------------------------------------
// validateAddress
// ---------------------------------------------------------------------------

describe('validateAddress', () => {
  it('returns empty array for a fully populated address', () => {
    expect(validateAddress(makeAddress())).toHaveLength(0)
  })

  it('accepts an address with an optional line2 field', () => {
    expect(validateAddress(makeAddress({ line2: 'Apt 4B' }))).toHaveLength(0)
  })

  it('reports an error when line1 is an empty string', () => {
    const errors = validateAddress(makeAddress({ line1: '' }))
    expect(errors).toContain('line1 is required')
  })

  it('reports an error when line1 is whitespace-only', () => {
    const errors = validateAddress(makeAddress({ line1: '   ' }))
    expect(errors).toContain('line1 is required')
  })

  it('reports an error when city is empty', () => {
    const errors = validateAddress(makeAddress({ city: '' }))
    expect(errors).toContain('city is required')
  })

  it('reports an error when state is empty', () => {
    const errors = validateAddress(makeAddress({ state: '' }))
    expect(errors).toContain('state is required')
  })

  it('reports an error when postalCode is empty', () => {
    const errors = validateAddress(makeAddress({ postalCode: '' }))
    expect(errors).toContain('postalCode is required')
  })

  it('reports an error when country is empty', () => {
    const errors = validateAddress(makeAddress({ country: '' }))
    expect(errors).toContain('country is required')
  })

  it('reports multiple errors for multiple empty fields', () => {
    const errors = validateAddress(makeAddress({ line1: '', city: '', state: '' }))
    expect(errors).toContain('line1 is required')
    expect(errors).toContain('city is required')
    expect(errors).toContain('state is required')
    expect(errors).not.toContain('postalCode is required')
    expect(errors).not.toContain('country is required')
  })

  it('reports all 5 errors for a fully blank address', () => {
    const blank = makeAddress({ line1: '', city: '', state: '', postalCode: '', country: '' })
    const errors = validateAddress(blank)
    expect(errors).toHaveLength(5)
  })

  it('does NOT report an error for line2 — it is optional', () => {
    // line2 absent: no error expected
    const errors = validateAddress(makeAddress())
    const line2Errors = errors.filter((e) => e.includes('line2'))
    expect(line2Errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// dateRangesOverlap
// ---------------------------------------------------------------------------

describe('dateRangesOverlap', () => {
  it('returns true when ranges overlap in the middle', () => {
    expect(
      dateRangesOverlap(range('2026-01-01', '2026-01-10'), range('2026-01-05', '2026-01-15')),
    ).toBe(true)
  })

  it('returns true when ranges overlap at a single millisecond', () => {
    const a: DateRange = { start: new Date('2026-01-01'), end: new Date('2026-01-05T00:00:00.001Z') }
    const b: DateRange = { start: new Date('2026-01-05'), end: new Date('2026-01-10') }
    expect(dateRangesOverlap(a, b)).toBe(true)
  })

  it('returns true when one range is entirely contained within the other', () => {
    expect(
      dateRangesOverlap(range('2026-01-01', '2026-01-31'), range('2026-01-10', '2026-01-20')),
    ).toBe(true)
  })

  it('returns true when ranges are identical', () => {
    expect(
      dateRangesOverlap(range('2026-03-01', '2026-03-10'), range('2026-03-01', '2026-03-10')),
    ).toBe(true)
  })

  it('returns false for completely non-overlapping ranges (a before b)', () => {
    expect(
      dateRangesOverlap(range('2026-01-01', '2026-01-05'), range('2026-01-10', '2026-01-15')),
    ).toBe(false)
  })

  it('returns false for completely non-overlapping ranges (b before a)', () => {
    expect(
      dateRangesOverlap(range('2026-06-01', '2026-06-10'), range('2026-01-01', '2026-01-31')),
    ).toBe(false)
  })

  it('returns false for adjacent ranges (a.end === b.start — half-open semantics)', () => {
    // [Jan1, Jan5) and [Jan5, Jan10) do NOT overlap — they touch but do not cross
    expect(
      dateRangesOverlap(range('2026-01-01', '2026-01-05'), range('2026-01-05', '2026-01-10')),
    ).toBe(false)
  })

  it('returns false for adjacent ranges (b.end === a.start)', () => {
    expect(
      dateRangesOverlap(range('2026-01-10', '2026-01-20'), range('2026-01-01', '2026-01-10')),
    ).toBe(false)
  })

  it('is symmetric — overlap(a, b) === overlap(b, a)', () => {
    const a = range('2026-03-01', '2026-03-10')
    const b = range('2026-03-07', '2026-03-15')
    expect(dateRangesOverlap(a, b)).toBe(dateRangesOverlap(b, a))
  })

  it('is symmetric for non-overlapping ranges too', () => {
    const a = range('2026-01-01', '2026-01-05')
    const b = range('2026-06-01', '2026-06-10')
    expect(dateRangesOverlap(a, b)).toBe(dateRangesOverlap(b, a))
  })
})

// ---------------------------------------------------------------------------
// Branded ID factories
// ---------------------------------------------------------------------------

describe('Shared ID factories', () => {
  it('toUserId preserves raw value', () => {
    expect(toUserId('user-abc')).toBe('user-abc')
  })

  it('toAddressId preserves raw value', () => {
    expect(toAddressId('addr-xyz')).toBe('addr-xyz')
  })

  it('two UserIds with the same raw value compare equal', () => {
    expect(toUserId('u-1')).toBe(toUserId('u-1'))
  })

  it('two UserIds with different raw values are not equal', () => {
    expect(toUserId('u-1')).not.toBe(toUserId('u-2'))
  })

  it('two AddressIds with the same raw value compare equal', () => {
    expect(toAddressId('a-1')).toBe(toAddressId('a-1'))
  })
})
