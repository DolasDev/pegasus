// ---------------------------------------------------------------------------
// Shipment response reshaper.
//
// Like `reshape-trip.ts`: the ported components were written against the legacy
// NestJS API, which returned shipments with a nested `pegasus_shadow` object
// (`{ weight, lng_dis_comments, operations_id, operations_name }` — the columns
// from the `sales` shadow table). The on-prem bridge
// (`apps/api/src/repositories/longhaul/shipments.repository.ts`) is a Knex port
// that left-joins those columns *flat* and aliased (`shadow_weight`,
// `shadow_comments`, `operations_id`, `operations_name`).
//
// Without a `pegasus_shadow` object the ShipmentDetail pane (and DispatchNote /
// Weight) blow up on `shipment.pegasus_shadow.lng_dis_comments` the moment a
// shipment is selected — which is exactly what happens when you click a trip's
// shipment on the itinerary view. This helper rebuilds the nested object from
// the flat columns. It's defensive (no-ops on an already-nested shipment or
// malformed input) so it's safe to apply unconditionally to every
// `fetchShipments` response.
// ---------------------------------------------------------------------------

import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

type AnyRec = Record<string, any>

export function reshapeShipment(raw: any): LonghaulShipmentRow {
  if (!raw || typeof raw !== 'object') return raw as LonghaulShipmentRow
  if (raw.pegasus_shadow != null && typeof raw.pegasus_shadow === 'object')
    return raw as LonghaulShipmentRow
  const s: AnyRec = { ...raw }
  s.pegasus_shadow = {
    order_num: s.order_num,
    weight: s.shadow_weight ?? null,
    lng_dis_comments: s.shadow_comments ?? null,
    operations_id: s.operations_id ?? null,
    operations_name: s.operations_name ?? null,
  }
  return s as LonghaulShipmentRow
}

export function reshapeShipmentList(raw: any): any {
  return Array.isArray(raw) ? raw.map(reshapeShipment) : raw
}
