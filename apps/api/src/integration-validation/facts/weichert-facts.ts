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

export const weichertFactCatalog: FactCatalog = {
  serviceStatus: 'string',
  supplierContactPresent: 'boolean',
  supplierContactEmailValid: 'boolean',
  contactMadeDatePresent: 'boolean',
  surveyDatePresent: 'boolean',
  estimatedTotalCost: 'number',
  shipmentCount: 'number',
  action: 'string',
}

export function deriveWeichertFacts(ctx: CanonicalContext<WeichertOrder>): Facts {
  const { order, action } = ctx
  const email = order.supplierContactEmail

  return {
    serviceStatus: order.serviceStatus,
    supplierContactPresent: order.supplierContactName.trim().length > 0,
    supplierContactEmailValid: email === '' || EMAIL_RE.test(email),
    contactMadeDatePresent: order.contactMadeDate != null && order.contactMadeDate !== '',
    surveyDatePresent: order.surveyDate != null && order.surveyDate !== '',
    estimatedTotalCost: order.shipments.reduce((t, s) => t + shipmentSurveyedCost(s), 0),
    shipmentCount: order.shipments.length,
    action,
  }
}
