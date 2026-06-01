// ---------------------------------------------------------------------------
// Shared driver filter for every v_longhaul_drivers read.
//
// The Availability screen (/driver-planning) and the Planning driver dropdown
// (/drivers, /reference-data) must return the SAME set of drivers. Keeping the
// predicate in one place stops the two lists drifting apart.
//
// Active drivers only, and the 99994–99999 sentinel/system driver IDs are
// excluded (placeholder / non-real driver rows in the Dolios view).
// ---------------------------------------------------------------------------

/** SQL boolean predicate (no leading WHERE). Pass a column prefix when the
 *  query aliases the view (e.g. `d` → `d.ACTIVE`). */
export function longhaulDriverFilter(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `${p}ACTIVE = 'Y' AND ${p}DRIVER_ID NOT IN (99994, 99995, 99996, 99997, 99998, 99999)`
}
