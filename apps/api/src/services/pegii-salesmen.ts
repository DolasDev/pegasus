// ---------------------------------------------------------------------------
// pegII salesman bridge.
//
// The authoritative "salesman" record (a.k.a. employee / sales user) lives in
// the legacy pegII (MoveManager) system, NOT in the cloud Postgres. A workflow
// re-fetches authoritative salesman state, keyed by the salesman id carried in
// an event envelope or referenced from an order.
//
// This module owns the SalesmanRecord surface shape (what the SDK/runtime
// surface exposes) plus the list stub. Single-salesman READS bridge to the
// pegII team's on-prem API at `/api/v1/pegii/serialized/salesmen/:id` over the
// WireGuard tunnel via the SalesmanGateway (see
// gateways/salesman-gateway.factory.ts), mapping the payload through
// gateways/pegii/pegii-salesman.mapper.ts.
//
// LISTING stays a stub, mirroring pegii-orders.ts: the pegII serialized endpoint
// is by-id only, so there is no collection to bridge to yet. `listSalesmen`
// reads the in-memory store below (empty at runtime — nothing seeds it), keeping
// the /salesmen route and its `ReadSalesman` Cedar gate intact. The route still
// probes reachability through the SalesmanGateway first
// (SalesmanGateway.checkReachable), so it returns a 502/503 rather than a
// misleading `200 []` when the source is down. When pegII exposes a salesman
// collection endpoint, add `listSalesmen` to the SalesmanGateway and wire the
// route to it.
// ---------------------------------------------------------------------------

/** A pegII salesman record, in the shape the SDK/runtime surface exposes. */
export interface SalesmanRecord {
  /** Salesman code — the primary identifier (e.g. "213056"). */
  id: string
  /** Short "AVL" code used in the legacy desktop app (e.g. "56"). */
  avlCode: string | null
  firstName: string | null
  lastName: string | null
  /** Display name, composed from first + last (or the id when both are absent). */
  name: string
  /** Job title. */
  title: string | null
  email: string | null
  /** Phone extension. */
  extension: string | null
  /** Branch code the salesman belongs to (e.g. "02"). */
  branch: string | null
  /** Agency code (e.g. "1505"). */
  agencyCode: string | null
  /** Role code(s), e.g. "SM". */
  roles: string | null
  /** Employee type code, e.g. "S". */
  employeeType: string | null
  /** Whether the salesman is currently active in pegII. */
  active: boolean
  /** Employment start date (ISO 8601), or null. */
  startDate: string | null
  /** Termination date, or null while still employed. */
  dateTerminated: string | null
}

/** Per-process store keyed by `${tenantId}:${salesmanId}` — backs the list stub. */
const store = new Map<string, SalesmanRecord>()

/**
 * List salesmen, optionally filtered by active state. STUB: reads the in-memory
 * store, which is un-seeded at runtime (the pegII serialized API is by-id only),
 * so this returns [] until a pegII collection endpoint is bridged in.
 */
export function listSalesmen(tenantId: string, opts: { active?: boolean } = {}): SalesmanRecord[] {
  const prefix = `${tenantId}:`
  let records = [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v)
  if (opts.active !== undefined) {
    records = records.filter((r) => r.active === opts.active)
  }
  return records
}

/** Test seam — seed the list store so `listSalesmen` behavior can be exercised. */
export function _seedSalesman(tenantId: string, record: SalesmanRecord): void {
  store.set(`${tenantId}:${record.id}`, record)
}

/** Test seam — clear the in-memory store between cases. */
export function _resetSalesmanStore(): void {
  store.clear()
}
