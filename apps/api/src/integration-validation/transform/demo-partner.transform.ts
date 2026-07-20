// ---------------------------------------------------------------------------
// Demo Partner: legacy move object → canonical Demo Partner order mapping, in
// the output-shaped format. A fictional example authored the way an integration
// owner would.
//
// Notable features this mapping exercises (and the engine supports):
//   - `$from: "."`        — the move object IS the single shipment; `$each` wraps
//                           the root object into a one-element shipments array.
//   - `DocumentationDates[0]` — array-index access in a source path.
// ---------------------------------------------------------------------------

import type { MappingTemplate } from './mapping-format'

export const demoPartnerMapping: MappingTemplate = {
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
      // The pack/load/delivery actuals and shipmentStatus follow the legacy
      // convention (KeyMoveDates.<milestone>.Actual, mirroring
      // KeyMoveDates.Survey.Planned).
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

/**
 * Input fields the legacy move object provides (mapping static-check guard).
 *
 * Bare entries open a whole top-level root. Dotted entries open only a specific
 * vetted sub-path: `UnusedFields` is Pegii's junk-drawer (where the .NET
 * serializer parks a large tail of legacy fields), so it stays otherwise closed
 * and only the two survey-date fields a real partner consumes are readable
 * (sdk-feedback 0028). Adding more legacy `UnusedFields.*` dates later is one
 * vetted entry at a time.
 */
export const demoPartnerInputFieldRoots = [
  'InvolvedParties',
  'Survey',
  'DocumentationDates',
  'KeyMoveDates',
  // element scope ($each over ".") reads these off the same root object:
  'Id',
  'Financials',
  // Curated survey-date reads out of Pegii's UnusedFields junk-drawer — the rest
  // of UnusedFields stays closed.
  'UnusedFields.survey_received',
  'UnusedFields.survey_confirm',
]
