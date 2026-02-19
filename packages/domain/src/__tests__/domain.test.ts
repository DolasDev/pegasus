import { describe, it, expect } from 'vitest'
import {
  // shared
  createMoney,
  addMoney,
  validateAddress,
  dateRangesOverlap,
  toAddressId,
  toUserId,
  type Address,
  type Money,
  type DateRange,
  // dispatch
  toMoveId,
  toStopId,
  canDispatch,
  canTransition,
  type Move,
  type Stop,
  // quoting
  toQuoteId,
  toQuoteLineItemId,
  canFinalizeQuote,
  calculateQuoteTotal,
  type Quote,
  type QuoteLineItem,
  // billing
  toInvoiceId,
  toPaymentId,
  calculateInvoiceBalance,
  canVoidInvoice,
  type Invoice,
  type Payment,
  // schedule
  toCrewMemberId,
  toVehicleId,
  // customer
  toCustomerId,
  hasPrimaryContact,
  type Customer,
  type Contact,
  toContactId,
} from '../index'

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

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    id: toMoveId('m-1'),
    userId: toUserId('u-1'),
    status: 'PENDING',
    origin: makeAddress(),
    destination: makeAddress({ id: toAddressId('a-2'), line1: '456 Oak Ave', city: 'Seattle', state: 'WA', postalCode: '98101' }),
    scheduledDate: new Date('2026-03-01'),
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    ...overrides,
  }
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: toQuoteId('q-1'),
    moveId: toMoveId('m-1'),
    price: { amount: 1500, currency: 'USD' },
    status: 'DRAFT',
    validUntil: new Date(Date.now() + 86_400_000),
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
    unitPrice: { amount: 1500, currency: 'USD' },
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: toInvoiceId('inv-1'),
    moveId: toMoveId('m-1'),
    status: 'ISSUED',
    total: { amount: 1500, currency: 'USD' },
    payments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Money: negative amount throws
// ---------------------------------------------------------------------------
describe('createMoney', () => {
  it('rejects a negative amount', () => {
    expect(() => createMoney(-1, 'USD')).toThrow('negative')
  })

  it('accepts zero', () => {
    expect(createMoney(0, 'USD')).toEqual({ amount: 0, currency: 'USD' })
  })

  it('accepts a positive amount', () => {
    expect(createMoney(100, 'USD')).toEqual({ amount: 100, currency: 'USD' })
  })
})

// ---------------------------------------------------------------------------
// 2. Money: addMoney
// ---------------------------------------------------------------------------
describe('addMoney', () => {
  it('sums two values of the same currency', () => {
    const a: Money = { amount: 100, currency: 'USD' }
    const b: Money = { amount: 250, currency: 'USD' }
    expect(addMoney(a, b)).toEqual({ amount: 350, currency: 'USD' })
  })

  it('throws when currencies differ', () => {
    const a: Money = { amount: 100, currency: 'USD' }
    const b: Money = { amount: 100, currency: 'EUR' }
    expect(() => addMoney(a, b)).toThrow('Currency mismatch')
  })
})

// ---------------------------------------------------------------------------
// 3. Address: validateAddress catches empty required fields
// ---------------------------------------------------------------------------
describe('validateAddress — Stop requires a valid Address', () => {
  it('returns no errors for a complete address', () => {
    expect(validateAddress(makeAddress())).toHaveLength(0)
  })

  it('returns errors for an address with all empty strings', () => {
    const blank = makeAddress({ line1: '', city: '', state: '', postalCode: '', country: '' })
    const errors = validateAddress(blank)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('flags only the missing fields', () => {
    const partial = makeAddress({ line1: '', city: '' })
    const errors = validateAddress(partial)
    expect(errors).toContain('line1 is required')
    expect(errors).toContain('city is required')
    expect(errors).not.toContain('state is required')
  })
})

// ---------------------------------------------------------------------------
// 4. Dispatch: canDispatch
// ---------------------------------------------------------------------------
describe('canDispatch — A Move cannot be dispatched without at least one crew member', () => {
  it('returns false when no crew is assigned', () => {
    expect(canDispatch(makeMove())).toBe(false)
  })

  it('returns false when assignedCrewIds is an empty array', () => {
    expect(canDispatch(makeMove({ assignedCrewIds: [] }))).toBe(false)
  })

  it('returns true when at least one crew member is assigned', () => {
    expect(canDispatch(makeMove({ assignedCrewIds: [toCrewMemberId('crew-1')] }))).toBe(true)
  })

  it('returns true when multiple crew members are assigned', () => {
    expect(
      canDispatch(makeMove({ assignedCrewIds: [toCrewMemberId('crew-1'), toCrewMemberId('crew-2')] })),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Quoting: canFinalizeQuote
// ---------------------------------------------------------------------------
describe('canFinalizeQuote — A Quote must have at least one line item to be finalised', () => {
  it('returns false when lineItems is undefined', () => {
    expect(canFinalizeQuote(makeQuote())).toBe(false)
  })

  it('returns false when lineItems is empty', () => {
    expect(canFinalizeQuote(makeQuote({ lineItems: [] }))).toBe(false)
  })

  it('returns true when at least one line item exists', () => {
    expect(canFinalizeQuote(makeQuote({ lineItems: [makeLineItem()] }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6. Quoting: calculateQuoteTotal
// ---------------------------------------------------------------------------
describe('calculateQuoteTotal', () => {
  it('returns zero for a quote with no line items', () => {
    expect(calculateQuoteTotal(makeQuote())).toEqual({ amount: 0, currency: 'USD' })
  })

  it('sums quantities × unit price for each line item', () => {
    const items: QuoteLineItem[] = [
      makeLineItem({ id: toQuoteLineItemId('li-1'), quantity: 2, unitPrice: { amount: 100, currency: 'USD' } }),
      makeLineItem({ id: toQuoteLineItemId('li-2'), quantity: 3, unitPrice: { amount: 50, currency: 'USD' } }),
    ]
    expect(calculateQuoteTotal(makeQuote({ lineItems: items }))).toEqual({ amount: 350, currency: 'USD' })
  })
})

// ---------------------------------------------------------------------------
// 7. Billing: calculateInvoiceBalance
// ---------------------------------------------------------------------------
describe('calculateInvoiceBalance', () => {
  it('returns the full amount when no payments exist', () => {
    expect(calculateInvoiceBalance(makeInvoice())).toEqual({ amount: 1500, currency: 'USD' })
  })

  it('reduces the balance by payments received', () => {
    const payment: Payment = {
      id: toPaymentId('pay-1'),
      invoiceId: toInvoiceId('inv-1'),
      amount: { amount: 500, currency: 'USD' },
      method: 'CARD',
      paidAt: new Date(),
    }
    expect(calculateInvoiceBalance(makeInvoice({ payments: [payment] }))).toEqual({ amount: 1000, currency: 'USD' })
  })

  it('clamps balance to zero when overpaid', () => {
    const payment: Payment = {
      id: toPaymentId('pay-1'),
      invoiceId: toInvoiceId('inv-1'),
      amount: { amount: 2000, currency: 'USD' },
      method: 'BANK_TRANSFER',
      paidAt: new Date(),
    }
    expect(calculateInvoiceBalance(makeInvoice({ payments: [payment] })).amount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. Billing: canVoidInvoice
// ---------------------------------------------------------------------------
describe('canVoidInvoice', () => {
  it('returns true for an invoice with no payments', () => {
    expect(canVoidInvoice(makeInvoice())).toBe(true)
  })

  it('returns false when at least one payment exists', () => {
    const payment: Payment = {
      id: toPaymentId('pay-1'),
      invoiceId: toInvoiceId('inv-1'),
      amount: { amount: 100, currency: 'USD' },
      method: 'CASH',
      paidAt: new Date(),
    }
    expect(canVoidInvoice(makeInvoice({ payments: [payment] }))).toBe(false)
  })

  it('returns false for an already-voided invoice', () => {
    expect(canVoidInvoice(makeInvoice({ status: 'VOID' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 9. Schedule: dateRangesOverlap
// ---------------------------------------------------------------------------
describe('dateRangesOverlap', () => {
  const range = (start: string, end: string): DateRange => ({
    start: new Date(start),
    end: new Date(end),
  })

  it('returns true for overlapping ranges', () => {
    expect(dateRangesOverlap(range('2026-03-01', '2026-03-10'), range('2026-03-05', '2026-03-15'))).toBe(true)
  })

  it('returns false for non-overlapping ranges', () => {
    expect(dateRangesOverlap(range('2026-03-01', '2026-03-05'), range('2026-03-10', '2026-03-15'))).toBe(false)
  })

  it('returns false for adjacent (touching) ranges', () => {
    expect(dateRangesOverlap(range('2026-03-01', '2026-03-05'), range('2026-03-05', '2026-03-10'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 10. Customer: hasPrimaryContact
// ---------------------------------------------------------------------------
describe('hasPrimaryContact', () => {
  function makeContact(isPrimary: boolean, id = 'c-1'): Contact {
    return {
      id: toContactId(id),
      customerId: toCustomerId('cust-1'),
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      isPrimary,
    }
  }

  function makeCustomer(contacts: readonly Contact[]): Customer {
    return {
      id: toCustomerId('cust-1'),
      userId: toUserId('u-1'),
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      contacts,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }

  it('returns true when exactly one contact is primary', () => {
    expect(hasPrimaryContact(makeCustomer([makeContact(true)]))).toBe(true)
  })

  it('returns false when no contact is primary', () => {
    expect(hasPrimaryContact(makeCustomer([makeContact(false)]))).toBe(false)
  })

  it('returns false when more than one contact is primary', () => {
    expect(hasPrimaryContact(makeCustomer([makeContact(true, 'c-1'), makeContact(true, 'c-2')]))).toBe(false)
  })
})
