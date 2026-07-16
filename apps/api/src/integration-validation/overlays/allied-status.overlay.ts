// ---------------------------------------------------------------------------
// allied_status — a SECOND per-partner overlay on the SAME shipment_status_update
// floor (sdk-feedback 0020). Also fictional/benign. It exists to demonstrate the
// core 0020 win: two partners of the same integration type share ONE floor (same
// facts, same rules vocabulary) and differ only in their overlay — here, a
// DIFFERENT external output shape.
//
// Where demo_partner's external body IS the canonical (identity), allied_status
// projects the canonical into a flattened, renamed partner body via its own
// `externalMapping`, described by its own `externalShape`. Same native input →
// same facts/verdict, but a different `external` payload.
// ---------------------------------------------------------------------------

import { demoPartnerMapping } from '../transform/demo-partner.transform'
import { demoPartnerRules } from '../rules/demo-partner.rules'
import { SHIPMENT_STATUS_UPDATE_FLOOR } from '../floors/shipment-status-update.floor'
import type { MappingTemplate } from '../transform/mapping-format'
import type { IntegrationOverlay } from '../types'

/** Canonical → Allied external body: a flat rename of a few canonical fields. */
const alliedExternalMapping: MappingTemplate = {
  orderRef: 'serviceOrderNumber',
  orderStatus: 'serviceStatus',
  contactEmail: 'supplierContactEmail',
  contactName: 'supplierContactName',
}

/** JSON Schema of the Allied external body (targets the externalMapping writes). */
const alliedExternalShape: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['orderRef', 'orderStatus'],
  properties: {
    orderRef: { type: 'string' },
    orderStatus: { type: 'string' },
    contactEmail: { type: 'string' },
    contactName: { type: 'string' },
  },
}

export const alliedStatusOverlay: IntegrationOverlay = {
  id: 'allied_status',
  floor: SHIPMENT_STATUS_UPDATE_FLOOR,
  displayName: 'Allied (status updates)',
  description: 'Projects shipment-status facts into the Allied external body.',
  // Same native→canonical mapping + rules as demo_partner (same floor/facts) …
  mapping: demoPartnerMapping,
  rules: demoPartnerRules,
  // … but a DIFFERENT external output shape (canonical → Allied body).
  externalShape: alliedExternalShape,
  externalMapping: alliedExternalMapping,
}
