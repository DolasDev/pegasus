// ---------------------------------------------------------------------------
// packages/domain — public barrel
//
// Re-exports the full surface of every bounded context.
// Consumers should import from this file, not from internal context paths.
// ---------------------------------------------------------------------------

// Shared primitives
export type { Brand, UserId, AddressId, Address, Money, DateRange } from './shared/types'
export { toUserId, toAddressId, createMoney, addMoney, validateAddress, dateRangesOverlap } from './shared/types'

// Customer context
export type { CustomerId, ContactId, LeadSourceId, AccountId, Customer, Contact, LeadSource } from './customer/index'
export { toCustomerId, toContactId, toLeadSourceId, toAccountId, hasPrimaryContact } from './customer/index'

// Schedule context
export type { CrewMemberId, VehicleId, AvailabilityId, CrewMember, Vehicle, Availability, CrewRole } from './schedule/index'
export { toCrewMemberId, toVehicleId, toAvailabilityId } from './schedule/index'

// Inventory context
export type { InventoryRoomId, InventoryItemId, InventoryRoom, InventoryItem, ItemCondition } from './inventory/index'
export { toInventoryRoomId, toInventoryItemId, roomTotalValue } from './inventory/index'

// Dispatch context
export type { MoveId, StopId, Move, Stop, MoveStatus, StopType } from './dispatch/index'
export { toMoveId, toStopId, MOVE_STATUSES, canTransition, canDispatch } from './dispatch/index'

// Quoting context
export type { QuoteId, QuoteLineItemId, RateTableId, RateId, Quote, QuoteLineItem, RateTable, Rate, QuoteStatus } from './quoting/index'
export { toQuoteId, toQuoteLineItemId, toRateTableId, toRateId, isQuoteValid, canFinalizeQuote, calculateQuoteTotal } from './quoting/index'

// Billing context
export type { InvoiceId, PaymentId, Invoice, Payment, InvoiceStatus, PaymentMethod } from './billing/index'
export { toInvoiceId, toPaymentId, calculateInvoiceBalance, canVoidInvoice } from './billing/index'
