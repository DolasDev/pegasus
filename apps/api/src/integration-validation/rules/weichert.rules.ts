// ---------------------------------------------------------------------------
// Weichert behavioral rules — derived from the live API's rejection messages.
// Each `sourceRef` quotes the API error this rule reproduces at save time.
//
// SCOPE (this first cut covers the rules expressible from the fields the supplier
// mapping currently produces):
//   - serviceStatus must be supplier-settable.
//   - submitting an estimate (serviceStatus = Submitted) requires supplier
//     contact, contact-made date, survey date, and a non-zero estimated total cost.
//   - supplier contact email must be well-formed.
//
// DEFERRED until the mapping carries the needed fields (documented for the next
// pass): pack/load/delivery actual-date gating for In Progress / Delivered /
// Completed; "In Progress requires Awarded by WMN"; Move-status On Hold/Closed/
// Cancelled lock; shipmentStatus picklist; storage-service close requirements.
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
]
