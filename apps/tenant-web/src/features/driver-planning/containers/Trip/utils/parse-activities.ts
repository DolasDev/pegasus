import { datediff, addDays, toUtcDayKey } from '@/features/driver-planning/utils/date'
import { getPegDates } from './peg-dates'
import { sortActivities } from './sort-activities'

export interface ParseActivitiesResult<A> {
  days: (string | null)[]
  sortedActivities: A[]
  orderIdToColor: Record<string, string>
  hasDateChange: boolean
}

/**
 * Walks the trip's activities and produces the inputs the ActivityGantt needs:
 *   - `days`: every distinct calendar day touched by any activity, as the ISO
 *     string for UTC midnight of that day (see {@link toUtcDayKey}), plus
 *     `null` for missing/unparseable dates. Sorted ascending with the `null`
 *     ("Unknown") column last, so the Gantt can render them as-is.
 *
 *     Normalizing to a day key is what keeps one calendar day to one column:
 *     these values come from several sources (an activity's planned_start, its
 *     ETA/actual dates, the shipment's pegged planned dates, the day-walk
 *     between start and end) that do NOT agree on time-of-day. Keying by the
 *     raw timestamp turned one day into several identically-labeled columns —
 *     most visibly right after a planned date was added, since that writes the
 *     shipment row's time-of-day onto the activity.
 *   - `sortedActivities`: the activities in render order ({@link sortActivities}).
 *   - `orderIdToColor`: a stable shipment-order → CSS-class mapping. The CSS
 *     accessor is passed in so this util has no CSS-module dependency.
 *   - `hasDateChange`: any activity whose shipment-pegged dates differ from
 *     its own planned_start/end.
 *
 * **Mutates `activities`**: when a PACK/LOAD/RDEL activity is pegged-mismatched,
 * `activity.hasDateChange`, `activity.newStart`, `activity.newEnd` are set on
 * the input object. Preserved from the legacy app — call sites rely on these
 * being attached to drive Gantt overlay rendering.
 */
export function parseActivities<A extends Record<string, any>>(
  activities: A[] = [],
  getColor: (index: number) => string,
): ParseActivitiesResult<A> {
  const days = new Set<string | null>()
  const orderIds = new Set<string>()
  const pushToDays = (unformattedDate: unknown) => {
    days.add(toUtcDayKey(unformattedDate as string | number | Date | null | undefined))
  }
  let hasDateChange = false

  activities.forEach((activity: Record<string, any>) => {
    const startDate = new Date(activity.planned_start)
    const etaDate = activity.estimated_date
    const actualDate = activity.actual_date
    const plannedEnd = activity.planned_end ? new Date(activity.planned_end) : startDate
    const dayCount = datediff(startDate, plannedEnd) || 0
    const pegDates = getPegDates(activity)
    orderIds.add(activity.order_num)
    pushToDays(activity.planned_start)
    if (etaDate) pushToDays(etaDate)
    if (actualDate) pushToDays(actualDate)
    if (pegDates.mismatched) {
      activity.hasDateChange = true
      hasDateChange = true
      activity.newStart = pegDates.plannedStart
      activity.newEnd = pegDates.plannedEnd
      const changedDays =
        datediff(
          pegDates.plannedStart as string | number | Date,
          pegDates.plannedEnd as string | number | Date,
        ) || 0
      pushToDays(pegDates.plannedStart)
      for (let i = 0; i < changedDays; i++) {
        const nextDay = addDays(pegDates.plannedStart as string | number | Date, i + 1)
        pushToDays(nextDay)
      }
    }
    for (let i = 0; i < dayCount; i++) {
      const nextDay = addDays(startDate, i + 1)
      pushToDays(nextDay)
    }
  })

  // Ascending, with the "Unknown" column pinned to the end. Day keys are
  // fixed-width ISO strings, so a lexicographic sort is chronological.
  const sortedDays: (string | null)[] = [...days].filter((d): d is string => d !== null).sort()
  if (days.has(null)) sortedDays.push(null)

  return {
    days: sortedDays,
    sortedActivities: sortActivities(activities),
    orderIdToColor: [...orderIds].reduce<Record<string, string>>(
      (accum, orderId, i) => ({ ...accum, [orderId]: getColor(i) }),
      {},
    ),
    hasDateChange,
  }
}
