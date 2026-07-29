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

/**
 * What each fact MEANS — served on `GET /integrations/floors/:id` so a config
 * author picks the right one without reading this file. The six shipment
 * milestone counts are near-indistinguishable by name, so the same-shipment vs
 * independent-count distinction is spelled out on each.
 */
export const demoPartnerFactDocs: Record<string, string> = {
  serviceStatus: "The order's current service status, verbatim from the canonical order.",
  supplierContactPresent: 'True when the supplier contact name is non-blank.',
  supplierContactEmailValid:
    'True when the supplier contact email is empty OR parses as an email address — so it is a format check, not a presence check.',
  contactMadeDatePresent: 'True when the order carries a contact-made date.',
  surveyDatePresent: 'True when the order carries a survey date.',
  estimatedTotalCost:
    'Sum of every surveyed cost field across all shipments (storage, third-party, crate/uncrate). 0 when nothing is surveyed.',
  shipmentCount: 'Number of shipments on the order.',
  shipmentsWithPackLoadActual:
    'Shipments with BOTH pack and load actual dates present on the SAME shipment. Composite — use it when a partner genuinely requires pack; otherwise compose the per-date facts.',
  shipmentsWithPackLoadDeliveryActual:
    'Shipments with pack, load AND delivery actual dates all present on the SAME shipment.',
  shipmentsWithPackActual: 'Shipments with a pack actual date present.',
  shipmentsWithLoadActual:
    'Shipments with a load actual date present. Requiring load alone is how a load-without-pack move (the shipper packed) reaches In Progress.',
  shipmentsWithDeliveryActual: 'Shipments with a delivery actual date present.',
  shipmentsWithLoadDeliveryActual:
    'Shipments with BOTH load and delivery actual dates on the SAME shipment. Use this instead of AND-ing shipmentsWithLoadActual + shipmentsWithDeliveryActual when the two dates must belong to one shipment — AND-ed count predicates are evaluated independently, so with 2+ shipments load on one and delivery on another satisfies both.',
  action: 'The action being validated (e.g. save, submit), from the request or the floor default.',
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
