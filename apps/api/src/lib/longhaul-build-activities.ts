// ---------------------------------------------------------------------------
// Longhaul build-shipment-activities — port of ActivityService.buildShipmentActivities
// from /home/steve/repos/longhaul/server/modules/activities/activity.service.ts.
//
// Given a shipment (with any pre-existing untripped activities), this helper
// auto-generates the *required* activities (PACK, LOAD or R19O, RDEL) that
// every shipment must have before being placed on a trip. It does NOT cover
// the optional "extras" produced by `buildExtraShipmentActivities` in legacy
// — that's a separate code path on the shipments-update flow.
// ---------------------------------------------------------------------------

type Shipment = Record<string, unknown>
type Activity = Record<string, unknown>

/** Activity-type code strings used by required-activity generation. */
export const ACTIVITY_TYPE_CODE = {
  PACKING: 'PACK',
  PICKUP: 'LOAD',
  DELIVERY: 'RDEL',
  DOCKPICKUP: 'R19O',
} as const

function getCode(activity: Activity): string | undefined {
  const fromType = (activity['activityType'] as Record<string, unknown> | null | undefined)?.[
    'code'
  ]
  if (typeof fromType === 'string') return fromType
  const direct = activity['ActivityType_code']
  return typeof direct === 'string' ? direct : undefined
}

function hasCode(activities: Activity[], code: string): boolean {
  return activities.some((a) => getCode(a) === code)
}

function makeActivity(
  shipment: Shipment,
  activityTypeCode: string,
  plannedStart: unknown,
  plannedEnd: unknown,
  location: {
    streetAddr: unknown
    unit: unknown
    city: unknown
    state: unknown
    zip: unknown
  },
  activityTypesMap: Record<string, Activity> = {},
): Activity {
  return {
    order_num: shipment['order_num'],
    TripMaster_id: null,
    ActivityType_code: activityTypeCode,
    is_active: false,
    is_committed: false,
    is_confirmed: false,
    status: 'pending',
    planned_start: plannedStart ?? null,
    planned_end: plannedEnd ?? null,
    created_at: new Date(),
    updated_at: new Date(),
    modified_by: null,
    street: location.streetAddr ?? null,
    unit: location.unit ?? null,
    city: location.city ?? null,
    state: location.state ?? null,
    zip: location.zip ?? null,
    // Attach the FULL activity type (abbreviation + isCanEditDates / isHasETA)
    // from the map when available — the planning UI renders
    // `activity.activityType.abbreviation` and gates date editing on the flags,
    // so a bare `{ code }` marker shows "undefined" and locks the pickers.
    // Falls back to the legacy `{ code }` marker when no map is supplied (e.g.
    // the trip-save path, which only persists ActivityType_code). Mirrors the
    // legacy createActivity: `activityType: activityTypesMap[activityCode]`.
    activityType: activityTypesMap[activityTypeCode] ?? { code: activityTypeCode },
    location_id: null,
  }
}

/**
 * Returns the set of activities for a shipment with required activity templates
 * auto-filled. Inputs:
 *   - `shipment.activities`: any pre-existing activities (will be preserved when
 *     they have no `TripMaster_id` — i.e. they're not yet on a trip).
 *
 * Mirrors `ActivityService.buildShipmentActivities` from the NestJS legacy app.
 */
export function buildShipmentActivities(
  shipment: Shipment,
  activityTypesMap: Record<string, Activity> = {},
): Activity[] {
  const existing = ((shipment['activities'] as Activity[]) ?? []).filter(
    (a) => a['TripMaster_id'] == null,
  )
  const activities: Activity[] = [...existing]

  const originLocation = {
    streetAddr: shipment['shipper_add1'],
    unit: shipment['shipper_add2'],
    city: shipment['shipper_city'],
    state: shipment['shipper_state'],
    zip: shipment['shipper_zip'],
  }
  const destLocation = {
    streetAddr: shipment['del_address1'],
    unit: shipment['del_address2'],
    city: shipment['consignee_city'],
    state: shipment['consignee_state'],
    zip: shipment['consignee_zip'],
  }

  const rule19Id = shipment['rule19_id']

  // PACK — only when the shipment has a pack_date2 AND there's no rule19 (which
  // suppresses on-site packing in favor of dock pickup).
  if (shipment['pack_date2'] && !rule19Id) {
    if (!hasCode(activities, ACTIVITY_TYPE_CODE.PACKING)) {
      activities.push(
        makeActivity(
          shipment,
          ACTIVITY_TYPE_CODE.PACKING,
          shipment['pack_date2'] ?? shipment['plan_pack'],
          shipment['plan_pack'] ?? shipment['pack_date2'],
          originLocation,
          activityTypesMap,
        ),
      )
    }
  }

  // LOAD — only when there's no rule19 (otherwise we generate R19O instead).
  if (shipment['load_date2'] && !rule19Id) {
    if (!hasCode(activities, ACTIVITY_TYPE_CODE.PICKUP)) {
      activities.push(
        makeActivity(
          shipment,
          ACTIVITY_TYPE_CODE.PICKUP,
          shipment['load_date2'] ?? shipment['plan_load'],
          shipment['plan_load'] ?? shipment['load_date2'],
          originLocation,
          activityTypesMap,
        ),
      )
    }
  }

  // R19O — dock pickup, replaces LOAD when rule19_id is set.
  if (rule19Id) {
    if (!hasCode(activities, ACTIVITY_TYPE_CODE.DOCKPICKUP)) {
      const fallbackLoad = shipment['load_date2'] ?? shipment['plan_load']
      const fallbackPlan = shipment['plan_load'] ?? shipment['load_date2']
      activities.push(
        makeActivity(
          shipment,
          ACTIVITY_TYPE_CODE.DOCKPICKUP,
          shipment['rule19_out_date'] ?? fallbackLoad,
          shipment['rule19_out_date'] ?? fallbackPlan,
          originLocation,
          activityTypesMap,
        ),
      )
    }
  }

  // RDEL — every shipment gets a delivery activity (matches `if (true)` in legacy).
  if (!hasCode(activities, ACTIVITY_TYPE_CODE.DELIVERY)) {
    activities.push(
      makeActivity(
        shipment,
        ACTIVITY_TYPE_CODE.DELIVERY,
        shipment['del_date2'] ?? shipment['plan_del'],
        shipment['plan_del'] ?? shipment['del_date2'],
        destLocation,
        activityTypesMap,
      ),
    )
  }

  return activities
}
