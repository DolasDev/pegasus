// ---------------------------------------------------------------------------
// Weichert behavioral rules — derived from the live API's rejection messages.
// Each `sourceRef` quotes the API error this rule reproduces at save time.
//
// SCOPE (covered):
//   - serviceStatus must be supplier-settable.
//   - submitting an estimate (serviceStatus = Submitted) requires supplier
//     contact, contact-made date, survey date, and a non-zero estimated total cost.
//   - supplier contact email must be well-formed.
//   - In Progress requires Pack + Load Date 1 Actual on a shipment order.
//   - Delivered / Completed requires Pack + Load + Delivery Date 1 Actual.
//   - shipmentStatus is a restricted picklist (enforced structurally by the
//     canonical enum — a bad value yields a `structural-contract` issue).
//
// STILL DEFERRED (the Weichert HHG payload has no field for these, per the API
// guide): "In Progress requires Awarded by WMN" (needs prior/award state);
// Move-status On Hold/Closed/Cancelled lock (an Auto-order concept, not HHG);
// storage-service close (a separate LTS Order payload / integration).
// ---------------------------------------------------------------------------

import type { RuleSet } from './types'

export const weichertRules: RuleSet = [
  {
    id: 'service-status-not-supplier-settable',
    description:
      'A supplier may not set serviceStatus to Requested, Awarded, Cancelled, or Declined.',
    field: 'serviceStatus',
    message:
      'The supplier cannot change the Service Status to Requested, Awarded, Cancelled, or Declined. Reach out to the Weichert Move Network Coordinator for assistance.',
    sourceRef:
      'Weichert API: "The supplier cannot change the Service Status to Requested, Awarded, Cancelled, or Declined."',
    when: [
      { fact: 'serviceStatus', op: 'in', value: ['Requested', 'Awarded', 'Cancelled', 'Declined'] },
    ],
  },
  {
    id: 'invalid-supplier-email',
    description: 'supplierContactEmail must be a valid email address.',
    field: 'supplierContactEmail',
    message: 'supplierContactEmail must be a valid email address (email@domain.com).',
    sourceRef: 'Weichert API: supplierContactEmail format is email@domain.com',
    when: [{ fact: 'supplierContactEmailValid', op: 'eq', value: false }],
  },
  {
    id: 'submit-requires-supplier-contact',
    description: 'Submitting an estimate requires a supplier contact.',
    field: 'supplierContactName',
    message: 'Supplier Contact is required to submit this estimate.',
    sourceRef:
      'Weichert API: "Supplier Contact, Contact Made Date, Survey Date (actual), and Estimated Total Cost are required to submit this estimate."',
    when: [
      { fact: 'serviceStatus', op: 'eq', value: 'Submitted' },
      { fact: 'supplierContactPresent', op: 'eq', value: false },
    ],
  },
  {
    id: 'submit-requires-contact-made-date',
    description: 'Submitting an estimate requires a contact-made date.',
    field: 'contactMadeDate',
    message: 'Contact Made Date is required to submit this estimate.',
    sourceRef: 'Weichert API: "...Contact Made Date... required to submit this estimate."',
    when: [
      { fact: 'serviceStatus', op: 'eq', value: 'Submitted' },
      { fact: 'contactMadeDatePresent', op: 'eq', value: false },
    ],
  },
  {
    id: 'submit-requires-survey-date',
    description: 'Submitting an estimate requires a survey date.',
    field: 'surveyDate',
    message: 'Survey Date is required to submit this estimate.',
    sourceRef: 'Weichert API: "...Survey Date (actual)... required to submit this estimate."',
    when: [
      { fact: 'serviceStatus', op: 'eq', value: 'Submitted' },
      { fact: 'surveyDatePresent', op: 'eq', value: false },
    ],
  },
  {
    id: 'submit-requires-estimated-total-cost',
    description: 'Submitting an estimate requires a non-zero estimated total cost.',
    field: 'shipments',
    message:
      'Estimated Total Cost is required to submit this estimate (set surveyed costs on the related shipments).',
    sourceRef:
      'Weichert API: "...Estimated Total Cost are required to submit this estimate. Total Costs Amounts updated on the related Shipment Orders."',
    when: [
      { fact: 'serviceStatus', op: 'eq', value: 'Submitted' },
      { fact: 'estimatedTotalCost', op: 'lte', value: 0 },
    ],
  },
  {
    id: 'in-progress-requires-pack-load-actuals',
    description: 'Advancing to In Progress requires Pack + Load Date 1 Actual on a shipment order.',
    field: 'shipments',
    message:
      'Please update Pack Date 1 Actual and Load Date 1 Actual for at least one of the related Shipment Orders before updating Service Status to In Progress.',
    sourceRef:
      'Weichert API: "Please update Pack Date 1 Actual and Load Date 1 Actual for at least one of the related Shipment Orders before updating Service Status to In Progress."',
    when: [
      { fact: 'serviceStatus', op: 'eq', value: 'In Progress' },
      { fact: 'shipmentsWithPackLoadActual', op: 'lte', value: 0 },
    ],
  },
  {
    id: 'delivered-requires-pack-load-delivery-actuals',
    description:
      'Advancing to Delivered or Completed requires Pack + Load + Delivery Date 1 Actual.',
    field: 'shipments',
    message:
      'Please update Pack Date 1 Actual, Load Date 1 Actual, and Delivery Date 1 Actual on the related Shipment Orders before updating Service Status to either Delivered or Completed.',
    sourceRef:
      'Weichert API: "Please update Pack Date 1 Actual, Load Date 1 Actual, and Delivery Date 1 Actual on this record\'s Shipment Orders before updating Service Status to either Delivered or Completed."',
    when: [
      { fact: 'serviceStatus', op: 'in', value: ['Delivered', 'Completed'] },
      { fact: 'shipmentsWithPackLoadDeliveryActual', op: 'lte', value: 0 },
    ],
  },
]
