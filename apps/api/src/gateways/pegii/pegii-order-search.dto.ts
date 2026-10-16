// ---------------------------------------------------------------------------
// Wire shape of the pegII live order search (`GET /api/v1/pegii/orders/search`,
// movemanager `OrderSearchEndpoints.cs` / `OrderSearchContracts.cs`, capability
// `pegii.orders.search.v1`). Read LIVE from `sales`, not the serialized
// snapshot — DB triggers and direct `UPDATE sales` paths leave the snapshot
// stale, which is why scheduled workflows select orders here.
//
// The site already speaks camelCase and the cloud passes items through
// unchanged, so this file is the cloud's declaration of that contract.
// ---------------------------------------------------------------------------

/** The accepted `dateField` values (movemanager OrderSearchCriteria.DateFields). */
export const ORDER_SEARCH_DATE_FIELDS = [
  'plan_pack',
  'plan_load',
  'del_actual',
  'pack_date',
  'load_date',
] as const
export type OrderSearchDateField = (typeof ORDER_SEARCH_DATE_FIELDS)[number]

/** movemanager OrderSearchCriteria limits. */
export const ORDER_SEARCH_MAX_LIMIT = 500
export const ORDER_SEARCH_DEFAULT_LIMIT = 100
export const ORDER_SEARCH_MAX_SPAN_DAYS = 366

export interface OrderSearchCriteria {
  dateField: OrderSearchDateField
  /** Inclusive, `YYYY-MM-DD`. */
  from: string
  /** Inclusive, `YYYY-MM-DD`. */
  to: string
  /** One shipment-status letter, or `*` for all. The site defaults to `A`. */
  status?: string | undefined
  /** `nextCursor` from the previous page. */
  cursor?: number | undefined
  limit?: number | undefined
}

/** A KeyDate as the desktop models it: dates are `YYYY-MM-DD` or null. */
export interface PegiiKeyDateDto {
  planned: string | null
  earliest: string | null
  latest: string | null
  actual: string | null
}

export interface PegiiPlannedActualDto {
  planned: string | null
  actual: string | null
}

/** The desktop's shipper-texting verdict (`TextConsentRules.EvaluateShipperSend`). */
export interface PegiiTextingConsentDto {
  /** `Allowed` | `NotApprovedOnOrder` | `BlockedByAccount`. */
  status: string
  orderAllows: boolean
  accountBlocks: boolean
  parentAccountBlocks: boolean
}

export interface PegiiOrderSearchItemDto {
  orderNumber: number
  shipmentStatus: string | null
  pack: PegiiKeyDateDto
  load: PegiiKeyDateDto
  delivery: PegiiKeyDateDto
  sitIn: PegiiPlannedActualDto
  sitOut: PegiiPlannedActualDto
  planSit: string | null
  actSitOut: string | null
  coordinatorCode: number | null
  coordinatorName: string | null
  nationalAccountCode: string | null
  nationalAccountName: string | null
  reloCompanyCode: string | null
  reloCompanyName: string | null
  moveType: string | null
  moveTypeLegacy: string | null
  shipperFirstName: string | null
  shipperCellPhone: string | null
  texting: PegiiTextingConsentDto
  shipperZip: string | null
  shipperState: string | null
  consigneeZip: string | null
  consigneeState: string | null
}

export interface PegiiOrderSearchPageDto {
  items: PegiiOrderSearchItemDto[]
  nextCursor: number | null
}
