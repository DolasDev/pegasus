// ---------------------------------------------------------------------------
// Saved shipment-filter date <-> day-offset transform.
//
// Saved filters persist their date-range fields (pack_date, load_date,
// delivery_date) as day offsets relative to "today" rather than absolute dates,
// so a saved filter stays meaningful when re-applied on a later day. The proxy
// converts on the way IN (transformDatesToTimeDiff) and back OUT
// (transformTimeDiffToDate) — see handlers/longhaul/filter-options.ts.
//
// The cloud read handlers (shipment-filters[.ts|-default.ts]) already inline the
// OUT direction; the cloud WRITE handler (POST /shipment-filters) needs the IN
// direction, ported here verbatim.
// ---------------------------------------------------------------------------

export const DATE_FIELDS = ['pack_date', 'load_date', 'delivery_date'] as const

/**
 * Convert absolute dates in a filter's date-range fields to integer day offsets
 * from today (the persisted form). Mirrors filter-options.ts exactly.
 */
export function transformDatesToTimeDiff(query: Record<string, unknown>): Record<string, unknown> {
  const today = new Date(new Date().toDateString()).getTime()
  const filters = { ...((query['filters'] as Record<string, unknown>) ?? {}) }

  for (const field of DATE_FIELDS) {
    const range = filters[field]
    if (Array.isArray(range)) {
      filters[field] = range.map((d: unknown) => {
        if (d == null) return d
        return Math.round((new Date(d as string).getTime() - today) / (1000 * 60 * 60 * 24))
      })
    }
  }

  return { ...query, filters }
}
