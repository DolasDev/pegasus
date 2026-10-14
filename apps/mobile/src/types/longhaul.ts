// ---------------------------------------------------------------------------
// Longhaul (operations) types for the driver "My Trips" feature.
//
// These mirror the subset of fields the cloud operations endpoints
// (/api/v1/onprem/longhaul/*) return that the mobile screens render. They are
// intentionally permissive (most fields optional/nullable) because the legacy
// MSSQL views return sparse rows. Field names match the API response verbatim
// so the same values the tenant-web operations module shows appear here.
// ---------------------------------------------------------------------------

/** A trip row as returned by GET /onprem/longhaul/trips and /trips/:id. */
export interface LonghaulTrip {
  id: number
  trip_title: string | null
  driver_id: number | null
  driver_name: string | null
  /** Status name from MasterTripStatus (e.g. 'Pending', 'Offered', 'Accepted'). */
  status_status: string | null
  TripStatus_id: number | null
  /** Free-text lifecycle flag; 'canceled' marks a canceled trip. */
  internal_status: string | null
  origin_geo_code: string | null
  destination_geo_code: string | null
  planned_first_day: string | null
  planned_last_day: string | null
  actual_first_day: string | null
  actual_last_day: string | null
  total_estimated_lbs: number | null
  total_actual_lbs: number | null
  total_estimated_linehaul_usd: number | null
  total_days: number | null
}

/** Trip detail embeds its shipments and activities (and notes we don't render). */
export interface LonghaulTripDetail extends LonghaulTrip {
  shipments?: LonghaulShipment[]
  activities?: LonghaulActivity[]
}

/**
 * A LongDistanceDispatchActivity row as GET /trips/:id returns it (`a.*` plus
 * the joined Longhaul_ActivityType fields and the server-derived arrival-window
 * fields). Only the subset the driver ETA editor reads.
 */
export interface LonghaulActivity {
  id: number
  order_num?: number | string | null
  TripMaster_id?: number | null
  ActivityType_code?: string | null
  activityType_code?: string | null
  activityType_name?: string | null
  activityType_abbreviation?: string | null
  /** Longhaul_ActivityType.isHasETA — false ⇒ the driver sets a window only. */
  activityType_isHasETA?: boolean | number | null
  /** The ETA — a calendar day (serialized as midnight UTC). */
  estimated_date?: string | null
  planned_start?: string | null
  planned_end?: string | null
  actual_date?: string | null
  /** Local wall clock `HH:mm` at the activity's address. */
  arrival_window_start?: string | null
  arrival_window_end?: string | null
  /** IANA zone of the window. */
  arrival_window_tz?: string | null
  /** What the server would pick for this address when no zone is stored. */
  arrival_window_tz_suggested?: string | null
  /** `EDT` / `CST` … derived server-side. */
  arrival_window_tz_label?: string | null
  /**
   * "Confirmed" — the driver AND the shipper have committed to this date.
   * (Dispatch shows it as "Driver committed".) SQL Server bits may arrive as
   * 0/1 rather than booleans.
   */
  is_committed?: boolean | number | null
  assigned_driver_id?: number | null
  city?: string | null
  state?: string | null
}

/** Body of PATCH /onprem/longhaul/driver/activities/:id/eta. */
export interface DriverEtaUpdate {
  /** `YYYY-MM-DD`. Only for activity types that have an ETA. */
  estimated_date?: string | null
  arrival_window_start?: string | null
  arrival_window_end?: string | null
  arrival_window_tz?: string | null
  /** Required — every save states the commitment explicitly. */
  committed: boolean
}

/** A shipment row — curated subset rendered on mobile. */
export interface LonghaulShipment {
  order_num: string | number
  shipper_name?: string | null
  ba_name?: string | null
  move_desc?: string | null
  booker_name?: string | null
  driver_name?: string | null
  TripMaster_id?: number | null
  status_status?: string | null

  // Locations
  shipper_city?: string | null
  shipper_state?: string | null
  consignee_city?: string | null
  consignee_state?: string | null
  origin_address1?: string | null
  origin_address2?: string | null
  origin_zip?: string | null
  destination_address1?: string | null
  destination_address2?: string | null
  destination_zip?: string | null

  // Key dates (spread = planned-from / planned-to; *_actual = confirmed)
  pack_date2?: string | null
  plan_pack?: string | null
  pack_actual?: string | null
  load_date2?: string | null
  plan_load?: string | null
  load_actual?: string | null
  sit_date?: string | null
  del_date2?: string | null
  plan_del?: string | null
  del_actual?: string | null

  // Weight
  total_est_wt?: number | string | null
  pegasus_shadow?: { weight?: number | string | null; lng_dis_comments?: string | null } | null

  // Notes / instructions
  disp_instructions?: string | null
  survey_remarks?: string | null

  /** Embedded on trip detail: this shipment's activities on the trip. */
  activities?: LonghaulActivity[]
}

/** The /api/v1/me/driver response payload (after the `{ data }` unwrap). */
export interface DriverMapping {
  longhaulDriverId: number | null
}
