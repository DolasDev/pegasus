import { describe, it, expect } from 'vitest'
import {
  calculateInvoiceBalance,
  canVoidInvoice,
  toInvoiceId,
  toPaymentId,
  type Invoice,
  type Payment,
  type InvoiceStatus,
  type PaymentMethod,
} from '../index'
import { toMoveId } from '../../dispatch/index'
import { toQuoteId } from '../../quoting/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: toInvoiceId('inv-1'),
    moveId: toMoveId('m-1'),
    status: 'ISSUED',
    total: { amount: 1000, currency: 'USD' },
    payments: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: toPaymentId('pay-1'),
    invoiceId: toInvoiceId('inv-1'),
    amount: { amount: 100, currency: 'USD' },
    method: 'CARD',
    paidAt: new Date('2026-01-15'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// calculateInvoiceBalance
// ---------------------------------------------------------------------------

describe('calculateInvoiceBalance', () => {
  it('returns the full total when no payments exist', () => {
    const invoice = makeInvoice({ total: { amount: 2500, currency: 'USD' } })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 2500, currency: 'USD' })
  })

  it('returns zero balance when payments array is empty', () => {
    // Same as above — explicit about empty array vs undefined
    const invoice = makeInvoice({ total: { amount: 500, currency: 'USD' }, payments: [] })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 500, currency: 'USD' })
  })

  it('subtracts a single partial payment', () => {
    const payment = makePayment({ amount: { amount: 300, currency: 'USD' } })
    const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments: [payment] })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 700, currency: 'USD' })
  })

  it('returns zero when a single payment covers the full amount', () => {
    const payment = makePayment({ amount: { amount: 1000, currency: 'USD' } })
    const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments: [payment] })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 0, currency: 'USD' })
  })

  it('clamps balance to zero when a single payment exceeds the total (overpayment)', () => {
    const payment = makePayment({ amount: { amount: 1500, currency: 'USD' } })
    const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments: [payment] })
    const result = calculateInvoiceBalance(invoice)
    expect(result.amount).toBe(0)
    expect(result.currency).toBe('USD')
  })

  it('sums multiple payments and returns the remaining balance', () => {
    const payments: Payment[] = [
      makePayment({ id: toPaymentId('p-1'), amount: { amount: 200, currency: 'USD' } }),
      makePayment({ id: toPaymentId('p-2'), amount: { amount: 300, currency: 'USD' } }),
      makePayment({ id: toPaymentId('p-3'), amount: { amount: 150, currency: 'USD' } }),
    ]
    // total = 1000, paid = 650, balance = 350
    const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 350, currency: 'USD' })
  })

  it('clamps to zero when multiple payments together exceed the total', () => {
    const payments: Payment[] = [
      makePayment({ id: toPaymentId('p-1'), amount: { amount: 600, currency: 'USD' } }),
      makePayment({ id: toPaymentId('p-2'), amount: { amount: 600, currency: 'USD' } }),
    ]
    // paid 1200 against 1000 — balance must not go negative
    const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments })
    expect(calculateInvoiceBalance(invoice).amount).toBe(0)
  })

  it('preserves the invoice currency in the returned Money', () => {
    const payment = makePayment({ amount: { amount: 50, currency: 'EUR' } })
    const invoice = makeInvoice({ total: { amount: 200, currency: 'EUR' }, payments: [payment] })
    const balance = calculateInvoiceBalance(invoice)
    expect(balance.currency).toBe('EUR')
    expect(balance.amount).toBe(150)
  })

  it('handles a zero-total invoice with no payments — balance is zero', () => {
    const invoice = makeInvoice({ total: { amount: 0, currency: 'USD' }, payments: [] })
    expect(calculateInvoiceBalance(invoice)).toEqual({ amount: 0, currency: 'USD' })
  })

  it('accepts all PaymentMethod types without affecting the calculation', () => {
    const methods: PaymentMethod[] = ['CARD', 'BANK_TRANSFER', 'CASH', 'CHECK']
    for (const method of methods) {
      const payment = makePayment({ method, amount: { amount: 250, currency: 'USD' } })
      const invoice = makeInvoice({ total: { amount: 1000, currency: 'USD' }, payments: [payment] })
      expect(calculateInvoiceBalance(invoice).amount).toBe(750)
    }
  })
})

// ---------------------------------------------------------------------------
// canVoidInvoice
// ---------------------------------------------------------------------------

describe('canVoidInvoice', () => {
  it('returns true for a DRAFT invoice with no payments', () => {
    expect(canVoidInvoice(makeInvoice({ status: 'DRAFT', payments: [] }))).toBe(true)
  })

  it('returns true for an ISSUED invoice with no payments', () => {
    expect(canVoidInvoice(makeInvoice({ status: 'ISSUED', payments: [] }))).toBe(true)
  })

  it('returns true for a PARTIALLY_PAID invoice that somehow has no payment records', () => {
    // Edge case: status says partial but payment list is empty — invariant is based on payments array
    expect(canVoidInvoice(makeInvoice({ status: 'PARTIALLY_PAID', payments: [] }))).toBe(true)
  })

  it('returns true for a PAID invoice with no payment records', () => {
    // Another edge: status PAID but empty payments array
    expect(canVoidInvoice(makeInvoice({ status: 'PAID', payments: [] }))).toBe(true)
  })

  it('returns false for an already VOID invoice with no payments', () => {
    expect(canVoidInvoice(makeInvoice({ status: 'VOID', payments: [] }))).toBe(false)
  })

  it('returns false when exactly one payment exists (any status)', () => {
    const payment = makePayment({ amount: { amount: 50, currency: 'USD' } })
    const statuses: InvoiceStatus[] = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID']
    for (const status of statuses) {
      expect(canVoidInvoice(makeInvoice({ status, payments: [payment] }))).toBe(false)
    }
  })

  it('returns false when multiple payments exist', () => {
    const payments: Payment[] = [
      makePayment({ id: toPaymentId('p-1'), amount: { amount: 200, currency: 'USD' } }),
      makePayment({ id: toPaymentId('p-2'), amount: { amount: 300, currency: 'USD' } }),
    ]
    expect(canVoidInvoice(makeInvoice({ payments }))).toBe(false)
  })

  it('returns false for VOID status even if payments array is empty', () => {
    // Specifically testing the status guard
    expect(canVoidInvoice(makeInvoice({ status: 'VOID', payments: [] }))).toBe(false)
  })

  it('returns false for VOID status with payments', () => {
    const payment = makePayment()
    expect(canVoidInvoice(makeInvoice({ status: 'VOID', payments: [payment] }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Invoice optional associations
// ---------------------------------------------------------------------------

describe('Invoice optional fields', () => {
  it('can be constructed without a quoteId', () => {
    const invoice = makeInvoice()
    expect(invoice.quoteId).toBeUndefined()
  })

  it('can carry a quoteId when provided', () => {
    const invoice = makeInvoice({ quoteId: toQuoteId('q-1') })
    expect(invoice.quoteId).toBe('q-1')
  })

  it('can carry optional issuedAt and dueAt dates', () => {
    const issuedAt = new Date('2026-02-01')
    const dueAt = new Date('2026-03-01')
    const invoice = makeInvoice({ issuedAt, dueAt })
    expect(invoice.issuedAt).toEqual(issuedAt)
    expect(invoice.dueAt).toEqual(dueAt)
  })
})

// ---------------------------------------------------------------------------
// Branded ID factories
// ---------------------------------------------------------------------------

describe('Billing ID factories', () => {
  it('toInvoiceId preserves raw value', () => {
    expect(toInvoiceId('inv-abc')).toBe('inv-abc')
  })

  it('toPaymentId preserves raw value', () => {
    expect(toPaymentId('pay-xyz')).toBe('pay-xyz')
  })

  it('two InvoiceIds with the same raw value compare equal', () => {
    expect(toInvoiceId('same')).toBe(toInvoiceId('same'))
  })

  it('two InvoiceIds with different raw values are not equal', () => {
    expect(toInvoiceId('a')).not.toBe(toInvoiceId('b'))
  })
})
