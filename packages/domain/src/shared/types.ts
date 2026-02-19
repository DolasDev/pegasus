// ---------------------------------------------------------------------------
// Shared primitives used across all bounded contexts.
// Nothing in this file may import from a sibling context.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Branding utility
// ---------------------------------------------------------------------------

/** Nominal / branded type: prevents accidental substitution of e.g. MoveId for QuoteId. */
export type Brand<T, B extends string> = T & { readonly __brand: B }

// ---------------------------------------------------------------------------
// Cross-cutting ID types
// ---------------------------------------------------------------------------

/** Identifies a platform user (authentication identity). */
export type UserId = Brand<string, 'UserId'>

/** Identifies a postal address value object. */
export type AddressId = Brand<string, 'AddressId'>

export const toUserId = (raw: string): UserId => raw as UserId
export const toAddressId = (raw: string): AddressId => raw as AddressId

// ---------------------------------------------------------------------------
// Address value object
// ---------------------------------------------------------------------------

/**
 * Immutable postal address.
 *
 * @invariant `line1`, `city`, `state`, `postalCode`, and `country` must be non-empty strings.
 */
export interface Address {
  readonly id: AddressId
  readonly line1: string
  readonly line2?: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
  readonly country: string
}

/**
 * Validates an Address and returns a list of human-readable error messages.
 * An empty array means the address is valid.
 */
export function validateAddress(addr: Address): readonly string[] {
  const errors: string[] = []
  if (addr.line1.trim() === '') errors.push('line1 is required')
  if (addr.city.trim() === '') errors.push('city is required')
  if (addr.state.trim() === '') errors.push('state is required')
  if (addr.postalCode.trim() === '') errors.push('postalCode is required')
  if (addr.country.trim() === '') errors.push('country is required')
  return errors
}

// ---------------------------------------------------------------------------
// Money value object
// ---------------------------------------------------------------------------

/**
 * Immutable monetary value.
 *
 * @invariant `amount` must be ≥ 0.
 * @invariant `currency` must be a valid ISO 4217 code (e.g. "USD").
 */
export interface Money {
  readonly amount: number
  /** ISO 4217 currency code, e.g. "USD" */
  readonly currency: string
}

/**
 * Factory that enforces the Money invariant: amount must not be negative.
 *
 * @throws {Error} if `amount` is negative.
 */
export function createMoney(amount: number, currency: string): Money {
  if (amount < 0) {
    throw new Error(`Money amount cannot be negative: ${amount}`)
  }
  return { amount, currency }
}

/**
 * Adds two Money values together.
 *
 * @throws {Error} if the currencies differ.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: cannot add ${a.currency} and ${b.currency}`)
  }
  return { amount: a.amount + b.amount, currency: a.currency }
}

// ---------------------------------------------------------------------------
// DateRange value object
// ---------------------------------------------------------------------------

/**
 * A half-open time interval [start, end).
 *
 * @invariant `end` must be strictly after `start`.
 */
export interface DateRange {
  readonly start: Date
  readonly end: Date
}

/** Returns true when two DateRange windows overlap. */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start < b.end && b.start < a.end
}
