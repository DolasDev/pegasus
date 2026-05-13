import { datediff, addDays } from '@/features/driver-planning/utils/date'
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
 *   - `days`: every distinct calendar day touched by any activity (as ISO
 *     strings) plus `null` for missing planned_start values. Order is
 *     insertion-driven (Set semantics); the Gantt sorts itself.
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
    if (unformattedDate) {
      const date = new Date(unformattedDate as string | number | Date).toISOString()
      days.add(date)
    } else {
      days.add(null)
    }
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

  return {
    days: [...days],
    sortedActivities: sortActivities(activities),
    orderIdToColor: [...orderIds].reduce<Record<string, string>>(
      (accum, orderId, i) => ({ ...accum, [orderId]: getColor(i) }),
      {},
    ),
    hasDateChange,
  }
}
