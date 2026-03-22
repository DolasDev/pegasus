/**
 * Property-based tests for shared domain value objects.
 *
 * Uses fast-check to generate 1000+ random inputs and verify algebraic
 * properties that must hold for all valid inputs.
 */

import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'
import {
  createMoney,
  addMoney,
  dateRangesOverlap,
  type Money,
  type DateRange,
} from '../types'

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a non-negative finite number suitable for a Money amount. */
const amountArb = fc.float({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true })

/** Generates a small set of ISO 4217-like currency codes. */
const currencyArb = fc.constantFrom('USD', 'EUR', 'GBP', 'CAD', 'AUD')

/** Generates a valid Money value. */
const moneyArb = fc.record<Money>({
  amount: amountArb,
  currency: currencyArb,
})

/** Generates two Money values sharing the same currency. */
const sameCurrencyPairArb = currencyArb.chain((currency) =>
  fc.tuple(
    fc.record<Money>({ amount: amountArb, currency: fc.constant(currency) }),
    fc.record<Money>({ amount: amountArb, currency: fc.constant(currency) }),
  ),
)

const DATE_MIN = new Date('2000-01-01T00:00:00.000Z')
const DATE_MAX = new Date('2030-12-31T23:59:59.999Z')

/** Generates a valid DateRange (end strictly after start), never NaN. */
const dateRangeArb: fc.Arbitrary<DateRange> = fc
  .tuple(
    fc.date({ min: DATE_MIN, max: DATE_MAX, noInvalidDate: true }),
    fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }), // 1 ms to 1 year
  )
  .filter(([start, offsetMs]) => {
    const end = new Date(start.getTime() + offsetMs)
    return end <= DATE_MAX
  })
  .map(([start, offsetMs]) => ({
    start,
    end: new Date(start.getTime() + offsetMs),
  }))

// ---------------------------------------------------------------------------
// Money properties
// ---------------------------------------------------------------------------

describe('Money — createMoney', () => {
  it('rejects all negative amounts', () => {
    fc.assert(
      fc.property(
        fc.float({ max: -Number.EPSILON, noNaN: true, noDefaultInfinity: true }),
        currencyArb,
        (amount, currency) => {
          expect(() => createMoney(amount, currency)).toThrow()
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('accepts all non-negative amounts', () => {
    fc.assert(
      fc.property(amountArb, currencyArb, (amount, currency) => {
        const m = createMoney(amount, currency)
        expect(m.amount).toBe(amount)
        expect(m.currency).toBe(currency)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('Money — addMoney', () => {
  it('is commutative: addMoney(a, b).amount === addMoney(b, a).amount', () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        const ab = addMoney(a, b)
        const ba = addMoney(b, a)
        expect(ab.amount).toBeCloseTo(ba.amount, 10)
        expect(ab.currency).toBe(ba.currency)
      }),
      { numRuns: 1000 },
    )
  })

  it('preserves currency: result has the same currency as inputs', () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        const result = addMoney(a, b)
        expect(result.currency).toBe(a.currency)
        expect(result.currency).toBe(b.currency)
      }),
      { numRuns: 1000 },
    )
  })

  it('is associative: addMoney(addMoney(a,b),c).amount ≈ addMoney(a,addMoney(b,c)).amount', () => {
    fc.assert(
      fc.property(
        currencyArb.chain((currency) =>
          fc.tuple(
            fc.record<Money>({ amount: amountArb, currency: fc.constant(currency) }),
            fc.record<Money>({ amount: amountArb, currency: fc.constant(currency) }),
            fc.record<Money>({ amount: amountArb, currency: fc.constant(currency) }),
          ),
        ),
        ([a, b, c]) => {
          const lhs = addMoney(addMoney(a, b), c)
          const rhs = addMoney(a, addMoney(b, c))
          expect(lhs.amount).toBeCloseTo(rhs.amount, 8)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('throws when currencies differ', () => {
    fc.assert(
      fc.property(
        fc.record<Money>({ amount: amountArb, currency: fc.constant('USD') }),
        fc.record<Money>({ amount: amountArb, currency: fc.constant('EUR') }),
        (usd, eur) => {
          expect(() => addMoney(usd, eur)).toThrow()
        },
      ),
      { numRuns: 500 },
    )
  })

  it('identity: addMoney(a, zero).amount === a.amount', () => {
    fc.assert(
      fc.property(moneyArb, (a) => {
        const zero: Money = { amount: 0, currency: a.currency }
        expect(addMoney(a, zero).amount).toBeCloseTo(a.amount, 10)
      }),
      { numRuns: 1000 },
    )
  })
})

// ---------------------------------------------------------------------------
// DateRange properties
// ---------------------------------------------------------------------------

describe('DateRange — dateRangesOverlap', () => {
  it('is reflexive: any range overlaps itself', () => {
    fc.assert(
      fc.property(dateRangeArb, (range) => {
        expect(dateRangesOverlap(range, range)).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('is symmetric: overlap(a, b) === overlap(b, a)', () => {
    fc.assert(
      fc.property(dateRangeArb, dateRangeArb, (a, b) => {
        expect(dateRangesOverlap(a, b)).toBe(dateRangesOverlap(b, a))
      }),
      { numRuns: 1000 },
    )
  })

  it('disjoint ranges do not overlap: a ends before b starts', () => {
    fc.assert(
      fc.property(
        dateRangeArb,
        fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }),
        (a, gapMs) => {
          // b starts at or after a.end — guaranteed non-overlapping
          const b: DateRange = {
            start: new Date(a.end.getTime() + gapMs),
            end: new Date(a.end.getTime() + gapMs + 1000),
          }
          expect(dateRangesOverlap(a, b)).toBe(false)
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('overlapping ranges are detected: b starts inside a', () => {
    fc.assert(
      fc.property(
        // Generate a range with at least 2ms duration so there is room for b.start inside a
        dateRangeArb.filter((r) => r.end.getTime() - r.start.getTime() >= 2),
        (a) => {
          const duration = a.end.getTime() - a.start.getTime()
          // b.start is strictly inside [a.start, a.end), b.end is after a.end
          const bStart = new Date(a.start.getTime() + Math.floor(duration / 2))
          const bEnd = new Date(a.end.getTime() + 1000)
          const b: DateRange = { start: bStart, end: bEnd }
          expect(dateRangesOverlap(a, b)).toBe(true)
        },
      ),
      { numRuns: 1000 },
    )
  })
})
