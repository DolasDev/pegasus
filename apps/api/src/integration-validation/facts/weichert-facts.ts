// ---------------------------------------------------------------------------
// Weichert fact derivation: CanonicalWeichertOrder context → neutral facts.
//
// `estimatedTotalCost` rolls up the surveyed cost fields across shipments (the
// live API computes "Estimated Total Cost" from amounts on the related Shipment
// Orders), so the "required to submit this estimate" rule can test it as `> 0`.
// ---------------------------------------------------------------------------

import type { CanonicalContext } from '../types'
import type { WeichertOrder, WeichertShipment } from '../canonical-weichert'
import type { Facts, FactCatalog } from '../rules/types'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const nz = (n: number | null | undefined): number => n ?? 0

function shipmentSurveyedCost(s: WeichertShipment): number {
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

export const weichertFactCatalog: FactCatalog = {
  serviceStatus: 'string',
  supplierContactPresent: 'boolean',
  supplierContactEmailValid: 'boolean',
  contactMadeDatePresent: 'boolean',
  surveyDatePresent: 'boolean',
  estimatedTotalCost: 'number',
  shipmentCount: 'number',
  // Counts of shipments whose required actual dates are all present (the live API
  // requires "at least one of the related Shipment Orders" to be complete).
  shipmentsWithPackLoadActual: 'number',
  shipmentsWithPackLoadDeliveryActual: 'number',
  action: 'string',
}

export function deriveWeichertFacts(ctx: CanonicalContext<WeichertOrder>): Facts {
  const { order, action } = ctx
  const email = order.supplierContactEmail

  const packLoad = (s: WeichertShipment): boolean =>
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
    action,
  }
}
