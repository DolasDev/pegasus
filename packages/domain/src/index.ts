// ---------------------------------------------------------------------------
// packages/domain — public barrel
//
// Re-exports the full surface of every bounded context.
// Consumers should import from this file, not from internal context paths.
// ---------------------------------------------------------------------------

// Shared primitives
export type {
  Brand,
  UserId,
  AddressId,
  Address,
  Money,
  DateRange,
  Serialized,
} from './shared/types'
export {
  toUserId,
  toAddressId,
  createMoney,
  addMoney,
  validateAddress,
  dateRangesOverlap,
} from './shared/types'

// Domain errors
export { DomainError } from './shared/errors'

// SSO failure markers — wire contract between the pre-token Lambda and the
// tenant web login callback.
export type { SsoErrorMarker } from './shared/sso-errors'
export {
  SSO_ERROR_NO_EMAIL,
  SSO_ERROR_NOT_ROSTERED,
  SSO_ERROR_MARKERS,
  findSsoErrorMarker,
} from './shared/sso-errors'

// Customer context
export type {
  CustomerId,
  ContactId,
  LeadSourceId,
  AccountId,
  Customer,
  Contact,
  LeadSource,
} from './customer/index'
export {
  toCustomerId,
  toContactId,
  toLeadSourceId,
  toAccountId,
  hasPrimaryContact,
} from './customer/index'

// Schedule context
export type {
  CrewMemberId,
  VehicleId,
  AvailabilityId,
  CrewMember,
  Vehicle,
  Availability,
  CrewRole,
} from './schedule/index'
export { toCrewMemberId, toVehicleId, toAvailabilityId } from './schedule/index'

// Inventory context
export type {
  InventoryRoomId,
  InventoryItemId,
  InventoryRoom,
  InventoryItem,
  ItemCondition,
} from './inventory/index'
export { toInventoryRoomId, toInventoryItemId, roomTotalValue } from './inventory/index'

// Dispatch context
export type { MoveId, StopId, Move, Stop, MoveStatus, StopType } from './dispatch/index'
export { toMoveId, toStopId, MOVE_STATUSES, canTransition, canDispatch } from './dispatch/index'

// Quoting context
export type {
  QuoteId,
  QuoteLineItemId,
  RateTableId,
  RateId,
  Quote,
  QuoteLineItem,
  RateTable,
  Rate,
  QuoteStatus,
} from './quoting/index'
export {
  toQuoteId,
  toQuoteLineItemId,
  toRateTableId,
  toRateId,
  isQuoteValid,
  canFinalizeQuote,
  calculateQuoteTotal,
} from './quoting/index'

// Rating context
export type {
  TariffCode,
  TariffVersionId,
  RatingInput,
  RatedLineItem,
  RatingResult,
  MileageEstimate,
  MileageEstimator,
  Tariff400ngData,
  ServiceAreaRates,
} from './rating/index'
export {
  toTariffCode,
  toTariffVersionId,
  createZip3CentroidEstimator,
  haversineMiles,
  RATE_400NG,
  MIN_BILLABLE_WEIGHT_LBS,
  SHORTHAUL_THRESHOLD_MILES,
  rateCycleFor,
  billedWeight,
  cwt,
  invdLHS,
  fuelSurcharge,
  fscPercentForDieselPrice,
  rate400ng,
} from './rating/index'

// Billing context
export type {
  InvoiceId,
  PaymentId,
  Invoice,
  Payment,
  InvoiceStatus,
  PaymentMethod,
} from './billing/index'
export { toInvoiceId, toPaymentId, calculateInvoiceBalance, canVoidInvoice } from './billing/index'

// Document context
export type {
  DocumentId,
  Document,
  DocumentStatus,
  DocumentVariant,
  DocumentVariantKind,
  DocumentVariantStatus,
} from './document/index'
export { toDocumentId } from './document/index'

// Messaging context
export type {
  MessageId,
  RingCentralConnectionId,
  SubscriptionId,
  SmsThreadId,
  MessageDirection,
  MessageSource,
  MessageStatus,
  ForwardStatus,
  PhoneNumber,
  MessageContent,
  Message,
  NormalizedMessage,
  RcDirection,
  ThreadEntryInput,
  ThreadPhonePair,
  V1MessageInput,
} from './messaging/index'
export {
  toMessageId,
  toRingCentralConnectionId,
  toSubscriptionId,
  toSmsThreadId,
  MESSAGE_STATUSES,
  FORWARD_STATUSES,
  isValidE164,
  toPhoneNumber,
  dedupeKey,
  isSms,
  normalizeThreadEntry,
  normalizeV1Message,
  canForward,
  canTransitionForward,
  deriveMessageStatus,
  isWebhookValidationHandshake,
  VALIDATION_TOKEN_HEADER,
} from './messaging/index'
