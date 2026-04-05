import { describe, it, expect } from 'vitest'
import {
  isQuoteValid,
  canFinalizeQuote,
  calculateQuoteTotal,
  toQuoteId,
  toQuoteLineItemId,
  toRateTableId,
  toRateId,
  type Quote,
  type QuoteLineItem,
  type QuoteStatus,
} from '../index'
import { toMoveId } from '../../dispatch/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: toQuoteId('q-1'),
    moveId: toMoveId('m-1'),
    price: { amount: 0, currency: 'USD' },
    status: 'DRAFT',
    validUntil: new Date(Date.now() + 86_400_000), // +1 day
    createdAt: new Date(),
    ...overrides,
  }
}

function makeLineItem(overrides: Partial<QuoteLineItem> = {}): QuoteLineItem {
  return {
    id: toQuoteLineItemId('li-1'),
    quoteId: toQuoteId('q-1'),
    description: 'Standard move service',
    quantity: 1,
    unitPrice: { amount: 100, currency: 'USD' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// isQuoteValid
// ---------------------------------------------------------------------------

describe('isQuoteValid', () => {
  it('returns true for a SENT quote with validUntil in the future', () => {
    const quote = makeQuote({ status: 'SENT', validUntil: new Date(Date.now() + 3600_000) })
    expect(isQuoteValid(quote)).toBe(true)
  })

  it('returns false for a SENT quote that expired 1 ms ago', () => {
    const quote = makeQuote({ status: 'SENT', validUntil: new Date(Date.now() - 1) })
    expect(isQuoteValid(quote)).toBe(false)
  })

  it('returns false for a SENT quote whose validUntil equals the reference time exactly', () => {
    // validUntil must be strictly greater than `at`
    const boundary = new Date('2026-06-01T12:00:00.000Z')
    const quote = makeQuote({ status: 'SENT', validUntil: boundary })
    expect(isQuoteValid(quote, boundary)).toBe(false)
  })

  it('returns true for a SENT quote whose validUntil is 1 ms after the reference time', () => {
    const at = new Date('2026-06-01T12:00:00.000Z')
    const validUntil = new Date(at.getTime() + 1)
    const quote = makeQuote({ status: 'SENT', validUntil })
    expect(isQuoteValid(quote, at)).toBe(true)
  })

  it('returns false for a DRAFT quote regardless of expiry', () => {
    const quote = makeQuote({ status: 'DRAFT', validUntil: new Date(Date.now() + 86_400_000) })
    expect(isQuoteValid(quote)).toBe(false)
  })

  it('returns false for an ACCEPTED quote', () => {
    const quote = makeQuote({ status: 'ACCEPTED', validUntil: new Date(Date.now() + 86_400_000) })
    expect(isQuoteValid(quote)).toBe(false)
  })

  it('returns false for a REJECTED quote', () => {
    const quote = makeQuote({ status: 'REJECTED', validUntil: new Date(Date.now() + 86_400_000) })
    expect(isQuoteValid(quote)).toBe(false)
  })

  it('returns false for an EXPIRED quote', () => {
    const quote = makeQuote({ status: 'EXPIRED', validUntil: new Date(Date.now() + 86_400_000) })
    expect(isQuoteValid(quote)).toBe(false)
  })

  it('uses the current time when no reference date is supplied', () => {
    const futureQuote = makeQuote({ status: 'SENT', validUntil: new Date(Date.now() + 9999_999) })
    expect(isQuoteValid(futureQuote)).toBe(true)

    const pastQuote = makeQuote({ status: 'SENT', validUntil: new Date(Date.now() - 9999_999) })
    expect(isQuoteValid(pastQuote)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// canFinalizeQuote
// ---------------------------------------------------------------------------

describe('canFinalizeQuote', () => {
  it('returns false when lineItems is undefined', () => {
    expect(canFinalizeQuote(makeQuote())).toBe(false)
  })

  it('returns false when lineItems is an empty array', () => {
    expect(canFinalizeQuote(makeQuote({ lineItems: [] }))).toBe(false)
  })

  it('returns true when lineItems has exactly one item', () => {
    expect(canFinalizeQuote(makeQuote({ lineItems: [makeLineItem()] }))).toBe(true)
  })

  it('returns true when lineItems has many items', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({ id: toQuoteLineItemId('li-1') }),
      makeLineItem({ id: toQuoteLineItemId('li-2') }),
      makeLineItem({ id: toQuoteLineItemId('li-3') }),
    ]
    expect(canFinalizeQuote(makeQuote({ lineItems: items }))).toBe(true)
  })

  it('is status-agnostic — works for DRAFT, SENT, ACCEPTED quotes', () => {
    const statuses: QuoteStatus[] = ['DRAFT', 'SENT', 'ACCEPTED']
    for (const status of statuses) {
      expect(canFinalizeQuote(makeQuote({ status, lineItems: [makeLineItem()] }))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// calculateQuoteTotal
// ---------------------------------------------------------------------------

describe('calculateQuoteTotal', () => {
  it('returns zero amount in USD when lineItems is undefined', () => {
    expect(calculateQuoteTotal(makeQuote())).toEqual({ amount: 0, currency: 'USD' })
  })

  it('returns zero amount in USD when lineItems is empty', () => {
    expect(calculateQuoteTotal(makeQuote({ lineItems: [] }))).toEqual({
      amount: 0,
      currency: 'USD',
    })
  })

  it('calculates quantity × unitPrice for a single item', () => {
    const item = makeLineItem({ quantity: 5, unitPrice: { amount: 200, currency: 'USD' } })
    expect(calculateQuoteTotal(makeQuote({ lineItems: [item] }))).toEqual({
      amount: 1000,
      currency: 'USD',
    })
  })

  it('sums multiple items correctly', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({
        id: toQuoteLineItemId('li-1'),
        quantity: 2,
        unitPrice: { amount: 100, currency: 'USD' },
      }),
      makeLineItem({
        id: toQuoteLineItemId('li-2'),
        quantity: 3,
        unitPrice: { amount: 50, currency: 'USD' },
      }),
      makeLineItem({
        id: toQuoteLineItemId('li-3'),
        quantity: 1,
        unitPrice: { amount: 250, currency: 'USD' },
      }),
    ]
    // 200 + 150 + 250 = 600
    expect(calculateQuoteTotal(makeQuote({ lineItems: items }))).toEqual({
      amount: 600,
      currency: 'USD',
    })
  })

  it('excludes items whose currency does not match the requested currency', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({
        id: toQuoteLineItemId('li-1'),
        quantity: 1,
        unitPrice: { amount: 500, currency: 'USD' },
      }),
      makeLineItem({
        id: toQuoteLineItemId('li-2'),
        quantity: 2,
        unitPrice: { amount: 100, currency: 'EUR' },
      }),
    ]
    expect(calculateQuoteTotal(makeQuote({ lineItems: items }), 'USD')).toEqual({
      amount: 500,
      currency: 'USD',
    })
  })

  it('returns only EUR items when EUR is requested', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({
        id: toQuoteLineItemId('li-1'),
        quantity: 1,
        unitPrice: { amount: 500, currency: 'USD' },
      }),
      makeLineItem({
        id: toQuoteLineItemId('li-2'),
        quantity: 2,
        unitPrice: { amount: 100, currency: 'EUR' },
      }),
    ]
    expect(calculateQuoteTotal(makeQuote({ lineItems: items }), 'EUR')).toEqual({
      amount: 200,
      currency: 'EUR',
    })
  })

  it('returns zero when no items match the requested currency', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({ quantity: 1, unitPrice: { amount: 999, currency: 'EUR' } }),
    ]
    expect(calculateQuoteTotal(makeQuote({ lineItems: items }), 'USD')).toEqual({
      amount: 0,
      currency: 'USD',
    })
  })

  it('handles a line item with quantity zero — contributes nothing', () => {
    const item = makeLineItem({ quantity: 0, unitPrice: { amount: 500, currency: 'USD' } })
    expect(calculateQuoteTotal(makeQuote({ lineItems: [item] }))).toEqual({
      amount: 0,
      currency: 'USD',
    })
  })

  it('handles fractional unit prices correctly', () => {
    const item = makeLineItem({ quantity: 3, unitPrice: { amount: 33.33, currency: 'USD' } })
    const result = calculateQuoteTotal(makeQuote({ lineItems: [item] }))
    expect(result.currency).toBe('USD')
    // 3 × 33.33 = 99.99 (floating point)
    expect(result.amount).toBeCloseTo(99.99, 2)
  })
})

// ---------------------------------------------------------------------------
// Quote immutability invariants (structural checks)
// ---------------------------------------------------------------------------

describe('Quote immutability after acceptance', () => {
  it('an ACCEPTED quote satisfies the status invariant', () => {
    const quote = makeQuote({
      status: 'ACCEPTED',
      lineItems: [makeLineItem()],
    })
    // The quote itself is accepted — isQuoteValid returns false (only SENT is valid)
    expect(isQuoteValid(quote)).toBe(false)
    expect(quote.status).toBe('ACCEPTED')
  })

  it('canFinalizeQuote still reflects line-item presence on an accepted quote', () => {
    const accepted = makeQuote({ status: 'ACCEPTED', lineItems: [makeLineItem()] })
    // Has items, so returns true — the business rule is about item count, not status
    expect(canFinalizeQuote(accepted)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Branded ID factories
// ---------------------------------------------------------------------------

describe('Quoting ID factories', () => {
  it('toQuoteId preserves raw value', () => {
    expect(toQuoteId('q-abc')).toBe('q-abc')
  })

  it('toQuoteLineItemId preserves raw value', () => {
    expect(toQuoteLineItemId('li-xyz')).toBe('li-xyz')
  })

  it('toRateTableId preserves raw value', () => {
    expect(toRateTableId('rt-1')).toBe('rt-1')
  })

  it('toRateId preserves raw value', () => {
    expect(toRateId('r-1')).toBe('r-1')
  })
})
