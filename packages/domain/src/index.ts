// ---------------------------------------------------------------------------
// Branded scalar types — enforce nominal identity at the type level
// ---------------------------------------------------------------------------
type Brand<T, B extends string> = T & { readonly __brand: B }

export type UserId = Brand<string, 'UserId'>
export type MoveId = Brand<string, 'MoveId'>
export type QuoteId = Brand<string, 'QuoteId'>
export type AddressId = Brand<string, 'AddressId'>

// ---------------------------------------------------------------------------
// Factory helpers (the only place we use `as` casts)
// ---------------------------------------------------------------------------
export const toUserId = (raw: string): UserId => raw as UserId
export const toMoveId = (raw: string): MoveId => raw as MoveId
export const toQuoteId = (raw: string): QuoteId => raw as QuoteId
export const toAddressId = (raw: string): AddressId => raw as AddressId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------
export interface Address {
  readonly id: AddressId
  readonly line1: string
  readonly line2?: string
  readonly city: string
  readonly state: string
  readonly postalCode: string
  readonly country: string
}

export interface Money {
  readonly amount: number
  /** ISO 4217 currency code, e.g. "USD" */
  readonly currency: string
}

// ---------------------------------------------------------------------------
// Move aggregate
// ---------------------------------------------------------------------------
export type MoveStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export const MOVE_STATUSES: readonly MoveStatus[] = [
  'PENDING',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const

export interface Move {
  readonly id: MoveId
  readonly userId: UserId
  readonly status: MoveStatus
  readonly origin: Address
  readonly destination: Address
  readonly scheduledDate: Date
  readonly createdAt: Date
  readonly updatedAt: Date
}

// ---------------------------------------------------------------------------
// Quote aggregate
// ---------------------------------------------------------------------------
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'

export interface Quote {
  readonly id: QuoteId
  readonly moveId: MoveId
  readonly price: Money
  readonly status: QuoteStatus
  readonly validUntil: Date
  readonly createdAt: Date
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** Returns true when a move can legally transition to `next`. */
export function canTransition(current: MoveStatus, next: MoveStatus): boolean {
  const allowed: Record<MoveStatus, readonly MoveStatus[]> = {
    PENDING: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  }
  return allowed[current].includes(next)
}

/** Returns true when the quote is still valid at the given point in time. */
export function isQuoteValid(quote: Quote, at: Date = new Date()): boolean {
  return quote.status === 'SENT' && quote.validUntil > at
}
