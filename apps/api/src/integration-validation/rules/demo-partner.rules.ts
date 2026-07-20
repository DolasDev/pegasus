// ---------------------------------------------------------------------------
// Demo Partner behavioral rules — a fictional example rule set. Each `sourceRef`
// notes the (illustrative) supplier-API behavior the rule reproduces at save
// time.
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
// ---------------------------------------------------------------------------

import type { RuleSet } from './types'

export const demoPartnerRules: RuleSet = [
  {
    id: 'service-status-not-supplier-settable',
    description:
      'A supplier may not set serviceStatus to Requested, Awarded, Canceled, or Declined.',
    field: 'serviceStatus',
    message:
      'The supplier cannot change the Service Status to Requested, Awarded, Canceled, or Declined. Contact the Demo Partner coordinator for assistance.',
    sourceRef:
      'Demo Partner API: a supplier cannot set Service Status to Requested, Awarded, Canceled, or Declined.',
    when: [
      { fact: 'serviceStatus', op: 'in', value: ['Requested', 'Awarded', 'Canceled', 'Declined'] },
    ],
  },
  {
    id: 'invalid-supplier-email',
    description: 'supplierContactEmail must be a valid email address.',
    field: 'supplierContactEmail',
    message: 'supplierContactEmail must be a valid email address (email@domain.com).',
    sourceRef: 'Demo Partner API: supplierContactEmail format is email@domain.com',
    when: [{ fact: 'supplierContactEmailValid', op: 'eq', value: false }],
  },
  {
    id: 'submit-requires-supplier-contact',
    description: 'Submitting an estimate requires a supplier contact.',
    field: 'supplierContactName',
    message: 'Supplier Contact is required to submit this estimate.',
    sourceRef:
      'Demo Partner API: Supplier Contact, Contact Made Date, Survey Date (actual), and Estimated Total Cost are required to submit this estimate.',
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
    sourceRef: 'Demo Partner API: Contact Made Date is required to submit this estimate.',
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
    sourceRef: 'Demo Partner API: Survey Date (actual) is required to submit this estimate.',
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
      'Demo Partner API: Estimated Total Cost is required to submit this estimate. Total cost amounts are updated on the related Shipment Orders.',
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
      'Demo Partner API: Pack Date 1 Actual and Load Date 1 Actual are required on at least one related Shipment Order before Service Status can become In Progress.',
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
      'Demo Partner API: Pack Date 1 Actual, Load Date 1 Actual, and Delivery Date 1 Actual are required on the related Shipment Orders before Service Status can become Delivered or Completed.',
    when: [
      { fact: 'serviceStatus', op: 'in', value: ['Delivered', 'Completed'] },
      { fact: 'shipmentsWithPackLoadDeliveryActual', op: 'lte', value: 0 },
    ],
  },
]
