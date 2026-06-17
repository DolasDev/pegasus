// ---------------------------------------------------------------------------
// Canonical model for the WEICHERT integration (Weichert Supplier API, a
// Salesforce-backed Move Network). This mirrors the fields the supplier mapping
// produces (legacy move object → this shape), which is the subset of the
// Weichert Service-Order-Update payload the supplier sends. See the API guide
// (weichert-api.odt) for the full payload; we model only what the mapping maps.
//
// Two status picklists exist in Weichert: the Service Order's `serviceStatus`
// (modeled here) and a per-shipment `shipmentStatus` (not yet mapped). The
// documented serviceStatus values plus `Completed` (which the live API accepts
// from suppliers) make up the enum; the supplier-settable subset is enforced by
// a behavioral rule, not the structural enum.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** All serviceStatus values Weichert recognises. */
export const WEICHERT_SERVICE_STATUSES = [
  'Requested',
  'Accepted',
  'Submitted',
  'Awarded',
  'In Progress',
  'Delivered',
  'Declined',
  'Cancelled',
  'Completed',
] as const

/** The serviceStatus values a SUPPLIER may set (the rest are WMN-controlled). */
export const WEICHERT_SUPPLIER_SETTABLE_STATUSES = [
  'Accepted',
  'Submitted',
  'In Progress',
  'Delivered',
  'Completed',
] as const

/** serviceStatus values a supplier may NOT set (the live API rejects these). */
export const WEICHERT_SUPPLIER_FORBIDDEN_STATUSES = [
  'Requested',
  'Awarded',
  'Cancelled',
  'Declined',
] as const

const moneyOrNull = z.number().nullable()
const optDate = z.string().nullish()
const optStr = z.string().nullish()

export const WeichertShipmentSchema = z.object({
  supplierShipmentId: z.string(),
  netWeight: z.object({ estimated: moneyOrNull, actual: moneyOrNull }),
  surveyedStorageCostFirstDay: moneyOrNull,
  surveyedStorageCostAdditionalDays: moneyOrNull,
  surveyedStorageCostDeliveryOut: moneyOrNull,
  surveyedThirdPartyCrateAndUncrateCosts: moneyOrNull,
  surveyedThirdPartyCosts: moneyOrNull,
  surveyedThirdPartyOtherCosts: moneyOrNull,
  notIncludedComments: optStr,
  thirdPartyAndOtherCostsComments: optStr,
  comments: optStr,
})

export const WeichertOrderSchema = z.object({
  serviceOrderNumber: z.string(),
  supplierContactName: z.string(),
  // Email format is validated by a behavioral rule (kept out of the structural
  // contract so the schema stays cleanly JSON-Schema-representable).
  supplierContactEmail: z.string(),
  serviceStatus: z.enum(WEICHERT_SERVICE_STATUSES),
  contactMadeDate: optDate,
  surveyDate: optDate,
  shipments: z.array(WeichertShipmentSchema),
})

export type WeichertOrder = z.infer<typeof WeichertOrderSchema>
export type WeichertShipment = z.infer<typeof WeichertShipmentSchema>
