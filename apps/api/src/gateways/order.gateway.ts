// ---------------------------------------------------------------------------
// OrderGateway — the read seam for pegII "order" (a.k.a. "sale") records.
//
// Orders are NOT stored in the cloud Postgres; the legacy pegII (MoveManager)
// system is their source of truth. This seam lets the /api/v1/pegii/orders/:id
// runtime route be served from the pegII team's on-prem domain API over the
// WireGuard tunnel. See order-gateway.factory.ts for how a tenant is resolved
// to a live gateway, and pegii-order.gateway.ts for the implementation.
//
// v1 is a single by-id read — the only shape the pegII serialized endpoint
// (`/api/v1/pegii/serialized/orders/:id`) exposes. Listing stays on the stub in
// services/pegii-orders.ts until a pegII collection endpoint exists; when it
// does, add `listOrders` here and implement it in pegii-order.gateway.ts, and
// the handler's list route swaps to the gateway with no new abstraction.
// ---------------------------------------------------------------------------

import type { OrderRecord } from '../services/pegii-orders'

export interface OrderGateway {
  /** Fetch one order by id. Resolves null when pegII reports 404 (no such order). */
  findOrderById(id: string): Promise<OrderRecord | null>

  /**
   * Probe that the pegII source is reachable, without fetching a specific order.
   * Resolves when the source answers; throws `PegiiApiError` when it is
   * unreachable (tunnel/HTTP failure). Lets reachability-only callers (the
   * `/orders` list route, whose data is still stub-backed) fail the same way a
   * by-id read does, instead of silently returning an empty list while the
   * source is down.
   */
  checkReachable(): Promise<void>
}
