// ---------------------------------------------------------------------------
// Longhaul per-client configuration
//
// The legacy longhaul app shipped two client-specific config files under
// /home/steve/repos/longhaul/config/clients/{nwi,qmm}.js. Each defined the
// values that diverge between NWI and QMM tenants:
//
//   - importExport types (the `import_export` codes that count as "trip
//     planning eligible" shipments — H/HA/M/A/SS for NWI, N/S/C/U/M for QMM).
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
// vars was unset, QMM saw NWI behaviour with no error or warning.
//
// This helper centralises the resolution in one place. The runtime selects a
// client by setting LONGHAUL_CLIENT to 'nwi' or 'qmm'; unset/unknown values
// throw at first call so misconfiguration fails fast at startup instead of
// silently corrupting query results downstream.
// ---------------------------------------------------------------------------

export type LonghaulClient = 'nwi' | 'qmm'

export interface LonghaulClientConfig {
  /**
   * Shipment `import_export` codes considered "trip-planning eligible". Used
   * by shipments.repository.findShipmentsWithQuery when filters.Is_Trip_Planning
   * is set.
   *
   * Legacy: config/clients/{nwi,qmm}.js → clientInfo.importExport.
   */
  importExportTypes: string[]

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
    importExportTypes: ['H', 'HA', 'M', 'A', 'SS'],
    moveTypesWhere: '1=1',
    dispatcherQuery: 'managed_by_id = 2021',
  },
  qmm: {
    importExportTypes: ['N', 'S', 'C', 'U', 'M'],
    moveTypesWhere: "move_type in ('C','S','N','M','U')",
    dispatcherQuery: "roles like ('%cpd%')",
  },
}

/**
 * Resolve the longhaul client configuration from the LONGHAUL_CLIENT env var.
 *
 * Throws a descriptive Error when the variable is unset or names an unknown
 * client. We intentionally do NOT silently default — silent defaults are what
 * caused the original bug (QMM tenants getting NWI behaviour because each
 * setting independently fell back to an NWI-style hardcoded value).
 */
export function getLonghaulClientConfig(): LonghaulClientConfig {
  const raw = process.env['LONGHAUL_CLIENT']
  if (!raw) {
    throw new Error(
      '[longhaul] LONGHAUL_CLIENT environment variable is required. ' +
        'Set it to "nwi" or "qmm" to select the per-client query configuration.',
    )
  }
  const normalised = raw.trim().toLowerCase()
  if (normalised !== 'nwi' && normalised !== 'qmm') {
    throw new Error(
      `[longhaul] Unknown LONGHAUL_CLIENT value "${raw}". ` + 'Expected "nwi" or "qmm".',
    )
  }
  const source = CONFIGS[normalised]
  // Return a fresh copy so callers can't mutate the shared template (e.g.
  // arr.push() on importExportTypes would leak across requests).
  return {
    importExportTypes: [...source.importExportTypes],
    moveTypesWhere: source.moveTypesWhere,
    dispatcherQuery: source.dispatcherQuery,
  }
}
