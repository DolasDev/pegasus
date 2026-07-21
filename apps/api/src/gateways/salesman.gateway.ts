// ---------------------------------------------------------------------------
// SalesmanGateway — the read seam for pegII "salesman" (a.k.a. employee / sales
// user) records.
//
// Salesmen are NOT stored in the cloud Postgres; the legacy pegII (MoveManager)
// system is their source of truth. This seam lets the
// /api/v1/pegii/salesmen/:id runtime route be served from the pegII team's
// on-prem domain API over the WireGuard tunnel. See salesman-gateway.factory.ts
// for how a tenant is resolved to a live gateway, and pegii-salesman.gateway.ts
// for the implementation.
//
// v1 is a single by-id read — the only shape the pegII serialized endpoint
// (`/api/v1/pegii/serialized/salesmen/:id`) exposes. Listing stays on the stub
// in services/pegii-salesmen.ts until a pegII collection endpoint exists; when
// it does, add `listSalesmen` here and implement it in
// pegii-salesman.gateway.ts, and the handler's list route swaps to the gateway
// with no new abstraction.
// ---------------------------------------------------------------------------

import type { SalesmanRecord } from '../services/pegii-salesmen'

export interface SalesmanGateway {
  /** Fetch one salesman by id. Resolves null when pegII reports 404 (no such salesman). */
  findSalesmanById(id: string): Promise<SalesmanRecord | null>

  /**
   * Probe that the pegII source is reachable, without fetching a specific
   * salesman. Resolves when the source answers; throws `PegiiApiError` when it
   * is unreachable (tunnel/HTTP failure). Lets reachability-only callers (the
   * `/salesmen` list route, whose data is still stub-backed) fail the same way a
   * by-id read does, instead of silently returning an empty list while the
   * source is down.
   */
  checkReachable(): Promise<void>
}
