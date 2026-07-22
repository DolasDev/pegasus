// ---------------------------------------------------------------------------
// The single confidence vocabulary for activity dates.
//
// The same glyphs mean the same things everywhere a planner reads a date: the
// planning screen's Gantt bars (containers/Trip/components/ActivityGantt) and
// the Availability screen's delivery rows AND Ready Date column. This module
// exists because the Ready Date column used to keep its own parallel ladder,
// which drifted until `actual` rendered the checkered flag and `estimated`
// rendered the truck — the two strongest signals read backwards. Change a
// glyph here, not in a view.
// ---------------------------------------------------------------------------
import type { Delivery } from '@/api/queries/driver-planning'

export interface ConfidenceTier {
  icon: string | null
  colorClass: string
  label: string
}

/** No signal worth an icon — the date renders as bare text. */
export const NO_CONFIDENCE: ConfidenceTier = { icon: null, colorClass: '', label: '' }

/**
 * The planner-entered availability date. Deliberately outside the ladder below:
 * it is not an activity date at all, so it keeps its own glyph rather than
 * borrowing one that means "the driver confirmed this activity".
 */
export const CONFIRMED_AVAILABILITY_TIER: ConfidenceTier = {
  icon: 'fa-calendar-check',
  colorClass: 'text-emerald-600',
  label: 'Confirmed availability',
}

export function getConfidenceTier(d: Delivery): ConfidenceTier {
  // Per-tier confidence hue: deepening emerald as certainty rises, with the
  // spread tier muted as the least-certain signal.
  if (d.actualDate) {
    return { icon: 'fa-truck-moving', colorClass: 'text-emerald-700', label: 'Verified complete' }
  }
  if (d.isConfirmed) {
    return {
      icon: 'fa-flag-checkered',
      colorClass: 'text-emerald-600',
      label: 'Confirmed with driver',
    }
  }
  if (d.isCommitted) {
    return { icon: 'fa-check', colorClass: 'text-emerald-500', label: 'Driver committed' }
  }
  // Spread fallback — the date shown comes from planned dates only (no
  // estimated / actual).
  if (!d.estimatedDate && (d.plannedStart || d.plannedEnd)) {
    return {
      icon: 'fa-question',
      colorClass: 'text-muted-foreground',
      label: 'Planned spread (least certain)',
    }
  }
  // An estimated date with nothing committed behind it carries no icon —
  // matching the Gantt, where an unconfirmed ETA is drawn bare.
  return NO_CONFIDENCE
}
