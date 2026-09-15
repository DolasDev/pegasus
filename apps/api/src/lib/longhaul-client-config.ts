// ---------------------------------------------------------------------------
// Longhaul per-client configuration
//
// The legacy longhaul app shipped two client-specific config files under
// /home/steve/repos/longhaul/config/clients/{nwi,qmm}.js. Each defined the
// values that diverge between NWI and QMM tenants:
//
//   - importExport types (the `import_export` codes that counted as "trip
//     planning eligible" shipments — H/HA/M/A/SS for NWI, N/S/C/U/M for QMM).
//     REMOVED in #685: see the note at the bottom of this header.
//   - moveTypesWhere — the SQL fragment used to filter the MoveType lookup
//     table. NWI returns all rows ("1=1"); QMM restricts to a specific list.
//   - dispatcher_query — the SQL WHERE clause used to fetch dispatcher users
//     from v_longhaul_salesman. NWI matches on managed_by_id; QMM matches
//     on a roles substring.
//
// The pegasus port read each of these from independent process.env entries
// with hardcoded NWI-style fallbacks (e.g. importExport defaulted to ['H'],
// moveTypesWhere defaulted to '1=1', dispatcher_query defaulted to
// "active='Y'"). That silently broke QMM tenants: if any of the three env
// vars was unset, QMM saw NWI behavior with no error or warning.
//
// This helper centralizes the resolution in one place. The runtime selects a
// client by setting LONGHAUL_CLIENT to 'nwi' or 'qmm'; unset/unknown values
// throw at first call so misconfiguration fails fast at startup instead of
// silently corrupting query results downstream.
//
// `rvs` (Reliable Van and Storage, onboarded 2026-09) has no legacy client
// file and was first tagged `qmm`. That broke both per-client lookups: RVS's
// MoveType codes are numeric ('0'..'18'), so QMM's letter whitelist matched
// none of them (blank Move Types dropdown), and QMM's `%cpd%` role matched
// only two inactive RVS users (blank Dispatchers). Pick a tenant's client by
// what its MoveType and v_longhaul_salesman rows actually hold.
//
// #685 dropped `importExportTypes`. It was the trip-planning eligibility
// whitelist, AND'd onto `import_export` — the same column Planning's
// `move_type` filter targets. Two predicates on one column meant the default
// set and the user's selection fought: intersecting them made 10 of NWI's 16
// dropdown codes return zero rows (#615/#628), and letting the selection win
// (#628) meant adding a filter could ADD rows. Planning now shows every code
// by default and the filter narrows from there, so neither failure exists and
// the whitelist has no remaining caller. Do not reintroduce it here: a default
// that silently constrains the same column a user filter targets is the bug.
// ---------------------------------------------------------------------------

export type LonghaulClient = 'nwi' | 'qmm' | 'rvs'

export interface LonghaulClientConfig {
  /**
   * Raw SQL WHERE fragment used to filter the MoveType lookup table.
   *
   * Legacy: config/clients/{nwi,qmm}.js → sessionData.moveTypesWhere.
   */
  moveTypesWhere: string

  /**
   * Raw SQL WHERE fragment used to identify dispatcher users in
   * v_longhaul_salesman.
   *
   * Legacy: config/clients/{nwi,qmm}.js → sessionData.dispatcher_query.
   */
  dispatcherQuery: string
}

// Values transcribed from the legacy config files at:
//   /home/steve/repos/longhaul/config/clients/nwi.js
//   /home/steve/repos/longhaul/config/clients/qmm.js
const CONFIGS: Record<LonghaulClient, LonghaulClientConfig> = {
  nwi: {
    moveTypesWhere: '1=1',
    // Central-planning (long-haul) dispatchers are identified by managed_by_id;
    // short-haul / local-dispatch staff carry the 'LO' role tag instead. We OR
    // both in so the planning-system dispatcher filter lists both groups. The
    // fragment is the sole WHERE clause at every call site, but we parenthesise
    // it so an OR can never leak past an AND if a future caller composes it.
    dispatcherQuery: "(managed_by_id = 2021 OR roles like '%LO%')",
  },
  qmm: {
    moveTypesWhere: "move_type in ('C','S','N','M','U')",
    dispatcherQuery: "roles like ('%cpd%')",
  },
  // No legacy file — values chosen from PegRVS's own data (2026-09-15).
  rvs: {
    // All 19 MoveType rows are live `import_export` codes on the board, and
    // since #685 the board shows every code, so the dropdown must offer every
    // code or some rows become unfilterable-to.
    moveTypesWhere: '1=1',
    // RVS dispatch staff (titles DISPATCH / LOCAL DISPATCHER / ALLIED
    // DISPATCHER) carry the 'LO' role — the same tag NWI's local-dispatch arm
    // uses. 'LD' is held by account coordinators, so it is deliberately out.
    dispatcherQuery: "roles like '%LO%'",
  },
}

// Own-property check, not `in` — `in` would accept inherited keys like
// "constructor" and hand back a non-config object.
function isLonghaulClient(value: string): value is LonghaulClient {
  return Object.hasOwn(CONFIGS, value)
}

/**
 * Resolve the longhaul client configuration for an explicit client value.
 *
 * Used by the cloud-direct longhaul handlers, which read the client per tenant
 * from `Tenant.longhaulClient` (the multi-tenant cloud API Lambda cannot use a
 * single process-env value). Throws when `client` is unknown — we intentionally
 * do NOT silently default, since silent defaults are what caused the original
 * bug (QMM tenants getting NWI behavior).
 */
export function getLonghaulClientConfigFor(client: string): LonghaulClientConfig {
  const normalized = client.trim().toLowerCase()
  if (!isLonghaulClient(normalized)) {
    throw new Error(
      `[longhaul] Unknown longhaul client "${client}". Expected one of: ${Object.keys(CONFIGS).join(', ')}.`,
    )
  }
  const source = CONFIGS[normalized]
  // Return a fresh copy so callers can't mutate the shared template.
  return {
    moveTypesWhere: source.moveTypesWhere,
    dispatcherQuery: source.dispatcherQuery,
  }
}

/**
 * Resolve the longhaul client configuration from the LONGHAUL_CLIENT env var.
 *
 * Used by the legacy on-prem server, which is a single-client deployment.
 * Throws a descriptive Error when the variable is unset.
 */
export function getLonghaulClientConfig(): LonghaulClientConfig {
  const raw = process.env['LONGHAUL_CLIENT']
  if (!raw) {
    throw new Error(
      '[longhaul] LONGHAUL_CLIENT environment variable is required. ' +
        'Set it to "nwi", "qmm" or "rvs" to select the per-client query configuration.',
    )
  }
  return getLonghaulClientConfigFor(raw)
}
