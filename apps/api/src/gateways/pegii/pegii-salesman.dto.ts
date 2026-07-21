// ---------------------------------------------------------------------------
// pegII Salesman DTO — the typed anti-corruption boundary for the serialized
// "salesman" entity returned by the pegII team's on-prem domain API at
// `/api/v1/pegii/serialized/salesmen/:id`.
//
// pegII (MoveManager) calls this record a "Salesman" (the sales user / employee
// tied to an order). This is the shape of the INNER object the pegII client
// returns after unwrapping the `{ data }` envelope (see lib/pegii-api-client.ts).
//
// Field names/shapes below are taken from a live sample of
// `/api/v1/pegii/serialized/salesmen/213056` — camelCase, as the pegII
// serialized API emits. This file and pegii-salesman.mapper.ts are the ONLY two
// files that should need to change if the pegII contract shifts — everything
// downstream (gateway, factory, handler) is insulated from it. Every field
// except `code` (the identifier) is optional/nullable so a partial payload maps
// cleanly rather than throwing.
// ---------------------------------------------------------------------------

export interface PegiiSalesmanDto {
  /** Salesman code — the primary identifier (e.g. 213056). Becomes the record id. */
  code: number | string
  /** Short "AVL" code used in the legacy desktop app (e.g. "56"). */
  avlCode?: string | null
  firstName?: string | null
  lastName?: string | null
  /** Job title (e.g. "VICE PRESIDENT OF CORPORATE SALES"). */
  title?: string | null
  /** Phone extension. */
  extension?: string | null
  email?: string | null
  /** Branch code the salesman belongs to (e.g. "02"). */
  branch?: string | null
  /** Agency code (e.g. "1505"). */
  agencyCode?: string | null
  /** Role code(s), e.g. "SM" (salesman). */
  roles?: string | null
  /** Employee type code, e.g. "S". */
  employeeType?: string | null
  /**
   * Active flag. A real boolean on the sampled wire, but tolerated as the common
   * "Y"/"N", "true"/"false", 1/0 legacy encodings too; the mapper narrows it.
   */
  isActive?: boolean | string | number | null
  /** Employment start date (ISO 8601, e.g. "2017-04-17T00:00:00"). */
  startDate?: string | null
  /** Termination date, or null while still employed. */
  dateTerminated?: string | null
}
