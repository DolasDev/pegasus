import { describe, it, expect } from 'vitest'
import {
  toUserId,
  toMoveId,
  toQuoteId,
  toAddressId,
  MOVE_STATUSES,
  canTransition,
  isQuoteValid,
  type Move,
  type Quote,
  type MoveStatus,
} from './index'

// ---------------------------------------------------------------------------
// Branded ID helpers
// ---------------------------------------------------------------------------
describe('branded id factories', () => {
  it('wraps a string as UserId', () => {
    expect(toUserId('u-1')).toBe('u-1')
  })

  it('wraps a string as MoveId', () => {
    expect(toMoveId('m-1')).toBe('m-1')
  })

  it('wraps a string as QuoteId', () => {
    expect(toQuoteId('q-1')).toBe('q-1')
  })

  it('wraps a string as AddressId', () => {
    expect(toAddressId('a-1')).toBe('a-1')
  })
})

// ---------------------------------------------------------------------------
// MoveStatus
// ---------------------------------------------------------------------------
describe('MOVE_STATUSES', () => {
  it('contains exactly 5 statuses', () => {
    expect(MOVE_STATUSES).toHaveLength(5)
  })

  it('includes all expected values', () => {
    const expected: MoveStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
    for (const s of expected) {
      expect(MOVE_STATUSES).toContain(s)
    }
  })
})

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------
describe('canTransition', () => {
  it('allows PENDING → SCHEDULED', () => {
    expect(canTransition('PENDING', 'SCHEDULED')).toBe(true)
  })

  it('allows PENDING → CANCELLED', () => {
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true)
  })

  it('allows SCHEDULED → IN_PROGRESS', () => {
    expect(canTransition('SCHEDULED', 'IN_PROGRESS')).toBe(true)
  })

  it('allows IN_PROGRESS → COMPLETED', () => {
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true)
  })

  it('disallows PENDING → COMPLETED', () => {
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false)
  })

  it('disallows COMPLETED → PENDING', () => {
    expect(canTransition('COMPLETED', 'PENDING')).toBe(false)
  })

  it('disallows CANCELLED → SCHEDULED', () => {
    expect(canTransition('CANCELLED', 'SCHEDULED')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isQuoteValid
// ---------------------------------------------------------------------------
describe('isQuoteValid', () => {
  const makeQuote = (overrides: Partial<Quote> = {}): Quote => ({
    id: toQuoteId('q-1'),
    moveId: toMoveId('m-1'),
    price: { amount: 1500, currency: 'USD' },
    status: 'SENT',
    validUntil: new Date(Date.now() + 86_400_000), // +1 day
    createdAt: new Date(),
    ...overrides,
  })

  it('returns true for a SENT quote that has not expired', () => {
    expect(isQuoteValid(makeQuote())).toBe(true)
  })

  it('returns false for a SENT quote that has expired', () => {
    const expired = makeQuote({ validUntil: new Date(Date.now() - 1000) })
    expect(isQuoteValid(expired)).toBe(false)
  })

  it('returns false for a DRAFT quote even if not expired', () => {
    expect(isQuoteValid(makeQuote({ status: 'DRAFT' }))).toBe(false)
  })

  it('returns false for an ACCEPTED quote', () => {
    expect(isQuoteValid(makeQuote({ status: 'ACCEPTED' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Move shape (compile-time + runtime check)
// ---------------------------------------------------------------------------
describe('Move shape', () => {
  const move: Move = {
    id: toMoveId('m-1'),
    userId: toUserId('u-1'),
    status: 'PENDING',
    origin: {
      id: toAddressId('a-1'),
      line1: '123 Main St',
      city: 'Portland',
      state: 'OR',
      postalCode: '97201',
      country: 'US',
    },
    destination: {
      id: toAddressId('a-2'),
      line1: '456 Oak Ave',
      city: 'Seattle',
      state: 'WA',
      postalCode: '98101',
      country: 'US',
    },
    scheduledDate: new Date('2025-09-01'),
    createdAt: new Date('2025-07-01'),
    updatedAt: new Date('2025-07-01'),
  }

  it('has the expected status', () => {
    expect(move.status).toBe('PENDING')
  })

  it('has origin city Portland', () => {
    expect(move.origin.city).toBe('Portland')
  })
})
