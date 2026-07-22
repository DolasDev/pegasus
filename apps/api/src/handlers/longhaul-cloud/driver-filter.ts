// ---------------------------------------------------------------------------
// Shared driver predicates for every v_longhaul_drivers read.
//
// The two consumers deliberately do NOT return the same set of drivers:
//
//   • Planning driver typeahead (/drivers, /reference-data) — `activeDriverFilter`.
//     Active drivers only, nothing else. Every active driver must be pickable:
//     a driver you cannot select is a hard functional gap, while an extra row in
//     a searchable dropdown costs nothing.
//
//   • Availability card (/driver-planning) — `availabilityDriverFilter`.
//     Active drivers, minus the 99994–99999 ID range. That screen renders one
//     card per driver with no search, so placeholder rows are real visual noise.
//
// The 99994–99999 exclusion is therefore a PRESENTATION filter, not a
// data-validity one. It was originally applied to all three reads to keep the
// two screens in lockstep, on the assumption that the whole range is
// placeholder/system rows — but at least 99995 ("CSS, C&F", agent code 3201,
// TYPE NWSUB) is a genuine subcontractor, and hiding it made a real driver
// unselectable in Planning.
// ---------------------------------------------------------------------------

/** Placeholder / system driver rows hidden from the Availability card. */
const PLACEHOLDER_DRIVER_IDS = [99994, 99995, 99996, 99997, 99998, 99999]

/** Every selectable driver — active only. Backs the Planning typeahead.
 *  SQL boolean predicate (no leading WHERE). Pass a column prefix when the
 *  query aliases the view (e.g. `d` → `d.ACTIVE`). */
export function activeDriverFilter(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `${p}ACTIVE = 'Y'`
}

/** Drivers shown on the Availability card — active, minus placeholder rows.
 *  SQL boolean predicate (no leading WHERE). Pass a column prefix when the
 *  query aliases the view (e.g. `d` → `d.ACTIVE`). */
export function availabilityDriverFilter(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `${activeDriverFilter(prefix)} AND ${p}DRIVER_ID NOT IN (${PLACEHOLDER_DRIVER_IDS.join(', ')})`
}
