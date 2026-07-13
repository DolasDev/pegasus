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
// This module owns the OrderRecord surface shape (what PegasusClient.get_order /
// list_orders return) plus the list stub. Single-order READS are now LIVE: the
// /api/v1/pegii/orders/:id route resolves an OrderGateway (see
// gateways/order-gateway.factory.ts) and fetches the serialized order from the
// pegII team's on-prem API at `/api/v1/pegii/serialized/orders/:id` over the
// WireGuard tunnel, mapping it through gateways/pegii/pegii-order.mapper.ts.
//
// LISTING stays a stub: the pegII serialized endpoint is by-id only, so there
// is no collection to bridge to yet. `listOrders` therefore reads the in-memory
// store below (empty at runtime — nothing seeds it), keeping the /orders route
// and its `ReadOrder` Cedar gate intact. When pegII exposes an order collection
// endpoint, add `listOrders` to the OrderGateway and wire the route to it.
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

/** Per-process store keyed by `${tenantId}:${orderId}` — backs the list stub. */
const store = new Map<string, OrderRecord>()

/**
 * List orders, optionally filtered by status. STUB: reads the in-memory store,
 * which is un-seeded at runtime (the pegII serialized API is by-id only), so
 * this returns [] until a pegII collection endpoint is bridged in.
 */
export function listOrders(tenantId: string, opts: { status?: string } = {}): OrderRecord[] {
  const prefix = `${tenantId}:`
  let records = [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
  if (opts.status) {
    records = records.filter((r) => r.status === opts.status)
  }
  return records
}

/** Test seam — seed the list store so `listOrders` behaviour can be exercised. */
export function _seedOrder(tenantId: string, record: OrderRecord): void {
  store.set(`${tenantId}:${record.id}`, record)
}

/** Test seam — clear the in-memory store between cases. */
export function _resetOrderStore(): void {
  store.clear()
}
