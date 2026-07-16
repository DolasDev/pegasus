// ---------------------------------------------------------------------------
// shipment_status_update — a per-TYPE integration floor (sdk-feedback 0020).
//
// A "floor" is the reusable, partner-neutral half of an integration: the
// canonical fact-bearing shape, the fact derivation, the fact catalog, the
// legal input roots, and the projection binding. It carries NO partner-specific
// output shape, mapping, or rules — those live in a per-partner overlay
// (overlays/*.overlay.ts or a published IntegrationConfig).
//
// This floor models "shipment / order status-update notifications": an order
// with a service-status lifecycle and a list of shipments carrying cost/date/
// weight fields. Many partners (Demo Partner, and future real customers) send
// the SAME facts for this kind of integration and differ only in their external
// payload shape + mapping + rules — so they all build on THIS one floor.
//
// The canonical schema + facts are the ones the reference integration has always
// used (canonical-demo-partner.ts, facts/demo-partner-facts.ts); 0020 relocates
// them from a partner-bound floor to this shared type-level floor without
// changing their content, so existing behavior is byte-identical.
// ---------------------------------------------------------------------------

import { DemoPartnerOrderSchema } from '../canonical-demo-partner'
import { demoPartnerInputFieldRoots } from '../transform/demo-partner.transform'
import { deriveDemoPartnerFacts, demoPartnerFactCatalog } from '../facts/demo-partner-facts'
import type { TypeFloor } from '../types'

/** The stable id for the shipment-status-update integration type. */
export const SHIPMENT_STATUS_UPDATE_FLOOR = 'shipment_status_update'

export const shipmentStatusUpdateFloor: TypeFloor = {
  floor: SHIPMENT_STATUS_UPDATE_FLOOR,
  structuralContract: DemoPartnerOrderSchema,
  inputFieldRoots: demoPartnerInputFieldRoots,
  deriveFacts: deriveDemoPartnerFacts,
  factCatalog: demoPartnerFactCatalog,
  defaultAction: 'save',
  // A shipment-status order is keyed by its service order number, so the
  // validator can load the order's last-known state as `prior`.
  projection: {
    entityType: 'order',
    key: (o) => (typeof o?.serviceOrderNumber === 'string' ? o.serviceOrderNumber : null),
  },
}
