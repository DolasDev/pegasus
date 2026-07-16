// ---------------------------------------------------------------------------
// demo_partner — a per-PARTNER overlay on the shipment_status_update floor
// (sdk-feedback 0020). A "fictional, benign reference integration" (it is not a
// real customer). The overlay is the partner-specific half: the native→canonical
// mapping, the human-facing displayName (0019), and the behavioral rules.
//
// Its external output shape is IDENTITY — the partner body IS the canonical
// shape (`externalShape`/`externalMapping` omitted). This is exactly the
// pre-0020 behavior (`map_to_external` returned the canonical), so demo_partner's
// external body is byte-identical after the floor/overlay split.
//
// A DIFFERENT partner on this same floor supplies its OWN externalShape +
// externalMapping to emit a different external body from the same facts — see
// overlays/allied-status.overlay.ts.
// ---------------------------------------------------------------------------

import { demoPartnerMapping } from '../transform/demo-partner.transform'
import { demoPartnerRules } from '../rules/demo-partner.rules'
import { SHIPMENT_STATUS_UPDATE_FLOOR } from '../floors/shipment-status-update.floor'
import type { IntegrationOverlay } from '../types'

export const demoPartnerOverlay: IntegrationOverlay = {
  id: 'demo_partner',
  floor: SHIPMENT_STATUS_UPDATE_FLOOR,
  displayName: 'Demo Partner',
  description: 'Validates Demo Partner order payloads before they are saved.',
  mapping: demoPartnerMapping,
  rules: demoPartnerRules,
  // externalShape / externalMapping omitted ⇒ identity (external == canonical).
}
