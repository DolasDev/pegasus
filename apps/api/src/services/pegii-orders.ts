// ---------------------------------------------------------------------------
// pegII order bridge.
//
// The authoritative "order" record lives in the legacy pegII (MoveManager)
// system, NOT in the cloud Postgres. (The cloud `/api/v1/orders` endpoint is a
// separate, move-backed integration view for M2M reporting clients — see
// handlers/orders.ts — and is deliberately left untouched.) A lifecycle
// workflow re-fetches authoritative order state, keyed by the order id carried
// in an `order.*` event envelope.
//
// This module owns the OrderRecord surface shape (what PegasusClient.get_order
// returns). Single-order READS are LIVE: the
// /api/v1/pegii/orders/:id route resolves an OrderGateway (see
// gateways/order-gateway.factory.ts) and fetches the serialized order from the
// pegII team's on-prem API at `/api/v1/pegii/serialized/orders/:id` over the
// WireGuard tunnel, mapping it through gateways/pegii/pegii-order.mapper.ts.
//
// There is no order LISTING here. Selecting orders is the site's live search
// (`GET /api/v1/pegii/orders/search`, OrderGateway.searchOrders) — read from
// `sales`, never the snapshot. The old in-memory list stub is gone; the
// deprecated `GET /pegii/orders` route answers `[]` until it is removed (D4 of
// plans/in-progress/nw-pulse-texting-platform.md).
// ---------------------------------------------------------------------------

/** A pegII order record, in the shape the SDK/runtime surface exposes. */
export interface OrderRecord {
  id: string
  orderNumber: string
  status: 'booked' | 'in_progress' | 'completed'
  customerName: string | null
  scheduledDate: string | null
  packingActualDate: string | null
  createdAt: string
  updatedAt: string
}
