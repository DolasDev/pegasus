// ---------------------------------------------------------------------------
// Canonical model for the DEMO PARTNER integration — a fictional example
// supplier integration that ships as the built-in reference (and validation
// floor). It is not tied to any real customer; it models a generic supplier
// "service order" with a status lifecycle and a list of shipments carrying
// cost/date fields, and exists to exercise the mapping → canonical → facts →
// rules pipeline end-to-end.
//
// Two status picklists exist: the order-level `serviceStatus` (modeled here)
// and a per-shipment `shipmentStatus`. The full serviceStatus set makes up the
// enum; the supplier-settable subset is enforced by a behavioral rule, not the
// structural enum.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** All serviceStatus values the Demo Partner order recognizes. */
export const SERVICE_STATUSES = [
  'Requested',
  'Accepted',
  'Submitted',
  'Awarded',
  'In Progress',
  'Delivered',
  'Declined',
  'Canceled',
  'Completed',
] as const

/** The serviceStatus values a SUPPLIER may set (the rest are network-controlled). */
export const SUPPLIER_SETTABLE_STATUSES = [
  'Accepted',
  'Submitted',
  'In Progress',
  'Delivered',
  'Completed',
] as const

/** serviceStatus values a supplier may NOT set (the API rejects these). */
export const SUPPLIER_FORBIDDEN_STATUSES = ['Requested', 'Awarded', 'Canceled', 'Declined'] as const

/** Per-shipment status picklist (distinct from the order-level serviceStatus). */
export const SHIPMENT_STATUSES = [
  'Under Review',
  'In Process',
  'In Storage',
  'Delivered',
  'Completed',
  'Canceled',
] as const

const moneyOrNull = z.number().nullable()
const optDate = z.string().nullish()
const optStr = z.string().nullish()
// Milestone dates are objects carrying both halves of the plan/reality pair —
// `estimated` (the planned date, `KeyMoveDates.<milestone>.Planned` on the legacy
// side) and `actual`. Both nullish, so an overlay mapping only `.actual` — which
// is every overlay that predates sdk-feedback 0040 — produces a canonical object
// identical to the one it produced before `estimated` existed.
//
// Facts derive exclusively from `.actual` (facts/demo-partner-facts.ts), so a
// planned-but-not-actual date still counts as an absent actual; adding `estimated`
// is deliberately fact-neutral.
const milestoneDate = z.object({ estimated: optDate, actual: optDate })

export const DemoPartnerShipmentSchema = z.object({
  supplierShipmentId: z.string(),
  shipmentStatus: z.enum(SHIPMENT_STATUSES).nullish(),
  netWeight: z.object({ estimated: moneyOrNull, actual: moneyOrNull }),
  // Per-shipment survey date, distinct from the order-level `surveyDate` below:
  // partners model the survey as a shipment milestone with its own plan/actual
  // pair, and the legacy `KeyMoveDates.Survey` object supplies both. Nullish —
  // unlike the pack/load/delivery objects, which every existing overlay already
  // emits, this one is new, so it must be omittable or those overlays would stop
  // satisfying the contract.
  surveyDate: milestoneDate.nullish(),
  packDate1: milestoneDate,
  loadDate1: milestoneDate,
  deliveryDate1: milestoneDate,
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

export const DemoPartnerOrderSchema = z.object({
  serviceOrderNumber: z.string(),
  supplierContactName: z.string(),
  // Email format is validated by a behavioral rule (kept out of the structural
  // contract so the schema stays cleanly JSON-Schema-representable).
  supplierContactEmail: z.string(),
  serviceStatus: z.enum(SERVICE_STATUSES),
  contactMadeDate: optDate,
  surveyDate: optDate,
  shipments: z.array(DemoPartnerShipmentSchema),
})

export type DemoPartnerOrder = z.infer<typeof DemoPartnerOrderSchema>
export type DemoPartnerShipment = z.infer<typeof DemoPartnerShipmentSchema>
