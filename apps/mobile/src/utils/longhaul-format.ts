// ---------------------------------------------------------------------------
// Date formatting for longhaul trips/shipments — mirrors the tenant-web
// operations module (formatDate): MM/DD/YY rendered in UTC so a date-only
// legacy value isn't shifted by the device timezone.
// ---------------------------------------------------------------------------

export function formatLonghaulDate(value: string | null | undefined, defaultVal = '—'): string {
  if (!value) return defaultVal
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return defaultVal
  return date.toLocaleDateString('en-US', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  })
}

/** "MM/DD/YY - MM/DD/YY" spread; collapses to a single date or default. */
export function formatLonghaulSpread(
  from: string | null | undefined,
  to: string | null | undefined,
  defaultVal = '—',
): string {
  const f = from ? formatLonghaulDate(from) : ''
  const t = to ? formatLonghaulDate(to) : ''
  if (!f && !t) return defaultVal
  if (f && t) return `${f} - ${t}`
  return f || t
}
