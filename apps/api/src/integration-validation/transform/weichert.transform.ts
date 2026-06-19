// ---------------------------------------------------------------------------
// Weichert: legacy move object → CanonicalWeichertOrder mapping, in the
// output-shaped format. Authored by the integration owner; transcribed verbatim.
//
// Notable features this mapping exercises (and the engine now supports):
//   - `$from: "."`        — the move object IS the single shipment; `$each` wraps
//                           the root object into a one-element shipments array.
//   - `DocumentationDates[0]` — array-index access in a source path.
// ---------------------------------------------------------------------------

import type { MappingTemplate } from './mapping-format'

export const weichertMapping: MappingTemplate = {
  serviceOrderNumber: 'InvolvedParties.ShipperEmployer.Identity.Description',
  supplierContactName: 'InvolvedParties.Coordinator.Identity.Description',
  supplierContactEmail: {
    $from: 'InvolvedParties.Coordinator.EmailAddress',
    default: '',
    coerce: 'toString',
  },
  serviceStatus: 'Survey.SerivceStatus',
  contactMadeDate: 'DocumentationDates[0]',
  surveyDate: 'KeyMoveDates.Survey.Planned',
  shipments: {
    $from: '.',
    $each: {
      supplierShipmentId: { $from: 'Id', coerce: 'toString' },
      shipmentStatus: { $from: 'Survey.ShipmentStatus', default: null },
      netWeight: {
        estimated: { $from: 'Financials.EstimatedWeight', coerce: 'toNumberOrNull' },
        actual: { $from: 'Financials.ActualWeight', coerce: 'toNumberOrNull' },
      },
      // NOTE: the legacy source paths for the pack/load/delivery actuals and
      // shipmentStatus are INFERRED from the existing convention
      // (KeyMoveDates.<milestone>.Actual, mirroring KeyMoveDates.Survey.Planned)
      // — the Weichert OUTPUT fields are documented, but confirm/adjust these
      // legacy-side `$from` paths against the actual client payload.
      packDate1: { actual: { $from: 'KeyMoveDates.Pack.Actual', default: null } },
      loadDate1: { actual: { $from: 'KeyMoveDates.Load.Actual', default: null } },
      deliveryDate1: { actual: { $from: 'KeyMoveDates.Delivery.Actual', default: null } },
      surveyedStorageCostFirstDay: { $from: 'Survey.Storage1stDay', coerce: 'toNumberOrNull' },
      surveyedStorageCostAdditionalDays: {
        $from: 'Survey.StorageAdditionalDays',
        coerce: 'toNumberOrNull',
      },
      surveyedStorageCostDeliveryOut: { $from: 'Survey.StorageOut', coerce: 'toNumberOrNull' },
      surveyedThirdPartyCrateAndUncrateCosts: {
        $from: 'Survey.ThirdPartyCrate',
        coerce: 'toNumberOrNull',
      },
      surveyedThirdPartyCosts: { $from: 'Survey.ThirdPartyCost', coerce: 'toNumberOrNull' },
      surveyedThirdPartyOtherCosts: {
        $from: 'Survey.ThirdPartyOtherCost',
        coerce: 'toNumberOrNull',
      },
      notIncludedComments: 'Survey.NotIncludedComments',
      thirdPartyAndOtherCostsComments: 'Survey.OtherCostComments',
      comments: 'Survey.GeneralComments',
    },
  },
}

/** Top-level keys the legacy Weichert move object provides (mapping static-check guard). */
export const weichertInputFieldRoots = [
  'InvolvedParties',
  'Survey',
  'DocumentationDates',
  'KeyMoveDates',
  // element scope ($each over ".") reads these off the same root object:
  'Id',
  'Financials',
]
