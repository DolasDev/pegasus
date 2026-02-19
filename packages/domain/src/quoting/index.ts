// ---------------------------------------------------------------------------
// Quoting bounded context
// Converts a survey into a priced proposal accepted by the customer.
// ---------------------------------------------------------------------------

import type { Brand, Money } from '../shared/types'
import type { MoveId } from '../dispatch/index'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies a Quote aggregate. */
export type QuoteId = Brand<string, 'QuoteId'>

/** Uniquely identifies a line item within a Quote. */
export type QuoteLineItemId = Brand<string, 'QuoteLineItemId'>

/** Uniquely identifies a RateTable. */
export type RateTableId = Brand<string, 'RateTableId'>

/** Uniquely identifies a Rate within a RateTable. */
export type RateId = Brand<string, 'RateId'>

export const toQuoteId = (raw: string): QuoteId => raw as QuoteId
export const toQuoteLineItemId = (raw: string): QuoteLineItemId => raw as QuoteLineItemId
export const toRateTableId = (raw: string): RateTableId => raw as RateTableId
export const toRateId = (raw: string): RateId => raw as RateId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a Quote.
 *
 * Once ACCEPTED the quote is immutable.
 */
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * A single priced service or charge on a Quote.
 *
 * @invariant `quantity` must be > 0.
 * @invariant `unitPrice.amount` must be ≥ 0.
 */
export interface QuoteLineItem {
  readonly id: QuoteLineItemId
  readonly quoteId: QuoteId
  readonly description: string
  readonly quantity: number
  readonly unitPrice: Money
}

/**
 * A named unit price for a specific service type, belonging to a RateTable.
 */
export interface Rate {
  readonly id: RateId
  readonly rateTableId: RateTableId
  readonly serviceCode: string
  readonly description: string
  readonly unitPrice: Money
}

/**
 * A versioned collection of Rates used to price moves.
 *
 * Only one RateTable should be active at any given time.
 *
 * @invariant `effectiveFrom` must be before `effectiveTo` when both are set.
 */
export interface RateTable {
  readonly id: RateTableId
  readonly name: string
  readonly rates: readonly Rate[]
  readonly effectiveFrom: Date
  readonly effectiveTo?: Date
  readonly isActive: boolean
}

/**
 * The Quote aggregate root.
 *
 * A Quote is a formal price offer presented to the customer for a specific
 * Move. It starts as DRAFT while being assembled, is SENT to the customer,
 * and ends as ACCEPTED or REJECTED/EXPIRED.
 *
 * @invariant A Quote cannot be sent (transition from DRAFT to SENT) without
 *            at least one `QuoteLineItem` (`canFinalizeQuote` enforces this).
 * @invariant Once ACCEPTED, the Quote and its line items are immutable.
 */
export interface Quote {
  readonly id: QuoteId
  readonly moveId: MoveId
  /** Convenience total — must equal the sum of all line item amounts. */
  readonly price: Money
  readonly status: QuoteStatus
  readonly lineItems?: readonly QuoteLineItem[]
  readonly rateTableId?: RateTableId
  readonly validUntil: Date
  readonly createdAt: Date
}

// ---------------------------------------------------------------------------
// Domain functions
// ---------------------------------------------------------------------------

/** Returns true when the quote is still valid at the given point in time. */
export function isQuoteValid(quote: Quote, at: Date = new Date()): boolean {
  return quote.status === 'SENT' && quote.validUntil > at
}

/**
 * Returns true when the Quote has at least one line item and may therefore
 * be finalised (status DRAFT → SENT).
 *
 * @rule A Quote must have at least one line item to be finalised.
 */
export function canFinalizeQuote(quote: Quote): boolean {
  return (quote.lineItems?.length ?? 0) > 0
}

/**
 * Calculates the sum of all line items in the Quote.
 * Line items with differing currencies are excluded (use `currency` param to specify).
 */
export function calculateQuoteTotal(quote: Quote, currency = 'USD'): Money {
  const items = quote.lineItems ?? []
  let total = 0
  for (const item of items) {
    if (item.unitPrice.currency === currency) {
      total += item.unitPrice.amount * item.quantity
    }
  }
  return { amount: total, currency }
}
