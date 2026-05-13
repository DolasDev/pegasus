import { sameDayCheck } from '@/features/driver-planning/utils/date'
import { ACTIVITY_TYPE_CODE } from './activity-codes'

export interface PegDatesResult {
  mismatched: boolean
  plannedStart: unknown
  plannedEnd: unknown
}

/**
 * For a PACK/LOAD/RDEL activity, return the *shipment*'s authoritative planned
 * dates and a `mismatched` flag indicating whether the activity's own
 * planned_start/end have drifted off them. For any other activity-type code
 * (or a missing code), returns the activity's own dates and `mismatched:
 * false`.
 *
 * Precedence inside each case mirrors the legacy app:
 *   PACK  → start: pack_date2 || plan_pack ; end: plan_pack || pack_date2
 *   LOAD  → start: load_date2 || plan_load ; end: plan_load || load_date2
 *   RDEL  → start: del_date2  || plan_del  ; end: plan_del  || del_date2
 *
 * Assumes `activity.shipment` is non-null when the code is PACK/LOAD/RDEL —
 * matches the legacy behavior. The reshape layer guarantees this for trips
 * fetched through `API.fetchTrip`.
 */
export function getPegDates(activity: any): PegDatesResult {
  const shipment = activity.shipment
  const activityPlannedStart = activity.planned_start
  const activityPlannedEnd = activity.planned_end
  let plannedStart: unknown = activity.planned_start
  let plannedEnd: unknown = activity.planned_end
  let mismatched = false
  const code = activity.activityType?.code

  switch (code) {
    case ACTIVITY_TYPE_CODE.PACKING:
      plannedStart = shipment.pack_date2 || shipment.plan_pack
      plannedEnd = shipment.plan_pack || shipment.pack_date2
      mismatched = !(
        sameDayCheck(
          activityPlannedStart as string | Date | null | undefined,
          plannedStart as string | Date | null | undefined,
        ) &&
        sameDayCheck(
          activityPlannedEnd as string | Date | null | undefined,
          plannedEnd as string | Date | null | undefined,
        )
      )
      break
    case ACTIVITY_TYPE_CODE.PICKUP:
      plannedStart = shipment.load_date2 || shipment.plan_load
      plannedEnd = shipment.plan_load || shipment.load_date2
      mismatched = !(
        sameDayCheck(
          activityPlannedStart as string | Date | null | undefined,
          plannedStart as string | Date | null | undefined,
        ) &&
        sameDayCheck(
          activityPlannedEnd as string | Date | null | undefined,
          plannedEnd as string | Date | null | undefined,
        )
      )
      break
    case ACTIVITY_TYPE_CODE.DELIVERY:
      plannedStart = shipment.del_date2 || shipment.plan_del
      plannedEnd = shipment.plan_del || shipment.del_date2
      mismatched = !(
        sameDayCheck(
          activityPlannedStart as string | Date | null | undefined,
          plannedStart as string | Date | null | undefined,
        ) &&
        sameDayCheck(
          activityPlannedEnd as string | Date | null | undefined,
          plannedEnd as string | Date | null | undefined,
        )
      )
      break
    default:
      mismatched = false
  }
  return { mismatched, plannedStart, plannedEnd }
}
