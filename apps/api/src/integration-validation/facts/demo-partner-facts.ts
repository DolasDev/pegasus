// ---------------------------------------------------------------------------
// Demo Partner fact derivation: canonical order context → neutral facts.
//
// `estimatedTotalCost` rolls up the surveyed cost fields across shipments (the
// example API computes "Estimated Total Cost" from amounts on the related
// Shipment Orders), so the "required to submit this estimate" rule can test it
// as `> 0`.
//
// Milestone actuals come in two granularities, because "which dates make up a
// milestone" is partner-varying policy the overlay owns (sdk-feedback 0035 —
// load-without-pack moves are real: the shipper packs, the crew only loads, so
// a Pack Date 1 Actual never exists):
//
//   - Composite  — shipmentsWithPackLoad[Delivery]Actual: all of the dates
//     present on the SAME shipment. Unchanged; partners that genuinely require
//     pack keep pointing here.
//   - Per date   — shipmentsWith{Pack,Load,Delivery}Actual: one count each. A
//     rule ANDs the predicates it wants, so a partner composes its own
//     milestone. Note the predicates then count INDEPENDENTLY: with 2+
//     shipments, load on one and delivery on another satisfies both.
//   - Paired     — shipmentsWithLoadDeliveryActual: load + delivery on the same
//     shipment, for partners that need the strict reading of the above without
//     dragging pack in.
//
// All counts keep the existing "at least one of the related Shipment Orders"
// semantics, so a rule reads `{fact, op: 'lte', value: 0}`.
// ---------------------------------------------------------------------------

import type { CanonicalContext } from '../types'
import type { DemoPartnerOrder, DemoPartnerShipment } from '../canonical-demo-partner'
import type { Facts, FactCatalog } from '../rules/types'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const nz = (n: number | null | undefined): number => n ?? 0

function shipmentSurveyedCost(s: DemoPartnerShipment): number {
  return (
    nz(s.surveyedStorageCostFirstDay) +
    nz(s.surveyedStorageCostAdditionalDays) +
    nz(s.surveyedStorageCostDeliveryOut) +
    nz(s.surveyedThirdPartyCrateAndUncrateCosts) +
    nz(s.surveyedThirdPartyCosts) +
    nz(s.surveyedThirdPartyOtherCosts)
  )
}

const has = (v: string | null | undefined): boolean => v != null && v !== ''

export const demoPartnerFactCatalog: FactCatalog = {
  serviceStatus: 'string',
  supplierContactPresent: 'boolean',
  supplierContactEmailValid: 'boolean',
  contactMadeDatePresent: 'boolean',
  surveyDatePresent: 'boolean',
  estimatedTotalCost: 'number',
  shipmentCount: 'number',
  // Counts of shipments whose required actual dates are all present (the example
  // API requires "at least one of the related Shipment Orders" to be complete).
  shipmentsWithPackLoadActual: 'number',
  shipmentsWithPackLoadDeliveryActual: 'number',
  // One count per milestone date, so an overlay can decide WHICH dates make up
  // a milestone rather than only whether the composite one is required.
  shipmentsWithPackActual: 'number',
  shipmentsWithLoadActual: 'number',
  shipmentsWithDeliveryActual: 'number',
  shipmentsWithLoadDeliveryActual: 'number',
  action: 'string',
}

export function deriveDemoPartnerFacts(ctx: CanonicalContext<DemoPartnerOrder>): Facts {
  const { order, action } = ctx
  const email = order.supplierContactEmail

  const packLoad = (s: DemoPartnerShipment): boolean =>
    has(s.packDate1.actual) && has(s.loadDate1.actual)

  return {
    serviceStatus: order.serviceStatus,
    supplierContactPresent: order.supplierContactName.trim().length > 0,
    supplierContactEmailValid: email === '' || EMAIL_RE.test(email),
    contactMadeDatePresent: has(order.contactMadeDate),
    surveyDatePresent: has(order.surveyDate),
    estimatedTotalCost: order.shipments.reduce((t, s) => t + shipmentSurveyedCost(s), 0),
    shipmentCount: order.shipments.length,
    shipmentsWithPackLoadActual: order.shipments.filter(packLoad).length,
    shipmentsWithPackLoadDeliveryActual: order.shipments.filter(
      (s) => packLoad(s) && has(s.deliveryDate1.actual),
    ).length,
    shipmentsWithPackActual: order.shipments.filter((s) => has(s.packDate1.actual)).length,
    shipmentsWithLoadActual: order.shipments.filter((s) => has(s.loadDate1.actual)).length,
    shipmentsWithDeliveryActual: order.shipments.filter((s) => has(s.deliveryDate1.actual)).length,
    shipmentsWithLoadDeliveryActual: order.shipments.filter(
      (s) => has(s.loadDate1.actual) && has(s.deliveryDate1.actual),
    ).length,
    action,
  }
}
