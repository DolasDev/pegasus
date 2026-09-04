// ---------------------------------------------------------------------------
// Arrival-window display helpers.
//
// DISPLAY ONLY — there is deliberately no timezone arithmetic here. The API
// derives the window's anchor date, its UTC instants and its EDT/EST label
// (apps/api/src/lib/longhaul-arrival-window.ts) precisely so no client has to,
// and so every consumer agrees. These functions format what the server already
// worked out.
// ---------------------------------------------------------------------------

/** `08:00` → `8:00 AM`. Returns the input unchanged when it isn't `HH:mm`. */
export function formatHhMm(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!match) return hhmm
  const hour = Number(match[1])
  const suffix = hour < 12 ? 'AM' : 'PM'
  const displayHour = hour % 12 === 0 ? 12 : hour % 12
  return `${displayHour}:${match[2]} ${suffix}`
}

/**
 * `2026-09-11` → `Fri 09/11`.
 *
 * Parses the parts by hand rather than through `new Date(...)`: the stored value
 * is a bare calendar day, and constructing a Date from it yields UTC midnight,
 * which renders as the PREVIOUS day anywhere west of UTC. That exact bug is why
 * `parseDateOnly` exists in utils/date.ts.
 */
export function formatWindowDate(dateOnly: string | null | undefined): string {
  if (!dateOnly) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly)
  if (!match) return ''
  const [, year, month, day] = match
  const weekday = new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(
    'en-US',
    { weekday: 'short' },
  )
  return `${weekday} ${month}/${day}`
}

/**
 * The one-line summary the popover shows under the inputs, e.g.
 * `Fri 09/11 · 8:00 AM – 10:00 AM EDT`.
 *
 * Every part is optional: a window on an activity with no date yet still reads
 * sensibly as `8:00 AM – 10:00 AM EDT`.
 */
export function formatArrivalWindow(window: {
  start?: string | null
  end?: string | null
  windowDate?: string | null
  zoneLabel?: string | null
}): string {
  const { start, end, windowDate, zoneLabel } = window
  if (!start && !end) return ''

  const span = [formatHhMm(start), formatHhMm(end)].filter(Boolean).join(' – ')
  const withZone = zoneLabel ? `${span} ${zoneLabel}` : span
  const date = formatWindowDate(windowDate)
  return date ? `${date} · ${withZone}` : withZone
}
