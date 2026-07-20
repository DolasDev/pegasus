// ---------------------------------------------------------------------------
// Shared active-staff filter for every v_longhaul_salesman read.
//
// v_longhaul_salesman backs two Operations dropdowns — Dispatchers and Planners
// — and each is served by BOTH a standalone endpoint (refresh actions) and a
// statement inside the batched /reference-data bootstrap. That is four call
// sites for two lists: if the predicate is applied to only some of them the
// dropdown contents change depending on how the screen was loaded. Keeping it
// in one place is what stops that drift — same rationale as driver-filter.ts.
//
// Column casing note: v_longhaul_salesman exposes lowercase columns
// (`first_name`, `roles`, `win_username`), unlike v_longhaul_drivers which is
// uppercase (`ACTIVE`). MSSQL identifiers are case-insensitive under the
// default collation, so this is cosmetic — but match each view's convention.
// ---------------------------------------------------------------------------

/** SQL boolean predicate (no leading WHERE) restricting v_longhaul_salesman to
 *  active staff. Pass a prefix when the query qualifies the view
 *  (e.g. `[v_longhaul_salesman]` → `[v_longhaul_salesman].active`). */
export function longhaulSalesmanActiveFilter(prefix = ''): string {
  const p = prefix ? `${prefix}.` : ''
  return `${p}active = 'Y'`
}
