import type { ItineraryArrivalWindow, ItineraryItem, ItineraryPlace } from '../types/itinerary'

// ---------------------------------------------------------------------------
// Itinerary view helpers — the date window and the day → stop grouping.
//
// Stops are not stored anywhere: a stop is derived as "same day, same place".
// Items arrive sorted (day → act sequence → order), and that order is kept
// within a stop; stops appear in the order their first item does. An item with
// no place (storage, warehouse, an address-less local job) groups by its
// free-text note instead, or — with no note either — by order, so unrelated
// address-less work never reads as one stop.
// ---------------------------------------------------------------------------

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

/** Days shown per page. Well inside the API's 31-day limit. */
export const RANGE_DAYS = 7

const pad = (n: number) => String(n).padStart(2, '0')

/** The device's local calendar day, `YYYY-MM-DD`. */
export function localDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` plus `days` (may be negative), on the calendar — no time zone. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** The window starting on `from`, `RANGE_DAYS` days inclusive. */
export function rangeFrom(from: string): DayRange {
  return { from, to: addDays(from, RANGE_DAYS - 1) }
}

export function shiftRange(range: DayRange, pages: number): DayRange {
  return rangeFrom(addDays(range.from, pages * RANGE_DAYS))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue Oct 27" — weekday from the calendar date, never the device zone. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${MONTHS[m - 1]} ${d}`
}

/** "Oct 27 – Nov 2". */
export function formatRange(range: DayRange): string {
  const short = (day: string) => formatDay(day).slice(4)
  return `${short(range.from)} – ${short(range.to)}`
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

/**
 * "08:00 – 10:00", plus the zone when the source has one (longhaul windows are
 * in the stop's zone, not necessarily the device's; local jobs carry none).
 */
export function formatWindow(w: ItineraryArrivalWindow): string {
  return `${w.start} – ${w.end}${w.tz ? ` (${w.tz})` : ''}`
}

/** "123 Main St, Unit 4" / "Austin, TX 78701" — either line may be empty. */
export function placeLines(place: ItineraryPlace | null): { line1: string; line2: string } {
  if (!place) return { line1: '', line2: '' }
  const line1 = [place.street, place.unit].filter((s) => s && s.trim()).join(', ')
  const cityState = [place.city, place.state].filter((s) => s && s.trim()).join(', ')
  const line2 = [cityState, place.zip].filter((s) => s && s.trim()).join(' ')
  return { line1, line2 }
}

/** The stop's heading: the address, else the dispatcher's note, else "No address". */
export function stopTitle(stop: ItineraryStop): string {
  const { line1, line2 } = placeLines(stop.place)
  return line1 || line2 || stop.placeNote?.trim() || 'No address'
}

export function isLocalItem(item: ItineraryItem): boolean {
  return item.source.kind === 'local-job-token'
}

export function isDone(item: ItineraryItem): boolean {
  return item.actual != null
}
