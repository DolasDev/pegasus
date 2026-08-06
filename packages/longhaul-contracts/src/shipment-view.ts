// ---------------------------------------------------------------------------
// v_longhaul_shipments_v2 — the column manifest and row types.
//
// WHY THIS EXISTS
//
// Both read paths for a longhaul shipment select the view with a wildcard —
// `SELECT s.*` in apps/api (shipments-list.ts, longhaul-trip-fetch.ts) — and
// hand the row straight through to the browser as JSON. Nothing in between
// knows the column set, so for years an accessor could name a field the view
// does not project and the only symptom was a blank cell. Four production bugs
// came from exactly that:
//
//   #569  destination street read `del_address1/2`  → really consignee_name1/2
//   #570  Operations read `OpsLastName`             → really last_name
//   #571  Super-VIP read `supervip`                 → really idc_break
//   (#4)  SIT indicator reads `storage_driver_id`   → really driver2_id
//
// The first three were legacy TypeORM *entity property* names: the old NestJS
// app read this same view through an entity that renamed columns, so ported
// accessors inherited names that only ever existed in TypeScript. Typing the
// row against this manifest turns each of those into a compile error.
//
// SOURCE OF TRUTH
//
// The view is provisioned into each tenant's MSSQL from the legacy repo's
// ViewEntity (longhaul/server/modules/shipments/model/migrate/shipment_v2.view.ts)
// — a different repository, and CI has no MSSQL. So the manifest is checked in
// here and verified on demand against a live tenant view by
// `scripts/verify-longhaul-view-columns.ts`. Captured from
// INFORMATION_SCHEMA.COLUMNS on the prod Nelson Westerberg view (2026-08-01),
// in ORDINAL_POSITION order, and it matches the ViewEntity expression.
//
// COMPILE-TIME ONLY
//
// These types describe what the view is expected to project; they must NEVER be
// used to filter, validate, or reshape a payload at runtime. A tenant sitting on
// an older view definition returns fewer columns (Quality Move Management once
// had no v2 view at all) and must keep working — the row passes through as
// whatever the database returned.
// ---------------------------------------------------------------------------

/**
 * Every column `SELECT s.*` pulls off `v_longhaul_shipments_v2`, in the view's
 * own ordinal order.
 *
 * Also the collision list for wildcard queries: any joined or OUTER APPLY
 * column added alongside `s.*` MUST be aliased to a name that is NOT in here.
 * Two output columns of the same name make the `mssql` driver bind that key to
 * an ARRAY of both values instead of a scalar — which is what shipped
 * `operations_id: [1196, 1196]` to the browser until #575.
 */
export const LONGHAUL_SHIPMENT_VIEW_COLUMNS = [
  'order_num',
  'shipment_status',
  'shipper_name',
  'vip',
  'idc_break',
  'avl_reg',
  'line_haul',
  'coordinator_id',
  'coordinator',
  'booker_name',
  'ba_name',
  'driver2_id',
  'driver2_name',
  'survey_date',
  'import_export',
  'move_desc',
  'shaul',
  'haul_mode',
  'branch',
  'shipper_city',
  'shipper_state',
  'origin_zone',
  'consignee_city',
  'consignee_state',
  'dest_zone',
  'pack_date',
  'pack_date2',
  'plan_pack',
  'pack_actual',
  'load_date',
  'load_date2',
  'plan_load',
  'load_actual',
  'del_date',
  'del_date2',
  'plan_del',
  'del_actual',
  'extra_date',
  'extra_date2',
  'type_packing',
  'lng_dis_ld_early',
  'lng_dis_ld_late',
  'lng_dis_del_early',
  'lng_dis_del_late',
  'total_est_wt',
  'weight',
  'mileage',
  'haul_id',
  'haul_name',
  'driver_id',
  'driver_name',
  'special4',
  'whse_date',
  'sit_date',
  'ship_load_date',
  'rule19_out_date',
  'rule19_id',
  'load_driver',
  'pickup_num',
  'disp_instructions',
  'oa_id',
  'da_id',
  'oa_name',
  'da_name',
  'survey_remarks',
  'stg_id',
  'pick_address1',
  'del_address1',
  'lng_dis_comments',
  'shipper_add1',
  'shipper_add2',
  'consignee_name1',
  'consignee_name2',
  'sale_date',
  'arrival_date',
  'consignee_zip',
  'shipper_zip',
  'operations_id',
  'oshuttle',
  'dshuttle',
  'stgindicator',
  'extrapu',
  'extradel',
  'company',
  'registration_notes',
  'packing_coverage_id',
  'last_name',
  'TripStatus_id',
  'latest_activity_date',
  'latest_activity_abbr',
  'TripMaster_id',
] as const

/** One of the view's column names. */
export type LonghaulShipmentViewColumn = (typeof LONGHAUL_SHIPMENT_VIEW_COLUMNS)[number]

/**
 * A single column's value.
 *
 * Deliberately coarse. Per-column scalar types are NOT modeled, because no
 * trustworthy local source for them exists: the legacy entity's declarations
 * disagree with the live schema on ~8 columns (it has 10 numeric where
 * INFORMATION_SCHEMA has 16, and declares `driver2_id: Date` for what is plainly
 * an id), so encoding them would bake in wrong types with a confident face.
 *
 * The bug class this package exists to kill is *unknown keys*, and an exact key
 * set catches all of it. Scalar precision is a separate, later refinement —
 * `scripts/verify-longhaul-view-columns.ts` can emit the per-column mapping from
 * INFORMATION_SCHEMA.DATA_TYPE when someone wants it.
 *
 */
export type LonghaulSqlValue = string | number | null

/**
 * Exactly the columns the view projects — no more, no less.
 *
 * Every column is optional, for two reasons: a tenant on an older view
 * definition simply will not send the key, and test fixtures should not have to
 * spell out all 91. That costs nothing here — the protection this type provides
 * is that **reading or writing a name that is not a column is an error**, and
 * optionality does not weaken either check.
 */
export type LonghaulShipmentViewRow = {
  [K in LonghaulShipmentViewColumn]?: LonghaulSqlValue
}

/**
 * The shipment row as it reaches a consumer: the view's columns plus everything
 * the API and the client add on top.
 *
 * NOTE: no index signature, on purpose. An index signature is why the existing
 * `ShipmentRow` in apps/api/src/lib/longhaul-shipment-enrich.ts never caught any
 * of the four bugs above — `[key: string]: unknown` makes every typo legal.
 * Adding one here would defeat the entire package.
 */
export interface LonghaulShipmentRow extends LonghaulShipmentViewRow {
  // ---- added by the API (shipments-list.ts / longhaul-trip-fetch.ts) ----
  /** Real activities plus the required generated templates. */
  activities?: unknown[]
  /** Optional activity templates the user may attach to a trip. */
  extraActivities?: unknown[]
  /** Rows from `pegasus_extra_location`; `[]` when the table is absent. */
  extra_locations?: unknown[]
  /**
   * The PACK row from `longhaul_shipmentcoverage`, or null when the order has
   * none. Only the fields the UI reads are modeled — the coverage table is not
   * contracted here, so widen this deliberately if a consumer needs more.
   */
  packing_coverage?: {
    order_num?: number | null
    activity_code?: string | null
    is_covered?: boolean | null
  } | null
  /** `sales.weight`, aliased to avoid colliding with the view's `weight`. */
  shadow_weight?: number | null
  /** `sales.lng_dis_comments`, aliased to avoid colliding with the view's copy. */
  shadow_comments?: string | null
  /** `sales.operations_name` — the view has no column of this name. */
  operations_name?: string | null

  // ---- added client-side ----
  /**
   * The flat `{ weight, lng_dis_comments, operations_id, operations_name }`
   * object the ported components were written against, rebuilt from the aliased
   * columns by tenant-web's `reshapeShipment`.
   */
  pegasus_shadow?: {
    order_num?: LonghaulSqlValue
    weight?: number | null
    lng_dis_comments?: string | null
    operations_id?: LonghaulSqlValue
    operations_name?: string | null
  } | null
  /** Index into PendingTrips' local shipment array. Never from the database. */
  stateIdx?: number
}
