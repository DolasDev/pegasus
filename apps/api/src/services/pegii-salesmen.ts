// ---------------------------------------------------------------------------
// pegII salesman bridge.
//
// The authoritative "salesman" record (a.k.a. employee / sales user) lives in
// the legacy pegII (MoveManager) system, NOT in the cloud Postgres. A workflow
// re-fetches authoritative salesman state, keyed by the salesman id carried in
// an event envelope or referenced from an order.
//
// This module owns the SalesmanRecord surface shape (what the SDK/runtime
// surface exposes). Single-salesman READS bridge to the
// pegII team's on-prem API at `/api/v1/pegii/serialized/salesmen/:id` over the
// WireGuard tunnel via the SalesmanGateway (see
// gateways/salesman-gateway.factory.ts), mapping the payload through
// gateways/pegii/pegii-salesman.mapper.ts.
//
// LISTING bridges to the paged directory `GET /api/v1/pegii/salesmen`
// (capability `pegii.salesmen.list.v1`, cloud identity I3) through
// SalesmanGateway.listSalesmen.
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
  /**
   * salesman.win_username, when the source sent it (the directory list does,
   * the by-id read doesn't). Internal to the membership sync — the runtime
   * route's response shape (toSalesmanResponse) deliberately omits it.
   */
  winUsername: string | null
}
