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
// Two reads: by id (the serialized endpoint
// `/api/v1/pegii/serialized/salesmen/:id`) and the paged directory list
// (`/api/v1/pegii/salesmen`, cloud identity I3), which the runtime list route
// and the company membership sync both use.
// ---------------------------------------------------------------------------

import type { SalesmanRecord } from '../services/pegii-salesmen'

export interface SalesmanGateway {
  /** Fetch one salesman by id. Resolves null when pegII reports 404 (no such salesman). */
  findSalesmanById(id: string): Promise<SalesmanRecord | null>

  /**
   * Every salesman in the company's directory (all pages), optionally filtered
   * by active state. Throws PEGII_API_CAPABILITY_MISSING (→ 503) when the site's
   * API build predates `pegii.salesmen.list.v1`.
   */
  listSalesmen(opts?: { active?: boolean }): Promise<SalesmanRecord[]>
}
