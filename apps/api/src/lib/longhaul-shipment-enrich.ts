// ---------------------------------------------------------------------------
// Longhaul shipment enrichment helpers
//
// Pure functions that operate on already-fetched shipment + activity data.
// Mirror the legacy ActivityService.getTripInfo + buildExtraShipmentActivities
// logic so the GET /shipments endpoint returns the same shape the legacy UI
// expects.
//
// Legacy source: longhaul/server/modules/activities/activity.service.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Loose Activity row shape — combines the columns on
 * `LongDistanceDispatchActivity` with the aliased `activityType_*` columns the
 * shipment repository selects (see findShipmentsWithQuery).
 */
export interface ActivityRow {
  id?: number
  order_num?: number
  TripMaster_id?: number | null
  ActivityType_code?: string | null
  assigned_driver_id?: number | null
  trip_status_id?: number | null
  driver_name?: string | null
  status?: string | null
  planned_start?: Date | string | null
  planned_end?: Date | string | null
  estimated_date?: Date | string | null
  actual_date?: Date | string | null
  location_id?: number | null
  activityType_code?: string | null
  activityType_name?: string | null
  activityType_abbreviation?: string | null
  [key: string]: unknown
}

/** Extra-location row from `pegasus_extra_location`. */
export interface ExtraLocationRow {
  id?: number
  active?: string | null
  type?: string | null
  street?: string | null
  unit1?: string | null
  unit2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  [key: string]: unknown
}

/** ActivityType row from `Longhaul_ActivityType`. */
export interface ActivityType {
  activityTypeId?: number
  code: string
  name?: string | null
  abbreviation?: string | null
  description?: string | null
  isPerformedAtOrigin?: boolean | null
  isPerformedAtDestination?: boolean | null
  isCanEditDates?: boolean | null
  isHasETA?: boolean | null
  sequencePriority?: number | null
  [key: string]: unknown
}

/** A shipment row with its joined activities and extra_locations. */
export interface ShipmentRow {
  order_num?: number
  pack_date2?: Date | string | null
  load_date2?: Date | string | null
  del_date2?: Date | string | null
  plan_pack?: Date | string | null
  plan_load?: Date | string | null
  plan_del?: Date | string | null
  rule19_id?: number | null
  rule19_out_date?: Date | string | null
  ship_load_date?: Date | string | null
  shipper_add1?: string | null
  shipper_add2?: string | null
  shipper_city?: string | null
  shipper_state?: string | null
  shipper_zip?: string | null
  del_address1?: string | null
  del_address2?: string | null
  consignee_city?: string | null
  consignee_state?: string | null
  consignee_zip?: string | null
  extra_date?: Date | string | null
  extra_date2?: Date | string | null
  unpack?: Date | string | null
  whse_date?: Date | string | null
  sit_date?: Date | string | null
  sale_date?: Date | string | null
  arrival_date?: Date | string | null
  driver_name?: string | null
  TripMaster_id?: number | null
  TripStatus_id?: number | null
  latest_activity_date?: Date | string | null
  latest_activity_abbr?: string | null
  activities?: ActivityRow[]
  extra_locations?: ExtraLocationRow[]
  extraActivities?: ActivityTemplate[]
  [key: string]: unknown
}

/** Activity template produced by buildExtraShipmentActivities. */
export interface ActivityTemplate {
  order_num: number | undefined
  TripMaster_id: null
  ActivityType_code: string
  is_active: false
  is_committed: false
  is_confirmed: false
  status: 'pending'
  planned_start: Date | string | null
  planned_end: Date | string | null
  created_at: Date
  updated_at: Date
  modified_by: null
  street: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
  activityType: ActivityType | undefined
  location_id: number | null
}

// ---------------------------------------------------------------------------
// Activity type codes (mirror legacy ACTIVITY_TYPE_CODE)
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPE_CODE = {
  PACKING: 'PACK',
  PICKUP: 'LOAD',
  DELIVERY: 'RDEL',
  AGENTPICKUP: 'R19I',
  DOCKPICKUP: 'R19O',
  WAREHOUSE: 'WHSE',
  EXTRAPICKUP: 'XPU',
  EXTRADELIVERY: 'XDEL',
  UNPACK: 'UNPK',
  SITIN: 'SITIN',
  SITOUT: 'SITOUT',
  CFOUT: 'CFD',
  CFIN: 'CFA',
} as const

// ---------------------------------------------------------------------------
// Date comparison helpers
// ---------------------------------------------------------------------------

function toTime(value: unknown): number | null {
  if (!value) return null
  const t = new Date(value as string).getTime()
  return Number.isNaN(t) ? null : t
}

function compareTimes(a: number | null, b: number | null): number {
  // Treat null as "after everything" — same effect as POSITIVE_INFINITY but
  // without producing NaN when both sides are null.
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function comparePlanned(a: ActivityRow, b: ActivityRow): number {
  return compareTimes(
    toTime(a.estimated_date ?? a.planned_start),
    toTime(b.estimated_date ?? b.planned_start),
  )
}

function compareActual(a: ActivityRow, b: ActivityRow): number {
  // Legacy `compare_actual(b, a)` returns DESC by actual_date — newest first.
  return compareTimes(toTime(b.actual_date), toTime(a.actual_date))
}

// ---------------------------------------------------------------------------
// getTripInfo: pick the most relevant activity for a shipment
//
// Legacy logic (activity.service.ts:573-583):
//   - If the shipment has any unfinished activities (actual_date == null),
//     return the earliest by estimated_date || planned_start.
//   - Otherwise return the most-recently-completed activity (max actual_date).
//   - Else return an empty Activity().
// ---------------------------------------------------------------------------

export function getTripInfo(activities: ActivityRow[] | undefined | null): ActivityRow {
  if (!activities || activities.length === 0) return {} as ActivityRow
  const unfinished = activities.filter((a) => !a.actual_date).sort(comparePlanned)
  if (unfinished[0]) return unfinished[0]
  const finished = activities.filter((a) => a.actual_date).sort(compareActual)
  if (finished[0]) return finished[0]
  return {} as ActivityRow
}

/**
 * Enrich a shipment row in place with trip-info fields derived from its
 * activities. Mirrors the per-shipment block in legacy
 * shipment.service.ts:38-45.
 */
export function enrichShipmentWithTripInfo(shipment: ShipmentRow): ShipmentRow {
  const tripInfo = getTripInfo(shipment.activities)
  // Legacy: `driver?.driver_name || query_results[idx].driver_name` —
  // fall back to whatever was already on the shipment view.
  shipment.driver_name = (tripInfo.driver_name as string | null) ?? shipment.driver_name ?? null
  shipment.TripMaster_id = (tripInfo.TripMaster_id as number | null) ?? null
  shipment.latest_activity_date =
    (tripInfo.actual_date as Date | string | null) ??
    (tripInfo.estimated_date as Date | string | null) ??
    (tripInfo.planned_start as Date | string | null) ??
    null
  shipment.latest_activity_abbr = (tripInfo.activityType_abbreviation as string | null) ?? null
  shipment.TripStatus_id = (tripInfo.trip_status_id as number | null) ?? null
  return shipment
}

// ---------------------------------------------------------------------------
// buildExtraShipmentActivities
//
// Mirror of legacy activity.service.ts:239-545. Produces a list of optional
// activity templates the user can attach to a trip — they are not persisted
// here, just returned as suggestions.
// ---------------------------------------------------------------------------

function getActivityCode(a: ActivityRow): string | null | undefined {
  return a.activityType_code ?? a.ActivityType_code
}

function hasActivityOfType(activities: ActivityRow[], code: string): boolean {
  return activities.some((a) => getActivityCode(a) === code)
}

function alreadyAdded(extras: ActivityTemplate[], code: string): boolean {
  return extras.some((a) => a.ActivityType_code === code)
}

function makeTemplate(
  shipment: ShipmentRow,
  activityCode: string,
  plannedStart: Date | string | null,
  plannedEnd: Date | string | null,
  location: {
    streetAddr: string | null | undefined
    unit: string | null | undefined
    city: string | null | undefined
    state: string | null | undefined
    zip: string | null | undefined
  },
  activityTypesMap: Record<string, ActivityType>,
  locationId: number | null = null,
): ActivityTemplate {
  const now = new Date()
  return {
    order_num: shipment.order_num,
    TripMaster_id: null,
    ActivityType_code: activityCode,
    is_active: false,
    is_committed: false,
    is_confirmed: false,
    status: 'pending',
    planned_start: plannedStart,
    planned_end: plannedEnd,
    created_at: now,
    updated_at: now,
    modified_by: null,
    street: location.streetAddr ?? null,
    unit: location.unit ?? null,
    city: location.city ?? null,
    state: location.state ?? null,
    zip: location.zip ?? null,
    activityType: activityTypesMap[activityCode],
    location_id: locationId,
  }
}

function shipperLoc(s: ShipmentRow) {
  return {
    streetAddr: s.shipper_add1,
    unit: s.shipper_add2,
    city: s.shipper_city,
    state: s.shipper_state,
    zip: s.shipper_zip,
  }
}

function consigneeLoc(s: ShipmentRow) {
  return {
    streetAddr: s.del_address1,
    unit: s.del_address2,
    city: s.consignee_city,
    state: s.consignee_state,
    zip: s.consignee_zip,
  }
}

export function buildExtraShipmentActivities(
  shipment: ShipmentRow,
  activityTypesMap: Record<string, ActivityType> = {},
): ActivityTemplate[] {
  const extras: ActivityTemplate[] = []
  const activities = shipment.activities ?? []

  const hasPacking = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.PACKING)
  const hasPickup = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.PICKUP)
  const hasDelivery = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.DELIVERY)
  const hasDockPickup = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.DOCKPICKUP)
  const hasAPU = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.AGENTPICKUP)
  const hasUnpack = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.UNPACK)
  const hasSITIn = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.SITIN)
  const hasSITOut = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.SITOUT)
  const hasCFOut = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.CFOUT)
  const hasCFIn = !hasActivityOfType(activities, ACTIVITY_TYPE_CODE.CFIN)

  // Whether a given extra location already has a corresponding XPU/XDEL activity.
  const hasExtraPickupForLocation = (loc: ExtraLocationRow) =>
    !activities
      .filter((a) => getActivityCode(a) === ACTIVITY_TYPE_CODE.EXTRAPICKUP)
      .some((a) => a.location_id === loc.id)
  const hasExtraDeliveryForLocation = (loc: ExtraLocationRow) =>
    !activities
      .filter((a) => getActivityCode(a) === ACTIVITY_TYPE_CODE.EXTRADELIVERY)
      .some((a) => a.location_id === loc.id)

  // ----- PACKING -----
  if (hasPacking && shipment.pack_date2) {
    const code = ACTIVITY_TYPE_CODE.PACKING
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.pack_date2 ?? shipment.plan_pack ?? null,
          shipment.plan_pack ?? shipment.pack_date2 ?? null,
          shipperLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- PICKUP (LOAD) -----
  if (hasPickup && shipment.load_date2) {
    const code = ACTIVITY_TYPE_CODE.PICKUP
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.load_date2 ?? shipment.plan_load ?? null,
          shipment.plan_load ?? shipment.load_date2 ?? null,
          shipperLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- DELIVERY -----
  if (hasDelivery && shipment.del_date2) {
    const code = ACTIVITY_TYPE_CODE.DELIVERY
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.del_date2 ?? shipment.plan_del ?? null,
          shipment.plan_del ?? shipment.del_date2 ?? null,
          consigneeLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- AGENT PICKUP (R19I) -----
  if (hasAPU) {
    const code = ACTIVITY_TYPE_CODE.AGENTPICKUP
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.ship_load_date ?? shipment.load_date2 ?? shipment.plan_load ?? null,
          shipment.ship_load_date ?? shipment.plan_load ?? shipment.load_date2 ?? null,
          shipperLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- DOCK PICKUP (R19O) -----
  if (hasDockPickup) {
    const code = ACTIVITY_TYPE_CODE.DOCKPICKUP
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.rule19_out_date ?? shipment.load_date2 ?? shipment.plan_load ?? null,
          shipment.rule19_out_date ?? shipment.plan_load ?? shipment.load_date2 ?? null,
          shipperLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- EXTRA PICKUPS (XPU) -----
  for (const loc of shipment.extra_locations ?? []) {
    if (loc.active === 'Y' && loc.type === 'O' && hasExtraPickupForLocation(loc)) {
      const code = ACTIVITY_TYPE_CODE.EXTRAPICKUP
      if (!alreadyAdded(extras, code)) {
        extras.push(
          makeTemplate(
            shipment,
            code,
            shipment.extra_date ?? null,
            shipment.extra_date ?? null,
            {
              streetAddr: loc.street,
              unit: loc.unit1 ?? loc.unit2 ?? null,
              city: loc.city,
              state: loc.state,
              zip: loc.zip,
            },
            activityTypesMap,
            loc.id ?? null,
          ),
        )
      }
    }
  }

  // ----- EXTRA DELIVERIES (XDEL) -----
  for (const loc of shipment.extra_locations ?? []) {
    if (loc.active === 'Y' && loc.type === 'D' && hasExtraDeliveryForLocation(loc)) {
      const code = ACTIVITY_TYPE_CODE.EXTRADELIVERY
      if (!alreadyAdded(extras, code)) {
        extras.push(
          makeTemplate(
            shipment,
            code,
            shipment.extra_date2 ?? null,
            shipment.extra_date2 ?? null,
            {
              streetAddr: loc.street,
              unit: loc.unit1 ?? loc.unit2 ?? null,
              city: loc.city,
              state: loc.state,
              zip: loc.zip,
            },
            activityTypesMap,
            loc.id ?? null,
          ),
        )
      }
    }
  }

  // ----- UNPACK -----
  if (hasUnpack || shipment.unpack) {
    const code = ACTIVITY_TYPE_CODE.UNPACK
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.unpack ?? null,
          shipment.unpack ?? null,
          consigneeLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- SIT-IN -----
  if (hasSITIn) {
    const code = ACTIVITY_TYPE_CODE.SITIN
    if (!alreadyAdded(extras, code)) {
      extras.push(
        makeTemplate(
          shipment,
          code,
          shipment.whse_date ?? null,
          shipment.whse_date ?? null,
          consigneeLoc(shipment),
          activityTypesMap,
        ),
      )
    }
  }

  // ----- SIT-OUT -----
  // Legacy unconditionally pushes (no dedupe). Preserve that quirk.
  if (hasSITOut) {
    const code = ACTIVITY_TYPE_CODE.SITOUT
    extras.push(
      makeTemplate(
        shipment,
        code,
        shipment.sit_date ?? null,
        shipment.sit_date ?? null,
        consigneeLoc(shipment),
        activityTypesMap,
      ),
    )
  }

  // ----- CFOUT -----
  if (hasCFOut) {
    const code = ACTIVITY_TYPE_CODE.CFOUT
    const tpl = makeTemplate(
      shipment,
      code,
      shipment.sale_date ?? null,
      shipment.sale_date ?? null,
      shipperLoc(shipment),
      activityTypesMap,
    )
    // Legacy guards on `cfout.activityType` — only push if the type exists in
    // the activity-type catalog.
    if (tpl.activityType) extras.push(tpl)
  }

  // ----- CFIN -----
  if (hasCFIn) {
    const code = ACTIVITY_TYPE_CODE.CFIN
    const tpl = makeTemplate(
      shipment,
      code,
      shipment.arrival_date ?? null,
      shipment.arrival_date ?? null,
      consigneeLoc(shipment),
      activityTypesMap,
    )
    if (tpl.activityType) extras.push(tpl)
  }

  return extras
}
