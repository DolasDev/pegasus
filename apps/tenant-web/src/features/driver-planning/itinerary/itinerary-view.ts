// ---------------------------------------------------------------------------
// Operations → Itinerary view helpers. Pure.
//
// The same shape the driver app shows (apps/mobile/src/utils/itinerary.ts):
// a week at a time, grouped by day, then by derived stop — "same day, same
// place". Items arrive sorted (day → act sequence → order) and keep that order
// within a stop; an item with no place groups by the dispatcher's note, else
// by order, so unrelated address-less work never reads as one stop.
// ---------------------------------------------------------------------------

import type {
  ItineraryArrivalWindow,
  ItineraryItem,
  ItineraryPlace,
} from '@/api/queries/driver-itinerary'

export interface ItineraryStop {
  key: string
  place: ItineraryPlace | null
  placeNote: string | null
  items: ItineraryItem[]
}

export interface ItineraryDay {
  day: string
  stops: ItineraryStop[]
}

export interface DayRange {
  from: string
  to: string
}

export const RANGE_DAYS = 7

const pad = (n: number) => String(n).padStart(2, '0')

/** The browser's local calendar day, `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` plus `days`, on the calendar — no time zone. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

export function rangeFrom(from: string): DayRange {
  return { from, to: addDays(from, RANGE_DAYS - 1) }
}

export function shiftRange(range: DayRange, pages: number): DayRange {
  return rangeFrom(addDays(range.from, pages * RANGE_DAYS))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue Oct 27". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]
  return `${weekday} ${MONTHS[m! - 1]} ${d}`
}

/** "Oct 27 – Nov 2". */
export function formatRange(range: DayRange): string {
  const short = (day: string) => formatDay(day).slice(4)
  return `${short(range.from)} – ${short(range.to)}`
}

/** "08:00 – 10:00", "08:00" for one time, plus the zone when there is one. */
export function formatWindow(w: ItineraryArrivalWindow): string {
  const time = w.end && w.end !== w.start ? `${w.start} – ${w.end}` : w.start
  return `${time}${w.tz ? ` (${w.tz})` : ''}`
}

const norm = (v: string | null) => (v ?? '').trim().toLowerCase()

function stopKey(item: ItineraryItem): string {
  const p = item.place
  if (p && (p.street || p.city || p.zip)) {
    return `place:${norm(p.street)}|${norm(p.unit)}|${norm(p.city)}|${norm(p.state)}|${norm(p.zip)}`
  }
  const note = norm(item.placeNote)
  return note ? `note:${note}` : `order:${item.orderNum}`
}

export function groupItinerary(items: readonly ItineraryItem[]): ItineraryDay[] {
  const days: ItineraryDay[] = []
  const byDay = new Map<string, { day: ItineraryDay; stops: Map<string, ItineraryStop> }>()
  for (const item of items) {
    let entry = byDay.get(item.day)
    if (!entry) {
      entry = { day: { day: item.day, stops: [] }, stops: new Map() }
      byDay.set(item.day, entry)
      days.push(entry.day)
    }
    const key = stopKey(item)
    let stop = entry.stops.get(key)
    if (!stop) {
      stop = { key: `${item.day}:${key}`, place: item.place, placeNote: item.placeNote, items: [] }
      entry.stops.set(key, stop)
      entry.day.stops.push(stop)
    }
    stop.items.push(item)
  }
  return days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

/** The stop's heading: the street line, else the city line, else the note. */
export function stopTitle(stop: ItineraryStop): string {
  const p = stop.place
  const line1 = p ? [p.street, p.unit].filter((s) => s && s.trim()).join(', ') : ''
  const cityState = p ? [p.city, p.state].filter((s) => s && s.trim()).join(', ') : ''
  const line2 = p ? [cityState, p.zip].filter((s) => s && s.trim()).join(' ') : ''
  return line1 || line2 || stop.placeNote?.trim() || 'No address'
}

/** The source as a short label: where the dispatcher should look to change it. */
export function sourceLabel(item: ItineraryItem): string {
  switch (item.source.kind) {
    case 'longhaul-activity':
      return item.tripId != null ? `Trip ${item.tripId}` : 'Activity'
    case 'order-assigned':
      return 'Order'
    case 'local-job-token':
      return 'Local job'
  }
}
