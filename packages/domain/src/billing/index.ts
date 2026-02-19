// ---------------------------------------------------------------------------
// Billing bounded context
// Handles invoices, payments, and settlement once a move is complete.
// ---------------------------------------------------------------------------

import type { Brand, Money } from '../shared/types'
import type { MoveId } from '../dispatch/index'
import type { QuoteId } from '../quoting/index'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies an Invoice aggregate. */
export type InvoiceId = Brand<string, 'InvoiceId'>

/** Uniquely identifies a Payment. */
export type PaymentId = Brand<string, 'PaymentId'>

export const toInvoiceId = (raw: string): InvoiceId => raw as InvoiceId
export const toPaymentId = (raw: string): PaymentId => raw as PaymentId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of an Invoice.
 *
 * PARTIALLY_PAID is set when at least one payment exists but the balance > 0.
 * PAID is set when the balance reaches zero.
 */
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'

/** The method used to make a payment. */
export type PaymentMethod = 'CARD' | 'BANK_TRANSFER' | 'CASH' | 'CHECK'

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * A record of a single payment against an Invoice.
 *
 * @invariant `amount.amount` must be > 0.
 */
export interface Payment {
  readonly id: PaymentId
  readonly invoiceId: InvoiceId
  readonly amount: Money
  readonly method: PaymentMethod
  readonly paidAt: Date
  readonly reference?: string
}

/**
 * The Invoice aggregate root.
 *
 * An Invoice is generated from an accepted Quote once the Move is complete.
 * Payments reduce the outstanding balance. Invoices cannot be voided once
 * payments exist against them.
 *
 * @invariant `payments` must all share the same currency as `total`.
 * @invariant An invoice cannot be voided if `payments` is non-empty.
 */
export interface Invoice {
  readonly id: InvoiceId
  readonly moveId: MoveId
  readonly quoteId?: QuoteId
  readonly status: InvoiceStatus
  readonly total: Money
  readonly payments: readonly Payment[]
  readonly issuedAt?: Date
  readonly dueAt?: Date
  readonly createdAt: Date
  readonly updatedAt: Date
}

// ---------------------------------------------------------------------------
// Domain functions
// ---------------------------------------------------------------------------

/**
 * Calculates the remaining unpaid balance on an Invoice.
 * Returns a Money value ≥ 0 in the same currency as the invoice total.
 */
export function calculateInvoiceBalance(invoice: Invoice): Money {
  const paid = invoice.payments.reduce((sum, p) => sum + p.amount.amount, 0)
  const balance = Math.max(0, invoice.total.amount - paid)
  return { amount: balance, currency: invoice.total.currency }
}

/**
 * Returns true when the invoice can be voided.
 *
 * @rule An invoice cannot be voided once payments exist against it.
 */
export function canVoidInvoice(invoice: Invoice): boolean {
  return invoice.payments.length === 0 && invoice.status !== 'VOID'
}
