// ---------------------------------------------------------------------------
// OrderGateway — the read seam for pegII "order" (a.k.a. "sale") records.
//
// Orders are NOT stored in the cloud Postgres; the legacy pegII (MoveManager)
// system is their source of truth. This seam lets the /api/v1/pegii/orders/:id
// runtime route be served from the pegII team's on-prem domain API over the
// WireGuard tunnel. See order-gateway.factory.ts for how a tenant is resolved
// to a live gateway, and pegii-order.gateway.ts for the implementation.
//
// By-id reads come from the serialized snapshot (`/api/v1/pegii/serialized/
// orders/:id`). Selecting orders is `searchOrders`, the site's LIVE search over
// `sales` (`/api/v1/pegii/orders/search`) — the snapshot can lag DB triggers, so
// there is deliberately no snapshot-backed listing.
// ---------------------------------------------------------------------------

import type { OrderRecord } from '../services/pegii-orders'
import type { OrderSearchCriteria, PegiiOrderSearchPageDto } from './pegii/pegii-order-search.dto'

export interface OrderGateway {
  /** Fetch one order by id. Resolves null when pegII reports 404 (no such order). */
  findOrderById(id: string): Promise<OrderRecord | null>

  /**
   * Fetch one order's RAW native pegII payload by id — the serialized "Sale"
   * object as it comes off the wire (`{Id, Survey, InvolvedParties, KeyMoveDates,
   * …}`), NOT the projected OrderRecord. This is the shape a partner posts to the
   * ingress, so it can be fed straight to a published integration's
   * `map_from_external` to dry-run the mapping against a real order id
   * (sdk-feedback 0029). Resolves null when pegII reports 404 (no such order).
   */
  findOrderNativeById(id: string): Promise<unknown | null>

  /**
   * Probe that the pegII source is reachable, without fetching a specific order.
   * Resolves when the source answers; throws `PegiiApiError` when it is
   * unreachable (tunnel/HTTP failure). Lets reachability-only callers (the
   * deprecated `/orders` list route, which has no data source) fail the same
   * way a by-id read does, instead of silently returning an empty list while
   * the source is down.
   */
  checkReachable(): Promise<void>

  /**
   * One page of the site's LIVE order search over `sales` (not the snapshot):
   * orders whose `dateField` falls in `[from, to]`, keyset-paged on order
   * number. The site owns validation (its 400 passes through as a
   * PegiiApiError). A site whose API predates the search throws
   * PEGII_API_CAPABILITY_MISSING (→ 503).
   */
  searchOrders(criteria: OrderSearchCriteria): Promise<PegiiOrderSearchPageDto>

  /**
   * Write allowlisted fields back onto an order (`PATCH /api/v1/pegii/orders/{n}`
   * on the site; sdk-feedback 0044). `patch` is a native-shape fragment, e.g.
   * `{Survey: {SerivceStatus: 'In Progress'}}`; the SITE owns the allowlist and
   * answers 400 naming any other path (surfaced as a PegiiApiError). A 404 —
   * `ORDER_NOT_FOUND`, or `ORDER_SNAPSHOT_MISSING` for an order never saved by a
   * current desktop — resolves `{found: false}` with pegII's code. A site whose
   * API predates the write throws PEGII_API_CAPABILITY_MISSING (→ 503).
   */
  updateOrderNative(id: string, patch: Record<string, unknown>): Promise<OrderNativeUpdate>
}

export type OrderNativeUpdate =
  /** `order` is the native order after the write; `applied` is false when nothing changed. */
  | { found: true; order: unknown; applied: boolean }
  | { found: false; code: string; message: string }
